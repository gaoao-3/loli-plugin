/**
 * run_code — Microsandbox microVM 隔离代码执行工具
 *
 * 代码在本机 Microsandbox microVM 中隔离执行，无法访问机器人本机。
 *
 * QQ 媒体 IO（sandbox.mediaIO，默认开启）：
 * - 当前消息与引用消息中的图片/闪照/视频/语音/文件，在执行前自动下载并写入沙盒 /workspace/inputs/；
 * - 代码写入 /workspace/outputs/ 的产物，执行后自动通过 QQ 回复或文件上传发回。
 *
 * 注意：ToolLoader 以解绑方式调用 run()，逻辑须放在模块级函数中，禁止依赖 this。
 */
import fs from 'fs'
import path from 'path'
import { CustomTool } from '../../core/index.js'
import { getConfig, DATA_DIR } from '../state.js'
import { makeForwardMsg, makeImageSegment, makeRecordSegment, normalizeSegment, sendFileToEvent } from '../bot.js'
import { getGroupHistory } from '../group.js'
import {
  collectEventMessageRefs,
  collectHistoryMessageRefs,
  locateMessageMedia,
  normalizeMessageSelector
} from '../group-message.js'
import { executeCode, LANGUAGES } from '../sandbox.js'

/** 输入媒体限制 */
const MAX_INPUT_ITEMS = 4
const MAX_INPUT_BYTES = 20 * 1024 * 1024
const MAX_INPUT_TOTAL_BYTES = 40 * 1024 * 1024
const MAX_INPUT_CANDIDATES = 20
const RESOURCE_RESOLVE_TIMEOUT_MS = 5000
const RESOURCE_DOWNLOAD_TIMEOUT_MS = 15000
const REPORT_NODE_LENGTH = 800
const REPORT_SECTION_LENGTH = 8000

/** content-type / 消息类型 → 文件扩展名 */
function mediaExt (contentType, fallback) {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase()
  const table = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/amr': 'amr', 'audio/silk': 'silk'
  }
  return table[mime] || fallback || 'bin'
}

function mediaExtFromBytes (bytes, contentType, fallback) {
  if (bytes?.length >= 6) {
    const signature = bytes.subarray(0, 6).toString('ascii')
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'gif'
  }
  if (bytes?.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png'
  }
  if (bytes?.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (bytes?.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'webp'
  }
  return mediaExt(contentType, fallback)
}

function filenameExt (value, fallback = 'bin') {
  const clean = String(value || '').split(/[?#]/u)[0]
  const ext = path.extname(clean).slice(1).toLowerCase()
  return /^[a-z0-9]{1,10}$/u.test(ext) ? ext : fallback
}

/**
 * 校验模型为沙盒输入指定的别名。这里只接受纯文件名，
 * 最终扩展名由已下载资源的真实类型决定。
 */
export function normalizeSandboxInputName (value) {
  const name = String(value || '').trim()
  if (!name) return ''
  if (
    name === '.' ||
    name === '..' ||
    name.startsWith('.') ||
    name.length > 100 ||
    /[\/\\\0]/u.test(name) ||
    !/^[\p{L}\p{N} _.-]+$/u.test(name)
  ) {
    throw new Error('input_name 必须是 1-100 字符的纯文件名，不能包含路径、隐藏文件名或特殊字符')
  }
  const ext = path.posix.extname(name)
  const stem = (ext ? name.slice(0, -ext.length) : name).trim()
  if (!stem || stem === '.' || stem === '..') {
    throw new Error('input_name 缺少有效文件名')
  }
  return stem
}

function originalResourceName (el = {}) {
  const name = String(el.name || '').trim().replace(/\\/gu, '/')
  if (!name) return null
  const basename = path.posix.basename(name)
  return basename && basename !== '.' && basename !== '..' ? basename.slice(0, 255) : null
}

function normalizeResourceFilter (value) {
  return normalizeMessageSelector(value, { maxItems: MAX_INPUT_ITEMS, historyLimit: 30 })
}

function matchesResourceFilter (resource = {}, filter) {
  if (filter.source !== 'auto' && resource.source !== filter.source) return false
  if (filter.senderId && String(resource.senderId || '') !== filter.senderId) return false
  if (filter.senderName) {
    const actual = String(resource.senderName || '').toLocaleLowerCase()
    if (!actual.includes(filter.senderName.toLocaleLowerCase())) return false
  }
  if (filter.messageId && String(resource.messageId || '') !== filter.messageId) return false
  if (filter.mediaType && String(resource.mediaType || '') !== filter.mediaType) return false
  if (filter.mediaIndex && Number(resource.mediaIndex || 0) !== filter.mediaIndex) return false
  if (filter.typeIndex && Number(resource.typeIndex || 0) !== filter.typeIndex) return false
  return true
}

function resourceLabel (el) {
  return `${el.type || 'unknown'}${el.name ? `(${path.basename(String(el.name))})` : ''}`
}

function warnResourceFailure (el, stage, error) {
  const reason = error instanceof Error ? error.message : String(error || 'unknown error')
  globalThis.logger?.warn?.(`[loli] 沙盒获取 QQ 资源失败：${resourceLabel(el)}，阶段=${stage}，原因=${reason}`)
}

function withTimeout (promise, timeoutMs, message) {
  let timer
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    })
  ]).finally(() => clearTimeout(timer))
}

