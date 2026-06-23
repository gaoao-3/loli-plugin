/**
 * 记忆检索器 — 纯 .md 文件检索
 * 无 SQLite、无向量，纯文件系统 grep
 */
import fs from 'fs'
import path from 'path'

/**
 * 检索相关记忆
 * @param {Object} opts
 * @param {string} opts.baseDir - memory 根目录
 * @param {string} [opts.groupId]
 * @param {string} [opts.userId]
 * @param {string} [opts.queryText]
 * @returns {{ groupImpression?: string, userImpression?: string, todayGroup?: string, todayUser?: string }}
 */
export function retrieveMemories ({ baseDir, groupId, userId, queryText = '' }) {
  const refined = path.join(baseDir, 'refined')
  const result = {}

  if (groupId) {
    // 群画像
    const imp = path.join(refined, 'groups', groupId, 'impressions.md')
    if (fs.existsSync(imp)) {
      result.groupImpression = fs.readFileSync(imp, 'utf8').replace(/\[hash:.*?\]/, '').trim()
    }
    // 今日精炼
    const today = path.join(refined, 'groups', groupId, getToday() + '.md')
    if (fs.existsSync(today)) {
      result.todayGroup = fs.readFileSync(today, 'utf8').replace(/\[hash:.*?\]/, '').trim()
    }
  }

  if (userId) {
    // 用户画像
    const imp = path.join(refined, 'users', userId, 'impressions.md')
    if (fs.existsSync(imp)) {
      result.userImpression = fs.readFileSync(imp, 'utf8').replace(/\[hash:.*?\]/, '').trim()
    }
    // 今日精炼
    const today = path.join(refined, 'users', userId, getToday() + '.md')
    if (fs.existsSync(today)) {
      result.todayUser = fs.readFileSync(today, 'utf8').replace(/\[hash:.*?\]/, '').trim()
    }
  }

  return result
}

function getToday () {
  const d = new Date()
  d.setHours(d.getHours() + 8)
  return d.toISOString().slice(0, 10)
}
