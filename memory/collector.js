/**
 * 记忆采集器 — 实时追加对话到 raw .txt
 * 无 AI 提取、无 SQLite，纯 append
 */
import { appendRaw } from './scheduler.js'

/**
 * 采集一条对话
 * @param {Object} opts
 * @param {string} opts.baseDir
 * @param {Object} opts.event - Yunzai 事件
 * @param {string} opts.userText - 用户说的文本
 * @param {string} [opts.assistantText] - AI 回复的文本
 */
export function collect ({ baseDir, event, userText, assistantText }) {
  if (!baseDir || !event) return

  const groupId = event.isGroup ? String(event.group_id) : null
  const userId = String(event.user_id || event.sender?.user_id || '')
  const nickname = event.sender?.nickname || userId

  const ts = new Date()
  ts.setHours(ts.getHours() + 8)
  const timeStr = ts.toTimeString().slice(0, 8)

  if (groupId) {
    const line = `[${timeStr}] ${nickname}: ${userText || ''}`.trim()
    appendRaw({ baseDir, scope: 'groups', id: groupId, line })
  }

  if (userId) {
    const line = `[${timeStr}] ${userText || ''}`.trim()
    appendRaw({ baseDir, scope: 'users', id: userId, line })
    if (assistantText) {
      appendRaw({ baseDir, scope: 'users', id: userId, line: `[${timeStr}] AI: ${assistantText}`.trim() })
    }
  }
}
