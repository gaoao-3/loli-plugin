import fs from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'

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

    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      target_id TEXT NOT NULL,
      date TEXT NOT NULL,
      summary TEXT NOT NULL,
      hash TEXT,
      updated_at INTEGER NOT NULL,
      UNIQUE(scope, target_id, date)
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      target_id TEXT NOT NULL,
      profile TEXT NOT NULL,
      hash TEXT,
      updated_at INTEGER NOT NULL,
      UNIQUE(scope, target_id)
    );

    CREATE TABLE IF NOT EXISTS memory_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      target_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      title TEXT,
      text TEXT NOT NULL,
      hash TEXT,
      updated_at INTEGER NOT NULL,
      UNIQUE(scope, target_id, source_type, source_id)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_chunks_target
      ON memory_chunks (scope, target_id, source_type);

    CREATE TABLE IF NOT EXISTS memory_embeddings (
      chunk_id INTEGER PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      hash TEXT,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(chunk_id) REFERENCES memory_chunks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model
      ON memory_embeddings (provider, model);

    CREATE TABLE IF NOT EXISTS processing_state (
      scope TEXT NOT NULL,
      target_id TEXT NOT NULL,
      date TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(scope, target_id, date)
    );

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
      memory_json TEXT NOT NULL DEFAULT '[]',
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

    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  ensureMessageIdentityColumns(db)
  db.exec('DROP TABLE IF EXISTS archived_summaries')
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_source
      ON messages (scope, target_id, message_key)
      WHERE message_key IS NOT NULL;
  `)
  migrateLegacyUserMessages(db)
  backfillChunks(db)
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

export function getTargetIdentity (baseDir, scope, targetId) {
  const row = openMemoryStore(baseDir).prepare(`
    SELECT user_id AS userId, nickname, display_name AS displayName, card,
      account_nickname AS accountNickname, sender_role AS senderRole,
      sender_title AS senderTitle,
      is_master AS isMaster, appellation
    FROM messages
    WHERE scope = ? AND target_id = ? AND role = 'user' AND user_id IS NOT NULL
    ORDER BY id DESC
    LIMIT 1
  `).get(scope, targetId)
  return row ? { ...row, isMaster: Boolean(row.isMaster) } : null
}

export function getMessagesForDate (baseDir, scope, targetId, date = today()) {
  const store = openMemoryStore(baseDir)
  return store.prepare(`
    SELECT * FROM messages
    WHERE scope = ? AND target_id = ? AND date = ?
    ORDER BY id ASC
  `).all(scope, targetId, date)
}

export function listMessageTargets (baseDir, date = today()) {
  const store = openMemoryStore(baseDir)
  return store.prepare(`
    SELECT scope, target_id AS targetId, COUNT(*) AS count
    FROM messages
    WHERE date = ?
    GROUP BY scope, target_id
    ORDER BY scope, target_id
  `).all(date)
}

export function listMessageDates (baseDir) {
  const store = openMemoryStore(baseDir)
  return store.prepare('SELECT DISTINCT date FROM messages ORDER BY date ASC').all().map(row => row.date)
}

export function getProcessingState (baseDir, scope, targetId, date) {
  return openMemoryStore(baseDir).prepare(`
    SELECT input_hash AS inputHash, status, error, updated_at AS updatedAt
    FROM processing_state WHERE scope = ? AND target_id = ? AND date = ?
  `).get(scope, targetId, date)
}

export function upsertProcessingState (baseDir, { scope, targetId, date, inputHash, status, error = null }) {
  openMemoryStore(baseDir).prepare(`
    INSERT INTO processing_state (scope, target_id, date, input_hash, status, error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, target_id, date) DO UPDATE SET
      input_hash = excluded.input_hash,
      status = excluded.status,
      error = excluded.error,
      updated_at = excluded.updated_at
  `).run(scope, targetId, date, inputHash, status, error, Date.now())
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

export function upsertSummary (baseDir, { scope, targetId, date = today(), summary, hash }) {
  const store = openMemoryStore(baseDir)
  store.prepare(`
    INSERT INTO summaries (scope, target_id, date, summary, hash, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, target_id, date) DO UPDATE SET
      summary = excluded.summary,
      hash = excluded.hash,
      updated_at = excluded.updated_at
  `).run(scope, targetId, date, summary, hash || null, Date.now())
  upsertChunk(baseDir, {
    scope,
    targetId,
    sourceType: 'summary',
    sourceId: date,
    title: `${scope}:${targetId} ${date} 摘要`,
    text: summary,
    hash
  })
}

export function getSummary (baseDir, scope, targetId, date = today()) {
  const store = openMemoryStore(baseDir)
  return store.prepare(`
    SELECT summary, hash FROM summaries
    WHERE scope = ? AND target_id = ? AND date = ?
  `).get(scope, targetId, date)
}

export function getRecentSummaries (baseDir, scope, targetId, limit = 3) {
  const store = openMemoryStore(baseDir)
  return store.prepare(`
    SELECT date, summary FROM summaries
    WHERE scope = ? AND target_id = ?
    ORDER BY date DESC
    LIMIT ?
  `).all(scope, targetId, limit)
}

export function upsertProfile (baseDir, { scope, targetId, profile, hash }) {
  const store = openMemoryStore(baseDir)
  store.prepare(`
    INSERT INTO profiles (scope, target_id, profile, hash, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(scope, target_id) DO UPDATE SET
      profile = excluded.profile,
      hash = excluded.hash,
      updated_at = excluded.updated_at
  `).run(scope, targetId, profile, hash || null, Date.now())
  upsertChunk(baseDir, {
    scope,
    targetId,
    sourceType: 'profile',
    sourceId: 'profile',
    title: `${scope}:${targetId} 长期画像`,
    text: profile,
    hash
  })
}

export function getProfile (baseDir, scope, targetId) {
  const store = openMemoryStore(baseDir)
  return store.prepare(`
    SELECT profile, hash FROM profiles
    WHERE scope = ? AND target_id = ?
  `).get(scope, targetId)
}

export function listSummaryTargets (baseDir) {
  const store = openMemoryStore(baseDir)
  return store.prepare(`
    SELECT scope, target_id AS targetId, COUNT(*) AS count
    FROM summaries
    GROUP BY scope, target_id
    ORDER BY scope, target_id
  `).all()
}

export function upsertChunk (baseDir, { scope, targetId, sourceType, sourceId, title = '', text, hash }) {
  if (!text) return null
  const store = openMemoryStore(baseDir)
  const result = store.prepare(`
    INSERT INTO memory_chunks (scope, target_id, source_type, source_id, title, text, hash, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, target_id, source_type, source_id) DO UPDATE SET
      title = excluded.title,
      text = excluded.text,
      hash = excluded.hash,
      updated_at = excluded.updated_at
  `).run(scope, targetId, sourceType, sourceId, title || null, text, hash || simpleHash(text), Date.now())

  if (result.lastInsertRowid) return Number(result.lastInsertRowid)
  return store.prepare(`
    SELECT id FROM memory_chunks
    WHERE scope = ? AND target_id = ? AND source_type = ? AND source_id = ?
  `).get(scope, targetId, sourceType, sourceId)?.id || null
}

export function listChunksMissingEmbedding (baseDir, { provider, model, dimensions, limit = 8 }) {
  const store = openMemoryStore(baseDir)
  return store.prepare(`
    SELECT c.id, c.scope, c.target_id AS targetId, c.source_type AS sourceType,
      c.source_id AS sourceId, c.title, c.text, c.hash
    FROM memory_chunks c
    LEFT JOIN memory_embeddings e ON e.chunk_id = c.id
      AND e.provider = ?
      AND e.model = ?
    WHERE e.chunk_id IS NULL OR e.hash IS NOT c.hash OR e.dimensions != ?
    ORDER BY c.updated_at ASC
    LIMIT ?
  `).all(provider, model, Number(dimensions || 0), limit)
}

export function upsertEmbedding (baseDir, { chunkId, provider, model, dimensions, vector, hash }) {
  const store = openMemoryStore(baseDir)
  store.prepare(`
    INSERT INTO memory_embeddings (chunk_id, provider, model, dimensions, vector, hash, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chunk_id) DO UPDATE SET
      provider = excluded.provider,
      model = excluded.model,
      dimensions = excluded.dimensions,
      vector = excluded.vector,
      hash = excluded.hash,
      updated_at = excluded.updated_at
  `).run(chunkId, provider, model, dimensions, vector, hash || null, Date.now())
}

export function listEmbeddedChunks (baseDir, { provider, model, targets = [], limit = 200 }) {
  const store = openMemoryStore(baseDir)
  const clauses = []
  const params = [provider, model]
  for (const target of targets) {
    if (!target?.scope || !target?.targetId) continue
    clauses.push('(c.scope = ? AND c.target_id = ?)')
    params.push(target.scope, target.targetId)
  }
  if (clauses.length === 0) return []
  const limitSql = limit > 0 ? 'LIMIT ?' : ''
  if (limit > 0) params.push(limit)
  return store.prepare(`
    SELECT c.id, c.scope, c.target_id AS targetId, c.source_type AS sourceType,
      c.source_id AS sourceId, c.title, c.text, c.hash,
      e.dimensions, e.vector
    FROM memory_chunks c
    JOIN memory_embeddings e ON e.chunk_id = c.id
    WHERE e.provider = ?
      AND e.model = ?
      AND (${clauses.join(' OR ')})
    ORDER BY c.updated_at DESC
    ${limitSql}
  `).all(...params)
}

export function pruneOldMessages (baseDir, maxDays) {
  const days = Number(maxDays)
  if (!Number.isFinite(days) || days < 1) return 0
  const cutoff = new Date()
  cutoff.setHours(cutoff.getHours() + 8 - days * 24)
  const cutoffDate = cutoff.toISOString().slice(0, 10)
  return Number(openMemoryStore(baseDir).prepare('DELETE FROM messages WHERE date < ?').run(cutoffDate).changes)
}

export function pruneOldSummaries (baseDir, retentionDays) {
  const days = Number(retentionDays)
  if (!Number.isFinite(days) || days < 1) return 0
  const cutoff = new Date()
  cutoff.setHours(cutoff.getHours() + 8 - days * 24)
  const cutoffDate = cutoff.toISOString().slice(0, 10)
  const store = openMemoryStore(baseDir)
  const rows = store.prepare(`
    SELECT s.scope, s.target_id AS targetId, s.date
    FROM summaries s
    JOIN profiles p ON p.scope = s.scope AND p.target_id = s.target_id
    WHERE s.date < ?
  `).all(cutoffDate)
  if (rows.length === 0) return 0

  store.exec('BEGIN')
  try {
    const removeChunk = store.prepare(`
      DELETE FROM memory_chunks
      WHERE scope = ? AND target_id = ? AND source_type = 'summary' AND source_id = ?
    `)
    const removeSummary = store.prepare('DELETE FROM summaries WHERE scope = ? AND target_id = ? AND date = ?')
    for (const row of rows) {
      removeChunk.run(row.scope, row.targetId, row.date)
      removeSummary.run(row.scope, row.targetId, row.date)
    }
    store.exec('COMMIT')
    return rows.length
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
    SELECT id, userId, displayName, role, text, createdAt
    FROM (
      SELECT id, user_id AS userId, COALESCE(display_name, nickname, user_id) AS displayName,
        role, text, created_at AS createdAt
      FROM messages
      WHERE scope = 'group' AND target_id = ? AND role IN ('user', 'assistant')
        AND id > ? AND created_at >= ?
      ORDER BY id DESC
      LIMIT ?
    ) recent
    ORDER BY id ASC
  `).all(String(groupId), Number(afterId) || 0, Number(since) || 0, Math.max(1, Number(limit) || 240))
}

