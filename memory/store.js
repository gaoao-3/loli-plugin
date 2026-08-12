import fs from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { LEGACY_PROACTIVE_PLACEHOLDER } from './internal.js'

const DB_FILE = 'memory.sqlite'

let db = null
let dbPath = ''

function ensureDir (dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

export function today () {
  const d = new Date()
  d.setHours(d.getHours() + 8)
  return d.toISOString().slice(0, 10)
}

export function openMemoryStore (baseDir) {
  if (!baseDir) throw new Error('memory baseDir is required')
  const nextPath = path.join(baseDir, DB_FILE)
  if (db && dbPath === nextPath) return db
  if (db) db.close()

  ensureDir(baseDir)
  db = new DatabaseSync(nextPath)
  dbPath = nextPath
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      target_id TEXT NOT NULL,
      group_id TEXT,
      user_id TEXT,
      nickname TEXT,
      display_name TEXT,
      card TEXT,
      account_nickname TEXT,
      sender_role TEXT,
      sender_title TEXT,
      is_master INTEGER NOT NULL DEFAULT 0,
      appellation TEXT,
      message_key TEXT,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      date TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_target_date
      ON messages (scope, target_id, date, id);

    CREATE TABLE IF NOT EXISTS scheduler_runs (
      task TEXT PRIMARY KEY,
      started_at INTEGER,
      finished_at INTEGER,
      status TEXT,
      processed INTEGER NOT NULL DEFAULT 0,
      succeeded INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS group_learning_state (
      group_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 0,
      profile_json TEXT NOT NULL DEFAULT '[]',
      last_message_id INTEGER NOT NULL DEFAULT 0,
      last_review_at INTEGER,
      status TEXT NOT NULL DEFAULT 'idle',
      error TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_learning_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      operations_json TEXT,
      reason TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(group_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_group_learning_versions
      ON group_learning_versions (group_id, version DESC);

    CREATE TABLE IF NOT EXISTS group_member_memory_state (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      styles_json TEXT NOT NULL DEFAULT '[]',
      memories_json TEXT NOT NULL DEFAULT '[]',
      last_message_id INTEGER NOT NULL DEFAULT 0,
      last_review_at INTEGER,
      status TEXT NOT NULL DEFAULT 'idle',
      error TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS group_member_memory_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      operations_json TEXT,
      reason TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(group_id, user_id, version)
    );

    CREATE INDEX IF NOT EXISTS idx_group_member_memory_versions
      ON group_member_memory_versions (group_id, user_id, version DESC);

    CREATE TABLE IF NOT EXISTS member_memory_embeddings (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      memory_key TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(group_id, user_id, memory_key, model, dimensions)
    );

    CREATE INDEX IF NOT EXISTS idx_member_memory_embeddings_owner
      ON member_memory_embeddings (group_id, user_id, model, dimensions);

    CREATE TABLE IF NOT EXISTS group_identities (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT,
      card TEXT,
      nickname TEXT,
      sender_role TEXT,
      sender_title TEXT,
      is_master INTEGER NOT NULL DEFAULT 0,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      seen_count INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(group_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_group_identities_master
      ON group_identities (group_id, is_master);

  `)

  // 旧主动回复把内部控制提示误存成了用户消息；仅精确删除该固定占位文本。
  db.prepare(`
    DELETE FROM messages
    WHERE role = 'user' AND text = ?
  `).run(LEGACY_PROACTIVE_PLACEHOLDER)
  ensureMessageIdentityColumns(db)
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_source
      ON messages (scope, target_id, message_key)
      WHERE message_key IS NOT NULL;
  `)
  return db
}

export function closeMemoryStore () {
  if (db) db.close()
  db = null
  dbPath = ''
}

export function addMessage (baseDir, message) {
  const store = openMemoryStore(baseDir)
  const stmt = store.prepare(`
    INSERT OR IGNORE INTO messages (
      scope, target_id, group_id, user_id, nickname, display_name, card,
      account_nickname, sender_role, sender_title, is_master, appellation, message_key,
      role, text, created_at, date
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const result = stmt.run(
    message.scope,
    message.targetId,
    message.groupId || null,
    message.userId || null,
    message.nickname || null,
    message.displayName || message.nickname || null,
    message.card || null,
    message.accountNickname || null,
    message.senderRole || null,
    message.senderTitle || null,
    message.isMaster ? 1 : 0,
    message.appellation || null,
    message.messageKey || null,
    message.role,
    message.text,
    message.createdAt || Date.now(),
    message.date || today()
  )
  return Number(result.changes)
}

export function updateSchedulerRun (baseDir, task, values = {}) {
  const previous = getSchedulerRun(baseDir, task) || {}
  const next = { ...previous, ...values }
  openMemoryStore(baseDir).prepare(`
    INSERT INTO scheduler_runs (task, started_at, finished_at, status, processed, succeeded, failed, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task) DO UPDATE SET
      started_at = excluded.started_at,
      finished_at = excluded.finished_at,
      status = excluded.status,
      processed = excluded.processed,
      succeeded = excluded.succeeded,
      failed = excluded.failed,
      error = excluded.error
  `).run(task, next.startedAt || null, next.finishedAt || null, next.status || null,
    next.processed || 0, next.succeeded || 0, next.failed || 0, next.error || null)
}

export function getSchedulerRun (baseDir, task) {
  return openMemoryStore(baseDir).prepare(`
    SELECT task, started_at AS startedAt, finished_at AS finishedAt, status,
      processed, succeeded, failed, error
    FROM scheduler_runs WHERE task = ?
  `).get(task)
}

export function getSchedulerRuns (baseDir) {
  return openMemoryStore(baseDir).prepare(`
    SELECT task, started_at AS startedAt, finished_at AS finishedAt, status,
      processed, succeeded, failed, error
    FROM scheduler_runs ORDER BY task
  `).all()
}

export function pruneOldMessages (baseDir, maxDays) {
  const days = Number(maxDays)
  if (!Number.isFinite(days) || days < 1) return 0
  const cutoff = new Date()
  cutoff.setHours(cutoff.getHours() + 8 - days * 24)
  const cutoffDate = cutoff.toISOString().slice(0, 10)
  return Number(openMemoryStore(baseDir).prepare('DELETE FROM messages WHERE date < ?').run(cutoffDate).changes)
}

/**
 * 删除已经被现行学习链路消费的原始消息。
 *
 * - 非 group 记录属于已停用摘要/画像管线的重复副本，可直接移除。
 * - 群友消息只有在群风格游标和该 QQ 用户印象游标都越过它后才删除。
 * - 机器人消息只参与群风格，群风格游标越过后即可删除。
 * - running 状态不清理，避免后台审查仍在读取时抢先删证据。
 */
export function pruneProcessedMessages (baseDir) {
  const store = openMemoryStore(baseDir)
  store.exec('BEGIN')
  try {
    const obsolete = Number(store.prepare(`
      DELETE FROM messages
      WHERE scope <> 'group'
    `).run().changes)
    const consumed = Number(store.prepare(`
      DELETE FROM messages AS message
      WHERE message.scope = 'group'
        AND EXISTS (
          SELECT 1
          FROM group_learning_state AS group_state
          WHERE group_state.group_id = message.target_id
            AND group_state.status <> 'running'
            AND group_state.last_message_id >= message.id
        )
        AND (
          message.role = 'assistant'
          OR (
            message.role = 'user'
            AND EXISTS (
              SELECT 1
              FROM group_member_memory_state AS member_state
              WHERE member_state.group_id = message.target_id
                AND member_state.user_id = message.user_id
                AND member_state.status <> 'running'
                AND member_state.last_message_id >= message.id
            )
          )
        )
    `).run().changes)
    store.exec('COMMIT')
    return { obsolete, consumed, total: obsolete + consumed }
  } catch (err) {
    store.exec('ROLLBACK')
    throw err
  }
}

export function upsertGroupIdentity (baseDir, { groupId, identity, observedAt = Date.now() }) {
  const gid = String(groupId || '')
  const userId = String(identity?.userId || '')
  if (!gid || !userId) return null
  const store = openMemoryStore(baseDir)
  const previous = getGroupIdentity(baseDir, gid, userId)
  const displayName = normalizeIdentityText(identity.displayName)
  const card = normalizeIdentityText(identity.card)
  const nickname = normalizeIdentityText(identity.nickname)
  const senderRole = normalizeIdentityText(identity.role || identity.senderRole, 24)
  const senderTitle = normalizeIdentityText(identity.title || identity.senderTitle)
  const aliases = mergeAliases(previous?.aliases || [], [displayName, card, nickname], observedAt)
  const firstSeenAt = previous?.firstSeenAt || observedAt
  const seenCount = (previous?.seenCount || 0) + 1
  store.prepare(`
    INSERT INTO group_identities (
      group_id, user_id, display_name, card, nickname, sender_role, sender_title,
      is_master, aliases_json, first_seen_at, last_seen_at, seen_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_id, user_id) DO UPDATE SET
      display_name = excluded.display_name,
      card = excluded.card,
      nickname = excluded.nickname,
      sender_role = excluded.sender_role,
      sender_title = excluded.sender_title,
      is_master = excluded.is_master,
      aliases_json = excluded.aliases_json,
      last_seen_at = excluded.last_seen_at,
      seen_count = excluded.seen_count
  `).run(
    gid, userId, displayName || null, card || null, nickname || null,
    senderRole || null, senderTitle || null,
    identity.isMaster ? 1 : 0, JSON.stringify(aliases), firstSeenAt, observedAt, seenCount
  )
  return getGroupIdentity(baseDir, gid, userId)
}

export function getGroupIdentity (baseDir, groupId, userId) {
  const row = openMemoryStore(baseDir).prepare(`
    SELECT group_id AS groupId, user_id AS userId, display_name AS displayName,
      card, nickname, sender_role AS senderRole, sender_title AS senderTitle,
      is_master AS isMaster, aliases_json AS aliasesJson,
      first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, seen_count AS seenCount
    FROM group_identities WHERE group_id = ? AND user_id = ?
  `).get(String(groupId), String(userId))
  return row ? { ...row, isMaster: Boolean(row.isMaster), aliases: parseJsonArray(row.aliasesJson) } : null
}

export function listGroupIdentities (baseDir, groupId) {
  return openMemoryStore(baseDir).prepare(`
    SELECT group_id AS groupId, user_id AS userId, display_name AS displayName,
      card, nickname, sender_role AS senderRole, sender_title AS senderTitle,
      is_master AS isMaster, aliases_json AS aliasesJson,
      first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt, seen_count AS seenCount
    FROM group_identities WHERE group_id = ?
    ORDER BY last_seen_at DESC
  `).all(String(groupId)).map(row => ({
    ...row,
    isMaster: Boolean(row.isMaster),
    aliases: parseJsonArray(row.aliasesJson)
  }))
}

export function getGroupLearningMessages (baseDir, groupId, {
  afterId = 0,
  since = 0,
  limit = 240
} = {}) {
  return openMemoryStore(baseDir).prepare(`
    SELECT id, user_id AS userId, COALESCE(display_name, nickname, user_id) AS displayName,
      role, text, created_at AS createdAt
    FROM messages
    WHERE scope = 'group' AND target_id = ? AND role IN ('user', 'assistant')
      AND id > ? AND created_at >= ?
    ORDER BY id ASC
    LIMIT ?
  `).all(String(groupId), Number(afterId) || 0, Number(since) || 0, Math.max(1, Number(limit) || 240))
}

export function getGroupLearningState (baseDir, groupId) {
  const row = openMemoryStore(baseDir).prepare(`
    SELECT group_id AS groupId, version, profile_json AS profileJson,
      last_message_id AS lastMessageId,
      last_review_at AS lastReviewAt, status, error, updated_at AS updatedAt
    FROM group_learning_state WHERE group_id = ?
  `).get(String(groupId))
  if (!row) {
    return {
      groupId: String(groupId),
      version: 0,
      profile: [],
      lastMessageId: 0,
      lastReviewAt: null,
      status: 'idle',
      error: null,
      updatedAt: null
    }
  }
  return {
    ...row,
    profile: parseJsonArray(row.profileJson)
  }
}

export function setGroupLearningReviewStatus (baseDir, groupId, status, error = null) {
  const current = getGroupLearningState(baseDir, groupId)
  openMemoryStore(baseDir).prepare(`
    INSERT INTO group_learning_state (
      group_id, version, profile_json, last_message_id,
      last_review_at, status, error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_id) DO UPDATE SET
      status = excluded.status,
      error = excluded.error,
      updated_at = excluded.updated_at
  `).run(
    String(groupId), current.version, JSON.stringify(current.profile),
    current.lastMessageId, current.lastReviewAt, status, error, Date.now()
  )
}

export function saveGroupLearningReview (baseDir, {
  groupId,
  profile = [],
  lastMessageId = 0,
  operations = {},
  reason = 'background_review',
  changed = true
}) {
  const store = openMemoryStore(baseDir)
  const current = getGroupLearningState(baseDir, groupId)
  const version = changed ? current.version + 1 : current.version
  const snapshot = { profile }
  const now = Date.now()
  store.exec('BEGIN')
  try {
    store.prepare(`
      INSERT INTO group_learning_state (
        group_id, version, profile_json, last_message_id,
        last_review_at, status, error, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'idle', NULL, ?)
      ON CONFLICT(group_id) DO UPDATE SET
        version = excluded.version,
        profile_json = excluded.profile_json,
        last_message_id = excluded.last_message_id,
        last_review_at = excluded.last_review_at,
        status = 'idle',
        error = NULL,
        updated_at = excluded.updated_at
    `).run(
      String(groupId), version, JSON.stringify(profile),
      Number(lastMessageId) || current.lastMessageId, now, now
    )
    if (changed) {
      store.prepare(`
        INSERT INTO group_learning_versions (
          group_id, version, snapshot_json, operations_json, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(String(groupId), version, JSON.stringify(snapshot), JSON.stringify(operations), reason, now)
    }
    store.exec('COMMIT')
    return { version, changed }
  } catch (err) {
    store.exec('ROLLBACK')
    throw err
  }
}

export function listGroupLearningVersions (baseDir, groupId, limit = 10) {
  return openMemoryStore(baseDir).prepare(`
    SELECT version, reason, created_at AS createdAt
    FROM group_learning_versions
    WHERE group_id = ?
    ORDER BY version DESC
    LIMIT ?
  `).all(String(groupId), Math.max(1, Number(limit) || 10))
}

export function rollbackGroupLearning (baseDir, groupId, targetVersion) {
  const store = openMemoryStore(baseDir)
  const row = store.prepare(`
    SELECT snapshot_json AS snapshotJson
    FROM group_learning_versions
    WHERE group_id = ? AND version = ?
  `).get(String(groupId), Number(targetVersion))
  if (!row) return null
  const snapshot = JSON.parse(row.snapshotJson)
  return saveGroupLearningReview(baseDir, {
    groupId,
    profile: Array.isArray(snapshot.profile) ? snapshot.profile : [],
    lastMessageId: getGroupLearningState(baseDir, groupId).lastMessageId,
    operations: { rollbackFrom: targetVersion },
    reason: `rollback:${targetVersion}`,
    changed: true
  })
}

export function getGroupMemberMessages (baseDir, groupId, userId, {
  afterId = 0,
  since = 0,
  limit = 80
} = {}) {
  return openMemoryStore(baseDir).prepare(`
    SELECT id, user_id AS userId, COALESCE(display_name, nickname, user_id) AS displayName,
      text, created_at AS createdAt
    FROM messages
    WHERE scope = 'group' AND target_id = ? AND user_id = ? AND role = 'user'
      AND id > ? AND created_at >= ?
    ORDER BY id ASC
    LIMIT ?
  `).all(
    String(groupId),
    String(userId),
    Number(afterId) || 0,
    Number(since) || 0,
    Math.max(1, Number(limit) || 80)
  )
}

export function getGroupMemberMemoryState (baseDir, groupId, userId) {
  const row = openMemoryStore(baseDir).prepare(`
    SELECT group_id AS groupId, user_id AS userId, version,
      styles_json AS stylesJson, memories_json AS memoriesJson,
      last_message_id AS lastMessageId, last_review_at AS lastReviewAt,
      status, error, updated_at AS updatedAt
    FROM group_member_memory_state
    WHERE group_id = ? AND user_id = ?
  `).get(String(groupId), String(userId))
  if (!row) {
    return {
      groupId: String(groupId),
      userId: String(userId),
      version: 0,
      styles: [],
      memories: [],
      lastMessageId: 0,
      lastReviewAt: null,
      status: 'idle',
      error: null,
      updatedAt: null
    }
  }
  return {
    ...row,
    styles: parseJsonArray(row.stylesJson),
    memories: parseJsonArray(row.memoriesJson)
  }
}

export function setGroupMemberMemoryStatus (baseDir, groupId, userId, status, error = null) {
  const current = getGroupMemberMemoryState(baseDir, groupId, userId)
  openMemoryStore(baseDir).prepare(`
    INSERT INTO group_member_memory_state (
      group_id, user_id, version, styles_json, memories_json, last_message_id,
      last_review_at, status, error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_id, user_id) DO UPDATE SET
      status = excluded.status,
      error = excluded.error,
      updated_at = excluded.updated_at
  `).run(
    String(groupId), String(userId), current.version,
    JSON.stringify(current.styles), JSON.stringify(current.memories),
    current.lastMessageId, current.lastReviewAt, status, error, Date.now()
  )
}

export function saveGroupMemberMemoryReview (baseDir, {
  groupId,
  userId,
  styles = [],
  memories = [],
  lastMessageId = 0,
  operations = {},
  reason = 'incremental_review',
  changed = true
}) {
  const store = openMemoryStore(baseDir)
  const current = getGroupMemberMemoryState(baseDir, groupId, userId)
  const version = changed ? current.version + 1 : current.version
  const snapshot = { styles, memories }
  const now = Date.now()
  store.exec('BEGIN')
  try {
    store.prepare(`
      INSERT INTO group_member_memory_state (
        group_id, user_id, version, styles_json, memories_json, last_message_id,
        last_review_at, status, error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', NULL, ?)
      ON CONFLICT(group_id, user_id) DO UPDATE SET
        version = excluded.version,
        styles_json = excluded.styles_json,
        memories_json = excluded.memories_json,
        last_message_id = excluded.last_message_id,
        last_review_at = excluded.last_review_at,
        status = 'idle',
        error = NULL,
        updated_at = excluded.updated_at
    `).run(
      String(groupId), String(userId), version,
      JSON.stringify(styles), JSON.stringify(memories),
      Number(lastMessageId) || current.lastMessageId, now, now
    )
    if (changed) {
      store.prepare(`
        INSERT INTO group_member_memory_versions (
          group_id, user_id, version, snapshot_json, operations_json, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        String(groupId), String(userId), version,
        JSON.stringify(snapshot), JSON.stringify(operations), reason, now
      )
    }
    store.exec('COMMIT')
    return { version, changed }
  } catch (err) {
    store.exec('ROLLBACK')
    throw err
  }
}

export function listGroupMemberMemoryVersions (baseDir, groupId, userId, limit = 10) {
  return openMemoryStore(baseDir).prepare(`
    SELECT version, reason, created_at AS createdAt
    FROM group_member_memory_versions
    WHERE group_id = ? AND user_id = ?
    ORDER BY version DESC
    LIMIT ?
  `).all(String(groupId), String(userId), Math.max(1, Number(limit) || 10))
}

export function listMemberMemoryEmbeddings (baseDir, groupId, userId, model, dimensions) {
  const rows = openMemoryStore(baseDir).prepare(`
    SELECT memory_key AS memoryKey, content_hash AS contentHash, vector
    FROM member_memory_embeddings
    WHERE group_id = ? AND user_id = ? AND model = ? AND dimensions = ?
  `).all(String(groupId), String(userId), String(model), Number(dimensions))
  return new Map(rows.map(row => {
    const bytes = Buffer.from(row.vector)
    return [row.memoryKey, {
      contentHash: row.contentHash,
      vector: Array.from({ length: bytes.byteLength / 4 }, (_, index) => bytes.readFloatLE(index * 4))
    }]
  }))
}

export function upsertMemberMemoryEmbedding (baseDir, {
  groupId, userId, memoryKey, contentHash, model, dimensions, vector
}) {
  const values = Float32Array.from(vector || [])
  if (values.length !== Number(dimensions)) throw new Error(`Embedding 维度不匹配: ${values.length}/${dimensions}`)
  const blob = Buffer.from(values.buffer, values.byteOffset, values.byteLength)
  openMemoryStore(baseDir).prepare(`
    INSERT INTO member_memory_embeddings (
      group_id, user_id, memory_key, content_hash, model, dimensions, vector, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_id, user_id, memory_key, model, dimensions) DO UPDATE SET
      content_hash = excluded.content_hash,
      vector = excluded.vector,
      updated_at = excluded.updated_at
  `).run(String(groupId), String(userId), String(memoryKey), String(contentHash), String(model), Number(dimensions), blob, Date.now())
}

export function deleteStaleMemberMemoryEmbeddings (baseDir, groupId, userId, liveKeys, model, dimensions) {
  const store = openMemoryStore(baseDir)
  const keep = new Set((liveKeys || []).map(String))
  const rows = store.prepare(`
    SELECT memory_key AS memoryKey FROM member_memory_embeddings
    WHERE group_id = ? AND user_id = ? AND model = ? AND dimensions = ?
  `).all(String(groupId), String(userId), String(model), Number(dimensions))
  const remove = rows.map(row => row.memoryKey).filter(key => !keep.has(key))
  const statement = store.prepare(`
    DELETE FROM member_memory_embeddings
    WHERE group_id = ? AND user_id = ? AND memory_key = ? AND model = ? AND dimensions = ?
  `)
  for (const key of remove) statement.run(String(groupId), String(userId), key, String(model), Number(dimensions))
  return remove.length
}

export function rollbackGroupMemberMemory (baseDir, groupId, userId, targetVersion) {
  const store = openMemoryStore(baseDir)
  const row = store.prepare(`
    SELECT snapshot_json AS snapshotJson
    FROM group_member_memory_versions
    WHERE group_id = ? AND user_id = ? AND version = ?
  `).get(String(groupId), String(userId), Number(targetVersion))
  if (!row) return null
  const snapshot = JSON.parse(row.snapshotJson)
  return saveGroupMemberMemoryReview(baseDir, {
    groupId,
    userId,
    styles: Array.isArray(snapshot.styles) ? snapshot.styles : [],
    memories: Array.isArray(snapshot.memories) ? snapshot.memories : [],
    lastMessageId: getGroupMemberMemoryState(baseDir, groupId, userId).lastMessageId,
    operations: { rollbackFrom: targetVersion },
    reason: `rollback:${targetVersion}`,
    changed: true
  })
}

export function getStats (baseDir) {
  const store = openMemoryStore(baseDir)
  const messages = store.prepare('SELECT COUNT(*) AS count FROM messages').get().count
  const identities = store.prepare('SELECT COUNT(*) AS count FROM group_identities').get().count
  const learnedGroups = store.prepare('SELECT COUNT(*) AS count FROM group_learning_state WHERE version > 0').get().count
  const learningVersions = store.prepare('SELECT COUNT(*) AS count FROM group_learning_versions').get().count
  const learnedMembers = store.prepare('SELECT COUNT(*) AS count FROM group_member_memory_state WHERE version > 0').get().count
  const memberMemoryVersions = store.prepare('SELECT COUNT(*) AS count FROM group_member_memory_versions').get().count
  const embeddings = store.prepare('SELECT COUNT(*) AS count FROM member_memory_embeddings').get().count
  const runs = getSchedulerRuns(baseDir)
  return {
    enabled: true,
    messages,
    identities,
    learnedGroups,
    learningVersions,
    learnedMembers,
    memberMemoryVersions,
    embeddings,
    runs,
    dbPath
  }
}

function parseJsonArray (value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function mergeAliases (current, names, observedAt) {
  const aliases = Array.isArray(current) ? current.map(item => ({ ...item })) : []
  for (const rawName of names) {
    const name = normalizeIdentityText(rawName)
    if (!name || name === '-') continue
    const found = aliases.find(item => normalizeAlias(item.name) === normalizeAlias(name))
    if (found) {
      found.name = name
      found.lastSeenAt = observedAt
      found.count = (Number(found.count) || 0) + 1
    } else {
      aliases.push({ name, firstSeenAt: observedAt, lastSeenAt: observedAt, count: 1 })
    }
  }
  return aliases
    .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0))
    .slice(0, 20)
}

function normalizeAlias (value) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN')
}

function normalizeIdentityText (value, maxLength = 80) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function ensureMessageIdentityColumns (store) {
  const existing = new Set(store.prepare('PRAGMA table_info(messages)').all().map(row => row.name))
  const columns = {
    display_name: 'TEXT',
    card: 'TEXT',
    account_nickname: 'TEXT',
    sender_role: 'TEXT',
    sender_title: 'TEXT',
    is_master: 'INTEGER NOT NULL DEFAULT 0',
    appellation: 'TEXT',
    message_key: 'TEXT'
  }
  for (const [name, definition] of Object.entries(columns)) {
    if (!existing.has(name)) store.exec(`ALTER TABLE messages ADD COLUMN ${name} ${definition}`)
  }
  store.exec(`
    UPDATE messages
    SET display_name = COALESCE(display_name, nickname)
    WHERE display_name IS NULL
  `)
}
