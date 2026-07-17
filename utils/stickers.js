import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { isGroupEvent, makeFaceSegment, normalizeSegment } from './bot.js'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const DEFAULT_STICKER_DB = path.join(ROOT, 'data', 'stickers.sqlite')
const stores = new Map()
const STICKER_DIRECTIVE_RE = /\[(?:sticker|表情)\s*[:：]\s*(\[[^\]\n]{1,40}\]|[^\]\n]{1,40})\]/giu
export const INLINE_STICKER_TOKEN = '\uE000'
const INTERNAL_STICKER_TAGS = new Set([
  '自动收录', '手动收录', '动画表情', '图片表情', '收藏表情', '商城表情', '推荐表情', 'qq表情', '表情'
])

export function openStickerStore (dbFile = DEFAULT_STICKER_DB) {
  const resolved = path.resolve(dbFile)
  if (stores.has(resolved)) return stores.get(resolved)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const db = new DatabaseSync(resolved)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS stickers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      text TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      description TEXT,
      source_user_id TEXT,
      source_message_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      use_count INTEGER NOT NULL DEFAULT 0,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stickers_enabled ON stickers (enabled, kind);
  `)
  stores.set(resolved, db)
  return db
}

export function closeStickerStores () {
  for (const db of stores.values()) db.close()
  stores.clear()
}

export function normalizeStickerSegment (raw) {
  const segment = normalizeSegment(raw)
  const type = String(segment.type || '').toLowerCase()
  if (type === 'face' || type === 'sface') {
    const id = Number(segment.id)
    if (!Number.isInteger(id) || id < 0) return null
    const big = type === 'face' && Boolean(segment.big)
    const stickerId = segment.stickerId ?? segment.sticker_id
    const stickerType = Number(segment.stickerType ?? segment.sticker_type)
    return {
      kind: big ? 'superface' : 'face',
      text: cleanText(segment.text || `QQ表情 ${id}`),
      payload: {
        type: 'face',
        id,
        big,
        ...(stickerId !== undefined && stickerId !== null && String(stickerId) !== ''
          ? { stickerId: String(stickerId) }
          : {}),
        ...(Number.isFinite(stickerType) ? { stickerType } : {}),
        ...(segment.text ? { text: cleanText(segment.text) } : {})
      }
    }
  }
  if (type === 'bface' && segment.file) {
    return {
      kind: 'favorite',
      text: cleanText(segment.text || '收藏表情'),
      payload: { type: 'bface', file: String(segment.file), text: cleanText(segment.text || '收藏表情') }
    }
  }
  if (type === 'mface' || type === 'marketface') {
    return {
      kind: 'marketface',
      text: cleanText(segment.summary || segment.text || segment.name || '商城表情'),
      payload: safeJsonValue(raw)
    }
  }
  if (type === 'image' && isStickerImage(segment)) {
    const file = segment.file || segment.url
    if (!file) return null
    return {
      kind: 'image',
      text: cleanText(segment.summary || segment.text || '图片表情'),
      payload: {
        type: 'image',
        file: String(file),
        ...(segment.url ? { url: String(segment.url) } : {}),
        asface: true
      }
    }
  }
  return null
}

export function collectableStickerSegments (message) {
  const values = Array.isArray(message) ? message : [message]
  return values.map(normalizeStickerSegment).filter(Boolean)
}

export function saveSticker ({ segment, tags = [], description = '', sourceUserId = '', sourceMessageId = '' }, dbFile) {
  const sticker = segment?.kind && segment?.payload ? segment : normalizeStickerSegment(segment)
  if (!sticker) throw new Error('消息中没有可收录的 QQ 表情')
  const db = openStickerStore(dbFile)
  const normalizedTags = normalizeTags([...tags, sticker.text])
  const fingerprint = stickerFingerprint(sticker)
  const now = Date.now()
  const existing = db.prepare('SELECT * FROM stickers WHERE fingerprint = ?').get(fingerprint)
  if (existing) {
    const mergedTags = normalizeTags([...parseArray(existing.tags_json), ...normalizedTags])
    db.prepare(`
      UPDATE stickers SET payload_json = ?, tags_json = ?, description = ?, text = ?, enabled = 1, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(sticker.payload), JSON.stringify(mergedTags), description || existing.description || '', sticker.text, now, existing.id)
    return { ...rowToSticker(db.prepare('SELECT * FROM stickers WHERE id = ?').get(existing.id)), created: false }
  }
  const result = db.prepare(`
    INSERT INTO stickers (
      fingerprint, kind, payload_json, text, tags_json, description,
      source_user_id, source_message_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fingerprint, sticker.kind, JSON.stringify(sticker.payload), sticker.text,
    JSON.stringify(normalizedTags), cleanText(description), String(sourceUserId || ''),
    String(sourceMessageId || ''), now, now
  )
  return { ...getSticker(Number(result.lastInsertRowid), dbFile), created: true }
}

export function getSticker (id, dbFile) {
  const row = openStickerStore(dbFile).prepare('SELECT * FROM stickers WHERE id = ?').get(Number(id))
  return row ? rowToSticker(row) : null
}

export function listStickers ({ enabled, limit = 50 } = {}, dbFile) {
  const db = openStickerStore(dbFile)
  const bounded = Math.max(1, Math.min(200, Number(limit) || 50))
  const rows = enabled === undefined
    ? db.prepare('SELECT * FROM stickers ORDER BY id DESC LIMIT ?').all(bounded)
    : db.prepare('SELECT * FROM stickers WHERE enabled = ? ORDER BY id DESC LIMIT ?').all(enabled ? 1 : 0, bounded)
  return rows.map(rowToSticker)
}

export function getStickerStats (dbFile) {
  const row = openStickerStore(dbFile).prepare(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled,
      COALESCE(SUM(use_count), 0) AS uses
    FROM stickers
  `).get()
  return { total: Number(row.total || 0), enabled: Number(row.enabled || 0), uses: Number(row.uses || 0) }
}

