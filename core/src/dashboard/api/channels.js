import { Router } from 'express'
import { isDeepStrictEqual } from 'node:util'
import {
  GeminiClient,
  normalizeGeminiBuiltinTools,
  normalizeGeminiApiMode,
  normalizeGeminiSafetyLevel
} from '../../clients/gemini.js'
import { firstGeminiApiKey, normalizeGeminiKeyPool, getGeminiKeyPoolStatus, applyGeminiKeyProbeResult } from '../../clients/gemini-key-pool.js'
import {
  AntigravityClient,
  discoverAntigravityModels,
  refreshAntigravityQuotas
} from '../../clients/antigravity.js'
import {
  beginAntigravityOAuth,
  completeAntigravityOAuth,
  getAntigravityOAuthStatus,
  removeAntigravityCredential,
  updateAntigravityAccount
} from '../../antigravity/oauth.js'
import { GcilClient, GCIL_MODELS } from '../../clients/gcil.js'
import {
  beginGcilOAuth,
  completeGcilOAuth,
  exportGcilCredential,
  getGcilOAuthStatus,
  importGcilCredential,
  probeGcilAccount,
  removeGcilCredential,
  testGcilAccount,
  updateGcilAccount
} from '../../gcil/oauth.js'
import { discoverModels, buildModelListRequest } from '../model-discovery.js'
import { testModel } from '../model-test.js'

/** Google AI Studio 与 Gemini 共用协议与 Key 池；GCIL 为独立 OAuth 适配器 */
export const isGeminiFamilyAdapter = (adapterType) => ['gemini', 'aistudio'].includes(adapterType)

export function normalizeChannelPayload (input = {}, existing = {}) {
  const adapterType = input.adapterType || existing.adapterType || 'gemini'
  const options = { ...(existing.options || {}), ...(input.options || {}) }
  if (Object.hasOwn(input, 'apiKey')) options.apiKey = input.apiKey
  if (Object.hasOwn(input, 'baseUrl')) options.baseUrl = input.baseUrl
  delete options.providerType
  delete options.protocol
  if (isGeminiFamilyAdapter(adapterType)) {
    options.safetyLevel = normalizeGeminiSafetyLevel(input.safetyLevel ?? options.safetyLevel)
    options.apiMode = normalizeGeminiApiMode(input.apiMode ?? options.apiMode)
    options.interactionsFallback = input.interactionsFallback ?? options.interactionsFallback ?? true
    options.builtinTools = normalizeGeminiBuiltinTools(input.builtinTools ?? options.builtinTools)
    if (adapterType === 'aistudio') {
      // includeDisabled：保留已禁用的 Key，避免保存时丢失禁用状态
      options.apiKeys = normalizeGeminiKeyPool({ apiKeys: options.apiKeys }, { includeDisabled: true })
      options.keyPoolStrategy = String(options.keyPoolStrategy) === 'least_inflight' ? 'least_inflight' : 'round_robin'
      options.keyCooldownSeconds = Math.max(5, Math.min(600, Number(options.keyCooldownSeconds) || 60))
    } else {
      // 通用 Gemini 格式渠道按单 Key 处理（与 OpenAI 渠道一致）
      delete options.apiKeys
      delete options.keyPoolStrategy
      delete options.keyCooldownSeconds
    }
  } else {
    delete options.safetyLevel
    delete options.apiMode
    delete options.interactionsFallback
    delete options.builtinTools
    delete options.apiKeys
    delete options.keyPoolStrategy
    delete options.keyCooldownSeconds
  }
  if (adapterType === 'antigravity') delete options.apiKey
  if (adapterType === 'gcil') delete options.apiKey
  const channel = { ...existing, ...input, adapterType, options }
  delete channel.apiKey
  delete channel.baseUrl
  delete channel.safetyLevel
  return channel
}

