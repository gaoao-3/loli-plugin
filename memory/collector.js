/**
 * 记忆采集器 — 实时追加对话到 SQLite
 */
import { addMessage } from './store.js'

/**
 * 采集一条对话
 * @param {Object} opts
 * @param {string} opts.baseDir
 * @param {Object} [opts.config]
 * @param {Object} opts.event - Yunzai 事件
 * @param {string} opts.userText - 用户说的文本
 * @param {string} [opts.assistantText] - AI 回复的文本
 */
export function collect ({ baseDir, event, userText, assistantText, config }) {
  if (!baseDir || !event) return

  const memoryConfig = config?.memory || {}
  const groupConfig = memoryConfig.group || {}
  const userConfig = memoryConfig.user || {}
  const groupId = event.isGroup ? String(event.group_id) : null
  const userId = String(event.user_id || event.sender?.user_id || '')
  const nickname = event.sender?.nickname || userId
  const createdAt = Date.now()

  if (groupId) {
    const enabledGroups = Array.isArray(groupConfig.enabledGroups) ? groupConfig.enabledGroups.map(String) : []
    const groupEnabled = groupConfig.enable !== false && (enabledGroups.length === 0 || enabledGroups.includes(groupId))
    if (groupEnabled && userText) {
      addMessage(baseDir, {
        scope: 'group',
        targetId: groupId,
        groupId,
        userId,
        nickname,
        role: 'user',
        text: userText,
        createdAt
      })
    }
  }

  if (userId && userConfig.enable !== false) {
    const userScope = groupId ? 'group_user' : 'private_user'
    const userTargetId = groupId ? `${groupId}:${userId}` : userId
    if (userText) {
      addMessage(baseDir, {
        scope: userScope,
        targetId: userTargetId,
        groupId,
        userId,
        nickname,
        role: 'user',
        text: userText,
        createdAt
      })
    }
    if (assistantText) {
      addMessage(baseDir, {
        scope: userScope,
        targetId: userTargetId,
        groupId,
        userId,
        nickname: 'AI',
        role: 'assistant',
        text: assistantText,
        createdAt
      })
    }
  }
}
