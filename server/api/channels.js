import { Router } from 'express'
import { normalizeGeminiSafetyLevel } from 'lolicon-core/clients/gemini'
import { discoverModels } from '../model-discovery.js'

export function normalizeChannelPayload (input = {}, existing = {}) {
  const hasAdapterInput = Object.hasOwn(input, 'adapterType')
  const isAntigravity = input.adapterType === 'antigravity' ||
    input.options?.providerType === 'antigravity' ||
    (!hasAdapterInput && existing.options?.providerType === 'antigravity')
  const inferredProtocol = input.adapterType === 'openai' || input.adapterType === 'gemini'
    ? input.adapterType
    : existing.options?.protocol || (
        existing.options?.providerType === 'antigravity' ? existing.adapterType : 'gemini'
      )
  const antigravityProtocol = input.options?.protocol === 'openai'
    ? 'openai'
    : input.options?.protocol === 'gemini' ? 'gemini' : inferredProtocol
  const adapterType = isAntigravity
    ? (antigravityProtocol === 'openai' ? 'openai' : 'gemini')
    : input.adapterType || existing.adapterType || 'gemini'
  const options = { ...(existing.options || {}), ...(input.options || {}) }
  if (Object.hasOwn(input, 'apiKey')) options.apiKey = input.apiKey
  if (Object.hasOwn(input, 'baseUrl')) options.baseUrl = input.baseUrl
  if (isAntigravity) {
    options.providerType = 'antigravity'
    options.protocol = adapterType
  } else if (hasAdapterInput) {
    delete options.providerType
    delete options.protocol
  }
  if (adapterType === 'gemini') {
    options.safetyLevel = normalizeGeminiSafetyLevel(input.safetyLevel ?? options.safetyLevel)
  } else {
    delete options.safetyLevel
  }
  const channel = { ...existing, ...input, adapterType, options }
  delete channel.apiKey
  delete channel.baseUrl
  delete channel.safetyLevel
  return channel
}

/** 将引擎中的渠道列表同步到 config.chaite.channels 并落盘 */
async function syncToConfig (ctx) {
  const channels = await ctx.engine.listChannels()
  if (!ctx.config.chaite) ctx.config.chaite = {}
  ctx.config.chaite.channels = channels
  ctx.saveConfig()
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
    await syncToConfig(ctx)
    res.json({ ok: true, channel: ch })
  })

  router.post('/models/discover', async (req, res) => {
    try {
      const channel = normalizeChannelPayload(req.body)
      const models = await discoverModels({
        adapterType: req.body?.adapterType || channel.adapterType,
        providerType: channel.options?.providerType,
        protocol: channel.options?.protocol,
        apiKey: channel.options?.apiKey,
        baseUrl: channel.options?.baseUrl
      })
      res.json({ models })
    } catch (err) {
      res.status(502).json({ error: err?.message || '获取模型列表失败' })
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
    await syncToConfig(ctx)
    res.json({ ok: true, channel: ch })
  })

  router.delete('/:id', async (req, res) => {
    if (typeof ctx.engine.deleteChannel === 'function') await ctx.engine.deleteChannel(req.params.id)
    else await ctx.engine.storage.deleteChannel(req.params.id)
    await syncToConfig(ctx)
    res.json({ ok: true })
  })

  return router
}