/** 将引擎中的渠道列表同步到 config.chaite.channels 并落盘 */
export async function syncChannelsToConfig (ctx) {
  // saveChannel 先更新缓存；必须等独立渠道文件真正落盘后再写镜像配置和响应。
  ctx.engine.storage.flush?.()
  const channels = await ctx.engine.listChannels()
  // 独立存储与镜像已经一致时不要再进入主配置保存链路。
  if (isDeepStrictEqual(ctx.config?.chaite?.channels || [], channels)) return true
  const candidate = structuredClone(ctx.config)
  if (!candidate.chaite) candidate.chaite = {}
  candidate.chaite.channels = channels
  try {
    // 渠道独立文件已完成持久化；这里是可重建镜像，不滚动主配置备份。
    ctx.saveConfig(candidate, { backup: false })
    return true
  } catch (err) {
    // data/ch 是事实来源，主存储已成功时不把请求误报为完全失败；下次协调会修复镜像。
    ctx.logger?.(`[dashboard] 渠道已保存，但 config.json 镜像更新失败: ${err.message}`)
    return false
  }
}

export default function channelRoutes (ctx) {
  const router = Router()

  router.get('/', async (req, res) => {
    const channels = await ctx.engine.listChannels()
    res.json(channels)
  })

  router.post('/', async (req, res) => {
    const ch = normalizeChannelPayload(req.body)
    if (!ch.id || !ch.name) return res.status(400).json({ error: '缺少 id 或 name' })
    await ctx.engine.saveChannel(ch)
    const configMirrorPersisted = await syncChannelsToConfig(ctx)
    res.json({ ok: true, channel: ch, configMirrorPersisted })
  })

  router.post('/models/discover', async (req, res) => {
    try {
      const channel = normalizeChannelPayload(req.body)
      const adapterType = req.body?.adapterType || channel.adapterType
      const models = adapterType === 'antigravity'
        ? await discoverAntigravityModels({
          dataDir: ctx.engine.storage.dataDir,
          channelId: String(req.body?.id || ''),
          apiBase: channel.options?.baseUrl
        })
        : adapterType === 'gcil'
          ? [...GCIL_MODELS]
          : await discoverModels({
            adapterType,
            apiKey: firstGeminiApiKey(channel.options),
            baseUrl: channel.options?.baseUrl
          })
      res.json({ models })
    } catch (err) {
      res.status(502).json({ error: err?.message || '获取模型列表失败' })
    }
  })

  router.post('/models/test', async (req, res) => {
    try {
      const channel = normalizeChannelPayload(req.body)
      const model = String(req.body?.model || '').trim()
      if (!model) return res.status(400).json({ error: '缺少要测试的模型' })
      const adapterType = req.body?.adapterType || channel.adapterType
      let result
      if (adapterType === 'antigravity') {
        const startedAt = Date.now()
        const client = new AntigravityClient({
          storage: ctx.engine.storage,
          dataDir: ctx.engine.storage.dataDir,
          channelId: String(req.body?.id || ''),
          options: channel.options || {},
          logger: ctx.logger
        })
        const response = await client._sendMessage([{
          role: 'user',
          content: [{ type: 'text', text: 'Hi' }],
          timestamp: Date.now()
        }], { model, maxTokens: 16, conversationId: `model-test-${Date.now()}` })
        const reply = client._extractText(response).slice(0, 120)
        result = { ok: true, latencyMs: Date.now() - startedAt, ...(reply ? { reply } : {}) }
      } else if (adapterType === 'gcil') {
        const startedAt = Date.now()
        const client = new GcilClient({
          storage: ctx.engine.storage,
          dataDir: ctx.engine.storage.dataDir,
          channelId: String(req.body?.id || ''),
          options: channel.options || {},
          logger: ctx.logger
        })
        const response = await client._sendMessage([{
          role: 'user',
          content: [{ type: 'text', text: 'Hi' }],
          timestamp: Date.now()
        }], { model, maxTokens: 16, conversationId: `model-test-${Date.now()}` })
        const reply = client._extractText(response).slice(0, 120)
        result = { ok: true, latencyMs: Date.now() - startedAt, ...(reply ? { reply } : {}) }
      } else if (isGeminiFamilyAdapter(adapterType)) {
        const startedAt = Date.now()
        const client = new GeminiClient({
          storage: ctx.engine.storage,
          dataDir: ctx.engine.storage.dataDir,
          channelId: String(req.body?.id || 'gemini-test'),
          options: channel.options || {},
          logger: ctx.logger
        })
        const response = await client._sendMessage([{
          role: 'user',
          content: [{ type: 'text', text: 'Hi' }],
          timestamp: Date.now()
        }], { model, maxTokens: 16, conversationId: `model-test-${Date.now()}` })
        const reply = client._extractText(response).slice(0, 120)
        result = { ok: true, latencyMs: Date.now() - startedAt, ...(reply ? { reply } : {}) }
      } else {
        result = await testModel({
          adapterType,
          apiKey: channel.options?.apiKey,
          baseUrl: channel.options?.baseUrl,
          safetyLevel: channel.options?.safetyLevel,
          apiMode: channel.options?.apiMode,
          model
        })
      }
      res.json(result)
    } catch (err) {
      res.status(502).json({ error: err?.message || '模型测试失败' })
    }
  })

  const KEY_PROBE_FAIL_REASONS = {
    400: '请求异常，请检查 Base URL',
    401: '鉴权失败，Key 无效',
    403: 'Key 无权限或已被禁用',
    404: '接口不存在，请检查 Base URL',
    429: '额度受限（429）'
  }

  // Gemini Key 池测活：逐个用 GET /models 轻量探测，失败立即置入冷却并返回状态
  router.post('/keys/test', async (req, res) => {
    try {
      const channel = normalizeChannelPayload(req.body)
      if (channel.adapterType !== 'aistudio') return res.status(400).json({ error: '仅 Google AI Studio 渠道支持 Key 池测活' })
      const entries = normalizeGeminiKeyPool(channel.options, { includeDisabled: true })
      if (!entries.length) return res.status(400).json({ error: '未配置项目 Key' })
      const onlyId = String(req.body?.keyId || '').trim()
      const targets = onlyId ? entries.filter(entry => entry.id === onlyId) : entries
      if (!targets.length) return res.status(404).json({ error: '未找到指定 Key' })
      const results = await Promise.all(targets.map(async entry => {
        const startedAt = Date.now()
        const base = { id: entry.id, projectId: entry.projectId }
        try {
          const request = buildModelListRequest({
            adapterType: 'gemini',
            baseUrl: channel.options?.baseUrl,
            apiKey: entry.apiKey
          })
          const response = await fetch(request.url, {
            method: 'GET',
            headers: request.headers,
            redirect: 'error',
            signal: AbortSignal.timeout(12000)
          })
          const latencyMs = Date.now() - startedAt
          if (!response.ok) {
            // 第一时间停用失败 Key：与运行时失败处理一致地置入冷却
            applyGeminiKeyProbeResult(entry, response.status)
            return {
              ...base,
              ok: false,
              status: response.status,
              latencyMs,
              error: KEY_PROBE_FAIL_REASONS[response.status] || `HTTP ${response.status}`
            }
          }
          await response.arrayBuffer() // 读尽响应，避免连接悬挂
          return { ...base, ok: true, status: 200, latencyMs }
        } catch (err) {
          const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
          return {
            ...base,
            ok: false,
            status: 0,
            latencyMs: Date.now() - startedAt,
            error: timeout ? '连接超时（12 秒）' : `网络错误：${err?.message || '无法连接'}`
          }
        }
      }))
      res.json({ results, status: getGeminiKeyPoolStatus(channel.options) })
    } catch (err) {
      res.status(502).json({ error: err?.message || 'Key 测活失败' })
    }
  })

  // 已保存渠道的 Key 池运行时状态（冷却/在途/禁用）
  router.get('/:id/keys/status', async (req, res) => {
    try {
      const channel = await ctx.engine.storage.getChannel(req.params.id)
      if (!channel) return res.status(404).json({ error: 'Channel not found' })
      res.json({ status: getGeminiKeyPoolStatus(channel.options || {}) })
    } catch (err) {
      res.status(500).json({ error: err?.message || '获取 Key 状态失败' })
    }
  })

  router.get('/:id/oauth/antigravity/status', async (req, res) => {
    try {
      const channel = await ctx.engine.storage.getChannel(req.params.id)
      if (!channel) return res.status(404).json({ error: 'Channel not found' })
      if (channel.adapterType !== 'antigravity') {
        return res.status(400).json({ error: '该渠道不是 Antigravity OAuth 适配器' })
      }
      res.json(await getAntigravityOAuthStatus({
        dataDir: ctx.engine.storage.dataDir,
        channelId: req.params.id
      }))
    } catch (err) {
      res.status(502).json({ error: err?.message || '读取 Antigravity OAuth 状态失败' })
    }
  })

  router.post('/:id/oauth/antigravity/start', async (req, res) => {
    try {
      const channel = await ctx.engine.storage.getChannel(req.params.id)
      if (!channel) return res.status(404).json({ error: 'Channel not found' })
      if (channel.adapterType !== 'antigravity') {
        return res.status(400).json({ error: '该渠道不是 Antigravity OAuth 适配器' })
      }
      const result = await beginAntigravityOAuth({
        dataDir: ctx.engine.storage.dataDir,
        channelId: req.params.id,
        apiBase: channel.options?.baseUrl,
        logger: ctx.logger
      })
      res.json(result)
    } catch (err) {
      res.status(502).json({ error: err?.message || '启动 Antigravity OAuth 失败' })
    }
  })

  router.post('/:id/oauth/antigravity/callback-url', async (req, res) => {
    try {
      const channel = await ctx.engine.storage.getChannel(req.params.id)
      if (!channel) return res.status(404).json({ error: 'Channel not found' })
      if (channel.adapterType !== 'antigravity') {
        return res.status(400).json({ error: '该渠道不是 Antigravity OAuth 适配器' })
      }
      const callbackUrl = String(req.body?.callbackUrl || '').trim()
      if (!callbackUrl || callbackUrl.length > 8192) {
        return res.status(400).json({ error: '请粘贴有效的 OAuth 回调 URL' })
      }
      let parsed
      try {
        parsed = new URL(callbackUrl)
      } catch {
        return res.status(400).json({ error: 'OAuth 回调 URL 格式无效' })
      }
      if (!['http:', 'https:'].includes(parsed.protocol) ||
          !parsed.searchParams.get('code') ||
          !parsed.searchParams.get('state')) {
        return res.status(400).json({ error: 'OAuth 回调 URL 缺少 code 或 state' })
      }
      await completeAntigravityOAuth(callbackUrl, req.params.id)
      res.json({
        ok: true,
        message: 'Antigravity OAuth 登录成功，凭证已加密保存到插件本地',
        status: await getAntigravityOAuthStatus({
          dataDir: ctx.engine.storage.dataDir,
          channelId: req.params.id
        })
      })
    } catch (err) {
      res.status(502).json({ error: err?.message || '完成 Antigravity OAuth 失败' })
    }
  })

  router.delete('/:id/oauth/antigravity', async (req, res) => {
    try {
      const channel = await ctx.engine.storage.getChannel(req.params.id)
      if (!channel) return res.status(404).json({ error: 'Channel not found' })
      removeAntigravityCredential({
        dataDir: ctx.engine.storage.dataDir,
        channelId: req.params.id
      })
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: err?.message || '删除 Antigravity OAuth 凭证失败' })
    }
  })

  router.post('/:id/oauth/antigravity/quota', async (req, res) => {
    try {
      const channel = await ctx.engine.storage.getChannel(req.params.id)
      if (!channel) return res.status(404).json({ error: 'Channel not found' })
      if (channel.adapterType !== 'antigravity') {
        return res.status(400).json({ error: '该渠道不是 Antigravity OAuth 适配器' })
      }
      const accountId = String(req.body?.accountId || '').trim() || undefined
      const results = await refreshAntigravityQuotas({
        dataDir: ctx.engine.storage.dataDir,
        channelId: req.params.id,
        apiBase: channel.options?.baseUrl,
        accountId
      })
      res.json({
        ok: results.some(item => item.ok),
        results,
        status: await getAntigravityOAuthStatus({
          dataDir: ctx.engine.storage.dataDir,
          channelId: req.params.id
        })
      })
    } catch (err) {
      res.status(502).json({ error: err?.message || '查询 Antigravity 额度失败' })
    }
  })

  router.patch('/:id/oauth/antigravity/accounts/:accountId', async (req, res) => {
    try {
      const channel = await ctx.engine.storage.getChannel(req.params.id)
      if (!channel) return res.status(404).json({ error: 'Channel not found' })
      const account = updateAntigravityAccount({
        dataDir: ctx.engine.storage.dataDir,
        channelId: req.params.id,
        accountId: req.params.accountId,
        patch: req.body || {}
      })
      if (!account) return res.status(404).json({ error: 'OAuth account not found' })
      res.json({
        ok: true,
        status: await getAntigravityOAuthStatus({
          dataDir: ctx.engine.storage.dataDir,
          channelId: req.params.id
        })
      })
    } catch (err) {
      res.status(500).json({ error: err?.message || '更新 Antigravity 账号失败' })
    }
  })

  router.delete('/:id/oauth/antigravity/accounts/:accountId', async (req, res) => {
    try {
      const channel = await ctx.engine.storage.getChannel(req.params.id)
      if (!channel) return res.status(404).json({ error: 'Channel not found' })
      const removed = removeAntigravityCredential({
        dataDir: ctx.engine.storage.dataDir,
        channelId: req.params.id,
        accountId: req.params.accountId
      })
      if (!removed) return res.status(404).json({ error: 'OAuth account not found' })
      res.json({
        ok: true,
        status: await getAntigravityOAuthStatus({
          dataDir: ctx.engine.storage.dataDir,
          channelId: req.params.id
        })
      })
    } catch (err) {
      res.status(500).json({ error: err?.message || '删除 Antigravity 账号失败' })
    }
  })

  router.get('/:id/oauth/gcil/status', async (req, res) => {
    try {
      const channel = await ctx.engine.storage.getChannel(req.params.id)
      if (!channel) return res.status(404).json({ error: 'Channel not found' })
      if (channel.adapterType !== 'gcil') {
        return res.status(400).json({ error: '该渠道不是 GCIL OAuth 适配器' })
      }
      res.json(await getGcilOAuthStatus({
        dataDir: ctx.engine.storage.dataDir,
        channelId: req.params.id
      }))
    } catch (err) {
      res.status(502).json({ error: err?.message || '读取 GCIL OAuth 状态失败' })
    }
  })

  router.post('/:id/oauth/gcil/start', async (req, res) => {
    try {
      const channel = await ctx.engine.storage.getChannel(req.params.id)
      if (!channel) return res.status(404).json({ error: 'Channel not found' })
      if (channel.adapterType !== 'gcil') {
        return res.status(400).json({ error: '该渠道不是 GCIL OAuth 适配器' })
      }
      const result = await beginGcilOAuth({
        dataDir: ctx.engine.storage.dataDir,
        channelId: req.params.id,
        apiBase: channel.options?.baseUrl,
        logger: ctx.logger
      })
      res.json(result)
    } catch (err) {
      res.status(502).json({ error: err?.message || '启动 GCIL OAuth 失败' })
    }
  })

  router.post('/:id/oauth/gcil/callback-url', async (req, res) => {
    try {
      const channel = await ctx.engine.storage.getChannel(req.params.id)
      if (!channel) return res.status(404).json({ error: 'Channel not found' })
      if (channel.adapterType !== 'gcil') {
        return res.status(400).json({ error: '该渠道不是 GCIL OAuth 适配器' })
      }
      const callbackUrl = String(req.body?.callbackUrl || '').trim()
      if (!callbackUrl || callbackUrl.length > 8192) {
        return res.status(400).json({ error: '请粘贴有效的 OAuth 回调 URL' })
      }
      let parsed
      try {
        parsed = new URL(callbackUrl)
      } catch {
        return res.status(400).json({ error: 'OAuth 回调 URL 格式无效' })
      }
      if (!['http:', 'https:'].includes(parsed.protocol) ||
          !parsed.searchParams.get('code') ||
          !parsed.searchParams.get('state')) {
        return res.status(400).json({ error: 'OAuth 回调 URL 缺少 code 或 state' })
      }
      await completeGcilOAuth(callbackUrl, req.params.id)
      res.json({
        ok: true,
        message: 'GCIL OAuth 登录成功，凭证已加密保存到插件本地',
        status: await getGcilOAuthStatus({
          dataDir: ctx.engine.storage.dataDir,
          channelId: req.params.id
        })
      })
    } catch (err) {
      res.status(502).json({ error: err?.message || '完成 GCIL OAuth 失败' })
    }
  })

  router.delete('/:id/oauth/gcil', async (req, res) => {
    try {
      const channel = await ctx.engine.storage.getChannel(req.params.id)
      if (!channel) return res.status(404).json({ error: 'Channel not found' })
      removeGcilCredential({
        dataDir: ctx.engine.storage.dataDir,
        channelId: req.params.id
      })
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: err?.message || '删除 GCIL OAuth 凭证失败' })
    }
  })

  router.patch('/:id/oauth/gcil/accounts/:accountId', async (req, res) => {
    try {
      const channel = await ctx.engine.storage.getChannel(req.params.id)
      if (!channel) return res.status(404).json({ error: 'Channel not found' })
      const account = updateGcilAccount({
        dataDir: ctx.engine.storage.dataDir,
        channelId: req.params.id,
        accountId: req.params.accountId,
        patch: req.body || {}
      })
      if (!account) return res.status(404).json({ error: 'OAuth account not found' })
      res.json({
        ok: true,
        status: await getGcilOAuthStatus({
          dataDir: ctx.engine.storage.dataDir,
          channelId: req.params.id
        })
      })
    } catch (err) {
      res.status(500).json({ error: err?.message || '更新 GCIL 账号失败' })
    }
  })

  router.post('/:id/oauth/gcil/accounts/:accountId/probe', async (req, res) => {
    try {
      const channel = await ctx.engine.storage.getChannel(req.params.id)
      if (!channel) return res.status(404).json({ error: '渠道不存在' })
      if (channel.adapterType !== 'gcil') {
        return res.status(400).json({ error: '该渠道不是 GCIL OAuth 适配器' })
      }
      const options = {
        dataDir: ctx.engine.storage.dataDir,
        channelId: req.params.id,
        accountId: req.params.accountId
      }
      const current = await getGcilOAuthStatus(options)
      if (!current.accounts.some(item => item.accountId === req.params.accountId)) {
        return res.status(404).json({ error: 'OAuth 账号不存在' })
      }
      const result = await probeGcilAccount({
        ...options,
        apiBase: channel.options?.baseUrl
      })
      res.json({
        ...result,
        status: await getGcilOAuthStatus(options)
      })
    } catch (err) {
      res.status(502).json({ ok: false, error: err?.message || 'GCIL 账号检验失败' })
    }
  })

  router.post('/:id/oauth/gcil/accounts/:accountId/test', async (req, res) => {
    try {
      const channel = await ctx.engine.storage.getChannel(req.params.id)
      if (!channel) return res.status(404).json({ error: '渠道不存在' })
      if (channel.adapterType !== 'gcil') {
        return res.status(400).json({ error: '该渠道不是 GCIL OAuth 适配器' })
      }
      const options = {
        dataDir: ctx.engine.storage.dataDir,
        channelId: req.params.id,
        accountId: req.params.accountId
      }
      const current = await getGcilOAuthStatus(options)
      if (!current.accounts.some(item => item.accountId === req.params.accountId)) {
        return res.status(404).json({ error: 'OAuth 账号不存在' })
      }
      const result = await testGcilAccount({
        ...options,
        apiBase: channel.options?.baseUrl,
        model: req.body?.model
      })
      if (result.ok) return res.json(result)
      res.json({
        ...result,
        status: await getGcilOAuthStatus(options)
      })
    } catch (err) {
      res.status(502).json({ ok: false, error: err?.message || 'GCIL 账号消息测试失败' })
    }
  })

  router.get('/:id/oauth/gcil/accounts/:accountId/export', async (req, res) => {
    try {
      const channel = await ctx.engine.storage.getChannel(req.params.id)
      if (!channel) return res.status(404).json({ error: '渠道不存在' })
      if (channel.adapterType !== 'gcil') {
        return res.status(400).json({ error: '该渠道不是 GCIL OAuth 适配器' })
      }
      const status = await getGcilOAuthStatus({
        dataDir: ctx.engine.storage.dataDir,
        channelId: req.params.id
      })
      if (!status.accounts.some(item => item.accountId === req.params.accountId)) {
        return res.status(404).json({ error: 'OAuth 账号不存在' })
      }
      const credential = await exportGcilCredential({
        dataDir: ctx.engine.storage.dataDir,
        channelId: req.params.id,
        accountId: req.params.accountId
      })
      const safeAccountId = req.params.accountId.replace(/[^a-zA-Z0-9_-]/g, '_')
      res.setHeader('Content-Disposition', `attachment; filename="gcil-${safeAccountId}.json"`)
      res.json(credential)
    } catch (err) {
      res.status(502).json({ error: err?.message || '导出 GCIL 凭证失败' })
    }
  })

  router.post('/:id/oauth/gcil/import', async (req, res) => {
    try {
      const channel = await ctx.engine.storage.getChannel(req.params.id)
      if (!channel) return res.status(404).json({ error: 'Channel not found' })
      if (channel.adapterType !== 'gcil') {
        return res.status(400).json({ error: '该渠道不是 GCIL OAuth 适配器' })
      }
      const payload = req.body?.credential
      if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ error: '请提供凭证 JSON（gcli2api 凭证文件或 oauth_creds.json）' })
      }
      const account = await importGcilCredential({
        dataDir: ctx.engine.storage.dataDir,
        channelId: req.params.id,
        payload,
        logger: ctx.logger
      })
      res.json({
        ok: true,
        message: `凭证导入成功：${account.email || account.accountId}`,
        status: await getGcilOAuthStatus({
          dataDir: ctx.engine.storage.dataDir,
          channelId: req.params.id
        })
      })
    } catch (err) {
      res.status(502).json({ error: err?.message || '导入 GCIL 凭证失败' })
    }
  })

  router.delete('/:id/oauth/gcil/accounts/:accountId', async (req, res) => {
    try {
      const channel = await ctx.engine.storage.getChannel(req.params.id)
      if (!channel) return res.status(404).json({ error: 'Channel not found' })
      const removed = removeGcilCredential({
        dataDir: ctx.engine.storage.dataDir,
        channelId: req.params.id,
        accountId: req.params.accountId
      })
      if (!removed) return res.status(404).json({ error: 'OAuth account not found' })
      res.json({
        ok: true,
        status: await getGcilOAuthStatus({
          dataDir: ctx.engine.storage.dataDir,
          channelId: req.params.id
        })
      })
    } catch (err) {
      res.status(500).json({ error: err?.message || '删除 GCIL 账号失败' })
    }
  })

  router.get('/:id', async (req, res) => {
    const ch = await ctx.engine.storage.getChannel(req.params.id)
    if (!ch) return res.status(404).json({ error: 'Channel not found' })
    res.json(ch)
  })

  router.put('/:id', async (req, res) => {
    const existing = await ctx.engine.storage.getChannel(req.params.id)
    if (!existing) return res.status(404).json({ error: 'Channel not found' })
    const ch = normalizeChannelPayload(req.body, existing)
    ch.id = req.params.id
    await ctx.engine.saveChannel(ch)
    const configMirrorPersisted = await syncChannelsToConfig(ctx)
    res.json({ ok: true, channel: ch, configMirrorPersisted })
  })

  router.delete('/:id', async (req, res) => {
    const existing = await ctx.engine.storage.getChannel(req.params.id)
    if (existing?.adapterType === 'antigravity') {
      removeAntigravityCredential({
        dataDir: ctx.engine.storage.dataDir,
        channelId: req.params.id
      })
    }
    if (existing?.adapterType === 'gcil') {
      removeGcilCredential({
        dataDir: ctx.engine.storage.dataDir,
        channelId: req.params.id
      })
    }
    if (typeof ctx.engine.deleteChannel === 'function') await ctx.engine.deleteChannel(req.params.id)
    else await ctx.engine.storage.deleteChannel(req.params.id)
    const configMirrorPersisted = await syncChannelsToConfig(ctx)
    res.json({ ok: true, configMirrorPersisted })
  })

  return router
}
