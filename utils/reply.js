const DEFAULT_SEGMENTED_REPLY = {
  enable: true,
  minLength: 10,
  maxLength: 48,
  maxSegments: 5,
  delayMin: 500,
  delayMax: 1200
}

// 避免使用 <|...|>：它形似模型内部特殊 token，部分模型会改写或补出异常字符。
export const REPLY_SPLIT_MARKER = '[消息分段]'
const replySplitPattern = /\s*\[消息分段\]\s*/giu
const hasReplySplitMarker = text => /\[消息分段\]/iu.test(text)

const graphemeSegmenter = typeof Intl?.Segmenter === 'function'
  ? new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })
  : null

const closingPunctuation = new Set(['”', '’', '"', "'", '」', '』', '》', '】', '）', ')', ']', '}', '〉'])
const sentencePunctuation = new Set(['。', '！', '？', '!', '?', '…'])
const clausePunctuation = new Set(['；', ';'])
const softPunctuation = new Set(['，', ',', '、', '：', ':'])

function normalizeReplyText (text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/[\t \f\v]*\n[\t \f\v]*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function joinChunkText (left, right) {
  if (!left) return right
  if (!right) return left
  if (/\s$/u.test(left) || /^\s/u.test(right)) return left + right

  const last = left.at(-1) || ''
  const first = right[0] || ''
  const needsSpace = /^[A-Za-z0-9("'\[]$/u.test(first) && /^[A-Za-z0-9.!?;,:)"'\]]$/u.test(last)
  return left + (needsSpace ? ' ' : '') + right
}

function collapseLineBreaks (text) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .reduce(joinChunkText, '')
}

function clampInteger (value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

/** 统一配置边界，防止面板或手写配置造成超长等待/刷屏。 */
export function normalizeSegmentedReplyConfig (value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {}
  const maxLength = clampInteger(value.maxLength, DEFAULT_SEGMENTED_REPLY.maxLength, 1, 4000)
  const minLength = clampInteger(value.minLength, DEFAULT_SEGMENTED_REPLY.minLength, 0, maxLength)
  const maxSegments = clampInteger(value.maxSegments, DEFAULT_SEGMENTED_REPLY.maxSegments, 1, 20)
  const delayMin = clampInteger(value.delayMin, DEFAULT_SEGMENTED_REPLY.delayMin, 0, 10000)
  const delayMax = clampInteger(value.delayMax, DEFAULT_SEGMENTED_REPLY.delayMax, 0, 10000)

  return {
    enable: value.enable !== false,
    minLength,
    maxLength,
    maxSegments,
    delayMin: Math.min(delayMin, delayMax),
    delayMax: Math.max(delayMin, delayMax)
  }
}

function toGraphemes (text) {
  if (graphemeSegmenter) {
    return [...graphemeSegmenter.segment(text)].map(item => ({
      value: item.segment,
      start: item.index,
      end: item.index + item.segment.length
    }))
  }

  let offset = 0
  return Array.from(text, value => {
    const item = { value, start: offset, end: offset + value.length }
    offset += value.length
    return item
  })
}

function graphemeLength (text) {
  if (!text) return 0
  return toGraphemes(text).length
}

function findProtectedRanges (text) {
  const patterns = [
    /(?:https?:\/\/|www\.)[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]*[A-Za-z0-9/_~#\]=&%]/gi,
    /\[at:[^\]\r\n]+\]/gi,
    /@[^\s，。！？,.!?:：;；、\[\]()（）]+/g
  ]
  const ranges = []

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      ranges.push({ start: match.index, end: match.index + match[0].length })
    }
  }

  ranges.sort((a, b) => a.start - b.start || a.end - b.end)
  return ranges.reduce((merged, range) => {
    const last = merged.at(-1)
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
    } else {
      merged.push({ ...range })
    }
    return merged
  }, [])
}

function rangeContainingBoundary (offset, ranges) {
  return ranges.find(range => offset > range.start && offset < range.end)
}

function isDigit (value) {
  return /^\d$/u.test(value || '')
}

