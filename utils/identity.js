import { getEventGroup, isGroupEvent } from './bot.js'

const seenMasterIds = new Set()
const eventIdentityCache = new WeakMap()

function firstValue (...values) {
  return values.find(value => value !== undefined && value !== null && value !== '')
}

function normalizeId (value) {
  const id = firstValue(value)
  return id === undefined ? '' : String(id)
}

function normalizeText (...values) {
  const value = firstValue(...values)
  return value === undefined ? '' : String(value)
}

function masterConfig (config = {}) {
  return config?.loli?.masterIdentity || config?.masterIdentity || {}
}

export function getMasterIdentityConfig (config = {}) {
  const value = masterConfig(config)
  const users = Array.isArray(value.users)
    ? value.users.map(user => ({
        userId: normalizeId(user?.userId),
        nickname: normalizeText(user?.nickname).trim()
      })).filter(user => user.userId)
    : []
  const legacyIds = Array.isArray(value.userIds)
    ? value.userIds.map(String).map(id => id.trim()).filter(Boolean)
    : []
  const userIds = [...new Set([...legacyIds, ...users.map(user => user.userId)])]
  return {
    enable: value.enable !== false,
    autoDetect: value.autoDetect !== false,
    userIds,
    users,
    appellation: String(value.appellation || '').trim()
  }
}

/** 合并自动识别到的主人 QQ 与昵称；返回配置是否发生变化。 */
export function mergeDetectedMasterIdentities (config, identities = []) {
  const root = config?.loli || config
  if (!root || typeof root !== 'object') return false
  const current = getMasterIdentityConfig(config)
  if (!current.enable || !current.autoDetect) return false

  const byId = new Map(current.users.map(user => [user.userId, { ...user }]))
  let changed = false
  for (const identity of identities) {
    const userId = normalizeId(identity?.userId)
    if (!userId) continue
    const nickname = normalizeText(identity?.nickname).trim()
    const previous = byId.get(userId)
    if (!previous) {
      byId.set(userId, { userId, nickname })
      changed = true
    } else if (nickname && previous.nickname !== nickname) {
      previous.nickname = nickname
      changed = true
    }
  }

  const userIds = [...new Set([...current.userIds, ...byId.keys()])]
  if (userIds.join(',') !== current.userIds.join(',')) changed = true
  if (!changed) return false
  root.masterIdentity = {
    ...(root.masterIdentity || {}),
    enable: true,
    autoDetect: true,
    userIds,
    users: [...byId.values()]
  }
  return true
}

/** 主人发言时自动补全其 QQ 和账号昵称。 */
export function captureEventMasterIdentity (event, config) {
  if (!event?.isMaster) return false
  const sender = event.sender || event.member || {}
  return mergeDetectedMasterIdentities(config, [{
    userId: firstValue(event.user_id, sender.user_id, sender.uin),
    nickname: firstValue(sender.nickname, sender.nick, event.nickname, '')
  }])
}

export function isMasterIdentity (userId, { event, config } = {}) {
  const id = normalizeId(userId)
  if (!id) return false
  const master = getMasterIdentityConfig(config)
  if (!master.enable) return false
  if (event?.isMaster && master.autoDetect) seenMasterIds.add(id)
  return Boolean((master.autoDetect && event?.isMaster) || seenMasterIds.has(id) || master.userIds.includes(id))
}

/** 用当前配置补全数据库中的旧身份记录，配置的主人称呼优先于历史值。 */
export function applyMasterIdentityConfig (identity, userId, config) {
  const id = normalizeId(firstValue(identity?.userId, userId))
  if (!id && !identity) return null
  const master = getMasterIdentityConfig(config)
  const isMaster = master.enable && Boolean(identity?.isMaster || seenMasterIds.has(id) || master.userIds.includes(id))
  return {
    ...(identity || {}),
    userId: id,
    isMaster,
    appellation: isMaster ? (master.appellation || identity?.appellation || '') : ''
  }
}

