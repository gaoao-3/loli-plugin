/**
 * B 站视频发送工具。
 *
 * 只接受 B 站视频 ID/链接，使用 B 站公开接口取得视频信息和 MP4 地址，
 * 下载到临时目录后通过当前 QQ 事件回发视频。工具不支持主动指定其他会话，
 * 避免模型把视频误发到错误的群或私聊。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CustomTool } from '../../core/index.js'
import { makeImageSegment } from '../bot.js'

const BILIBILI_API = 'https://api.bilibili.com'
const DEFAULT_API_TIMEOUT_MS = 15000
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120000
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024
const DEFAULT_QUALITY = 64
const ALLOWED_QUALITIES = new Set([16, 32, 64])
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'

function requestHeaders () {
  return {
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://www.bilibili.com/',
    'User-Agent': USER_AGENT
  }
}

function responseHeader (response, name) {
  if (typeof response?.headers?.get === 'function') return response.headers.get(name) || ''
  return response?.headers?.[name] || response?.headers?.[name.toLowerCase()] || ''
}

function httpError (response, fallback = '请求失败') {
  const status = Number(response?.status)
  return new Error(`${fallback}: HTTP ${Number.isFinite(status) ? status : '未知'}`)
}

function resolveFetch (fetchImpl) {
  const resolved = fetchImpl || globalThis.fetch
  if (typeof resolved !== 'function') throw new Error('当前 Node 环境没有可用的 fetch')
  return resolved
}

async function fetchJson (url, { fetchImpl, timeoutMs = DEFAULT_API_TIMEOUT_MS } = {}) {
  const fetchFn = resolveFetch(fetchImpl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchFn(url, {
      headers: requestHeaders(),
      signal: controller.signal
    })
    if (!response || response.ok === false) throw httpError(response, 'B 站接口请求失败')

    let body
    try {
      body = await response.json()
    } catch {
      throw new Error('B 站接口返回了无法解析的 JSON')
    }
    if (Number(body?.code) !== 0) {
      throw new Error(body?.message || body?.msg || 'B 站接口返回错误')
    }
    return body.data
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('B 站接口请求超时')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 解析 BV/AV 号或 B 站视频链接。
 * @returns {{ type: 'bvid'|'aid', id: string }}
 */
