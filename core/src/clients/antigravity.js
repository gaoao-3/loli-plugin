import { randomBytes, randomUUID } from 'node:crypto'
import { AbstractClient } from './abstract.js'
import { toGeminiFunctionDeclaration } from './gemini.js'
import { fromChaiteConverter, intoChaiteConverter } from '../converters/gemini.js'
import {
  AntigravityCredentialStore,
  buildAntigravityHeaders,
  fetchAntigravityEntitlements,
  getAntigravityCredential,
  normalizeAntigravityApiBase
} from '../antigravity/oauth.js'

const REQUEST_TIMEOUT_MS = 300_000
const sessions = new Map()
const sessionBindings = new Map()
const inFlight = new Map()
const weightedStates = new Map()
const SESSION_TTL_MS = 6 * 60 * 60 * 1000
const RETRYABLE_STATUSES = new Set([403, 408, 429, 500, 502, 503, 504])
const LOAD_BALANCE_STRATEGIES = new Set([
  'smart', 'round_robin', 'least_connections', 'weighted_round_robin'
])

function apiError (payload, status) {
  const detail = payload?.error?.message || payload?.error || payload?.message
  const suffix = typeof detail === 'string' && detail.trim() ? `：${detail.trim().slice(0, 500)}` : ''
  return new Error(`Antigravity API HTTP ${status}${suffix}`)
}

function newSession (conversationId) {
  const digits = BigInt(`0x${randomBytes(8).toString('hex')}`).toString()
  return {
    conversationId,
    trajectoryId: randomUUID(),
    sessionId: `-${digits}`,
    step: 0,
    touchedAt: Date.now()
  }
}

function sessionFor (conversationId) {
  const key = String(conversationId || randomUUID())
  let state = sessions.get(key)
  if (!state || state.touchedAt + SESSION_TTL_MS < Date.now()) {
    state = newSession(key)
    sessions.set(key, state)
  }
  state.touchedAt = Date.now()
  return state
}

function buildLabels (model, state) {
  const usedClaude = String(model).toLowerCase().includes('claude')
  return {
    last_step_index: String(state.step),
    model_enum: model,
    trajectory_id: state.trajectoryId,
    used_claude: String(usedClaude),
    used_claude_conservative: String(usedClaude)
  }
}

function wrapRequest ({ request, model, projectId, conversationId }) {
  const state = sessionFor(conversationId)
  const inner = {
    ...request,
    sessionId: request.sessionId || state.sessionId,
    labels: buildLabels(model, state),
    toolConfig: {
      ...(request.toolConfig || {}),
      functionCallingConfig: {
        mode: 'VALIDATED',
        ...(request.toolConfig?.functionCallingConfig || {})
      }
    }
  }
  delete inner.safetySettings
  const requestId = `agent/${state.conversationId}/${Date.now()}/${state.trajectoryId}/${state.step}`
  state.step++
  return {
    project: projectId,
    requestId,
    request: inner,
    model,
    userAgent: 'antigravity',
    requestType: 'agent',
    enabledCreditTypes: ['GOOGLE_ONE_AI']
  }
}

function flightKey (channelId, accountId) {
  return `${channelId}:${accountId}`
}

function canonicalModelKey (model) {
  return String(model || '').trim().toLowerCase()
}

function quotaForModel (account, model) {
  const key = canonicalModelKey(model)
  const entry = Object.entries(account?.quotas || {})
    .find(([candidate]) => canonicalModelKey(candidate) === key)?.[1]
  const remaining = Number(entry?.remaining)
  const modelRemaining = Number.isFinite(remaining) ? remaining : null
  const family = /claude|gpt|oss|^chat_/i.test(key) ? '3p' : 'gemini'
  const group = (account?.quotaGroups || []).find(item =>
    (item?.buckets || []).some(bucket =>
      String(bucket?.bucketId || '').toLowerCase().startsWith(`${family}-`)
    )
  )
  const windowValues = (group?.buckets || [])
    .filter(bucket => bucket?.remaining !== null && bucket?.remaining !== undefined)
    .map(bucket => Number(bucket.remaining))
    .filter(Number.isFinite)
  if (windowValues.length === 0) return modelRemaining
  return Math.min(...windowValues, ...(modelRemaining === null ? [] : [modelRemaining]))
}

function activeCooldown (account, model, now = Date.now()) {
  const key = canonicalModelKey(model)
  const modelCooldown = Object.entries(account?.cooldowns || {})
    .find(([candidate]) => canonicalModelKey(candidate) === key)?.[1]
  return Math.max(
    Number(account?.cooldowns?.['*']) || 0,
    Number(modelCooldown) || 0
  ) > now
}

