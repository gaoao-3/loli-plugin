/**
 * 统一存储层 — 轻量 KV（JSON 文件 + 内存 Map）+ SQLite 会话历史
 * 纯 JS，零 native 依赖（node:sqlite 内置）
 *
 * Key 前缀约定（JSON KV）:
 *   ch:{id}      — 渠道
 *   pr:{id}      — 预设
 *   tl:{id}      — 工具元信息
 *   us:{userId}  — 用户状态
 *
 * 历史消息 hs 存于 history.sqlite（conversation_id, mid, timestamp, payload），
 * 避免每条消息一个 JSON 小文件；首次启动自动迁移旧 hs/ 目录。
 */
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { DatabaseSync } from 'node:sqlite'

/** 历史中工具结果保留的最大字符数；当轮模型已看过全文，历史只留梗概 */
const HISTORY_TOOL_RESULT_MAX_CHARS = 2000

function atomicWriteJson (file, value) {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  let fd
  try {
    fd = fs.openSync(temp, 'wx', 0o600)
    fs.writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(temp, file)
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch {}
    }
    try { fs.unlinkSync(temp) } catch {}
  }
}

/**
 * 历史瘦身：落盘前移除对后续对话无价值的重载荷。
 * - 图片 base64 → [图片] 占位文本（hs/ 膨胀主因）
 * - 无签名 reasoning 思考链 → 删除（旧推理每轮重发纯属烧 token）
 * - 带 thoughtSignature 的 reasoning → 原样保留（Gemini 工具续轮必须回传）
 * - toolCallResult 全文 → 截断（run_code/搜索结果动辄几十 KB）
 * 必须返回副本——原对象本轮还要继续发给模型。
 */
function sanitizeHistoryMedia (msg) {
  if (!Array.isArray(msg?.content)) return msg
  let changed = false
  const content = []
  for (const part of msg.content) {
    if (part?.type === 'image' && part.image) {
      changed = true
      content.push({ type: 'text', text: '[图片]' })
      continue
    }
    if (part?.type === 'reasoning' && !part.thoughtSignature) {
      changed = true
      continue
    }
    if (part?.type === 'toolCallResult' && typeof part.content === 'string' && part.content.length > HISTORY_TOOL_RESULT_MAX_CHARS) {
      changed = true
      content.push({ ...part, content: part.content.slice(0, HISTORY_TOOL_RESULT_MAX_CHARS) + `…[已截断，原文 ${part.content.length} 字符]` })
      continue
    }
    content.push(part)
  }
  return changed ? { ...msg, content } : msg
}

export class LoliStorage {
  #dataDir
  /** @type {Map<string, any>} */
  #cache = new Map()
  #dirty = false
  #flushTimer = null
  /** @type {DatabaseSync|null} */
  #db = null
  /** @type {Object|null} 预编译语句，open() 时创建，避免每次调用重新 prepare */
  #stmts = null

  constructor (dataDir) {
    this.#dataDir = dataDir
  }

