import { createHash } from 'node:crypto'
import { GoogleGenAI } from '@google/genai'

const clients = new Map()
const projectCooldowns = new Map()
const keyCooldowns = new Map()
const inflight = new Map()
let roundRobinCursor = 0
const projectKeyCursors = new Map()

function fingerprint (value) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16)
}

export function normalizeGeminiKeyPool (options = {}, { includeDisabled = false } = {}) {
  const entries = []
  const seen = new Set()
  const source = Array.isArray(options.apiKeys) ? options.apiKeys : []
  for (let index = 0; index < source.length; index++) {
    const raw = source[index]
    const apiKey = String(typeof raw === 'string' ? raw : raw?.apiKey || raw?.key || '').trim()
    const enabled = typeof raw === 'object' && raw !== null ? raw.enabled !== false : true
    if (!apiKey || seen.has(apiKey) || (!enabled && !includeDisabled)) continue
    seen.add(apiKey)
    entries.push({
      id: String(raw?.id || `key-${index + 1}`).trim(),
      projectId: String(raw?.projectId || raw?.project || `project-${index + 1}`).trim(),
      apiKey,
      weight: Math.max(1, Math.min(20, Math.round(Number(raw?.weight) || 1))),
      ...(enabled ? {} : { enabled: false })
    })
  }
  const legacyKey = String(options.apiKey || '').trim()
  // 一旦显式配置项目池，就只使用带 projectId 的池项，避免旧 Key 被误判为独立项目绕过共享冷却。
  if (entries.length === 0 && legacyKey && !seen.has(legacyKey)) {
    entries.push({ id: 'legacy', projectId: `legacy-${fingerprint(legacyKey)}`, apiKey: legacyKey, weight: 1 })
  }
  return entries
}

export function hasGeminiApiKey (options = {}) {
  return normalizeGeminiKeyPool(options).length > 0
}

export function firstGeminiApiKey (options = {}) {
  return normalizeGeminiKeyPool(options)[0]?.apiKey || ''
}

function errorStatus (error) {
  const direct = Number(error?.status || error?.statusCode || error?.code || error?.error?.code)
  if (Number.isFinite(direct) && direct > 0) return direct
  const match = String(error?.message || '').match(/(?:HTTP\s*|"code"\s*:\s*)(\d{3})/iu)
  return match ? Number(match[1]) : 0
}

function retryDelayMs (error, fallbackMs) {
  const text = JSON.stringify(error?.error?.details || error?.details || '') + ' ' + String(error?.message || '')
  const match = text.match(/(?:retryDelay|retry after)[^0-9]*(\d+(?:\.\d+)?)\s*s/i)
  return match ? Math.max(1000, Math.min(600000, Number(match[1]) * 1000)) : fallbackMs
}

function isBuiltinToolPermissionError (error) {
  return /(?:builtin|built-in) tools|内置工具|permission_denied/i.test(
    `${String(error?.message || '')} ${JSON.stringify(error?.error || '')}`
  )
}

function getClient (entry, baseUrl) {
  const cacheKey = fingerprint(`${baseUrl || ''}\0${entry.apiKey}`)
  let client = clients.get(cacheKey)
  if (!client) {
    client = new GoogleGenAI({ apiKey: entry.apiKey, httpOptions: { baseUrl: baseUrl || undefined } })
    clients.set(cacheKey, client)
  }
  return client
}

function selectEntries (entries, strategy) {
  const now = Date.now()
  const available = entries.filter(entry => {
    const projectKey = fingerprint(entry.projectId)
    const keyId = fingerprint(entry.apiKey)
    return (projectCooldowns.get(projectKey) || 0) <= now && (keyCooldowns.get(keyId) || 0) <= now
  })
  const groups = new Map()
  for (const entry of available) {
    if (!groups.has(entry.projectId)) groups.set(entry.projectId, [])
    groups.get(entry.projectId).push(entry)
  }
  let projects = [...groups.entries()]
  if (strategy === 'least_inflight') {
    projects.sort(([, left], [, right]) => {
      const leftCount = left.reduce((sum, item) => sum + (inflight.get(fingerprint(item.apiKey)) || 0), 0)
      const rightCount = right.reduce((sum, item) => sum + (inflight.get(fingerprint(item.apiKey)) || 0), 0)
      return leftCount - rightCount
    })
  } else if (projects.length) {
    const start = roundRobinCursor++ % projects.length
    projects = [...projects.slice(start), ...projects.slice(0, start)]
  }
  return projects.flatMap(([projectId, projectEntries]) => {
    if (strategy === 'least_inflight') {
      return [...projectEntries].sort((a, b) => (inflight.get(fingerprint(a.apiKey)) || 0) - (inflight.get(fingerprint(b.apiKey)) || 0))
    }
    const cursor = projectKeyCursors.get(projectId) || 0
    projectKeyCursors.set(projectId, cursor + 1)
    const start = cursor % projectEntries.length
    return [...projectEntries.slice(start), ...projectEntries.slice(0, start)]
  })
}

