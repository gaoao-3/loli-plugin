/**
 * 记忆调度器 — 纯 .md 架构
 *
 * 每 1 小时: AI 精炼 raw 对话 → refined YYYY-MM-DD.md（覆盖写入）
 * 每 24 小时: AI 更新画像 → impressions.md（覆盖写入）
 * 每 1 小时: 归档 30 天以上的旧文件
 *
 * 目录结构:
 *   data/memory/
 *     raw/      ← collector 实时追加原始行
 *       groups/{groupId}/YYYY-MM-DD.txt
 *       users/{userId}/YYYY-MM-DD.txt
 *     refined/  ← 调度器 AI 精炼输出
 *       groups/{groupId}/YYYY-MM-DD.md
 *       users/{userId}/YYYY-MM-DD.md
 *       groups/{groupId}/impressions.md
 *       users/{userId}/impressions.md
 */
import fs from 'fs'
import path from 'path'

// ─── 配置 ──────────────────────────────────────

const REFINE_INTERVAL_MS = 60 * 60 * 1000            // 1 hour
const FIRST_REFINE_DELAY_MS = 60 * 1000               // 启动后 60 秒
const IMPRESSION_INTERVAL_MS = 24 * 60 * 60 * 1000    // 24 hours
const ARCHIVE_DAYS = 30
const ARCHIVE_CHECK_MS = 60 * 60 * 1000               // 1 hour

let archiveHandle = null
let refineHandle = null
let impressionHandle = null

const PLUGIN_ROOT = path.resolve('./plugins/loli-plugin')

// ─── Public API ─────────────────────────────────

/**
 * @param {Object} opts
 * @param {string} [opts.dataDir] - 记忆数据根目录
 * @param {number} [opts.archiveDays]
 * @param {Object} [opts.logger]
 */
export function startScheduler (opts = {}) {
  if (archiveHandle || refineHandle) return

  const rawDir = opts.dataDir || 'data/memory/md'
  const dataDir = path.isAbsolute(rawDir) ? rawDir : path.resolve(PLUGIN_ROOT, rawDir)
  const archiveDays = opts.archiveDays || ARCHIVE_DAYS
  const log = opts.logger || { info (m) { console.log(m) }, warn (m) { console.warn(m) } }

  // 归档
  archiveHandle = setInterval(() => {
    try { runArchive(dataDir, archiveDays) } catch {}
  }, ARCHIVE_CHECK_MS)

  // 精炼（每 1 小时，首次延迟 60 秒）
  setTimeout(() => {
    runRefinement(dataDir, log)
    refineHandle = setInterval(() => runRefinement(dataDir, log), REFINE_INTERVAL_MS)
  }, FIRST_REFINE_DELAY_MS)

  // 画像（每 24 小时，首次延迟 30 秒）
  setTimeout(() => {
    runImpression(dataDir, log)
    impressionHandle = setInterval(() => runImpression(dataDir, log), IMPRESSION_INTERVAL_MS)
  }, 30 * 1000)

  log.info(`[Memory] 调度器启动 (精炼:${REFINE_INTERVAL_MS / 60000}分钟, 画像:24小时, 归档:${archiveDays}天)`)
}

export function stopScheduler () {
  if (archiveHandle) { clearInterval(archiveHandle); archiveHandle = null }
  if (refineHandle) { clearInterval(refineHandle); refineHandle = null }
  if (impressionHandle) { clearInterval(impressionHandle); impressionHandle = null }
}

// ─── 时间工具 ───────────────────────────────────

function today () {
  const d = new Date()
  d.setHours(d.getHours() + 8) // UTC+8
  return d.toISOString().slice(0, 10)
}

