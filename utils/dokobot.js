import { execFile as nodeExecFile } from 'child_process'
import fs from 'fs'
import net from 'net'
import path from 'path'

const DEFAULT_TIMEOUT_SECONDS = 60
const DEFAULT_MAX_TEXT_CHARS = 12000

export const DOKOBOT_SEARCH_ENGINES = Object.freeze({
  google: { label: 'Google', url: 'https://www.google.com/search', query: 'q', page: 'start', offset: page => (page - 1) * 10 },
  bing: { label: 'Bing', url: 'https://www.bing.com/search', query: 'q', page: 'first', offset: page => (page - 1) * 10 + 1 },
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/', query: 'q', page: 's', offset: page => (page - 1) * 30 },
  baidu: { label: '百度', url: 'https://www.baidu.com/s', query: 'wd', page: 'pn', offset: page => (page - 1) * 10 },
  sogou: { label: '搜狗', url: 'https://www.sogou.com/web', query: 'query', page: 'page', offset: page => page }
})

function positiveInteger (value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
}

export function normalizeDokobotConfig (config = {}) {
  return {
    enable: config.enable === true,
    cliPath: String(config.cliPath || 'dokobot').trim() || 'dokobot',
    masterOnly: config.masterOnly !== false,
    fallback: config.fallback !== false,
    searchEngine: DOKOBOT_SEARCH_ENGINES[config.searchEngine] ? config.searchEngine : 'google',
    timeoutSeconds: positiveInteger(config.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS, 5, 300),
    screens: positiveInteger(config.screens, 3, 1, 20),
    maxTextChars: positiveInteger(config.maxTextChars, DEFAULT_MAX_TEXT_CHARS, 1000, 50000),
    reuseTab: config.reuseTab === true,
    allowPrivateNetwork: config.allowPrivateNetwork === true,
    allowedDomains: Array.isArray(config.allowedDomains)
      ? config.allowedDomains.map(domain => String(domain).trim().toLowerCase()).filter(Boolean)
      : []
  }
}

export function canUseDokobot (config, context = {}) {
  const cfg = normalizeDokobotConfig(config)
  if (!cfg.enable) return { allowed: false, reason: 'disabled', config: cfg }
  if (cfg.masterOnly && context.event?.isMaster !== true) {
    return { allowed: false, reason: 'master_only', config: cfg }
  }
  return { allowed: true, config: cfg }
}

export function buildDokobotSearchUrl (keyword, engine = 'google', page = 1) {
  const selected = DOKOBOT_SEARCH_ENGINES[engine] || DOKOBOT_SEARCH_ENGINES.google
  const normalizedPage = positiveInteger(page, 1, 1, 100)
  const url = new URL(selected.url)
  url.searchParams.set(selected.query, String(keyword || '').trim())
  if (normalizedPage > 1) url.searchParams.set(selected.page, String(selected.offset(normalizedPage)))
  return url.toString()
}

function isPrivateIpv4 (host) {
  const parts = host.split('.').map(Number)
  return parts[0] === 10 || parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) || parts[0] === 0
}

function isPrivateIpv6 (host) {
  const normalized = host.toLowerCase()
  return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') ||
    normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)
}

function domainAllowed (hostname, allowedDomains) {
  if (allowedDomains.length === 0) return true
  return allowedDomains.some(domain => {
    const normalized = domain.replace(/^\*\./, '').replace(/^\.+|\.+$/g, '')
    return normalized && (hostname === normalized || hostname.endsWith(`.${normalized}`))
  })
}

export function validateDokobotUrl (value, config = {}) {
  const cfg = normalizeDokobotConfig(config)
  let url
  try {
    url = new URL(value)
  } catch {
    return { valid: false, reason: '无效的 URL' }
  }
  if (!['http:', 'https:'].includes(url.protocol)) return { valid: false, reason: '仅支持 http(s) URL' }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!domainAllowed(hostname, cfg.allowedDomains)) {
    return { valid: false, reason: `域名 ${hostname} 不在 Dokobot 允许列表中` }
  }
  if (!cfg.allowPrivateNetwork) {
    const privateHost = hostname === 'localhost' || hostname.endsWith('.localhost') ||
      (net.isIP(hostname) === 4 && isPrivateIpv4(hostname)) ||
      (net.isIP(hostname) === 6 && isPrivateIpv6(hostname))
    if (privateHost) return { valid: false, reason: '默认禁止访问本机或私有网络地址' }
  }
  return { valid: true, url: url.toString() }
}

