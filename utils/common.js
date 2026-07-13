import * as crypto from 'node:crypto'
import fetch from 'node-fetch'
import { Jimp } from 'jimp'

export function md5 (str) {
  return crypto.createHash('md5').update(str).digest('hex')
}

function escapeRegExp (value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeEntityText (text) {
  if (typeof text !== 'string') return ''
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#44;/g, ',')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function parseCQParams (raw = '') {
  const params = {}
  const body = raw.startsWith(',') ? raw.slice(1) : raw
  if (!body) return params

  for (const pair of body.split(',')) {
    const index = pair.indexOf('=')
    if (index === -1) continue
    const key = pair.slice(0, index)
    const value = pair.slice(index + 1)
    params[key] = decodeEntityText(value)
  }
  return params
}

function pickFirstText (value, maxLength = 80) {
  if (!value) return ''
  if (typeof value === 'string') {
    const normalized = decodeEntityText(value).replace(/\s+/g, ' ').trim()
    if (!normalized) return ''
    return normalized.length > maxLength ? normalized.slice(0, maxLength) + '...' : normalized
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = pickFirstText(item, maxLength)
      if (picked) return picked
    }
    return ''
  }
  if (typeof value === 'object') {
    for (const key of ['title', 'desc', 'text', 'content', 'brief', 'prompt', 'summary', 'name']) {
      const picked = pickFirstText(value[key], maxLength)
      if (picked) return picked
    }
    for (const nested of Object.values(value)) {
      const picked = pickFirstText(nested, maxLength)
      if (picked) return picked
    }
  }
  return ''
}

function summarizeJsonPayload (payload) {
  if (typeof payload !== 'string' || !payload.trim()) return '[JSON消息]'
  try {
    const parsed = JSON.parse(payload)
    const title = pickFirstText(parsed?.meta?.detail_1?.title || parsed?.meta?.news?.title || parsed?.meta?.music?.title || parsed?.prompt || parsed?.title)
    const desc = pickFirstText(parsed?.meta?.detail_1?.desc || parsed?.meta?.news?.desc || parsed?.desc || parsed?.text || parsed?.summary)
    if (title && desc && desc !== title) return `[JSON消息: ${title} - ${desc}]`
    if (title) return `[JSON消息: ${title}]`
    if (desc) return `[JSON消息: ${desc}]`
  } catch {}
  return '[JSON消息]'
}

function summarizeXmlPayload (payload) {
  if (typeof payload !== 'string' || !payload.trim()) return '[XML消息]'
  const titleMatch = payload.match(/<(?:title|brief)>([\s\S]*?)<\/(?:title|brief)>/i)
  const descMatch = payload.match(/<(?:summary|des|desc|content)>([\s\S]*?)<\/(?:summary|des|desc|content)>/i)
  const title = pickFirstText(titleMatch?.[1])
  const desc = pickFirstText(descMatch?.[1])
  if (title && desc && desc !== title) return `[XML消息: ${title} - ${desc}]`
  if (title) return `[XML消息: ${title}]`
  if (desc) return `[XML消息: ${desc}]`
  return '[XML消息]'
}

function summarizeForwardSegment (segment) {
  const content = segment?.content ?? segment?.data?.content
  const name = segment?.name ?? segment?.data?.name ?? segment?.nickname ?? segment?.data?.nickname
  if (Array.isArray(content)) {
    const preview = content
      .slice(0, 2)
      .map(item => formatOneBotSegmentText(item))
      .filter(Boolean)
      .join(' ')
    if (name && preview) return `[合并转发: ${name} ${preview}]`
    if (preview) return `[合并转发: ${preview}]`
  }
  if (typeof content === 'string') {
    const preview = formatRawMessage(content, { includeReply: false })
    if (name && preview) return `[合并转发: ${name} ${preview}]`
    if (preview) return `[合并转发: ${preview}]`
  }
  return '[合并转发]'
}

