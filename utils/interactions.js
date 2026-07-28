import { getEventGroup, getGroupId, getSelfId, isGroupEvent } from './bot.js'

const REACTION_DIRECTIVE_RE = /\[reaction\s*[:：]\s*([^\]\n]{1,20})\]/giu

export const DEFAULT_REACTION_MAP = Object.freeze({
  赞同: Object.freeze({ id: '76', type: 1 }),
  称赞: Object.freeze({ id: '99', type: 1 }),
  开心: Object.freeze({ id: '14', type: 1 }),
  调侃: Object.freeze({ id: '101', type: 1 }),
  安慰: Object.freeze({ id: '49', type: 1 }),
  疑惑: Object.freeze({ id: '32', type: 1 }),
  惊讶: Object.freeze({ id: '180', type: 1 }),
  难过: Object.freeze({ id: '66', type: 1 })
})

const reactionCooldowns = new Map()
const pokeCooldowns = new Map()
const pokeDailyCounts = new Map()

export function buildReactionDirectivePrompt (config) {
  const options = getReactionOptions(config)
  if (!options.enable) return ''
  const choices = Object.keys(resolveReactionMap(options.mapping)).join('、')
  if (!choices) return ''
  return `[QQ消息表情回应规则]
你可以在最终回复中的任意位置添加一次 [reaction:语义]，发送层会给用户当前这条群消息添加一个 QQ 表情回应，用户看不到该标记。
仅在轻量确认、赞同或情绪回应明显合适时使用；不能代替必要的文字回复。可选语义：${choices}。
每次最多一个；如果本轮使用了 [sticker:标签] 或 [表情:标签]，不要再使用 reaction。不要创造语义。`
}

export function extractInteractionDirectives (text) {
  let reaction = ''
  const cleaned = cleanDirectiveText(String(text || '').replace(REACTION_DIRECTIVE_RE, (_matched, value) => {
    if (!reaction) reaction = cleanSemantic(value)
    return ''
  }))
  return { text: cleaned, reaction }
}

export function shouldOfferReaction (config, random = Math.random) {
  const options = getReactionOptions(config)
  if (!options.enable) return false
  return options.probability > 0 && random() < options.probability
}

export function canReactToMessage (event, config, now = Date.now()) {
  const options = getReactionOptions(config)
  if (!options.enable || !isGroupEvent(event)) return false
  const group = getEventGroup(event)
  const seq = getMessageSeq(event)
  if (!group || typeof group.setReaction !== 'function' || seq === null) return false
  const key = interactionKey(event)
  return now - (reactionCooldowns.get(key) || 0) >= options.cooldownMs
}

export async function reactToMessage (event, semantic, config, now = Date.now()) {
  if (!canReactToMessage(event, config, now)) return false
  const options = getReactionOptions(config)
  const reaction = resolveReactionMap(options.mapping)[cleanSemantic(semantic)]
  if (!reaction) return false
  const group = getEventGroup(event)
  const seq = getMessageSeq(event)
  await group.setReaction(seq, reaction.id, reaction.type)
  reactionCooldowns.set(interactionKey(event), now)
  return true
}

export function shouldReturnPoke (config, random = Math.random) {
  const options = getPokeOptions(config)
  if (!options.enable) return false
  return options.returnProbability > 0 && random() < options.returnProbability
}

export async function pokeUser (event, userId, config, now = Date.now()) {
  const options = getPokeOptions(config)
  const target = Number(userId)
  const selfId = Number(getSelfId(event))
  if (!options.enable || !isGroupEvent(event) || !Number.isFinite(target) || target <= 0 || target === selfId) return false
  const group = getEventGroup(event)
  if (!group || typeof group.pokeMember !== 'function') return false

  const key = interactionKey(event, target)
  if (now - (pokeCooldowns.get(key) || 0) < options.cooldownMs) return false
  const dailyKey = `${beijingDateKey(now)}:${key}`
  const count = pokeDailyCounts.get(dailyKey) || 0
  if (count >= options.dailyUserLimit) return false

  const sent = await group.pokeMember(target)
  if (sent === false) return false
  pokeCooldowns.set(key, now)
  pokeDailyCounts.set(dailyKey, count + 1)
  pruneDailyPokeCounts(beijingDateKey(now))
  return true
}

export function isPokeToSelf (event) {
  if (event?.sub_type !== 'poke') return false
  const selfId = getSelfId(event)
  const operatorId = String(event?.operator_id || '')
  const targetId = String(event?.target_id || event?.user_id || '')
  return Boolean(selfId && operatorId && targetId === selfId && operatorId !== selfId)
}

function getInteractionOptions (config) {
  const options = config?.interactions || {}
  return {
    enable: options.enable !== false,
    reaction: options.reaction || {},
    poke: options.poke || {}
  }
}

function getReactionOptions (config) {
  const interactions = getInteractionOptions(config)
  const probability = Number(interactions.reaction.probability)
  const cooldownMs = Number(interactions.reaction.cooldownMs)
  return {
    enable: interactions.enable && interactions.reaction.enable !== false,
    probability: Number.isFinite(probability) ? clamp(probability, 0, 1) : 0.25,
    cooldownMs: Number.isFinite(cooldownMs) ? Math.max(0, cooldownMs) : 45000,
    mapping: interactions.reaction.mapping
  }
}

function getPokeOptions (config) {
  const interactions = getInteractionOptions(config)
  const returnProbability = Number(interactions.poke.returnProbability)
  const cooldownMs = Number(interactions.poke.cooldownMs)
  const dailyUserLimit = Number(interactions.poke.dailyUserLimit)
  return {
    enable: interactions.enable && interactions.poke.enable !== false,
    returnProbability: Number.isFinite(returnProbability) ? clamp(returnProbability, 0, 1) : 0.35,
    cooldownMs: Number.isFinite(cooldownMs) ? Math.max(0, cooldownMs) : 300000,
    dailyUserLimit: Number.isFinite(dailyUserLimit) ? Math.max(0, Math.floor(dailyUserLimit)) : 3
  }
}

function resolveReactionMap (mapping) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return DEFAULT_REACTION_MAP
  const resolved = {}
  for (const [semantic, value] of Object.entries(mapping)) {
    const item = typeof value === 'string' || typeof value === 'number'
      ? { id: String(value), type: 1 }
      : value
    const id = String(item?.id || '').trim()
    const type = Number(item?.type ?? 1)
    if (cleanSemantic(semantic) && id && [1, 2].includes(type)) {
      resolved[cleanSemantic(semantic)] = { id, type }
    }
  }
  return Object.keys(resolved).length ? resolved : DEFAULT_REACTION_MAP
}

function getMessageSeq (event) {
  const values = [event?.seq, event?.source?.seq, event?.message_seq, event?.message_id]
  for (const value of values) {
    const number = Number(value)
    if (Number.isSafeInteger(number) && number > 0) return number
  }
  return null
}

function interactionKey (event, userId = event?.user_id || event?.sender?.user_id) {
  return `${getGroupId(event) || 'private'}:${String(userId || '0')}`
}

function beijingDateKey (now) {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function pruneDailyPokeCounts (currentDate) {
  if (pokeDailyCounts.size < 500) return
  for (const key of pokeDailyCounts.keys()) {
    if (!key.startsWith(`${currentDate}:`)) pokeDailyCounts.delete(key)
  }
}

function cleanSemantic (value) {
  return String(value || '').replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 12)
}

function cleanDirectiveText (value) {
  return String(value || '')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function clamp (value, min, max) {
  return Math.max(min, Math.min(max, value))
}