export function getGroupLearningState (baseDir, groupId) {
  const row = openMemoryStore(baseDir).prepare(`
    SELECT group_id AS groupId, version, profile_json AS profileJson,
      memory_json AS memoryJson, last_message_id AS lastMessageId,
      last_review_at AS lastReviewAt, status, error, updated_at AS updatedAt
    FROM group_learning_state WHERE group_id = ?
  `).get(String(groupId))
  if (!row) {
    return {
      groupId: String(groupId),
      version: 0,
      profile: [],
      memory: [],
      lastMessageId: 0,
      lastReviewAt: null,
      status: 'idle',
      error: null,
      updatedAt: null
    }
  }
  return {
    ...row,
    profile: parseJsonArray(row.profileJson),
    memory: parseJsonArray(row.memoryJson)
  }
}

export function setGroupLearningReviewStatus (baseDir, groupId, status, error = null) {
  const current = getGroupLearningState(baseDir, groupId)
  openMemoryStore(baseDir).prepare(`
    INSERT INTO group_learning_state (
      group_id, version, profile_json, memory_json, last_message_id,
      last_review_at, status, error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_id) DO UPDATE SET
      status = excluded.status,
      error = excluded.error,
      updated_at = excluded.updated_at
  `).run(
    String(groupId), current.version, JSON.stringify(current.profile), JSON.stringify(current.memory),
    current.lastMessageId, current.lastReviewAt, status, error, Date.now()
  )
}

