import { Router } from 'express'
import systemRoutes from './system.js'
import channelRoutes from './channels.js'
import presetRoutes from './presets.js'
import toolRoutes from './tools.js'
import memoryRoutes from './memory.js'
import configRoutes from './config.js'
import logRoutes from './logs.js'

export default function createApiRoutes (ctx) {
  const router = Router()

  router.get('/health', (req, res) => res.json({ status: 'ok' }))

  router.use('/system', systemRoutes(ctx))
  router.use('/channels', channelRoutes(ctx))
  router.use('/presets', presetRoutes(ctx))
  router.use('/tools', toolRoutes(ctx))
  router.use('/memory', memoryRoutes(ctx))
  router.use('/config', configRoutes(ctx))
  router.use('/logs', logRoutes(ctx))

  return router
}