function normalizeResourceUrl (value) {
  if (typeof value !== 'string') return ''
  const clean = value.trim().replace(/&amp;/giu, '&')
  if (clean.startsWith('//')) return `https:${clean}`
  return /^https?:\/\//iu.test(clean) ? clean : ''
}

async function resolveResourceUrls (event, raw, el, media = {}) {
  const urls = [...(media.urlCandidates || [])]
  for (const value of [el.url, el.file]) {
    const direct = normalizeResourceUrl(value)
    if (direct) urls.push(direct)
  }

  const contact = event?.group || event?.friend
  try {
    let resolving
    if ((el.type === 'image' || el.type === 'flash') && typeof contact?.getPicUrl === 'function') {
      resolving = contact.getPicUrl(raw)
    } else if (el.type === 'video' && typeof contact?.getVideoUrl === 'function') {
      resolving = contact.getVideoUrl(raw)
    } else if (el.type === 'record' && typeof contact?.getPttUrl === 'function') {
      resolving = contact.getPttUrl(raw)
    } else if (el.type === 'file' && typeof contact?.getFileUrl === 'function') {
      const fileId = media.fileId || el.fid || el.file_id || el.fileId || el.id
      if (fileId) resolving = contact.getFileUrl(fileId)
    }
    if (resolving) urls.push(await withTimeout(resolving, RESOURCE_RESOLVE_TIMEOUT_MS, '资源地址解析超时'))
  } catch (error) {
    // 直链仍可继续尝试；没有直链时也只跳过当前资源。
    warnResourceFailure(el, 'resolve', error)
  }

  return [...new Set(urls.map(normalizeResourceUrl).filter(Boolean))]
}

