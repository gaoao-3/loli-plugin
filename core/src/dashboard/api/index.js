import { Router } from 'express'
import { createHash, timingSafeEqual } from 'crypto'
import systemRoutes from './system.js'
import channelRoutes from './channels.js'
import presetRoutes from './presets.js'
import toolRoutes from './tools.js'
import memoryRoutes from './memory.js'
import configRoutes from './config.js'
import logRoutes from './logs.js'
import chatRoutes from './chat.js'

function tokenMatches (received, required) {
  const digest = value => createHash('sha256').update(String(value).trim()).digest()
  return timingSafeEqual(digest(received), digest(required))
}

export default function createApiRoutes (ctx) {
  const router = Router()

  // API 包含渠道密钥与完整运行配置，禁止浏览器和中间代理缓存。
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    res.set('X-Content-Type-Options', 'nosniff')
    next()
  })

  // 访问令牌 (authToken) 校验中间件
  router.use((req, res, next) => {
    if (req.path === '/health') return next()

    const config = ctx.config || {}
    const requiredToken = config.dashboard?.authToken || ''
    
    // 若配置未设置令牌，则免校验
    if (!requiredToken) return next()

    // 提取 Token
    let token = req.headers['authorization'] || req.headers['x-auth-token'] || ''
    if (typeof token === 'string' && token.startsWith('Bearer ')) {
      token = token.slice(7)
    }

    if (typeof token === 'string' && tokenMatches(token, requiredToken)) {
      return next()
    }

    if (ctx.logger) {
      ctx.logger(`[dashboard] Auth validation failed for ${req.method} ${req.originalUrl}`)
    }

    res.status(401).send('Unauthorized: Invalid authToken')
  })

  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      authRequired: Boolean(ctx.config?.dashboard?.authToken)
    })
  })

  router.use('/system', systemRoutes(ctx))
  router.use('/channels', channelRoutes(ctx))
  router.use('/presets', presetRoutes(ctx))
  router.use('/tools', toolRoutes(ctx))
  router.use('/memory', memoryRoutes(ctx))
  router.use('/config', configRoutes(ctx))
  router.use('/logs', logRoutes(ctx))
  router.use('/chat', chatRoutes(ctx))

  return router
}
