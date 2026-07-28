import { Router } from 'express'

const MAX_LOG_LINES = 500

function parseLogLine (line) {
  if (line && typeof line === 'object') return line

  const text = String(line ?? '')
  const match = text.match(/^\[([^\]]+)] \[(DEBUG|INFO|WARN|ERROR)]\s?(.*)$/s)
  if (!match) {
    return { timestamp: '', level: 'INFO', message: text }
  }

  return {
    timestamp: match[1],
    level: match[2],
    message: match[3]
  }
}

export default function logRoutes (ctx) {
  const router = Router()

  router.get('/', (req, res) => {
    res.json(ctx.logs.slice(-MAX_LOG_LINES).map(parseLogLine))
  })

  router.post('/clear', (req, res) => {
    ctx.logs.length = 0
    res.json({ ok: true })
  })

  return router
}

export { MAX_LOG_LINES }
