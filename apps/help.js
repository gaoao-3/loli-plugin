/**
 * 帮助指令 — #loli帮助
 */
import { getConfig } from '../utils/state.js'

export class loliHelp extends plugin {
  constructor () {
    super({
      name: 'loli-帮助',
      dsc: 'loli帮助指令',
      event: 'message',
      priority: 600,
      rule: [
        { reg: '^#loli帮助$', fnc: 'showHelp' },
        { reg: '^#loli状态$', fnc: 'showStatus' }
      ]
    })
  }

  async showHelp (e) {
    const cfg = getConfig()
    const v = cfg?.version || '0.1.0'
    const loli = cfg?.loli || {}

    const lines = [
      `┌────────────────────`,
      `│  ✨ 日奈 Loli Plugin v${v}`,
      `│  lolicon-core · LMDB · Pure .md Memory`,
      `└────────────────────`,
      ``,
      `🤖 伪人模式`,
      `  • @触发 — @机器人即可对话`,
      `  • 前缀触发 — ${loli.triggerPrefix?.join(', ') || '#ai'}`,
      `  • 关键词触发 — ${loli.triggerKeywords?.join(', ') || '(未设置)'}`,
      `  • 主动触发 — 概率 ${loli.promptProbability || 0}`,
      `  • [at:昵称] — AI 可 @群友`,
      ``,
      `🧠 记忆系统`,
      `  • #群记忆 / #群画像`,
      `  • #我的记忆 / #我的画像`,
      `  • 每小时自动精炼 · 纯 .md 存储`,
      ``,
      `🔧 管理`,
      `  • #loli状态 — 运行状态`,
      `  • #loli更新 — 更新插件`,
      ``,
      `🌐 工具`,
      `  • AI 可自主调用搜索/音乐/天气等工具`,
      ``,
      `© 姐布林与她的日奈小助手`
    ]

    e.reply(lines.join('\n'))
  }

  async showStatus (e) {
    const cfg = getConfig()
    const loli = cfg?.loli || {}
    const memory = cfg?.memory || {}

    const lines = [
      `✨ 日奈状态`,
      `版本: v${cfg?.version || '0.1.0'}`,
      `伪人模式: ${loli.enable ? '✅ 开启' : '❌ 关闭'}`,
      `群组记忆: ${memory.group?.enable ? '✅ 开启' : '❌ 关闭'}`,
      `用户记忆: ${memory.user?.enable ? '✅ 开启' : '❌ 关闭'}`,
      `精炼周期: 每小时 · 画像: 每天`,
      `存储: LMDB + .md`,
      `引擎: lolicon-core v0.1.0`
    ]

    e.reply(lines.join('\n'))
  }
}
