/**
 * 机器人框架探测
 */

/** 获取事件实际绑定的机器人实例。 */
export function getEventBot (event) {
  if (event?.bot) return event.bot
  if (event?.group?.bot) return event.group.bot
  if (event?.friend?.bot) return event.friend.bot
  return typeof globalThis.Bot !== 'undefined' ? globalThis.Bot : null
}

/**
 * 探测当前运行的 Yunzai 底层框架类型。
 * Miao-Yunzai 的全局 Bot 可能是代理对象，因此优先检查事件上的 bot。
 * @param {*} eventOrBot
 * @returns {'trss' | 'icqq' | 'unknown'}
 */
export function getBotFramework (eventOrBot) {
  const event = eventOrBot?.bot || eventOrBot?.group || eventOrBot?.friend || eventOrBot?.message_type || eventOrBot?.isGroup
    ? eventOrBot
    : null
  const bot = event ? getEventBot(event) : eventOrBot
  if (!bot) return 'unknown'

  if (bot.adapter || bot.version?.name?.toUpperCase()?.includes('TRSS')) {
    return 'trss'
  }

  if (
    bot.icqq || event?.group?.gid || event?.friend?.uin ||
    (typeof bot.pickGroup === 'function' && (bot.fl instanceof Map || bot.gl instanceof Map))
  ) {
    return 'icqq'
  }

  return 'unknown'
}

export function getSelfId (event) {
  return String(event?.self_id || event?.bot?.uin || event?.group?.bot?.uin || getEventBot(event)?.uin || '')
}

/** 兼容 icqq 扁平消息段与 OneBot 的 data 包装消息段。 */
export function normalizeSegment (element = {}) {
  if (typeof element === 'string') return { type: 'text', text: element }
  if (!element || typeof element !== 'object') return { type: 'text', text: String(element || '') }
  const data = element.data && typeof element.data === 'object' && !Array.isArray(element.data)
    ? element.data
    : {}
  return { ...element, ...data, type: element.type || data.type || '' }
}

/** 统一判断群聊事件，兼容 ICQQ 与 OneBot 事件字段。 */
export function isGroupEvent (event) {
  return Boolean(event?.isGroup || event?.message_type === 'group' || event?.group_id || event?.group?.gid)
}

export function getGroupId (event) {
  const id = event?.group_id ?? event?.group?.group_id ?? event?.group?.gid
  return id === undefined || id === null || id === '' ? null : id
}

/** 优先复用事件实体，避免 ICQQ 多账号场景从错误的 Bot 实例 pickGroup。 */
export function getEventGroup (event) {
  if (event?.group && typeof event.group.getChatHistory === 'function') return event.group
  const bot = getEventBot(event)
  const groupId = getGroupId(event)
  if (!bot || groupId === null || typeof bot.pickGroup !== 'function') return null
  return bot.pickGroup(Number(groupId)) || bot.pickGroup(groupId)
}

function segmentFactory (name, fallback) {
  const factory = globalThis.segment?.[name]
  return typeof factory === 'function' ? factory : fallback
}

export const makeAtSegment = (qq, name) => segmentFactory('at', (id, text) => ({ type: 'at', qq: id, text }))(Number(qq), name)
export const makeFaceSegment = (id, big = false) => segmentFactory('face', (faceId, isBig) => ({ type: 'face', id: faceId, big: isBig }))(Number(id), Boolean(big))
export const makeImageSegment = file => segmentFactory('image', value => ({ type: 'image', file: value }))(file)
export const makeRecordSegment = file => segmentFactory('record', value => ({ type: 'record', file: value }))(file)
export const makeMusicSegment = (platform, id) => segmentFactory('music', (type, songId) => ({ type: 'music', platform: type, id: String(songId) }))(platform, String(id))

/** 制作合并转发，兼容 Miao/icqq 与 TRSS。 */
export async function makeForwardMsg (event, messages, description = '') {
  const nodes = []
  if (description) nodes.push({ message: description })
  for (const message of Array.isArray(messages) ? messages : [messages]) nodes.push({ message })

  if (typeof event?.group?.makeForwardMsg === 'function') return event.group.makeForwardMsg(nodes)
  if (typeof event?.friend?.makeForwardMsg === 'function') return event.friend.makeForwardMsg(nodes)

  const bot = getEventBot(event)
  if (typeof bot?.makeForwardMsg === 'function') return bot.makeForwardMsg(nodes)
  return nodes.map(node => node.message).join('\n')
}