function ensureDir (dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// ─── 归档 ───────────────────────────────────────

function runArchive (baseDir, maxDays) {
  const now = Date.now()
  const cutoff = maxDays * 24 * 60 * 60 * 1000

  for (const scope of ['groups', 'users']) {
    const scopeDir = path.join(baseDir, scope)
    if (!fs.existsSync(scopeDir)) continue
    for (const id of fs.readdirSync(scopeDir)) {
      const refinedDir = path.join(scopeDir, id)
      if (!fs.statSync(refinedDir).isDirectory()) continue
      for (const f of fs.readdirSync(refinedDir)) {
        if (f === 'impressions.md') continue
        const match = f.match(/^(\d{4}-\d{2}-\d{2})/)
        if (!match) continue
        const fileDate = new Date(match[1])
        if (now - fileDate.getTime() > cutoff) {
          fs.unlinkSync(path.join(refinedDir, f))
        }
      }
    }
  }
}

// ─── 精炼 ───────────────────────────────────────

async function runRefinement (baseDir, log) {
  const d = today()
  const refinedBase = path.join(baseDir, 'refined')

  for (const [scopeLabel, scopeDir] of [['群组', 'groups'], ['用户', 'users']]) {
    const rawScope = path.join(baseDir, 'raw', scopeDir)
    if (!fs.existsSync(rawScope)) continue

    for (const id of fs.readdirSync(rawScope)) {
      const rawFile = path.join(rawScope, id, d + '.txt')
      if (!fs.existsSync(rawFile)) continue

      const raw = fs.readFileSync(rawFile, 'utf8').trim()
      if (!raw) continue

      // 检测是否需要精炼（与上次对比）
      const refinedFile = path.join(refinedBase, scopeDir, id, d + '.md')
      const prevHash = readHash(refinedFile)
      const currHash = simpleHash(raw)
      if (prevHash === currHash) {
        log.info(`[Memory] ${scopeLabel} ${id} 精炼跳过 (无变化)`)
        continue
      }

      // 构建精炼提示
      const prompt = buildRefinePrompt(raw, scopeLabel, id, d)

      try {
        const refined = await callAI(prompt)
        if (!refined || refined.includes('[NO_FACTS]')) continue
        ensureDir(path.dirname(refinedFile))
        const finalContent = `# ${d} ${scopeLabel} ${id} 对话精炼\n\n${refined}\n\n[hash:${currHash}]`
        fs.writeFileSync(refinedFile, finalContent, 'utf8')
        log.info(`[Memory] ${scopeLabel} ${id} 精炼完成`)
      } catch (err) {
        log.warn(`[Memory] ${scopeLabel} ${id} 精炼失败: ${err.message.slice(0, 100)}`)
      }
    }
  }
}

// ─── 画像 ───────────────────────────────────────

async function runImpression (baseDir, log) {
  const refinedBase = path.join(baseDir, 'refined')

  for (const [scopeLabel, scopeDir] of [['群组', 'groups'], ['用户', 'users']]) {
    const scopePath = path.join(refinedBase, scopeDir)
    if (!fs.existsSync(scopePath)) continue

    for (const id of fs.readdirSync(scopePath)) {
      // 聚合最近 7 天的精炼内容
      const lines = []
      for (const f of fs.readdirSync(path.join(scopePath, id)).sort().slice(-7)) {
        if (f === 'impressions.md' || !f.endsWith('.md')) continue
        const content = fs.readFileSync(path.join(scopePath, id, f), 'utf8')
          .replace(/#.*?\n/, '')
          .replace(/\[hash:.*?\]/, '')
          .trim()
        if (content) lines.push(content)
      }

      if (lines.length === 0) continue

      const raw = lines.join('\n\n')
      const impFile = path.join(scopePath, id, 'impressions.md')
      const prevHash = readHash(impFile)
      const currHash = simpleHash(raw)
      if (prevHash === currHash) continue

      const prompt = `基于以下 ${scopeLabel}「${id}」最近 7 天的精炼对话，生成一份简洁的画像（群组性质、活跃成员特征、讨论话题等）：\n\n${raw.slice(0, 6000)}`

      try {
        const impression = await callAI(prompt)
        if (!impression) continue
        fs.writeFileSync(impFile, `## ${scopeLabel}画像\n\n${impression}\n\n[hash:${currHash}]`, 'utf8')
        log.info(`[Memory] ${scopeLabel} ${id} 画像更新完成`)
      } catch (err) {
        log.warn(`[Memory] ${scopeLabel} ${id} 画像失败: ${err.message.slice(0, 100)}`)
      }
    }
  }
}

// ─── AI 调用 ────────────────────────────────────

async function callAI (prompt) {
  const apiKey = getConfigKey()
  if (!apiKey) return null

  // 简单的对话生成
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
    })
  }).then(r => r.json())

  const text = res?.candidates?.[0]?.content?.parts?.[0]?.text
  return text
}

function getConfigKey () {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'data', 'config.json'), 'utf8'))
    return cfg?.chaite?.channels?.[0]?.options?.apiKey || ''
  } catch { return '' }
}

// ─── 工具函数 ───────────────────────────────────

function simpleHash (s) {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return String(h)
}

function readHash (filePath) {
  if (!fs.existsSync(filePath)) return ''
  const content = fs.readFileSync(filePath, 'utf8')
  const match = content.match(/\[hash:([^\]]+)\]/)
  return match?.[1] || ''
}

function buildRefinePrompt (raw, type, id, date) {
  const label = type === '群组' ? '群聊' : '用户'
  return `请从以下 ${label}原始对话记录中提取关键事实（每条一行，以 "- " 开头）：\n\n时间: ${date}\n${type}: ${id}\n\n${raw.slice(0, 5000)}\n\n提取规则：\n- 只提取有长期价值的信息（偏好、事件、计划、观点）\n- 忽略闲聊、问候、表情等无意义内容\n- 每条事实独立一行，简洁明了\n- 如果没有值得记录的事实，输出：[NO_FACTS]`
}

/**
 * 追加原始对话行到 raw 文件
 * @param {Object} opts
 */
export function appendRaw ({ baseDir, scope, id, line }) {
  if (!baseDir || !id || !line) return
  const file = path.join(baseDir, 'raw', scope, id, today() + '.txt')
  ensureDir(path.dirname(file))
  fs.appendFileSync(file, line + '\n', 'utf8')
}
