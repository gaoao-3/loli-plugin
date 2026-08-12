import { getBotFramework, getEventBot, getEventGroup, getGroupId, normalizeSegment } from './bot.js'
import { getConfig } from './state.js'
import { formatOneBotSegmentText, formatRawMessage, formatTimeToBeiJing, renderTemplate } from './common.js'
import { resolveSenderIdentity } from './identity.js'
import { formatMediaSequence, normalizeGroupMessage } from './group-message.js'

/**
 * @typedef {Object} GroupHistoryOptions
 * @property {string} [excludeSelfId]   需要从历史中剔除的 bot 自身 QQ 号
 * @property {string|number} [excludeMessageId] 需要剔除的特定消息（通常是当前正在处理的那条）
 * @property {string|number} [excludeSeq]       按 seq 剔除（与 excludeMessageId 二选一）
 */

export class GroupContextCollector {
  /**
   * 获取群组上下文
   * @param {*} bot bot实例
   * @param {string} groupId 群号
   * @param {number} start 起始seq
   * @param {number} length 往前数几条
   * @returns {Promise<Array<*>>}
   */
  async collect (bot = null, groupId, start = 0, length = 20, event = null) {
    throw new Error('Method not implemented.')
  }
}

/**
 * 取群成员名册 Map<userId, member>，多框架兼容降级
 * @param {*} bot
 * @param {string} groupId
 * @returns {Promise<Map|null>}
 */
async function getGroupMemberMap (bot, groupId, eventGroup = null) {
  if (!bot || !groupId) return null
  if (eventGroup?.gml instanceof Map) return eventGroup.gml
  // 1. group.gml (icqq / 大多数 TRSS 适配器)
  try {
    const group = bot.pickGroup?.(groupId)
    if (group?.gml instanceof Map) return group.gml
    // 2. 异步拉取
    if (group && typeof group.getMemberMap === 'function') {
      const mm = await group.getMemberMap(true)
      if (mm instanceof Map) return mm
    }
  } catch (err) {
    logger.debug(`[GroupContext] group member map via pickGroup failed: ${err.message}`)
  }
  // 3. bot.gml（icqq 旧版 / 部分适配器是 { gid: Map } 结构）
  try {
    const mm = bot.gml
    if (mm instanceof Map && mm.size > 0) return mm
    if (mm && typeof mm.get === 'function') {
      const inner = mm.get(groupId)
      if (inner instanceof Map) return inner
    }
  } catch {}
  // 4. bot.gl（部分框架）
  try {
    const gl = bot.gl
    if (gl && typeof gl.get === 'function') {
      const entry = gl.get(groupId)
      if (entry?.gml instanceof Map) return entry.gml
    }
  } catch {}
  return null
}

function getMapValue (map, id) {
  if (!(map instanceof Map)) return null
  return map.get(id) || map.get(Number(id)) || map.get(String(id)) || null
}

export class ICQQGroupContextCollector extends GroupContextCollector {
  /**
   * 获取群组上下文
   * @param {*} bot
   * @param {string} groupId
   * @param {number} start
   * @param {number} length
   * @returns {Promise<Array<*>>}
   */
  async collect (bot = null, groupId, start = 0, length = 20, event = null) {
    const group = getEventGroup(event) || bot?.pickGroup?.(Number(groupId)) || bot?.pickGroup?.(groupId)
    if (!group || typeof group.getChatHistory !== 'function') {
      logger.debug(`[GroupContext] ICQQ group.getChatHistory not available for ${groupId}`)
      return []
    }
    const history = await group.getChatHistory(start, length)
    const chats = normalizeHistoryResult(history)
    const result = selectRecentHistory(chats, length)

    // 用群成员名册补全 sender（兼容多框架）
    const mm = await getGroupMemberMap(bot, groupId, group)
    if (mm) {
      for (const chat of result) {
        const uid = chat?.sender?.user_id
        const member = getMapValue(mm, uid)
        if (member) {
          chat.sender = { ...chat.sender, ...member }
        }
      }
    }
    return result
  }
}

