import path from 'node:path'
import { CustomTool } from '../../core/index.js'
import { getConfig } from '../state.js'
import { fetchPublicResource } from '../public-fetch.js'

const MAX_ITEMS = 4
const MAX_TOTAL_BYTES = 40 * 1024 * 1024

function safeFilename (value, finalUrl, contentType) {
  const requested = path.basename(String(value || '').trim())
  const fromUrl = path.basename(new URL(finalUrl).pathname)
  let filename = requested || fromUrl || 'download.bin'
  filename = filename.replace(/[<>:"/\\|?*\x00-\x1f]/gu, '_').slice(0, 180)
  if (/^(?:resource_manifest\.json|media_\d+\.)/iu.test(filename)) filename = `fetched_${filename}`
  if (!path.extname(filename)) {
    const ext = {
      'application/json': '.json',
      'text/plain': '.txt',
      'text/html': '.html',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'application/pdf': '.pdf',
      'application/zip': '.zip'
    }[String(contentType || '').split(';')[0].trim().toLowerCase()]
    if (ext) filename += ext
  }
  return filename || 'download.bin'
}

export async function queueFetchedResource (args, context = {}, cfg = {}, fetchImpl = fetchPublicResource) {
  if (cfg.fetchEnable !== true) throw new Error('受控公网下载未启用')
  if (context.event?.isMaster !== true) throw new Error('受控公网下载强制仅机器人主人可用')
  if (!Array.isArray(context.fetchedResources)) throw new Error('当前工具上下文不支持资源暂存')
  if (context.fetchedResources.length >= MAX_ITEMS) throw new Error(`单轮最多暂存 ${MAX_ITEMS} 个公网资源`)

  const maxBytes = Math.max(1, Math.min(20, Number(cfg.fetchMaxBytesMiB) || 20)) * 1024 * 1024
  const timeoutMs = Math.max(5, Math.min(120, Number(cfg.fetchTimeoutSeconds) || 30)) * 1000
  const result = await fetchImpl(args?.url, {
    method: args?.method || 'GET',
    allowedDomains: Array.isArray(cfg.fetchAllowedDomains) ? cfg.fetchAllowedDomains : [],
    allowProxyFakeIp: cfg.fetchAllowProxyFakeIp === true,
    maxBytes,
    timeoutMs,
    maxRedirects: 5
  })
  if (String(args?.method || 'GET').toUpperCase() === 'HEAD') {
    return {
      url: result.url,
      status: result.status,
      contentType: result.headers['content-type'] || '',
      size: Number(result.headers['content-length']) || null,
      queued: false
    }
  }

  const usedBytes = context.fetchedResources.reduce((sum, item) => sum + item.bytes.byteLength, 0)
  if (usedBytes + result.bytes.byteLength > MAX_TOTAL_BYTES) throw new Error('单轮公网资源合计超过 40 MiB')
  const filename = safeFilename(args?.filename, result.url, result.headers['content-type'])
  const input = {
    filename,
    bytes: result.bytes,
    resource: {
      source: 'controlled_fetch',
      originalName: filename,
      url: result.url,
      mediaType: String(result.headers['content-type'] || '').split(';')[0]
    }
  }
  context.fetchedResources.push(input)
  return {
    url: result.url,
    status: result.status,
    filename,
    size: result.bytes.byteLength,
    contentType: result.headers['content-type'] || '',
    queued: true,
    hint: `文件已暂存；下一次 run_code 会自动收到 inputs/${filename}`
  }
}

class FetchResource extends CustomTool {
  name = 'fetch_resource'

  function = {
    name: 'fetch_resource',
    description: `通过宿主侧受控网关下载公开 HTTP(S) 资源，并暂存给下一次 run_code 的 inputs/。Quicksand 本身始终断网。
每个 URL 与每次重定向都会重新解析并拒绝本机、局域网、链路本地、云元数据和其他非公网地址。仅机器人主人可用。`,
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '完整的公开 http(s) URL' },
        method: { type: 'string', enum: ['GET', 'HEAD'], description: '默认 GET；HEAD 只检查元数据，不暂存文件' },
        filename: { type: 'string', description: '可选的 inputs/ 文件名，只允许纯文件名' }
      },
      required: ['url']
    }
  }

  async run (args, context = {}) {
    try {
      return JSON.stringify(await queueFetchedResource(args, context, getConfig()?.sandbox || {}))
    } catch (error) {
      return JSON.stringify({ error: error.message })
    }
  }
}

export default new FetchResource()
