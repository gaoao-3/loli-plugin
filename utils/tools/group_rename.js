import { CustomTool } from '../../core/index.js'
import { getConfig } from '../state.js'
import { authorizeGroupAction } from '../group-management.js'
import {
  executeGroupSetCard,
  executeGroupSetName,
  runAuditedGroupAction
} from '../group-actions.js'

export async function runGroupRename (args, context, {
  dbFile,
  executeCard = executeGroupSetCard,
  executeName = executeGroupSetName,
  config = getConfig()
} = {}) {
  const event = context?.event
  const scope = String(args?.scope || '').trim()
  const name = String(args?.name ?? '').trim()
  const targetUserId = String(args?.target_user_id || '').trim()
  const evidenceMessageId = String(event?.message_id || event?.messageId || event?.seq || '').trim()
  if (!event) return JSON.stringify({ ok: false, reason: 'event_required', error: '无法获取当前 QQ 事件' })
  if (!['member_card', 'group_name'].includes(scope)) {
    return JSON.stringify({ ok: false, reason: 'invalid_scope', error: 'scope 只能是 member_card 或 group_name' })
  }
  if (!name) return JSON.stringify({ ok: false, reason: 'name_required', error: '新名称不能为空' })
  if (name.length > 60) return JSON.stringify({ ok: false, reason: 'name_too_long', error: '新名称不能超过 60 个字符' })
  if (scope === 'member_card' && !/^\d{5,20}$/u.test(targetUserId)) {
    return JSON.stringify({ ok: false, reason: 'invalid_target', error: '修改群名片必须提供准确 QQ 号' })
  }

  const action = scope === 'member_card' ? 'set_card' : 'set_group_name'
  const authorization = await authorizeGroupAction({
    event,
    action,
    targetUserId: scope === 'member_card' ? targetUserId : '',
    targetMessageId: scope === 'member_card' ? evidenceMessageId : '',
    allowBotAutonomy: scope === 'member_card',
    config
  })
  const result = await runAuditedGroupAction({
    authorization,
    action,
    targetUserId: scope === 'member_card' ? targetUserId : '',
    metadata: { scope, nameLength: name.length, incidentKey: evidenceMessageId },
    dbFile,
    execute: () => scope === 'member_card'
      ? executeCard(event, targetUserId, name)
      : executeName(event, name)
  })
  return JSON.stringify({
    ...result,
    scope,
    targetUserId: scope === 'member_card' ? targetUserId : undefined,
    name,
    authority: authorization.authority,
    message: result.ok
      ? (scope === 'member_card'
          ? `已将 QQ ${targetUserId} 的群名片修改为“${name}”`
          : `已将群名称修改为“${name}”`)
      : undefined
  })
}

class GroupRename extends CustomTool {
  name = 'group_rename'

  function = {
    name: 'group_rename',
    description: '修改当前群的成员名片或群名称。member_card：主人、群主、管理员可正常操作；机器人可自主修改当前触发消息发送者本人的群名片，但不能接受普通群友请求修改第三人，也不能修改主人、群主或管理员。group_name 仅机器人主人或当前群群主可操作。',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['member_card', 'group_name'],
          description: 'member_card 修改成员群名片；group_name 修改当前群名称'
        },
        target_user_id: {
          type: 'string',
          description: 'member_card 时必填，目标成员的准确 QQ 号'
        },
        name: {
          type: 'string',
          description: '新的群名片或群名称，最多 60 个字符'
        }
      },
      required: ['scope', 'name']
    }
  }

  async run (args, context) {
    return runGroupRename(args, context)
  }
}

export default new GroupRename()
