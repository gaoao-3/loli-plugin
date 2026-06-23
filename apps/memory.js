/**
 * 记忆指令 — #群记忆 / #群画像 / #我的记忆 / #我的画像
 * 纯 .md 读取，无 SQLite
 */
import fs from 'fs'
import path from 'path'
import { getConfig, PLUGIN_ROOT } from '../index.js'

function resolveBaseDir () {
  const cfg = getConfig()?.memory?.dailyMd?.dataDir || 'data/memory/md'
  return path.resolve(PLUGIN_ROOT, cfg)
}

function getToday () {
  const d = new Date()
  d.setHours(d.getHours() + 8)
  return d.toISOString().slice(0, 10)
}

function readMd (filePath) {
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf8').replace(/\[hash:.*?\]/, '').trim()
}

export const memory = {
  rule: [
    { reg: '^#群记忆$', fnc: 'groupMemory' },
    { reg: '^#群画像$', fnc: 'groupImpression' },
    { reg: '^#我的记忆$', fnc: 'myMemory' },
    { reg: '^#我的画像$', fnc: 'myImpression' }
  ],

  async groupMemory (e) {
    if (!e.isGroup) return e.reply('请发送在群聊中')
    const base = path.join(resolveBaseDir(), 'refined')
    const file = path.join(base, 'groups', String(e.group_id), getToday() + '.md')
    const content = readMd(file)
    if (!content) return e.reply('\uD83D\uDCCB 本群今日暂无精炼记忆。\n（精炼每小时自动执行一次）')
    e.reply(`\uD83D\uDCCB 本群今日记忆精炼：\n\n${content.slice(0, 2000)}`)
  },

  async groupImpression (e) {
    if (!e.isGroup) return e.reply('请发送在群聊中')
    const base = path.join(resolveBaseDir(), 'refined')
    const file = path.join(base, 'groups', String(e.group_id), 'impressions.md')
    const content = readMd(file)
    if (!content) return e.reply('\uD83D\uDCCB 本群暂无画像记录。\n（画像每天自动精炼一次）')
    e.reply(`\uD83C\uDFAD 本群画像：\n\n${content.slice(0, 2000)}`)
  },

  async myMemory (e) {
    const uid = String(e.user_id || e.sender?.user_id || '')
    const base = path.join(resolveBaseDir(), 'refined')
    const file = path.join(base, 'users', uid, getToday() + '.md')
    const content = readMd(file)
    if (!content) return e.reply('\uD83D\uDCCB 今日暂无你的记忆。\n（精炼每小时自动执行一次）')
    e.reply(`\uD83D\uDCCB 你今日的记忆精炼：\n\n${content.slice(0, 2000)}`)
  },

  async myImpression (e) {
    const uid = String(e.user_id || e.sender?.user_id || '')
    const base = path.join(resolveBaseDir(), 'refined')
    const file = path.join(base, 'users', uid, 'impressions.md')
    const content = readMd(file)
    if (!content) return e.reply('\uD83D\uDCCB 暂无你的画像记录。\n（画像每天自动精炼一次）')
    e.reply(`\uD83C\uDFAD 你的画像：\n\n${content.slice(0, 2000)}`)
  }
}
