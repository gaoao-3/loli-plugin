import { CustomTool } from '../../core/index.js'
import { getConfig } from '../state.js'
import { getGroupId } from '../bot.js'
import { resolveEventIdentity } from '../identity.js'
import {
  claimGroupKickConfirmation,
  createGroupKickConfirmation,
  getGroupMemberViolationSummary,
  getGroupKickConfirmation,
  resolveGroupKickConfirmation
} from '../group-audit.js'
import { authorizeGroupAction } from '../group-management.js'
import { getGroupModerationConfig } from '../group-moderation.js'
import { executeGroupKick, runAuditedGroupAction } from '../group-actions.js'

function currentPlainText (event) {
  const direct = String(event?.msg || event?.raw_message || '').trim()
  if (direct) return direct
  return (event?.message || [])
    .filter(segment => segment?.type === 'text')
    .map(segment => segment?.text || segment?.data?.text || '')
    .join('')
    .trim()
}

function hasExactConfirmation (event, verb, confirmationId) {
  const text = currentPlainText(event)
  const escaped = String(confirmationId).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`^#?${verb}\\s+${escaped}$`, 'iu').test(text)
}

function compactResult (result, extra = {}) {
  return JSON.stringify({ ...result, ...extra })
}

export async function runGroupKick (args, context, {
  dbFile,
  execute = executeGroupKick,
  confirmationTtlMs = 300000,
  config = getConfig()
} = {}) {
  const event = context?.event
  const action = String(args?.action || 'request').trim()
  if (!event) return compactResult({ ok: false, reason: 'event_required', error: '无法获取当前 QQ 事件' })
  if (!['request', 'confirm', 'cancel'].includes(action)) {
    return compactResult({ ok: false, reason: 'invalid_action', error: 'action 只能是 request、confirm 或 cancel' })
  }

  if (action === 'request') {
    const targetUserId = String(args?.target_user_id || '').trim()
    const reason = String(args?.reason || '').trim().slice(0, 200)
    const rejectAddRequest = Boolean(args?.reject_add_request)
    if (!/^\d{5,20}$/u.test(targetUserId)) {
      return compactResult({ ok: false, reason: 'invalid_target', error: 'target_user_id 必须是 QQ 号' })
    }
    const moderation = getGroupModerationConfig(config)
    const violationWindowDays = moderation.violationWindowDays
    const violationSummary = getGroupMemberViolationSummary({
      groupId: getGroupId(event),
      targetUserId,
      windowMs: violationWindowDays * 24 * 60 * 60 * 1000,
      dbFile
    })
    const authorization = await authorizeGroupAction({
      event,
      action: 'kick',
      targetUserId,
      allowBotAutonomy: true,
      autonomyViolationPoints: violationSummary.points,
      config
    })
    let pending
    const result = await runAuditedGroupAction({
      authorization,
      action: 'kick_request',
      targetUserId,
      metadata: {
        reason,
        rejectAddRequest,
        violationCount: violationSummary.count,
        violationPoints: violationSummary.points,
        violationThreshold: authorization.violationThreshold
      },
      dbFile,
      execute: async () => {
        pending = createGroupKickConfirmation({
          groupId: authorization.groupId,
          targetUserId,
          requesterId: authorization.authority === 'bot_autonomy'
            ? authorization.bot.userId
            : authorization.actor.userId,
          reason,
          rejectAddRequest,
          ttlMs: confirmationTtlMs,
          dbFile
        })
      }
    })
    if (!result.ok) return compactResult(result, { targetUserId })
    return compactResult({
      ...result,
      confirmationRequired: true,
      confirmationId: pending.confirmationId,
      targetUserId,
      expiresAt: pending.expiresAt,
      authority: authorization.authority,
      violationCount: violationSummary.count,
      violationPoints: violationSummary.points,
      violationThreshold: authorization.violationThreshold,
      message: `踢人请求已创建，5 分钟内请由机器人主人、群主或管理员明确发送：确认踢人 ${pending.confirmationId}`
    })
  }

  const confirmationId = String(args?.confirmation_id || '').trim().toUpperCase()
  if (!/^[A-F0-9]{8}$/u.test(confirmationId)) {
    return compactResult({ ok: false, reason: 'invalid_confirmation_id', error: 'confirmation_id 格式错误' })
  }
  const pending = getGroupKickConfirmation(confirmationId, { dbFile })
  if (!pending) return compactResult({ ok: false, reason: 'confirmation_not_found', error: '没有找到该踢人确认请求' })
  if (pending.status !== 'pending') {
    return compactResult({
      ok: false,
      reason: `confirmation_${pending.status}`,
      error: `该踢人请求状态为 ${pending.status}`
    })
  }
  if (String(getGroupId(event)) !== pending.groupId) {
    return compactResult({ ok: false, reason: 'confirmation_group_mismatch', error: '必须在创建请求的群内确认' })
  }

  if (action === 'cancel') {
    if (!hasExactConfirmation(event, '取消踢人', confirmationId)) {
      return compactResult({
        ok: false,
        reason: 'explicit_cancellation_required',
        error: `请由授权人员明确发送：取消踢人 ${confirmationId}`
      })
    }
    const authorization = await authorizeGroupAction({
      event,
      action: 'kick_cancel',
      config
    })
    const audit = await runAuditedGroupAction({
      authorization,
      action: 'kick_cancel',
      targetUserId: pending.targetUserId,
      metadata: { confirmationId },
      dbFile,
      execute: async () => {
        if (!resolveGroupKickConfirmation({
          confirmationId,
          status: 'cancelled',
          resolvedBy: authorization.actor.userId,
          dbFile
        })) throw new Error('踢人请求已被其他人处理或已经过期')
      }
    })
    return compactResult(audit, {
      confirmationId,
      targetUserId: pending.targetUserId,
      message: audit.ok ? '已取消踢人请求' : undefined
    })
  }

  if (!hasExactConfirmation(event, '确认踢人', confirmationId)) {
    return compactResult({
      ok: false,
      reason: 'explicit_confirmation_required',
      error: `不能仅凭工具参数确认；请由授权人员明确发送：确认踢人 ${confirmationId}`
    })
  }
  const approver = resolveEventIdentity(event, config)
  if (approver.userId === pending.targetUserId) {
    return compactResult({ ok: false, reason: 'target_cannot_confirm', error: '被踢目标不能确认自己的踢人请求' })
  }
  // 确认时重新读取实时角色，避免请求创建后权限或目标身份发生变化。
  const authorization = await authorizeGroupAction({
    event,
    action: 'kick',
    targetUserId: pending.targetUserId,
    config
  })
  if (authorization.allowed && !claimGroupKickConfirmation({
    confirmationId,
    resolvedBy: authorization.actor.userId,
    dbFile
  })) {
    return compactResult({
      ok: false,
      reason: 'confirmation_already_processing',
      error: '该踢人请求已被其他确认操作处理'
    })
  }
  const result = await runAuditedGroupAction({
    authorization,
    action: 'kick',
    targetUserId: pending.targetUserId,
    metadata: {
      confirmationId,
      reason: pending.reason,
      rejectAddRequest: pending.rejectAddRequest
    },
    dbFile,
    execute: () => execute(event, pending.targetUserId, {
      reason: pending.reason,
      rejectAddRequest: pending.rejectAddRequest
    })
  })
  if (result.ok) {
    resolveGroupKickConfirmation({
      confirmationId,
      status: 'confirmed',
      resolvedBy: authorization.actor.userId,
      dbFile
    })
  } else if (result.reason === 'adapter_error') {
    resolveGroupKickConfirmation({
      confirmationId,
      status: 'failed',
      resolvedBy: authorization.actor?.userId,
      dbFile
    })
  }
  return compactResult(result, {
    confirmationId,
    targetUserId: pending.targetUserId,
    message: result.ok ? `已确认并踢出 QQ ${pending.targetUserId}` : undefined
  })
}

