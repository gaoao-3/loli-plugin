import { Router } from 'express'

/** 深度合并：仅覆盖传入的字段，保留未传入的嵌套属性 */
function deepMerge (target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {}
      deepMerge(target[key], source[key])
    } else {
      target[key] = source[key]
    }
  }
  return target
}

export default function configRoutes (ctx) {
  const router = Router()

  router.get('/', (req, res) => {
    res.json(ctx.config)
  })

  router.put('/', (req, res) => {
    // 深度合并配置，避免覆盖整个嵌套对象
    deepMerge(ctx.config, req.body)
    ctx.saveConfig()
    res.json({ ok: true, config: ctx.config })
  })

  return router
}