function selectWeighted (accounts, stateKey) {
  const state = weightedStates.get(stateKey) || new Map()
  const validIds = new Set(accounts.map(item => item.accountId))
  for (const id of state.keys()) {
    if (!validIds.has(id)) state.delete(id)
  }
  let total = 0
  let selected = null
  let selectedCredit = -Infinity
  for (const account of accounts) {
    const weight = Math.max(0, Number(account.weight ?? 1))
    if (weight <= 0) continue
    total += weight
    const credit = (state.get(account.accountId) || 0) + weight
    state.set(account.accountId, credit)
    if (credit > selectedCredit) {
      selected = account
      selectedCredit = credit
    }
  }
  if (!selected) return null
  state.set(selected.accountId, selectedCredit - total)
  weightedStates.set(stateKey, state)
  return selected
}

function rankAccounts (accounts, { channelId, model, strategy }) {
  const flight = account => inFlight.get(flightKey(channelId, account.accountId)) || 0
  const quota = account => quotaForModel(account, model)
  return [...accounts].sort((left, right) => {
    if (strategy !== 'round_robin') {
      const flightDelta = flight(left) - flight(right)
      if (flightDelta !== 0) return flightDelta
    }
    if (strategy === 'smart') {
      const quotaDelta = (quota(right) ?? -1) - (quota(left) ?? -1)
      if (quotaDelta !== 0) return quotaDelta
      const healthDelta = Number(right.healthScore ?? 1) - Number(left.healthScore ?? 1)
      if (healthDelta !== 0) return healthDelta
    }
    const selectedDelta = (Number(left.lastSelectedAt) || 0) - (Number(right.lastSelectedAt) || 0)
    if (selectedDelta !== 0) return selectedDelta
    return String(left.accountId).localeCompare(String(right.accountId))
  })
}

export function selectAntigravityAccount ({
  store,
  channelId,
  model,
  conversationId,
  options = {},
  excluded = new Set()
}) {
  const now = Date.now()
  const accounts = store.listAccounts()
  let available = accounts.filter(account =>
    account.enabled !== false &&
    !excluded.has(account.accountId) &&
    !activeCooldown(account, model, now)
  )
  if (available.length === 0) return null
  const highestPriority = Math.max(...available.map(item => Number(item.priority) || 0))
  available = available.filter(item => (Number(item.priority) || 0) === highestPriority)

  const protectionThreshold = Math.max(0, Math.min(1, Number(options.quotaProtectionThreshold) || 0))
  if (protectionThreshold > 0) {
    const protectedIds = new Set(
      Array.isArray(options.quotaProtectionModels)
        ? options.quotaProtectionModels.map(canonicalModelKey)
        : String(options.quotaProtectionModels || '').split(',').map(canonicalModelKey)
    )
    if (protectedIds.has(canonicalModelKey(model)) || protectedIds.has('*')) {
      const aboveThreshold = available.filter(account => {
        const remaining = quotaForModel(account, model)
        return remaining === null || remaining > protectionThreshold
      })
      // 保留兜底：所有账号都低于阈值时仍选剩余最多的账号，避免机器人整体失联。
      if (aboveThreshold.length > 0) available = aboveThreshold
    }
  }

  const strategy = LOAD_BALANCE_STRATEGIES.has(options.loadBalanceStrategy)
    ? options.loadBalanceStrategy
    : 'smart'
  const bindingKey = `${channelId}:${conversationId || ''}:${canonicalModelKey(model)}`
  const bound = sessionBindings.get(bindingKey)
  let selected = bound && bound.touchedAt + SESSION_TTL_MS > now
    ? available.find(item => item.accountId === bound.accountId)
    : null
  if (!selected) {
    selected = strategy === 'weighted_round_robin'
      ? selectWeighted(available, `${channelId}:${canonicalModelKey(model)}`)
      : rankAccounts(available, { channelId, model, strategy })[0]
  }
  if (!selected) return null
  store.updateAccount(selected.accountId, {
    lastSelectedAt: now,
    cooldowns: Object.fromEntries(
      Object.entries(selected.cooldowns || {}).filter(([, until]) => Number(until) > now)
    )
  })
  sessionBindings.set(bindingKey, { accountId: selected.accountId, touchedAt: now })
  const key = flightKey(channelId, selected.accountId)
  inFlight.set(key, (inFlight.get(key) || 0) + 1)
  return selected
}

