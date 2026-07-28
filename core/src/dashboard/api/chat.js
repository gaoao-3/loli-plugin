import { Router } from 'express'
import { randomUUID } from 'crypto'

export default function chatRoutes (ctx) {
  const router = Router()

  // 1. 发送调试消息
  router.post('/send', async (req, res, next) => {
    try {
      const { presetId, text, conversationId, userId, groupId } = req.body
      if (!presetId) {
        return res.status(400).json({ error: '必须选择一个预设角色' })
      }
      if (!text) {
        return res.status(400).json({ error: '消息内容不能为空' })
      }

      // 获取预设，提取 channelId
      const preset = await ctx.engine.storage.getPreset(presetId)
      if (!preset) {
        return res.status(404).json({ error: '未找到选定的预设角色' })
      }

      const cid = conversationId || `debug-${presetId}-${randomUUID().slice(0, 8)}`
      const uId = userId || 'debug-user-123456'
      const gId = groupId || 'debug-group-987654'

      const userMessage = {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        timestamp: Date.now()
      }

      const result = await ctx.engine.sendMessage({
        channelId: preset.channelId || 'gemini',
        presetId,
        conversationId: cid,
        userMessage,
        userId: uId,
        groupId: gId
      })

      res.json({
        conversationId: cid,
        response: result.response,
        finalText: result.finalText
      })
    } catch (err) {
      next(err)
    }
  })

  // 2. 获取调试历史记录
  router.get('/history/:conversationId', async (req, res, next) => {
    try {
      const { conversationId } = req.params
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50
      const history = await ctx.engine.storage.getHistory(conversationId, limit)
      res.json(history)
    } catch (err) {
      next(err)
    }
  })

  // 3. 清空调试历史记录
  router.delete('/history/:conversationId', async (req, res, next) => {
    try {
      const { conversationId } = req.params
      await ctx.engine.storage.clearHistory(conversationId)
      res.json({ status: 'ok', message: '对话历史已成功清空' })
    } catch (err) {
      next(err)
    }
  })

  return router
}
