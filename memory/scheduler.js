/**
 * 记忆调度器 — SQLite 架构
 *
 * 每 1 小时: 当日 messages -> summaries
 * 每 24 小时: 最近 summaries -> profiles
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  getMessagesForDate,
  getProcessingState,
  getProfile,
  getRecentSummaries,
  getSummary,
  getTargetIdentity,
  listMessageDates,
  listMessageTargets,
  listSummaryTargets,
  pruneOldMessages,
  pruneOldSummaries,
  updateSchedulerRun,
  upsertProcessingState,
  upsertProfile,
  upsertSummary
} from './store.js'
import { embedPendingChunks } from './embedding.js'
import { applyMasterIdentityConfig } from '../utils/identity.js'
import { getMessageRetentionDays, getSummaryRetentionDays } from './options.js'
import { resolveGeminiSafetySettings } from 'lolicon-core/clients/gemini'

const REFINE_INTERVAL_MS = 60 * 60 * 1000
const FIRST_REFINE_DELAY_MS = 60 * 1000
const IMPRESSION_INTERVAL_MS = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 45 * 1000
const REQUEST_RETRIES = 2

let refineHandle = null
let impressionHandle = null
let refineTimeout = null
let impressionTimeout = null
let refinementRunning = false
let impressionRunning = false

const __filename = fileURLToPath(import.meta.url)
const PLUGIN_ROOT = path.dirname(path.dirname(__filename))

export function startScheduler (opts = {}) {
  if (refineHandle || refineTimeout) return

  const rawDir = opts.dataDir || 'data/memory/md'
  const dataDir = path.isAbsolute(rawDir) ? rawDir : path.resolve(PLUGIN_ROOT, rawDir)
  const log = opts.logger || { info (m) { console.log(m) }, warn (m) { console.warn(m) } }

  refineTimeout = setTimeout(() => {
    refineTimeout = null
    runRefinement(dataDir, log).catch(err => log.warn(`[Memory] 摘要任务异常: ${formatError(err)}`))
    refineHandle = setInterval(() => {
      runRefinement(dataDir, log).catch(err => log.warn(`[Memory] 摘要任务异常: ${formatError(err)}`))
    }, REFINE_INTERVAL_MS)
  }, FIRST_REFINE_DELAY_MS)

  impressionTimeout = setTimeout(() => {
    impressionTimeout = null
    runImpression(dataDir, log).catch(err => log.warn(`[Memory] 画像任务异常: ${formatError(err)}`))
    impressionHandle = setInterval(() => {
      runImpression(dataDir, log).catch(err => log.warn(`[Memory] 画像任务异常: ${formatError(err)}`))
    }, IMPRESSION_INTERVAL_MS)
  }, 30 * 1000)

  log.info(`[Memory] SQLite 调度器启动 (摘要:${REFINE_INTERVAL_MS / 60000}分钟, 画像:24小时)`)
}

export function stopScheduler () {
  if (refineTimeout) { clearTimeout(refineTimeout); refineTimeout = null }
  if (impressionTimeout) { clearTimeout(impressionTimeout); impressionTimeout = null }
  if (refineHandle) { clearInterval(refineHandle); refineHandle = null }
  if (impressionHandle) { clearInterval(impressionHandle); impressionHandle = null }
}

export async function runRefinement (baseDir, log = console) {
  if (refinementRunning) {
    log.warn('[Memory] 上一轮摘要仍在运行，本轮跳过')
    return
  }
  refinementRunning = true
  const stats = { processed: 0, succeeded: 0, failed: 0 }
  updateSchedulerRun(baseDir, 'summary', {
    startedAt: Date.now(), finishedAt: null, status: 'running', ...stats, error: null
  })

  try {
    const dates = listMessageDates(baseDir)

    for (const d of dates) {
      const targets = listMessageTargets(baseDir, d)

      for (const target of targets) {
        const messages = getMessagesForDate(baseDir, target.scope, target.targetId, d)
        if (messages.length === 0) continue

        const raw = formatMessages(messages)
        const identity = resolveStoredIdentity(baseDir, target.scope, target.targetId)
        const assistantIdentity = resolveConfiguredAssistantIdentity(getConfig())
        const currHash = simpleHash(`identity_summary_v4_bot_identity\n${formatTargetIdentity(identity, target.targetId, target.scope)}\n${formatAssistantIdentity(assistantIdentity)}\n${raw}`)
        const state = getProcessingState(baseDir, target.scope, target.targetId, d)
        if (state?.inputHash === currHash && ['success', 'no_facts'].includes(state.status)) continue
        const prev = getSummary(baseDir, target.scope, target.targetId, d)
        if (prev?.hash === currHash) {
          upsertProcessingState(baseDir, {
            scope: target.scope, targetId: target.targetId, date: d,
            inputHash: currHash, status: 'success'
          })
          log.info(`[Memory] ${target.scope} ${target.targetId} ${d} 摘要跳过 (无变化)`)
          continue
        }

        stats.processed++
        const prompt = buildSummaryPrompt(raw, target.scope, target.targetId, d, identity, assistantIdentity)
        try {
          const summary = await callMemoryAI(prompt, { task: 'summary', scope: target.scope, log })
          if (!summary || summary.includes('[NO_FACTS]')) {
            upsertProcessingState(baseDir, {
              scope: target.scope, targetId: target.targetId, date: d,
              inputHash: currHash, status: 'no_facts'
            })
            stats.succeeded++
            continue
          }
          upsertSummary(baseDir, {
            scope: target.scope,
            targetId: target.targetId,
            date: d,
            summary,
            hash: currHash
          })
          upsertProcessingState(baseDir, {
            scope: target.scope, targetId: target.targetId, date: d,
            inputHash: currHash, status: 'success'
          })
          stats.succeeded++
          log.info(`[Memory] ${target.scope} ${target.targetId} ${d} 摘要完成`)
        } catch (err) {
          stats.failed++
          upsertProcessingState(baseDir, {
            scope: target.scope, targetId: target.targetId, date: d,
            inputHash: currHash, status: 'failed', error: formatError(err)
          })
          log.warn(`[Memory] ${target.scope} ${target.targetId} ${d} 摘要失败: ${formatError(err)}`)
        }
      }
    }
    await embedPendingChunks({ baseDir, config: getConfig(), logger: log, limit: 1000 })
    const config = getConfig()
    const pruned = pruneOldMessages(baseDir, getMessageRetentionDays(config))
    if (pruned) log.info(`[Memory] 已清理 ${pruned} 条过期原始消息`)
    updateSchedulerRun(baseDir, 'summary', {
      finishedAt: Date.now(), status: stats.failed ? 'partial' : 'success', ...stats
    })
    return stats
  } catch (err) {
    updateSchedulerRun(baseDir, 'summary', {
      finishedAt: Date.now(), status: 'failed', ...stats, error: formatError(err)
    })
    throw err
  } finally {
    refinementRunning = false
  }
}

export async function runImpression (baseDir, log = console) {
  if (impressionRunning) {
    log.warn('[Memory] 上一轮画像仍在运行，本轮跳过')
    return
  }
  impressionRunning = true
  const stats = { processed: 0, succeeded: 0, failed: 0 }
  updateSchedulerRun(baseDir, 'profile', {
    startedAt: Date.now(), finishedAt: null, status: 'running', ...stats, error: null
  })

  try {
    const targets = listSummaryTargets(baseDir)

    for (const target of targets) {
      const summaries = getRecentSummaryRows(baseDir, target.scope, target.targetId, 7)
      if (summaries.length === 0) continue

      const raw = summaries.map(row => `## ${row.date}\n${row.summary}`).join('\n\n')
      const identity = resolveStoredIdentity(baseDir, target.scope, target.targetId)
      const assistantIdentity = resolveConfiguredAssistantIdentity(getConfig())
      const currHash = simpleHash(`identity_profile_v4_bot_identity\n${formatTargetIdentity(identity, target.targetId, target.scope)}\n${formatAssistantIdentity(assistantIdentity)}\n${raw}`)
      const prev = getProfile(baseDir, target.scope, target.targetId)
      if (prev?.hash === currHash) continue

      stats.processed++
      const prompt = buildProfilePrompt(raw, target.scope, target.targetId, identity, assistantIdentity)
      try {
        const profile = await callMemoryAI(prompt, { task: 'profile', scope: target.scope, log })
        if (!profile) continue
        upsertProfile(baseDir, {
          scope: target.scope,
          targetId: target.targetId,
          profile,
          hash: currHash
        })
        stats.succeeded++
        log.info(`[Memory] ${target.scope} ${target.targetId} 画像完成`)
      } catch (err) {
        stats.failed++
        log.warn(`[Memory] ${target.scope} ${target.targetId} 画像失败: ${formatError(err)}`)
      }
    }
    await embedPendingChunks({ baseDir, config: getConfig(), logger: log, limit: 1000 })
    const prunedSummaries = pruneOldSummaries(baseDir, getSummaryRetentionDays(getConfig()))
    if (prunedSummaries) log.info(`[Memory] 已清理 ${prunedSummaries} 条已沉淀到画像的旧摘要`)
    updateSchedulerRun(baseDir, 'profile', {
      finishedAt: Date.now(), status: stats.failed ? 'partial' : 'success', ...stats
    })
    return stats
  } catch (err) {
    updateSchedulerRun(baseDir, 'profile', {
      finishedAt: Date.now(), status: 'failed', ...stats, error: formatError(err)
    })
    throw err
  } finally {
    impressionRunning = false
  }
}

function getRecentSummaryRows (baseDir, scope, targetId, limit) {
  return getRecentSummaries(baseDir, scope, targetId, limit)
}

function resolveStoredIdentity (baseDir, scope, targetId) {
  if (scope === 'group') return null
  const userId = String(targetId).split(':').at(-1)
  return applyMasterIdentityConfig(getTargetIdentity(baseDir, scope, targetId), userId, getConfig())
}

export function formatMessages (messages, config = getConfig()) {
  const configuredAssistant = resolveConfiguredAssistantIdentity(config)
  return messages.map(msg => {
    const name = msg.role === 'assistant'
      ? (msg.display_name || (msg.nickname !== 'AI' ? msg.nickname : '') || configuredAssistant.name)
      : (msg.display_name || msg.nickname || msg.user_id || msg.role)
    const senderIdentity = msg.role === 'assistant'
      ? null
      : applyMasterIdentityConfig({
          userId: msg.user_id,
          isMaster: Boolean(msg.is_master),
          appellation: msg.appellation || ''
        }, msg.user_id, config)
    const storedAssistantId = msg.role === 'assistant' && msg.sender_role === 'bot' ? msg.user_id : ''
    const identity = msg.role === 'assistant'
      ? `机器人:${name}；机器人QQ:${storedAssistantId || configuredAssistant.userId || '-'}`
      : `QQ:${msg.user_id || '-'}；群名片:${msg.card || '-'}；昵称:${msg.account_nickname || '-'}；群角色:${msg.sender_role || 'member'}；头衔:${msg.sender_title || '-'}；主人:${senderIdentity.isMaster ? `是${senderIdentity.appellation ? `（称呼:${senderIdentity.appellation}）` : ''}` : '否'}`
    return `[${new Date(msg.created_at).toLocaleTimeString('zh-CN', { hour12: false })}] ${name} [${identity}]: ${msg.text}`
  }).join('\n')
}

export async function callMemoryAI (prompt, { task = 'summary', scope = 'group', log } = {}) {
  const cfg = getConfig()
  const memoryConfig = cfg?.memory || {}
  const scopeConfig = memoryConfig[scope === 'group' ? 'group' : 'user'] || {}
  const refinementTask = task === 'profile' || task === 'group_learning'
  const channelId = refinementTask
    ? (memoryConfig.refinementChannelId || scopeConfig.channelId || memoryConfig.embedding?.channelId)
    : (scopeConfig.channelId || memoryConfig.extractionChannelId || memoryConfig.embedding?.channelId)
  const channel = resolveChannel(cfg, channelId)
  const fallbackModel = cfg?.chaite?.presets?.[0]?.sendMessageOption?.model || firstChannelModel(channel) || 'gemini-2.5-flash'
  const model = refinementTask
    ? (memoryConfig.refinementModel || fallbackModel)
    : (scopeConfig.extractionModel || memoryConfig.extractionModel || memoryConfig.refinementModel || fallbackModel)
  const apiKey = channel?.options?.apiKey || ''
  const baseUrl = channel?.options?.baseUrl || ''
  const safetySettings = resolveGeminiSafetySettings(channel?.options?.safetyLevel)
  if (!channel) throw new Error(`未找到可用渠道${channelId ? `: ${channelId}` : ''}`)
  if (!apiKey) throw new Error(`渠道 ${channel.id || channelId || 'unknown'} 未配置 API Key`)

  const url = (baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '') +
    `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

  const taskLabel = task === 'profile' ? '画像' : task === 'group_learning' ? '群风格学习' : `${scope}摘要`
  log?.info?.(`[Memory] 调用 ${taskLabel}模型: channel=${channel.id || 'unknown'}, model=${model}`)
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
      ...(safetySettings ? { safetySettings } : {})
    })
  }, log)
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = json?.error?.message || json?.message || `HTTP ${response.status}`
    throw new Error(`渠道 ${channel.id || 'unknown'} / 模型 ${model}: HTTP ${response.status} ${detail}`)
  }

  const text = json?.candidates?.[0]?.content?.parts
    ?.map(part => part?.text || '')
    .join('')
    .trim()
  if (!text) {
    const reason = json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason || '响应中没有文本'
    throw new Error(`渠道 ${channel.id || 'unknown'} / 模型 ${model}: ${reason}`)
  }
  return text
}

async function fetchWithRetry (url, options, log) {
  let lastError
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      if (response.ok || response.status < 500 || attempt === REQUEST_RETRIES) return response
      lastError = new Error(`HTTP ${response.status}`)
    } catch (err) {
      lastError = err
      if (attempt === REQUEST_RETRIES) throw err
    }

    const delay = 500 * (2 ** attempt)
    log?.warn?.(`[Memory] 请求失败，${delay}ms 后重试 (${attempt + 1}/${REQUEST_RETRIES})`)
    await new Promise(resolve => setTimeout(resolve, delay))
  }
  throw lastError
}

function resolveChannel (cfg, channelId) {
  const channels = cfg?.chaite?.channels || []
  if (channelId) {
    return channels.find(channel => channel.id === channelId && channel.status !== 'disabled')
  }
  return channels.find(channel => channel.status !== 'disabled' && channel.adapterType === 'gemini') ||
    channels.find(channel => channel.status !== 'disabled') ||
    channels[0]
}

function firstChannelModel (channel) {
  const models = Array.isArray(channel?.models) ? channel.models : []
  return models.flatMap(model => String(model).split(/[,，]/)).map(model => model.trim()).find(Boolean)
}

function formatError (err) {
  return String(err?.message || err || 'unknown error').slice(0, 300)
}

function getConfig () {
  try {
    return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'data', 'config.json'), 'utf8'))
  } catch {
    return null
  }
}

function simpleHash (s) {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return String(h)
}

export function buildSummaryPrompt (raw, scope, targetId, date, identity, assistantIdentity = {}) {
  const label = scope === 'group' ? '群聊' : scope === 'group_user' ? '群内用户' : '私聊用户'
  const target = formatTargetIdentity(identity, targetId, scope)
  const scopeRule = scope === 'group'
    ? '- 这是群整体摘要，可以记录群内互动，但涉及个人事实时必须写明该成员 QQ 号和显示名'
    : `- 这是单个用户的摘要，目标用户只有 ${target}；其他 QQ 的发言只能作为互动背景，禁止归入目标用户`
  return `请从以下 ${label}原始对话记录中提取关键事实和短期摘要（每条一行，以 "- " 开头）：\n\n时间: ${date}\n存储对象: ${targetId}\n目标身份: ${target}\n当前机器人身份: ${formatAssistantIdentity(assistantIdentity)}\n\n${truncateConversation(raw)}\n\n规则：\n- QQ号是唯一稳定身份；群名片、昵称和称呼只作显示信息，不得用同名判断为同一人\n${scopeRule}\n- “群专属头衔”是宿主平台字段，不是用户自称；不得改写成“自称某某”\n- “机器人应称呼此用户为”是机器人对用户的单向称呼，不得反写成用户称呼机器人\n- 只提取有记忆价值的信息，如偏好、计划、项目、重要事件、稳定观点\n- 严格区分目标用户、其他群友与当前机器人；明确使用机器人名字，不要只写含糊的“AI”\n- 不要把机器人的建议、猜测、称呼、身份或行为当成任何用户事实\n- 主人身份只按记录中的“机器人主人:是”判断，不要按昵称、头衔或聊天自述猜测\n- 忽略寒暄、表情、无意义闲聊\n- 如果没有值得记录的事实，输出：[NO_FACTS]`
}

function truncateConversation (raw, maxLength = 12000) {
  if (raw.length <= maxLength) return raw
  const marker = '\n\n……中间较早的对话已截断……\n\n'
  const available = maxLength - marker.length
  const headLength = Math.floor(available * 0.35)
  return raw.slice(0, headLength) + marker + raw.slice(-(available - headLength))
}

export function buildProfilePrompt (raw, scope, targetId, identity, assistantIdentity = {}) {
  const label = scope === 'group' ? '群聊' : scope === 'group_user' ? '群内用户' : '私聊用户'
  const target = formatTargetIdentity(identity, targetId, scope)
  const identityRule = scope === 'group'
    ? '- 这是群整体事实画像，不得把某个成员的个人特征写成全群特征；个人关系需标明 QQ 号\n- 群体口癖、回复长度、玩梗方式等表达风格由独立的群学习系统维护，本画像不要重复总结'
    : `- 画像对象唯一锁定为 ${target}；摘要里其他 QQ 的信息不得写入该画像`
  return `基于以下 ${label}「${targetId}」最近摘要，生成一份简洁长期画像。\n\n目标身份: ${target}\n当前机器人身份: ${formatAssistantIdentity(assistantIdentity)}\n\n${raw.slice(0, 6000)}\n\n要求：\n- QQ号是唯一稳定身份，昵称、群名片变化不代表换人，同名也不代表同一人\n${identityRule}\n- “群专属头衔”是宿主字段，不是用户自称；没有聊天证据时禁止写成“自称”\n- “机器人应称呼此用户为”描述的是机器人对用户的称呼，禁止反写成用户称呼机器人\n- 严格排除当前机器人自己的观点、建议、性格和行为，不得把机器人画像成目标用户\n- 与机器人有关的互动必须使用当前机器人名字，不要用无法区分对象的泛称“AI”\n- 主人身份只依据目标身份中的“机器人主人”标记，不要据此杜撰现实关系\n- 保留稳定偏好、长期项目、互动风格和重要关系\n- 不要编造；证据不足的内容不要写\n- 第一行写身份摘要，格式为“身份：显示名（QQ号）/ 角色”\n- 其余用简洁项目符号输出`
}

function formatTargetIdentity (identity, targetId, scope) {
  if (scope === 'group') return `群整体（群号:${targetId}）；不是单个成员画像`
  if (!identity) return `未知显示名（QQ:${String(targetId).split(':').at(-1)}）；主人:未知`
  return `${identity.displayName || identity.nickname || identity.userId || '未知用户'}（QQ:${identity.userId || String(targetId).split(':').at(-1)}）；群名片:${identity.card || '-'}；昵称:${identity.accountNickname || '-'}；群角色:${identity.senderRole || 'member'}；群专属头衔:${identity.senderTitle || '-'}；机器人主人:${identity.isMaster ? '是' : '否'}；机器人应称呼此用户为:${identity.isMaster && identity.appellation ? identity.appellation : '-'}`
}

export function resolveConfiguredAssistantIdentity (config) {
  const presetId = String(config?.loli?.defaultPreset || config?.chaite?.presets?.[0]?.id || '').trim()
  const preset = (config?.chaite?.presets || []).find(item => item.id === presetId) || config?.chaite?.presets?.[0]
  return {
    userId: String(config?.loli?.botUserId || '').trim(),
    presetId: String(preset?.id || presetId || '').trim(),
    name: String(preset?.name || preset?.id || presetId || 'AI助手').trim() || 'AI助手'
  }
}

function formatAssistantIdentity (identity = {}) {
  const name = String(identity.name || identity.displayName || 'AI助手').trim() || 'AI助手'
  const presetId = String(identity.presetId || '').trim()
  const userId = String(identity.userId || '').trim()
  return `${name}${presetId ? `（预设:${presetId}）` : ''}${userId ? `；机器人QQ:${userId}` : ''}`
}
