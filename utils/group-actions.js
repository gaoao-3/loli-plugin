import { getEventBot, getEventGroup, getGroupId } from './bot.js'
import { beginGroupActionAudit, finishGroupActionAudit } from './group-audit.js'

function ensureSuccess (result, action) {
  if (result === false) throw new Error(`${action} 被 QQ 服务器拒绝`)
  return result
}

export async function executeGroupMute (event, targetUserId, durationSeconds) {
  const groupId = Number(getGroupId(event))
  const userId = Number(targetUserId)
  const duration = Number(durationSeconds)
  const group = event?.group || getEventGroup(event)
  const bot = getEventBot(event)

  if (typeof group?.muteMember === 'function') {
    return ensureSuccess(await group.muteMember(userId, duration), '群禁言')
  }
  const member = typeof group?.pickMember === 'function' ? group.pickMember(userId) : null
  if (typeof member?.mute === 'function') {
    return ensureSuccess(await member.mute(duration), '群禁言')
  }
  if (typeof bot?.setGroupBan === 'function') {
    return ensureSuccess(await bot.setGroupBan(groupId, userId, duration), '群禁言')
  }
  if (typeof bot?.sendApi === 'function') {
    return ensureSuccess(await bot.sendApi('set_group_ban', {
      group_id: groupId,
      user_id: userId,
      duration
    }), '群禁言')
  }
  throw new Error('当前 QQ 适配器不支持群禁言')
}

export async function executeGroupRecall (event, messageId) {
  const group = event?.group || getEventGroup(event)
  const bot = getEventBot(event)
  if (typeof group?.recallMsg === 'function') {
    return ensureSuccess(await group.recallMsg(String(messageId)), '群消息撤回')
  }
  if (typeof bot?.deleteMsg === 'function') {
    return ensureSuccess(await bot.deleteMsg(String(messageId)), '群消息撤回')
  }
  if (typeof bot?.sendApi === 'function') {
    return ensureSuccess(await bot.sendApi('delete_msg', { message_id: String(messageId) }), '群消息撤回')
  }
  throw new Error('当前 QQ 适配器不支持群消息撤回')
}

export async function executeGroupKick (event, targetUserId, {
  reason = '',
  rejectAddRequest = false
} = {}) {
  const groupId = Number(getGroupId(event))
  const userId = Number(targetUserId)
  const group = event?.group || getEventGroup(event)
  const bot = getEventBot(event)
  if (typeof group?.kickMember === 'function') {
    return ensureSuccess(await group.kickMember(userId, String(reason || ''), Boolean(rejectAddRequest)), '踢出群成员')
  }
  const member = typeof group?.pickMember === 'function' ? group.pickMember(userId) : null
  if (typeof member?.kick === 'function') {
    return ensureSuccess(await member.kick(String(reason || ''), Boolean(rejectAddRequest)), '踢出群成员')
  }
  if (typeof bot?.setGroupKick === 'function') {
    return ensureSuccess(await bot.setGroupKick(groupId, userId, Boolean(rejectAddRequest), String(reason || '')), '踢出群成员')
  }
  if (typeof bot?.sendApi === 'function') {
    return ensureSuccess(await bot.sendApi('set_group_kick', {
      group_id: groupId,
      user_id: userId,
      reject_add_request: Boolean(rejectAddRequest)
    }), '踢出群成员')
  }
  throw new Error('当前 QQ 适配器不支持踢出群成员')
}

export async function executeGroupSetCard (event, targetUserId, card) {
  const groupId = Number(getGroupId(event))
  const userId = Number(targetUserId)
  const value = String(card ?? '')
  const group = event?.group || getEventGroup(event)
  const bot = getEventBot(event)
  if (typeof group?.setCard === 'function') {
    return ensureSuccess(await group.setCard(userId, value), '修改群名片')
  }
  const member = typeof group?.pickMember === 'function' ? group.pickMember(userId) : null
  if (typeof member?.setCard === 'function') {
    return ensureSuccess(await member.setCard(value), '修改群名片')
  }
  if (typeof bot?.setGroupCard === 'function') {
    return ensureSuccess(await bot.setGroupCard(groupId, userId, value), '修改群名片')
  }
  if (typeof bot?.sendApi === 'function') {
    return ensureSuccess(await bot.sendApi('set_group_card', {
      group_id: groupId,
      user_id: userId,
      card: value
    }), '修改群名片')
  }
  throw new Error('当前 QQ 适配器不支持修改群名片')
}

export async function executeGroupSetName (event, name) {
  const groupId = Number(getGroupId(event))
  const value = String(name)
  const group = event?.group || getEventGroup(event)
  const bot = getEventBot(event)
  if (typeof group?.setName === 'function') {
    return ensureSuccess(await group.setName(value), '修改群名称')
  }
  if (typeof bot?.setGroupName === 'function') {
    return ensureSuccess(await bot.setGroupName(groupId, value), '修改群名称')
  }
  if (typeof bot?.sendApi === 'function') {
    return ensureSuccess(await bot.sendApi('set_group_name', {
      group_id: groupId,
      group_name: value
    }), '修改群名称')
  }
  throw new Error('当前 QQ 适配器不支持修改群名称')
}

export async function runAuditedGroupAction ({
  authorization,
  action,
  targetUserId,
  targetMessageId,
  metadata,
  execute,
  dbFile
}) {
  const audit = beginGroupActionAudit({
    authorization,
    action,
    targetUserId,
    targetMessageId,
    metadata,
    dbFile
  })
  if (!authorization?.allowed) {
    return {
      ok: false,
      reason: authorization?.reason || 'permission_denied',
      auditId: audit.correlationId
    }
  }
  try {
    await execute()
    finishGroupActionAudit({
      correlationId: audit.correlationId,
      status: 'success',
      dbFile
    })
    return { ok: true, reason: 'success', auditId: audit.correlationId }
  } catch (error) {
    finishGroupActionAudit({
      correlationId: audit.correlationId,
      status: 'failed',
      reasonCode: 'adapter_error',
      error: error.message,
      dbFile
    })
    return {
      ok: false,
      reason: 'adapter_error',
      error: error.message,
      auditId: audit.correlationId
    }
  }
}
