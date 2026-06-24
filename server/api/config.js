import { Router } from 'express'

export default function configRoutes (ctx) {
  const router = Router()

  router.get('/', (req, res) => {
    res.json(ctx.config)
  })

  router.put('/', (req, res) => {
    // 合并配置，避免覆盖整个对象
    const updates = req.body
    Object.assign(ctx.config, updates)
    ctx.saveConfig()
    res.json({ ok: true, config: ctx.config })
  })

  return router
}
