import { getEventGroup, getGroupId, getSelfId, isGroupEvent } from './bot.js'
import { isMasterIdentity, resolveDetailedEventIdentity, resolveSenderIdentity } from './identity.js'
import { getGroupModerationConfig, getViolationPolicy } from './group-moderation.js'

const ROLE_RANK = { member: 1, admin: 2, owner: 3 }

function normalizeId (value) {
  return value === undefined || value === null || value === '' ? '' : String(value)
}

function mapValue (map, id) {
  if (!map || !id) return null
  if (map instanceof Map) return map.get(id) || map.get(Number(id)) || map.get(String(id)) || null
  return map[id] || map[Number(id)] || map[String(id)] || null
}

async function getLiveMember (event, userId) {
  const group = getEventGroup(event) || event?.group
  if (!group || !userId) return null
  let member = mapValue(group.gml, userId)
  if (!member && typeof group.getMemberMap === 'function') {
    try {
      member = mapValue(await group.getMemberMap(true), userId)
    } catch {}
  }
  if (!member && typeof group.pickMember === 'function') {
    try {
      const picked = group.pickMember(Number(userId)) || group.pickMember(userId)
      member = picked?.info || picked || null
    } catch {}
  }
  return member
}

function result (allowed, reason, details) {
  return { allowed, reason, ...details }
}

/**
 * 群管理动作的统一授权入口。这里只判断，不调用任何 QQ 管理接口。
 */
export async function authorizeGroupAction ({
  event,
  action,
  targetUserId = '',
  targetMessageId = '',
  allowBotAutonomy = false,
  autonomyViolationPoints = 0,
  autonomySeverity = '',
  config
} = {}) {
  const groupId = normalizeId(getGroupId(event))
  if (!event || !isGroupEvent(event) || !groupId) {
    return result(false, 'group_required', { action, groupId })
  }

  const actor = await resolveDetailedEventIdentity(event, config)
  const humanAuthority = action === 'set_group_name'
    ? actor.isMaster || actor.role === 'owner'
    : actor.isMaster || ['owner', 'admin'].includes(actor.role)
  const normalizedTargetId = normalizeId(targetUserId)
  const moderation = getGroupModerationConfig(config)
  const severityRequired = action === 'mute' || action === 'recall'
  const severityPolicy = severityRequired ? getViolationPolicy(autonomySeverity) : null
  const autonomyEnabled = allowBotAutonomy && moderation.botAutonomy
  const autonomyActionAllowed = (
    (action === 'mute' && moderation.allowMute !== false) ||
    (action === 'recall' && moderation.allowRecall !== false) ||
    (action === 'set_card' && moderation.allowRename !== false) ||
    action === 'kick'
  )
  const autonomyThreshold = moderation.kickViolationPoints
  const autonomyTargetMatched = normalizedTargetId && normalizedTargetId === actor.userId
  const autonomyEvidencePresent = action === 'kick' || Boolean(normalizeId(targetMessageId))
  const autonomySeverityValid = !severityRequired || Boolean(severityPolicy)
  const autonomyThresholdMet = action !== 'kick' || Number(autonomyViolationPoints) >= autonomyThreshold
  const botAutonomy = !humanAuthority && autonomyEnabled && autonomyActionAllowed &&
    autonomyTargetMatched && autonomyEvidencePresent && autonomySeverityValid && autonomyThresholdMet

  if (!humanAuthority && !botAutonomy) {
    let reason = 'caller_not_allowed'
    if (autonomyEnabled && autonomyActionAllowed && !autonomyTargetMatched) reason = 'autonomy_target_mismatch'
    else if (autonomyEnabled && autonomyActionAllowed && !autonomyEvidencePresent) reason = 'autonomy_evidence_required'
    else if (autonomyEnabled && autonomyActionAllowed && !autonomySeverityValid) reason = 'violation_severity_required'
    else if (autonomyEnabled && action === 'kick' && !autonomyThresholdMet) reason = 'violation_threshold_not_met'
    return result(false, reason, {
      action,
      groupId,
      actor,
      authority: 'none',
      violationPoints: Number(autonomyViolationPoints) || 0,
      violationThreshold: autonomyThreshold
    })
  }

  const botId = getSelfId(event)
  const botMember = await getLiveMember(event, botId)
  const bot = resolveSenderIdentity(botMember || { user_id: botId }, { config, inGroup: true })
  if ((ROLE_RANK[bot.role] || 0) < ROLE_RANK.admin) {
    return result(false, 'bot_permission_insufficient', {
      action, groupId, actor, bot, authority: botAutonomy ? 'bot_autonomy' : 'human'
    })
  }

  let target = null
  if (normalizedTargetId) {
    const targetMember = await getLiveMember(event, normalizedTargetId)
    if (!targetMember) {
      return result(false, 'target_not_found', { action, groupId, actor, bot, targetUserId: normalizedTargetId })
    }
    target = resolveSenderIdentity(targetMember, { config, inGroup: true })
    target.isMaster = isMasterIdentity(normalizedTargetId, { config })

    const actingOnBotMessage = action === 'recall' && normalizedTargetId === botId
    const editingBotCard = action === 'set_card' && normalizedTargetId === botId
    if (target.isMaster || (normalizedTargetId === botId && !actingOnBotMessage && !editingBotCard)) {
      return result(false, 'target_protected', { action, groupId, actor, bot, target })
    }
    if (actingOnBotMessage) {
      return result(true, 'allowed', {
        action: String(action || ''),
        groupId,
        actor,
        bot,
        target,
        authority: botAutonomy ? 'bot_autonomy' : 'human',
        targetMessageId: normalizeId(targetMessageId)
      })
    }
    if (editingBotCard && (actor.isMaster || actor.role === 'owner')) {
      return result(true, 'allowed', {
        action: String(action || ''),
        groupId,
        actor,
        bot,
        target,
        authority: 'human',
        targetMessageId: normalizeId(targetMessageId)
      })
    }
    if (target.role === 'owner') {
      return result(false, 'target_hierarchy_denied', { action, groupId, actor, bot, target })
    }
    if (!actor.isMaster && actor.role === 'admin' && ['owner', 'admin'].includes(target.role)) {
      return result(false, 'target_hierarchy_denied', { action, groupId, actor, bot, target })
    }
    if ((ROLE_RANK[bot.role] || 0) <= (ROLE_RANK[target.role] || 0)) {
      return result(false, 'target_hierarchy_denied', { action, groupId, actor, bot, target })
    }
  }

  return result(true, 'allowed', {
    action: String(action || ''),
    groupId,
    actor,
    bot,
    target,
    authority: botAutonomy ? 'bot_autonomy' : 'human',
    severity: severityPolicy?.severity || '',
    violationPoints: Number(autonomyViolationPoints) || 0,
    violationThreshold: autonomyThreshold,
    targetMessageId: normalizeId(targetMessageId)
  })
}