function releaseAccount (channelId, accountId) {
  const key = flightKey(channelId, accountId)
  const next = Math.max(0, (inFlight.get(key) || 1) - 1)
  if (next > 0) inFlight.set(key, next)
  else inFlight.delete(key)
}

function quotaResetAt (payload, fallbackMs, retryAfter = '') {
  const retrySeconds = Number(retryAfter)
  if (Number.isFinite(retrySeconds) && retrySeconds >= 0) {
    return Date.now() + retrySeconds * 1000
  }
  const retryDate = Date.parse(retryAfter)
  if (Number.isFinite(retryDate) && retryDate > Date.now()) return retryDate
  const raw = JSON.stringify(payload || {})
  const timestamps = [...raw.matchAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g)]
    .map(match => Date.parse(match[0]))
    .filter(value => Number.isFinite(value) && value > Date.now())
  if (timestamps.length > 0) return Math.min(...timestamps)
  const retryDelay = raw.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i)
  if (retryDelay) return Date.now() + Number(retryDelay[1]) * 1000
  return Date.now() + fallbackMs
}

function recordFailure (store, account, model, status, payload, message, retryAfter = '') {
  let cooldownMs = 0
  if (status === 429) cooldownMs = 4 * 60 * 60 * 1000
  else if (status === 403) cooldownMs = 15 * 60 * 1000
  else if ([408, 500, 502, 503, 504].includes(status)) {
    const level = Math.min(4, Math.max(0, Number(account.failures) || 0))
    cooldownMs = 60 * 1000 * (2 ** level)
  }
  const cooldowns = { ...(account.cooldowns || {}) }
  if (cooldownMs > 0) {
    cooldowns[canonicalModelKey(model) || '*'] = quotaResetAt(payload, cooldownMs, retryAfter)
  }
  store.updateAccount(account.accountId, {
    cooldowns,
    failures: (Number(account.failures) || 0) + 1,
    healthScore: Math.max(0, Number(account.healthScore ?? 1) - (status === 429 ? 0.2 : 0.1)),
    lastError: String(message || `HTTP ${status}`).slice(0, 300),
    lastErrorAt: Date.now()
  })
}

function recordSuccess (store, account) {
  store.updateAccount(account.accountId, {
    failures: 0,
    healthScore: Math.min(1, Number(account.healthScore ?? 1) + 0.05),
    lastError: '',
    lastSuccessAt: Date.now()
  })
}

async function postWithAccount ({ credential, apiBase, pathname, body, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const response = await fetch(`${normalizeAntigravityApiBase(apiBase)}${pathname}`, {
    method: 'POST',
    headers: buildAntigravityHeaders(credential.accessToken),
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs)
  })
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}

async function requestJson ({
  dataDir,
  channelId,
  apiBase,
  pathname,
  model,
  conversationId,
  buildBody,
  options = {}
}) {
  const store = new AntigravityCredentialStore(dataDir, channelId)
  const accountCount = store.listAccounts().filter(item => item.enabled !== false).length
  if (accountCount === 0) throw new Error('Antigravity OAuth 没有已启用账号')
  const attempted = new Set()
  let lastError

  while (attempted.size < accountCount) {
    const selected = selectAntigravityAccount({
      store, channelId, model, conversationId, options, excluded: attempted
    })
    if (!selected) break
    attempted.add(selected.accountId)
    try {
      let credential
      try {
        credential = await getAntigravityCredential({
          dataDir, channelId, accountId: selected.accountId
        })
      } catch (error) {
        store.updateAccount(selected.accountId, {
          enabled: !/invalid_grant|revoked|无刷新令牌/i.test(error.message),
          failures: (Number(selected.failures) || 0) + 1,
          lastError: error.message.slice(0, 300),
          lastErrorAt: Date.now()
        })
        lastError = error
        continue
      }
      if (!credential.projectId) {
        lastError = new Error(`Antigravity 账号 ${credential.email || selected.accountId} 缺少 project_id`)
        continue
      }

      let result = await postWithAccount({
        credential, apiBase, pathname, body: buildBody(credential)
      })
      if (result.response.status === 401) {
        credential = await getAntigravityCredential({
          dataDir, channelId, accountId: selected.accountId, forceRefresh: true
        })
        result = await postWithAccount({
          credential, apiBase, pathname, body: buildBody(credential)
        })
      }
      if (result.response.ok) {
        recordSuccess(store, selected)
        return result.payload
      }

      lastError = apiError(result.payload, result.response.status)
      if (!RETRYABLE_STATUSES.has(result.response.status)) throw lastError
      recordFailure(
        store,
        selected,
        model,
        result.response.status,
        result.payload,
        lastError.message,
        result.response.headers.get('retry-after') || ''
      )
    } catch (error) {
      lastError = error
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || error instanceof TypeError) {
        recordFailure(store, selected, model, 503, {}, error.message)
      } else if (!/Antigravity API HTTP (403|408|429|500|502|503|504)/.test(error.message)) {
        throw error
      }
    } finally {
      releaseAccount(channelId, selected.accountId)
    }
  }
  if (lastError) throw lastError
  const cooling = store.listAccounts()
    .flatMap(item => [item.cooldowns?.[model], item.cooldowns?.['*']])
    .map(Number)
    .filter(until => until > Date.now())
    .sort((a, b) => a - b)[0]
  throw new Error(cooling
    ? `Antigravity 所有账号对 ${model} 均在冷却，最近恢复时间：${new Date(cooling).toLocaleString('zh-CN')}`
    : 'Antigravity 没有可用账号')
}