/** 在不同 Gemini Project Key 之间负载；429 按 project 共享冷却并自动切换。 */
export async function withGeminiKeyPool (options, operation, { logger, purpose = 'request', preferredProjectId } = {}) {
  const entries = normalizeGeminiKeyPool(options)
  if (!entries.length) throw new Error('Gemini API key not configured')
  const strategy = String(options?.keyPoolStrategy || 'round_robin') === 'least_inflight'
    ? 'least_inflight'
    : 'round_robin'
  const cooldownMs = Math.max(5000, Math.min(600000, Number(options?.keyCooldownSeconds || 60) * 1000))
  const selected = selectEntries(entries, strategy)
  const ordered = preferredProjectId
    ? [...selected].sort((a, b) => Number(b.projectId === preferredProjectId) - Number(a.projectId === preferredProjectId))
    : selected
  if (!ordered.length) {
    const error = new Error('Gemini key pool is cooling down')
    error.status = 429
    throw error
  }
  let lastError
  const log = message => typeof logger === 'function' ? logger(message) : logger?.warn?.(message)
  for (let index = 0; index < ordered.length; index++) {
    const entry = ordered[index]
    const keyId = fingerprint(entry.apiKey)
    const projectKey = fingerprint(entry.projectId)
    if ((projectCooldowns.get(projectKey) || 0) > Date.now() || (keyCooldowns.get(keyId) || 0) > Date.now()) continue
    inflight.set(keyId, (inflight.get(keyId) || 0) + 1)
    try {
      return await operation(getClient(entry, options?.baseUrl), {
        id: entry.id,
        projectId: entry.projectId,
        poolSize: entries.length
      })
    } catch (error) {
      lastError = error
      const status = errorStatus(error)
      if (status === 429) {
        const until = Date.now() + retryDelayMs(error, cooldownMs)
        projectCooldowns.set(projectKey, until)
        log(`[GeminiKeyPool] ${purpose}: project=${entry.projectId} hit 429, switching key`)
      } else if ([401, 403].includes(status)) {
        // 403 from the local AI Studio gateway can mean the API key is valid
        // but its built-in-tool permission is off. Do not cool the key down:
        // the caller can retry the same request with local function tools only.
        if (status === 403 && isBuiltinToolPermissionError(error)) throw error
        keyCooldowns.set(keyId, Date.now() + Math.max(cooldownMs, 300000))
        log(`[GeminiKeyPool] ${purpose}: key=${entry.id} authentication failed (${status}), switching key`)
      } else if ([500, 502, 503, 504].includes(status)) {
        keyCooldowns.set(keyId, Date.now() + 10000)
        log(`[GeminiKeyPool] ${purpose}: key=${entry.id} upstream ${status}, switching key`)
      } else {
        throw error
      }
      if (index === ordered.length - 1) throw error
    } finally {
      inflight.set(keyId, Math.max(0, (inflight.get(keyId) || 1) - 1))
    }
  }
  throw lastError || new Error('Gemini key pool exhausted')
}

/** 查询池内每个 Key 的运行时状态（含已禁用项），供仪表盘展示。 */
export function getGeminiKeyPoolStatus (options = {}) {
  const now = Date.now()
  return normalizeGeminiKeyPool(options, { includeDisabled: true }).map(entry => {
    const keyId = fingerprint(entry.apiKey)
    const cooldownUntil = Math.max(
      keyCooldowns.get(keyId) || 0,
      projectCooldowns.get(fingerprint(entry.projectId)) || 0
    )
    return {
      id: entry.id,
      projectId: entry.projectId,
      enabled: entry.enabled !== false,
      inflight: inflight.get(keyId) || 0,
      cooldownRemainingMs: Math.max(0, cooldownUntil - now)
    }
  })
}

/** 测活失败后立即把 Key/项目置入冷却，与运行时失败处理保持一致，第一时间停止继续使用。 */
export function applyGeminiKeyProbeResult (entry, status) {
  const now = Date.now()
  if (status === 429) {
    projectCooldowns.set(fingerprint(entry.projectId), now + 60000)
  } else if (status === 401 || status === 403) {
    keyCooldowns.set(fingerprint(entry.apiKey), now + 300000)
  } else if ([500, 502, 503, 504].includes(status)) {
    keyCooldowns.set(fingerprint(entry.apiKey), now + 10000)
  }
}

export function resetGeminiKeyPoolForTest () {
  clients.clear()
  projectCooldowns.clear()
  keyCooldowns.clear()
  inflight.clear()
  projectKeyCursors.clear()
  roundRobinCursor = 0
}
