/**
 * Google OAuth provider 工厂
 * Antigravity 与 GCIL（Gemini CLI）共享同一套流程：
 * 本地回调换码 → loadCodeAssist/onboardUser 发现 project → AES-256-GCM 加密落盘。
 * 差异仅在 client 凭据、scopes、API Base、User-Agent 与存储目录。
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID
} from 'node:crypto'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const FLOW_TTL_MS = 15 * 60 * 1000
const TOKEN_REFRESH_BUFFER_MS = 3 * 60 * 1000
const REQUEST_TIMEOUT_MS = 30_000
const pendingFlows = new Map()

/**
 * @param {Object} profile
 * @param {string} profile.name - 存储目录名（data/oauth/<name>）
 * @param {string} profile.label - 错误信息中的展示名
 * @param {string} profile.clientId
 * @param {string} profile.clientSecret
 * @param {string[]} profile.scopes
 * @param {string} profile.defaultApiBase
 * @param {string} profile.userAgent
 * @param {string} [profile.ideType='ANTIGRAVITY'] - loadCodeAssist/onboardUser 元数据
 * @param {boolean} [profile.resourceManagerFirst=false] - GCIL 标准模式同 gcli2api：Resource Manager 优先
 */
export function createGoogleOAuthProvider (profile) {
  const {
    name,
    label,
    clientId,
    clientSecret,
    scopes,
    defaultApiBase,
    userAgent,
    ideType = 'ANTIGRAVITY',
    resourceManagerFirst = false,
    clientIdEnv = '',
    clientSecretEnv = ''
  } = profile

  function assertClientCredentials () {
    const missing = []
    if (!String(clientId || '').trim()) missing.push(clientIdEnv || 'OAuth client ID')
    if (!String(clientSecret || '').trim()) missing.push(clientSecretEnv || 'OAuth client secret')
    if (missing.length > 0) {
      throw new Error(`${label} OAuth 客户端凭据未配置，请设置环境变量：${missing.join('、')}`)
    }
  }

  function safeApiBase (value) {
    const url = new URL(String(value || defaultApiBase))
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`${label} API Base 仅支持 HTTP/HTTPS`)
    }
    if (url.username || url.password) throw new Error(`${label} API Base 不能包含账号密码`)
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  }

  function errorDetail (payload, status) {
    const value = payload?.error?.message || payload?.error || payload?.message
    return typeof value === 'string' && value.trim()
      ? value.trim().slice(0, 500)
      : `HTTP ${status}`
  }

  async function readJsonResponse (response, action) {
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(`${action}失败：${errorDetail(payload, response.status)}`)
      error.status = response.status
      error.payload = payload
      error.headers = response.headers
      throw error
    }
    return payload
  }

  async function postForm (url, data, action) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    return readJsonResponse(response, action)
  }

  function atomicWrite (file, data, mode = 0o600) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
    let fd
    try {
      fd = fs.openSync(temp, 'wx', mode)
      fs.writeFileSync(fd, data)
      fs.fsyncSync(fd)
      fs.closeSync(fd)
      fd = undefined
      fs.renameSync(temp, file)
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd) } catch {}
      }
      try { fs.unlinkSync(temp) } catch {}
    }
  }

  /**
   * OAuth 凭证与渠道配置分离存储。凭证使用 AES-256-GCM 加密；
   * 本机随机密钥单独保存在 data/oauth/<name>/.vault-key。
   */
  class CredentialStore {
    constructor (dataDir, channelId) {
      if (!dataDir) throw new Error(`缺少 ${label} 凭证存储目录`)
      if (!channelId) throw new Error(`缺少 ${label} 渠道 ID`)
      this.root = path.join(dataDir, 'oauth', name)
      this.keyFile = path.join(this.root, '.vault-key')
      const fileId = createHash('sha256').update(String(channelId)).digest('hex')
      this.credentialFile = path.join(this.root, 'credentials', `${fileId}.enc`)
    }

    #key () {
      fs.mkdirSync(this.root, { recursive: true })
      if (!fs.existsSync(this.keyFile)) {
        try {
          atomicWrite(this.keyFile, randomBytes(32))
        } catch (error) {
          // 并发首次登录时，另一个请求可能刚刚创建了同一密钥。
          if (!fs.existsSync(this.keyFile)) throw error
        }
      }
      const key = fs.readFileSync(this.keyFile)
      if (key.length !== 32) throw new Error(`${label} 本地凭证密钥无效`)
      return key
    }

    #readPayload () {
      if (!fs.existsSync(this.credentialFile)) return null
      try {
        const envelope = JSON.parse(fs.readFileSync(this.credentialFile, 'utf8'))
        const iv = Buffer.from(envelope.iv, 'base64')
        const tag = Buffer.from(envelope.tag, 'base64')
        const ciphertext = Buffer.from(envelope.data, 'base64')
        const decipher = createDecipheriv('aes-256-gcm', this.#key(), iv)
        decipher.setAuthTag(tag)
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
        return JSON.parse(plaintext.toString('utf8'))
      } catch {
        throw new Error(`${label} OAuth 凭证无法解密或已损坏`)
      }
    }

    #writePayload (payload) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', this.#key(), iv)
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(payload), 'utf8'),
        cipher.final()
      ])
      atomicWrite(this.credentialFile, JSON.stringify({
        version: 1,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: ciphertext.toString('base64')
      }))
    }

    #normalizeAccount (credential = {}) {
      const identity = String(
        credential.accountId ||
        credential.googleAccountId ||
        credential.email ||
        credential.projectId ||
        credential.refreshToken ||
        randomUUID()
      )
      return {
        ...credential,
        enabled: credential.enabled !== false,
        cooldowns: credential.cooldowns && typeof credential.cooldowns === 'object'
          ? credential.cooldowns
          : {},
        failures: Math.max(0, Number(credential.failures) || 0),
        healthScore: Math.max(0, Math.min(1, Number(credential.healthScore ?? 1) || 0)),
        priority: Math.max(0, Math.min(100, Math.trunc(Number(credential.priority) || 0))),
        weight: Math.max(0, Math.min(100, Number(credential.weight ?? 1) || 0)),
        lastSelectedAt: Number(credential.lastSelectedAt) || 0,
        lastSuccessAt: Number(credential.lastSuccessAt) || 0,
        accountId: String(credential.accountId || createHash('sha256').update(identity).digest('hex').slice(0, 24))
      }
    }

    listAccounts () {
      const payload = this.#readPayload()
      if (!payload) return []
      const source = payload.version === 2 && Array.isArray(payload.accounts)
        ? payload.accounts
        : [payload]
      return source.map(item => this.#normalizeAccount(item))
    }

    /** 兼容旧调用：返回第一个账号。 */
    load () {
      return this.listAccounts()[0] || null
    }

    getAccount (accountId) {
      return this.listAccounts().find(item => item.accountId === String(accountId)) || null
    }

    saveAccounts (accounts) {
      this.#writePayload({
        version: 2,
        accounts: accounts.map(item => this.#normalizeAccount(item)),
        updatedAt: Date.now()
      })
    }

    upsertAccount (credential) {
      const next = this.#normalizeAccount(credential)
      const accounts = this.listAccounts()
      const index = accounts.findIndex(item =>
        item.accountId === next.accountId ||
        (next.email && item.email && item.email.toLowerCase() === next.email.toLowerCase()) ||
        (next.refreshToken && item.refreshToken === next.refreshToken)
      )
      if (index >= 0) {
        next.accountId = accounts[index].accountId
        accounts[index] = {
          ...accounts[index],
          ...next,
          createdAt: accounts[index].createdAt || next.createdAt || Date.now()
        }
      } else {
        accounts.push(next)
      }
      this.saveAccounts(accounts)
      return index >= 0 ? accounts[index] : accounts.at(-1)
    }

    /** 兼容旧调用：保存即添加或更新一个账号。 */
    save (credential) {
      return this.upsertAccount(credential)
    }

    updateAccount (accountId, updater) {
      const accounts = this.listAccounts()
      const index = accounts.findIndex(item => item.accountId === String(accountId))
      if (index < 0) return null
      const patch = typeof updater === 'function' ? updater({ ...accounts[index] }) : updater
      accounts[index] = this.#normalizeAccount({ ...accounts[index], ...(patch || {}) })
      this.saveAccounts(accounts)
      return accounts[index]
    }

    removeAccount (accountId) {
      const accounts = this.listAccounts()
      const filtered = accounts.filter(item => item.accountId !== String(accountId))
      if (filtered.length === accounts.length) return false
      if (filtered.length > 0) this.saveAccounts(filtered)
      else this.remove()
      return true
    }

    remove () {
      try { fs.unlinkSync(this.credentialFile) } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
  }

  function authHeaders (accessToken) {
    return {
      'User-Agent': userAgent,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept-Encoding': 'gzip'
    }
  }

  async function postInternal (apiBase, pathname, accessToken, body) {
    const response = await fetch(`${safeApiBase(apiBase)}${pathname}`, {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    return readJsonResponse(response, `${label} 项目初始化`)
  }

  async function loadProject (apiBase, accessToken, extendedMetadata = false) {
    return postInternal(apiBase, '/v1internal:loadCodeAssist', accessToken, {
      metadata: {
        ideType,
        ...(extendedMetadata
          ? { platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' }
          : {})
      }
    })
  }

  function extractProjectAndTier (payload) {
    const rawProject = payload?.cloudaicompanionProject
    const projectId = typeof rawProject === 'string' ? rawProject : rawProject?.id
    // paidTier/currentTier 可能都为空（如 GCP 项目账号），退而读 allowedTiers 默认项
    const defaultAllowedTier = Array.isArray(payload?.allowedTiers)
      ? payload.allowedTiers.find(item => item?.isDefault)?.id
      : ''
    const tier = payload?.paidTier?.id || payload?.currentTier?.id || defaultAllowedTier || ''
    const credits = Array.isArray(payload?.paidTier?.availableCredits)
      ? payload.paidTier.availableCredits.map(item => ({
        creditType: String(item?.creditType || item?.type || ''),
        creditAmount: item?.creditAmount ?? item?.amount ?? null
      }))
      : []
    return { projectId: projectId || '', tier, credits }
  }

  const RESOURCE_MANAGER_URL = 'https://cloudresourcemanager.googleapis.com'
  const SERVICE_USAGE_URL = 'https://serviceusage.googleapis.com'
  const REQUIRED_SERVICES = [
    'geminicloudassist.googleapis.com',
    'cloudaicompanion.googleapis.com'
  ]

  async function listUserProjects (accessToken) {
    const projects = []
    let pageToken = ''
    // Resource Manager 默认分页，不能只看首页后就判定用户无项目。
    for (let page = 0; page < 20; page++) {
      const query = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''
      const response = await fetch(`${RESOURCE_MANAGER_URL}/v1/projects${query}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      if (!response.ok) {
        if (projects.length > 0) break
        const payload = await response.json().catch(() => ({}))
        throw new Error(`Google Cloud 项目列表读取失败：${errorDetail(payload, response.status)}`)
      }
      const payload = await response.json().catch(() => ({}))
      projects.push(...(Array.isArray(payload?.projects) ? payload.projects : []))
      pageToken = String(payload?.nextPageToken || '')
      if (!pageToken) break
    }
    return projects.filter(item => item?.lifecycleState === 'ACTIVE')
  }

  async function enableRequiredApis (accessToken, projectId, logger) {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
    for (const service of REQUIRED_SERVICES) {
      const resource = `projects/${encodeURIComponent(projectId)}/services/${encodeURIComponent(service)}`
      try {
        const check = await fetch(`${SERVICE_USAGE_URL}/v1/${resource}`, {
          headers, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        })
        const state = check.ok ? (await check.json().catch(() => ({})))?.state : ''
        if (state === 'ENABLED') continue
        const enable = await fetch(`${SERVICE_USAGE_URL}/v1/${resource}:enable`, {
          method: 'POST',
          headers,
          body: '{}',
          redirect: 'error',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        })
        if (!enable.ok) {
          logger?.(`[${label}] 启用服务 ${service} 失败: HTTP ${enable.status}`)
        }
      } catch (error) {
        logger?.(`[${label}] 启用服务 ${service} 异常: ${error.message}`)
      }
    }
  }

  async function discoverProjectViaResourceManager (accessToken, logger) {
    let projects = []
    try {
      projects = await listUserProjects(accessToken)
    } catch (error) {
      logger?.(`[${label}] Resource Manager 项目列表失败: ${error.message}`)
      return null
    }
    if (projects.length === 0) return null
    // 同 gcli2api select_default_project：优先 displayName/projectId 含 default，否则第一个
    const preferred = projects.length === 1
      ? projects[0]
      : projects.find(item =>
        /default/i.test(String(item?.displayName || '')) ||
        /default/i.test(String(item?.projectId || ''))) || projects[0]
    const projectId = String(preferred?.projectId || '')
    if (!projectId) return null
    await enableRequiredApis(accessToken, projectId, logger)
    return projectId
  }

  async function discoverProject (apiBase, accessToken, logger) {
    // GCIL 标准模式同 gcli2api：Resource Manager 优先（个人账号 loadCodeAssist 必然失败）
    if (resourceManagerFirst) {
      const projectId = await discoverProjectViaResourceManager(accessToken, logger)
      if (projectId) {
        // 项目已得，补查 tier（失败不影响）
        let tierId = ''
        try {
          tierId = extractProjectAndTier(await loadProject(apiBase, accessToken)).tier
        } catch { /* tier 留空 */ }
        return { projectId, tier: tierId, credits: [] }
      }
      logger?.(`[${label}] Resource Manager 无可用项目，尝试 loadCodeAssist/onboardUser`)
    }

    // Antigravity 路径：loadCodeAssist → onboardUser → Resource Manager
    let loadPayload
    let tierId = 'LEGACY'
    try {
      loadPayload = await loadProject(apiBase, accessToken)
      const found = extractProjectAndTier(loadPayload)
      if (found.projectId) return found
      tierId = found.tier || 'LEGACY'
      logger?.(`[${label}] loadCodeAssist 未返回项目，使用 tier ${tierId} 尝试 onboardUser`)
    } catch (error) {
      logger?.(`[${label}] loadCodeAssist 未返回项目，尝试 onboardUser: ${error.message}`)
    }

    // 首次 load 已返回 allowedTiers 时直接复用；只在缺失时补一次完整 metadata 查询。
    if (tierId === 'LEGACY') {
      try {
        const tierPayload = loadPayload || await loadProject(apiBase, accessToken, true)
        const defaultTier = Array.isArray(tierPayload?.allowedTiers)
          ? tierPayload.allowedTiers.find(item => item?.isDefault)?.id
          : ''
        tierId = defaultTier || 'LEGACY'
      } catch { /* 保留 LEGACY */ }
    }
    const request = {
      tierId,
      metadata: {
        ideType,
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI'
      }
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = await postInternal(apiBase, '/v1internal:onboardUser', accessToken, request)
        if (result?.done) {
          const rawProject = result?.response?.cloudaicompanionProject
          const projectId = typeof rawProject === 'string' ? rawProject : rawProject?.id
          if (projectId) return { projectId, tier: tierId, credits: [] }
          logger?.(`[${label}] onboardUser 已完成但未返回 project_id，尝试 Resource Manager 项目列表`)
          break
        }
      } catch (error) {
        logger?.(`[${label}] onboardUser 失败，尝试项目列表兜底: ${error.message}`)
        break
      }
      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    // 兜底：Resource Manager 列出活跃项目并自动启用必需 API（同 gcli2api 标准模式）
    const fallbackProjectId = await discoverProjectViaResourceManager(accessToken, logger)
    if (fallbackProjectId) return { projectId: fallbackProjectId, tier: tierId, credits: [] }
    const importHint = name === 'gcil'
      ? '；可在 gcli2api 面板查看 project_id 后，使用「导入凭证」方式添加账号'
      : ''
    throw new Error(`Google 账号授权成功，但 loadCodeAssist、onboardUser 和 Resource Manager 均未能取得 ${label} project_id${importHint}`)
  }

  async function fetchUserInfo (accessToken) {
    const response = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) return {}
    return response.json().catch(() => ({}))
  }

  async function exchangeCode (code, redirectUri) {
    assertClientCredentials()
    return postForm(TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: 'authorization_code'
    }, 'OAuth 授权码交换')
  }

  async function refreshCredential (store, credential) {
    if (!credential?.refreshToken) throw new Error('OAuth 凭证已过期且没有 refresh_token，请重新登录')
    const token = await postForm(TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: credential.refreshToken,
      grant_type: 'refresh_token'
    }, 'OAuth Token 刷新')
    if (!token.access_token) throw new Error('OAuth Token 刷新响应缺少 access_token')
    const updated = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token || credential.refreshToken,
      expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
      updatedAt: Date.now()
    }
    return store.updateAccount(credential.accountId, updated) || { ...credential, ...updated }
  }

  function cleanupFlow (state) {
    const flow = pendingFlows.get(state)
    if (!flow) return
    pendingFlows.delete(state)
    clearTimeout(flow.timer)
    try { flow.server.close() } catch {}
  }

  async function finishFlow (state, code, expectedChannelId) {
    const flow = pendingFlows.get(state)
    if (!flow || flow.provider !== name || flow.expiresAt < Date.now()) {
      cleanupFlow(state)
      throw new Error('OAuth 登录流程不存在或已过期，请重新发起')
    }
    if (expectedChannelId && flow.channelId !== String(expectedChannelId)) {
      throw new Error('OAuth 回调与当前渠道不匹配')
    }
    // 本地 HTTP 回调与仪表盘粘贴回调 URL 可能同时到达。
    // 授权码只能使用一次，因此同一 flow 必须复用同一个完成 Promise。
    if (flow.completionPromise) return flow.completionPromise
    flow.completionPromise = (async () => {
      try {
        const token = await exchangeCode(code, flow.redirectUri)
        if (!token.access_token) throw new Error('OAuth Token 响应缺少 access_token')
        const [project, user] = await Promise.all([
          discoverProject(flow.apiBase, token.access_token, flow.logger),
          fetchUserInfo(token.access_token)
        ])
        const credential = {
          googleAccountId: String(user?.id || ''),
          accessToken: token.access_token,
          refreshToken: token.refresh_token || '',
          expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
          projectId: project.projectId,
          tier: project.tier,
          credits: project.credits || [],
          email: String(user?.email || ''),
          scopes,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
        return flow.store.upsertAccount(credential)
      } finally {
        cleanupFlow(state)
      }
    })()
    return flow.completionPromise
  }

  function beginOAuth ({ dataDir, channelId, apiBase, logger } = {}) {
    assertClientCredentials()
    const store = new CredentialStore(dataDir, channelId)
    return new Promise((resolve, reject) => {
      for (const [flowState, flow] of pendingFlows) {
        if (flow.expiresAt < Date.now() ||
            (flow.provider === name && flow.channelId === String(channelId))) cleanupFlow(flowState)
      }
      if (pendingFlows.size >= 20) {
        const oldest = [...pendingFlows.entries()]
          .sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0]
        if (oldest) cleanupFlow(oldest[0])
      }
      const state = randomBytes(24).toString('base64url')
      const server = http.createServer(async (req, res) => {
        const callback = new URL(req.url || '/', 'http://localhost')
        const receivedState = callback.searchParams.get('state') || ''
        const code = callback.searchParams.get('code') || ''
        if (receivedState !== state || !code) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('OAuth callback is missing a valid state or code.')
          return
        }
        try {
          await finishFlow(state, code)
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`<!doctype html><meta charset="utf-8"><title>OAuth complete</title><p>${label} OAuth 登录成功，可以关闭此页面。</p>`)
        } catch (error) {
          logger?.(`[${label} OAuth] callback failed: ${error.message}`)
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end(`${label} OAuth failed: ${error.message}`)
        }
      })
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        const address = server.address()
        const port = typeof address === 'object' && address ? address.port : 0
        const redirectUri = `http://localhost:${port}`
        const expiresAt = Date.now() + FLOW_TTL_MS
        const timer = setTimeout(() => cleanupFlow(state), FLOW_TTL_MS)
        timer.unref?.()
        pendingFlows.set(state, {
          provider: name,
          state,
          server,
          timer,
          store,
          logger,
          channelId: String(channelId),
          redirectUri,
          expiresAt,
          apiBase: safeApiBase(apiBase)
        })
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: scopes.join(' '),
          response_type: 'code',
          access_type: 'offline',
          prompt: 'consent',
          include_granted_scopes: 'true',
          state
        })
        resolve({ authUrl: `${AUTH_URL}?${params}`, state, redirectUri, expiresAt })
      })
    })
  }

  async function completeOAuth (callbackUrl, expectedChannelId) {
    let parsed
    try {
      parsed = new URL(String(callbackUrl || ''))
    } catch {
      throw new Error('OAuth 回调 URL 格式无效')
    }
    const oauthError = parsed.searchParams.get('error') || ''
    if (oauthError) {
      const detail = parsed.searchParams.get('error_description') || oauthError
      throw new Error(`Google OAuth 授权失败：${detail.slice(0, 500)}`)
    }
    const state = parsed.searchParams.get('state') || ''
    const code = parsed.searchParams.get('code') || ''
    if (!state || !code) throw new Error('OAuth 回调 URL 缺少 state 或 code')
    return finishFlow(state, code, expectedChannelId)
  }

  async function getCredential ({ dataDir, channelId, accountId, forceRefresh = false } = {}) {
    const store = new CredentialStore(dataDir, channelId)
    let credential = accountId
      ? store.getAccount(accountId)
      : store.listAccounts().find(item => item.enabled !== false)
    if (!credential) throw new Error(`${label} OAuth 尚未登录`)
    if (forceRefresh || !credential.accessToken ||
        Number(credential.expiresAt || 0) <= Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      credential = await refreshCredential(store, credential)
    }
    return credential
  }

  async function getOAuthStatus ({ dataDir, channelId } = {}) {
    const store = new CredentialStore(dataDir, channelId)
    const accounts = store.listAccounts()
    if (accounts.length === 0) return { connected: false, total: 0, enabled: 0, accounts: [] }
    const now = Date.now()
    const publicAccounts = accounts.map(item => ({
      accountId: item.accountId,
      email: item.email || '',
      tier: item.tier || '',
      projectId: item.projectId || '',
      expiresAt: item.expiresAt || null,
      enabled: item.enabled !== false,
      cooldowns: Object.fromEntries(
        Object.entries(item.cooldowns || {}).filter(([, until]) => Number(until) > now)
      ),
      failures: Number(item.failures) || 0,
      healthScore: Number(item.healthScore ?? 1),
      priority: Number(item.priority) || 0,
      weight: Number(item.weight ?? 1),
      lastSuccessAt: Number(item.lastSuccessAt) || null,
      lastError: item.lastError || '',
      quotaUpdatedAt: Number(item.quotaUpdatedAt) || null,
      quotas: item.quotas || {},
      quotaGroups: Array.isArray(item.quotaGroups) ? item.quotaGroups : [],
      credits: Array.isArray(item.credits) ? item.credits : []
    }))
    const recoveryTimes = publicAccounts
      .flatMap(item => Object.values(item.cooldowns))
      .map(Number)
      .filter(until => until > now)
    return {
      connected: true,
      total: accounts.length,
      enabled: accounts.filter(item => item.enabled !== false).length,
      coolingAccounts: publicAccounts.filter(item => Object.keys(item.cooldowns).length > 0).length,
      nearestRecoveryAt: recoveryTimes.length > 0 ? Math.min(...recoveryTimes) : null,
      quotaModels: new Set(publicAccounts.flatMap(item => Object.keys(item.quotas))).size,
      quotaWindows: publicAccounts.reduce(
        (total, item) => total + item.quotaGroups.reduce(
          (count, group) => count + (Array.isArray(group.buckets) ? group.buckets.length : 0),
          0
        ),
        0
      ),
      accounts: publicAccounts
    }
  }

  function removeCredential ({ dataDir, channelId, accountId } = {}) {
    const store = new CredentialStore(dataDir, channelId)
    return accountId ? store.removeAccount(accountId) : store.remove()
  }

  function updateAccount ({ dataDir, channelId, accountId, patch } = {}) {
    const allowed = {}
    if (Object.hasOwn(patch || {}, 'enabled')) allowed.enabled = Boolean(patch.enabled)
    if (Object.hasOwn(patch || {}, 'projectId')) {
      allowed.projectId = String(patch.projectId || '').trim()
    }
    if (Object.hasOwn(patch || {}, 'priority')) {
      allowed.priority = Math.max(0, Math.min(100, Math.trunc(Number(patch.priority) || 0)))
    }
    if (Object.hasOwn(patch || {}, 'weight')) {
      allowed.weight = Math.max(0, Math.min(100, Number(patch.weight) || 0))
    }
    return new CredentialStore(dataDir, channelId).updateAccount(accountId, allowed)
  }

  /**
   * 导入外部凭证 JSON（gcli2api 凭证文件或 Gemini CLI oauth_creds.json）。
   * 兼容字段：token/access_token、refresh_token、project_id、expiry/expiry_date/expires_at。
   * access_token 缺失或过期时用 refresh_token 刷新；缺 project_id 时走 loadCodeAssist 补齐。
   */
  function parseCredentialExpiry (value) {
    if (value === undefined || value === null || value === '') return 0
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) {
      // expiry_date 通常是毫秒，expires_at 也常见 Unix 秒。
      return numeric < 1e12 ? numeric * 1000 : numeric
    }
    const parsed = Date.parse(String(value))
    return Number.isFinite(parsed) ? parsed : 0
  }

  async function importCredential ({ dataDir, channelId, payload, logger } = {}) {
    const raw = payload && typeof payload === 'object' ? payload : {}
    const refreshToken = String(raw.refresh_token || raw.refreshToken || '').trim()
    if (!refreshToken) throw new Error('凭证文件缺少 refresh_token')
    let accessToken = String(raw.access_token || raw.token || raw.accessToken || '').trim()
    // gcli2api 导出 ISO 8601 的 expiry，Gemini CLI 则通常使用毫秒 expiry_date。
    let expiresAt = parseCredentialExpiry(
      raw.expiry_date ?? raw.expiry ?? raw.expires_at ?? raw.expiresAt
    )
    let projectId = String(raw.project_id || raw.projectId || '').trim()

    if (!accessToken || expiresAt <= Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      assertClientCredentials()
      const token = await postForm(TOKEN_URL, {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      }, 'OAuth Token 刷新')
      if (!token.access_token) throw new Error('refresh_token 已失效，请重新 OAuth 登录')
      accessToken = token.access_token
      expiresAt = Date.now() + Number(token.expires_in || 3600) * 1000
    }

    let tier = ''
    let credits = []
    if (!projectId) {
      try {
        const discovered = await discoverProject(defaultApiBase, accessToken, logger)
        projectId = discovered.projectId
        tier = discovered.tier
        credits = discovered.credits || []
      } catch (error) {
        logger?.(`[${label}] import credential: project discovery failed: ${error.message}`)
      }
    }
    if (!projectId) throw new Error('无法为导入的凭证取得 project_id')
    // 有 project 无 tier 时补查订阅等级（GCP 项目账号 tier 在 allowedTiers 默认项）
    if (!tier) {
      try {
        const entitlements = extractProjectAndTier(await loadProject(defaultApiBase, accessToken))
        tier = entitlements.tier
        credits = entitlements.credits
      } catch { /* tier 留空由展示层兜底 */ }
    }

    const user = await fetchUserInfo(accessToken).catch(() => ({}))
    const store = new CredentialStore(dataDir, channelId)
    return store.upsertAccount({
      googleAccountId: String(user?.id || ''),
      accessToken,
      refreshToken,
      expiresAt,
      projectId,
      tier,
      credits,
      email: String(raw.email || user?.email || ''),
      scopes,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
  }

  return {
    profile,
    CredentialStore,
    safeApiBase,
    authHeaders,
    extractProjectAndTier,
    loadProject,
    beginOAuth,
    completeOAuth,
    importCredential,
    getCredential,
    getOAuthStatus,
    removeCredential,
    updateAccount
  }
}