export function resolveSenderIdentity (source = {}, { event, config, inGroup } = {}) {
  const sender = source?.sender && typeof source.sender === 'object' ? source.sender : source
  const userId = normalizeId(firstValue(
    sender?.user_id,
    sender?.userId,
    sender?.uin,
    sender?.uid,
    source?.user_id,
    source?.userId,
    source?.uin,
    event?.user_id,
    event?.sender?.user_id
  ))
  const configuredMaster = getMasterIdentityConfig(config).users.find(user => user.userId === userId)
  const nickname = normalizeText(
    sender?.nickname,
    sender?.nick,
    source?.nickname,
    event?.sender?.nickname,
    configuredMaster?.nickname,
    ''
  )
  const card = normalizeText(
    sender?.card,
    sender?.card_name,
    sender?.cardName,
    source?.card,
    event?.sender?.card,
    ''
  )
  const role = normalizeText(sender?.role, source?.role, event?.sender?.role, 'member')
  const title = normalizeText(
    sender?.title,
    sender?.special_title,
    sender?.specialTitle,
    source?.title,
    event?.sender?.title,
    ''
  )
  const group = inGroup ?? isGroupEvent(event || source)
  const isMaster = isMasterIdentity(userId, { event, config })
  const appellation = isMaster ? getMasterIdentityConfig(config).appellation : ''
  const displayName = card || nickname || userId || '未知用户'
  const roleName = group
    ? ({ owner: '群主', admin: '群管理员', member: '群成员' }[role] || '群成员')
    : '私聊用户'

  return {
    userId,
    displayName,
    card,
    nickname,
    role,
    roleName,
    title,
    isMaster,
    appellation
  }
}

export function resolveEventIdentity (event, config) {
  const cached = event && typeof event === 'object' ? eventIdentityCache.get(event)?.identity : null
  if (cached) return cached
  const identity = resolveSenderIdentity(event?.sender || event || {}, {
    event,
    config,
    inGroup: isGroupEvent(event)
  })
  if (event && typeof event === 'object') eventIdentityCache.set(event, { identity, detailed: false })
  return identity
}

function mapValue (map, id) {
  if (!map || !id) return null
  if (map instanceof Map) return map.get(id) || map.get(Number(id)) || map.get(String(id)) || null
  if (typeof map === 'object') return map[id] || map[Number(id)] || map[String(id)] || null
  return null
}

function mergeMemberData (member, sender) {
  const merged = { ...(member || {}) }
  for (const [key, value] of Object.entries(sender || {})) {
    if (value !== undefined && value !== null && value !== '') merged[key] = value
  }
  return merged
}

export async function resolveDetailedEventIdentity (event, config) {
  if (!event || typeof event !== 'object') return resolveEventIdentity(event, config)
  const cached = eventIdentityCache.get(event)
  if (cached?.detailed) return cached.identity

  const userId = normalizeId(firstValue(event.user_id, event.sender?.user_id, event.member?.user_id, event.member?.uin))
  let member = event.member?.info || event.member || null

  if (isGroupEvent(event) && userId) {
    try {
      const group = getEventGroup(event) || event.group
      let rosterMember = mapValue(group?.gml, userId)
      if (!rosterMember && typeof group?.getMemberMap === 'function') {
        rosterMember = mapValue(await group.getMemberMap(true), userId)
      }
      if (!rosterMember && typeof group?.pickMember === 'function') {
        const picked = group.pickMember(Number(userId)) || group.pickMember(userId)
        rosterMember = picked?.info || picked || null
      }
      member = mergeMemberData(rosterMember, member)
    } catch {}
  }

  const identity = resolveSenderIdentity(mergeMemberData(member, event.sender), {
    event,
    config,
    inGroup: isGroupEvent(event)
  })
  eventIdentityCache.set(event, { identity, detailed: true })
  return identity
}

export function formatIdentityPrompt (identity, { compact = false } = {}) {
  if (!identity) return ''
  const master = identity.isMaster
    ? `是${identity.appellation ? `；你应称呼其为“${identity.appellation}”` : ''}`
    : '否'
  if (compact) {
    return `QQ=${identity.userId || '-'}；显示名=${identity.displayName || '-'}；群名片=${identity.card || '-'}；昵称=${identity.nickname || '-'}；身份=${identity.roleName || '-'}；主人=${master}${identity.title ? `；头衔=${identity.title}` : ''}`
  }
  return [
    '[当前发送者身份]',
    `QQ号: ${identity.userId || '-'}`,
    `显示名: ${identity.displayName || '-'}`,
    `群名片: ${identity.card || '-'}`,
    `QQ昵称: ${identity.nickname || '-'}`,
    `群身份: ${identity.roleName || '-'}`,
    `专属头衔: ${identity.title || '-'}`,
    `是否为机器人主人: ${master}`,
    '[当前消息]'
  ].join('\n')
}

export function stripIdentityPrompt (text) {
  return String(text || '')
    .replace(/^\[当前交互\][^\n]*\n?/gmu, '')
    .replace(/\[当前发送者身份\][\s\S]*?\[当前消息\]\s*/gu, '')
    .trim()
}
