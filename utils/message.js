import common from '../../../lib/common/common.js'
import fetch from 'node-fetch'
import { Jimp } from 'jimp'
import { getEngine } from './state.js'
import { getGroupHistory } from './group.js'

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

/**
 * 将图片 Buffer 压缩到合理大小，用于多模态输入
 *
 * @param {Buffer} buffer 原始图片数据
 * @param {string} mimeType 原始 MIME 类型
 * @param {{
 *   enable: boolean,
 *   maxLongEdge: number,
 *   quality: number,
 *   maxFileSizeKB: number
 * }} options 压缩选项
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 */
async function compressImage (buffer, mimeType, options = {}) {
  const {
    enable = true,
    maxLongEdge = 1536,
    quality = 85,
    maxFileSizeKB = 2048
  } = options

  if (!enable || !buffer || buffer.length === 0) {
    return { buffer, mimeType }
  }

  try {
    const image = await Jimp.read(buffer)
    const { width, height } = image.bitmap

    // 等比缩放，限制长边
    if (width > maxLongEdge || height > maxLongEdge) {
      image.scaleToFit({ w: maxLongEdge, h: maxLongEdge })
    }

    // 输出为 JPEG 并控制质量
    let outputBuffer = await image.getBuffer('image/jpeg', { quality })
    let outputMimeType = 'image/jpeg'

    // 如果仍超过最大文件大小，逐步降低质量
    const maxBytes = maxFileSizeKB * 1024
    let currentQuality = quality
    while (outputBuffer.length > maxBytes && currentQuality > 30) {
      currentQuality -= 10
      outputBuffer = await image.getBuffer('image/jpeg', { quality: currentQuality })
    }

    // 压缩后反而更大时，保留原图原格式（通常发生在简单色块 PNG 等场景）
    if (outputBuffer.length >= buffer.length) {
      return { buffer, mimeType }
    }

    return { buffer: outputBuffer, mimeType: outputMimeType }
  } catch (err) {
    logger.warn?.('[loli] 图片压缩失败，使用原图:', err.message)
    return { buffer, mimeType }
  }
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
    const selfId = String(e.self_id || e.bot?.uin || '')
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

      for (const seg of chat.message || []) {
        if (images.length >= maxImages) break
        if (seg.type !== 'image' || !seg.url) continue

        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 15000)
          const res = await fetch(seg.url, { signal: controller.signal })
          clearTimeout(timeout)

          if (!res.ok) {
            logger.warn(`[loli] fetch history image failed: HTTP ${res.status}`)
            continue
          }

          const mimeType = res.headers.get('content-type') || 'image/jpeg'
          const rawBuffer = Buffer.from(await res.arrayBuffer())
          const compressed = await compressImage(rawBuffer, mimeType, imageCompress)

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
  if ((e.source || e.reply_id) && (handleReplyImage || handleReplyText || handleReplyFile)) {
    let seq = e.isGroup ? (e.source?.seq || e.reply_id) : (e.source?.time || e.source?.time)
    let reply
    if (e.getReply && typeof e.getReply === 'function') {
      reply = (await e.getReply()).message
    } else {
      reply = e.isGroup
        ? (await e.group.getChatHistory(seq, 1)).pop()?.message
        : (await e.friend.getChatHistory(seq, 1)).pop()?.message
    }
    if (reply) {
      for (let val of reply) {
        if (val.type === 'image' && handleReplyImage) {
          try {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 15000)
            const res = await fetch(val.url, { signal: controller.signal })
            clearTimeout(timeout)
            if (res.ok) {
              const mimeType = res.headers.get('content-type') || 'image/jpeg'
              const rawBuffer = Buffer.from(await res.arrayBuffer())
              const compressed = await compressImage(rawBuffer, mimeType, imageCompress)
              contents.push({
                type: 'image',
                image: compressed.buffer.toString('base64'),
                mimeType: compressed.mimeType
              })
            } else {
              logger.warn(`fetch reply image ${val.url} failed: HTTP ${res.status}`)
            }
          } catch (err) {
            logger.warn(`fetch reply image ${val.url} failed: ${err.message}`)
          }
        } else if (val.type === 'text' && handleReplyText) {
          text = `本条消息对以下消息进行了引用回复：${val.text}\n\n本条消息内容：\n`
        } else if (val.type === 'file' && handleReplyFile) {
          let fileUrl = '获取失败'
          if (e.group?.getFileUrl) {
            fileUrl = await e.group.getFileUrl(val.fid)
          } else if (e.friend?.getFileUrl) {
            fileUrl = await e.friend.getFileUrl(val.fid)
          }
          text = `本条消息对一个文件进行了引用回复：该文件的下载地址为${fileUrl}\n\n本条消息内容：\n`
        }
      }
    }
  }
  if (useRawMessage) {
    text += formatRawCQMessage(e.raw_message)
  } else {
    for (let val of e.message) {
      switch (val.type) {
        case 'at': {
          if (handleAtMsg) {
            const { qq, text: atCard } = val
            if ((toggleMode === 'at' || excludeAtBot) && qq === e.bot?.uin) {
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
          text += ` ${formatSegmentToText(val)} `
        }
      }
    }
  }
  for (let element of e.message?.filter(element => element.type === 'image')) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      const res = await fetch(element.url, { signal: controller.signal })
      clearTimeout(timeout)
      if (res.ok) {
        const mimeType = res.headers.get('content-type') || 'image/jpeg'
        const rawBuffer = Buffer.from(await res.arrayBuffer())
        const compressed = await compressImage(rawBuffer, mimeType, imageCompress)
        contents.push({
          type: 'image',
          image: compressed.buffer.toString('base64'),
          mimeType: compressed.mimeType
        })
      } else {
        logger.warn(`fetch image ${element.url} failed: HTTP ${res.status}`)
      }
    } catch (err) {
      logger.warn(`fetch image ${element.url} failed: ${err.message}`)
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
 * 将 raw_message 中的 CQ 码转为 AI 可读格式
 * [CQ:image,file=xxx] → [图片]
 * [CQ:face,id=178] → [表情]
 * @param {string} raw - e.raw_message
 * @returns {string}
 */
function formatRawCQMessage (raw) {
  if (!raw || typeof raw !== 'string') return raw || ''
  return raw
    .replace(/\[CQ:image,[^\]]+\]/gi, '[图片]')
    .replace(/\[CQ:face,[^\]]+\]/gi, '[表情]')
    .replace(/\[CQ:reply,[^\]]+\]/gi, '[回复引用]')
    .replace(/\[CQ:video,[^\]]+\]/gi, '[视频]')
    .replace(/\[CQ:record,[^\]]+\]/gi, '[语音]')
    .replace(/\[CQ:file,[^\]]+\]/gi, '[文件]')
    .replace(/\[CQ:share,[^\]]+\]/gi, '[分享链接]')
    .replace(/\[CQ:location,[^\]]+\]/gi, '[位置]')
    .replace(/\[CQ:json,[^\]]+\]/gi, '[JSON消息]')
    .replace(/\[CQ:xml,[^\]]+\]/gi, '[XML消息]')
    .replace(/\[CQ:poke,[^\]]+\]/gi, '[戳一戳]')
    .replace(/\[CQ:redbag,[^\]]+\]/gi, '[红包]')
    .replace(/\[CQ:contact,[^\]]+\]/gi, '[推荐联系人]')
    .replace(/\[CQ:dice,[^\]]+\]/gi, '[骰子]')
    .replace(/\[CQ:rps,[^\]]+\]/gi, '[猜拳]')
    .replace(/\[CQ:music,[^\]]+\]/gi, '[音乐分享]')
    .replace(/\[CQ:node,[^\]]+\]/gi, '[合并转发]')
    .replace(/\[CQ:markdown,[^\]]+\]/gi, '[Markdown消息]')
    // 兜底：剩余的 CQ 码 → 提取类型名
    .replace(/\[CQ:(\w+),[^\]]*\]/gi, '[$1]')
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
  switch (segment.type) {
    case 'image':
      return '[图片]'
    case 'face':
      // QQ 表情
      return '[表情]'
    case 'reply':
      return '[回复引用]'
    case 'video':
      return '[视频]'
    case 'record':
    case 'audio':
      return '[语音]'
    case 'file': {
      const name = segment.name || segment.file || ''
      return name ? `[文件: ${name}]` : '[文件]'
    }
    case 'share': {
      const title = segment.title || ''
      return title ? `[分享链接: ${title}]` : '[分享链接]'
    }
    case 'location': {
      const loc = segment.title || segment.content || ''
      return loc ? `[位置: ${loc}]` : '[位置]'
    }
    case 'json':
      return '[JSON消息]'
    case 'xml':
      return '[XML消息]'
    case 'markdown':
      return '[Markdown消息]'
    case 'poke':
      // 戳一戳
      return '[戳一戳]'
    case 'redbag':
      return '[红包]'
    case 'contact':
      return '[推荐联系人]'
    case 'dice':
      return '[骰子]'
    case 'rps':
      return '[猜拳]'
    case 'music':
      return '[音乐分享]'
    case 'node':
      return '[合并转发]'
    default:
      // 未知类型，保留 type 名作为标注
      return `[${segment.type || '未知消息'}]`
  }
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
          msgs.push(segment.image(imageContent))
        } else if (imageContent.startsWith('base64://')) {
          msgs.push(segment.image(imageContent))
        } else {
          msgs.push(segment.image(`base64://${imageContent}`))
        }
        break
      }
      case 'audio': {
        msgs.push(segment.record((/** @type {import('chaite').AudioContent} **/ content).data))
        break
      }
      case 'reasoning': {
        const reasoning = await common.makeForwardMsg(e, [(/** @type {import('chaite').ReasoningContent} **/ content).text], '思考过程')
        forward.push(reasoning)
        break
      }
      default: {
        logger.warn(`不支持的类型 ${content.type}`)
      }
    }
  }
  if (forward.length > 1) {
    const newForward = [await common.makeForwardMsg(e, forward, '多次思考过程')]
    return {
      msgs: msgs.filter(i => !!i), newForward
    }
  }
  return {
    msgs: msgs.filter(i => !!i), forward
  }
}
