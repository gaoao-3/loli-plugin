import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { isGroupEvent, makeFaceSegment, normalizeSegment } from './bot.js'
import { cosineSimilarity, embedTextsWithConfiguredGemini } from '../memory/embedding.js'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const DEFAULT_STICKER_DB = path.join(ROOT, 'data', 'stickers.sqlite')
const stores = new Map()
const STICKER_DIRECTIVE_RE = /\[(?:sticker|表情)\s*[:：]\s*(\[[^\]\n]{1,40}\]|[^\]\n]{1,40})\]/giu
export const INLINE_STICKER_TOKEN = '\uE000'
const INTERNAL_STICKER_TAGS = new Set([
  '自动收录', '手动收录', '动画表情', '图片表情', '收藏表情', '商城表情', '推荐表情', 'qq表情', '表情'
])
export const CORE_STICKER_INTENTS = [
  '开心', '兴奋', '得意', '害羞', '惊讶', '疑惑',
  '无语', '无奈', '尴尬', '嫌弃', '生气', '不满',
  '委屈', '难过', '崩溃', '安慰',
  '赞同', '称赞', '拒绝', '催促',
  '调侃', '卖萌', '打招呼', '告别'
]
const CORE_STICKER_INTENT_SET = new Set(CORE_STICKER_INTENTS)
const STICKER_INTENT_ALIASES = {
  开心: ['开心', '高兴', '喜悦', '微笑'],
  兴奋: ['兴奋', '激动'],
  得意: ['得意', '自信', '炫耀'],
  害羞: ['害羞', '羞羞'],
  惊讶: ['惊讶', '震惊', '不是吧', '哦哟'],
  疑惑: ['疑惑', '困惑', '不解'],
  无语: ['无语', '无言以对', '沉默'],
  无奈: ['无奈', '叹气', '热化了', '散味儿', '摊手'],
  尴尬: ['尴尬', '冷场', '憋笑'],
  嫌弃: ['嫌弃', '鄙视', '不屑'],
  生气: ['生气', '愤怒', '恼火'],
  不满: ['不满', '抗议', '吐槽'],
  委屈: ['委屈', '快哭了', '示弱'],
  难过: ['难过', '悲伤', '伤心', '哭泣', '流泪'],
  崩溃: ['崩溃', '绝望', '宕机', '受不了了'],
  安慰: ['安慰', '抱抱', '摸摸'],
  赞同: ['赞同', '认可', '收到', '对的对的'],
  称赞: ['称赞', '赞赏', '佩服', '太赞了'],
  拒绝: ['拒绝', '摇头'],
  催促: ['催促', '敲敲'],
  调侃: ['调侃', '开玩笑', '戏谑', '恶搞', '偷感', '菜汪', '舔屏'],
  卖萌: ['卖萌', '呆萌', '可爱'],
  打招呼: ['打招呼', '问候', '挥手'],
  告别: ['告别', '再见', '拜拜']
}
const STICKER_STYLE_ALIASES = {
  可爱: ['可爱', '萌'],
  夸张: ['夸张', '崩溃', '绝望'],
  阴阳怪气: ['阴阳怪气', '不屑', '鄙视', '斜眼'],
  攻击性: ['攻击性', '攻击', '挑衅', '辱骂'],
  粗俗: ['粗俗', '猥琐', '口出狂言'],
  诡异: ['诡异', '怪诞', '抽象'],
  卖萌: ['卖萌', '撒娇', '呆萌']
}
const HIGH_RISK_STICKER_RE = /(?:粗俗|猥琐|口出狂言|辱骂|色情|极具攻击性)/u
const STICKER_METADATA_VERSION = 2
const INCOMPATIBLE_INTENT_STYLES = {
  开心: new Set(['诡异', '阴阳怪气', '攻击性', '粗俗']),
  安慰: new Set(['阴阳怪气', '攻击性', '粗俗']),
  赞同: new Set(['阴阳怪气', '攻击性', '粗俗']),
  称赞: new Set(['阴阳怪气', '攻击性', '粗俗']),
  打招呼: new Set(['攻击性', '粗俗']),
  告别: new Set(['攻击性', '粗俗'])
}

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
      intents_json TEXT NOT NULL DEFAULT '[]',
      styles_json TEXT NOT NULL DEFAULT '[]',
      description TEXT,
      risk TEXT NOT NULL DEFAULT 'safe',
      auto_send INTEGER NOT NULL DEFAULT 1,
      intents_source TEXT NOT NULL DEFAULT 'inferred',
      styles_source TEXT NOT NULL DEFAULT 'inferred',
      risk_source TEXT NOT NULL DEFAULT 'inferred',
      manual_locked INTEGER NOT NULL DEFAULT 0,
      metadata_version INTEGER NOT NULL DEFAULT 0,
      source_user_id TEXT,
      source_message_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      use_count INTEGER NOT NULL DEFAULT 0,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stickers_enabled ON stickers (enabled, kind);

    CREATE TABLE IF NOT EXISTS sticker_embeddings (
      sticker_id INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(sticker_id, model, dimensions),
      FOREIGN KEY(sticker_id) REFERENCES stickers(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sticker_embeddings_model
      ON sticker_embeddings (model, dimensions);
  `)
  ensureStickerMetadataSchema(db)
  backfillStickerMetadata(db)
  stores.set(resolved, db)
  return db
}

function ensureStickerMetadataSchema (db) {
  const columns = new Set(db.prepare('PRAGMA table_info(stickers)').all().map(column => column.name))
  const additions = [
    ['intents_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['styles_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['risk', "TEXT NOT NULL DEFAULT 'safe'"],
    ['auto_send', 'INTEGER NOT NULL DEFAULT 1'],
    ['intents_source', "TEXT NOT NULL DEFAULT 'inferred'"],
    ['styles_source', "TEXT NOT NULL DEFAULT 'inferred'"],
    ['risk_source', "TEXT NOT NULL DEFAULT 'inferred'"],
    ['manual_locked', 'INTEGER NOT NULL DEFAULT 0'],
    ['metadata_version', 'INTEGER NOT NULL DEFAULT 0']
  ]
  for (const [name, definition] of additions) {
    if (!columns.has(name)) db.exec(`ALTER TABLE stickers ADD COLUMN ${name} ${definition}`)
  }
}

function backfillStickerMetadata (db) {
  const rows = db.prepare(`
    SELECT id, kind, text, tags_json, intents_json, styles_json, description, risk, auto_send,
      intents_source, styles_source, risk_source, manual_locked, metadata_version
    FROM stickers
  `).all()
  const update = db.prepare(`
    UPDATE stickers
    SET intents_json = ?, styles_json = ?, risk = ?, auto_send = ?,
      intents_source = ?, styles_source = ?, risk_source = ?, metadata_version = ?
    WHERE id = ?
  `)
  db.exec('BEGIN')
  try {
    for (const row of rows) {
      if (Number(row.metadata_version || 0) >= STICKER_METADATA_VERSION) continue
      const tags = parseArray(row.tags_json)
      const intentsSource = normalizeMetadataSource(row.intents_source)
      const stylesSource = normalizeMetadataSource(row.styles_source)
      const riskSource = normalizeMetadataSource(row.risk_source)
      const needsIntentCleanup = intentsSource === 'inferred' && !row.manual_locked
      const inferred = inferStickerMetadata({
        kind: row.kind,
        text: row.text,
        tags,
        description: row.description,
        intents: needsIntentCleanup ? [] : parseArray(row.intents_json),
        styles: stylesSource === 'inferred' && !row.manual_locked ? [] : parseArray(row.styles_json),
        risk: row.risk
      })
      const nextIntents = intentsSource === 'inferred' && !row.manual_locked
        ? inferred.intents
        : parseArray(row.intents_json)
      const nextStyles = stylesSource === 'inferred' && !row.manual_locked
        ? inferred.styles
        : parseArray(row.styles_json)
      const nextRisk = riskSource === 'inferred' && !row.manual_locked
        ? inferred.risk
        : normalizeStickerRisk(row.risk)
      const autoSend = nextRisk === 'safe' && Boolean(row.auto_send)
      const changed = JSON.stringify(nextIntents) !== JSON.stringify(parseArray(row.intents_json)) ||
        JSON.stringify(nextStyles) !== JSON.stringify(parseArray(row.styles_json)) ||
        nextRisk !== normalizeStickerRisk(row.risk) ||
        autoSend !== Boolean(row.auto_send) ||
        Number(row.metadata_version || 0) !== STICKER_METADATA_VERSION
      if (changed) {
        update.run(
          JSON.stringify(nextIntents),
          JSON.stringify(nextStyles),
          nextRisk,
          autoSend ? 1 : 0,
          intentsSource,
          stylesSource,
          riskSource,
          STICKER_METADATA_VERSION,
          row.id
        )
      }
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
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
  const metadata = inferStickerMetadata({ kind: sticker.kind, text: sticker.text, tags: normalizedTags, description })
  const fingerprint = stickerFingerprint(sticker)
  const now = Date.now()
  const existing = db.prepare('SELECT * FROM stickers WHERE fingerprint = ?').get(fingerprint)
  if (existing) {
    const mergedTags = normalizeTags([...parseArray(existing.tags_json), ...normalizedTags])
    const mergedMetadata = inferStickerMetadata({
      kind: sticker.kind,
      text: sticker.text,
      tags: mergedTags,
      description: description || existing.description || '',
      intents: parseArray(existing.intents_json),
      styles: parseArray(existing.styles_json),
      risk: existing.risk
    })
    const locked = Boolean(existing.manual_locked)
    const nextIntents = locked ? parseArray(existing.intents_json) : mergedMetadata.intents
    const nextStyles = locked ? parseArray(existing.styles_json) : mergedMetadata.styles
    const nextRisk = locked ? normalizeStickerRisk(existing.risk) : mergedMetadata.risk
    const autoSend = nextRisk === 'safe' ? Number(existing.auto_send ?? 1) : 0
    db.prepare(`
      UPDATE stickers SET payload_json = ?, tags_json = ?, intents_json = ?, styles_json = ?,
        description = ?, risk = ?, auto_send = ?, text = ?, enabled = 1,
        metadata_version = ?, updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(sticker.payload),
      JSON.stringify(mergedTags),
      JSON.stringify(nextIntents),
      JSON.stringify(nextStyles),
      description || existing.description || '',
      nextRisk,
      autoSend,
      sticker.text,
      STICKER_METADATA_VERSION,
      now,
      existing.id
    )
    return { ...rowToSticker(db.prepare('SELECT * FROM stickers WHERE id = ?').get(existing.id)), created: false }
  }
  const result = db.prepare(`
    INSERT INTO stickers (
      fingerprint, kind, payload_json, text, tags_json, intents_json, styles_json,
      description, risk, auto_send, intents_source, styles_source, risk_source,
      manual_locked, metadata_version, source_user_id, source_message_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fingerprint, sticker.kind, JSON.stringify(sticker.payload), sticker.text,
    JSON.stringify(normalizedTags), JSON.stringify(metadata.intents), JSON.stringify(metadata.styles),
    cleanText(description), metadata.risk, metadata.risk === 'high' ? 0 : 1,
    'inferred', 'inferred', 'inferred', 0, STICKER_METADATA_VERSION,
    String(sourceUserId || ''), String(sourceMessageId || ''), now, now
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
  const stickers = openStickerStore(dbFile).prepare('SELECT * FROM stickers').all().map(rowToSticker)
  const enabled = stickers.filter(sticker => sticker.enabled)
  return {
    total: stickers.length,
    enabled: enabled.length,
    autoSendable: enabled.filter(isStickerAutoSendable).length,
    uses: stickers.reduce((total, sticker) => total + sticker.useCount, 0)
  }
}

export function updateStickerMetadata (
  id,
  {
    tags = [],
    intents,
    styles,
    description = '',
    risk = '',
    autoSend,
    source = 'classifier',
    replaceIntents = false,
    replaceStyles = false
  } = {},
  dbFile
) {
  const db = openStickerStore(dbFile)
  const current = db.prepare('SELECT * FROM stickers WHERE id = ?').get(Number(id))
  if (!current) return null
  const mergedTags = normalizeTags([...parseArray(current.tags_json), ...tags])
  const locked = Boolean(current.manual_locked) && source !== 'manual'
  const currentIntents = parseArray(current.intents_json)
  const currentStyles = parseArray(current.styles_json)
  const requestedIntents = intents === undefined
    ? currentIntents
    : normalizeTags(replaceIntents ? intents : [...currentIntents, ...intents])
      .filter(intent => CORE_STICKER_INTENT_SET.has(intent))
  const requestedStyles = styles === undefined
    ? currentStyles
    : normalizeTags(replaceStyles ? styles : [...currentStyles, ...styles])
  const metadata = inferStickerMetadata({
    kind: current.kind,
    text: current.text,
    tags: mergedTags,
    intents: requestedIntents,
    styles: requestedStyles,
    description: cleanText(description) || current.description || '',
    risk: risk || current.risk,
    inferIntents: source === 'inferred'
  })
  const nextIntents = locked ? currentIntents : metadata.intents
  const nextStyles = locked ? currentStyles : metadata.styles
  const nextRisk = locked ? normalizeStickerRisk(current.risk) : metadata.risk
  const nextAutoSend = nextRisk !== 'safe'
    ? false
    : locked || autoSend === undefined ? Boolean(current.auto_send) : Boolean(autoSend)
  const normalizedSource = normalizeMetadataSource(source)
  const intentsSource = locked || intents === undefined
    ? normalizeMetadataSource(current.intents_source)
    : normalizedSource
  const stylesSource = locked || styles === undefined
    ? normalizeMetadataSource(current.styles_source)
    : normalizedSource
  const riskSource = locked || !risk
    ? normalizeMetadataSource(current.risk_source)
    : normalizedSource
  db.prepare(`
    UPDATE stickers SET tags_json = ?, intents_json = ?, styles_json = ?, description = ?,
      risk = ?, auto_send = ?, intents_source = ?, styles_source = ?, risk_source = ?,
      metadata_version = ?, updated_at = ? WHERE id = ?
  `).run(
    JSON.stringify(mergedTags),
    JSON.stringify(nextIntents),
    JSON.stringify(nextStyles),
    cleanText(description) || current.description || '',
    nextRisk,
    nextAutoSend ? 1 : 0,
    intentsSource,
    stylesSource,
    riskSource,
    STICKER_METADATA_VERSION,
    Date.now(),
    Number(id)
  )
  return getSticker(id, dbFile)
}

export function setStickerManualMetadata (id, { intents, risk, autoSend, unlock = false } = {}, dbFile) {
  const db = openStickerStore(dbFile)
  const current = db.prepare('SELECT * FROM stickers WHERE id = ?').get(Number(id))
  if (!current) return null
  if (unlock) {
    db.prepare('UPDATE stickers SET manual_locked = 0, updated_at = ? WHERE id = ?')
      .run(Date.now(), Number(id))
    return getSticker(id, dbFile)
  }
  const nextIntents = intents === undefined
    ? parseArray(current.intents_json)
    : normalizeTags(intents).filter(intent => CORE_STICKER_INTENT_SET.has(intent))
  const nextRisk = risk ? normalizeStickerRisk(risk) : normalizeStickerRisk(current.risk)
  if (risk && nextRisk !== risk) throw new Error(`不支持的风险等级：${risk}`)
  if (autoSend === true && nextRisk !== 'safe') throw new Error('非安全表情不能开启 AI 自动发送，请先将风险等级设为安全')
  const nextAutoSend = nextRisk !== 'safe'
    ? false
    : autoSend === undefined ? Boolean(current.auto_send) : Boolean(autoSend)
  db.prepare(`
    UPDATE stickers
    SET intents_json = ?, risk = ?, auto_send = ?,
      intents_source = ?, risk_source = ?, manual_locked = 1,
      metadata_version = ?, updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(nextIntents),
    nextRisk,
    nextAutoSend ? 1 : 0,
    intents === undefined ? normalizeMetadataSource(current.intents_source) : 'manual',
    risk ? 'manual' : normalizeMetadataSource(current.risk_source),
    STICKER_METADATA_VERSION,
    Date.now(),
    Number(id)
  )
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

