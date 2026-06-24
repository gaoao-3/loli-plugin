/**
 * 伪人模式 — 日奈的核心对话逻辑
 * 适配 lolicon-core 引擎
 */
import { getEngine, getConfig, PLUGIN_ROOT, DATA_DIR } from '../index.js'
import { intoUserMessage, toYunzai, extractTextFromUserMessage, formatSegmentToText, collectHistoryImages, mergeHistoryImagesIntoUserMessage } from '../utils/message.js'
import common from '../../../lib/common/common.js'
import { getGroupContextPrompt, getGroupHistory } from '../utils/group.js'
import { formatTimeToBeiJing } from '../utils/common.js'
import { buildMemoryPrompt } from '../memory/prompt.js'
import { collect } from '../memory/collector.js'
import { randomUUID } from 'crypto'

// segment 由 TRSS-Yunzai 注入为全局变量

// ─── 运行时状态 ────────────────────────────────

/** 会话缓存: uid → { convId, lastTs, burstCount } */
const sessionCache = new Map()

/** 冷却追踪: user → lastReplyTs / group → lastReplyTs */
const cooldowns = {
  user: new Map(),
  group: new Map()
}

// ─── 辅助函数 ──────────────────────────────────

async function pickRandomChatter (e) {
  if (!e.isGroup) return null
  try {
    const chats = await getGroupHistory(e, 15)
    const selfId = String(e.self_id || e.bot?.uin || '')
    const chatters = [...new Set(
      chats.map(c => String(c.sender?.user_id || '')).filter(id => id && id !== selfId && id !== '0')
    )]
    return chatters.length > 0 ? chatters[Math.floor(Math.random() * chatters.length)] : null
  } catch { return null }
}

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
    parts.push(qq ? segment.at(Number(qq)) : m[0])
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
    parts.push(qq ? segment.at(Number(qq)) : m[0])
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length > 0 ? parts : [text]
}

function _checkManualAt (e) {
  if (!Array.isArray(e.message)) return false
  const selfId = String(e.self_id || e.bot?.uin || '')
  if (!selfId) return false
  return e.message.some(seg => {
    if (seg.type !== 'at') return false
    const qq = seg.qq || seg.data?.qq
    return String(qq) === selfId
  })
}

/**
 * 检查群聊最后一条消息是否自己发的（防自问自答）
 */