export function updateStickerMetadata (id, { tags = [], description = '' } = {}, dbFile) {
  const db = openStickerStore(dbFile)
  const current = db.prepare('SELECT * FROM stickers WHERE id = ?').get(Number(id))
  if (!current) return null
  const mergedTags = normalizeTags([...parseArray(current.tags_json), ...tags])
  db.prepare(`
    UPDATE stickers SET tags_json = ?, description = ?, updated_at = ? WHERE id = ?
  `).run(JSON.stringify(mergedTags), cleanText(description) || current.description || '', Date.now(), Number(id))
  return getSticker(id, dbFile)
}

export function cacheStickerMedia (id, buffer, mimeType = 'image/jpeg', dbFile) {
  if (!buffer?.length) throw new Error('表情缓存内容为空')
  const db = openStickerStore(dbFile)
  const current = db.prepare('SELECT * FROM stickers WHERE id = ?').get(Number(id))
  if (!current) throw new Error(`没有找到表情 #${id}`)
  const payload = parseObject(current.payload_json)
  if (current.kind !== 'image') return rowToSticker(current)
  const baseDir = path.dirname(path.resolve(dbFile || DEFAULT_STICKER_DB))
  const assetDir = path.join(baseDir, 'sticker-assets')
  fs.mkdirSync(assetDir, { recursive: true })
  const mimeExtension = ({
    'image/gif': 'gif',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/jpeg': 'jpg'
  })[String(mimeType).split(';')[0].toLowerCase()]
  const originalExtension = path.extname(String(payload.file || '')).replace(/^\./u, '').toLowerCase()
  const extension = mimeExtension || (/^(?:gif|png|webp|jpe?g)$/u.test(originalExtension) ? originalExtension : 'img')
  const file = path.join(assetDir, `${id}.${extension}`)
  fs.writeFileSync(file, buffer)
  const nextPayload = { ...payload, file, asface: true }
  db.prepare('UPDATE stickers SET payload_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(nextPayload), Date.now(), Number(id))
  return getSticker(id, dbFile)
}

export function setStickerEnabled (id, enabled, dbFile) {
  const result = openStickerStore(dbFile)
    .prepare('UPDATE stickers SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(enabled ? 1 : 0, Date.now(), Number(id))
  return result.changes > 0
}

export function deleteSticker (id, dbFile) {
  return openStickerStore(dbFile).prepare('DELETE FROM stickers WHERE id = ?').run(Number(id)).changes > 0
}

export function findSticker ({ emotion = '', kind = '' } = {}, dbFile, random = Math.random) {
  const candidates = openStickerStore(dbFile)
    .prepare('SELECT * FROM stickers WHERE enabled = 1 ORDER BY use_count ASC, id DESC LIMIT 200')
    .all()
    .map(rowToSticker)
    .filter(sticker => !kind || sticker.kind === kind)
    .filter(isStickerAutoSendable)
  if (!candidates.length) return null
  const terms = normalizeTags(String(emotion).split(/[\s,，、/]+/))
    .filter(term => !isInternalStickerTag(term))
  if (!terms.length) return null
  const scored = candidates.map(sticker => {
    const searchable = [sticker.text, sticker.description, ...sticker.tags]
      .filter(value => !isInternalStickerTag(value))
    const haystack = normalizeSearchText(searchable.join(' '))
    const hits = terms.reduce((total, term) => total + (haystack.includes(normalizeSearchText(term)) ? 1 : 0), 0)
    return { sticker, hits, score: hits * 100 - sticker.useCount * 0.2 + random() }
  }).filter(item => item.hits > 0)
    .sort((a, b) => b.score - a.score)
  return scored[0]?.sticker || null
}

/** 从模型最终文本中提取隐藏表情标记，并保留第一个标记在正文中的位置。 */
export function extractStickerDirective (text) {
  let emotion = ''
  const positionedText = cleanDirectiveText(String(text || '').replace(STICKER_DIRECTIVE_RE, (_matched, value) => {
    if (emotion) return ''
    emotion = cleanText(value)
    return INLINE_STICKER_TOKEN
  }))
  return {
    text: cleanDirectiveText(positionedText.replace(INLINE_STICKER_TOKEN, '')),
    emotion,
    positionedText
  }
}

/** 把当前表情库的真实标签提供给模型，模型只输出隐藏标记，不执行工具。 */
export function buildStickerDirectivePrompt (config, dbFile) {
  if (config?.stickers?.enable === false) return ''
  const stickers = listStickers({ enabled: true, limit: 100 }, dbFile).filter(isStickerAutoSendable)
  if (!stickers.length) return ''
  const tags = [...new Set(stickers.flatMap(sticker => sticker.tags)
    .filter(tag => tag && !isInternalStickerTag(tag)))].slice(0, 40)
  if (!tags.length) return ''
  const choices = tags.join('、')
  return `[QQ表情规则]
你可以在最终回复正文中的任意自然位置添加一次 [sticker:标签]，发送层会将其替换成真实 QQ 表情，用户看不到该标记。
大多数回复不要使用表情；仅在表情明显能增强当前语气时使用，不要连续或解释标记，每次最多一个。
只能从以下已有标签中原样选择：${choices}。不要创造标签。正文仍保持当前角色的自然说话方式。`
}

export function shouldAutoSendSticker (config, random = Math.random) {
  const configured = Number(config?.stickers?.probability)
  const probability = Number.isFinite(configured) ? Math.max(0, Math.min(1, configured)) : 0.35
  return probability > 0 && random() < probability
}

export async function sendSticker (event, sticker, dbFile, { nativeSuperface = false } = {}) {
  if (!event || !sticker) throw new Error('缺少事件或表情数据')
  const payload = stickerSendPayload(sticker, { nativeSuperface })
  try {
    await replyStickerPayload(event, payload)
  } catch (err) {
    const fallback = stickerFallbackPayload(sticker)
    if (!fallback) throw err
    try {
      await replyStickerPayload(event, fallback)
    } catch (fallbackError) {
      if (sticker.kind === 'image') setStickerEnabled(sticker.id, false, dbFile)
      throw fallbackError
    }
  }
  markStickerUsed(sticker, dbFile)
  return payload
}

/** 普通 QQ 小黄脸可拼进正文消息；其他表情仍使用独立发送链路。 */
export function getInlineFacePayload (sticker) {
  if (sticker?.kind !== 'face') return null
  return stickerSendPayload(sticker)
}

/** 将正文中的内部占位符替换为真实消息段，保留模型选择的位置。 */
export function injectInlineStickerPayload (text, payload) {
  if (!payload || !String(text || '').includes(INLINE_STICKER_TOKEN)) return [String(text || '')]
  const parts = String(text).split(INLINE_STICKER_TOKEN)
  const message = []
  for (let index = 0; index < parts.length; index++) {
    if (parts[index]) message.push(parts[index])
    if (index < parts.length - 1) message.push(payload)
  }
  return message
}

export function markStickerUsed (sticker, dbFile) {
  if (!sticker?.id) return false
  openStickerStore(dbFile).prepare(`
    UPDATE stickers SET use_count = use_count + 1, last_used_at = ?, updated_at = ? WHERE id = ?
  `).run(Date.now(), Date.now(), sticker.id)
  return true
}

export function autoCollectMasterStickers (event, config, dbFile) {
  const options = config?.stickers || {}
  if (options.enable === false || options.autoCollectMaster === false || !event?.isMaster) return []
  const segments = (Array.isArray(event.message) ? event.message : [])
    .map(raw => ({ raw: normalizeSegment(raw), sticker: normalizeStickerSegment(raw) }))
    .filter(item => item.sticker)
  return segments.map(({ raw, sticker }) => ({
    ...saveSticker({
      segment: sticker,
      tags: ['自动收录'],
      sourceUserId: event.user_id || event.sender?.user_id,
      sourceMessageId: event.message_id || event.seq
    }, dbFile),
    sourceSegment: raw
  }))
}

export async function getQuotedMessage (event) {
  if (!(event?.source || event?.reply_id)) return []
  if (typeof event.getReply === 'function') {
    const quoted = await event.getReply()
    return quoted?.message || quoted?.data?.message || []
  }
  const inGroup = isGroupEvent(event)
  const seq = inGroup ? (event.source?.seq || event.reply_id) : event.source?.time
  const history = inGroup
    ? await event.group?.getChatHistory?.(seq, 1)
    : await event.friend?.getChatHistory?.(seq, 1)
  const list = Array.isArray(history) ? history : history?.messages || history?.data?.messages || []
  return list.at?.(-1)?.message || []
}

function rowToSticker (row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    payload: parseObject(row.payload_json),
    text: row.text || '',
    tags: parseArray(row.tags_json),
    description: row.description || '',
    enabled: Boolean(row.enabled),
    useCount: Number(row.use_count || 0),
    lastUsedAt: row.last_used_at || null,
    createdAt: row.created_at
  }
}

function stickerFingerprint (sticker) {
  const payload = sticker.kind === 'image'
    ? { type: 'image', file: sticker.payload.file, asface: true }
    : (sticker.kind === 'face' || sticker.kind === 'superface')
        ? { type: 'face', id: sticker.payload.id, big: sticker.kind === 'superface' }
        : sticker.payload
  return createHash('sha256').update(`${sticker.kind}:${JSON.stringify(payload)}`).digest('hex')
}

function normalizeTags (values) {
  return [...new Set(values.map(cleanText).filter(Boolean))].slice(0, 24)
}

function normalizeSearchText (value) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function isInternalStickerTag (value) {
  return INTERNAL_STICKER_TAGS.has(normalizeSearchText(value))
}

function isStickerAutoSendable (sticker) {
  return sticker?.kind !== 'superface' || Boolean(sticker.payload?.stickerId)
}

function cleanText (value) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120)
}