export function findSticker ({
  emotion = '', kind = '', context = '', semanticScores, semanticWeight = 60, semanticMinSimilarity = 0.35
} = {}, dbFile, random = Math.random) {
  let candidates = openStickerStore(dbFile)
    .prepare('SELECT * FROM stickers WHERE enabled = 1 ORDER BY id DESC LIMIT 200')
    .all()
    .map(rowToSticker)
    .filter(sticker => !kind || sticker.kind === kind)
    .filter(isStickerAutoSendable)
  if (!candidates.length) return null
  const terms = normalizeTags(String(emotion).split(/[\s,，、/]+/))
    .filter(term => !isInternalStickerTag(term))
  if (!terms.length) return null
  const desiredCoreIntents = terms.filter(term => CORE_STICKER_INTENT_SET.has(term))
  if (desiredCoreIntents.length) {
    candidates = candidates.filter(sticker => desiredCoreIntents.some(intent => sticker.intents.includes(intent)))
  }
  const normalizedContext = normalizeSearchText(context)
  const scored = candidates.map(sticker => {
    const normalizedText = normalizeSearchText(sticker.text)
    const normalizedTags = sticker.tags
      .filter(value => !isInternalStickerTag(value))
      .map(normalizeSearchText)
    const normalizedIntents = sticker.intents.map(normalizeSearchText)
    const normalizedStyles = sticker.styles.map(normalizeSearchText)
    const normalizedDescription = normalizeSearchText(sticker.description)
    let relevance = 0
    for (const term of terms) {
      const normalizedTerm = normalizeSearchText(term)
      if (!normalizedTerm) continue
      const intentMatched = normalizedIntents.includes(normalizedTerm)
      if (intentMatched) relevance += 120
      // intents 通常由 text/tags 推导；同一个核心意图只计一次，避免重复证据长期霸榜。
      if (!intentMatched && normalizedText === normalizedTerm) relevance += 110
      if (!intentMatched && normalizedTags.includes(normalizedTerm)) relevance += 80
      if (normalizedStyles.includes(normalizedTerm)) relevance += 25
      if (normalizedTags.some(tag => tag !== normalizedTerm && tag.includes(normalizedTerm))) relevance += 20
      if (normalizedDescription.includes(normalizedTerm)) relevance += 8
    }
    const contextMatches = normalizedContext
      ? sticker.tags
          .filter(tag => !isInternalStickerTag(tag))
          .map(tag => ({ raw: tag, normalized: normalizeSearchText(tag) }))
          .filter(tag => tag.normalized.length >= 2 && normalizedContext.includes(tag.normalized))
      : []
    const contextBonus = Math.min(36, new Set(contextMatches.map(tag => tag.raw)).size * 12)
    const conflictingStyles = desiredCoreIntents.flatMap(intent =>
      sticker.styles.filter(style => INCOMPATIBLE_INTENT_STYLES[intent]?.has(style))
    )
    const styleVeto = conflictingStyles.some(style => !normalizedContext.includes(normalizeSearchText(style))) ? 45 : 0
    // 只在同一核心意图候选中做轻量多样化，避免高频表情长期霸榜或刚发完马上重复。
    const usagePenalty = Math.min(8, Math.log2(sticker.useCount + 1))
    const age = sticker.lastUsedAt ? Date.now() - Number(sticker.lastUsedAt) : Infinity
    const recentPenalty = age < 5 * 60000 ? 18 : age < 30 * 60000 ? 8 : age < 2 * 3600000 ? 2 : 0
    const similarity = Number(semanticScores?.get?.(sticker.id))
    const semanticBonus = Number.isFinite(similarity) && similarity >= semanticMinSimilarity
      ? (similarity - semanticMinSimilarity) * semanticWeight
      : 0
    return {
      sticker,
      relevance,
      score: relevance + contextBonus + semanticBonus - styleVeto - usagePenalty - recentPenalty + random() * 4
    }
  }).filter(item => item.relevance > 0)
    .sort((a, b) => b.score - a.score)
  return scored[0]?.sticker || null
}