  /** 打开 */
  open () {
    fs.mkdirSync(this.#dataDir, { recursive: true })
    this.#db = new DatabaseSync(path.join(this.#dataDir, 'history.sqlite'))
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS history (
        conversation_id TEXT NOT NULL,
        mid TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (conversation_id, mid)
      );
      CREATE INDEX IF NOT EXISTS idx_history_conv_time
        ON history (conversation_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_history_time
        ON history (timestamp);
      CREATE TABLE IF NOT EXISTS history_meta (
        conversation_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    this.#stmts = {
      insertHistory: this.#db.prepare(
        'INSERT OR REPLACE INTO history (conversation_id, mid, timestamp, payload) VALUES (?, ?, ?, ?)'
      ),
      // 子查询先按时间倒序取最近 N 条，外层再翻回正序；利用 (conversation_id, timestamp) 索引
      selectHistory: this.#db.prepare(`
        SELECT payload FROM (
          SELECT payload, timestamp, rowid AS seq FROM history
          WHERE conversation_id = ?
          ORDER BY timestamp DESC, seq DESC
          LIMIT ?
        ) ORDER BY timestamp ASC, seq ASC
      `),
      deleteConversation: this.#db.prepare('DELETE FROM history WHERE conversation_id = ?'),
      pruneStats: this.#db.prepare(
        'SELECT COUNT(*) AS deleted, COALESCE(SUM(LENGTH(payload)), 0) AS bytes FROM history WHERE timestamp < ?'
      ),
      pruneDelete: this.#db.prepare('DELETE FROM history WHERE timestamp < ?'),
      countHistory: this.#db.prepare('SELECT COUNT(*) AS n FROM history WHERE conversation_id = ?'),
      selectOldest: this.#db.prepare(
        'SELECT rowid AS seq, payload FROM history WHERE conversation_id = ? ORDER BY timestamp ASC, seq ASC LIMIT ?'
      ),
      deleteBySeq: this.#db.prepare('DELETE FROM history WHERE conversation_id = ? AND rowid = ?'),
      getSummary: this.#db.prepare('SELECT summary FROM history_meta WHERE conversation_id = ?'),
      upsertSummary: this.#db.prepare(
        'INSERT INTO history_meta (conversation_id, summary, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(conversation_id) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at'
      ),
      deleteSummary: this.#db.prepare('DELETE FROM history_meta WHERE conversation_id = ?')
    }
    this.#migrateLegacyHistory()
    return this
  }

  /** 关闭 */
  close () {
    clearTimeout(this.#flushTimer)
    if (this.#dirty) this.#flush()
    this.#db?.close()
    this.#db = null
  }

  /**
   * 一次性迁移旧版 hs/ 目录（每条消息一个 JSON 文件）到 SQLite。
   * 成功导入后删除原文件与目录。
   */
  #migrateLegacyHistory () {
    const historyDir = path.join(this.#dataDir, 'hs')
    if (!fs.existsSync(historyDir)) return
    let files
    try {
      files = fs.readdirSync(historyDir).filter(f => f.endsWith('.json'))
    } catch { return }
    if (files.length === 0) {
      try { fs.rmdirSync(historyDir) } catch {}
      return
    }
    const insert = this.#stmts.insertHistory
    this.#db.exec('BEGIN')
    try {
      for (const file of files) {
        const filePath = path.join(historyDir, file)
        try {
          const raw = fs.readFileSync(filePath, 'utf8')
          const message = JSON.parse(raw)
          const cid = String(message?.conversationId || 'global')
          const mid = String(message?.id || file.replace(/\.json$/, ''))
          const timestamp = Number(message?.timestamp) || 0
          insert.run(cid, mid, timestamp, raw)
          fs.unlinkSync(filePath)
        } catch {}
      }
      this.#db.exec('COMMIT')
    } catch (err) {
      this.#db.exec('ROLLBACK')
      throw err
    }
    // 大批量导入后截断 WAL，避免迁移旧数据后 WAL 文件长期膨胀
    try { this.#db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch {}
    try { fs.rmdirSync(historyDir) } catch {}
  }

  // ─── 核心 KV ──────────────────────────────────

  async put (key, value) {
    this.#cache.set(key, value)
    this.#dirty = true
    this.#scheduleFlush()
  }

  async get (key) {
    if (this.#cache.has(key)) return this.#cache.get(key)
    // 从文件加载
    const file = this.#keyToFile(key)
    if (fs.existsSync(file)) {
      try {
        const val = JSON.parse(fs.readFileSync(file, 'utf8'))
        this.#cache.set(key, val)
        return val
      } catch {}
    }
    return undefined
  }

  async remove (key) {
    this.#cache.delete(key)
    const file = this.#keyToFile(key)
    try { fs.unlinkSync(file) } catch {}
    this.#dirty = true
  }

  /** 立即把待写 KV 持久化；管理接口在返回成功前调用。 */
  flush () {
    if (!this.#dirty) return
    try {
      this.#flushSync()
    } catch (err) {
      // 同步提交失败后保留 dirty，并恢复后台重试机会。
      this.#scheduleFlush()
      throw err
    }
  }

  /** 按前缀迭代（内存缓存 + 文件系统） */
  async * iteratePrefix (prefix) {
    const seen = new Set()
    // 1. 内存中已有的优先
    for (const [key, value] of this.#cache.entries()) {
      if (key.startsWith(prefix)) {
        seen.add(key)
        yield { key, value }
      }
    }
    // 2. 文件系统中未缓存的补充
    const dir = this.#prefixToDir(prefix)
    if (!fs.existsSync(dir)) return
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      const key = prefix + ':' + f.replace(/\.json$/, '').replace(/\+/g, ':')
      if (seen.has(key)) continue
      const value = await this.get(key)
      if (value !== undefined) yield { key, value }
    }
  }

  /** 获取所有匹配前缀的值 */
  async getAllByPrefix (prefix) {
    const results = []
    for await (const { value } of this.iteratePrefix(prefix)) {
      results.push(value)
    }
    return results
  }

  // ─── 渠道 ──────────────────────────────────────

  listChannels () { return this.getAllByPrefix('ch') }
  getChannel (id) { return this.get('ch:' + id) }
  async saveChannel (ch) {
    ch.id = ch.id || randomUUID()
    await this.put('ch:' + ch.id, ch)
    return ch
  }
  deleteChannel (id) { return this.remove('ch:' + id) }

  // ─── 预设 ──────────────────────────────────────

  listPresets () { return this.getAllByPrefix('pr') }
  getPreset (id) { return this.get('pr:' + id) }
  async savePreset (p) {
    p.id = p.id || randomUUID()
    await this.put('pr:' + p.id, p)
    return p
  }
  deletePreset (id) { return this.remove('pr:' + id) }

  // ─── 工具元信息 ────────────────────────────────

  listToolMetas () { return this.getAllByPrefix('tl') }
  getToolMeta (id) { return this.get('tl:' + id) }
  async saveToolMeta (t) {
    t.id = t.id || randomUUID()
    await this.put('tl:' + t.id, t)
    return t
  }
  deleteToolMeta (id) { return this.remove('tl:' + id) }

  // ─── 历史消息 ──────────────────────────────────

  async saveHistory (msg) {
    const cid = msg.conversationId || 'global'
    const mid = msg.id || randomUUID()
    msg.id = mid
    msg.timestamp = msg.timestamp || Date.now()
    // 图片等重载荷只在当轮有效，持久化时瘦身（剥图片/推理、截断工具结果）；
    // 必须写副本——原对象本轮还要继续发给模型。
    this.#stmts.insertHistory.run(String(cid), String(mid), Number(msg.timestamp) || 0, JSON.stringify(sanitizeHistoryMedia(msg)))
    return msg
  }

  async getHistory (conversationId, limit) {
    const cid = String(conversationId || 'global')
    const max = Number(limit) > 0 ? Math.trunc(Number(limit)) : 1000000
    const rows = this.#stmts.selectHistory.all(cid, max)
    const entries = []
    for (const row of rows) {
      try { entries.push(JSON.parse(row.payload)) } catch {}
    }
    // 早前对话已被压缩成摘要时，作为首条消息注入，模型仍能看到老上下文梗概
    const summary = this.#stmts.getSummary.get(cid)?.summary
    if (summary) {
      entries.unshift({
        id: `summary-${cid}`,
        conversationId: cid,
        role: 'user',
        content: [{ type: 'text', text: `[早前对话摘要]\n${summary}` }],
        timestamp: 0
      })
    }
    return entries
  }

  /** 会话原始消息条数（不含摘要） */
  countHistory (conversationId) {
    return Number(this.#stmts.countHistory.get(String(conversationId || 'global'))?.n) || 0
  }

  /**
   * 取最老的 limit 条原始记录（含 rowid），供压缩使用。
   * @returns {Array<{seq: number, message: Object}>}
   */
  getOldestHistoryRows (conversationId, limit) {
    const rows = this.#stmts.selectOldest.all(String(conversationId || 'global'), Math.max(1, Math.trunc(Number(limit) || 1)))
    const entries = []
    for (const row of rows) {
      try { entries.push({ seq: row.seq, message: JSON.parse(row.payload) }) } catch {}
    }
    return entries
  }

  getHistorySummary (conversationId) {
    return String(this.#stmts.getSummary.get(String(conversationId || 'global'))?.summary || '')
  }

  /** 事务性压缩：删除指定原始消息并写入新摘要 */
  replaceHistoryWithSummary (conversationId, seqs, summary) {
    const cid = String(conversationId || 'global')
    this.#db.exec('BEGIN')
    try {
      for (const seq of seqs) this.#stmts.deleteBySeq.run(cid, seq)
      this.#stmts.upsertSummary.run(cid, String(summary || ''), Date.now())
      this.#db.exec('COMMIT')
    } catch (err) {
      this.#db.exec('ROLLBACK')
      throw err
    }
  }

  async clearHistory (conversationId) {
    const cid = String(conversationId || 'global')
    this.#stmts.deleteConversation.run(cid)
    this.#stmts.deleteSummary.run(cid)
  }

  /**
   * 清理早于指定时间的模型会话历史。
   * @param {number} olderThan Unix 毫秒时间戳
   * @returns {{ deleted: number, bytes: number }}
   */
  pruneHistory (olderThan) {
    const cutoff = Number(olderThan)
    if (!Number.isFinite(cutoff) || cutoff <= 0) return { deleted: 0, bytes: 0 }
    const stats = this.#stmts.pruneStats.get(cutoff)
    this.#stmts.pruneDelete.run(cutoff)
    return { deleted: Number(stats.deleted) || 0, bytes: Number(stats.bytes) || 0 }
  }

  // ─── 用户状态 ──────────────────────────────────

  getState (userId) { return this.get('us:' + userId) }
  saveState (userId, state) { return this.put('us:' + userId, state) }
  deleteState (userId) { return this.remove('us:' + userId) }

  // ─── 统计 ──────────────────────────────────────

  async stats () {
    let count = 0
    for await (const {} of this.iteratePrefix('')) count++
    return { totalKeys: count, path: this.#dataDir }
  }

  // ─── 内部 ──────────────────────────────────────

  /** 安全的文件路径：Windows 文件名不能含 : */
  #keyToPath (key) {
    return key.replace(/:/g, '+')
  }

  #keyToFile (key) {
    const parts = key.split(':')
    const prefix = parts[0]
    const rest = parts.slice(1).join('+')
    const dir = path.join(this.#dataDir, prefix)
    fs.mkdirSync(dir, { recursive: true })
    return path.join(dir, rest + '.json')
  }

  #prefixToDir (prefix) {
    return path.join(this.#dataDir, prefix.split(':')[0])
  }

  #scheduleFlush () {
    clearTimeout(this.#flushTimer)
    this.#flushTimer = setTimeout(() => this.#flush(), 2000)
  }

  #flushSync () {
    clearTimeout(this.#flushTimer)
    this.#flush()
  }

  #flush () {
    const entries = [...this.#cache.entries()]
    for (const [key, value] of entries) {
      const file = this.#keyToFile(key)
      // 原子写入：先写 tmp 再 rename
      atomicWriteJson(file, value)
    }
    this.#dirty = false
  }
}
