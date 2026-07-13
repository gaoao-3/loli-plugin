import { getEngine } from './state.js'
import { getGroupHistory } from './group.js'
import { getSelfId, makeForwardMsg, makeImageSegment, makeRecordSegment, normalizeSegment } from './bot.js'
import {
  formatOneBotSegmentText,
  formatRawMessage,
  compressImage,
  fetchAndCompressImage
} from './common.js'

/**
 * 从统一用户消息中提取纯文本内容
 * @param {import('chaite').UserMessage} userMessage
 * @returns {string}
 */
export function extractTextFromUserMessage (userMessage) {
  if (!userMessage?.content) return ''
  if (typeof userMessage.content === 'string') return userMessage.content
  if (Array.isArray(userMessage.content)) {
    return userMessage.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n')
  }
  return ''
}

/** 给当前轮添加交互提示，让模型明确知道用户是在叫机器人。 */
export function addInteractionHint (userMessage, hint) {
  const text = String(hint || '').trim()
  if (!text) return userMessage
  const content = Array.isArray(userMessage?.content) ? [...userMessage.content] : []
  content.unshift({ type: 'text', text: `[当前交互] ${text}` })
  return { ...userMessage, content }
}

/**
 * 从群聊历史消息中收集最近 N 张图片，供 AI 识别群聊上下文中的多图
 *
 * @param e
 * @param {{
 *   maxImages: number,
 *   maxAgeSeconds: number,
 *   contextLength: number,
 *   imageCompress: { enable: boolean, maxLongEdge: number, quality: number, maxFileSizeKB: number }
 * }} options
 * @returns {Promise<Array<{ type: string, image: string, mimeType: string, senderName: string, senderId: string, time: number }>>}
 */
export async function collectHistoryImages (e, options = {}) {
  const {
    maxImages = 5,
    maxAgeSeconds = 300,
    contextLength = 30,
    imageCompress = { enable: true, maxLongEdge: 1536, quality: 85, maxFileSizeKB: 2048 }
  } = options

  if (!e.isGroup || maxImages <= 0) return []

  try {
    const chats = await getGroupHistory(e, contextLength)
    const selfId = getSelfId(e)
    const images = []
    const nowSec = Math.floor(Date.now() / 1000)

    // 从后往前遍历，优先取最近的消息
    for (let i = chats.length - 1; i >= 0; i--) {
      if (images.length >= maxImages) break

      const chat = chats[i]
      if (!chat) continue

      const senderId = String(chat.sender?.user_id || '')
      if (!senderId || senderId === selfId || senderId === '0') continue

      const chatTime = chat.time || 0
      if (nowSec - chatTime > maxAgeSeconds) continue

      for (const rawSeg of chat.message || []) {
        const seg = normalizeSegment(rawSeg)
        if (images.length >= maxImages) break
        if (seg.type !== 'image' || !seg.url) continue

        try {
          const compressed = await fetchAndCompressImage(seg.url, {
            timeoutMs: 15000,
            retries: 1,
            imageCompress
          })

          images.push({
            type: 'image',
            image: compressed.buffer.toString('base64'),
            mimeType: compressed.mimeType,
            senderName: chat.sender?.card || chat.sender?.nickname || senderId,
            senderId,
            time: chatTime
          })
        } catch (err) {
          logger.warn(`[loli] fetch history image failed: ${err.message}`)
        }
      }
    }

    // 按时间顺序返回
    return images.reverse()
  } catch (err) {
    logger.warn(`[loli] collect history images failed: ${err.message}`)
    return []
  }
}

/**
 * 将历史图片合并到当前用户消息中，让 AI 能看到群内其他成员发的图
 *
 * @param {import('chaite').UserMessage} userMessage
 * @param {Array} historyImages
 * @returns {import('chaite').UserMessage}
 */
export function mergeHistoryImagesIntoUserMessage (userMessage, historyImages) {
  if (!historyImages || historyImages.length === 0) return userMessage

  const currentImages = userMessage.content?.filter(c => c.type === 'image') || []
  const currentText = userMessage.content?.filter(c => c.type === 'text') || []
  const otherContents = userMessage.content?.filter(c => c.type !== 'image' && c.type !== 'text') || []

  const senderList = [...new Set(historyImages.map(img => img.senderName))].join('、')
  const newContent = []

  newContent.push({
    type: 'text',
    text: `[群聊上下文] 最近 ${historyImages.length} 张来自 ${senderList} 等成员发送的图片如下，每张图片前标注了发送者，请结合当前对话理解。`
  })

  for (const img of historyImages) {
    newContent.push({
      type: 'text',
      text: `【${img.senderName} 发送的图片】`
    })
    newContent.push({
      type: 'image',
      image: img.image,
      mimeType: img.mimeType
    })
  }

  newContent.push(...currentText)
  newContent.push(...currentImages)
  newContent.push(...otherContents)

  return {
    ...userMessage,
    content: newContent
  }
}

/**
 * 处理引用回复：提取文本、图片、文件信息
 * @param e
 * @param {object} options
 * @returns {Promise<{ text: string, imageContents: Array }>}
 */
