/**
 * 伪人模式 — 日奈的核心对话逻辑
 * 适配 lolicon-core 引擎
 */
import { getEngine, getConfig, PLUGIN_ROOT, DATA_DIR } from '../index.js'
import { intoUserMessage, toYunzai, extractTextFromUserMessage, formatSegmentToText } from '../utils/message.js'
import common from '../../../lib/common/common.js'
import { getGroupContextPrompt, getGroupHistory } from '../utils/group.js'
import { formatTimeToBeiJing } from '../utils/common.js'
import { buildMemoryPrompt } from '../memory/prompt.js'
import { collect } from '../memory/collector.js'
import { randomUUID } from 'crypto'

// segment 由 TRSS-Yunzai 注入为全局变量

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

    // 跳过机器人自己
    const selfId = String(e.self_id || e.bot?.uin || '')
    if (selfId && String(e.user_id || e.sender?.user_id || '') === selfId) return false

    const trigger = this._resolveTrigger(e)
    if (!trigger.type) return false

    const cfg = getConfig().loli
    const chaiteConfig = getConfig().chaite

    // 选择预设
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
        timestamp: Date.now()
      }
    } else {
      userMessage = await intoUserMessage(e, {
        handleReplyText: true,
        handleReplyImage: true,
        useRawMessage: trigger.type !== 'prefix',
        handleAtMsg: true,
        excludeAtBot: false
      })
      if (trigger.type === 'prefix' && rawMsg) {
        const tc = userMessage.content?.find(c => c.type === 'text')
        if (tc) tc.text = rawMsg
        else if (rawMsg) userMessage.content.push({ type: 'text', text: rawMsg })
      }
    }

    const userText = extractTextFromUserMessage(userMessage) || e.msg || ''

    // 构建群友昵称映射
    const chatterNameMap = e.isGroup ? await buildChatterNameMap(e) : {}

    // 构建系统提示
    const systemSegments = []
    const systemText = preset.systemPrompt?.content || chaiteConfig.presets?.find(p => p.id === presetId)?.systemPrompt?.content || ''
    if (systemText) {
      systemSegments.push(systemText + '\n当前时间: ' + formatTimeToBeiJing(Date.now()))
    }

    // 记忆提示
    const baseDir = getConfig().memory?.dailyMd?.dataDir || (DATA_DIR + '/memory/md')
    const memoryPrompt = await buildMemoryPrompt({
      baseDir,
      groupId: e.isGroup ? String(e.group_id) : null,
      userId: String(e.sender?.user_id || '')
    })
    if (memoryPrompt) systemSegments.push(memoryPrompt)

    // 群聊上下文
    if (e.isGroup && cfg.contextLength > 0) {
      const ctx = await getGroupContextPrompt(e, cfg.contextLength)
      if (ctx) systemSegments.push(ctx)
    }

    if (systemSegments.length > 0) {
      sendOpts.systemOverride = systemSegments.join('\n\n')
    }

    // 会话 ID
    const conversationId = 'loli-' + (e.user_id || e.sender?.user_id || '0') + '-' + Date.now()

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
