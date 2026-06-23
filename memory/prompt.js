/**
 * 记忆提示构建器 — 从 .md 文件拼装 system prompt 记忆段
 */
import { retrieveMemories } from './retriever.js'

/**
 * @param {Object} opts
 * @param {string} opts.baseDir
 * @param {string} [opts.groupId]
 * @param {string} [opts.userId]
 * @param {string} [opts.queryText]
 * @returns {string|null}
 */
export function buildMemoryPrompt ({ baseDir, groupId, userId, queryText = '' }) {
  if (!baseDir) return null

  const mem = retrieveMemories({ baseDir, groupId, userId, queryText })
  const parts = []

  if (mem.userImpression) {
    parts.push(`[关于此用户的记忆]\n${mem.userImpression.slice(0, 500)}`)
  }
  if (mem.todayUser) {
    parts.push(`[用户今日对话摘要]\n${mem.todayUser.slice(0, 300)}`)
  }
  if (mem.groupImpression) {
    parts.push(`[本群画像]\n${mem.groupImpression.slice(0, 500)}`)
  }
  if (mem.todayGroup) {
    parts.push(`[本群今日对话摘要]\n${mem.todayGroup.slice(0, 300)}`)
  }

  return parts.length > 0 ? parts.join('\n\n') : null
}