export function saveGroupLearningReview (baseDir, {
  groupId,
  profile = [],
  memory = [],
  lastMessageId = 0,
  operations = {},
  reason = 'background_review',
  changed = true
}) {
  const store = openMemoryStore(baseDir)
  const current = getGroupLearningState(baseDir, groupId)
  const version = changed ? current.version + 1 : current.version
  const snapshot = { profile, memory }
  const now = Date.now()
  store.exec('BEGIN')
  try {
    store.prepare(`
      INSERT INTO group_learning_state (
        group_id, version, profile_json, memory_json, last_message_id,
        last_review_at, status, error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'idle', NULL, ?)
      ON CONFLICT(group_id) DO UPDATE SET
        version = excluded.version,
        profile_json = excluded.profile_json,
        memory_json = excluded.memory_json,
        last_message_id = excluded.last_message_id,
        last_review_at = excluded.last_review_at,
        status = 'idle',
        error = NULL,
        updated_at = excluded.updated_at
    `).run(
      String(groupId), version, JSON.stringify(profile), JSON.stringify(memory),
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
    memory: Array.isArray(snapshot.memory) ? snapshot.memory : [],
    lastMessageId: getGroupLearningState(baseDir, groupId).lastMessageId,
    operations: { rollbackFrom: targetVersion },
    reason: `rollback:${targetVersion}`,
    changed: true
  })
}

