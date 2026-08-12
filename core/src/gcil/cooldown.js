/**
 * GCIL 冷却计算共享逻辑
 */

/**
 * 日配额耗尽（Resource has been exhausted）冷却到太平洋时间午夜重置；
 * 容量不足（No capacity available）等瞬时 429 按默认短冷却。
 * @param {string} message 错误信息
 * @param {number} fallbackMs 非日配额场景的默认冷却
 * @returns {number} 冷却毫秒数
 */
export function quotaCooldownMs (message, fallbackMs) {
  if (!/resource has been exhausted|quota.*exhaust|daily.*limit/i.test(String(message || ''))) {
    return fallbackMs
  }
  const now = new Date()
  const pacificNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
  const pacificMidnight = new Date(pacificNow)
  pacificMidnight.setHours(24, 0, 0, 0)
  const offsetMs = pacificNow.getTime() - now.getTime()
  return Math.max(fallbackMs, pacificMidnight.getTime() - offsetMs - now.getTime())
}