export function normalizeBiliVideoId (value) {
  const raw = String(value ?? '').trim()
  if (!raw) throw new Error('请提供 BV 号、AV 号或 B 站视频链接')

  const match = raw.match(/(?:^|[\/\s])((?:BV[0-9A-Za-z]{10})|(?:av\d+))(?=$|[/?#\s"'”’）)])/iu)
  if (!match) throw new Error('视频 ID 无效，请提供类似 BV1xx411c7mD 或 av123456 的 B 站视频 ID')

  const token = match[1]
  if (/^bv/iu.test(token)) return { type: 'bvid', id: `BV${token.slice(2)}` }
  return { type: 'aid', id: token.replace(/^av/iu, '') }
}

function normalizePage (value) {
  const page = Number.parseInt(value, 10)
  return Number.isInteger(page) ? Math.max(1, Math.min(100, page)) : 1
}

function normalizeQuality (value) {
  const quality = Number.parseInt(value, 10)
  return ALLOWED_QUALITIES.has(quality) ? quality : DEFAULT_QUALITY
}

function formatCount (value) {
  const count = Number(value) || 0
  if (count >= 100000000) return `${(count / 100000000).toFixed(1)}亿`
  if (count >= 10000) return `${(count / 10000).toFixed(1)}万`
  return String(count)
}

function formatDuration (value) {
  const seconds = Math.max(0, Number.parseInt(value, 10) || 0)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')
  const rest = (seconds % 60).toString().padStart(2, '0')
  return hours > 0 ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`
}

function formatDate (timestamp) {
  const value = Number(timestamp)
  if (!Number.isFinite(value) || value <= 0) return ''
  return new Date(value * 1000).toLocaleString('zh-CN', { hour12: false })
}

function truncateText (value, maxLength = 180) {
  const text = String(value || '').replace(/\s+/gu, ' ').trim()
  if (!text) return '暂无简介'
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

function normalizeImageUrl (value) {
  const url = String(value || '').trim()
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('http://')) return `https://${url.slice('http://'.length)}`
  return /^https?:\/\//iu.test(url) ? url : ''
}

function normalizeStats (stat = {}) {
  return {
    view: formatCount(stat.view),
    danmaku: formatCount(stat.danmaku),
    reply: formatCount(stat.reply),
    favorite: formatCount(stat.favorite),
    coin: formatCount(stat.coin),
    share: formatCount(stat.share),
    like: formatCount(stat.like)
  }
}

/**
 * 获取视频元数据和可下载的普通 MP4 分段。
 */
export async function fetchBiliVideo (value, options = {}) {
  const parsed = typeof value === 'object' && value?.type && value?.id
    ? value
    : normalizeBiliVideoId(value)
  const page = normalizePage(options.page)
  const quality = normalizeQuality(options.quality)
  const query = new URLSearchParams({ [parsed.type === 'bvid' ? 'bvid' : 'aid']: parsed.id })
  const detail = await fetchJson(`${BILIBILI_API}/x/web-interface/view?${query}`, options)
  const pages = Array.isArray(detail?.pages) ? detail.pages : []
  const pageInfo = pages[page - 1] || (page === 1 ? detail : null)
  const cid = pageInfo?.cid
  if (!cid) throw new Error(`视频没有找到第 ${page} 个分 P`)

  const playQuery = new URLSearchParams({
    cid: String(cid),
    fnval: '1',
    fnver: '0',
    fourk: '0',
    qn: String(quality)
  })
  if (detail?.bvid) playQuery.set('bvid', detail.bvid)
  else if (parsed.type === 'bvid') playQuery.set('bvid', parsed.id)
  else playQuery.set('avid', parsed.id)

  const play = await fetchJson(`${BILIBILI_API}/x/player/playurl?${playQuery}`, options)
  const segments = (Array.isArray(play?.durl) ? play.durl : [])
    .filter(item => item?.url)
    .sort((left, right) => (Number(left.order) || 0) - (Number(right.order) || 0))
    .map(item => ({
      url: item.url,
      backupUrls: Array.isArray(item.backup_url) ? item.backup_url.filter(Boolean) : [],
      size: Number(item.size) || 0
    }))
  if (segments.length === 0) {
    throw new Error('B 站没有返回可下载的 MP4 地址，可能是大会员、付费或 DASH 视频')
  }

  const bvid = String(detail?.bvid || (parsed.type === 'bvid' ? parsed.id : '')).trim()
  const title = String(detail?.title || bvid || parsed.id).trim()
  const owner = detail?.owner || {}
  const stats = normalizeStats(detail?.stat)
  const pageTitle = pageInfo?.part && pages.length > 1 ? ` · ${pageInfo.part}` : ''
  const totalSize = segments.reduce((sum, item) => sum + item.size, 0)

  return {
    bvid,
    title: `${title}${pageTitle}`,
    author: String(owner.name || '未知 UP 主'),
    category: String(detail?.tname || '未分类'),
    duration: formatDuration(pageInfo?.duration ?? detail?.duration),
    publishedAt: formatDate(detail?.pubdate),
    description: String(detail?.desc || ''),
    cover: normalizeImageUrl(detail?.pic),
    stats,
    link: bvid ? `https://www.bilibili.com/video/${bvid}${page > 1 ? `?p=${page}` : ''}` : '',
    quality: Number(play?.quality) || quality,
    format: String(play?.format || 'mp4'),
    segments,
    size: totalSize
  }
}

function formatBytes (bytes) {
  const value = Number(bytes) || 0
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`
  return `${(value / 1024 / 1024).toFixed(2)} MiB`
}

function writeChunk (handle, chunk, position, maxBytes) {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
  if (position + buffer.length > maxBytes) {
    throw new Error(`视频超过 ${formatBytes(maxBytes)} 大小限制`)
  }
  return handle.write(buffer, 0, buffer.length, position).then(() => buffer.length)
}

async function writeResponseBody (response, handle, position, maxBytes) {
  const length = Number(responseHeader(response, 'content-length'))
  if (Number.isFinite(length) && length > 0 && position + length > maxBytes) {
    throw new Error(`视频超过 ${formatBytes(maxBytes)} 大小限制`)
  }

  let written = 0
  const write = async chunk => {
    const size = await writeChunk(handle, chunk, position + written, maxBytes)
    written += size
  }

  const reader = response?.body?.getReader?.()
  if (reader) {
    try {
      while (true) {
        const item = await reader.read()
        if (item.done) break
        await write(item.value)
      }
    } finally {
      reader.releaseLock?.()
    }
    return written
  }

  if (response?.body && typeof response.body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of response.body) await write(chunk)
    return written
  }

  await write(Buffer.from(await response.arrayBuffer()))
  return written
}

async function downloadSegment (segment, handle, position, options) {
  const fetchFn = resolveFetch(options.fetchImpl)
  const urls = [segment.url, ...segment.backupUrls].filter(Boolean)
  let lastError = null

  for (const url of urls) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs)
    try {
      const response = await fetchFn(url, {
        headers: requestHeaders(),
        signal: controller.signal
      })
      if (!response || response.ok === false) throw httpError(response, 'B 站视频下载失败')
      return await writeResponseBody(response, handle, position, options.maxBytes)
    } catch (error) {
      lastError = error?.name === 'AbortError' ? new Error('B 站视频下载超时') : error
      await handle.truncate(position)
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError || new Error('B 站没有可用的视频下载地址')
}

/**
 * 流式下载视频，支持 B 站返回的多个 durl 分段和备用地址。
 */
export async function downloadBiliVideo (segments, destination, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : DEFAULT_MAX_BYTES
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_DOWNLOAD_TIMEOUT_MS
  const list = Array.isArray(segments) ? segments : []
  if (!list.length) throw new Error('没有可下载的视频分段')

  const expectedSize = list.reduce((sum, item) => sum + (Number(item?.size) || 0), 0)
  if (expectedSize > maxBytes) throw new Error(`视频大小约 ${formatBytes(expectedSize)}，超过 ${formatBytes(maxBytes)} 限制`)

  const handle = await fs.promises.open(destination, 'w')
  let total = 0
  try {
    for (const segment of list) {
      total += await downloadSegment(segment, handle, total, { ...options, maxBytes, timeoutMs })
    }
    return total
  } finally {
    await handle.close()
  }
}

function makeVideoSegment (file) {
  const factory = globalThis.segment?.video
  return typeof factory === 'function' ? factory(file) : { type: 'video', file }
}

function buildInfoMessage (video) {
  const lines = [
    `📺 ${video.title}`,
    '━━━━━━━━━━━━━━',
    `👤 ${video.author}｜${video.category}｜⏱️ ${video.duration}`,
    video.publishedAt ? `📅 ${video.publishedAt}` : '',
    `🔥 播放 ${video.stats.view}｜💬 弹幕 ${video.stats.danmaku}｜👍 点赞 ${video.stats.like}`,
    `⭐ 收藏 ${video.stats.favorite}｜🪙 硬币 ${video.stats.coin}｜🔄 分享 ${video.stats.share}`,
    `📝 ${truncateText(video.description)}`,
    video.link ? `🔗 ${video.link}` : '',
    '🚀 视频提取中，请稍候…'
  ]
  return lines.filter(Boolean).join('\n')
}

/**
 * 执行 B 站视频发送，单独导出便于不依赖 ToolLoader 做测试。
 */
export async function sendBiliVideo (args = {}, context = {}, options = {}) {
  const event = context?.event
  if (typeof event?.reply !== 'function') throw new Error('当前调用没有可回发视频的 QQ 会话')

  const rawId = args.videoId ?? args.video_id ?? args.bvid ?? args.id
  const parsed = normalizeBiliVideoId(rawId)
  const video = await fetchBiliVideo(parsed, {
    fetchImpl: options.fetchImpl,
    page: args.page,
    quality: args.quality,
    timeoutMs: options.apiTimeoutMs
  })
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : DEFAULT_MAX_BYTES
  if (video.size > maxBytes) {
    throw new Error(`视频大小约 ${formatBytes(video.size)}，超过 ${formatBytes(maxBytes)} 限制，请直接打开链接观看：${video.link}`)
  }

  const tempRoot = options.tempRoot || os.tmpdir()
  const tempDir = await fs.promises.mkdtemp(path.join(tempRoot, 'loli-bili-'))
  const destination = path.join(tempDir, `${video.bvid || parsed.id}.mp4`)
  try {
    const infoMessage = video.cover
      ? [makeImageSegment(video.cover), buildInfoMessage(video)]
      : buildInfoMessage(video)
    await event.reply(infoMessage)

    const downloadedBytes = await downloadBiliVideo(video.segments, destination, {
      fetchImpl: options.fetchImpl,
      maxBytes,
      timeoutMs: options.downloadTimeoutMs
    })
    await event.reply(makeVideoSegment(destination))
    return `✅ 已发送 B 站视频：${video.title}（${formatBytes(downloadedBytes)}）`
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
}

class SendBiliVideo extends CustomTool {
  name = 'send_bili_video'

  function = {
    name: 'send_bili_video',
    description: '发送 B 站视频到当前 QQ 会话。支持 BV/AV 号或 B 站视频链接；通常先调用 bili_search，再把用户选中的视频 ID 传给本工具。仅处理公开可下载且不超过 100 MiB 的视频。',
    parameters: {
      type: 'object',
      properties: {
        videoId: {
          type: 'string',
          description: '视频 ID 或链接，例如 BV1xx411c7mD、av123456 或 https://www.bilibili.com/video/BV...'
        },
        page: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: '多 P 视频要发送的分 P，从 1 开始，默认 1'
        },
        quality: {
          type: 'integer',
          enum: [16, 32, 64],
          description: '视频清晰度：16=360P、32=480P、64=720P，默认 64；B 站可能按账号权限自动降级'
        }
      },
      required: ['videoId']
    }
  }

  async run (args, context) {
    try {
      return await sendBiliVideo(args, context)
    } catch (error) {
      console.error('[send_bili_video]', error)
      return `发送 B 站视频失败：${error?.message || error}`
    }
  }
}

export default new SendBiliVideo()