async function readResponseLimited (res, maxBytes) {
  if (!res.body?.getReader) {
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw new Error(`文件超过 ${maxBytes} bytes`)
    return bytes
  }
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel('resource too large')
        throw new Error(`文件超过 ${maxBytes} bytes`)
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

async function downloadResource (urls, el, doFetch, remainingBytes = MAX_INPUT_TOTAL_BYTES) {
  let lastError
  for (const url of urls) {
    let timer
    try {
      const controller = new AbortController()
      timer = setTimeout(() => controller.abort(), RESOURCE_DOWNLOAD_TIMEOUT_MS)
      const res = await doFetch(url, { signal: controller.signal })
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}`)
        continue
      }
      const declaredSize = Number(res.headers.get('content-length'))
      const maxBytes = Math.min(MAX_INPUT_BYTES, remainingBytes)
      if (maxBytes <= 0) return null
      if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
        lastError = new Error(`文件超过 ${maxBytes} bytes`)
        continue
      }
      const bytes = await readResponseLimited(res, maxBytes)
      if (bytes.byteLength === 0) {
        lastError = new Error('文件为空')
        continue
      }
      return { bytes, contentType: res.headers.get('content-type') }
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timer)
    }
  }
  if (lastError) warnResourceFailure(el, 'download', lastError)
  return null
}

/**
 * 从 Yunzai 事件提取 QQ 资源并下载为沙盒输入文件
 * 来源：当前消息段 + 引用（回复）消息段；单张与总数均有限制，失败跳过不阻塞执行
 * @param {Object} event - Yunzai 事件
 * @param {Object} [opts]
 * @param {Function} [opts.fetchImpl] - 测试注入
 * @param {Object} [opts.resourceFilter] - 来源/发送者筛选
 * @returns {Promise<Array<{ filename: string, bytes: Buffer }>>}
 */
export async function collectEventMedia (event, { fetchImpl, resourceFilter } = {}) {
  return (await collectEventMediaDetailed(event, { fetchImpl, resourceFilter })).inputs
}

async function collectEventMediaDetailed (event, {
  fetchImpl,
  resourceFilter,
  maxTotalBytes = MAX_INPUT_TOTAL_BYTES
} = {}) {
  const filter = normalizeResourceFilter(resourceFilter)
  const messages = await collectEventMessageRefs(event)
  const located = locateMessageMedia(messages, resourceFilter, { maxItems: MAX_INPUT_ITEMS })
  const candidates = located.matches.slice(0, MAX_INPUT_CANDIDATES)
  if (candidates.length === 0) return { inputs: [], location: located }

  const doFetch = fetchImpl || globalThis.fetch
  const inputs = []
  let totalBytes = 0
  for (const { message, media } of candidates) {
    if (inputs.length >= filter.maxItems) break
    const el = media.segment
    const resource = {
      source: message.source,
      senderId: message.sender.id,
      senderName: message.sender.name,
      time: message.timestampSec,
      messageId: message.messageId,
      mediaType: media.type,
      mediaIndex: media.mediaIndex,
      typeIndex: media.typeIndex,
      fileId: media.fileId || null,
      ...(originalResourceName(el) ? { originalName: originalResourceName(el) } : {})
    }
    const urls = await resolveResourceUrls(event, media.raw, el, media)
    if (urls.length === 0) {
      warnResourceFailure(el, 'resolve', '没有可下载地址')
      continue
    }
    const downloaded = await downloadResource(urls, el, doFetch, maxTotalBytes - totalBytes)
    if (downloaded) {
      const fallbackExt = filenameExt(el.name || el.file, {
        image: 'jpg',
        flash: 'jpg',
        video: 'mp4',
        record: 'silk',
        file: 'bin'
      }[el.type])
      const ext = mediaExtFromBytes(downloaded.bytes, downloaded.contentType, fallbackExt)
      inputs.push({
        filename: `media_${inputs.length + 1}.${ext}`,
        bytes: downloaded.bytes,
        resource
      })
      totalBytes += downloaded.bytes.byteLength
    }
  }
  return { inputs, location: located }
}

/**
 * 工具调用时直接查询群历史，按消息/发送者定位 QQ 资源。
 * userMessage 中的预加载图片不参与定位，只在群历史接口不可用时兜底。
 */
export async function collectHistoryMedia (event, {
  fetchImpl,
  resourceFilter,
  historyProvider = getGroupHistory
} = {}) {
  return (await collectHistoryMediaDetailed(event, { fetchImpl, resourceFilter, historyProvider })).inputs
}

async function collectHistoryMediaDetailed (event, {
  fetchImpl,
  resourceFilter,
  historyProvider = getGroupHistory,
  maxTotalBytes = MAX_INPUT_TOTAL_BYTES
} = {}) {
  const filter = normalizeResourceFilter({ ...resourceFilter, source: 'history' })
  const messages = await collectHistoryMessageRefs(event, filter, { historyProvider })
  const located = locateMessageMedia([...messages].reverse(), filter, { maxItems: MAX_INPUT_ITEMS })
  const candidates = located.matches.slice(0, MAX_INPUT_CANDIDATES)
  if (candidates.length === 0) return { inputs: [], location: located }

  const doFetch = fetchImpl || globalThis.fetch
  const inputs = []
  let totalBytes = 0
  for (const { message, media } of candidates) {
    if (inputs.length >= filter.maxItems) break
    const el = media.segment
    const resource = {
      source: message.source,
      senderId: message.sender.id,
      senderName: message.sender.name,
      time: message.timestampSec,
      messageId: message.messageId,
      mediaType: media.type,
      mediaIndex: media.mediaIndex,
      typeIndex: media.typeIndex,
      fileId: media.fileId || null,
      ...(originalResourceName(el) ? { originalName: originalResourceName(el) } : {})
    }
    const urls = await resolveResourceUrls(event, media.raw, el, media)
    if (urls.length === 0) {
      warnResourceFailure(el, 'resolve-history', '没有可下载地址')
      continue
    }
    const downloaded = await downloadResource(urls, el, doFetch, maxTotalBytes - totalBytes)
    if (!downloaded) continue
    const fallbackExt = filenameExt(el.name || el.file, {
      image: 'jpg',
      flash: 'jpg',
      video: 'mp4',
      record: 'silk',
      file: 'bin'
    }[el.type])
    const ext = mediaExtFromBytes(downloaded.bytes, downloaded.contentType, fallbackExt)
    inputs.push({
      filename: `media_${inputs.length + 1}.${ext}`,
      bytes: downloaded.bytes,
      resource
    })
    totalBytes += downloaded.bytes.byteLength
  }
  return { inputs, location: located }
}

/**
 * 把模型本轮实际看到的 base64 图片转成沙盒输入。
 * 用作事件/QQ 临时链接无法提供资源时的兜底，优先最近出现的图片。
 */
export function collectUserMessageImages (userMessage, { resourceFilter } = {}) {
  const filter = normalizeResourceFilter(resourceFilter)
  const images = (userMessage?.content || [])
    .filter(item => item?.type === 'image' && typeof item.image === 'string')
    .reverse()

  const inputs = []
  for (const item of images) {
    if (inputs.length >= filter.maxItems) break
    const resource = {
      source: item.sandboxResource?.source || 'history',
      senderId: String(item.sandboxResource?.senderId || ''),
      senderName: String(item.sandboxResource?.senderName || ''),
      time: Number(item.sandboxResource?.time || 0),
      messageId: String(item.sandboxResource?.messageId || ''),
      mediaIndex: Number(item.sandboxResource?.mediaIndex || item.sandboxResource?.imageIndex || 0),
      typeIndex: Number(item.sandboxResource?.typeIndex || item.sandboxResource?.imageIndex || 0),
      mediaType: 'image'
    }
    if (!matchesResourceFilter(resource, filter)) continue
    try {
      const dataUri = item.image.match(/^data:([^;,]+);base64,([\s\S]+)$/iu)
      const mimeType = dataUri?.[1] || item.mimeType || 'image/jpeg'
      const encoded = (dataUri?.[2] || item.image).replace(/\s/gu, '')
      if (!/^[a-z0-9+/]+={0,2}$/iu.test(encoded)) continue
      const bytes = Buffer.from(encoded, 'base64')
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_INPUT_BYTES) continue
      inputs.push({
        filename: `media_${inputs.length + 1}.${mediaExtFromBytes(bytes, mimeType, 'jpg')}`,
        bytes,
        resource
      })
    } catch { /* 单张模型图片解码失败时继续处理其他图片 */ }
  }
  return inputs
}

function mergeResourceInputs (filter, inputName, ...groups) {
  const merged = []
  let totalBytes = 0
  for (const input of groups.flat()) {
    if (!input?.bytes?.byteLength) continue
    if (merged.some(existing => existing.bytes.equals(input.bytes))) continue
    if (totalBytes + input.bytes.byteLength > MAX_INPUT_TOTAL_BYTES) continue
    merged.push(input)
    totalBytes += input.bytes.byteLength
    if (merged.length >= filter.maxItems) break
  }
  return merged.map((input, index) => ({
    ...input,
    filename: inputName
      ? `${inputName}${index > 0 ? `_${index + 1}` : ''}.${filenameExt(input.filename)}`
      : `media_${index + 1}.${filenameExt(input.filename)}`,
    ...(inputName ? { requestedName: inputName } : {})
  }))
}

function createResourceManifestInput (mediaInputs, filter) {
  if (mediaInputs.length === 0) return null
  const manifest = {
    version: 2,
    selection: {
      source: filter.source,
      senderId: filter.senderId || null,
      senderName: filter.senderName || null,
      messageId: filter.messageId || null,
      mediaType: filter.mediaType || null,
      mediaIndex: filter.mediaIndex || null,
      typeIndex: filter.typeIndex || null,
      maxItems: filter.maxItems
    },
    resources: mediaInputs.map(input => ({
      file: input.filename,
      source: input.resource?.source || 'unknown',
      senderId: input.resource?.senderId || null,
      senderName: input.resource?.senderName || null,
      time: input.resource?.time || null,
      messageId: input.resource?.messageId || null,
      mediaIndex: input.resource?.mediaIndex || null,
      mediaType: input.resource?.mediaType || null,
      typeIndex: input.resource?.typeIndex || null,
      fileId: input.resource?.fileId || null,
      ...(input.resource?.originalName ? { originalName: input.resource.originalName } : {}),
      ...(input.requestedName ? { requestedName: input.requestedName } : {}),
      size: input.bytes.byteLength
    }))
  }
  return {
    filename: 'resource_manifest.json',
    bytes: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8')
  }
}

const mimeOf = (ext) => ({
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', amr: 'audio/amr', silk: 'audio/silk'
}[ext] || 'application/octet-stream')

/**
 * 把沙盒产物落盘并通过 QQ 发出；媒体走消息段，其他文件走 ICQQ 文件上传，发完即删临时文件
 * @param {Object} event - Yunzai 事件（需有 reply 方法）
 * @param {Array<{ filename: string, bytes: Buffer }>} artifacts
 * @param {string} workDir - 本地临时目录
 * @returns {Promise<{ sent: string[], skipped: string[] }>}
 */
export async function deliverArtifacts (event, artifacts, workDir) {
  fs.mkdirSync(workDir, { recursive: true })
  const sent = []
  const skipped = []
  for (const a of artifacts) {
    const filename = path.basename(String(a.filename || 'artifact.bin'))
    const ext = String(filename.split('.').pop() || '').toLowerCase()
    const mime = mimeOf(ext)
    const local = path.join(workDir, `${Date.now()}_${filename}`)
    try {
      fs.writeFileSync(local, a.bytes)
      if (mime.startsWith('image/')) {
        await event.reply(makeImageSegment(local))
      } else if (mime.startsWith('video/')) {
        await event.reply({ type: 'video', file: local })
      } else if (mime.startsWith('audio/')) {
        await event.reply(makeRecordSegment(local))
      } else {
        const sentFile = await sendFileToEvent(event, local, filename)
        if (!sentFile) {
          skipped.push(filename)
          continue
        }
      }
      sent.push(filename)
    } catch (error) {
      globalThis.logger?.warn?.(`[loli] 沙盒产物 ${filename} 回发失败：${error.message}`)
      skipped.push(filename)
    } finally {
      fs.rmSync(local, { force: true })
    }
  }
  return { sent, skipped }
}

function clipReportText (value, maxLength = REPORT_SECTION_LENGTH) {
  const text = String(value || '').trim()
  if (!text) return '（无）'
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}\n…（该部分已截断 ${text.length - maxLength} 字符）`
}

function splitReportNodes (title, content) {
  const text = `${title}\n${clipReportText(content)}`
  const nodes = []
  for (let offset = 0; offset < text.length; offset += REPORT_NODE_LENGTH) {
    nodes.push(text.slice(offset, offset + REPORT_NODE_LENGTH))
  }
  return nodes
}

/**
 * 构建代码执行审计节点，不包含产物二进制。
 */
export function buildExecutionReportNodes ({ code, language, inputs = [], output = {}, artifacts = [], durationMs = 0 }) {
  const status = output.error ? '失败' : '完成'
  const summary = [
    `状态：${status}`,
    `语言：${language || 'unknown'}`,
    `耗时：${durationMs} ms`,
    `输入：${inputs.length ? inputs.map(item => `inputs/${item.filename}`).join('、') : '无'}`,
    `outputs 产物：${artifacts.length ? artifacts.map(item => `${item.filename} (${item.size ?? item.bytes?.byteLength ?? 0} bytes)`).join('、') : '无'}`
  ].join('\n')

  const nodes = [
    summary,
    ...splitReportNodes('【AI 执行的代码】', code),
    ...splitReportNodes('【stdout】', output.stdout),
    ...splitReportNodes('【stderr】', output.stderr),
    ...splitReportNodes('【result】', output.result)
  ]
  if (output.error) {
    const error = typeof output.error === 'string'
      ? output.error
      : [output.error.name, output.error.value, output.error.traceback].filter(Boolean).join('\n')
    nodes.push(...splitReportNodes('【error】', error))
  }
  return nodes
}

async function sendExecutionReport (event, report) {
  if (typeof event?.reply !== 'function') return false
  try {
    const forward = await makeForwardMsg(event, report.nodes, `🧪 AI 代码执行记录 · ${report.language}`)
    await event.reply(forward)
    return true
  } catch (err) {
    globalThis.logger?.warn?.(`[loli] 代码执行记录发送失败：${err.message}`)
    return false
  }
}

async function queueOrSendExecutionReport (context, event, report) {
  if (Array.isArray(context?.executionReports)) {
    context.executionReports.push(report)
    return true
  }
  return sendExecutionReport(event, report)
}

/**
 * 门控 + 媒体 IO + 执行编排（cfg 由调用方传入，保持纯函数可测）
 * @param {Object} args - { code, language? }
 * @param {Object} [context] - 工具上下文，context.event 为 Yunzai 事件
 * @param {Object} [cfg] - config.json 的 sandbox 段
 * @param {Function} [execute] - 测试注入用，缺省为 executeCode
 * @returns {Promise<string>} JSON 字符串
 */
export async function runCode (args, context, cfg, execute = executeCode) {
  if (!cfg?.enable) {
    return JSON.stringify({
      error: '代码沙盒未启用',
      hint: '请在 data/config.json 的 sandbox 段设置 enable: true'
    })
  }
  if (cfg.masterOnly !== false && !context?.event?.isMaster) {
    return JSON.stringify({ error: '仅主人可使用代码执行功能' })
  }

  const code = String(args?.code ?? '').trim()
  if (!code) {
    return JSON.stringify({ error: 'code 参数不能为空' })
  }

  const event = context?.event
  const mediaIO = cfg.mediaIO !== false && event
  const language = args.language || cfg.defaultLanguage
  const startedAt = Date.now()
  let inputs = []

  try {
    if (mediaIO) {
      const inputName = normalizeSandboxInputName(args?.resource_filter?.input_name)
      const filter = normalizeResourceFilter(args?.resource_filter)
      if (inputName && !filter.messageId && !['current', 'quoted'].includes(filter.source)) {
        return JSON.stringify({
          error: '使用 input_name 命名历史资源时必须提供 message_id；当前消息或引用消息请明确设置 source',
          reason: 'message_id_required',
          selection: {
            source: filter.source,
            inputName
          }
        })
      }
      const eventResult = filter.source === 'history'
        ? { inputs: [], location: null }
        : await collectEventMediaDetailed(event, {
            resourceFilter: args?.resource_filter,
            maxTotalBytes: MAX_INPUT_TOTAL_BYTES
          })
      const eventBytes = eventResult.inputs.reduce((sum, input) => sum + input.bytes.byteLength, 0)
      const historyResult = (filter.source === 'history' || (filter.source === 'auto' && filter.explicit))
        ? await collectHistoryMediaDetailed(event, {
            resourceFilter: args?.resource_filter,
            maxTotalBytes: Math.max(0, MAX_INPUT_TOTAL_BYTES - eventBytes)
          })
        : { inputs: [], location: null }
      const eventInputs = eventResult.inputs
      const historyInputs = historyResult.inputs
      let modelInputs = []

      if (filter.source === 'history' && historyInputs.length === 0) {
        modelInputs = collectUserMessageImages(context?.userMessage, { resourceFilter: args?.resource_filter })
      } else if (eventInputs.length === 0 && historyInputs.length === 0) {
        modelInputs = collectUserMessageImages(context?.userMessage, { resourceFilter: args?.resource_filter })
      }

      const mediaInputs = mergeResourceInputs(filter, inputName, eventInputs, historyInputs, modelInputs)
      if (filter.explicit && mediaInputs.length === 0) {
        const locations = [eventResult.location, historyResult.location].filter(Boolean)
        const ambiguous = locations.find(location => location.reason === 'ambiguous_sender')
        const locatedButUnavailable = locations.some(location => location.ok)
        const reason = ambiguous
          ? 'ambiguous_sender'
          : locatedButUnavailable ? 'resource_unavailable' : 'resource_not_found'
        return JSON.stringify({
          error: ambiguous
            ? '发送者名称匹配到多个群友，请改用 QQ 号定位'
            : locatedButUnavailable ? '已定位到 QQ 资源，但下载地址不可用或资源超过限制' : '没有找到符合筛选条件的 QQ 资源',
          reason,
          candidates: ambiguous?.candidates || [],
          selection: {
            source: filter.source,
            senderId: filter.senderId || null,
            senderName: filter.senderName || null,
            messageId: filter.messageId || null,
            mediaType: filter.mediaType || null,
            mediaIndex: filter.mediaIndex || null,
            typeIndex: filter.typeIndex || null
          }
        })
      }
      const manifestInput = createResourceManifestInput(mediaInputs, filter)
      inputs = manifestInput ? [...mediaInputs, manifestInput] : []
    }
    const output = await execute({ code, language, cfg, inputs })

    // 产物回发 QQ；无法/未发送的只在结果里计数说明
    const artifacts = Array.isArray(output.artifacts) ? output.artifacts : []
    delete output.artifacts
    if (cfg.executionReport !== false) {
      await queueOrSendExecutionReport(context, event, {
        language,
        nodes: buildExecutionReportNodes({
          code,
          language,
          inputs,
          output,
          artifacts,
          durationMs: Date.now() - startedAt
        })
      })
    }
    if (inputs.length > 0) {
      output.inputs = inputs.map(i => `inputs/${i.filename}`)
    }
    if (artifacts.length > 0) {
      if (mediaIO && typeof event.reply === 'function') {
        const { sent, skipped } = await deliverArtifacts(event, artifacts, path.join(DATA_DIR, 'sandbox'))
        if (sent.length > 0) output.sentArtifacts = sent
        if (skipped.length > 0) output.skippedArtifacts = skipped
      } else {
        output.artifactCount = artifacts.length
      output.artifactHint = `生成了 ${artifacts.length} 个产物文件（outputs/），产物回发未启用`
      }
    }
    return JSON.stringify(output)
  } catch (err) {
    const output = {
      error: `沙盒执行失败: ${err.message}`,
      hint: '请运行 npx msb doctor 检查 WHP，并确认 Microsandbox 镜像可拉取'
    }
    if (cfg.executionReport !== false) {
      await queueOrSendExecutionReport(context, event, {
        language,
        nodes: buildExecutionReportNodes({
          code,
          language,
          inputs,
          output,
          durationMs: Date.now() - startedAt
        })
      })
    }
    return JSON.stringify(output)
  }
}

class RunCode extends CustomTool {

  name = 'run_code'

  function = {
    name: 'run_code',
    description: `在隔离的 microVM/容器沙盒中执行代码并返回输出，支持 ${LANGUAGES.join('/')}。
代码无法访问机器人本机文件与内网；用 print/console.log 等输出结果，单次执行有超时限制。
当前消息和引用消息可直接取资源；群历史会在调用工具时按发送者、消息 ID/seq、消息内媒体序号直接查询定位，模型预加载图片仅作失败兜底；resource_manifest.json 会列出 media_* 文件对应的发送者 QQ、昵称、消息与来源，代码应先读清单再选择资源；
可在 resource_filter.input_name 中为定位到的资源指定沙盒内别名；history/auto 模式必须同时传 message_id，只有明确的 current/quoted 可省略 ID；扩展名由真实媒体类型决定，代码不确定类型时应使用 inputs/别名.* 查找；
需要发回给用户的图片、音视频、TXT、JSON、CSV、PDF、ZIP 等文件请保存到 outputs/ 目录，执行后会自动通过 QQ 发送。
Microsandbox 默认 Python 镜像较精简，缺包时用 subprocess 调用 pip 安装。
适用：数学计算、数据处理、格式转换、算法验证、图像/音视频处理等需要真实运行代码的场景。`,
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: '要执行的代码，文本结果通过标准输出返回'
        },
        language: {
          type: 'string',
          enum: LANGUAGES,
          description: '编程语言，默认 python'
        },
        resource_filter: {
          type: 'object',
          description: '需要读取 QQ 图片/文件时使用。可按当前消息、引用消息、最近群聊图片或发送者筛选；省略则保持自动模式',
          properties: {
            source: {
              type: 'string',
              enum: ['auto', 'current', 'quoted', 'history'],
              description: '资源来源：auto 自动、current 当前消息、quoted 引用消息、history 最近群聊图片'
            },
            sender_id: {
              type: 'string',
              description: '只选择此 QQ 号发送的资源'
            },
            sender_name: {
              type: 'string',
              description: '只选择昵称或群名片包含该文本的资源'
            },
            message_id: {
              type: 'string',
              description: '精确定位群上下文中标注的消息 ID 或 seq'
            },
            media_index: {
              type: 'integer',
              minimum: 1,
              description: '选择目标消息中的第几个媒体资源（图片/视频/语音/文件混合计数），从 1 开始'
            },
            media_type: {
              type: 'string',
              enum: ['image', 'video', 'record', 'file'],
              description: '按媒体类型筛选；“第几张图片”应与 type_index 一起使用'
            },
            type_index: {
              type: 'integer',
              minimum: 1,
              description: '选择目标消息中同类型的第几个资源，从 1 开始'
            },
            history_limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              description: '消息定位时向前查询的群消息数，默认 30'
            },
            max_items: {
              type: 'integer',
              minimum: 1,
              maximum: MAX_INPUT_ITEMS,
              description: '最多放入沙盒的资源数，默认 4'
            },
            input_name: {
              type: 'string',
              maxLength: 100,
              description: '资源写入 inputs/ 后使用的纯文件名；history/auto 模式必须同时提供 message_id，current/quoted 可省略；工具按真实媒体类型补扩展名，多资源自动追加 _2、_3'
            }
          }
        }
      },
      required: ['code']
    }
  }

  async run (args, context) {
    return runCode(args, context, getConfig()?.sandbox)
  }
}

export default new RunCode()