function buildSegmentTextMap (segment = {}, options = {}) {
  const type = segment?.type || 'unknown'
  const data = segment?.data && typeof segment.data === 'object' ? segment.data : segment
  const replyPlaceholder = options.includeReply === false ? '' : '[回复引用]'

  switch (type) {
    case 'text':
      return data.text || ''
    case 'at': {
      const qq = data.qq || data.id
      const name = data.text || data.name || qq
      return qq === 'all' || qq === 'everyone' ? '@全体成员' : `@${name || '未知'}`
    }
    case 'image': {
      const summary = pickFirstText(data.summary || data.file || data.url)
      return summary ? `[图片: ${summary}]` : '[图片]'
    }
    case 'face':
    case 'mface':
    case 'marketface':
      return '[表情]'
    case 'reply':
      return replyPlaceholder
    case 'video':
      return '[视频]'
    case 'record':
    case 'audio':
      return '[语音]'
    case 'file': {
      const name = data.name || data.file || ''
      return name ? `[文件: ${name}]` : '[文件]'
    }
    case 'share': {
      const title = pickFirstText(data.title || data.content || data.url)
      return title ? `[分享链接: ${title}]` : '[分享链接]'
    }
    case 'location': {
      const loc = pickFirstText(data.title || data.content || data.address)
      return loc ? `[位置: ${loc}]` : '[位置]'
    }
    case 'json':
      return summarizeJsonPayload(data.data || data.json || '')
    case 'xml':
      return summarizeXmlPayload(data.data || data.xml || '')
    case 'markdown': {
      const text = pickFirstText(data.content || data.markdown || data.text)
      return text ? `[Markdown消息: ${text}]` : '[Markdown消息]'
    }
    case 'poke':
      return '[戳一戳]'
    case 'redbag':
      return '[红包]'
    case 'contact': {
      const name = pickFirstText(data.nickname || data.name || data.id)
      return name ? `[推荐联系人: ${name}]` : '[推荐联系人]'
    }
    case 'dice':
      return '[骰子]'
    case 'rps':
      return '[猜拳]'
    case 'music': {
      const title = pickFirstText(data.title || data.song || data.url)
      return title ? `[音乐分享: ${title}]` : '[音乐分享]'
    }
    case 'node':
    case 'forward':
      return summarizeForwardSegment(data)
    case 'anonymous':
      return '[匿名消息]'
    case 'gift':
      return '[礼物]'
    case 'mirai':
      return '[Mirai消息]'
    case 'lightapp':
      return '[轻应用消息]'
    case 'tts':
      return '[语音合成]'
    default:
      return `[${type || '未知消息'}]`
  }
}

/**
 * 将 OneBot v11 消息段转换为可读文本
 * @param {object} segment
 * @param {{ includeReply?: boolean }} [options]
 * @returns {string}
 */
export function formatOneBotSegmentText (segment, options = {}) {
  return buildSegmentTextMap(segment, options)
}

/**
 * 将 raw_message 中的 CQ 码转换为可读文本
 * @param {string} raw
 * @param {{ includeReply?: boolean }} [options]
 * @returns {string}
 */
export function formatRawMessage (raw, options = {}) {
  if (!raw || typeof raw !== 'string') return raw || ''

  const parts = []
  const pattern = /\[CQ:([a-zA-Z0-9_]+)((?:,[^\]]*)?)\]/g
  let lastIndex = 0
  let match

  while ((match = pattern.exec(raw)) !== null) {
    const plain = raw.slice(lastIndex, match.index)
    if (plain) parts.push(decodeEntityText(plain))

    const [, type, paramRaw] = match
    const text = formatOneBotSegmentText({ type, ...parseCQParams(paramRaw) }, options)
    if (text) parts.push(text)
    lastIndex = pattern.lastIndex
  }

  if (lastIndex < raw.length) {
    parts.push(decodeEntityText(raw.slice(lastIndex)))
  }

  return parts.join('').replace(/\s+/g, ' ').trim()
}

/**
 * 稳健模板替换，仅替换模板中的 ${...} 占位符
 * @param {string} template
 * @param {Record<string, string|number|boolean|null|undefined>} vars
 * @returns {string}
 */
