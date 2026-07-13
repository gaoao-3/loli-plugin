/**
 * 记忆指令 — #群记忆 / #群画像 / #我的记忆 / #我的画像
 */
import path from 'path'
import { getConfig, PLUGIN_ROOT } from '../utils/state.js'
import { getProfile, getStats, getSummary, today } from '../memory/store.js'
import { runRefinement } from '../memory/scheduler.js'

function resolveBaseDir () {
  const cfg = getConfig()?.memory?.dailyMd?.dataDir || 'data/memory/md'
  return path.isAbsolute(cfg) ? cfg : path.resolve(PLUGIN_ROOT, cfg)
}

function readSummary (scope, targetId) {
  return getSummary(resolveBaseDir(), scope, targetId, today())?.summary || ''
}

function readProfile (scope, targetId) {
  return getProfile(resolveBaseDir(), scope, targetId)?.profile || ''
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
        { reg: '^#立即摘要$', fnc: 'refineNow' }
      ]
    })
  }

  async groupMemory (e) {
    if (!e.isGroup) return e.reply('请发送在群聊中')
    const content = readSummary('group', String(e.group_id))
    if (!content) return e.reply('📋 本群今日暂无记忆摘要。\n（摘要每小时自动执行一次）')
    e.reply(`📋 本群今日记忆摘要：\n\n${content.slice(0, 2000)}`)
  }

  async groupImpression (e) {
    if (!e.isGroup) return e.reply('请发送在群聊中')
    const content = readProfile('group', String(e.group_id))
    if (!content) return e.reply('📋 本群暂无画像记录。\n（画像每天自动生成一次）')
    e.reply(`🎭 本群画像：\n\n${content.slice(0, 2000)}`)
  }

  async myMemory (e) {
    const uid = String(e.user_id || e.sender?.user_id || '')
    const scope = e.isGroup ? 'group_user' : 'private_user'
    const targetId = e.isGroup ? `${e.group_id}:${uid}` : uid
    const content = readSummary(scope, targetId)
    if (!content) return e.reply('📋 今日暂无你的记忆摘要。\n（摘要每小时自动执行一次）')
    e.reply(`📋 你今日的记忆摘要：\n\n${content.slice(0, 2000)}`)
  }

  async myImpression (e) {
    const uid = String(e.user_id || e.sender?.user_id || '')
    const scope = e.isGroup ? 'group_user' : 'private_user'
    const targetId = e.isGroup ? `${e.group_id}:${uid}` : uid
    const content = readProfile(scope, targetId)
    if (!content) return e.reply('📋 暂无你的画像记录。\n（画像每天自动生成一次）')
    e.reply(`🎭 你的画像：\n\n${content.slice(0, 2000)}`)
  }

  async memoryDiagnostics (e) {
    if (!e.isMaster) return e.reply('只有主人可以查看记忆诊断。')
    const stats = getStats(resolveBaseDir())
    const runs = stats.runs.length
      ? stats.runs.map(run => `${run.task}: ${run.status || 'never'}，成功 ${run.succeeded}，失败 ${run.failed}${run.error ? `，错误 ${run.error}` : ''}`).join('\n')
      : '调度任务尚无运行记录'
    return e.reply(`🧠 记忆诊断\n消息 ${stats.messages}｜摘要 ${stats.summaries}｜画像 ${stats.profiles}\n记忆块 ${stats.chunks}｜向量 ${stats.embeddings}\n${runs}`)
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
}
