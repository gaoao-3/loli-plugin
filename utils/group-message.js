import { getEventGroup, getGroupId, normalizeSegment } from './bot.js'

export const GROUP_MEDIA_TYPES = new Set(['image', 'flash', 'video', 'record', 'file'])

export function normalizeTimestampSec (value) {
  const time = Number(value || 0)
  if (!Number.isFinite(time) || time <= 0) return 0
  return time > 1e12 ? Math.floor(time / 1000) : Math.floor(time)
}

function firstId (...values) {
  const value = values.find(item => item !== undefined && item !== null && item !== '')
  return value === undefined ? '' : String(value)
}

function normalizeUrl (value) {
  if (typeof value !== 'string') return ''
  const clean = value.trim().replace(/&amp;/giu, '&')
  if (clean.startsWith('//')) return `https:${clean}`
  return /^https?:\/\//iu.test(clean) ? clean : ''
}

export function normalizeMessageSender (message = {}) {
  const sender = message?.sender || message?.member || {}
  const id = firstId(sender.user_id, sender.userId, sender.uin, sender.uid, message.user_id, message.userId)
  return {
    id,
    name: String(sender.card || sender.card_name || sender.cardName || sender.nickname || sender.nick || message.card || message.nickname || id),
    card: String(sender.card || sender.card_name || sender.cardName || message.card || ''),
    nickname: String(sender.nickname || sender.nick || message.nickname || ''),
    role: String(sender.role || message.role || 'member')
  }
}

export function normalizeMediaRefs (segments = []) {
  const media = []
  const typeCounts = new Map()
  for (const raw of Array.isArray(segments) ? segments : []) {
    const segment = normalizeSegment(raw)
    if (!GROUP_MEDIA_TYPES.has(segment.type)) continue
    const type = segment.type === 'flash' ? 'image' : segment.type
    const typeIndex = (typeCounts.get(type) || 0) + 1
    typeCounts.set(type, typeIndex)
    const urls = [segment.url, segment.file]
      .map(normalizeUrl)
      .filter(Boolean)
    media.push({
      type,
      rawType: segment.type,
      mediaIndex: media.length + 1,
      typeIndex,
      fileId: firstId(segment.fid, segment.file_id, segment.fileId, segment.id),
      name: String(segment.name || segment.filename || ''),
      urlCandidates: [...new Set(urls)],
      segment,
      raw
    })
  }
  return media
}

/**
 * 将 ICQQ / OneBot / TRSS 消息统一为后续定位、时间轴和管理工具共用的结构。
 */
export function normalizeGroupMessage (message = {}, {
  source = 'history',
  event,
  groupId
} = {}) {
  const meta = message?.data && typeof message.data === 'object' ? message.data : message
  const segments = meta?.message || message?.message || (source === 'current' ? event?.message : []) || []
  const sender = normalizeMessageSender(meta)
  if (!sender.id && source === 'current') {
    Object.assign(sender, normalizeMessageSender(event || {}))
  }
  return {
    source,
    groupId: firstId(groupId, getGroupId(event), meta.group_id, meta.group?.gid),
    messageId: firstId(meta.message_id, meta.messageId, meta.seq, meta.source?.seq,
      source === 'quoted' ? event?.source?.seq || event?.reply_id : event?.message_id || event?.messageId || event?.seq),
    seq: firstId(meta.seq, meta.source?.seq),
    timestampSec: normalizeTimestampSec(meta.time || meta.timestamp || meta.message_time ||
      (source === 'current' ? event?.time : 0)),
    sender,
    replyTo: firstId(meta.source?.seq, meta.reply_id),
    segments: Array.isArray(segments) ? segments : [],
    media: normalizeMediaRefs(segments),
    raw: meta
  }
}

