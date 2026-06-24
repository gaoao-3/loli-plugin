import { Router } from 'express'

export default function memoryRoutes (ctx) {
  const router = Router()

  router.get('/stats', (req, res) => {
    const memory = ctx.engine.getMemory?.()
    if (!memory) {
      return res.json({ enabled: false, entities: 0, relations: 0, archives: 0 })
    }
    res.json({
      enabled: true,
      entities: memory.graph?.entities?.size || 0,
      relations: memory.graph?.relations?.size || 0,
      archives: 0
    })
  })

  router.get('/markdown', (req, res) => {
    const md = ctx.engine.getMemoryMarkdown ? ctx.engine.getMemoryMarkdown() : ''
    res.type('text/markdown').send(md)
  })

  return router
}
