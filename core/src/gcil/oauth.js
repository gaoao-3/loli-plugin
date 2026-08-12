/**
 * GCIL（Gemini CLI）OAuth — 参考 gcli2api 实现
 * 使用 Gemini CLI 官方 client 凭据，直连 cloudcode-pa（Code Assist）端点。
 */
import { createGoogleOAuthProvider } from '../google-oauth/provider.js'
import { quotaCooldownMs } from './cooldown.js'

export const GCIL_API_BASE = 'https://cloudcode-pa.googleapis.com'
export const GCIL_CLI_VERSION = '0.35.2'
export const GCIL_CLIENT_ID = String(process.env.LOLI_GCIL_CLIENT_ID || '').trim()
export const GCIL_CLIENT_SECRET = String(process.env.LOLI_GCIL_CLIENT_SECRET || '').trim()
export const GCIL_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GCIL_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
]
const ACCOUNT_TEST_TIMEOUT_MS = 30_000

function parseRetryDelayValue (value) {
  const input = String(value || '').trim().toLowerCase()
  if (!input) return 0
  let totalSeconds = 0
  let matchedLength = 0
  for (const match of input.matchAll(/(\d+(?:\.\d+)?)(m|s)/g)) {
    matchedLength += match[0].length
    totalSeconds += Number(match[1]) * (match[2] === 'm' ? 60 : 1)
  }
  return matchedLength === input.length && totalSeconds > 0
    ? Math.round(totalSeconds * 1000)
    : 0
}

export function retryDelayMs (payload, headers, fallbackMs) {
  const retryAfter = typeof headers?.get === 'function'
    ? headers.get('retry-after')
    : headers?.['retry-after'] ?? headers?.retryAfter
  if (retryAfter !== undefined && retryAfter !== null && String(retryAfter).trim()) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000)
    const date = Date.parse(String(retryAfter))
    if (Number.isFinite(date) && date > Date.now()) return date - Date.now()
  }
  const details = Array.isArray(payload?.error?.details) ? payload.error.details : []
  for (const detail of details) {
    const parsed = parseRetryDelayValue(detail?.retryDelay)
    if (parsed > 0) return parsed
  }
  return Math.max(0, Number(fallbackMs) || 0)
}

export function buildGcilUserAgent (model = '') {
  const base = `GeminiCLI/${GCIL_CLI_VERSION}`
  const suffix = '(win32; x64; cloud-shell)'
  return model ? `${base}/${model} ${suffix}` : `${base} ${suffix}`
}

const provider = createGoogleOAuthProvider({
  name: 'gcil',
  label: 'GCIL',
  clientId: GCIL_CLIENT_ID,
  clientSecret: GCIL_CLIENT_SECRET,
  scopes: GCIL_SCOPES,
  defaultApiBase: GCIL_API_BASE,
  userAgent: buildGcilUserAgent(),
  ideType: 'ANTIGRAVITY',
  resourceManagerFirst: true,
  clientIdEnv: 'LOLI_GCIL_CLIENT_ID',
  clientSecretEnv: 'LOLI_GCIL_CLIENT_SECRET'
})

export const GcilCredentialStore = provider.CredentialStore

export function beginGcilOAuth (opts) {
  return provider.beginOAuth(opts)
}

export function completeGcilOAuth (callbackUrl, expectedChannelId) {
  return provider.completeOAuth(callbackUrl, expectedChannelId)
}

export function importGcilCredential (opts) {
  return provider.importCredential(opts)
}

export function getGcilCredential (opts) {
  return provider.getCredential(opts)
}

export function getGcilOAuthStatus (opts) {
  return provider.getOAuthStatus(opts)
}

export function removeGcilCredential (opts) {
  return provider.removeCredential(opts)
}

export function updateGcilAccount (opts) {
  return provider.updateAccount(opts)
}

export function buildGcilHeaders (accessToken, model = '') {
  return {
    ...provider.authHeaders(accessToken),
    'User-Agent': buildGcilUserAgent(model)
  }
}

export function normalizeGcilApiBase (value) {
  return provider.safeApiBase(value)
}

function gcilApiError (payload, status) {
  const detail = payload?.error?.message || payload?.error || payload?.message
  const suffix = typeof detail === 'string' && detail.trim()
    ? `：${detail.trim().slice(0, 500)}`
    : ''
  const error = new Error(`GCIL API HTTP ${status}${suffix}`)
  error.status = status
  error.payload = payload
  return error
}

const PROBE_429_COOLDOWN_MS = 5 * 60_000
const PROBE_DEFAULT_COOLDOWN_MS = 60_000

function errorStatusCode (message) {
  const match = String(message || '').match(/HTTP (\d{3})/i)
  return match ? Number(match[1]) : 0
}

