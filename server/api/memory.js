import { Router } from 'express'
import path from 'path'
import { getStats } from '../../memory/store.js'

export default function memoryRoutes (ctx) {
  const router = Router()

  router.get('/stats', (req, res) => {
    const cfg = ctx.config?.memory?.dailyMd?.dataDir || 'data/memory/md'
    const baseDir = path.isAbsolute(cfg) ? cfg : path.resolve(ctx.dataDir, '..', cfg)
    res.json(getStats(baseDir))
  })

  router.get('/markdown', (req, res) => {
    const cfg = ctx.config?.memory?.dailyMd?.dataDir || 'data/memory/md'
    const baseDir = path.isAbsolute(cfg) ? cfg : path.resolve(ctx.dataDir, '..', cfg)
    const stats = getStats(baseDir)
    res.type('text/markdown').send(`# 记忆数据库\n\n- 消息: ${stats.messages}\n- 摘要: ${stats.summaries}\n- 已归档摘要: ${stats.archivedSummaries}\n- 画像: ${stats.profiles}\n- 记忆块: ${stats.chunks}\n- 向量: ${stats.embeddings}\n- 数据库: ${stats.dbPath}\n`)
  })

  return router
}
