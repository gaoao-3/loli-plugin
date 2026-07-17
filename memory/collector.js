/**
 * 记忆采集器 — 实时追加对话到 SQLite
 */
import { addMessage } from './store.js'
import { resolveEventIdentity, stripIdentityPrompt } from '../utils/identity.js'
import { isGroupEvent } from '../utils/bot.js'
import { recordGroupIdentity } from './identity.js'

/**
 * 采集一条对话
 * @param {Object} opts
 * @param {string} opts.baseDir
 * @param {Object} [opts.config]
 * @param {Object} opts.event - Yunzai 事件
 * @param {string} opts.userText - 用户说的文本
 * @param {string} [opts.assistantText] - AI 回复的文本
 * @param {Object} [opts.assistantIdentity] - 当前回复所使用的机器人 QQ 与角色预设名
 */
export function collect ({ baseDir, event, userText, assistantText, assistantIdentity, config }) {
  if (!baseDir || !event) return

  const memoryConfig = config?.memory || {}
  const groupConfig = memoryConfig.group || {}
  const userConfig = memoryConfig.user || {}
  const groupId = isGroupEvent(event) ? String(event.group_id || event.group?.group_id || event.group?.gid) : null
  const identity = resolveEventIdentity(event, config)
  const userId = identity.userId
  const nickname = identity.displayName || userId
  const cleanUserText = stripIdentityPrompt(userText)
  const createdAt = resolveEventTime(event)
  const messageKey = resolveMessageKey(event, userId, cleanUserText, createdAt)
  const identityFields = {
    displayName: identity.displayName,
    card: identity.card,
    accountNickname: identity.nickname,
    senderRole: identity.role,
    senderTitle: identity.title,
    isMaster: identity.isMaster,
    appellation: identity.appellation
  }
  const assistant = normalizeAssistantIdentity(assistantIdentity)
  const assistantFields = {
    displayName: assistant.displayName,
    accountNickname: assistant.nickname,
    senderRole: 'bot',
    senderTitle: assistant.title
  }

  if (groupId) {
    const enabledGroups = Array.isArray(groupConfig.enabledGroups) ? groupConfig.enabledGroups.map(String) : []
    const groupEnabled = groupConfig.enable !== false && (enabledGroups.length === 0 || enabledGroups.includes(groupId))
    if (groupEnabled && cleanUserText) {
      addMessage(baseDir, {
        scope: 'group',
        targetId: groupId,
        groupId,
        userId,
        nickname,
        role: 'user',
        text: cleanUserText,
        messageKey,
        ...identityFields,
        createdAt
      })
    }
    if (groupEnabled && assistantText) {
      addMessage(baseDir, {
        scope: 'group',
        targetId: groupId,
        groupId,
        userId: assistant.userId || null,
        nickname: assistant.displayName,
        ...assistantFields,
        role: 'assistant',
        text: assistantText,
        messageKey: `assistant:${messageKey}`,
        createdAt
      })
    }
  }

  if (userId && userConfig.enable !== false) {
    const userScope = groupId ? 'group_user' : 'private_user'
    const userTargetId = groupId ? `${groupId}:${userId}` : userId
    if (cleanUserText) {
      addMessage(baseDir, {
        scope: userScope,
        targetId: userTargetId,
        groupId,
        userId,
        nickname,
        role: 'user',
        text: cleanUserText,
        messageKey,
        ...identityFields,
        createdAt
      })
    }
    if (assistantText) {
      addMessage(baseDir, {
        scope: userScope,
        targetId: userTargetId,
        groupId,
        userId: assistant.userId || null,
        nickname: assistant.displayName,
        ...assistantFields,
        role: 'assistant',
        text: assistantText,
        messageKey: `assistant:${messageKey}`,
        createdAt
      })
    }
  }
}

function normalizeAssistantIdentity (identity) {
  const displayName = String(identity?.displayName || identity?.name || 'AI助手').trim().slice(0, 80) || 'AI助手'
  return {
    userId: String(identity?.userId || '').trim(),
    displayName,
    nickname: String(identity?.nickname || displayName).trim().slice(0, 80),
    title: String(identity?.title || '').trim().slice(0, 80)
  }
}

/**
 * 旁听群消息：只写入群级原始记忆，不把未触发机器人的闲聊写进个人对话记忆。
 * 后续摘要、历史检索和群风格学习共用这份去重后的消息流。
 */
export function collectAmbientGroupMessage ({ baseDir, event, userText, config }) {
  if (!baseDir || !event || !isGroupEvent(event)) return false
  const memoryConfig = config?.memory || {}
  const groupConfig = memoryConfig.group || {}
  const groupId = String(event.group_id || event.group?.group_id || event.group?.gid || '')
  if (!groupId || groupConfig.enable === false) return false
  const enabledGroups = Array.isArray(groupConfig.enabledGroups) ? groupConfig.enabledGroups.map(String) : []
  if (enabledGroups.length > 0 && !enabledGroups.includes(groupId)) return false

  const identity = resolveEventIdentity(event, config)
  const cleanUserText = stripIdentityPrompt(userText)
  if (!identity.userId) return false
  const createdAt = resolveEventTime(event)
  recordGroupIdentity({ baseDir, groupId, identity, observedAt: createdAt })
  if (!cleanUserText) return false
  const changes = addMessage(baseDir, {
    scope: 'group',
    targetId: groupId,
    groupId,
    userId: identity.userId,
    nickname: identity.displayName || identity.userId,
    displayName: identity.displayName,
    card: identity.card,
    accountNickname: identity.nickname,
    senderRole: identity.role,
    senderTitle: identity.title,
    isMaster: identity.isMaster,
    appellation: identity.appellation,
    messageKey: resolveMessageKey(event, identity.userId, cleanUserText, createdAt),
    role: 'user',
    text: cleanUserText,
    createdAt
  })
  return changes > 0
}

function resolveEventTime (event) {
  const seconds = Number(event?.time)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now()
}

function resolveMessageKey (event, userId, text, createdAt) {
  const source = event?.message_id || event?.messageId || event?.seq || event?.source?.seq
  if (source !== undefined && source !== null && source !== '') return String(source)
  return `${userId || '-'}:${createdAt}:${simpleHash(text || '')}`
}

function simpleHash (value) {
  let hash = 0
  for (const char of String(value || '')) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  return String(hash)
}