function recordAccountFailure (store, accountId, error, { model, payload, headers } = {}) {
  const current = store.getAccount(accountId)
  if (!current) return
  const message = String(error?.message || error || 'GCIL 账号检验失败')
  const status = Number(error?.status) || errorStatusCode(message)
  const patch = {
    enabled: /invalid_grant|revoked/i.test(message) ? false : current.enabled !== false,
    failures: (Number(current.failures) || 0) + 1,
    healthScore: Math.max(0, Number(current.healthScore ?? 1) - 0.2),
    lastError: message.slice(0, 300),
    lastErrorAt: Date.now()
  }
  // 429/403 记录模型级冷却；日配额耗尽冷却到太平洋午夜（与 GcilClient 一致）
  if (status === 429 || status === 403) {
    const cooldownMs = retryDelayMs(
      payload || error?.payload,
      headers || error?.headers,
      quotaCooldownMs(
        message,
        status === 429 ? PROBE_429_COOLDOWN_MS : PROBE_DEFAULT_COOLDOWN_MS
      )
    )
    patch.cooldowns = {
      ...(current.cooldowns || {}),
      [model || '*']: Date.now() + cooldownMs
    }
  }
  store.updateAccount(accountId, patch)
}

function recordAccountSuccess (store, accountId, patch = {}) {
  const current = store.getAccount(accountId)
  if (!current) return null
  return store.updateAccount(accountId, {
    ...patch,
    failures: 0,
    healthScore: Math.min(1, Number(current.healthScore ?? 1) + 0.05),
    lastError: '',
    lastSuccessAt: Date.now()
  })
}

export async function probeGcilAccount ({ dataDir, channelId, accountId, apiBase } = {}) {
  const store = new GcilCredentialStore(dataDir, channelId)
  const startedAt = Date.now()
  try {
    const credential = await getGcilCredential({ dataDir, channelId, accountId })
    const result = provider.extractProjectAndTier(
      await provider.loadProject(apiBase, credential.accessToken)
    )
    const projectId = String(result.projectId || credential.projectId || '')
    if (!projectId) throw new Error('GCIL loadCodeAssist 未返回 project_id')
    const tier = String(result.tier || credential.tier || '')
    recordAccountSuccess(store, accountId, { projectId, tier, credits: result.credits || [] })
    return { ok: true, tier, projectId, latencyMs: Date.now() - startedAt }
  } catch (error) {
    recordAccountFailure(store, accountId, error)
    return { ok: false, error: error?.message || 'GCIL 账号检验失败' }
  }
}

export async function testGcilAccount ({ dataDir, channelId, accountId, apiBase, model = 'gemini-2.5-flash' } = {}) {
  const store = new GcilCredentialStore(dataDir, channelId)
  const selectedModel = String(model || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash'
  const startedAt = Date.now()
  try {
    const credential = await getGcilCredential({ dataDir, channelId, accountId })
    if (!credential.projectId) throw new Error('GCIL 账号缺少 project_id，请先执行账号检验')
    const response = await fetch(`${normalizeGcilApiBase(apiBase)}/v1internal:generateContent`, {
      method: 'POST',
      headers: buildGcilHeaders(credential.accessToken, selectedModel),
      body: JSON.stringify({
        model: selectedModel,
        project: credential.projectId,
        request: {
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          generationConfig: { maxOutputTokens: 16 }
        }
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(ACCOUNT_TEST_TIMEOUT_MS)
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = gcilApiError(payload, response.status)
      recordAccountFailure(store, accountId, error, {
        model: selectedModel,
        payload,
        headers: response.headers
      })
      return { ok: false, error: error.message }
    }
    const parts = payload?.response?.candidates?.[0]?.content?.parts ||
      payload?.candidates?.[0]?.content?.parts || []
    const reply = parts.map(part => part?.text || '').join('').trim().slice(0, 120)
    recordAccountSuccess(store, accountId)
    return { ok: true, latencyMs: Date.now() - startedAt, reply }
  } catch (error) {
    recordAccountFailure(store, accountId, error)
    return { ok: false, error: error?.message || 'GCIL 账号消息测试失败' }
  }
}

export async function exportGcilCredential ({ dataDir, channelId, accountId } = {}) {
  const credential = await getGcilCredential({ dataDir, channelId, accountId })
  return {
    access_token: credential.accessToken,
    refresh_token: credential.refreshToken,
    client_id: GCIL_CLIENT_ID,
    client_secret: GCIL_CLIENT_SECRET,
    project_id: credential.projectId,
    expiry: new Date(Number(credential.expiresAt) || 0).toISOString(),
    scopes: Array.isArray(credential.scopes) && credential.scopes.length > 0
      ? credential.scopes
      : GCIL_SCOPES,
    token_uri: GCIL_TOKEN_URL
  }
}