export class TRSSGroupContextCollector extends GroupContextCollector {
  /**
   * 获取群组上下文
   * @param {*} bot
   * @param {string} groupId
   * @param {number} start
   * @param {number} length
   * @returns {Promise<Array<*>>}
   */
  async collect (bot = null, groupId, start = 0, length = 20, event = null) {
    if (!bot) return []
    const group = getEventGroup(event) || bot.pickGroup?.(groupId)
    if (!group || typeof group.getChatHistory !== 'function') {
      logger.debug(`[GroupContext] TRSS group.getChatHistory not available for ${groupId}`)
      return []
    }
    const history = await group.getChatHistory(start, length)
    const chats = normalizeHistoryResult(history)

    const mm = await getGroupMemberMap(bot, groupId, group)
    if (mm) {
      for (const chat of chats) {
        const uid = chat?.sender?.user_id
        const member = getMapValue(mm, uid)
        if (member) {
          chat.sender = { ...chat.sender, ...member }
        }
      }
    }
    return chats
  }
}

function normalizeHistoryResult (history) {
  if (Array.isArray(history)) return history.filter(Boolean)
  const list = history?.messages || history?.data?.messages || history?.data
  return Array.isArray(list) ? list.filter(Boolean) : []
}

/**
 * 事件级历史缓存：同一 event 多次调用 getGroupHistory 只真正拉取一次
 * key = event 对象，value = 已拉取的原始（未过滤）chats 数组
 * 用 WeakMap 避免内存泄漏，event 被 GC 后缓存自动回收
 */
const _historyCache = new WeakMap()

/**
 * 应用过滤选项到原始历史数组
 * @param {Array<*>} chats 原始未过滤数据
 * @param {GroupHistoryOptions} options
 * @returns {Array<*>}
 */
function applyHistoryFilters (chats, options = {}) {
  if (!Array.isArray(chats) || chats.length === 0) return []
  const { excludeSelfId, excludeMessageId, excludeSeq } = options
  let out = chats

  // 过滤自身消息，避免上下文里出现 bot 自言自语 / 自指
  if (excludeSelfId) {
    const selfIdStr = String(excludeSelfId)
    out = out.filter(c => String(normalizeHistorySender(c).user_id || '') !== selfIdStr)
  }

  // 过滤当前正在处理的那条消息，避免与 userMessage 重复
  const excludedIds = [excludeMessageId, excludeSeq]
    .flatMap(value => Array.isArray(value) ? value : [value])
    .filter(value => value !== undefined && value !== null && value !== '')
    .map(String)
  if (excludedIds.length > 0) {
    out = out.filter(c => {
      const ids = [c?.message_id, c?.messageId, c?.seq, c?.source?.seq]
        .filter(v => v !== undefined && v !== null && v !== '')
        .map(String)
      return !ids.some(id => excludedIds.includes(id))
    })
  }

  return out
}

/**
 * 获取群组上下文 — 框架自适应，采集失败静默降级
 * 同一 event 多次调用只真正拉取一次（取请求过的最大 length），后续命中缓存
 * @param e
 * @param {number} length
 * @param {GroupHistoryOptions} [options] 过滤选项
 * @returns {Promise<Array<*>>}
 */
