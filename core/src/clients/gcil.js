/**
 * GCIL（Gemini CLI）客户端
 * 参考 gcli2api：OAuth 凭证直连 cloudcode-pa 的 v1internal:generateContent，
 * 请求体为 { model, project, request } 包装，多账号按模型冷却轮询。
 */
import { AbstractClient } from './abstract.js'
import { toGeminiFunctionDeclaration } from './gemini.js'
import { fromChaiteConverter, intoChaiteConverter } from '../converters/gemini.js'
import {
  GcilCredentialStore,
  buildGcilHeaders,
  getGcilCredential,
  normalizeGcilApiBase,
  retryDelayMs
} from '../gcil/oauth.js'
import {
  buildContinuationContents,
  isPureTextTruncation,
  mergeTruncatedResponses
} from '../gcil/anti-truncation.js'
import { quotaCooldownMs } from '../gcil/cooldown.js'

const REQUEST_TIMEOUT_MS = 300_000
const RETRYABLE_STATUSES = new Set([403, 408, 429, 500, 502, 503, 504])
const DEFAULT_COOLDOWN_MS = 60_000
const inFlight = new Map()

/** GCIL 可用模型（实测于 cloudcode-pa；gemini-3.5-flash 返回 404 不可用） */
export const GCIL_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite'
]

function apiError (payload, status) {
  const detail = payload?.error?.message || payload?.error || payload?.message
  const suffix = typeof detail === 'string' && detail.trim() ? `：${detail.trim().slice(0, 500)}` : ''
  return new Error(`GCIL API HTTP ${status}${suffix}`)
}

function canonicalModelKey (model) {
  return String(model || '').trim().toLowerCase()
}

function flightKey (channelId, accountId) {
  return `${channelId}:${accountId}`
}

function activeCooldown (account, model, now = Date.now()) {
  const key = canonicalModelKey(model)
  const modelCooldown = Object.entries(account?.cooldowns || {})
    .find(([candidate]) => canonicalModelKey(candidate) === key)?.[1]
  return Math.max(Number(modelCooldown) || 0, Number(account?.cooldowns?.['*']) || 0) > now
}

