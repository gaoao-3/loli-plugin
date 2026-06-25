import { Router } from 'express'

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
    const ch = req.body
    if (!ch.id || !ch.name) return res.status(400).json({ error: '缺少 id 或 name' })
    await ctx.engine.saveChannel(ch)
    await syncToConfig(ctx)
    res.json({ ok: true, channel: ch })
  })

  router.get('/:id', async (req, res) => {
    const ch = await ctx.engine.storage.getChannel(req.params.id)
    if (!ch) return res.status(404).json({ error: 'Channel not found' })
    res.json(ch)
  })

  router.put('/:id', async (req, res) => {
    const ch = req.body
    ch.id = req.params.id
    await ctx.engine.saveChannel(ch)
    await syncToConfig(ctx)
    res.json({ ok: true, channel: ch })
  })

  router.delete('/:id', async (req, res) => {
    await ctx.engine.storage.deleteChannel(req.params.id)
    await syncToConfig(ctx)
    res.json({ ok: true })
  })

  return router
}