async function _extractReplyContext (e, options = {}) {
  const {
    handleReplyText = false,
    handleReplyImage = true,
    handleReplyFile = true,
    imageCompress = { enable: true, maxLongEdge: 1536, quality: 85, maxFileSizeKB: 2048 }
  } = options

  let text = ''
  const imageContents = []

  if (!(e.source || e.reply_id)) return { text, imageContents }
  if (!handleReplyText && !handleReplyImage && !handleReplyFile) return { text, imageContents }

  let seq = e.isGroup ? (e.source?.seq || e.reply_id) : (e.source?.time || e.source?.time)
  let reply
  if (e.getReply && typeof e.getReply === 'function') {
    const quoted = await e.getReply()
    reply = quoted?.message || quoted?.data?.message
  } else {
    const history = e.isGroup
      ? await e.group?.getChatHistory?.(seq, 1)
      : await e.friend?.getChatHistory?.(seq, 1)
    const list = Array.isArray(history) ? history : history?.messages || history?.data?.messages || []
    reply = list.at?.(-1)?.message
  }

  if (!reply) return { text, imageContents }

  const quotedTexts = []
  for (const rawVal of reply) {
    const val = normalizeSegment(rawVal)
    if (val.type === 'image' && handleReplyImage && val.url) {
      try {
        const compressed = await fetchAndCompressImage(val.url, {
          timeoutMs: 15000,
          retries: 1,
          imageCompress
        })
        imageContents.push({
          type: 'image',
          image: compressed.buffer.toString('base64'),
          mimeType: compressed.mimeType
        })
      } catch (err) {
        logger.warn(`fetch reply image failed: ${err.message}`)
      }
    } else if (val.type === 'text' && handleReplyText && val.text) {
      quotedTexts.push(val.text)
    } else if (val.type === 'file' && handleReplyFile) {
      let fileUrl = '获取失败'
      try {
        if (e.group?.getFileUrl) {
          fileUrl = await e.group.getFileUrl(val.fid)
        } else if (e.friend?.getFileUrl) {
          fileUrl = await e.friend.getFileUrl(val.fid)
        }
      } catch {}
      const fileName = val.name || val.file || '未知文件'
      text += `本条消息对一个文件进行了引用回复：${fileName}，下载地址为${fileUrl}\n\n本条消息内容：\n`
    }
  }

  if (quotedTexts.length > 0) {
    text = `本条消息对以下消息进行了引用回复：${quotedTexts.join(' ')}\n\n本条消息内容：\n`
  }

  return { text, imageContents }
}

/**
 * 将e中的消息转换为chaite的UserMessage
 *
 * @param e
 * @param {{
 *   handleReplyText: boolean,
 *   handleReplyImage: boolean,
 *   handleReplyFile: boolean,
 *   useRawMessage: boolean,
 *   handleAtMsg: boolean,
 *   excludeAtBot: boolean,
 *   toggleMode: 'at' | 'prefix',
 *   togglePrefix: string,
 *   imageCompress: { enable: boolean, maxLongEdge: number, quality: number, maxFileSizeKB: number }
 * }} options
 * @returns {Promise<import('chaite').UserMessage>}
 */
export async function intoUserMessage (e, options = {}) {
  const {
    handleReplyText = false,
    handleReplyImage = true,
    handleReplyFile = true,
    useRawMessage = false,
    handleAtMsg = true,
    excludeAtBot = false,
    toggleMode = 'at',
    togglePrefix = null,
    imageCompress = { enable: true, maxLongEdge: 1536, quality: 85, maxFileSizeKB: 2048 }
  } = options
  const contents = []
  let text = ''

  // 处理引用回复
  const { text: replyText, imageContents: replyImages } = await _extractReplyContext(e, {
    handleReplyText,
    handleReplyImage,
    handleReplyFile,
    imageCompress
  })
  if (replyText) text += replyText
  contents.push(...replyImages)

  // 构建消息文本
  if (useRawMessage) {
    text += formatRawMessage(e.raw_message, { includeReply: true })
  } else {
    for (const rawVal of e.message || []) {
      const val = normalizeSegment(rawVal)
      switch (val.type) {
        case 'at': {
          if (handleAtMsg) {
            const { qq, text: atCard } = val
            if ((toggleMode === 'at' || excludeAtBot) && String(qq) === getSelfId(e)) {
              break
            }
            text += ` @${atCard || qq} `
          }
          break
        }
        case 'text': {
          text += val.text
          break
        }
        default: {
          // 图片/表情/视频/文件等 → AI 可读格式
          text += ` ${formatOneBotSegmentText(val)} `
        }
      }
    }
  }

  // 处理图片（使用共享的 fetchAndCompressImage）
  for (const element of (e.message || []).map(normalizeSegment).filter(el => el.type === 'image')) {
    if (!element.url) continue
    try {
      const compressed = await fetchAndCompressImage(element.url, {
        timeoutMs: 15000,
        retries: 1,
        imageCompress
      })
      contents.push({
        type: 'image',
        image: compressed.buffer.toString('base64'),
        mimeType: compressed.mimeType
      })
    } catch (err) {
      logger.warn(`fetch image failed: ${err.message}`)
    }
  }

  if (toggleMode === 'prefix' && togglePrefix) {
    // 去掉触发前缀：#前缀 / 图片前缀 / 前缀 三种形式
    const escaped = togglePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`^#?(图片)?${escaped}\\s*`)
    text = text.replace(regex, '').trimStart()
  }
  if (text) {
    // 群聊消息标注发送者，让 AI 知道在跟谁说话
    if (e.isGroup && e.sender) {
      const senderName = e.sender.card || e.sender.nickname || e.sender.user_id || ''
      if (senderName) {
        text = `[发送者: ${senderName}]\n${text}`
      }
    }
    contents.push({
      type: 'text',
      text
    })
  }
  return {
    role: 'user',
    content: contents
  }
}