async function fetchCatalogForAccount ({ dataDir, channelId, apiBase, accountId }) {
  let credential = await getAntigravityCredential({ dataDir, channelId, accountId })
  let result = await postWithAccount({
    credential,
    apiBase,
    pathname: '/v1internal:fetchAvailableModels',
    body: {},
    timeoutMs: 30_000
  })
  if (result.response.status === 401) {
    credential = await getAntigravityCredential({
      dataDir, channelId, accountId, forceRefresh: true
    })
    result = await postWithAccount({
      credential,
      apiBase,
      pathname: '/v1internal:fetchAvailableModels',
      body: {},
      timeoutMs: 30_000
    })
  }
  if (!result.response.ok) throw apiError(result.payload, result.response.status)
  return { payload: result.payload, credential }
}

async function fetchQuotaSummaryForAccount ({ credential, apiBase }) {
  const result = await postWithAccount({
    credential,
    apiBase,
    pathname: '/v1internal:retrieveUserQuotaSummary',
    body: credential.projectId ? { project: credential.projectId } : {},
    timeoutMs: 30_000
  })
  if (!result.response.ok) throw apiError(result.payload, result.response.status)
  return result.payload
}

export function parseAntigravityQuotas (payload) {
  const result = {}
  if (!payload?.models || typeof payload.models !== 'object' || Array.isArray(payload.models)) return result
  for (const [model, metadata] of Object.entries(payload.models)) {
    const quota = metadata?.quotaInfo
    if (!quota || typeof quota !== 'object') continue
    const remaining = Number(quota.remainingFraction)
    result[model] = {
      remaining: Number.isFinite(remaining) ? Math.max(0, Math.min(1, remaining)) : null,
      resetTime: quota.resetTime || null
    }
  }
  return result
}

export function parseAntigravityQuotaGroups (payload) {
  if (!Array.isArray(payload?.groups)) return []
  return payload.groups.map((group, groupIndex) => ({
    displayName: String(group?.displayName || `配额组 ${groupIndex + 1}`),
    description: String(group?.description || ''),
    buckets: (Array.isArray(group?.buckets) ? group.buckets : []).map(bucket => {
      const remaining = Number(bucket?.remainingFraction)
      return {
        bucketId: String(bucket?.bucketId || ''),
        window: String(bucket?.window || ''),
        remaining: Number.isFinite(remaining)
          ? Math.max(0, Math.min(1, remaining))
          : null,
        resetTime: bucket?.resetTime || null,
        displayName: String(bucket?.displayName || ''),
        description: String(bucket?.description || '')
      }
    }).filter(bucket => bucket.bucketId || bucket.window)
  })).filter(group => group.buckets.length > 0)
}

