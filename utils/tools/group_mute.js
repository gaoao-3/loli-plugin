import { CustomTool } from '../../core/index.js'
import { getConfig } from '../state.js'
import { getGroupId } from '../bot.js'
import { recordGroupMemberViolation } from '../group-audit.js'
import { getViolationPolicy } from '../group-moderation.js'
import { authorizeGroupAction } from '../group-management.js'
import { executeGroupMute, runAuditedGroupAction } from '../group-actions.js'

export async function runGroupMute (args, context, {
  dbFile,
  execute = executeGroupMute,
  config = getConfig()
} = {}) {
  const event = context?.event
  const targetUserId = String(args?.target_user_id || '').trim()
  const requestedDurationSeconds = Math.max(0, Math.min(2592000, Math.floor(Number(args?.duration_seconds) || 0)))
  let durationSeconds = requestedDurationSeconds
  const violationReason = String(args?.violation_reason || '').trim().slice(0, 200)
  const severityPolicy = getViolationPolicy(args?.severity)
  const evidenceMessageId = String(event?.message_id || event?.messageId || event?.seq || '').trim()
  if (!event) return JSON.stringify({ ok: false, reason: 'event_required', error: '无法获取当前 QQ 事件' })
  if (!/^\d{5,20}$/u.test(targetUserId)) {
    return JSON.stringify({ ok: false, reason: 'invalid_target', error: 'target_user_id 必须是 QQ 号' })
  }

  let authorization = await authorizeGroupAction({
    event,
    action: durationSeconds === 0 ? 'unmute' : 'mute',
    targetUserId,
    targetMessageId: evidenceMessageId,
    allowBotAutonomy: durationSeconds > 0,
    autonomySeverity: severityPolicy?.severity,
    config
  })
  if (authorization.authority === 'bot_autonomy' && severityPolicy) {
    if (severityPolicy.maxMuteSeconds <= 0) {
      authorization = {
        ...authorization,
        allowed: false,
        reason: 'severity_action_not_allowed'
      }
    } else {
      durationSeconds = Math.min(durationSeconds, severityPolicy.maxMuteSeconds)
    }
  }
  const result = await runAuditedGroupAction({
    authorization,
    action: durationSeconds === 0 ? 'unmute' : 'mute',
    targetUserId,
    metadata: {
      durationSeconds,
      violationReason,
      severity: severityPolicy?.severity,
      violationPoints: severityPolicy?.points,
      incidentKey: evidenceMessageId
    },
    dbFile,
    execute: () => execute(event, targetUserId, durationSeconds)
  })
  if (result.ok && authorization.authority === 'bot_autonomy') {
    recordGroupMemberViolation({
      incidentKey: `${authorization.groupId}:${targetUserId}:${evidenceMessageId}`,
      groupId: getGroupId(event),
      targetUserId,
      action: 'mute',
      severity: severityPolicy.severity,
      points: severityPolicy.points,
      reason: violationReason,
      auditCorrelationId: result.auditId,
      dbFile
    })
  }
  return JSON.stringify({
    ...result,
    targetUserId,
    durationSeconds,
    requestedDurationSeconds,
    severity: severityPolicy?.severity,
    violationPoints: authorization.authority === 'bot_autonomy' ? severityPolicy?.points : undefined,
    message: result.ok
      ? (durationSeconds === 0 ? `已解除 QQ ${targetUserId} 的禁言` : `已禁言 QQ ${targetUserId} ${durationSeconds} 秒`)
      : undefined
  })
}

class GroupMute extends CustomTool {
  name = 'group_mute'

  function = {
    name: 'group_mute',
    description: '在当前群禁言或解除禁言指定 QQ。主人、群主和管理员可正常使用。机器人自治只能针对当前违规消息发送者，并必须选择严重度：minor 轻微只允许撤回、不可禁言；moderate 中等最多禁言10分钟；severe 严重最多1小时；critical 重大最多1天。超出上限会自动缩短。duration_seconds=0 为解除禁言，不属于自治权限。',
    parameters: {
      type: 'object',
      properties: {
        target_user_id: {
          type: 'string',
          description: '目标群友的准确 QQ 号；不得用昵称代替'
        },
        duration_seconds: {
          type: 'integer',
          minimum: 0,
          maximum: 2592000,
          description: '禁言秒数，0 为解除禁言，最大 30 天'
        },
        violation_reason: {
          type: 'string',
          description: '机器人自主禁言时填写当前可见违规行为的简短原因；不得编造'
        },
        severity: {
          type: 'string',
          enum: ['minor', 'moderate', 'severe', 'critical'],
          description: '机器人自主处罚时必填：minor轻微、moderate中等、severe严重、critical重大'
        }
      },
      required: ['target_user_id', 'duration_seconds']
    }
  }

  async run (args, context) {
    return runGroupMute(args, context)
  }
}

export default new GroupMute()
