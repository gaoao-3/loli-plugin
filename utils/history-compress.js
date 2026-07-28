/**
 * 会话历史自动压缩（滚动摘要）
 * 回复完成后异步触发：会话超过阈值时，把最老的消息交给记忆 AI 合并进摘要，
 * 原始老消息删除；getHistory 会自动把摘要作为首条消息注入。
 */
import { callMemoryAI } from '../memory/scheduler.js'

const runningConversations = new Set()
/** 压缩失败后的重试冷却（cid → 可重试时间戳） */
const retryAfter = new Map()

function clampNumber (value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/** 单条消息序列化后的最大字符数 */
const ROW_MAX_CHARS = 300
/** 送给压缩模型的片段总上限 */
const PROMPT_SLICE_MAX_CHARS = 12000

const ROLE_LABELS = { user: '用户', assistant: 'AI', tool: '工具' }

/**
 * 把一条历史消息序列化成一行文本；图片已是 [图片] 占位，工具结果已截断。
 * @param {Object} message
 * @returns {string}
 */
export function serializeHistoryRow (message) {
  const label = ROLE_LABELS[message?.role] || message?.role || '消息'
  const parts = []
  for (const part of (message?.content || [])) {
    if (part?.type === 'text' && part.text) parts.push(part.text)
    else if (part?.type === 'toolCallResult') parts.push(`[${part.name || '工具'}] ${part.content || ''}`)
    else if (part?.type === 'toolCall') parts.push(`[调用 ${part.name || '工具'}]`)
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return `${label}: ${text.slice(0, ROW_MAX_CHARS)}`
}

/**
 * 拼装压缩提示词。
 * @returns {{ prompt: string, includedRows: Array }} prompt 与实际纳入的消息行
 *   —— 超出长度上限的行不进 prompt，也绝不能被删除，调用方只用 includedRows 落库
 */
export function buildCompressPrompt ({ previousSummary, rows }) {
  const lines = []
  const includedRows = []
  let total = 0
  for (const row of rows) {
    const line = serializeHistoryRow(row.message)
    if (!line) {
      // 空行（如纯占位消息）无信息，可安全删除
      includedRows.push(row)
      continue
    }
    if (total + line.length > PROMPT_SLICE_MAX_CHARS) break
    lines.push(line)
    includedRows.push(row)
    total += line.length
  }
  const prompt = `你是对话压缩器。把输入的对话片段压缩成简洁的滚动摘要，供 AI 在后续对话中回忆早期上下文。

规则：
- 保留：用户身份与偏好、关键事实、未完成的约定/任务、重要的工具结果结论
- 丢弃：寒暄、客套、重复内容、已被后续纠正的旧结论、工具调用细节
- 用简体中文，第三人称客观描述，不要评论，不要超过 400 字
- 输出纯文本摘要，不要 JSON，不要标题

${previousSummary ? `[已有摘要（需与新片段合并去重）]\n${previousSummary}\n\n` : ''}[新增对话片段（从旧到新）]
${lines.join('\n')}`
  return { prompt, includedRows }
}

/**
 * 判断消息是否带工具调用（assistant 的 toolCall 部分）
 */
function hasToolCall (message) {
  return message?.role === 'assistant' && (message.content || []).some(p => p?.type === 'toolCall')
}

/**
 * 对齐压缩边界，防止劈开 assistant(toolCall) → tool 结果 的消息对。
 * 劈开后保留段会以“没有 functionCall 的 functionResponse”开头，Gemini 直接拒绝。
 * 规则：若切点后第一条保留消息是 tool 结果，则把它也并入压缩段（向前扩展）。
 * @param {Array<{seq:number, message:Object}>} candidateRows 待压缩行（从旧到新）
 * @param {number} totalRows 会话原始消息总数
 * @returns {Array<{seq:number, message:Object}>}
 */
export function alignToolBoundary (candidateRows, totalRows) {
  const rows = [...candidateRows]
  // 压缩段结尾若是带 toolCall 的 assistant，而会话中还有后续消息（可能是其 tool 结果），
  // 则把结尾的 toolCall assistant 移出压缩段，避免保留段开头出现孤儿 functionResponse。
  while (rows.length > 1) {
    const last = rows[rows.length - 1]
    const remainingAfter = totalRows - (rows.length)
    if (hasToolCall(last.message) && remainingAfter > 0) {
      rows.pop()
      continue
    }
    break
  }
  return rows
}

/**
 * 会话超过阈值时压缩最老的消息。回复完成后异步调用，失败仅记录日志。
 * @param {Object} opts
 * @param {Object} opts.storage - LoliStorage 实例
 * @param {string} opts.conversationId
 * @param {Object} [opts.config] - 插件完整配置（读取 llm.historyCompress）
 * @param {Object} [opts.logger]
 * @param {Function} [opts.ai] - 压缩模型调用（默认 callMemoryAI）
 * @returns {Promise<{compressed: number, summary: string}|null>}
 */
export async function maybeCompressHistory ({ storage, conversationId, config, logger = console, ai = callMemoryAI }) {
  const opts = config?.llm?.historyCompress || {}
  if (opts.enable === false || !storage || !conversationId) return null
  const cid = String(conversationId)
  if (runningConversations.has(cid)) return null
  if (Date.now() < (retryAfter.get(cid) || 0)) return null

  const triggerMessages = clampNumber(opts.triggerMessages, 2, 500, 60)
  const count = storage.countHistory(cid)
  if (count <= triggerMessages) return null
  // 保留条数必须小于触发阈值，否则压缩范围为空甚至误删全部
  const keepRecent = Math.min(clampNumber(opts.keepRecent, 1, 100, 20), triggerMessages - 1)
  // 单次最多压缩 batchSize 条：增量小步压缩，摘要质量更稳、单次调用更便宜
  const batchSize = clampNumber(opts.batchSize, 1, 200, 20)
  const batchCount = Math.min(batchSize, count - keepRecent)

  const fetched = storage.getOldestHistoryRows(cid, batchCount + 1)
  // 多取一条用于边界判定；对齐后可能少于 batchCount
  const rows = alignToolBoundary(fetched.slice(0, batchCount), count)
  if (rows.length === 0) return null

  runningConversations.add(cid)
  try {
    const previousSummary = storage.getHistorySummary(cid)
    const { prompt, includedRows } = buildCompressPrompt({ previousSummary, rows })
    if (includedRows.length === 0) return null
    let summary = String(await ai(prompt, { task: 'history_compress', scope: 'conversation', log: logger }) || '').trim()
    if (!summary) return null
    // prompt 里的 400 字只是软约束，超长硬截断兜底
    const maxSummaryChars = clampNumber(opts.maxSummaryChars, 200, 5000, 1500)
    if (summary.length > maxSummaryChars) summary = summary.slice(0, maxSummaryChars) + '…'
    // 只删除实际纳入摘要的消息；超出提示词上限的行留给下次压缩
    storage.replaceHistoryWithSummary(cid, includedRows.map(row => row.seq), summary)
    retryAfter.delete(cid)
    logger?.info?.(`[loli] 会话 ${cid} 历史压缩：${includedRows.length} 条 → 摘要 ${summary.length} 字`)
    return { compressed: includedRows.length, summary }
  } catch (err) {
    const cooldown = clampNumber(opts.retryCooldownMs, 10000, 3600000, 300000)
    retryAfter.set(cid, Date.now() + cooldown)
    throw err
  } finally {
    runningConversations.delete(cid)
  }
}