export async function getGroupHistory (e, length = 20, options = {}) {
  if (!e) return []

  const cached = _historyCache.get(e)
  if (cached && cached.length >= length) {
    // 命中缓存：从已缓存数据尾部取 length 条，再应用过滤
    return applyHistoryFilters(selectRecentHistory(cached, length), options)
  }

  // 未命中 / 缓存不够长：拉取更大的（取 max）
  const need = cached ? Math.max(cached.length, length) : length
  let chats = []
  const bot = getEventBot(e)
  const framework = getBotFramework(e)
  const groupId = getGroupId(e)
  if (!bot || groupId === null) return []

  // TRSS-Yunzai (go-cqhttp / NapCat 兼容)
  if (framework === 'trss') {
    try {
      chats = await new TRSSGroupContextCollector().collect(bot, groupId, 0, need, e)
    } catch (err) {
      logger.debug(`[GroupContext] TRSS 采集失败 (${err.message})，回退 icqq`)
      chats = []
    }
  }

  // 通用 icqq
  if (chats.length === 0) {
    try {
      chats = await new ICQQGroupContextCollector().collect(bot, groupId, 0, need, e)
    } catch (err) {
      logger.debug(`[GroupContext] icqq 采集失败 (${err.message})，群上下文不可用`)
      chats = []
    }
  }

  if (chats.length === 0) return []

  // 写入缓存（原始未过滤数据）
  _historyCache.set(e, chats)

  // 返回尾部 length 条 + 应用过滤
  return applyHistoryFilters(selectRecentHistory(chats, length), options)
}

/**
 * 获取构建群聊聊天记录的 prompt
 * @param e event
 * @param {number} length 长度
 * @param {GroupHistoryOptions} [historyOptions] 历史过滤选项
 * @returns {Promise<string>}
 */
export async function getGroupContextPrompt (e, length, historyOptions = {}) {
  const templates = getConfig()?.llm || {}
  const {
    groupContextTemplatePrefix = '',
    groupContextTemplateMessage = '',
    groupContextTemplateSuffix = ''
  } = templates

  // 没配模板 → 不构建上下文（避免拼出一堆空行污染 system prompt）
  if (!groupContextTemplateMessage) return ''

  const chats = await getGroupHistory(e, length, historyOptions)
  return buildGroupContextPrompt(e, chats, templates)
}

/** 将已采集的历史消息渲染成模型可读上下文。 */
export function buildGroupContextPrompt (e, chats, templates = {}) {
  const {
    groupContextTemplatePrefix = '',
    groupContextTemplateMessage = '',
    groupContextTemplateSuffix = ''
  } = templates
  if (!groupContextTemplateMessage || !Array.isArray(chats) || chats.length === 0) return ''
  const timelineOptions = templates.groupTimeline || {}
  const timelineEnabled = timelineOptions.enable !== false

  const orderedChats = sortHistoryChronologically(chats)
  const rows = orderedChats
    .map((chat, index) => {
      const sender = normalizeHistorySender(chat)
      const identity = resolveSenderIdentity(sender, { config: getConfig(), inGroup: true })
      const raw = getHistoryMessageText(chat)
      if (!raw) return ''
      const senderName = sender.card || sender.nickname || sender.user_id || '-'
      const isAdmin = ['owner', 'admin'].includes(sender.role) ? '是' : '否'
      const identityName = identity.isMaster
        ? `机器人主人 / ${identity.roleName}${identity.appellation ? `（称呼：${identity.appellation}）` : ''}`
        : identity.roleName
      const missingIdentityFields = [
        !groupContextTemplateMessage.includes('${message.sender.user_id}') && `QQ:${identity.userId || '-'}`,
        !groupContextTemplateMessage.includes('${message.sender.identity}') && `身份:${identityName}`,
        !groupContextTemplateMessage.includes('${message.sender.card}') && `群名片:${identity.card || '-'}`,
        !groupContextTemplateMessage.includes('${message.sender.nickname}') && `昵称:${identity.nickname || '-'}`,
        !groupContextTemplateMessage.includes('${message.sender.title}') && `头衔:${identity.title || '-'}`
      ].filter(Boolean)
      const contextualSenderName = missingIdentityFields.length
        ? `${senderName} [${missingIdentityFields.join(' | ')}]`
        : senderName
      const messageId = String(chat.message_id || chat.messageId || chat.seq || chat.source?.seq || '-')
      const rendered = renderTemplate(groupContextTemplateMessage, {
        '${message.sender.card}': sender.card || '-',
        '${message.sender.nickname}': sender.nickname || '-',
        '${message.sender.user_id}': String(sender.user_id || '-'),
        '${message.sender.role}': sender.role || '-',
        '${message.sender.title}': sender.title || '-',
        '${message.sender.name}': contextualSenderName,
        '${message.sender.identity}': identityName,
        '${message.sender.is_master}': identity.isMaster ? '是' : '否',
        '${message.sender.appellation}': identity.appellation || '-',
        '${message.sender.is_admin}': isAdmin,
        '${message.sender.level}': sender.level || '-',
        '${message.sender.age}': sender.age || '-',
        '${message.sender.sex}': sender.sex || '-',
        '${message.sender.area}': sender.area || '-',
        '${message.time}': getHistoryTime(chat) ? formatTimeToBeiJing(getHistoryTime(chat)) : '-',
        '${message.messageId}': messageId,
        '${message.raw_message}': raw
      }).trim()
      const ref = normalizeGroupMessage(chat, { source: 'history', event: e })
      const metadata = []
      if (!groupContextTemplateMessage.includes('${message.messageId}')) metadata.push(`消息ID:${messageId}`)
      if (timelineEnabled) {
        const sequence = formatMediaSequence(ref)
        if (sequence) metadata.push(`媒体:${sequence}`)
        if (ref.replyTo) metadata.push(`引用:${ref.replyTo}`)
        const eventType = String(ref.raw?.notice_type || ref.raw?.sub_type || '').slice(0, 80)
        if (eventType) metadata.push(`事件:${eventType}`)
      }
      const locator = metadata.length ? `[${metadata.join(' | ')}] ` : ''
      return `${locator}${rendered}`
    })
    .filter(Boolean)
    .join('\n')
  if (!rows) return ''

  const prefix = renderTemplate(groupContextTemplatePrefix, {
    '${group.group_id}': String(e.group?.group_id || e.group?.gid || e.group_id || 'unknown'),
    '${group.name}': String(e.group?.name || e.group_name || 'unknown'),
    '${group.member_count}': String(e.group?.member_count || e.group?.memberNum || '-'),
    '${group.max_member_count}': String(e.group?.max_member_count || e.group?.maxMemberCount || '-')
  })
  const currentLocator = timelineEnabled
    ? buildCurrentMessageLocator(e, orderedChats, timelineOptions)
    : ''
  const suffix = groupContextTemplateSuffix || ''

  return [prefix, rows, currentLocator, suffix].filter(s => s !== '').join('\n')
}