/**
 * 找到本次对话使用的预设
 * @param e
 * @param {string} presetId
 * @param {'at' | 'prefix'} toggleMode
 * @param {string} togglePrefix
 * @returns {Promise<import('chaite').ChatPreset | null>}
 */
export async function getPreset (e, presetId, toggleMode, togglePrefix) {
  const isValidChat = checkChatMsg(e, toggleMode, togglePrefix)
  const engine = getEngine()
  if (!engine) return null
  const presets = await engine.listPresets() || []
  const prefixHitPresets = presets.filter(p => e.msg?.startsWith(p.prefix))
  if (!isValidChat && prefixHitPresets.length === 0) {
    return null
  }
  let preset
  if (!isValidChat) {
    if (prefixHitPresets.length > 1) {
      preset = prefixHitPresets.sort((a, b) => (b.prefix?.length || 0) - (a.prefix?.length || 0))[0]
    } else {
      preset = prefixHitPresets[0]
    }
  } else {
    preset = await engine.getPreset(presetId)
  }
  if (!preset) {
    preset = await engine.getPreset(presetId)
  }
  return preset
}

/**
 *
 * @param e
 * @param {'at' | 'prefix'} toggleMode
 * @param {string} togglePrefix
 * @returns {boolean}
 */
export function checkChatMsg (e, toggleMode, togglePrefix) {
  if (toggleMode === 'at' && (e.atBot || e.isPrivate)) {
    return true
  }
  if (!togglePrefix) return false
  const escaped = togglePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const prefixReg = new RegExp(`^#?(图片)?${escaped}`)
  if (toggleMode === 'prefix' && prefixReg.test(e.msg)) {
    return true
  }
  return false
}

/**
 * 移除模型回复中的 CQ 码，防止 [CQ:image,file=xxx] 等被当作纯文本输出
 */
function stripCQCodes (text) {
  if (!text || typeof text !== 'string') return text || ''
  return text.replace(/\[CQ:[^\]]+\]/gi, '').trim()
}

/**
 * 将 CQ 消息段转为 AI 可读的文本描述
 * NapCat/OneBot 原始 CQ 码如 [CQ:image,...] 对 AI 无意义，
 * 需转为自然语言描述后再传给模型
 *
 * @param {object} segment - 消息段 { type, ... }
 * @returns {string} AI 可读的文本
 */
export function formatSegmentToText (segment) {
  return formatOneBotSegmentText(segment)
}

/**
 * 模型响应转为机器人格式
 * @param e
 * @param {import('chaite').MessageContent[]} contents
 * @returns {Promise<{ msgs: (import('icqq').TextElem | import('icqq').ImageElem | import('icqq').AtElem | import('icqq').PttElem | string)[], forward: *[]}>}
 */
export async function toYunzai (e, contents) {
  const msgs = []
  /**
   * 要转发的
   * @type {*[]}
   */
  const forward = []
  for (let content of contents) {
    switch (content.type) {
      case 'text': {
        const txt = (/** @type {import('chaite').TextContent} **/ content).text?.trim() || ''
        const cleaned = stripCQCodes(txt)
        if (cleaned) {
          msgs.push(cleaned)
        }
        break
      }
      case 'image': {
        const imageContent = (/** @type {import('chaite').ImageContent} **/ content).image
        if (imageContent.startsWith('http')) {
          msgs.push(makeImageSegment(imageContent))
        } else if (imageContent.startsWith('base64://')) {
          msgs.push(makeImageSegment(imageContent))
        } else {
          msgs.push(makeImageSegment(`base64://${imageContent}`))
        }
        break
      }
      case 'audio': {
        msgs.push(makeRecordSegment((/** @type {import('chaite').AudioContent} **/ content).data))
        break
      }
      case 'reasoning': {
        const reasoning = await makeForwardMsg(e, [(/** @type {import('chaite').ReasoningContent} **/ content).text], '思考过程')
        forward.push(reasoning)
        break
      }
      default: {
        logger.warn(`不支持的类型 ${content.type}`)
      }
    }
  }
  if (forward.length > 1) {
    const newForward = [await makeForwardMsg(e, forward, '多次思考过程')]
    return {
      msgs: msgs.filter(i => !!i), newForward
    }
  }
  return {
    msgs: msgs.filter(i => !!i), forward
  }
}