async function _isLastMessageFromSelf (e, selfId) {
  if (!e.isGroup) return false
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
        reg: '^(?:[^#]|$)',
        fnc: 'loli',
        log: false
      }]
    })
  }

  _resolveTrigger (e) {
    const cfg = getConfig()?.loli
    if (!cfg?.enable) return { type: null }

    if (e.isPrivate && cfg.enableAtTrigger !== false) {
      return { type: 'at' }
    }

    const atTriggered = e.atBot || e.hasAlias || _checkManualAt(e)
    if (atTriggered && cfg.enableAtTrigger !== false) {
      return { type: 'at' }
    }

    if (cfg.enablePrefixTrigger && cfg.triggerPrefix?.length) {
      const matched = cfg.triggerPrefix.find(p => e.msg?.startsWith(p))
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

    const selfId = String(e.self_id || e.bot?.uin || '')
    if (selfId && String(e.user_id || e.sender?.user_id || '') === selfId) return false

    const trigger = this._resolveTrigger(e)
    if (!trigger.type) return false

    const cfg = getConfig().loli
    const chaiteConfig = getConfig().chaite
    const uid = String(e.user_id || e.sender?.user_id || '0')
    const gid = e.isGroup ? String(e.group_id) : null
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

    const cached = sessionCache.get(uid)
    if (cached && (now - cached.lastTs) < sessionWindow) {
      conversationId = cached.convId
      burstCount = (cached.burstCount || 0) + 1
      cached.lastTs = now
      cached.burstCount = burstCount
    } else {
      conversationId = 'loli-' + uid + '-' + now
      burstCount = 1
      sessionCache.set(uid, { convId: conversationId, lastTs: now, burstCount: 1 })
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

    // 前缀触发时去除前缀
    let rawMsg = e.msg || ''
    if (trigger.type === 'prefix' && trigger.hitPrefix) {
      rawMsg = rawMsg.slice(trigger.hitPrefix.length).trim()
    }

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
        useRawMessage: trigger.type !== 'prefix',
        handleAtMsg: true,
        excludeAtBot: false,
        imageCompress: cfg.imageCompress
      })
      if (trigger.type === 'prefix' && rawMsg) {
        const tc = userMessage.content?.find(c => c.type === 'text')
        if (tc) tc.text = rawMsg
        else if (rawMsg) userMessage.content.push({ type: 'text', text: rawMsg })
      }

      // 群聊历史多图识别：把最近其他成员发的图片也加入当前请求
      if (e.isGroup && cfg.historyImages?.enable) {
        const historyImages = await collectHistoryImages(e, {
          maxImages: cfg.historyImages.maxImages,
          maxAgeSeconds: cfg.historyImages.maxAgeSeconds,
          contextLength: cfg.contextLength,
          imageCompress: cfg.imageCompress
        })
        if (historyImages.length > 0) {
          userMessage = mergeHistoryImagesIntoUserMessage(userMessage, historyImages)
        }
      }
    }

    const userText = extractTextFromUserMessage(userMessage) || e.msg || ''

    // 构建群友昵称映射
    const chatterNameMap = e.isGroup ? await buildChatterNameMap(e) : {}

    // 构建系统提示
    const systemSegments = []
    const systemText = preset.systemPrompt?.content || chaiteConfig.presets?.find(p => p.id === presetId)?.systemPrompt?.content || ''
    if (systemText) {
      systemSegments.push(systemText + '\n当前时间: ' + formatTimeToBeiJing(now))
    }

    // 记忆提示
    const baseDir = getConfig().memory?.dailyMd?.dataDir || (DATA_DIR + '/memory/md')
    const memoryPrompt = await buildMemoryPrompt({
      baseDir,
      groupId: e.isGroup ? String(e.group_id) : null,
      userId: uid
    })
    if (memoryPrompt) systemSegments.push(memoryPrompt)

    // 群聊上下文
    if (e.isGroup && cfg.contextLength > 0) {
      const ctx = await getGroupContextPrompt(e, cfg.contextLength)
      if (ctx) systemSegments.push(ctx)
    }

    // 优雅退出：本轮最后一次回复，AI 自己生成收尾
    if (isLastInBurst) {
      systemSegments.push('[系统指令] 这是本轮对话的最后一次回复，自然地结束对话并道别，不要生硬地说"再见"或"拜拜"，继续保持你的性格和语气。')
    }

    if (systemSegments.length > 0) {
      sendOpts.systemOverride = systemSegments.join('\n\n')
    }

    // 发送消息
    const result = await engine.sendMessage({
      channelId: preset.channelId || 'gemini',
      presetId,
      conversationId,
      userMessage,
      event: e,
      overrideOptions: sendOpts
    })

    const responseText = result.finalText

    // 回复消息
    if (responseText) {
      const parts = parseAtMentions(responseText, chatterNameMap)
      if (parts.length > 0) {
        const recall = cfg.recallDefault || 0
        await e.reply(parts, false, { recallMsg: recall > 0 ? recall : 0 })
      }
    }

    // 优雅退出后：重置 burst 计数 + 加长冷却
    if (isLastInBurst) {
      const burstCooldown = cfg.burstCooldown ?? 180000  // 默认 3 分钟
      cooldowns.user.set(uid, now + burstCooldown)
      if (gid) cooldowns.group.set(gid, now + burstCooldown)
      sessionCache.delete(uid)
      logger.debug(`[loli] burst exhausted for ${uid}, cooling down ${burstCooldown}ms`)
    }

    // 记忆采集
    if (userText || responseText) {
      collect({
        baseDir,
        event: e,
        userText,
        assistantText: responseText
      })
    }
  }
}