/**
 * 群聊正文已按时间顺序携带消息 ID、媒体和引用信息。
 * 当前消息正文由 userMessage 单独传入，这里只补一行定位，避免重复正文。
 */
function buildCurrentMessageLocator (e, chats, options = {}) {
  if (options.includeCurrent === false) return ''
  const currentId = String(e?.message_id || e?.messageId || e?.seq || '')
  if (!currentId) return ''
  const alreadyIncluded = chats.some(chat => {
    const ids = [chat?.message_id, chat?.messageId, chat?.seq, chat?.source?.seq]
      .filter(value => value !== undefined && value !== null && value !== '')
      .map(String)
    return ids.includes(currentId)
  })
  if (alreadyIncluded) return ''
  const ref = normalizeGroupMessage(e, { source: 'current', event: e })
  return `[当前消息定位] ${formatTimelineLine(ref, chats.length + 1)}`
}

/** 构建不重复正文的紧凑时间轴，供模型理解相对顺序并定位媒体消息。 */
export function buildGroupTimeline (e, chats, options = {}) {
  if (!Array.isArray(chats) || chats.length === 0) return ''
  const maxChars = Math.max(500, Math.min(12000, Number(options.maxChars) || 3000))
  const refs = sortHistoryChronologically(chats)
    .map(chat => normalizeGroupMessage(chat, { source: 'history', event: e }))
  const currentId = String(e?.message_id || e?.messageId || e?.seq || '')
  const alreadyIncluded = currentId && refs.some(ref => ref.messageId === currentId || ref.seq === currentId)
  if (!alreadyIncluded && options.includeCurrent !== false) {
    refs.push(normalizeGroupMessage(e, { source: 'current', event: e }))
  }

  let omitted = 0
  let lines = refs.map((ref, index) => formatTimelineLine(ref, index + 1))
  const header = '[群聊消息时间轴｜从旧到新]'
  while (lines.length > 1) {
    const omittedLine = omitted ? `… 已省略更早的 ${omitted} 条消息` : ''
    const rendered = [header, omittedLine, ...lines].filter(Boolean).join('\n')
    if (rendered.length <= maxChars) return rendered
    lines.shift()
    omitted++
  }
  const omittedLine = omitted ? `… 已省略更早的 ${omitted} 条消息` : ''
  const rendered = [header, omittedLine, ...lines].filter(Boolean).join('\n')
  return rendered.length <= maxChars ? rendered : `${rendered.slice(0, maxChars - 1)}…`
}

