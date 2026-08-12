import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 5

function isBlockedIpv4 (address) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b, c] = parts
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
}

function isProxyFakeIpv4 (address) {
  const parts = String(address || '').split('.').map(Number)
  return parts.length === 4 && parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)
}

function mappedIpv4 (address) {
  const match = address.toLowerCase().match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/u)
  return match?.[1] || ''
}

function isBlockedIpv6 (address) {
  const normalized = address.toLowerCase().split('%')[0]
  const mapped = mappedIpv4(normalized)
  if (mapped) return isBlockedIpv4(mapped)
  return normalized.startsWith('::') ||
    normalized.startsWith('fc') || normalized.startsWith('fd') ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:') ||
    normalized.startsWith('2001:0:') ||
    normalized.startsWith('2002:') ||
    normalized.startsWith('64:ff9b:')
}

export function isPublicAddress (address) {
  const family = net.isIP(String(address || ''))
  if (family === 4) return !isBlockedIpv4(address)
  if (family === 6) return !isBlockedIpv6(address)
  return false
}

function domainAllowed (hostname, allowedDomains) {
  if (!allowedDomains.length) return true
  return allowedDomains.some(entry => {
    const domain = String(entry || '').trim().toLowerCase()
      .replace(/^\*\./u, '').replace(/^\.+|\.+$/gu, '')
    return domain && (hostname === domain || hostname.endsWith(`.${domain}`))
  })
}

export async function resolvePublicTarget (value, {
  allowedDomains = [],
  allowProxyFakeIp = false,
  lookupImpl = dns.lookup
} = {}) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('无效的 URL')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 http(s) URL')
  if (url.username || url.password) throw new Error('URL 不允许包含用户名或密码')
  const expectedPort = url.protocol === 'https:' ? '443' : '80'
  if (url.port && url.port !== expectedPort) throw new Error(`仅允许 ${url.protocol}// 的标准端口 ${expectedPort}`)

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (!domainAllowed(hostname, allowedDomains)) throw new Error(`域名 ${hostname} 不在允许列表中`)

  const literalFamily = net.isIP(hostname)
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookupImpl(hostname, { all: true, verbatim: true })
  if (!Array.isArray(addresses) || addresses.length === 0) throw new Error(`无法解析域名 ${hostname}`)
  const unsafe = addresses.find(item => !isPublicAddress(item.address))
  if (unsafe) {
    const trustedProxyMapping = !literalFamily &&
      allowProxyFakeIp === true &&
      allowedDomains.length > 0 &&
      addresses.every(item => item.family === 4 && isProxyFakeIpv4(item.address))
    if (!trustedProxyMapping) throw new Error(`目标解析到非公网地址 ${unsafe.address}，已拒绝访问`)
  }
  return { url, addresses }
}

function requestOnce (target, {
  method,
  timeoutMs,
  maxBytes,
  requestImpl
}) {
  const transport = target.url.protocol === 'https:' ? https : http
  const doRequest = requestImpl || transport.request
  const selected = target.addresses[0]
  const lookup = (_hostname, options, callback) => {
    if (options?.all) return callback(null, target.addresses)
    callback(null, selected.address, selected.family)
  }

  return new Promise((resolve, reject) => {
    const request = doRequest(target.url, {
      method,
      lookup,
      headers: {
        'User-Agent': 'loli-plugin-controlled-fetch/1.0',
        Accept: '*/*'
      }
    }, response => {
      const chunks = []
      let total = 0
      const declared = Number(response.headers['content-length'])
      if (Number.isFinite(declared) && declared > maxBytes) {
        response.destroy()
        reject(new Error(`响应超过限制（${declared} > ${maxBytes} bytes）`))
        return
      }
      response.on('data', chunk => {
        total += chunk.length
        if (total > maxBytes) {
          response.destroy(new Error(`响应超过 ${maxBytes} bytes 限制`))
          return
        }
        chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => resolve({
        status: Number(response.statusCode) || 0,
        headers: response.headers,
        bytes: Buffer.concat(chunks)
      }))
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`)))
    request.on('error', reject)
    request.end()
  })
}

export async function fetchPublicResource (value, options = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  if (!['GET', 'HEAD'].includes(method)) throw new Error('仅支持 GET/HEAD')
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS)
  const maxBytes = Math.max(1024, Number(options.maxBytes) || DEFAULT_MAX_BYTES)
  const maxRedirects = Math.max(0, Math.min(10, Number(options.maxRedirects) || DEFAULT_MAX_REDIRECTS))
  let current = String(value || '')

  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    const target = await resolvePublicTarget(current, options)
    const response = await requestOnce(target, { ...options, method, timeoutMs, maxBytes })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location
      if (!location) throw new Error(`HTTP ${response.status} 缺少 Location`)
      if (redirect === maxRedirects) throw new Error(`重定向超过 ${maxRedirects} 次`)
      current = new URL(location, target.url).toString()
      continue
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`下载失败：HTTP ${response.status}`)
    return {
      url: target.url.toString(),
      status: response.status,
      headers: response.headers,
      bytes: response.bytes
    }
  }
  throw new Error('重定向处理失败')
}