/** Gemini Embedding 模糊推荐；失败时无缝回退原有标签/语境排序。 */
export async function findStickerWithEmbedding (
  args = {}, config = {}, dbFile, { random = Math.random, logger = console, embedTexts } = {}
) {
  const settings = normalizeStickerEmbeddingConfig(config)
  if (!settings.enable) return findSticker(args, dbFile, random)
  try {
    const stickers = listStickers({ enabled: true, limit: 200 }, dbFile).filter(isStickerAutoSendable)
    if (!stickers.length) return null
    const embed = embedTexts || ((texts, taskType) => embedTextsWithConfiguredGemini({
      config,
      channelId: settings.channelId,
      model: settings.model,
      dimensions: settings.dimensions,
      texts,
      taskType
    }))
    await syncStickerEmbeddings(stickers, settings, dbFile, embed, logger)
    const query = [args.emotion, args.context].filter(Boolean).join('\n')
    if (!query) return findSticker(args, dbFile, random)
    const [queryVector] = await embed([query], 'RETRIEVAL_QUERY')
    const stored = readStickerEmbeddings(dbFile, settings)
    const semanticScores = new Map(stickers.map(sticker => [
      sticker.id,
      cosineSimilarity(queryVector, stored.get(sticker.id)?.vector)
    ]))
    return findSticker({
      ...args,
      semanticScores,
      semanticWeight: settings.weight,
      semanticMinSimilarity: settings.minSimilarity
    }, dbFile, random)
  } catch (error) {
    logger?.warn?.(`[StickerEmbedding] 模糊推荐失败，回退标签排序: ${String(error?.message || error).slice(0, 200)}`)
    return findSticker(args, dbFile, random)
  }
}