function boundaryPriority (graphemes, boundary, ranges) {
  const offset = boundary < graphemes.length ? graphemes[boundary].start : graphemes.at(-1)?.end || 0
  if (rangeContainingBoundary(offset, ranges)) return 0

  const immediate = graphemes[boundary - 1]?.value || ''
  if (immediate.includes('\n')) return 5
  if (/^\s+$/u.test(immediate)) return 1

  let punctuationIndex = boundary - 1
  while (punctuationIndex >= 0 && closingPunctuation.has(graphemes[punctuationIndex].value)) {
    punctuationIndex--
  }
  const punctuation = graphemes[punctuationIndex]?.value || ''
  const next = graphemes[boundary]?.value || ''

  if (sentencePunctuation.has(punctuation)) {
    return sentencePunctuation.has(next) || closingPunctuation.has(next) ? 0 : 4
  }
  if (clausePunctuation.has(punctuation)) return 3
  if (softPunctuation.has(punctuation)) return 2

  if (punctuation === '.') {
    const previous = graphemes[punctuationIndex - 1]?.value || ''
    if (next === '.' || closingPunctuation.has(next)) return 0
    if (isDigit(previous) && isDigit(next)) return 0
    if (/^[A-Za-z0-9]$/u.test(next)) return 0
    return 4
  }

  return 0
}

function chooseCut (graphemes, start, targetLength, minLength, ranges) {
  const hardEnd = Math.min(graphemes.length, start + targetLength)
  const minimum = Math.min(hardEnd, start + minLength)
  let bestBoundary = 0
  let bestScore = -1

  for (let boundary = Math.max(start + 1, minimum); boundary <= hardEnd; boundary++) {
    const priority = boundaryPriority(graphemes, boundary, ranges)
    if (!priority) continue

    const distanceScore = (boundary - start) / targetLength
    const score = distanceScore + priority * 0.16
    if (score >= bestScore) {
      bestBoundary = boundary
      bestScore = score
    }
  }

  if (bestBoundary) return bestBoundary

  let boundary = hardEnd
  const offset = boundary < graphemes.length ? graphemes[boundary].start : graphemes.at(-1)?.end || 0
  const protectedRange = rangeContainingBoundary(offset, ranges)
  if (protectedRange) {
    while (boundary < graphemes.length && graphemes[boundary].start < protectedRange.end) boundary++
  }
  return boundary
}

function mergeSmallChunks (chunks, minLength, maxLength) {
  if (minLength <= 0) return chunks

  const merged = []
  let pending = ''

  const pushPending = () => {
    if (!pending) return
    const previous = merged.at(-1)
    const combinedWithPrevious = previous ? joinChunkText(previous, pending) : ''
    if (previous && graphemeLength(combinedWithPrevious) <= maxLength) {
      merged[merged.length - 1] = combinedWithPrevious
    } else {
      merged.push(pending)
    }
    pending = ''
  }

  for (const chunk of chunks) {
    if (!pending && graphemeLength(chunk.trim()) >= minLength) {
      merged.push(chunk)
      continue
    }

    const combined = joinChunkText(pending, chunk)
    if (graphemeLength(combined) <= maxLength) {
      pending = combined
      if (graphemeLength(pending.trim()) >= minLength) {
        merged.push(pending)
        pending = ''
      }
      continue
    }

    pushPending()
    if (graphemeLength(chunk.trim()) >= minLength) merged.push(chunk)
    else pending = chunk
  }

  pushPending()
  chunks.splice(0, chunks.length, ...merged)
  return chunks
}

function limitChunkCount (chunks, maxSegments) {
  while (chunks.length > maxSegments) {
    let mergeAt = 0
    let smallestPair = Infinity
    for (let index = 0; index < chunks.length - 1; index++) {
      const pairLength = graphemeLength(chunks[index]) + graphemeLength(chunks[index + 1])
      if (pairLength < smallestPair) {
        smallestPair = pairLength
        mergeAt = index
      }
    }
    chunks[mergeAt] = joinChunkText(chunks[mergeAt], chunks[mergeAt + 1])
    chunks.splice(mergeAt + 1, 1)
  }
  return chunks
}

