/**
 * 伪人模式 — 日奈的核心对话逻辑
 * 使用插件内置 AI 引擎
 */
import { getEngine, getConfig, saveConfig, DATA_DIR, initPlugin, destroyPlugin } from '../utils/state.js'
import { addInteractionHint, intoUserMessage, toYunzai, extractTextFromUserMessage, formatSegmentToText, collectHistoryImages, mergeHistoryImagesIntoUserMessage } from '../utils/message.js'
import { getSelfId, isGroupEvent, makeAtSegment, makeForwardMsg, normalizeSegment } from '../utils/bot.js'
import { getGroupContextPrompt, getGroupHistory } from '../utils/group.js'
import { formatTimeToBeiJing } from '../utils/common.js'
import { REPLY_SPLIT_MARKER, sendReplyChunks, splitReplyText } from '../utils/reply.js'
import { captureEventMasterIdentity, resolveEventIdentity, stripIdentityPrompt } from '../utils/identity.js'
import { collect } from '../memory/collector.js'
import { buildGroupLearningPrompt, observeGroupMessage } from '../memory/group-learning.js'
import { buildGroupMemberMemoryPrompt } from '../memory/member-memory.js'
import { maybeCompressHistory } from '../utils/history-compress.js'
import { ConversationExecutionLock } from '../utils/conversation-lock.js'
import { resolveMemoryBaseDir } from '../memory/options.js'
import { buildIdentityAwarenessPrompt, recordGroupIdentity } from '../memory/identity.js'
import { buildProactiveSystemDirective, hasMeaningfulProactiveEvent, hasMeaningfulUserMessage } from '../utils/proactive.js'
import {
  autoCollectMasterStickers,
  buildStickerDirectivePrompt,
  extractStickerDirective,
  findStickerWithEmbedding,
  getInlineFacePayload,
  injectInlineStickerPayload,
  INLINE_STICKER_TOKEN,
  markStickerUsed,
  sendSticker,
  shouldAutoSendSticker
} from '../utils/stickers.js'
import { enqueueStickerClassifications } from '../utils/sticker-classifier.js'
import {
  buildReactionDirectivePrompt,
  canReactToMessage,
  extractInteractionDirectives,
  reactToMessage,
  shouldOfferReaction
} from '../utils/interactions.js'
import { randomUUID } from 'crypto'
import path from 'path'

// segment 由 TRSS-Yunzai 注入为全局变量

// ─── 运行时状态 ────────────────────────────────

/** 会话缓存: conversationKey → { convId, lastTs, burstCount } */
const sessionCache = new Map()
/** 同一模型 conversation 同时只允许一个请求，避免工具历史交叉和重复 token 消耗。 */
const conversationExecutionLock = new ConversationExecutionLock()

/** 冷却追踪: user → lastReplyTs / group → lastReplyTs */
const cooldowns = {
  user: new Map(),
  group: new Map()
}
const stickerCooldowns = new Map()

// ─── 辅助函数 ──────────────────────────────────

async function buildChatterNameMap (e) {
  const map = {}
  try {
    const chats = await getGroupHistory(e, 20)
    for (const chat of chats) {
      const s = chat.sender || {}
      const userId = String(s.user_id || '')
      if (!userId || userId === '0') continue
      map[userId] = [userId]
      if (s.card && !map[s.card]?.includes(userId)) {
        map[s.card] = [...(map[s.card] || []), userId]
      }
      if (s.nickname && !map[s.nickname]?.includes(userId)) {
        map[s.nickname] = [...(map[s.nickname] || []), userId]
      }
    }
  } catch {}
  return map
}

function resolveName (name, nameMap) {
  const entry = nameMap[name]
  if (entry && entry.length > 0) return entry[0]
  if (/^\d{5,12}$/.test(name)) return name
  return null
}

