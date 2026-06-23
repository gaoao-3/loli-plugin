import { Chaite } from '@hina114514/chaite'
import common from '../../../lib/common/common.js'
import fetch from 'node-fetch'

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
 *   togglePrefix: string
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
    togglePrefix = null
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
              contents.push({
                type: 'image',
                image: Buffer.from(await res.arrayBuffer()).toString('base64'),
                mimeType
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
        contents.push({
          type: 'image',
          image: Buffer.from(await res.arrayBuffer()).toString('base64'),
          mimeType
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
  const manager = Chaite.getInstance().getChatPresetManager()
  const presets = await manager.getAllPresets()
  const prefixHitPresets = presets.filter(p => e.msg?.startsWith(p.prefix))
  if (!isValidChat && prefixHitPresets.length === 0) {
    return null
  }
  let preset
  // 如果不是at且不满足通用前缀，查看是否满足其他预设
  if (!isValidChat) {
    // 找到其中prefix最长的
    if (prefixHitPresets.length > 1) {
      preset = prefixHitPresets.sort((a, b) => b.prefix.length - a.prefix.length)[0]
    } else {
      preset = prefixHitPresets[0]
    }
  } else {
    // 命中at或通用前缀，直接走用户默认预设
    preset = await manager.getInstance(presetId)
  }
  // 如果没找到再查一次
  if (!preset) {
    preset = await manager.getInstance(presetId)
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