function isNaturalBoundary (graphemes, boundary, ranges) {
  if (boundaryPriority(graphemes, boundary, ranges) < 4) return false
  const next = graphemes[boundary]?.value || ''
  if (sentencePunctuation.has(next) || closingPunctuation.has(next) || next.includes('\n')) return false

  let punctuationIndex = boundary - 1
  while (punctuationIndex >= 0 && closingPunctuation.has(graphemes[punctuationIndex].value)) {
    punctuationIndex--
  }
  const punctuation = graphemes[punctuationIndex]?.value || ''
  if (punctuation !== '.') return true

  const previous = graphemes[punctuationIndex - 1]?.value || ''
  if (next === '.') return false
  return isDigit(previous) || /^\s+$/u.test(next) || /^[\p{Script=Han}\p{P}\p{S}]$/u.test(next) || !next
}

function splitOversizedChunk (text, targetLength, minLength) {
  const graphemes = toGraphemes(text)
  const protectedRanges = findProtectedRanges(text)
  const chunks = []
  let start = 0

  while (graphemes.length - start > targetLength) {
    const boundary = chooseCut(graphemes, start, targetLength, minLength, protectedRanges)
    if (boundary <= start) break
    const startOffset = graphemes[start].start
    const endOffset = boundary < graphemes.length ? graphemes[boundary].start : text.length
    chunks.push(text.slice(startOffset, endOffset))
    start = boundary
  }

  if (start < graphemes.length) chunks.push(text.slice(graphemes[start].start))
  return chunks
}

/**
 * 将模型纯文本按自然边界切成多条消息。URL、@ 标记和 emoji 不会被从中间截断。
 * @param {string} text
 * @param {object} options
 * @returns {string[]}
 */
export function splitReplyText (text, options = {}) {
  const config = normalizeSegmentedReplyConfig(options)
  const normalized = normalizeReplyText(text)
  if (!normalized) return []
  if (!config.enable || config.maxSegments === 1) {
    return [collapseLineBreaks(normalized.replace(replySplitPattern, ' '))]
  }

  const markedChunks = hasReplySplitMarker(normalized)
    ? normalized.split(replySplitPattern).map(collapseLineBreaks).filter(Boolean)
    : []

  // AI 标记优先；没有标记时普通换行仅清理，超长才由本地规则兜底。
  if (markedChunks.length > 0) {
    limitChunkCount(markedChunks, config.maxSegments)
    return markedChunks
  }

  const cleanText = collapseLineBreaks(normalized)
  if (graphemeLength(cleanText) <= config.maxLength) return [cleanText]

  const targetLength = Math.max(config.maxLength, Math.ceil(graphemeLength(cleanText) / config.maxSegments))
  const sizedChunks = splitOversizedChunk(cleanText, targetLength, config.minLength)
  mergeSmallChunks(sizedChunks, config.minLength, targetLength)

  limitChunkCount(sizedChunks, config.maxSegments)
  return sizedChunks.map(chunk => chunk.trim()).filter(Boolean)
}

function isEmptyMessage (message) {
  if (Array.isArray(message)) return message.length === 0
  return message === null || message === undefined || message === ''
}

/** 串行发送分段消息，并且只在相邻两段之间等待。 */
export async function sendReplyChunks (event, chunks, options = {}) {
  const config = normalizeSegmentedReplyConfig(options)
  const transform = typeof options.transform === 'function' ? options.transform : chunk => chunk
  const sleep = typeof options.sleep === 'function'
    ? options.sleep
    : delay => new Promise(resolve => setTimeout(resolve, delay))
  const random = typeof options.random === 'function' ? options.random : Math.random
  const recall = Math.max(0, Number(options.recallSeconds) || 0)
  const messages = []

  for (let index = 0; index < chunks.length; index++) {
    const message = await transform(chunks[index], index)
    if (!isEmptyMessage(message)) messages.push(message)
  }

  for (let index = 0; index < messages.length; index++) {
    await event.reply(messages[index], false, { recallMsg: recall })
    if (index === messages.length - 1) continue

    const ratio = Math.min(0.999999, Math.max(0, Number(random()) || 0))
    const delay = Math.floor(config.delayMin + ratio * (config.delayMax - config.delayMin + 1))
    if (delay > 0) await sleep(delay)
  }

  return messages.length
}