function parseAtMentions (text, nameMap) {
  if (!text || !nameMap || Object.keys(nameMap).length === 0) return [text]

  // 结构化 [at:xxx]
  const structRe = /\[at:([^\]]+)\]/gi
  const parts = []
  let last = 0, m
  while ((m = structRe.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const qq = resolveName(m[1], nameMap)
    parts.push(qq ? makeAtSegment(qq) : m[0])
    last = m.index + m[0].length
  }
  if (last > 0) {
    if (last < text.length) parts.push(text.slice(last))
    return parts
  }

  // 自然语言 @昵称
  const atRe = /@([^\s，。！？,.!?:：;；、]+)/g
  last = 0
  while ((m = atRe.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const qq = resolveName(m[1], nameMap)
    parts.push(qq ? makeAtSegment(qq) : m[0])
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length > 0 ? parts : [text]
}

function mergeStandaloneInlineStickerChunks (chunks) {
  const merged = []
  for (const chunk of chunks) {
    if (chunk !== INLINE_STICKER_TOKEN) {
      merged.push(chunk)
      continue
    }
    if (merged.length > 0) {
      merged[merged.length - 1] += INLINE_STICKER_TOKEN
    } else {
      merged.push(chunk)
    }
  }
  if (merged.length > 1 && merged[0] === INLINE_STICKER_TOKEN) {
    merged[1] = INLINE_STICKER_TOKEN + merged[1]
    merged.shift()
  }
  return merged
}

export function _checkManualAt (e) {
  if (!Array.isArray(e.message)) return false
  const selfId = getSelfId(e)
  if (!selfId) return false
  return e.message.some(seg => {
    seg = normalizeSegment(seg)
    if (seg.type !== 'at') return false
    const qq = seg.qq || seg.data?.qq
    return String(qq) === selfId
  })
}

function _idListIncludes (list, id) {
  if (!Array.isArray(list) || id === null || id === undefined || id === '') return false
  const idStr = String(id)
  return list.some(item => String(item) === idStr)
}

function _isChatAllowed (cfg, uid, gid) {
  if (_idListIncludes(cfg.blackUsers, uid)) return false
  if (gid && _idListIncludes(cfg.blackGroups, gid)) return false
  if (gid && Array.isArray(cfg.groups) && cfg.groups.length > 0 && !_idListIncludes(cfg.groups, gid)) {
    return false
  }
  return true
}

function _getConversationKey (cfg, uid, gid) {
  const mode = cfg.conversationMode || 'group'
  if (gid && mode === 'group') return `group:${gid}`
  if (gid && mode === 'mixed') return `group:${gid}:user:${uid}`
  return `user:${uid}`
}

function _resolveMemoryBaseDir () {
  return resolveMemoryBaseDir(getConfig(), path.resolve(DATA_DIR, '..'))
}

function _formatTriggerLog (trigger, uid, gid) {
  const scope = gid ? `group=${gid}` : 'private'
  const detail = trigger.hitPrefix
    ? ` prefix=${trigger.hitPrefix}`
    : trigger.hitKeyword
      ? ` keyword=${trigger.hitKeyword}`
      : ''
  return `[loli] trigger type=${trigger.type} ${scope} user=${uid}${detail}`
}

export function _getInteractionHint (trigger, inGroup, atContext = null) {
  if (!inGroup) return '用户正在私聊你，这条消息是在直接对你说。'
  const pointsToOthers = atContext?.atBot !== true && atContext?.others?.length > 0
  if (trigger.type === 'at') {
    if (trigger.source === 'alias') {
      return pointsToOthers
        ? '用户提到了你的名字或别名，但 @ 的是别人，先判断是否在对你说话，再决定以什么身份接话。'
        : '用户通过你的名字或别名叫了你，这条消息是在明确对你说。'
    }
    return '用户明确 @ 了你，这条消息是在直接对你说；请回应当前发送者。'
  }
  if (trigger.type === 'prefix') {
    return `用户使用唤醒前缀“${trigger.hitPrefix}”叫了你，这条消息是在对你说。`
  }
  if (trigger.type === 'keyword') {
    if (pointsToOthers) {
      return `用户提到了关键词“${trigger.hitKeyword}”，但 @ 的是别人，先判断是否在对你说话，再决定以什么身份接话。`
    }
    return `用户使用唤醒词“${trigger.hitKeyword}”叫了你，这条消息是在对你说。`
  }
  return ''
}

export function _getAtDirectionHint (atContext) {
  if (atContext?.atBot === true || !Array.isArray(atContext?.others) || atContext.others.length === 0) return ''
  const targets = atContext.others.map(item => item.text).filter(Boolean).join('、')
  return targets
    ? `注意：这条消息里 @ 的是 ${targets}，不是你。先判断说话对象，不要当成在叫你。`
    : ''
}

function _getCachedGroupMember (e, selfId) {
  const maps = [e?.group?.gml, e?.bot?.gml, e?.group?.bot?.gml]
  for (const map of maps) {
    if (map instanceof Map) {
      const member = map.get(Number(selfId)) || map.get(selfId)
      if (member) return member
    } else if (map && typeof map === 'object') {
      const member = map[selfId]
      if (member) return member
    }
  }
  return null
}

export function _getBotIdentityPrompt (e, selfId = getSelfId(e)) {
  const id = String(selfId || '')
  if (!id) return ''
  try {
    const member = (e?.self && typeof e.self === 'object' ? e.self : null) || _getCachedGroupMember(e, id)
    const rawName = member?.card || member?.card_name || member?.cardName || member?.nickname || member?.nick ||
      e?.bot?.nickname || e?.group?.bot?.nickname || ''
    const name = String(rawName || '').replace(/\s+/gu, ' ').trim().slice(0, 80)
    return `[你的身份] 你的 QQ：${id}${name && name !== id ? `；本群昵称：${name}` : ''}`
  } catch {
    return `[你的身份] 你的 QQ：${id}`
  }
}

/**
 * 检查群聊最后一条消息是否自己发的（防自问自答）
 */
async function _isLastMessageFromSelf (e, selfId) {
  if (!isGroupEvent(e)) return false
  try {
    const last = await getGroupHistory(e, 1)
    if (last.length > 0) {
      return String(last[0].sender?.user_id || '') === selfId
    }
  } catch {}
  return false
}

// ─── 主类 ───────────────────────────────────────

export class loli extends plugin {
  constructor () {
    super({
      name: 'loli-伪人模式',
      dsc: '日奈伪人模式 — @触发/前缀触发/关键词触发/主动触发',
      event: 'message',
      priority: 6000,
      rule: [{
        reg: '^[\\s\\S]*$',
        fnc: 'loli',
        log: false
      }]
    })
  }

  _resolveTrigger (e) {
    const cfg = getConfig()?.loli
    if (!cfg?.enable) return { type: null }

    if ((e.isPrivate || e.message_type === 'private') && cfg.enableAtTrigger !== false) {
      return { type: 'at', source: 'private' }
    }

    const manuallyAtBot = _checkManualAt(e)
    if ((e.atBot || manuallyAtBot) && cfg.enableAtTrigger !== false) {
      return { type: 'at', source: 'mention' }
    }
    if (e.hasAlias && cfg.enableAtTrigger !== false) {
      return { type: 'at', source: 'alias' }
    }

    const triggerPrefix = Array.isArray(cfg.triggerPrefix) && cfg.triggerPrefix.length > 0
      ? cfg.triggerPrefix
      : ['#ai']
    if (cfg.enablePrefixTrigger !== false && triggerPrefix.length) {
      const matched = triggerPrefix.find(p => e.msg?.startsWith(p))
      if (matched) return { type: 'prefix', hitPrefix: matched }
    }

    if (cfg.enableKeywordTrigger && cfg.triggerKeywords?.length) {
      const kw = cfg.triggerKeywords.find(k => e.msg?.includes(k))
      if (kw) return { type: 'keyword', hitKeyword: kw }
    }

    if (cfg.enableProactiveTrigger && hasMeaningfulProactiveEvent(e) && Math.random() <= (cfg.promptProbability || 0)) {
      return { type: 'proactive' }
    }

    return { type: null }
  }

  async loli (e) {
    const engine = getEngine()
    if (!engine) return false

    if (captureEventMasterIdentity(e, getConfig())) saveConfig()
    try {
      const collectedStickers = autoCollectMasterStickers(e, getConfig())
      enqueueStickerClassifications({ engine, config: getConfig(), event: e, stickers: collectedStickers, logger })
    } catch (err) {
      logger?.warn?.(`[Sticker] 自动收录失败: ${err.message}`)
    }

    const selfId = getSelfId(e)
    if (selfId && String(e.user_id || e.sender?.user_id || '') === selfId) return false

    const cfg = getConfig().loli
    const chaiteConfig = getConfig().chaite
    const uid = String(e.user_id || e.sender?.user_id || '0')
    const inGroup = isGroupEvent(e)
    const gid = inGroup ? String(e.group_id || e.group?.group_id || e.group?.gid) : null

    if (!_isChatAllowed(cfg, uid, gid)) return false

    // 旁听合格群消息：让群风格与群友记忆学习覆盖真实群聊，而不只覆盖触发机器人的消息。
    if (cfg.enable && inGroup) {
      observeGroupMessage({
        baseDir: _resolveMemoryBaseDir(),
        event: e,
        userText: e.msg || '',
        config: getConfig(),
        logger
      })
    }

    const trigger = this._resolveTrigger(e)
    if (!trigger.type) return false
    logger.info(_formatTriggerLog(trigger, uid, gid))

    const conversationKey = _getConversationKey(cfg, uid, gid)
    const lock = conversationExecutionLock.acquire(conversationKey)
    if (!lock.acquired) {
      logger.info(`[loli] conversation busy, skip secondary trigger: ${conversationKey}`)
      if (trigger.type !== 'proactive' && lock.shouldNotify && typeof e.reply === 'function') {
        try {
          await e.reply('上一个任务还没处理完，等我一下。')
        } catch (err) {
          logger.debug?.(`[loli] busy notice failed: ${err.message}`)
        }
      }
      return true
    }

    try {
      return await this._handleLoli(e, {
        engine,
        cfg,
        chaiteConfig,
        uid,
        gid,
        inGroup,
        selfId,
        trigger,
        conversationKey
      })
    } finally {
      conversationExecutionLock.release(conversationKey)
    }
  }

  async _handleLoli (e, context) {
    const {
      engine,
      cfg,
      chaiteConfig,
      uid,
      gid,
      inGroup,
      selfId,
      trigger,
      conversationKey
    } = context
    const now = Date.now()

    // ── 自问自答保护 ────────────────────────────
    if (await _isLastMessageFromSelf(e, selfId)) return false

    // ── 冷却检查 ────────────────────────────────
    const cdUser = cfg.cooldownUser ?? 3000
    const cdGroup = cfg.cooldownGroup ?? 1000
    // 同一 QQ 在不同群的冷却也必须隔离，避免一个群影响另一个群。
    const userCooldownKey = conversationKey
    const lastUserReply = cooldowns.user.get(userCooldownKey) || 0
    if (now - lastUserReply < cdUser) return false
    if (gid) {
      const lastGroupReply = cooldowns.group.get(gid) || 0
      if (now - lastGroupReply < cdGroup) return false
    }

    // 主动回复也必须保留当前真实消息。先验证再占用冷却和会话，空事件直接跳过。
    let proactiveUserMessage = null
    if (trigger.type === 'proactive') {
      proactiveUserMessage = await intoUserMessage(e, {
        handleReplyText: true,
        handleReplyImage: true,
        useRawMessage: false,
        handleAtMsg: true,
        excludeAtBot: true,
        toggleMode: 'at',
        imageCompress: cfg.imageCompress
      })
      if (!hasMeaningfulUserMessage(proactiveUserMessage) && String(e.msg || '').trim()) {
        proactiveUserMessage = {
          ...proactiveUserMessage,
          content: [
            ...(Array.isArray(proactiveUserMessage?.content) ? proactiveUserMessage.content : []),
            { type: 'text', text: String(e.msg).trim() }
          ]
        }
      }
      if (!hasMeaningfulUserMessage(proactiveUserMessage)) return false
    }

    // 标记冷却时间（提前设置，防止本函数异步执行期间重复触发）
    cooldowns.user.set(userCooldownKey, now)
    if (gid) cooldowns.group.set(gid, now)

    // ── 会话复用 ────────────────────────────────
    const sessionWindow = cfg.sessionWindow ?? 300000  // 默认 5 分钟
    const maxBurst = cfg.maxReplyBurst ?? 0             // 0 = 不限制
    let conversationId
    let burstCount = 0

    const cached = sessionCache.get(conversationKey)
    if (cached && (now - cached.lastTs) < sessionWindow) {
      conversationId = cached.convId
      burstCount = (cached.burstCount || 0) + 1
      cached.lastTs = now
      cached.burstCount = burstCount
    } else {
      conversationId = 'loli-' + conversationKey.replace(/[^a-zA-Z0-9_-]/g, '-') + '-' + now
      burstCount = 1
      sessionCache.set(conversationKey, { convId: conversationId, lastTs: now, burstCount: 1 })
    }

    // ── 优雅退出检查 ────────────────────────────
    const isLastInBurst = maxBurst > 0 && burstCount >= maxBurst

    // ── 选择预设 ────────────────────────────────
    let presetId = cfg.defaultPreset || 'hina'
    if (trigger.type === 'keyword' && cfg.presetMap?.length) {
      const option = cfg.presetMap
        .sort((a, b) => b.priority - a.priority)
        .find(item => item.keywords.some(k => e.msg?.includes(k)))
      if (option) presetId = option.presetId
    }

    // 加载预设
    const preset = await engine.storage.getPreset(presetId)
    if (!preset) {
      logger.debug('[loli] 预设未找到:', presetId)
      return false
    }

    // 构建选项
    const sendOpts = JSON.parse(JSON.stringify(preset.sendMessageOption || {}))
    if (cfg.maxTokens > 0) sendOpts.maxTokens = cfg.maxTokens
    const historyMaxMessages = Number(getConfig().llm?.historyMaxMessages)
    if (historyMaxMessages > 0) sendOpts.historyLimit = historyMaxMessages

    // 构建用户消息
    let userMessage = proactiveUserMessage
    if (!userMessage) {
      userMessage = await intoUserMessage(e, {
        handleReplyText: true,
        handleReplyImage: true,
        useRawMessage: false,
        handleAtMsg: true,
        excludeAtBot: true,
        toggleMode: trigger.type === 'prefix' ? 'prefix' : 'at',
        togglePrefix: trigger.hitPrefix || null,
        imageCompress: cfg.imageCompress
      })

      // 群聊历史多图识别：把最近其他成员发的图片也加入当前请求
      if (inGroup && cfg.historyImages?.enable) {
        const historyImages = await collectHistoryImages(e, {
          maxImages: cfg.historyImages.maxImages,
          maxAgeSeconds: cfg.historyImages.maxAgeSeconds,
          contextLength: cfg.historyImages.contextLength ?? cfg.contextLength,
          imageCompress: cfg.imageCompress
        })
        if (historyImages.length > 0) {
          userMessage = mergeHistoryImagesIntoUserMessage(userMessage, historyImages)
        }
      }
    }

    if (inGroup) {
      recordGroupIdentity({
        baseDir: _resolveMemoryBaseDir(),
        groupId: gid,
        identity: resolveEventIdentity(e, getConfig()),
        observedAt: now
      })
    }

    const userText = stripIdentityPrompt(extractTextFromUserMessage(userMessage)) || e.msg || ''
    const atContext = userMessage?.atContext || null
    const interactionHint = _getInteractionHint(trigger, inGroup, atContext)
    if (interactionHint) userMessage = addInteractionHint(userMessage, interactionHint)
    const atDirectionHint = inGroup ? _getAtDirectionHint(atContext) : ''
    if (atDirectionHint) userMessage = addInteractionHint(userMessage, atDirectionHint)
    if (userMessage?.atContext) {
      const { atContext: _atContext, ...cleanUserMessage } = userMessage
      userMessage = cleanUserMessage
    }

    // 构建群友昵称映射
    const chatterNameMap = inGroup ? await buildChatterNameMap(e) : {}

    // 构建系统提示
    // 拼接顺序按变动频率排列：静态规则 → 低频（身份/群学习）→ 高频（记忆/群上下文/时间）。
    // Gemini 隐式缓存按前缀命中，静态段尽量靠前可以拉长可缓存前缀。
    const systemSegments = []

    // ── 静态段：预设人设与固定规则 ──
    const systemText = preset.systemPrompt?.content || chaiteConfig.presets?.find(p => p.id === presetId)?.systemPrompt?.content || ''
    if (systemText) systemSegments.push(systemText)
    if (trigger.type === 'proactive') {
      systemSegments.push(buildProactiveSystemDirective({
        groupId: gid,
        userId: uid,
        messageId: e.message_id || e.messageId || e.seq || e.source?.seq
      }))
    }

    if (cfg.segmentedReply?.enable !== false) {
      systemSegments.push(`[回复分段规则]
由你根据语气和语义决定是否分成多条聊天消息。需要分段时，只在两段之间输出 ${REPLY_SPLIT_MARKER}；不需要分段时不要输出该标记。
每段都必须是可以单独发送的自然聊天内容。不要逐句机械分段，不要连续输出标记，不要解释或展示此规则。普通换行不代表分段。`)
    }

    const stickerConfig = getConfig()
    const stickerKey = conversationKey
    const configuredStickerCooldown = Number(stickerConfig?.stickers?.cooldownMs)
    const stickerCooldownMs = Number.isFinite(configuredStickerCooldown) ? Math.max(0, configuredStickerCooldown) : 60000
    const stickerCooldownOpen = Date.now() - (stickerCooldowns.get(stickerKey) || 0) >= stickerCooldownMs
    if (stickerCooldownOpen && shouldAutoSendSticker(stickerConfig)) {
      try {
        const stickerPrompt = buildStickerDirectivePrompt(stickerConfig)
        if (stickerPrompt) systemSegments.push(stickerPrompt)
      } catch (err) {
        logger?.warn?.(`[Sticker] 构建表情提示失败: ${err.message}`)
      }
    }
    let reactionOffered = false
    if (inGroup && canReactToMessage(e, stickerConfig) && shouldOfferReaction(stickerConfig)) {
      const reactionPrompt = buildReactionDirectivePrompt(stickerConfig)
      if (reactionPrompt) {
        systemSegments.push(reactionPrompt)
        reactionOffered = true
      }
    }

    // 优雅退出：本轮最后一次回复，AI 自己生成收尾
    if (isLastInBurst) {
      systemSegments.push('[系统指令] 这是本轮对话的最后一次回复，自然地结束对话并道别，不要生硬地说"再见"或"拜拜"，继续保持你的性格和语气。')
    }

    // ── 低频段：身份与群学习设定（版本化，变动以小时/天计） ──
    if (inGroup) {
      const botIdentityPrompt = _getBotIdentityPrompt(e, selfId)
      if (botIdentityPrompt) systemSegments.push(botIdentityPrompt)

      const groupTopicGuidance = getConfig()?.llm?.groupTopicGuidance
      if (typeof groupTopicGuidance === 'string' && groupTopicGuidance.trim()) {
        systemSegments.push(groupTopicGuidance.trim())
      }

      const identityPrompt = buildIdentityAwarenessPrompt({
        baseDir: _resolveMemoryBaseDir(),
        groupId: gid,
        userId: uid,
        config: getConfig()
      })
      if (identityPrompt) systemSegments.push(identityPrompt)
    }

    // Hermes 风格的群级 USER/MEMORY 覆盖层；只调整表达与互动策略，不改核心人设。
    if (inGroup) {
      const learnedGroupPrompt = buildGroupLearningPrompt({
        baseDir: _resolveMemoryBaseDir(),
        groupId: gid,
        config: getConfig(),
        preset
      })
      if (learnedGroupPrompt) systemSegments.push(learnedGroupPrompt)

      const memberMemoryPrompt = await buildGroupMemberMemoryPrompt({
        baseDir: _resolveMemoryBaseDir(),
        groupId: gid,
        userId: uid,
        queryText: userText,
        logger,
        config: getConfig()
      })
      if (memberMemoryPrompt) systemSegments.push(memberMemoryPrompt)
    }

    // ── 高频段：每条消息都变的内容放最后 ──
    const baseDir = _resolveMemoryBaseDir()

    // 群聊上下文
    if (inGroup && cfg.contextLength > 0) {
      const ctx = await getGroupContextPrompt(e, cfg.contextLength, {
        // 排除 bot 自己的历史发言，避免 AI 看到自己之前说的话造成自指/循环
        excludeSelfId: selfId,
        // 排除当前正在处理的这条消息，避免与 userMessage 内容重复
        excludeMessageId: [e.message_id, e.seq, e.source?.seq]
      })
      if (ctx) systemSegments.push(ctx)
    }

    systemSegments.push(`[运行环境]\n当前北京时间：${formatTimeToBeiJing(now)}\n时区：Asia/Shanghai（UTC+8）`)

    const systemPromptOverride = systemSegments.length > 0 ? systemSegments.join('\n\n') : undefined

    // 发送消息
    const result = await engine.sendMessage({
      channelId: preset.channelId || 'gemini',
      presetId,
      conversationId,
      userMessage,
      event: e,
      overrideOptions: sendOpts,
      systemPromptOverride
    })

    // 历史超长时异步压缩为滚动摘要，不阻塞回复
    void maybeCompressHistory({
      storage: engine.storage,
      conversationId,
      config: getConfig(),
      logger
    }).catch(err => logger?.warn?.(`[loli] 会话历史压缩失败: ${err.message}`))

    // 一次用户请求内可能连续调用多次代码/浏览器工具；统一汇总成一条合并转发，避免逐次刷屏。
    if (Array.isArray(result.executionReports) && result.executionReports.length > 0) {
      const reportNodes = result.executionReports.flatMap((report, index) => [
        `──────── 第 ${index + 1} 次执行 · ${report.language || 'unknown'} ────────`,
        ...(report.nodes || [])
      ])
      try {
        const forward = await makeForwardMsg(
          e,
          reportNodes,
          `🧪 AI 工具执行记录 · 共 ${result.executionReports.length} 次`
        )
        await e.reply(forward)
      } catch (err) {
        logger.warn(`[loli] 发送工具执行合并记录失败: ${err.message}`)
      }
    }

    const responseText = result.finalText
    const interactionDirective = extractInteractionDirectives(responseText)
    const stickerDirective = extractStickerDirective(interactionDirective.text)
    const visibleResponseText = stickerDirective.text
    let deliveredResponseText = visibleResponseText
    let matchedSticker = null
    let inlineFacePayload = null
    let replySourceText = visibleResponseText

    if (stickerDirective.emotion && stickerConfig?.stickers?.enable !== false && stickerCooldownOpen) {
      matchedSticker = await findStickerWithEmbedding({
        emotion: stickerDirective.emotion,
        context: [userText, visibleResponseText].filter(Boolean).join('\n')
      }, stickerConfig, undefined, { logger })
      if (!matchedSticker) {
        logger?.debug?.(`[Sticker] 没有匹配标签“${stickerDirective.emotion}”的可用表情，跳过发送`)
      } else {
        // 有正文时按模型标记位置嵌入普通小黄脸；纯表情回复仍交给独立发送函数。
        inlineFacePayload = visibleResponseText ? getInlineFacePayload(matchedSticker) : null
        if (inlineFacePayload) replySourceText = stickerDirective.positionedText
      }
    }

    // 回复消息
    if (visibleResponseText) {
      const segmentedReply = cfg.segmentedReply || {}
      const chunks = mergeStandaloneInlineStickerChunks(splitReplyText(replySourceText, segmentedReply))
      deliveredResponseText = chunks.map(chunk => chunk.replaceAll(INLINE_STICKER_TOKEN, '')).join('\n')
      const sentCount = await sendReplyChunks(e, chunks, {
        ...segmentedReply,
        recallSeconds: cfg.recallDefault || 0,
        transform: chunk => {
          const parts = inlineFacePayload
            ? injectInlineStickerPayload(chunk, inlineFacePayload)
            : [chunk]
          return parts.flatMap(part => typeof part === 'string'
            ? parseAtMentions(part, chatterNameMap)
            : [part])
        }
      })
      if (inlineFacePayload) {
        markStickerUsed(matchedSticker)
        stickerCooldowns.set(stickerKey, Date.now())
      }
      if (sentCount > 1) {
        const sentAt = Date.now()
        cooldowns.user.set(userCooldownKey, sentAt)
        if (gid) cooldowns.group.set(gid, sentAt)
      }
    }

    if (matchedSticker && !inlineFacePayload) {
      try {
        await sendSticker(e, matchedSticker, undefined, {
          nativeSuperface: stickerConfig?.stickers?.nativeSuperface === true
        })
        stickerCooldowns.set(stickerKey, Date.now())
      } catch (err) {
        logger?.warn?.(`[Sticker] 表情 #${matchedSticker.id} 发送失败: ${err.message}`)
      }
    }

    if (reactionOffered && interactionDirective.reaction && !matchedSticker) {
      try {
        await reactToMessage(e, interactionDirective.reaction, stickerConfig)
      } catch (err) {
        logger?.warn?.(`[Interaction] 消息表情回应失败: ${err.message}`)
      }
    }

    // 发送思考过程（仅在配置启用时）
    if (cfg.sendReasoning && result.response) {
      const reasoningText = (result.response.content || [])
        .filter(c => c.type === 'reasoning' && c.text)
        .map(c => c.text)
        .join('\n')
        .trim()
      if (reasoningText) {
        try {
          const fwd = await makeForwardMsg(e, [reasoningText], '思考过程')
          await e.reply(fwd)
        } catch (err) {
          logger.warn(`[loli] 发送思考过程失败: ${err.message}`)
        }
      }
    }

    // 优雅退出后：重置 burst 计数 + 加长冷却
    if (isLastInBurst) {
      const burstCooldown = cfg.burstCooldown ?? 180000  // 默认 3 分钟
      cooldowns.user.set(userCooldownKey, now + burstCooldown)
      if (gid) cooldowns.group.set(gid, now + burstCooldown)
      sessionCache.delete(conversationKey)
      logger.debug(`[loli] burst exhausted for ${conversationKey}, cooling down ${burstCooldown}ms`)
    }

    // 记忆采集
    if (userText || responseText) {
      collect({
        baseDir,
        event: e,
        userText,
        assistantText: deliveredResponseText,
        assistantIdentity: {
          userId: selfId,
          displayName: preset.name || presetId || 'AI助手',
          nickname: preset.name || presetId || 'AI助手'
        },
        config: getConfig()
      })
    }
  }

  /** 插件初始化：启动引擎与管理面板 */
  async init () {
    await initPlugin()
  }

  /** 插件卸载 */
  async destroy () {
    await destroyPlugin()
  }
}
