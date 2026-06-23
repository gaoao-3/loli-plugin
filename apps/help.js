/**
 * 帮助指令 — #loli帮助
 */
import { getConfig } from '../index.js'

export const help = {
  rule: [
    { reg: '^#loli帮助$', fnc: 'showHelp' },
    { reg: '^#loli状态$', fnc: 'showStatus' }
  ],

  async showHelp (e) {
    const cfg = getConfig()
    const v = cfg?.version || '0.1.0'
    const loli = cfg?.loli || {}

    const lines = [
      `\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`,
      `\u2502  \u2728 日奈 Loli Plugin v${v}`,
      `\u2502  lolicon-core \u00B7 LMDB \u00B7 Pure .md Memory`,
      `\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`,
      ``,
      `\uD83E\uDD16 伪人模式`,
      `  \u2022 @触发 — @机器人即可对话`,
      `  \u2022 前缀触发 — ${loli.triggerPrefix?.join(', ') || '#ai'}`,
      `  \u2022 关键词触发 — ${loli.triggerKeywords?.join(', ') || '(未设置)'}`,
      `  \u2022 主动触发 — 概率 ${loli.promptProbability || 0}`,
      `  \u2022 [at:\u6635\u79F0] — AI \u53EF @\u7FA4\u53CB`,
      ``,
      `\uD83E\uDDE0 记忆系统`,
      `  \u2022 #群记忆 / #群画像`,
      `  \u2022 #我的记忆 / #我的画像`,
      `  \u2022 每小时自动精炼 \u00B7 纯 .md \u5B58\u50A8`,
      ``,
      `\uD83D\uDD27 管理`,
      `  \u2022 #loli状态 — 运行状态`,
      `  \u2022 #loli更新 — 更新插件`,
      ``,
      `\uD83C\uDF10 工具`,
      `  \u2022 AI 可自主调用搜索/音乐/天气等工具`,
      ``,
      `\u00A9 姐布林与她的日奈小助手`
    ]

    e.reply(lines.join('\n'))
  },

  async showStatus (e) {
    const cfg = getConfig()
    const loli = cfg?.loli || {}
    const memory = cfg?.memory || {}

    const lines = [
      `\u2728 日奈状态`,
      `版本: v${cfg?.version || '0.1.0'}`,
      `伪人模式: ${loli.enable ? '\u2705 开启' : '\u274C 关闭'}`,
      `群组记忆: ${memory.group?.enable ? '\u2705 开启' : '\u274C 关闭'}`,
      `用户记忆: ${memory.user?.enable ? '\u2705 开启' : '\u274C 关闭'}`,
      `精炼周期: 每小时 \u00B7 画像: 每天`,
      `存储: LMDB + .md`,
      `引擎: lolicon-core v0.1.0`
    ]

    e.reply(lines.join('\n'))
  }
}