export function mergeAntigravityQuotaWindows (quotas, groups, now = Date.now(), tier = '') {
  const result = groups.map(group => ({
    ...group,
    buckets: group.buckets.map(bucket => ({ ...bucket }))
  }))
  const isFreeTier = /free|legacy/i.test(String(tier || ''))
  if (isFreeTier) {
    for (const group of result) {
      group.buckets = group.buckets.filter(bucket => bucket.window !== '5h')
    }
  }
  const families = [
    {
      id: 'gemini',
      displayName: 'Gemini Models',
      description: 'Gemini Flash、Gemini Pro',
      matches: model => !/claude|gpt|oss|^chat_/i.test(model)
    },
    {
      id: '3p',
      displayName: 'Claude and GPT models',
      description: 'Claude Opus、Claude Sonnet、GPT-OSS',
      matches: model => /claude|gpt|oss|^chat_/i.test(model)
    }
  ]
  for (const family of families) {
    const modelEntries = Object.entries(quotas || {}).filter(([model]) => family.matches(model))
    let group = result.find(item =>
      item.buckets.some(bucket =>
        String(bucket.bucketId || '').toLowerCase().startsWith(`${family.id}-`)
      )
    )
    if (!group && modelEntries.length > 0) {
      group = {
        displayName: family.displayName,
        description: family.description,
        buckets: []
      }
      result.push(group)
    }
    if (!group) continue

    const deriveWindow = (window, predicate) => {
      if (group.buckets.some(bucket => bucket.window === window)) return true
      const candidates = modelEntries
        .map(([, quota]) => ({
          remaining: Number(quota?.remaining),
          resetTime: quota?.resetTime || null,
          resetAt: Date.parse(quota?.resetTime || '')
        }))
        .filter(item => Number.isFinite(item.remaining) && predicate(item.resetAt))
      if (candidates.length === 0) return false
      const resetTimes = candidates.filter(item => Number.isFinite(item.resetAt))
      group.buckets.push({
        bucketId: `${family.id}-${window}`,
        window,
        remaining: Math.min(...candidates.map(item => item.remaining)),
        resetTime: resetTimes.length > 0
          ? new Date(Math.min(...resetTimes.map(item => item.resetAt))).toISOString()
          : null,
        displayName: window === '5h' ? '5 Hour Limit' : 'Weekly Limit',
        description: '',
        source: 'model-quota'
      })
      return true
    }
    const hasFiveHour = isFreeTier
      ? group.buckets.some(bucket => bucket.window === '5h')
      : deriveWindow('5h', resetAt =>
          Number.isFinite(resetAt) &&
          resetAt >= now - 5 * 60_000 &&
          resetAt <= now + 6 * 60 * 60_000
        )
    const hasWeekly = deriveWindow('weekly', resetAt =>
      Number.isFinite(resetAt) && resetAt > now + 6 * 60 * 60_000
    )
    const expectedWindows = isFreeTier
      ? [['weekly', hasWeekly]]
      : [['5h', hasFiveHour], ['weekly', hasWeekly]]
    for (const [window, exists] of expectedWindows) {
      if (exists) continue
      group.buckets.push({
        bucketId: `${family.id}-${window}`,
        window,
        remaining: null,
        resetTime: null,
        displayName: window === '5h' ? '5 Hour Limit' : 'Weekly Limit',
        description: '上游暂未返回该额度窗口',
        source: 'unavailable'
      })
    }
    group.buckets.sort((left, right) => {
      const order = { '5h': 0, weekly: 1 }
      return (order[left.window] ?? 9) - (order[right.window] ?? 9)
    })
  }
  return result
}

