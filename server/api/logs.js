import { Router } from 'express'

const MAX_LOG_LINES = 500

export default function logRoutes (ctx) {
  const router = Router()

  router.get('/', (req, res) => {
    res.type('text/plain').send(ctx.logs.join('\n'))
  })

  router.post('/clear', (req, res) => {
    ctx.logs.length = 0
    res.json({ ok: true })
  })

  return router
}

export { MAX_LOG_LINES }