/** 选择账号：跳过冷却/禁用，按在途最少 + 最久未用排序 */
function selectAccount (store, channelId, model, excluded) {
  const now = Date.now()
  const available = store.listAccounts()
    .filter(item => item.enabled !== false)
    .filter(item => !excluded.has(item.accountId))
    .filter(item => !activeCooldown(item, model, now))
  if (available.length === 0) return null
  available.sort((left, right) => {
    const flightDiff = (inFlight.get(flightKey(channelId, left.accountId)) || 0) -
      (inFlight.get(flightKey(channelId, right.accountId)) || 0)
    if (flightDiff !== 0) return flightDiff
    return (Number(left.lastSelectedAt) || 0) - (Number(right.lastSelectedAt) || 0)
  })
  const selected = available[0]
  store.updateAccount(selected.accountId, { lastSelectedAt: now })
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

function recordFailure (store, account, model, status, message, payload, headers) {
  const cooldowns = { ...(account.cooldowns || {}) }
  if (status === 429 || status === 403) {
    const fallback = quotaCooldownMs(message, status === 429 ? 5 * 60_000 : DEFAULT_COOLDOWN_MS)
    cooldowns[model || '*'] = Date.now() + retryDelayMs(payload, headers, fallback)
  }
  store.updateAccount(account.accountId, {
    cooldowns,
    failures: (Number(account.failures) || 0) + 1,
    healthScore: Math.max(0, Number(account.healthScore ?? 1) - 0.2),
    lastError: String(message || '').slice(0, 300),
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

async function postWithAccount ({ credential, apiBase, model, body, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const response = await fetch(`${normalizeGcilApiBase(apiBase)}/v1internal:generateContent`, {
    method: 'POST',
    headers: buildGcilHeaders(credential.accessToken, model),
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs)
  })
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}

async function requestJson ({ dataDir, channelId, apiBase, model, buildBody }) {
  const store = new GcilCredentialStore(dataDir, channelId)
  const accountCount = store.listAccounts().filter(item => item.enabled !== false).length
  if (accountCount === 0) throw new Error('GCIL OAuth 没有已启用账号，请先在仪表盘登录')
  const attempted = new Set()
  let lastError

  while (attempted.size < accountCount) {
    const selected = selectAccount(store, channelId, model, attempted)
    if (!selected) break
    attempted.add(selected.accountId)
    try {
      let credential
      try {
        credential = await getGcilCredential({ dataDir, channelId, accountId: selected.accountId })
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
        lastError = new Error(`GCIL 账号 ${credential.email || selected.accountId} 缺少 project_id`)
        continue
      }

      let result = await postWithAccount({
        credential, apiBase, model, body: buildBody(credential)
      })
      if (result.response.status === 401) {
        credential = await getGcilCredential({
          dataDir, channelId, accountId: selected.accountId, forceRefresh: true
        })
        result = await postWithAccount({
          credential, apiBase, model, body: buildBody(credential)
        })
      }
      if (result.response.ok) {
        recordSuccess(store, selected)
        return result.payload
      }

      lastError = apiError(result.payload, result.response.status)
      if (!RETRYABLE_STATUSES.has(result.response.status)) throw lastError
      recordFailure(
        store, selected, model, result.response.status,
        lastError.message, result.payload, result.response.headers
      )
    } catch (error) {
      lastError = error
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || error instanceof TypeError) {
        recordFailure(store, selected, model, 503, error.message)
      } else if (!/GCIL API HTTP (403|408|429|500|502|503|504)/.test(error.message)) {
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
    ? `GCIL 所有账号对 ${model} 均在冷却，最近恢复时间：${new Date(cooling).toLocaleString('zh-CN')}`
    : 'GCIL 没有可用账号')
}

export class GcilClient extends AbstractClient {
  get adapterType () { return 'gcil' }

  constructor (opts) {
    super(opts)
    this.channelId = opts.channelId
    this.dataDir = opts.dataDir || opts.storage?.dataDir
  }

  async _sendMessage (histories, options = {}) {
    const requestedModel = String(options.model || this.options.model || '').trim()
    if (!requestedModel) throw new Error('GCIL 未指定模型')
    const { model, googleSearch } = normalizeGcilModel(requestedModel)

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
      ...(declarations.length > 0 || googleSearch
        ? {
            tools: [
              ...(declarations.length > 0 ? [{ functionDeclarations: declarations }] : []),
              ...(googleSearch ? [{ googleSearch: {} }] : [])
            ],
            ...(declarations.length > 0
              ? {
                  toolConfig: {
                    functionCallingConfig: {
                      mode: options.toolChoice || options.functionCallingMode || 'VALIDATED'
                    }
                  }
                }
              : {})
          }
        : {})
    }

    const send = request => requestJson({
      dataDir: this.dataDir,
      channelId: this.channelId,
      apiBase: this.options.baseUrl,
      model,
      buildBody: credential => ({ model, project: credential.projectId, request })
    })
    let response = await send(inner)
    let merged = response?.response || response
    const rounds = Math.max(0, Math.min(10,
      Math.trunc(Number(this.options.maxAntiTruncationRounds ?? 2)) || 0
    ))
    if (this.options.antiTruncation !== false) {
      for (let round = 0; round < rounds && isPureTextTruncation(merged); round++) {
        const continuationContents = buildContinuationContents(contents, merged)
        response = await send({ ...inner, contents: continuationContents })
        merged = mergeTruncatedResponses(merged, response?.response || response)
      }
    }
    return intoChaiteConverter(merged, model)
  }
}

export function normalizeGcilModel (model) {
  const value = String(model || '').trim()
  const googleSearch = /-search$/i.test(value)
  return {
    model: googleSearch ? value.slice(0, -7) : value,
    googleSearch
  }
}
