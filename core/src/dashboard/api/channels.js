import { Router } from 'express'
import { normalizeGeminiSafetyLevel } from '../../clients/gemini.js'
import { discoverModels } from '../model-discovery.js'
import { testModel } from '../model-test.js'

export function normalizeChannelPayload (input = {}, existing = {}) {
  const adapterType = input.adapterType || existing.adapterType || 'gemini'
  const options = { ...(existing.options || {}), ...(input.options || {}) }
  if (Object.hasOwn(input, 'apiKey')) options.apiKey = input.apiKey
  if (Object.hasOwn(input, 'baseUrl')) options.baseUrl = input.baseUrl
  delete options.providerType
  delete options.protocol
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
export async function syncChannelsToConfig (ctx) {
  // saveChannel 先更新缓存；必须等独立渠道文件真正落盘后再写镜像配置和响应。
  ctx.engine.storage.flush?.()
  const channels = await ctx.engine.listChannels()
  const candidate = structuredClone(ctx.config)
  if (!candidate.chaite) candidate.chaite = {}
  candidate.chaite.channels = channels
  try {
    ctx.saveConfig(candidate)
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
      const models = await discoverModels({
        adapterType: req.body?.adapterType || channel.adapterType,
        apiKey: channel.options?.apiKey,
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
      const result = await testModel({
        adapterType: req.body?.adapterType || channel.adapterType,
        apiKey: channel.options?.apiKey,
        baseUrl: channel.options?.baseUrl,
        safetyLevel: channel.options?.safetyLevel,
        model
      })
      res.json(result)
    } catch (err) {
      res.status(502).json({ error: err?.message || '模型测试失败' })
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
    if (typeof ctx.engine.deleteChannel === 'function') await ctx.engine.deleteChannel(req.params.id)
    else await ctx.engine.storage.deleteChannel(req.params.id)
    const configMirrorPersisted = await syncChannelsToConfig(ctx)
    res.json({ ok: true, configMirrorPersisted })
  })

  return router
}
