/**
 * 伪人模式 — 日奈的核心对话逻辑
 * 适配 lolicon-core 引擎
 */
import { getEngine, getConfig, DATA_DIR, initPlugin, destroyPlugin } from '../utils/state.js'
import { addInteractionHint, intoUserMessage, toYunzai, extractTextFromUserMessage, formatSegmentToText, collectHistoryImages, mergeHistoryImagesIntoUserMessage } from '../utils/message.js'
import { getSelfId, isGroupEvent, makeAtSegment, makeForwardMsg, normalizeSegment } from '../utils/bot.js'
import { getGroupContextPrompt, getGroupHistory } from '../utils/group.js'
import { formatTimeToBeiJing } from '../utils/common.js'
import { REPLY_SPLIT_MARKER, sendReplyChunks, splitReplyText } from '../utils/reply.js'
import { buildMemoryPrompt } from '../memory/prompt.js'
import { collect } from '../memory/collector.js'
import { randomUUID } from 'crypto'
import path from 'path'

// segment 由 TRSS-Yunzai 注入为全局变量

// ─── 运行时状态 ────────────────────────────────

/** 会话缓存: conversationKey → { convId, lastTs, burstCount } */
const sessionCache = new Map()

/** 冷却追踪: user → lastReplyTs / group → lastReplyTs */
const cooldowns = {
  user: new Map(),
  group: new Map()
}

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

function _checkManualAt (e) {
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
  const dataDir = getConfig().memory?.dailyMd?.dataDir || 'data/memory/md'
  return path.isAbsolute(dataDir) ? dataDir : path.resolve(DATA_DIR, '..', dataDir)
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

function _getInteractionHint (trigger, inGroup) {
  if (!inGroup) return '用户正在私聊你，这条消息是在直接对你说。'
  if (trigger.type === 'at') {
    return trigger.source === 'alias'
      ? '用户通过你的名字或别名叫了你，这条消息是在明确对你说。'
      : '用户明确 @ 了你，这条消息是在直接对你说；请回应当前发送者。'
  }
  if (trigger.type === 'prefix') {
    return `用户使用唤醒前缀“${trigger.hitPrefix}”叫了你，这条消息是在对你说。`
  }
  if (trigger.type === 'keyword') {
    return `用户使用唤醒词“${trigger.hitKeyword}”叫了你，这条消息是在对你说。`
  }
  return ''
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

    if (cfg.enableProactiveTrigger && Math.random() <= (cfg.promptProbability || 0)) {
      return { type: 'proactive' }
    }

    return { type: null }
  }

  async loli (e) {
    const engine = getEngine()
    if (!engine) return false

    const selfId = getSelfId(e)
    if (selfId && String(e.user_id || e.sender?.user_id || '') === selfId) return false

    const cfg = getConfig().loli
    const chaiteConfig = getConfig().chaite
    const uid = String(e.user_id || e.sender?.user_id || '0')
    const inGroup = isGroupEvent(e)
    const gid = inGroup ? String(e.group_id || e.group?.group_id || e.group?.gid) : null

    if (!_isChatAllowed(cfg, uid, gid)) return false

    const trigger = this._resolveTrigger(e)
    if (!trigger.type) return false
    logger.info(_formatTriggerLog(trigger, uid, gid))

    const conversationKey = _getConversationKey(cfg, uid, gid)
    return this._handleLoli(e, {
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
    const lastUserReply = cooldowns.user.get(uid) || 0
    if (now - lastUserReply < cdUser) return false
    if (gid) {
      const lastGroupReply = cooldowns.group.get(gid) || 0
      if (now - lastGroupReply < cdGroup) return false
    }
    // 标记冷却时间（提前设置，防止本函数异步执行期间重复触发）
    cooldowns.user.set(uid, now)
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
    if (cfg.temperature >= 0) sendOpts.temperature = cfg.temperature
    if (cfg.maxTokens > 0) sendOpts.maxTokens = cfg.maxTokens

    // 构建用户消息
    let userMessage
    if (trigger.type === 'proactive') {
      userMessage = {
        role: 'user',
        content: [{ type: 'text', text: '（基于以上群聊上下文，自然地说一句简短的话加入讨论，不要自我介绍，不要提"上下文"或"以上内容"）' }],
        timestamp: now
      }
    } else {
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

    const userText = extractTextFromUserMessage(userMessage) || e.msg || ''
    const interactionHint = _getInteractionHint(trigger, inGroup)
    if (interactionHint) userMessage = addInteractionHint(userMessage, interactionHint)

    // 构建群友昵称映射
    const chatterNameMap = inGroup ? await buildChatterNameMap(e) : {}

    // 构建系统提示
    const systemSegments = []
    const systemText = preset.systemPrompt?.content || chaiteConfig.presets?.find(p => p.id === presetId)?.systemPrompt?.content || ''
    if (systemText) systemSegments.push(systemText)
    systemSegments.push(`[运行环境]\n当前北京时间：${formatTimeToBeiJing(now)}\n时区：Asia/Shanghai（UTC+8）`)

    // 记忆提示
    const baseDir = _resolveMemoryBaseDir()
    const memoryPrompt = await buildMemoryPrompt({
      baseDir,
      groupId: gid,
      userId: uid,
      queryText: userText,
      config: getConfig()
    })
    if (memoryPrompt) systemSegments.push(memoryPrompt)

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

    // 优雅退出：本轮最后一次回复，AI 自己生成收尾
    if (isLastInBurst) {
      systemSegments.push('[系统指令] 这是本轮对话的最后一次回复，自然地结束对话并道别，不要生硬地说"再见"或"拜拜"，继续保持你的性格和语气。')
    }

    if (cfg.segmentedReply?.enable !== false) {
      systemSegments.push(`[回复分段规则]
由你根据语气和语义决定是否分成多条聊天消息。需要分段时，只在两段之间输出 ${REPLY_SPLIT_MARKER}；不需要分段时不要输出该标记。
每段都必须是可以单独发送的自然聊天内容。不要逐句机械分段，不要连续输出标记，不要解释或展示此规则。普通换行不代表分段。`)
    }

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

    const responseText = result.finalText
    let deliveredResponseText = responseText

    // 回复消息
    if (responseText) {
      const segmentedReply = cfg.segmentedReply || {}
      const chunks = splitReplyText(responseText, segmentedReply)
      deliveredResponseText = chunks.join('\n')
      const sentCount = await sendReplyChunks(e, chunks, {
        ...segmentedReply,
        recallSeconds: cfg.recallDefault || 0,
        transform: chunk => parseAtMentions(chunk, chatterNameMap)
      })
      if (sentCount > 1) {
        const sentAt = Date.now()
        cooldowns.user.set(uid, sentAt)
        if (gid) cooldowns.group.set(gid, sentAt)
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
      cooldowns.user.set(uid, now + burstCooldown)
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
