import { Router } from 'express'
import { createHash } from 'crypto'
import { mergeConfigPatch, validateConfigShape } from '../config-validation.js'

function configRevision (config) {
  return `"${createHash('sha256').update(JSON.stringify(config)).digest('hex')}"`
}

export default function configRoutes (ctx) {
  const router = Router()

  router.get('/', (req, res) => {
    res.set('ETag', configRevision(ctx.config))
    res.json(ctx.config)
  })

  router.put('/', (req, res, next) => {
    const expectedRevision = req.get('if-match')
    if (expectedRevision && expectedRevision !== configRevision(ctx.config)) {
      return res.status(409).json({ error: '配置已被其他页面或进程修改，请刷新后重试' })
    }

    try {
      validateConfigShape(req.body, ctx.config)
    } catch (err) {
      return res.status(400).json({ error: err.message })
    }

    const candidate = structuredClone(ctx.config)
    mergeConfigPatch(candidate, req.body)
    try {
      // saveConfig(candidate) 必须先持久化再提交共享内存；抛错时保留旧运行时配置。
      ctx.saveConfig(candidate)
      if (JSON.stringify(ctx.config) !== JSON.stringify(candidate)) {
        for (const key of Object.keys(ctx.config)) delete ctx.config[key]
        Object.assign(ctx.config, candidate)
      }
      res.set('ETag', configRevision(ctx.config))
      res.json({ ok: true, config: ctx.config })
    } catch (err) {
      next(err)
    }
  })

  return router
}
