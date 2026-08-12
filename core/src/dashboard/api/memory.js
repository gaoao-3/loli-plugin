import { Router } from 'express'

function unavailableStats () {
  return {
    available: false,
    messages: 0,
    identities: 0,
    learnedGroups: 0,
    learningVersions: 0,
    learnedMembers: 0,
    memberMemoryVersions: 0,
    embeddings: 0,
    dbPath: ''
  }
}

async function readStats (ctx) {
  if (typeof ctx.memory?.getStats === 'function') {
    return await ctx.memory.getStats()
  }
  return unavailableStats()
}

export default function memoryRoutes (ctx) {
  const router = Router()

  router.get('/stats', async (req, res, next) => {
    try {
      res.json(await readStats(ctx))
    } catch (err) {
      next(err)
    }
  })

  router.get('/markdown', async (req, res, next) => {
    try {
      if (typeof ctx.memory?.getMarkdown === 'function') {
        return res.type('text/markdown').send(await ctx.memory.getMarkdown())
      }
      const stats = await readStats(ctx)
      res.type('text/markdown').send(`# 记忆数据库\n\n- 原始消息: ${stats.messages}\n- 身份账本: ${stats.identities}\n- 已学习群: ${stats.learnedGroups}\n- 群风格版本: ${stats.learningVersions}\n- 已学习群友: ${stats.learnedMembers}\n- 群友记忆版本: ${stats.memberMemoryVersions}\n- Gemini 记忆向量: ${stats.embeddings || 0}\n- 数据库: ${stats.dbPath || '未接入'}\n`)
    } catch (err) {
      next(err)
    }
  })

  return router
}
