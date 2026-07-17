/**
 * 记忆检索器 — 从 SQLite 读取摘要和画像
 */
import { searchRelevantChunks } from './embedding.js'
import { getProfile, getRecentSummaries, getSummary, getTargetIdentity, today } from './store.js'
import { applyMasterIdentityConfig } from '../utils/identity.js'

/**
 * 检索相关记忆
 * @param {Object} opts
 * @param {string} opts.baseDir - memory 根目录
 * @param {string} [opts.groupId]
 * @param {string} [opts.userId]
 * @returns {Promise<{ groupImpression?: string, userImpression?: string, todayGroup?: string, todayUser?: string, relevant?: Array }>}
 */
export async function retrieveMemories ({ baseDir, groupId, userId, queryText = '', config }) {
  const result = {}
  const currentDate = today()
  const memoryConfig = config?.memory || {}
  const groupConfig = memoryConfig.group || {}
  const userConfig = memoryConfig.user || {}
  const enabledGroups = Array.isArray(groupConfig.enabledGroups) ? groupConfig.enabledGroups.map(String) : []
  const groupEnabled = Boolean(groupId) && groupConfig.enable !== false &&
    (enabledGroups.length === 0 || enabledGroups.includes(String(groupId)))
  const userEnabled = Boolean(userId) && userConfig.enable !== false

  if (groupEnabled) {
    const profile = getProfile(baseDir, 'group', groupId)
    if (profile?.profile) result.groupImpression = profile.profile

    const summary = getSummary(baseDir, 'group', groupId, currentDate)
    if (summary?.summary) {
      result.todayGroup = summary.summary
    } else {
      const recent = getRecentSummaries(baseDir, 'group', groupId, 1)[0]
      if (recent?.summary) result.todayGroup = recent.summary
    }
  }

  if (userEnabled) {
    const userScope = groupId ? 'group_user' : 'private_user'
    const userTargetId = groupId ? `${groupId}:${userId}` : String(userId)
    result.userIdentity = applyMasterIdentityConfig(
      getTargetIdentity(baseDir, userScope, userTargetId),
      userId,
      config
    )
    const profile = getProfile(baseDir, userScope, userTargetId)
    if (profile?.profile) result.userImpression = profile.profile

    const summary = getSummary(baseDir, userScope, userTargetId, currentDate)
    if (summary?.summary) {
      result.todayUser = summary.summary
    } else {
      const recent = getRecentSummaries(baseDir, userScope, userTargetId, 1)[0]
      if (recent?.summary) result.todayUser = recent.summary
    }
  }

  if (queryText && (groupEnabled || userEnabled)) {
    try {
      result.relevant = await searchRelevantChunks({
        baseDir,
        config,
        groupId: groupEnabled ? groupId : null,
        userId: userEnabled ? userId : null,
        queryText
      })
      result.relevant = deduplicateRelevantMemories(result.relevant, result)
    } catch (err) {
      console.warn(`[Memory] 语义检索失败: ${String(err?.message || err).slice(0, 200)}`)
      result.relevant = []
    }
  }

  return result
}

/** 避免长期画像/今日摘要既作为固定上下文注入，又被向量检索重复召回。 */
export function deduplicateRelevantMemories (items, direct = {}) {
  const directTexts = new Set([
    direct.userImpression,
    direct.todayUser,
    direct.groupImpression,
    direct.todayGroup
  ].map(normalizeMemoryText).filter(Boolean))
  const seen = new Set()
  return (Array.isArray(items) ? items : []).filter(item => {
    const text = normalizeMemoryText(item?.text)
    if (!text || directTexts.has(text) || seen.has(text)) return false
    seen.add(text)
    return true
  })
}

function normalizeMemoryText (value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}
