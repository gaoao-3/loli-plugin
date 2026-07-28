import { CustomTool } from '../../core/index.js'
import { getConfig } from '../state.js'
import { getGroupHistory } from '../group.js'
import { collectEventMessageRefs, collectHistoryMessageRefs } from '../group-message.js'
import { recordGroupMemberViolation } from '../group-audit.js'
import { getViolationPolicy } from '../group-moderation.js'
import { authorizeGroupAction } from '../group-management.js'
import { executeGroupRecall, runAuditedGroupAction } from '../group-actions.js'

async function locateMessage (event, messageId, historyProvider) {
  const eventRefs = await collectEventMessageRefs(event)
  const current = eventRefs.find(ref => ref.messageId === messageId || ref.seq === messageId)
  if (current) return current
  const history = await collectHistoryMessageRefs(event, {
    message_id: messageId,
    history_limit: 100
  }, { historyProvider })
  return history.find(ref => ref.messageId === messageId || ref.seq === messageId) || null
}

export async function runGroupRecall (args, context, {
  dbFile,
  execute = executeGroupRecall,
  historyProvider = getGroupHistory,
  config = getConfig()
} = {}) {
  const event = context?.event
  const messageId = String(args?.message_id || '').trim()
  const violationReason = String(args?.violation_reason || '').trim().slice(0, 200)
  const severityPolicy = getViolationPolicy(args?.severity)
  if (!event) return JSON.stringify({ ok: false, reason: 'event_required', error: '无法获取当前 QQ 事件' })
  if (!messageId) return JSON.stringify({ ok: false, reason: 'invalid_message_id', error: 'message_id 不能为空' })

  const message = await locateMessage(event, messageId, historyProvider)
  if (!message) {
    return JSON.stringify({ ok: false, reason: 'message_not_found', error: '最近 100 条群消息中没有找到该消息 ID' })
  }
  const authorization = await authorizeGroupAction({
    event,
    action: 'recall',
    targetUserId: message.sender.id,
    targetMessageId: messageId,
    allowBotAutonomy: true,
    autonomySeverity: severityPolicy?.severity,
    config
  })
  const result = await runAuditedGroupAction({
    authorization,
    action: 'recall',
    targetUserId: message.sender.id,
    targetMessageId: messageId,
    metadata: {
      source: message.source,
      violationReason,
      severity: severityPolicy?.severity,
      violationPoints: severityPolicy?.points,
      incidentKey: messageId
    },
    dbFile,
    execute: () => execute(event, messageId)
  })
  if (result.ok && authorization.authority === 'bot_autonomy') {
    recordGroupMemberViolation({
      incidentKey: `${authorization.groupId}:${message.sender.id}:${messageId}`,
      groupId: authorization.groupId,
      targetUserId: message.sender.id,
      action: 'recall',
      severity: severityPolicy.severity,
      points: severityPolicy.points,
      reason: violationReason,
      auditCorrelationId: result.auditId,
      dbFile
    })
  }
  return JSON.stringify({
    ...result,
    messageId,
    targetUserId: message.sender.id,
    severity: severityPolicy?.severity,
    violationPoints: authorization.authority === 'bot_autonomy' ? severityPolicy?.points : undefined,
    message: result.ok ? `已撤回消息 ${messageId}` : undefined
  })
}

class GroupRecall extends CustomTool {
  name = 'group_recall'

  function = {
    name: 'group_recall',
    description: '按群聊时间轴中的准确消息 ID 撤回当前群消息。主人、群主和管理员可正常使用；机器人可自主撤回当前触发消息发送者本人的违规消息，但不得借普通成员请求撤回第三人的消息。会先精确定位发送者并检查权限，找不到时不会猜测。',
    parameters: {
      type: 'object',
      properties: {
        message_id: {
          type: 'string',
          description: '群聊上下文或时间轴中标注的准确消息 ID/seq'
        },
        violation_reason: {
          type: 'string',
          description: '机器人自主撤回时填写当前可见违规行为的简短原因；不得编造'
        },
        severity: {
          type: 'string',
          enum: ['minor', 'moderate', 'severe', 'critical'],
          description: '机器人自主处罚时必填：minor轻微、moderate中等、severe严重、critical重大'
        }
      },
      required: ['message_id']
    }
  }

  async run (args, context) {
    return runGroupRecall(args, context)
  }
}

export default new GroupRecall()