function normalizeStickerEmbeddingConfig (config) {
  const value = config?.stickers?.embedding || {}
  const number = (input, fallback, min, max) => {
    const parsed = Number(input)
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
  }
  return {
    enable: value.enable === true,
    channelId: String(value.channelId || config?.memory?.embedding?.channelId || 'gemini').trim(),
    model: String(value.model || config?.memory?.embedding?.model || 'gemini-embedding-2').trim(),
    dimensions: Math.round(number(value.dimensions ?? config?.memory?.embedding?.dimensions, 768, 128, 3072)),
    weight: number(value.weight, 60, 0, 200),
    minSimilarity: number(value.minSimilarity, 0.35, -1, 1)
  }
}

async function syncStickerEmbeddings (stickers, settings, dbFile, embed, logger) {
  const db = openStickerStore(dbFile)
  const documents = stickers.map(sticker => {
    const content = buildStickerEmbeddingText(sticker)
    return {
      id: sticker.id,
      content,
      contentHash: createHash('sha256').update(content).digest('hex')
    }
  })
  const existing = readStickerEmbeddings(dbFile, settings)
  const pending = documents.filter(item => existing.get(item.id)?.contentHash !== item.contentHash)
  const upsert = db.prepare(`
    INSERT INTO sticker_embeddings (sticker_id, content_hash, model, dimensions, vector, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(sticker_id, model, dimensions) DO UPDATE SET
      content_hash = excluded.content_hash,
      vector = excluded.vector,
      updated_at = excluded.updated_at
  `)
  // Gemini Embedding 2 支持 Content 列表；尽量单批完成，兼容低 RPM 配额的渠道。
  for (let offset = 0; offset < pending.length; offset += 200) {
    const batch = pending.slice(offset, offset + 200)
    const vectors = await embed(batch.map(item => item.content), 'RETRIEVAL_DOCUMENT')
    if (vectors.length !== batch.length) throw new Error(`Embedding 数量不匹配: ${vectors.length}/${batch.length}`)
    for (let index = 0; index < batch.length; index++) {
      const values = Float32Array.from(vectors[index] || [])
      if (values.length !== settings.dimensions) {
        throw new Error(`Embedding 维度不匹配: ${values.length}/${settings.dimensions}`)
      }
      upsert.run(
        batch[index].id,
        batch[index].contentHash,
        settings.model,
        settings.dimensions,
        Buffer.from(values.buffer, values.byteOffset, values.byteLength),
        Date.now()
      )
    }
  }
  const liveIds = new Set(documents.map(item => item.id))
  const stale = db.prepare(`
    SELECT sticker_id AS stickerId FROM sticker_embeddings WHERE model = ? AND dimensions = ?
  `).all(settings.model, settings.dimensions).filter(row => !liveIds.has(Number(row.stickerId)))
  const remove = db.prepare('DELETE FROM sticker_embeddings WHERE sticker_id = ? AND model = ? AND dimensions = ?')
  for (const row of stale) remove.run(row.stickerId, settings.model, settings.dimensions)
  if (pending.length || stale.length) {
    logger?.info?.(`[StickerEmbedding] 新增/更新=${pending.length}, 清理=${stale.length}`)
  }
}