export function getStats (baseDir) {
  const store = openMemoryStore(baseDir)
  const messages = store.prepare('SELECT COUNT(*) AS count FROM messages').get().count
  const summaries = store.prepare('SELECT COUNT(*) AS count FROM summaries').get().count
  const profiles = store.prepare('SELECT COUNT(*) AS count FROM profiles').get().count
  const chunks = store.prepare('SELECT COUNT(*) AS count FROM memory_chunks').get().count
  const embeddings = store.prepare('SELECT COUNT(*) AS count FROM memory_embeddings').get().count
  const identities = store.prepare('SELECT COUNT(*) AS count FROM group_identities').get().count
  const learnedGroups = store.prepare('SELECT COUNT(*) AS count FROM group_learning_state WHERE version > 0').get().count
  const learningVersions = store.prepare('SELECT COUNT(*) AS count FROM group_learning_versions').get().count
  const runs = getSchedulerRuns(baseDir)
  return { enabled: true, messages, summaries, profiles, chunks, embeddings, identities, learnedGroups, learningVersions, runs, dbPath }
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

function simpleHash (s) {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return String(h)
}

function backfillChunks (store) {
  const summaryRows = store.prepare(`
    SELECT scope, target_id AS targetId, date, summary, hash
    FROM summaries
  `).all()
  const profileRows = store.prepare(`
    SELECT scope, target_id AS targetId, profile, hash
    FROM profiles
  `).all()
  const stmt = store.prepare(`
    INSERT INTO memory_chunks (scope, target_id, source_type, source_id, title, text, hash, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, target_id, source_type, source_id) DO NOTHING
  `)
  const now = Date.now()

  for (const row of summaryRows) {
    stmt.run(
      row.scope,
      row.targetId,
      'summary',
      row.date,
      `${row.scope}:${row.targetId} ${row.date} 摘要`,
      row.summary,
      row.hash || simpleHash(row.summary),
      now
    )
  }
  for (const row of profileRows) {
    stmt.run(
      row.scope,
      row.targetId,
      'profile',
      'profile',
      `${row.scope}:${row.targetId} 长期画像`,
      row.profile,
      row.hash || simpleHash(row.profile),
      now
    )
  }
}

function migrateLegacyUserMessages (store) {
  const key = 'user_scope_v2'
  if (store.prepare('SELECT value FROM schema_meta WHERE key = ?').get(key)) return
  store.exec('BEGIN')
  try {
    store.prepare(`
      UPDATE messages SET
        scope = CASE WHEN group_id IS NULL THEN 'private_user' ELSE 'group_user' END,
        target_id = CASE WHEN group_id IS NULL THEN user_id ELSE group_id || ':' || user_id END
      WHERE scope = 'user'
    `).run()
    store.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)').run(key, String(Date.now()))
    store.exec('COMMIT')
  } catch (err) {
    store.exec('ROLLBACK')
    throw err
  }
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