function formatTimelineLine (ref, position) {
  const label = ref.source === 'current' ? '[当前]' : `#${String(position).padStart(2, '0')}`
  const time = ref.timestampSec ? formatTimeToBeiJing(ref.timestampSec) : '-'
  const senderId = ref.sender.id || '-'
  const senderName = ref.sender.name && ref.sender.name !== senderId ? String(ref.sender.name).slice(0, 80) : ''
  const details = []
  const sequence = formatMediaSequence(ref)
  if (sequence) details.push(`媒体:${sequence}`)
  if (ref.replyTo) details.push(`引用:${ref.replyTo}`)
  const eventType = String(ref.raw?.notice_type || ref.raw?.sub_type || '').slice(0, 80)
  if (eventType) details.push(`事件:${eventType}`)
  return [
    `${label} | ${time} | 消息ID:${ref.messageId || '-'} | QQ:${senderId}${senderName ? `(${senderName})` : ''}`,
    ...details
  ].join(' | ')
}

function normalizeHistorySender (chat) {
  const sender = chat?.sender || {}
  return {
    ...sender,
    user_id: sender.user_id || sender.uin || sender.uid || chat?.user_id || chat?.userId || '-',
    nickname: sender.nickname || sender.nick || chat?.nickname || '',
    card: sender.card || sender.card_name || sender.cardName || chat?.card || '',
    role: sender.role || chat?.role || 'member',
    title: sender.title || sender.special_title || sender.specialTitle || '',
    level: sender.level || sender.level_info?.current_level || '',
    age: sender.age || '',
    sex: sender.sex || '',
    area: sender.area || ''
  }
}

function getHistoryTime (chat) {
  const value = Number(chat?.time || chat?.timestamp || chat?.message_time || 0)
  if (!Number.isFinite(value) || value <= 0) return 0
  return value > 1e12 ? Math.floor(value / 1000) : value
}

function sortHistoryChronologically (chats) {
  return chats
    .filter(Boolean)
    .map((chat, index) => ({ chat, index }))
    .sort((a, b) => {
      const timeDiff = getHistoryTime(a.chat) - getHistoryTime(b.chat)
      if (timeDiff) return timeDiff
      const aSeq = Number(a.chat?.seq || a.chat?.source?.seq)
      const bSeq = Number(b.chat?.seq || b.chat?.source?.seq)
      if (Number.isFinite(aSeq) && Number.isFinite(bSeq) && aSeq !== bSeq) return aSeq - bSeq
      return a.index - b.index
    })
    .map(item => item.chat)
}

function selectRecentHistory (chats, length) {
  const count = Math.max(0, Number(length) || 0)
  if (count === 0) return []
  return sortHistoryChronologically(chats).slice(-count)
}

function getHistoryMessageText (chat) {
  const raw = chat?.raw_message ?? chat?.rawMessage ?? chat?.msg
  if (raw !== undefined && raw !== null && raw !== '') return formatRawMessage(String(raw), { includeReply: false })
  if (!Array.isArray(chat?.message)) return ''
  return chat.message
    .map(normalizeSegment)
    .map(segment => segmentToContextText(segment))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function segmentToContextText (segment) {
  if (segment.type === 'text') return segment.text || ''
  return formatOneBotSegmentText(segment, { includeReply: false })
}