export function normalizeMessageSelector (value, {
  source = 'auto',
  maxItems = 4,
  historyLimit = 30
} = {}) {
  const raw = value && typeof value === 'object' ? value : {}
  const allowedSources = new Set(['auto', 'current', 'quoted', 'history'])
  const allowedMediaTypes = new Set(['image', 'video', 'record', 'file'])
  return {
    source: allowedSources.has(raw.source) ? raw.source : source,
    senderId: String(raw.sender_id || raw.senderId || '').trim(),
    senderName: String(raw.sender_name || raw.senderName || '').trim(),
    messageId: String(raw.message_id || raw.messageId || '').trim(),
    mediaType: allowedMediaTypes.has(raw.media_type || raw.mediaType) ? (raw.media_type || raw.mediaType) : '',
    mediaIndex: Math.max(0, Number(raw.media_index ?? raw.mediaIndex) || 0),
    typeIndex: Math.max(0, Number(raw.type_index ?? raw.typeIndex) || 0),
    maxItems: Math.max(1, Math.min(maxItems, Number(raw.max_items ?? raw.maxItems) || maxItems)),
    historyLimit: Math.max(1, Math.min(100, Number(raw.history_limit ?? raw.historyLimit) || historyLimit)),
    explicit: raw.explicit ?? Boolean(value && typeof value === 'object')
  }
}

function matchesMessage (message, selector) {
  if (selector.source !== 'auto' && message.source !== selector.source) return false
  if (selector.senderId && message.sender.id !== selector.senderId) return false
  if (selector.messageId && message.messageId !== selector.messageId && message.seq !== selector.messageId) return false
  if (selector.senderName) {
    const needle = selector.senderName.toLocaleLowerCase()
    const names = [message.sender.name, message.sender.card, message.sender.nickname]
      .map(value => String(value || '').toLocaleLowerCase())
    if (!names.some(name => name.includes(needle))) return false
  }
  return true
}

export function locateMessageMedia (messages, selectorValue, defaults = {}) {
  const selector = normalizeMessageSelector(selectorValue, defaults)
  const matchedMessages = (Array.isArray(messages) ? messages : []).filter(message => matchesMessage(message, selector))

  if (selector.senderName && !selector.senderId) {
    const senders = new Set(matchedMessages.map(message => message.sender.id).filter(Boolean))
    if (senders.size > 1) {
      return {
        ok: false,
        reason: 'ambiguous_sender',
        selector,
        candidates: [...senders],
        matches: []
      }
    }
  }

  const matches = []
  for (const message of matchedMessages) {
    for (const media of message.media) {
      if (selector.mediaType && media.type !== selector.mediaType) continue
      if (selector.mediaIndex && media.mediaIndex !== selector.mediaIndex) continue
      if (selector.typeIndex && media.typeIndex !== selector.typeIndex) continue
      matches.push({ message, media })
    }
  }
  return {
    ok: matches.length > 0,
    reason: matches.length > 0 ? null : 'resource_not_found',
    selector,
    candidates: [],
    matches
  }
}

export async function collectEventMessageRefs (event) {
  const refs = [normalizeGroupMessage(event, { source: 'current', event })]
  if ((event?.source || event?.reply_id) && typeof event?.getReply === 'function') {
    try {
      const quoted = await event.getReply()
      if (quoted) refs.push(normalizeGroupMessage(quoted, { source: 'quoted', event }))
    } catch {}
  }
  return refs
}

function normalizeHistoryResult (history) {
  if (Array.isArray(history)) return history.filter(Boolean)
  if (Array.isArray(history?.message)) return [history]
  if (Array.isArray(history?.data?.message)) return [history.data]
  const list = history?.messages || history?.data?.messages || history?.data
  return Array.isArray(list) ? list.filter(Boolean) : []
}

/**
 * 消息 ID 存在时先尝试适配器定点查询，返回结果必须再次核对 ID；否则回退有界历史扫描。
 */
export async function collectHistoryMessageRefs (event, selectorValue, {
  historyProvider
} = {}) {
  const selector = normalizeMessageSelector({ ...selectorValue, source: 'history' })
  const group = getEventGroup(event)
  const directLookup = group?.getChatHistoryById || group?.getMessageById || group?.getMsg
  if (selector.messageId && typeof directLookup === 'function') {
    try {
      const direct = normalizeHistoryResult(await directLookup.call(group, selector.messageId))
        .map(message => normalizeGroupMessage(message, { source: 'history', event }))
      if (direct.some(message => message.messageId === selector.messageId || message.seq === selector.messageId)) {
        return direct
      }
    } catch {}
  }
  const history = typeof historyProvider === 'function'
    ? await historyProvider(event, selector.historyLimit)
    : []
  return normalizeHistoryResult(history)
    .map(message => normalizeGroupMessage(message, { source: 'history', event }))
}

export function formatMediaSequence (messageRef) {
  if (!messageRef?.media?.length) return ''
  return messageRef.media.map(media => `${media.type}#${media.typeIndex}`).join(' → ')
}
