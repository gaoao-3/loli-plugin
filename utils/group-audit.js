import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { DATA_DIR } from './state.js'

export const DEFAULT_GROUP_ADMIN_DB = path.join(DATA_DIR, 'group_admin.sqlite')

const SAFE_METADATA_KEYS = new Set([
  'source', 'reason', 'mediaType', 'mediaIndex', 'typeIndex',
  'historyLimit', 'durationSeconds', 'count', 'confirmationId', 'rejectAddRequest',
  'violationReason', 'violationCount', 'violationPoints', 'violationThreshold',
  'severity', 'incidentKey', 'authority', 'scope', 'nameLength', 'contentLength'
])

function cleanText (value, max = 500) {
  return value === undefined || value === null ? '' : String(value).slice(0, max)
}

function safeMetadata (metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => SAFE_METADATA_KEYS.has(key))
      .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 200) : value])
  )
}

export function openGroupAdminAuditStore (dbFile = DEFAULT_GROUP_ADMIN_DB) {
  const resolved = path.resolve(dbFile)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  const db = new DatabaseSync(resolved)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS group_action_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      correlation_id TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      group_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      actor_is_master INTEGER NOT NULL DEFAULT 0,
      bot_id TEXT NOT NULL,
      bot_role TEXT NOT NULL,
      action TEXT NOT NULL,
      target_user_id TEXT,
      target_message_id TEXT,
      request_json TEXT NOT NULL DEFAULT '{}',
      decision TEXT NOT NULL,
      status TEXT NOT NULL,
      reason_code TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_group_action_audit_group_time
      ON group_action_audit (group_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_group_action_audit_actor_time
      ON group_action_audit (actor_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS group_kick_confirmation (
      confirmation_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      requester_id TEXT NOT NULL,
      reason TEXT,
      reject_add_request INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_by TEXT,
      resolved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_group_kick_confirmation_pending
      ON group_kick_confirmation (group_id, status, expires_at);
    CREATE TABLE IF NOT EXISTS group_member_violation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_key TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      group_id TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'minor',
      points INTEGER NOT NULL DEFAULT 1,
      reason TEXT,
      audit_correlation_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_group_member_violation_target_time
      ON group_member_violation (group_id, target_user_id, created_at DESC);
  `)
  const violationColumns = new Set(
    db.prepare('PRAGMA table_info(group_member_violation)').all().map(column => column.name)
  )
  if (!violationColumns.has('severity')) {
    db.exec("ALTER TABLE group_member_violation ADD COLUMN severity TEXT NOT NULL DEFAULT 'minor'")
  }
  if (!violationColumns.has('points')) {
    db.exec('ALTER TABLE group_member_violation ADD COLUMN points INTEGER NOT NULL DEFAULT 1')
  }
  return db
}

export function recordGroupMemberViolation ({
  incidentKey,
  groupId,
  targetUserId,
  action,
  severity = 'minor',
  points = 1,
  reason = '',
  auditCorrelationId = '',
  dbFile = DEFAULT_GROUP_ADMIN_DB
} = {}) {
  const key = cleanText(incidentKey, 200)
  if (!key || !groupId || !targetUserId) return false
  const db = openGroupAdminAuditStore(dbFile)
  try {
    const info = db.prepare(`
      INSERT INTO group_member_violation (
        incident_key, created_at, group_id, target_user_id,
        action, severity, points, reason, audit_correlation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(incident_key) DO UPDATE SET
        action = CASE
          WHEN excluded.points > group_member_violation.points THEN excluded.action
          ELSE group_member_violation.action
        END,
        severity = CASE
          WHEN excluded.points > group_member_violation.points THEN excluded.severity
          ELSE group_member_violation.severity
        END,
        points = MAX(group_member_violation.points, excluded.points),
        reason = CASE
          WHEN excluded.points > group_member_violation.points THEN excluded.reason
          ELSE group_member_violation.reason
        END,
        audit_correlation_id = CASE
          WHEN excluded.points > group_member_violation.points THEN excluded.audit_correlation_id
          ELSE group_member_violation.audit_correlation_id
        END
    `).run(
      key,
      Date.now(),
      cleanText(groupId, 40),
      cleanText(targetUserId, 40),
      cleanText(action, 80),
      cleanText(severity, 20) || 'minor',
      Math.max(1, Math.min(20, Number(points) || 1)),
      cleanText(reason, 200) || null,
      cleanText(auditCorrelationId, 100) || null
    )
    return info.changes > 0
  } finally {
    db.close()
  }
}

export function getGroupMemberViolationSummary ({
  groupId,
  targetUserId,
  windowMs = 7 * 24 * 60 * 60 * 1000,
  dbFile = DEFAULT_GROUP_ADMIN_DB
} = {}) {
  const since = Date.now() - Math.max(60000, Number(windowMs) || 0)
  const db = openGroupAdminAuditStore(dbFile)
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(points), 0) AS points,
             MAX(created_at) AS last_created_at
      FROM group_member_violation
      WHERE group_id = ? AND target_user_id = ? AND created_at >= ?
    `).get(cleanText(groupId, 40), cleanText(targetUserId, 40), since)
    return {
      count: Number(row?.count || 0),
      points: Number(row?.points || 0),
      lastCreatedAt: Number(row?.last_created_at || 0),
      since
    }
  } finally {
    db.close()
  }
}

export function createGroupKickConfirmation ({
  groupId,
  targetUserId,
  requesterId,
  reason = '',
  rejectAddRequest = false,
  ttlMs = 300000,
  dbFile = DEFAULT_GROUP_ADMIN_DB
} = {}) {
  const now = Date.now()
  const confirmationId = randomUUID().replace(/-/gu, '').slice(0, 8).toUpperCase()
  const db = openGroupAdminAuditStore(dbFile)
  try {
    db.prepare(`
      INSERT INTO group_kick_confirmation (
        confirmation_id, group_id, target_user_id, requester_id,
        reason, reject_add_request, created_at, expires_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      confirmationId,
      cleanText(groupId, 40),
      cleanText(targetUserId, 40),
      cleanText(requesterId, 40),
      cleanText(reason, 200) || null,
      rejectAddRequest ? 1 : 0,
      now,
      now + Math.max(30000, Math.min(900000, Number(ttlMs) || 300000))
    )
    return getGroupKickConfirmation(confirmationId, { dbFile })
  } finally {
    db.close()
  }
}

export function getGroupKickConfirmation (confirmationId, {
  dbFile = DEFAULT_GROUP_ADMIN_DB
} = {}) {
  const id = cleanText(confirmationId, 20).toUpperCase()
  const db = openGroupAdminAuditStore(dbFile)
  try {
    const now = Date.now()
    db.prepare(`
      UPDATE group_kick_confirmation
      SET status = 'expired', resolved_at = ?
      WHERE confirmation_id = ? AND status IN ('pending', 'executing') AND expires_at <= ?
    `).run(now, id, now)
    const row = db.prepare(`
      SELECT * FROM group_kick_confirmation WHERE confirmation_id = ?
    `).get(id)
    return row ? {
      confirmationId: row.confirmation_id,
      groupId: row.group_id,
      targetUserId: row.target_user_id,
      requesterId: row.requester_id,
      reason: row.reason || '',
      rejectAddRequest: Boolean(row.reject_add_request),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      status: row.status,
      resolvedBy: row.resolved_by || ''
    } : null
  } finally {
    db.close()
  }
}

export function claimGroupKickConfirmation ({
  confirmationId,
  resolvedBy,
  dbFile = DEFAULT_GROUP_ADMIN_DB
} = {}) {
  const db = openGroupAdminAuditStore(dbFile)
  try {
    const now = Date.now()
    const info = db.prepare(`
      UPDATE group_kick_confirmation
      SET status = 'executing', resolved_by = ?, resolved_at = ?
      WHERE confirmation_id = ? AND status = 'pending' AND expires_at > ?
    `).run(
      cleanText(resolvedBy, 40) || null,
      now,
      cleanText(confirmationId, 20).toUpperCase(),
      now
    )
    return info.changes > 0
  } finally {
    db.close()
  }
}

export function resolveGroupKickConfirmation ({
  confirmationId,
  status,
  resolvedBy,
  dbFile = DEFAULT_GROUP_ADMIN_DB
} = {}) {
  const allowed = new Set(['confirmed', 'cancelled', 'failed'])
  if (!allowed.has(status)) throw new Error(`invalid kick confirmation status: ${status}`)
  const expectedStatus = status === 'cancelled' ? 'pending' : 'executing'
  const db = openGroupAdminAuditStore(dbFile)
  try {
    const info = db.prepare(`
      UPDATE group_kick_confirmation
      SET status = ?, resolved_by = ?, resolved_at = ?
      WHERE confirmation_id = ? AND status = ? AND expires_at > ?
    `).run(
      status,
      cleanText(resolvedBy, 40) || null,
      Date.now(),
      cleanText(confirmationId, 20).toUpperCase(),
      expectedStatus,
      Date.now()
    )
    return info.changes > 0
  } finally {
    db.close()
  }
}

export function beginGroupActionAudit ({
  authorization,
  action,
  targetUserId,
  targetMessageId,
  metadata,
  correlationId = randomUUID(),
  dbFile = DEFAULT_GROUP_ADMIN_DB
} = {}) {
  const now = Date.now()
  const auth = authorization || {}
  const db = openGroupAdminAuditStore(dbFile)
  try {
    const info = db.prepare(`
      INSERT INTO group_action_audit (
        correlation_id, created_at, updated_at, group_id,
        actor_id, actor_role, actor_is_master, bot_id, bot_role,
        action, target_user_id, target_message_id, request_json,
        decision, status, reason_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cleanText(correlationId, 100),
      now,
      now,
      cleanText(auth.groupId, 40),
      cleanText(auth.actor?.userId, 40),
      cleanText(auth.actor?.role || 'member', 20),
      auth.actor?.isMaster ? 1 : 0,
      cleanText(auth.bot?.userId, 40),
      cleanText(auth.bot?.role || 'member', 20),
      cleanText(action || auth.action, 80),
      cleanText(targetUserId || auth.target?.userId, 40) || null,
      cleanText(targetMessageId || auth.targetMessageId, 100) || null,
      JSON.stringify(safeMetadata({ ...metadata, authority: auth.authority || 'human' })),
      auth.allowed ? 'allowed' : 'denied',
      auth.allowed ? 'pending' : 'denied',
      cleanText(auth.reason, 80) || null
    )
    return {
      id: Number(info.lastInsertRowid),
      correlationId: cleanText(correlationId, 100),
      status: auth.allowed ? 'pending' : 'denied'
    }
  } finally {
    db.close()
  }
}

export function finishGroupActionAudit ({
  correlationId,
  status,
  reasonCode = '',
  error = '',
  dbFile = DEFAULT_GROUP_ADMIN_DB
} = {}) {
  const allowedStatus = new Set(['success', 'failed', 'denied'])
  if (!allowedStatus.has(status)) throw new Error(`invalid group action audit status: ${status}`)
  const db = openGroupAdminAuditStore(dbFile)
  try {
    const info = db.prepare(`
      UPDATE group_action_audit
      SET updated_at = ?, status = ?, reason_code = ?, error = ?
      WHERE correlation_id = ?
    `).run(
      Date.now(),
      status,
      cleanText(reasonCode, 80) || null,
      cleanText(error, 1000) || null,
      cleanText(correlationId, 100)
    )
    return info.changes > 0
  } finally {
    db.close()
  }
}
