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
  archiveOldSummaries,
  getMessagesForDate,
  getProcessingState,
  getProfile,
  getRecentSummaries,
  getSummary,
  listMessageDates,
  listMessageTargets,
  listSummaryTargets,
  pruneOldMessages,
  updateSchedulerRun,
  upsertProcessingState,
  upsertProfile,
  upsertSummary
} from './store.js'
import { embedPendingChunks } from './embedding.js'

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
        const currHash = simpleHash(raw)
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
        const prompt = buildSummaryPrompt(raw, target.scope, target.targetId, d)
        try {
          const summary = await callAI(prompt, { task: 'summary', scope: target.scope, log })
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
    const pruned = pruneOldMessages(baseDir, config?.memory?.dailyMd?.maxDays || 30)
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
      const currHash = simpleHash(raw)
      const prev = getProfile(baseDir, target.scope, target.targetId)
      if (prev?.hash === currHash) continue

      stats.processed++
      const prompt = buildProfilePrompt(raw, target.scope, target.targetId)
      try {
        const profile = await callAI(prompt, { task: 'profile', scope: target.scope, log })
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
    const config = getConfig()
    if (config?.memory?.archive?.enable !== false) {
      const archived = archiveOldSummaries(baseDir, config?.memory?.archive?.archiveDays || 30)
      if (archived) log.info(`[Memory] 已归档 ${archived} 条旧摘要`)
    }
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

function formatMessages (messages) {
  return messages.map(msg => {
    const name = msg.nickname || msg.user_id || msg.role
    return `[${new Date(msg.created_at).toLocaleTimeString('zh-CN', { hour12: false })}] ${name}: ${msg.text}`
  }).join('\n')
}

async function callAI (prompt, { task = 'summary', scope = 'group', log } = {}) {
  const cfg = getConfig()
  const memoryConfig = cfg?.memory || {}
  const scopeConfig = memoryConfig[scope === 'group' ? 'group' : 'user'] || {}
  const channelId = task === 'profile'
    ? (memoryConfig.refinementChannelId || scopeConfig.channelId || memoryConfig.embedding?.channelId)
    : (scopeConfig.channelId || memoryConfig.extractionChannelId || memoryConfig.embedding?.channelId)
  const channel = resolveChannel(cfg, channelId)
  const fallbackModel = cfg?.chaite?.presets?.[0]?.sendMessageOption?.model || firstChannelModel(channel) || 'gemini-2.5-flash'
  const model = task === 'profile'
    ? (memoryConfig.refinementModel || fallbackModel)
    : (scopeConfig.extractionModel || memoryConfig.extractionModel || memoryConfig.refinementModel || fallbackModel)
  const apiKey = channel?.options?.apiKey || ''
  const baseUrl = channel?.options?.baseUrl || ''
  if (!channel) throw new Error(`未找到可用渠道${channelId ? `: ${channelId}` : ''}`)
  if (!apiKey) throw new Error(`渠道 ${channel.id || channelId || 'unknown'} 未配置 API Key`)

  const url = (baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '') +
    `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

  log?.info?.(`[Memory] 调用 ${task === 'profile' ? '画像' : `${scope}摘要`}模型: channel=${channel.id || 'unknown'}, model=${model}`)
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
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

function buildSummaryPrompt (raw, scope, targetId, date) {
  const label = scope === 'group' ? '群聊' : scope === 'group_user' ? '群内用户' : '私聊用户'
  return `请从以下 ${label}原始对话记录中提取关键事实和短期摘要（每条一行，以 "- " 开头）：\n\n时间: ${date}\n对象: ${targetId}\n\n${truncateConversation(raw)}\n\n规则：\n- 只提取有记忆价值的信息，如偏好、计划、项目、重要事件、稳定观点\n- 区分用户与 AI 的发言，不要把 AI 的建议或猜测当成用户事实\n- 忽略寒暄、表情、无意义闲聊\n- 如果没有值得记录的事实，输出：[NO_FACTS]`
}

function truncateConversation (raw, maxLength = 12000) {
  if (raw.length <= maxLength) return raw
  const marker = '\n\n……中间较早的对话已截断……\n\n'
  const available = maxLength - marker.length
  const headLength = Math.floor(available * 0.35)
  return raw.slice(0, headLength) + marker + raw.slice(-(available - headLength))
}

function buildProfilePrompt (raw, scope, targetId) {
  const label = scope === 'group' ? '群聊' : scope === 'group_user' ? '群内用户' : '私聊用户'
  return `基于以下 ${label}「${targetId}」最近摘要，生成一份简洁长期画像：\n\n${raw.slice(0, 6000)}\n\n要求：\n- 保留稳定偏好、长期项目、互动风格和重要关系\n- 不要编造\n- 用简洁项目符号输出`
}