export async function refreshAntigravityQuotas ({ dataDir, channelId, apiBase, accountId } = {}) {
  const store = new AntigravityCredentialStore(dataDir, channelId)
  const targets = store.listAccounts().filter(item =>
    item.enabled !== false && (!accountId || item.accountId === String(accountId))
  )
  if (targets.length === 0) throw new Error('没有可查询额度的 Antigravity 账号')
  const queue = targets.map((account, index) => ({ account, index }))
  const results = Array(targets.length)
  const worker = async () => {
    while (queue.length > 0) {
      const { account, index } = queue.shift()
      try {
        const catalog = await fetchCatalogForAccount({
          dataDir, channelId, apiBase, accountId: account.accountId
        })
        const [entitlements, quotaSummary] = await Promise.all([
          fetchAntigravityEntitlements({
            apiBase,
            accessToken: catalog.credential.accessToken
          }).catch(() => null),
          fetchQuotaSummaryForAccount({
            credential: catalog.credential,
            apiBase
          }).catch(() => null)
        ])
        const quotas = parseAntigravityQuotas(catalog.payload)
        const quotaGroups = mergeAntigravityQuotaWindows(
          quotas,
          parseAntigravityQuotaGroups(quotaSummary),
          Date.now(),
          entitlements?.tier || account.tier || ''
        )
        const cooldowns = Object.fromEntries(
          Object.entries(account.cooldowns || {}).filter(([, until]) => Number(until) > Date.now())
        )
        for (const [model, quota] of Object.entries(quotas)) {
          const resetAt = Date.parse(quota.resetTime || '')
          if (quota.remaining !== null && quota.remaining <= 0 &&
              Number.isFinite(resetAt) && resetAt > Date.now()) {
            cooldowns[model] = resetAt
          } else if (quota.remaining !== null && quota.remaining > 0) {
            delete cooldowns[model]
          }
        }
        store.updateAccount(account.accountId, {
          quotas,
          quotaGroups,
          cooldowns,
          quotaUpdatedAt: Date.now(),
          ...(entitlements?.tier ? { tier: entitlements.tier } : {}),
          ...(entitlements?.projectId ? { projectId: entitlements.projectId } : {}),
          ...(entitlements?.credits ? { credits: entitlements.credits } : {}),
          lastError: ''
        })
        results[index] = {
          accountId: account.accountId,
          ok: true,
          models: parseAntigravityModels(catalog.payload),
          quotaGroups
        }
      } catch (error) {
        store.updateAccount(account.accountId, {
          ...(/invalid_grant|revoked|无刷新令牌/i.test(error.message) ? { enabled: false } : {}),
          lastError: error.message.slice(0, 300),
          lastErrorAt: Date.now()
        })
        results[index] = {
          accountId: account.accountId,
          ok: false,
          error: error.message,
          models: []
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker))
  return results
}

export async function discoverAntigravityModels ({ dataDir, channelId, apiBase } = {}) {
  const results = await refreshAntigravityQuotas({ dataDir, channelId, apiBase })
  const models = [...new Set(results.flatMap(item => item.models || []))]
  if (models.length === 0) {
    const error = results.find(item => !item.ok)?.error
    throw new Error(error || 'Antigravity 未返回可用模型')
  }
  return models
}

export function parseAntigravityModels (payload) {
  const source = payload?.models
  const ids = Array.isArray(source)
    ? source.map(item => typeof item === 'string' ? item : item?.id || item?.name)
    : (source && typeof source === 'object' ? Object.keys(source) : [])
  return [...new Set(ids.map(id => String(id || '').trim()).filter(Boolean))]
}

export class AntigravityClient extends AbstractClient {
  get adapterType () { return 'antigravity' }

  constructor (opts) {
    super(opts)
    this.channelId = opts.channelId
    this.dataDir = opts.dataDir || opts.storage?.dataDir
  }

  async _sendMessage (histories, options = {}) {
    const model = String(options.model || this.options.model || '').trim()
    if (!model) throw new Error('Antigravity 未指定模型')

    const system = histories.find(item => item.role === 'system')
    const contents = histories
      .filter(item => item.role !== 'system')
      .map(fromChaiteConverter)
      .filter(Boolean)
    const declarations = (options.disableTools ? [] : (options.tools || []))
      .map(toGeminiFunctionDeclaration)
      .filter(Boolean)
    const generationConfig = {
      maxOutputTokens: options.maxTokens || 2048,
      ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
      ...(options.responseJsonSchema ? { responseJsonSchema: options.responseJsonSchema } : {}),
      ...(!options.responseJsonSchema && options.responseSchema
        ? { responseSchema: options.responseSchema }
        : {})
    }
    if (options.enableReasoning) {
      const requested = String(options.thinkingLevel || options.reasoningEffort || 'LOW').toUpperCase()
      generationConfig.thinkingConfig = {
        thinkingLevel: requested === 'OFF'
          ? 'MINIMAL'
          : (['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'].includes(requested) ? requested : 'LOW'),
        includeThoughts: true
      }
    }
    const inner = {
      contents,
      generationConfig,
      ...(system
        ? { systemInstruction: { parts: [{ text: system.content?.[0]?.text || '' }] } }
        : {}),
      ...(declarations.length > 0
        ? {
            tools: [{ functionDeclarations: declarations }],
            toolConfig: {
              functionCallingConfig: {
                mode: options.toolChoice || options.functionCallingMode || 'VALIDATED'
              }
            }
          }
        : {})
    }

    const payload = wrapRequest({
      request: inner,
      model,
      projectId: '',
      conversationId: options.conversationId
    })
    const response = await requestJson({
      dataDir: this.dataDir,
      channelId: this.channelId,
      apiBase: this.options.baseUrl,
      pathname: '/v1internal:generateContent',
      model,
      conversationId: options.conversationId,
      buildBody: credential => ({ ...payload, project: credential.projectId }),
      options: this.options
    })
    return intoChaiteConverter(response?.response || response, model)
  }
}