function cleanDirectiveText (value) {
  return String(value || '').replace(/[ \t]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim()
}

function parseArray (value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseObject (value) {
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function safeJsonValue (value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item))
}

function isStickerImage (segment) {
  return Boolean(segment.asface || segment.sub_type === 1 || segment.subType === 1 || /表情/u.test(segment.summary || ''))
}

function stickerFallbackPayload (sticker) {
  if (sticker.kind === 'superface') return makeFaceSegment(sticker.payload.id, false)
  if (sticker.kind === 'image') {
    const url = findHttpUrl(sticker.payload.url)
    if (url) return { type: 'image', file: url, asface: false }
    return { ...stickerSendPayload(sticker), asface: false }
  }
  if (sticker.kind === 'marketface') {
    const url = findHttpUrl(sticker.payload)
    if (url) return { type: 'image', file: url, asface: true }
  }
  return null
}

function stickerSendPayload (sticker, { nativeSuperface = true } = {}) {
  if (sticker.kind === 'face' || sticker.kind === 'superface') {
    const sendAsSuperface = sticker.kind === 'superface' && nativeSuperface
    const payload = makeFaceSegment(sticker.payload.id, sendAsSuperface)
    if (!sendAsSuperface) return payload
    return {
      ...payload,
      ...(sticker.payload.stickerId ? { stickerId: String(sticker.payload.stickerId) } : {}),
      ...(Number.isFinite(Number(sticker.payload.stickerType)) ? { stickerType: Number(sticker.payload.stickerType) } : {}),
      ...(sticker.payload.text ? { text: String(sticker.payload.text) } : {})
    }
  }
  if (sticker.kind === 'image') {
    const storedFile = String(sticker.payload.file || '')
    const file = (storedFile && fs.existsSync(storedFile))
      ? storedFile
      : (findHttpUrl(sticker.payload.url) || findHttpUrl(storedFile) || storedFile)
    return { type: 'image', file, asface: true }
  }
  return sticker.payload
}

function replyStickerPayload (event, payload) {
  const reply = typeof event?.replyNew === 'function' ? event.replyNew : event?.reply
  if (typeof reply !== 'function') throw new Error('当前事件不支持发送表情')
  return reply.call(event, [payload], false)
}

function findHttpUrl (value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return ''
  if (typeof value === 'string') return /^https?:\/\//iu.test(value) ? value : ''
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findHttpUrl(item, depth + 1)
      if (found) return found
    }
  } else if (typeof value === 'object') {
    for (const item of Object.values(value)) {
      const found = findHttpUrl(item, depth + 1)
      if (found) return found
    }
  }
  return ''
}
