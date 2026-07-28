/** 记忆指令 — AI 群风格、QQ 级用户印象与身份账本 */
import { getConfig, PLUGIN_ROOT } from '../utils/state.js'
import {
  getGroupMemberMemoryState,
  getGroupLearningState,
  getGroupIdentity,
  getStats,
  listGroupMemberMemoryVersions,
  listGroupLearningVersions,
  rollbackGroupLearning
} from '../memory/store.js'
import { makeForwardMsg } from '../utils/bot.js'
import { buildGroupLearningPrompt, maybeReviewGroupLearning } from '../memory/group-learning.js'
import { maybeReviewGroupMemberMemory } from '../memory/member-memory.js'
import { resolveMemoryBaseDir } from '../memory/options.js'
import { recordGroupIdentity } from '../memory/identity.js'
import { resolveEventIdentity } from '../utils/identity.js'

function resolveBaseDir () {
  return resolveMemoryBaseDir(getConfig(), PLUGIN_ROOT)
}

export function splitForwardNodes (content, maxLength = 700) {
  const paragraphs = String(content || '').split(/\n{2,}/).map(part => part.trim()).filter(Boolean)
  const nodes = []
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxLength) {
      nodes.push(paragraph)
      continue
    }
    const lines = paragraph.split('\n')
    let current = ''
    for (const line of lines) {
      const next = current ? `${current}\n${line}` : line
      if (next.length <= maxLength) {
        current = next
        continue
      }
      if (current) nodes.push(current)
      current = ''
      for (let offset = 0; offset < line.length; offset += maxLength) {
        const slice = line.slice(offset, offset + maxLength)
        if (slice.length === maxLength) nodes.push(slice)
        else current = slice
      }
    }
    if (current) nodes.push(current)
  }
  return nodes.length ? nodes : ['暂无内容']
}

async function replyMemoryForward (e, title, content) {
  const forward = await makeForwardMsg(e, splitForwardNodes(content), title)
  return e.reply(forward)
}

export class loliMemory extends plugin {
  constructor () {
    super({
      name: 'loli-记忆',
      dsc: 'AI 群风格/用户印象/身份账本',
      event: 'message',
      priority: 600,
      rule: [
        { reg: '^#我的印象$', fnc: 'myMemory' },
        { reg: '^#我的记忆$', fnc: 'myMemory' },
        { reg: '^#用户印象\\s+\\d+$', fnc: 'memberMemory' },
        { reg: '^#群友记忆\\s+\\d+$', fnc: 'memberMemory' },
        { reg: '^#立即更新我的印象$', fnc: 'learnMyMemoryNow' },
        { reg: '^#立即更新我的记忆$', fnc: 'learnMyMemoryNow' },
        { reg: '^#记忆诊断$', fnc: 'memoryDiagnostics' },
        { reg: '^#群风格$', fnc: 'groupStyle' },
        { reg: '^#群学习状态$', fnc: 'groupLearningStatus' },
        { reg: '^#立即学习群风格$', fnc: 'learnGroupStyleNow' },
        { reg: '^#群风格回滚\\s+\\d+$', fnc: 'rollbackGroupStyle' },
        { reg: '^#我的身份$', fnc: 'myIdentity' },
        { reg: '^#身份查询\\s+\\d+$', fnc: 'queryIdentity' }
      ]
    })
  }

  async myMemory (e) {
    if (!e.isGroup) return e.reply('用户印象仅在群聊中按 QQ 维护。')
    const uid = String(e.user_id || e.sender?.user_id || '')
    return this.replyMemberMemory(e, String(e.group_id), uid, '你的用户印象')
  }

  async memberMemory (e) {
    if (!e.isMaster) return e.reply('只有主人可以查看其他群友的用户印象。')
    if (!e.isGroup) return e.reply('请发送在群聊中')
    const uid = String(e.msg || '').match(/(\d+)\s*$/)?.[1]
    return this.replyMemberMemory(e, String(e.group_id), uid, `群友 ${uid} 的用户印象`)
  }

  async replyMemberMemory (e, groupId, userId, title) {
    const state = getGroupMemberMemoryState(resolveBaseDir(), groupId, userId)
    if (state.version === 0 && state.styles.length === 0 && state.memories.length === 0) {
      return e.reply('📋 暂无用户印象；达到有效消息阈值后，AI 会自行审查并更新。')
    }
    const styles = state.styles.map(item => `- ${item.content}`).join('\n') || '- 暂无'
    const memories = state.memories.map(item => `- [${item.category || 'fact'}] ${item.content}`).join('\n') || '- 暂无'
    const versions = listGroupMemberMemoryVersions(resolveBaseDir(), groupId, userId, 5)
      .map(item => `v${item.version} · ${item.reason} · ${new Date(item.createdAt).toLocaleString('zh-CN')}`)
      .join('\n') || '暂无历史版本'
    return replyMemoryForward(
      e,
      title,
      `版本 v${state.version}｜状态 ${state.status}\n\n沟通偏好：\n${styles}\n\n长期用户印象：\n${memories}\n\n最近版本：\n${versions}`
    )
  }

  async memoryDiagnostics (e) {
    if (!e.isMaster) return e.reply('只有主人可以查看记忆诊断。')
    const stats = getStats(resolveBaseDir())
    const runs = stats.runs.length
      ? stats.runs.map(run => `${run.task}: ${run.status || 'never'}，成功 ${run.succeeded}，失败 ${run.failed}${run.error ? `，错误 ${run.error}` : ''}`).join('\n')
      : '调度任务尚无运行记录'
    return e.reply(`🧠 记忆诊断\n原始消息 ${stats.messages}｜身份 ${stats.identities}\n已学习群 ${stats.learnedGroups}｜群风格版本 ${stats.learningVersions}\n已学习群友 ${stats.learnedMembers}｜用户印象版本 ${stats.memberMemoryVersions}\n${runs}`)
  }