function readStickerEmbeddings (dbFile, settings) {
  const rows = openStickerStore(dbFile).prepare(`
    SELECT sticker_id AS stickerId, content_hash AS contentHash, vector
    FROM sticker_embeddings WHERE model = ? AND dimensions = ?
  `).all(settings.model, settings.dimensions)
  return new Map(rows.map(row => {
    const bytes = Buffer.from(row.vector)
    return [Number(row.stickerId), {
      contentHash: row.contentHash,
      vector: Array.from({ length: bytes.byteLength / 4 }, (_, index) => bytes.readFloatLE(index * 4))
    }]
  }))
}

function buildStickerEmbeddingText (sticker) {
  const tags = sticker.tags.filter(tag => !isInternalStickerTag(tag))
  return [
    `表情意图: ${sticker.intents.join('、') || '未标注'}`,
    `表情文字: ${sticker.text || '无'}`,
    `语义标签: ${tags.join('、') || '无'}`,
    `表达风格: ${sticker.styles.join('、') || '无'}`,
    `画面与场景: ${sticker.description || '无'}`
  ].join('\n')
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

/** 只向模型提供稳定的核心意图；详细标签留在发送层用于候选排序。 */
export function buildStickerDirectivePrompt (config, dbFile) {
  if (config?.stickers?.enable === false) return ''
  const stickers = listStickers({ enabled: true, limit: 100 }, dbFile).filter(isStickerAutoSendable)
  if (!stickers.length) return ''
  const availableIntents = new Set(stickers.flatMap(sticker => sticker.intents))
  const intents = CORE_STICKER_INTENTS.filter(intent => availableIntents.has(intent))
  if (!intents.length) return ''
  const choices = intents.join('、')
  return `[QQ表情规则]
你可以在最终回复正文中的任意自然位置添加一次 [sticker:标签]，发送层会将其替换成真实 QQ 表情，用户看不到该标记。
大多数回复不要使用表情；仅在表情明显能增强当前语气时使用，不要连续或解释标记，每次最多一个。
纯事实说明、工具执行结果、报错提示以及严肃或敏感话题通常不要添加表情。
只能从以下核心意图中原样选择：${choices}。不要创造标签。发送层会根据相关性、风格和风险选择具体表情；正文仍保持当前角色的自然说话方式。`
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
  const metadata = inferStickerMetadata({
    kind: row.kind,
    text: row.text,
    tags: parseArray(row.tags_json),
    intents: parseArray(row.intents_json),
    styles: parseArray(row.styles_json),
    description: row.description,
    risk: row.risk,
    inferIntents: false,
    inferRisk: normalizeMetadataSource(row.risk_source) === 'inferred' && !row.manual_locked
  })
  return {
    id: Number(row.id),
    kind: row.kind,
    payload: parseObject(row.payload_json),
    text: row.text || '',
    tags: parseArray(row.tags_json),
    intents: metadata.intents,
    styles: metadata.styles,
    description: row.description || '',
    risk: metadata.risk,
    autoSend: metadata.risk === 'safe' && Boolean(row.auto_send ?? 1),
    intentsSource: normalizeMetadataSource(row.intents_source),
    stylesSource: normalizeMetadataSource(row.styles_source),
    riskSource: normalizeMetadataSource(row.risk_source),
    manualLocked: Boolean(row.manual_locked),
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

function inferStickerMetadata ({
  kind = '',
  text = '',
  tags = [],
  intents = [],
  styles = [],
  description = '',
  risk = '',
  inferIntents = true,
  inferRisk = true
} = {}) {
  const styleAndRiskValues = normalizeTags([text, ...tags, description])
  const intentAliasValues = normalizeTags([
    text,
    ...(['image', 'marketface'].includes(kind) ? [] : tags)
  ]).map(normalizeSearchText)
  const matchesIntentAlias = alias => {
    const normalizedAlias = normalizeSearchText(alias)
    return intentAliasValues.some(value => value === normalizedAlias || value.includes(normalizedAlias))
  }
  const explicitTagIntents = tags
    .map(tag => CORE_STICKER_INTENTS.find(intent => normalizeSearchText(intent) === normalizeSearchText(tag)))
    .filter(Boolean)
  const inferredIntents = normalizeTags([
    ...intents.filter(intent => CORE_STICKER_INTENT_SET.has(intent)),
    ...(inferIntents ? explicitTagIntents : []),
    ...(inferIntents
      ? CORE_STICKER_INTENTS.filter(intent => STICKER_INTENT_ALIASES[intent].some(matchesIntentAlias))
      : [])
  ])
  const normalizedStyleValues = styleAndRiskValues.map(normalizeSearchText)
  const matchesStyleAlias = alias => {
    const normalizedAlias = normalizeSearchText(alias)
    return normalizedStyleValues.some(value => value === normalizedAlias || value.includes(normalizedAlias))
  }
  const inferredStyles = normalizeTags([
    ...styles,
    ...Object.entries(STICKER_STYLE_ALIASES)
      .filter(([_style, aliases]) => aliases.some(matchesStyleAlias))
      .map(([style]) => style)
  ])
  const combined = styleAndRiskValues.join(' ')
  const normalizedRisk = inferRisk && HIGH_RISK_STICKER_RE.test(combined) ? 'high' : normalizeStickerRisk(risk)
  return { intents: inferredIntents, styles: inferredStyles, risk: normalizedRisk }
}

function normalizeStickerRisk (risk) {
  return ['safe', 'medium', 'high'].includes(String(risk)) ? String(risk) : 'safe'
}

function normalizeMetadataSource (source) {
  return ['manual', 'classifier', 'inferred', 'legacy'].includes(String(source)) ? String(source) : 'inferred'
}

function normalizeSearchText (value) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function isInternalStickerTag (value) {
  return INTERNAL_STICKER_TAGS.has(normalizeSearchText(value))
}

function isStickerAutoSendable (sticker) {
  if (!sticker?.autoSend || sticker.risk !== 'safe') return false
  return sticker.kind !== 'superface' || Boolean(sticker.payload?.stickerId)
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