function execFilePromise (command, args, options, execFileImpl = nodeExecFile) {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, options, (error, stdout = '', stderr = '') => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
        return
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

function decodeCommandOutput (value, platform = process.platform) {
  if (typeof value === 'string') return value
  if (!Buffer.isBuffer(value)) return String(value || '')
  if (platform === 'win32') {
    try {
      return new TextDecoder('gbk').decode(value)
    } catch {}
  }
  return value.toString('utf8')
}

async function resolveWindowsCliPath (cliPath, common, env, execFileImpl) {
  if (/[\\/]/.test(cliPath) || /\.(?:cmd|bat|exe)$/i.test(cliPath)) return cliPath
  try {
    const result = await execFilePromise('where.exe', [cliPath], { ...common, env }, execFileImpl)
    const candidates = decodeCommandOutput(result.stdout, 'win32').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    return candidates.find(candidate => /\.(?:cmd|bat|exe)$/i.test(candidate)) || cliPath
  } catch {
    return cliPath
  }
}

function resolveNpmCmdEntrypoint (cliPath) {
  if (!/\.cmd$/i.test(cliPath)) return ''
  try {
    const shim = fs.readFileSync(cliPath, 'utf8')
    const match = shim.match(/"%dp0%\\([^"\r\n]+\.js)"/i)
    return match ? path.resolve(path.dirname(cliPath), match[1]) : ''
  } catch {
    return ''
  }
}

export async function executeDokobot (args, config = {}, options = {}) {
  const cfg = normalizeDokobotConfig(config)
  const platform = options.platform || process.platform
  const env = options.env || process.env
  const timeout = cfg.timeoutSeconds * 1000
  const common = { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true, encoding: 'buffer' }

  if (platform !== 'win32' || /\.exe$/i.test(cfg.cliPath)) {
    const result = await execFilePromise(cfg.cliPath, args, { ...common, env }, options.execFileImpl)
    return { stdout: decodeCommandOutput(result.stdout, platform), stderr: decodeCommandOutput(result.stderr, platform) }
  }

  // npm 的 Windows 全局命令通常是 .cmd。参数放进环境变量，避免 URL 中的 &/% 被 cmd 二次解释。
  const resolvedCliPath = await resolveWindowsCliPath(cfg.cliPath, common, env, options.execFileImpl)
  const npmEntrypoint = resolveNpmCmdEntrypoint(resolvedCliPath)
  if (npmEntrypoint) {
    const result = await execFilePromise(options.nodePath || process.execPath, [npmEntrypoint, ...args], {
      ...common,
      env
    }, options.execFileImpl)
    return { stdout: decodeCommandOutput(result.stdout, platform), stderr: decodeCommandOutput(result.stderr, platform) }
  }
  const commandEnv = { ...env, LOLI_DOKOBOT_CLI: resolvedCliPath }
  const refs = args.map((arg, index) => {
    const key = `LOLI_DOKOBOT_ARG_${index}`
    commandEnv[key] = String(arg)
    return `"%${key}%"`
  })
  const command = `call "%LOLI_DOKOBOT_CLI%" ${refs.join(' ')}`
  const result = await execFilePromise(env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
    ...common,
    env: commandEnv
  }, options.execFileImpl)
  return { stdout: decodeCommandOutput(result.stdout, platform), stderr: decodeCommandOutput(result.stderr, platform) }
}

function clipOutput (text, maxChars) {
  const normalized = String(text || '').trim()
  return {
    text: normalized.slice(0, maxChars),
    length: normalized.length,
    truncated: normalized.length > maxChars
  }
}

export async function readWithDokobot (url, config = {}, options = {}) {
  const cfg = normalizeDokobotConfig(config)
  const validation = validateDokobotUrl(url, cfg)
  if (!validation.valid) throw new Error(validation.reason)

  const screens = positiveInteger(options.screens, cfg.screens, 1, 20)
  const args = ['read', '--local', validation.url, '--format', 'text', '--screens', String(screens), '--timeout', String(cfg.timeoutSeconds)]
  if (options.sessionId) args.push('--session-id', String(options.sessionId))
  if (options.reuseTab === true || (options.reuseTab === undefined && cfg.reuseTab)) args.push('--reuse-tab')

  const result = await executeDokobot(args, cfg, options)
  return { url: validation.url, provider: 'dokobot-local', ...clipOutput(result.stdout, cfg.maxTextChars) }
}

export async function searchWithDokobot (keyword, config = {}, options = {}) {
  const cfg = normalizeDokobotConfig(config)
  const engine = DOKOBOT_SEARCH_ENGINES[options.engine] ? options.engine : cfg.searchEngine
  const searchUrl = buildDokobotSearchUrl(keyword, engine, options.page)
  const result = await readWithDokobot(searchUrl, cfg, options)
  return { query: String(keyword || ''), page: positiveInteger(options.page, 1, 1, 100), engine, ...result }
}

export async function getDokobotStatus (config = {}, options = {}) {
  const cfg = normalizeDokobotConfig(config)
  try {
    const result = await executeDokobot(['doko', 'list'], { ...cfg, timeoutSeconds: Math.min(cfg.timeoutSeconds, 15) }, options)
    const output = String(result.stdout || result.stderr || '').trim().slice(0, 2000)
    return { available: true, enabled: cfg.enable, cliPath: cfg.cliPath, bridgeOutput: output || '命令可用，未返回 Bridge 信息' }
  } catch (err) {
    const detail = decodeCommandOutput(err.stderr, options.platform || process.platform).trim() || String(err.message || err).trim()
    return { available: false, enabled: cfg.enable, cliPath: cfg.cliPath, error: detail }
  }
}