  async learnMyMemoryNow (e) {
    if (!e.isMaster) return e.reply('只有主人可以手动强制更新用户印象。')
    if (!e.isGroup) return e.reply('请发送在群聊中')
    const userId = String(e.user_id || e.sender?.user_id || '')
    await e.reply('正在审查你的近期原始消息，请稍候。')
    try {
      const result = await maybeReviewGroupMemberMemory({
        baseDir: resolveBaseDir(),
        groupId: String(e.group_id),
        userId,
        config: getConfig(),
        logger,
        force: true
      })
      if (!result) return e.reply('没有可用于更新的近期消息，或任务已在运行。')
      return e.reply(
        `用户印象审查完成：样本 ${result.samples}，当前 v${result.version}，` +
        `互动偏好 ${result.styles} 条，长期印象 ${result.memories} 条` +
        `${result.changed ? '（已更新）' : '（没有值得修改的内容）'}。`
      )
    } catch (err) {
      return e.reply(`用户印象更新失败：${String(err?.message || err).slice(0, 300)}`)
    }
  }

  async groupStyle (e) {
    if (!e.isGroup) return e.reply('请发送在群聊中')
    const content = buildGroupLearningPrompt({
      baseDir: resolveBaseDir(),
      groupId: String(e.group_id),
      config: getConfig()
    })
    if (!content) return e.reply('🎭 本群尚未形成稳定的自学习风格。')
    return replyMemoryForward(e, '本群自学习风格', content)
  }

  async groupLearningStatus (e) {
    if (!e.isGroup) return e.reply('请发送在群聊中')
    const groupId = String(e.group_id)
    const state = getGroupLearningState(resolveBaseDir(), groupId)
    const versions = listGroupLearningVersions(resolveBaseDir(), groupId, 5)
      .map(item => `v${item.version} · ${item.reason} · ${new Date(item.createdAt).toLocaleString('zh-CN')}`)
      .join('\n') || '暂无历史版本'
    return e.reply(`🧠 群风格状态\n版本 v${state.version}｜状态 ${state.status}\n群风格 ${state.profile.length} 条\n上次审查 ${state.lastReviewAt ? new Date(state.lastReviewAt).toLocaleString('zh-CN') : '尚未执行'}${state.error ? `\n错误：${state.error}` : ''}\n\n最近版本：\n${versions}`)
  }

  async learnGroupStyleNow (e) {
    if (!e.isMaster) return e.reply('只有主人可以手动执行群风格学习。')
    if (!e.isGroup) return e.reply('请发送在群聊中')
    await e.reply('正在后台审查本群新增消息，请稍候。')
    try {
      const result = await maybeReviewGroupLearning({
        baseDir: resolveBaseDir(),
        groupId: String(e.group_id),
        config: getConfig(),
        logger,
        force: true
      })
      if (!result) return e.reply('没有可用于学习的新增群消息，或任务已在运行。')
      return e.reply(`群风格审查完成：样本 ${result.samples}，成员 ${result.activeUsers}，当前 v${result.version}${result.changed ? '（设定已更新）' : '（没有稳定的新结论）'}。`)
    } catch (err) {
      return e.reply(`群风格学习失败：${String(err?.message || err).slice(0, 300)}`)
    }
  }

  async rollbackGroupStyle (e) {
    if (!e.isMaster) return e.reply('只有主人可以回滚群风格。')
    if (!e.isGroup) return e.reply('请发送在群聊中')
    const version = Number(String(e.msg || '').match(/(\d+)\s*$/)?.[1])
    const result = rollbackGroupLearning(resolveBaseDir(), String(e.group_id), version)
    if (!result) return e.reply(`未找到本群风格版本 v${version}。`)
    return e.reply(`已恢复 v${version} 的群风格内容，并保存为新版本 v${result.version}。`)
  }

  async myIdentity (e) {
    if (!e.isGroup) return e.reply('请发送在群聊中')
    const identity = resolveEventIdentity(e, getConfig())
    const stored = recordGroupIdentity({
      baseDir: resolveBaseDir(), groupId: String(e.group_id), identity, observedAt: Date.now()
    })
    return e.reply(formatStoredIdentity(stored))
  }

  async queryIdentity (e) {
    if (!e.isMaster) return e.reply('只有主人可以查询其他群友的身份账本。')
    if (!e.isGroup) return e.reply('请发送在群聊中')
    const userId = String(e.msg || '').match(/(\d+)\s*$/)?.[1] || ''
    const stored = getGroupIdentity(resolveBaseDir(), String(e.group_id), userId)
    if (!stored) return e.reply(`本群尚未记录 QQ:${userId} 的可信身份。`)
    return e.reply(formatStoredIdentity(stored))
  }
}

function formatStoredIdentity (identity) {
  if (!identity) return '尚未记录当前身份。'
  const aliases = identity.aliases?.map(item => item.name).filter(Boolean).slice(0, 10).join('、') || '暂无'
  return `🪪 平台身份账本\nQQ：${identity.userId}\n当前显示名：${identity.displayName || '-'}\n群名片：${identity.card || '-'}\nQQ昵称：${identity.nickname || '-'}\n群角色：${identity.senderRole || 'member'}\n主人标记：${identity.isMaster ? '是' : '否'}\n可信历史名称：${aliases}\n首次记录：${new Date(identity.firstSeenAt).toLocaleString('zh-CN')}\n最近记录：${new Date(identity.lastSeenAt).toLocaleString('zh-CN')}\n\n名称和聊天自述不能改变 QQ 身份。`
}