export function renderTemplate (template, vars = {}) {
  if (!template) return ''
  return template.replace(/\$\{([^}]+)\}/g, (match, key) => {
    const direct = vars[match]
    const byKey = vars[key]
    const value = direct ?? byKey
    return value === undefined || value === null || value === '' ? '-' : String(value)
  })
}

/**
 * 将图片 Buffer 压缩到合理大小
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {{
 *   enable?: boolean,
 *   maxLongEdge?: number,
 *   quality?: number,
 *   maxFileSizeKB?: number
 * }} options
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 */
export async function compressImage (buffer, mimeType, options = {}) {
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

    if (width > maxLongEdge || height > maxLongEdge) {
      image.scaleToFit({ w: maxLongEdge, h: maxLongEdge })
    }

    let outputBuffer = await image.getBuffer('image/jpeg', { quality })
    let outputMimeType = 'image/jpeg'
    const maxBytes = maxFileSizeKB * 1024
    let currentQuality = quality

    while (outputBuffer.length > maxBytes && currentQuality > 30) {
      currentQuality -= 10
      outputBuffer = await image.getBuffer('image/jpeg', { quality: currentQuality })
    }

    if (outputBuffer.length >= buffer.length) {
      return { buffer, mimeType }
    }

    return { buffer: outputBuffer, mimeType: outputMimeType }
  } catch (err) {
    logger.warn?.('[loli] 图片压缩失败，使用原图', err.message)
    return { buffer, mimeType }
  }
}

/**
 * 获取并压缩图片，带超时与重试
 * @param {string} url
 * @param {{
 *   timeoutMs?: number,
 *   retries?: number,
 *   retryDelayMs?: number,
 *   imageCompress?: { enable?: boolean, maxLongEdge?: number, quality?: number, maxFileSizeKB?: number }
 * }} options
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 */
export async function fetchAndCompressImage (url, options = {}) {
  const {
    timeoutMs = 15000,
    retries = 2,
    retryDelayMs = 500,
    imageCompress = {}
  } = options

  let lastError

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const mimeType = res.headers.get('content-type') || 'image/jpeg'
      const rawBuffer = Buffer.from(await res.arrayBuffer())
      return await compressImage(rawBuffer, mimeType, imageCompress)
    } catch (err) {
      lastError = err
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)))
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError || new Error(`fetch image failed: ${url}`)
}

/**
 * Converts a timestamp to Beijing time (UTC+8)
 * @param {number|string} timestamp - Timestamp in milliseconds or seconds
 * @param {string} [format='YYYY-MM-DD HH:mm:ss'] - Output format
 * @returns {string} Formatted Beijing time
 */
export function formatTimeToBeiJing (timestamp, format = 'YYYY-MM-DD HH:mm:ss') {
  // Handle string timestamp
  if (typeof timestamp === 'string') {
    timestamp = parseInt(timestamp)
  }

  // Automatically determine if timestamp is in seconds or milliseconds
  // If timestamp represents a date before 2000, assume it's in milliseconds
  if (timestamp.toString().length <= 10) {
    // Convert seconds to milliseconds
    timestamp = timestamp * 1000
  }

  // Create date object with the timestamp
  const date = new Date(timestamp)

  // Calculate Beijing time (UTC+8)
  const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000)

  // Format the date according to the specified format
  return formatDate(beijingTime, format)
}

/**
 * Formats a Date object according to the specified format
 * @param {Date} date - Date object to format
 * @param {string} format - Format string (YYYY-MM-DD HH:mm:ss)
 * @returns {string} Formatted date string
 */
function formatDate (date, format) {
  const year = date.getUTCFullYear()
  const month = padZero(date.getUTCMonth() + 1)
  const day = padZero(date.getUTCDate())
  const hours = padZero(date.getUTCHours())
  const minutes = padZero(date.getUTCMinutes())
  const seconds = padZero(date.getUTCSeconds())

  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds)
}

/**
 * Pads a number with leading zero if needed
 * @param {number} num - Number to pad
 * @returns {string} Padded number string
 */
function padZero (num) {
  return num < 10 ? '0' + num : num.toString()
}

export function generateId () {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 15)
}
