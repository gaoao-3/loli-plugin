import { Router } from 'express'
import path from 'path'
import { getStats } from '../../memory/store.js'
import { resolveMemoryBaseDir } from '../../memory/options.js'

export default function memoryRoutes (ctx) {
  const router = Router()

  router.get('/stats', (req, res) => {
    const baseDir = resolveMemoryBaseDir(ctx.config, path.resolve(ctx.dataDir, '..'))
    res.json(getStats(baseDir))
  })

  router.get('/markdown', (req, res) => {
    const baseDir = resolveMemoryBaseDir(ctx.config, path.resolve(ctx.dataDir, '..'))
    const stats = getStats(baseDir)
    res.type('text/markdown').send(`# 记忆数据库\n\n- 消息: ${stats.messages}\n- 摘要: ${stats.summaries}\n- 画像: ${stats.profiles}\n- 身份账本: ${stats.identities}\n- 记忆块: ${stats.chunks}\n- 向量: ${stats.embeddings}\n- 已学习群: ${stats.learnedGroups}\n- 群风格版本: ${stats.learningVersions}\n- 数据库: ${stats.dbPath}\n`)
  })

  return router
}