class GroupKick extends CustomTool {
  name = 'group_kick'

  function = {
    name: 'group_kick',
    description: `踢出当前群成员，必须经过两阶段显式确认。
先以 action=request 和准确 QQ 创建请求，此时绝不踢人；工具返回 8 位确认码。
主人、群主和管理员可正常创建请求。机器人自治时只能针对当前触发消息的发送者，且该成员在配置窗口内的加权违规分达到阈值后才能创建请求。
随后机器人主人、当前群群主或管理员必须在同一群明确发送“确认踢人 确认码”，才能以 action=confirm 执行。模型不得自行补写确认语句或只凭工具参数确认。
可由授权人员发送“取消踢人 确认码”并以 action=cancel 取消。请求 5 分钟过期，确认时会重新检查机器人、确认者和目标权限。`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['request', 'confirm', 'cancel'],
          description: 'request 创建待确认请求；confirm 执行明确确认；cancel 取消请求'
        },
        target_user_id: {
          type: 'string',
          description: 'request 时必填，目标群友的准确 QQ 号'
        },
        reason: {
          type: 'string',
          description: 'request 时可填，踢人原因，最多 200 字'
        },
        reject_add_request: {
          type: 'boolean',
          description: 'request 时可填，是否同时禁止该成员再次申请入群，默认 false'
        },
        confirmation_id: {
          type: 'string',
          description: 'confirm/cancel 时必填，request 返回的 8 位确认码'
        }
      },
      required: ['action']
    }
  }

  async run (args, context) {
    return runGroupKick(args, context)
  }
}

export default new GroupKick()
