export const VIOLATION_POLICIES = Object.freeze({
  minor: Object.freeze({
    label: '轻微',
    points: 1,
    maxMuteSeconds: 0,
    guidance: '仅撤回违规消息，不自主禁言'
  }),
  moderate: Object.freeze({
    label: '中等',
    points: 2,
    maxMuteSeconds: 600,
    guidance: '可撤回，并最多禁言 10 分钟'
  }),
  severe: Object.freeze({
    label: '严重',
    points: 3,
    maxMuteSeconds: 3600,
    guidance: '可撤回，并最多禁言 1 小时'
  }),
  critical: Object.freeze({
    label: '重大',
    points: 5,
    maxMuteSeconds: 86400,
    guidance: '可撤回，并最多禁言 1 天'
  })
})

export function normalizeViolationSeverity (value) {
  const severity = String(value || '').trim().toLowerCase()
  return Object.hasOwn(VIOLATION_POLICIES, severity) ? severity : ''
}

export function getViolationPolicy (value) {
  const severity = normalizeViolationSeverity(value)
  return severity ? { severity, ...VIOLATION_POLICIES[severity] } : null
}

export function getGroupModerationConfig (config = {}) {
  const value = config?.loli?.groupModeration || config?.groupModeration || {}
  return {
    botAutonomy: value.botAutonomy === true,
    allowMute: value.allowMute !== false,
    allowRecall: value.allowRecall !== false,
    allowRename: value.allowRename !== false,
    kickViolationPoints: Math.max(1, Math.min(100,
      Number(value.kickViolationPoints ?? value.kickViolationThreshold) || 10)),
    violationWindowDays: Math.max(1, Math.min(90, Number(value.violationWindowDays) || 7))
  }
}
