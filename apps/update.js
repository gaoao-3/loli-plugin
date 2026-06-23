/**
 * 更新指令 — #loli更新 / #loli强制更新
 */
import { execSync } from 'node:child_process'

export const update = {
  rule: [
    { reg: '^#loli更新$', fnc: 'doUpdate' },
    { reg: '^#loli强制更新$', fnc: 'doForceUpdate' }
  ],

  async doUpdate (e) {
    await e.reply('\uD83D\uDD04 正在更新 loli-plugin...')
    try {
      const out = await _exec('git -c user.name=loli -c user.email=loli@bot -C ./plugins/loli-plugin/ pull --no-rebase')
      await e.reply(`\u2705 更新完成:\n${out.slice(-500)}`)
    } catch (err) {
      await e.reply(`\u274C 更新失败: ${err.message?.slice(0, 300)}`)
    }
  },

  async doForceUpdate (e) {
    await e.reply('\uD83D\uDD04 正在强制更新 loli-plugin...')
    try {
      const out = await _exec(
        'git -c user.name=loli -c user.email=loli@bot -C ./plugins/loli-plugin/ checkout . && ' +
        'git -c user.name=loli -c user.email=loli@bot -C ./plugins/loli-plugin/ clean -fd && ' +
        'git -c user.name=loli -c user.email=loli@bot -C ./plugins/loli-plugin/ pull --no-rebase'
      )
      await e.reply(`\u2705 强制更新完成:\n${out.slice(-500)}`)
    } catch (err) {
      await e.reply(`\u274C 更新失败: ${err.message?.slice(0, 300)}`)
    }
  }
}

function _exec (cmd) {
  return new Promise((resolve, reject) => {
    try {
      const out = execSync(cmd, { encoding: 'utf8', timeout: 60000 })
      resolve(out)
    } catch (e) {
      reject(new Error(e.stderr || e.message || '未知错误'))
    }
  })
}
