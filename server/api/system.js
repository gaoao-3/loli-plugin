import { Router } from 'express'

export default function systemRoutes (ctx) {
  const router = Router()
  const startTime = Date.now()

  router.get('/status', async (req, res) => {
    try {
      const stats = await ctx.engine.storage.stats()
      const uptime = Math.floor((Date.now() - startTime) / 1000)
      const tools = ctx.engine.toolLoader.getAll()
      const channels = await ctx.engine.listChannels()
      res.json({
        status: 'ok',
        message: '系统运行正常',
        version: ctx.config.version || '0.1.0',
        uptime: `${uptime}s`,
        stats: {
          totalKeys: stats.totalKeys,
          channels: channels.length,
          tools: tools.length
        }
      })
    } catch (err) {
      res.status(500).json({ status: 'error', message: err.message })
    }
  })

  router.get('/health', (req, res) => {
    res.json({ status: 'ok' })
  })

  return router
}
