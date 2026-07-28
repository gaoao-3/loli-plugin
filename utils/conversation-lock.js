/**
 * 按模型 conversation 隔离执行中的请求。
 * 同一 key 只允许一个任务进入；其他消息不排队、不进入模型历史。
 */
export class ConversationExecutionLock {
  #active = new Map()
  #noticeIntervalMs

  constructor ({ noticeIntervalMs = 10000 } = {}) {
    const interval = Number(noticeIntervalMs)
    this.#noticeIntervalMs = Number.isFinite(interval) ? Math.max(0, interval) : 10000
  }

  acquire (key, now = Date.now()) {
    const normalizedKey = String(key || '')
    if (!normalizedKey) throw new Error('conversation key 不能为空')
    const active = this.#active.get(normalizedKey)
    if (active) {
      const shouldNotify = now - active.lastNoticeAt >= this.#noticeIntervalMs
      if (shouldNotify) active.lastNoticeAt = now
      return {
        acquired: false,
        shouldNotify,
        startedAt: active.startedAt
      }
    }
    this.#active.set(normalizedKey, {
      startedAt: now,
      lastNoticeAt: Number.NEGATIVE_INFINITY
    })
    return { acquired: true, shouldNotify: false, startedAt: now }
  }

  release (key) {
    return this.#active.delete(String(key || ''))
  }

  isBusy (key) {
    return this.#active.has(String(key || ''))
  }

  get size () {
    return this.#active.size
  }
}
