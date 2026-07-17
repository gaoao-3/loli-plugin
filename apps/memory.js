/**
 * 记忆指令 — #群记忆 / #群画像 / #我的记忆 / #我的画像
 */
import { getConfig, PLUGIN_ROOT } from '../utils/state.js'
import {
  getGroupLearningState,
  getGroupIdentity,
  getProfile,
  getStats,
  getSummary,
  listGroupLearningVersions,
  rollbackGroupLearning,
  today
} from '../memory/store.js'
import { runRefinement } from '../memory/scheduler.js'
import { makeForwardMsg } from '../utils/bot.js'
import { buildGroupLearningPrompt, maybeReviewGroupLearning } from '../memory/group-learning.js'
import { resolveMemoryBaseDir } from '../memory/options.js'
import { recordGroupIdentity } from '../memory/identity.js'
import { resolveEventIdentity } from '../utils/identity.js'

function resolveBaseDir () {
  return resolveMemoryBaseDir(getConfig(), PLUGIN_ROOT)
}

function readSummary (scope, targetId) {
  return getSummary(resolveBaseDir(), scope, targetId, today())?.summary || ''
}

function readProfile (scope, targetId) {
  return getProfile(resolveBaseDir(), scope, targetId)?.profile || ''
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
      dsc: '群记忆/群画像/我的记忆/我的画像',
      event: 'message',
      priority: 600,
      rule: [
        { reg: '^#群记忆$', fnc: 'groupMemory' },
        { reg: '^#群画像$', fnc: 'groupImpression' },
        { reg: '^#我的记忆$', fnc: 'myMemory' },
        { reg: '^#我的画像$', fnc: 'myImpression' },
        { reg: '^#记忆诊断$', fnc: 'memoryDiagnostics' },
        { reg: '^#立即摘要$', fnc: 'refineNow' },
        { reg: '^#群风格$', fnc: 'groupStyle' },
        { reg: '^#群学习状态$', fnc: 'groupLearningStatus' },
        { reg: '^#立即学习群风格$', fnc: 'learnGroupStyleNow' },
        { reg: '^#群风格回滚\\s+\\d+$', fnc: 'rollbackGroupStyle' },
        { reg: '^#我的身份$', fnc: 'myIdentity' },
        { reg: '^#身份查询\\s+\\d+$', fnc: 'queryIdentity' }
      ]
    })
  }

  async groupMemory (e) {
    if (!e.isGroup) return e.reply('请发送在群聊中')
    const content = readSummary('group', String(e.group_id))
    if (!content) return e.reply('📋 本群今日暂无记忆摘要。\n（摘要每小时自动执行一次）')
    return replyMemoryForward(e, '本群今日记忆摘要', content)
  }

  async groupImpression (e) {
    if (!e.isGroup) return e.reply('请发送在群聊中')
    const content = readProfile('group', String(e.group_id))
    if (!content) return e.reply('📋 本群暂无画像记录。\n（画像每天自动生成一次）')
    return replyMemoryForward(e, '本群长期画像', content)
  }

  async myMemory (e) {
    const uid = String(e.user_id || e.sender?.user_id || '')
    const scope = e.isGroup ? 'group_user' : 'private_user'
    const targetId = e.isGroup ? `${e.group_id}:${uid}` : uid
    const content = readSummary(scope, targetId)
    if (!content) return e.reply('📋 今日暂无你的记忆摘要。\n（摘要每小时自动执行一次）')
    return replyMemoryForward(e, '你的今日记忆摘要', content)
  }

  async myImpression (e) {
    const uid = String(e.user_id || e.sender?.user_id || '')
    const scope = e.isGroup ? 'group_user' : 'private_user'
    const targetId = e.isGroup ? `${e.group_id}:${uid}` : uid
    const content = readProfile(scope, targetId)
    if (!content) return e.reply('📋 暂无你的画像记录。\n（画像每天自动生成一次）')
    return replyMemoryForward(e, '你的长期画像', content)
  }

  async memoryDiagnostics (e) {
    if (!e.isMaster) return e.reply('只有主人可以查看记忆诊断。')
    const stats = getStats(resolveBaseDir())
    const runs = stats.runs.length
      ? stats.runs.map(run => `${run.task}: ${run.status || 'never'}，成功 ${run.succeeded}，失败 ${run.failed}${run.error ? `，错误 ${run.error}` : ''}`).join('\n')
      : '调度任务尚无运行记录'
    return e.reply(`🧠 记忆诊断\n消息 ${stats.messages}｜摘要 ${stats.summaries}｜画像 ${stats.profiles}\n身份 ${stats.identities}｜记忆块 ${stats.chunks}｜向量 ${stats.embeddings}\n已学习群 ${stats.learnedGroups}｜群风格版本 ${stats.learningVersions}\n${runs}`)
  }

  async refineNow (e) {
    if (!e.isMaster) return e.reply('只有主人可以手动执行摘要。')
    await e.reply('正在处理待摘要记忆，请稍候。')
    try {
      const stats = await runRefinement(resolveBaseDir(), logger)
      if (!stats) return e.reply('摘要任务已在运行，本次跳过。')
      return e.reply(`摘要处理完成：处理 ${stats.processed}，成功 ${stats.succeeded}，失败 ${stats.failed}。`)
    } catch (err) {
      return e.reply(`摘要任务失败：${String(err?.message || err).slice(0, 300)}`)
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
    return e.reply(`🧠 群学习状态\n版本 v${state.version}｜状态 ${state.status}\n客观群文化 ${state.profile.length} 条｜角色主观记忆 ${state.memory.length} 条\n上次审查 ${state.lastReviewAt ? new Date(state.lastReviewAt).toLocaleString('zh-CN') : '尚未执行'}${state.error ? `\n错误：${state.error}` : ''}\n\n最近版本：\n${versions}`)
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
