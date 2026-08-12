/**
 * 现行记忆任务共用的模型调用与原始证据维护。
 *
 * 长期摘要、画像和语义向量管线已经移除；这里仅服务于：
 * - 群风格学习
 * - 群友用户印象
 * - 会话历史滚动压缩
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  pruneOldMessages,
  pruneProcessedMessages,
  updateSchedulerRun
} from './store.js'
import { getMessageRetentionDays } from './options.js'
import { resolveGeminiSafetySettings } from '../core/src/clients/gemini.js'
import { GcilClient } from '../core/src/clients/gcil.js'
import { AntigravityClient } from '../core/src/clients/antigravity.js'

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000
const FIRST_MAINTENANCE_DELAY_MS = 60 * 1000
const REQUEST_TIMEOUT_MS = 45 * 1000
const REQUEST_RETRIES = 2

let maintenanceHandle = null
let maintenanceTimeout = null

const __filename = fileURLToPath(import.meta.url)
const PLUGIN_ROOT = path.dirname(path.dirname(__filename))

export function startScheduler (opts = {}) {
  if (maintenanceHandle || maintenanceTimeout) return

  const rawDir = opts.dataDir || 'data/memory/md'
  const dataDir = path.isAbsolute(rawDir) ? rawDir : path.resolve(PLUGIN_ROOT, rawDir)
  const log = opts.logger || { info (message) { console.log(message) }, warn (message) { console.warn(message) } }

  maintenanceTimeout = setTimeout(() => {
    maintenanceTimeout = null
    runMemoryMaintenance(dataDir, log).catch(err => log.warn(`[Memory] 维护任务异常: ${formatError(err)}`))
    maintenanceHandle = setInterval(() => {
      runMemoryMaintenance(dataDir, log).catch(err => log.warn(`[Memory] 维护任务异常: ${formatError(err)}`))
    }, MAINTENANCE_INTERVAL_MS)
  }, FIRST_MAINTENANCE_DELAY_MS)

  log.info('[Memory] SQLite 维护任务启动；已消费证据按学习游标清理，保留天数作为未处理消息的硬兜底')
}

export function stopScheduler () {
  if (maintenanceTimeout) {
    clearTimeout(maintenanceTimeout)
    maintenanceTimeout = null
  }
  if (maintenanceHandle) {
    clearInterval(maintenanceHandle)
    maintenanceHandle = null
  }
}

export async function runMemoryMaintenance (baseDir, log = console) {
  const stats = { processed: 0, succeeded: 0, failed: 0 }
  updateSchedulerRun(baseDir, 'maintenance', {
    startedAt: Date.now(), finishedAt: null, status: 'running', ...stats, error: null
  })
  try {
    const processed = pruneProcessedMessages(baseDir)
    const expired = pruneOldMessages(baseDir, getMessageRetentionDays(getConfig()))
    const pruned = processed.total + expired
    stats.processed = pruned
    stats.succeeded = pruned
    if (processed.total) {
      log.info(`[Memory] 已清理 ${processed.consumed} 条双方已消费证据、${processed.obsolete} 条旧格式重复消息`)
    }
    if (expired) log.info(`[Memory] 已清理 ${expired} 条超过保留期的未处理消息`)
    updateSchedulerRun(baseDir, 'maintenance', {
      finishedAt: Date.now(), status: 'success', ...stats
    })
    return stats
  } catch (err) {
    stats.failed = 1
    updateSchedulerRun(baseDir, 'maintenance', {
      finishedAt: Date.now(), status: 'failed', ...stats, error: formatError(err)
    })
    throw err
  }
}

export async function callMemoryAI (prompt, { task = 'member_memory', log } = {}) {
  const cfg = getConfig()
  const memoryConfig = cfg?.memory || {}
  const groupLearningConfig = memoryConfig.groupLearning || {}
  const memberConfig = memoryConfig.memberLearning || {}
  const historyConfig = cfg?.llm?.historyCompress || {}
  const taskConfig = task === 'group_learning'
    ? groupLearningConfig
    : task === 'history_compress'
      ? historyConfig
      : memberConfig
  const channelId = taskConfig.channelId ||
    groupLearningConfig.channelId ||
    memberConfig.channelId ||
    'gemini'
  const channel = resolveChannel(cfg, channelId)
  if (!channel) throw new Error(`未找到可用渠道${channelId ? `: ${channelId}` : ''}`)

  const fallbackModel = cfg?.chaite?.presets?.[0]?.sendMessageOption?.model ||
    firstChannelModel(channel) ||
    'gemini-2.5-flash'
  const model = taskConfig.model ||
    groupLearningConfig.model ||
    memberConfig.model ||
    fallbackModel
  const apiKey = channel?.options?.apiKey || ''
  const baseUrl = channel?.options?.baseUrl || ''
  const safetySettings = resolveGeminiSafetySettings(channel?.options?.safetyLevel)
  const adapterType = channel?.adapterType || 'gemini'
  const taskLabel = task === 'group_learning'
    ? '群风格学习'
    : task === 'history_compress'
      ? '会话历史压缩'
      : '群友用户印象'

  // OAuth 渠道（GCIL / Antigravity）无 API Key，走对应客户端
  if (adapterType === 'gcil' || adapterType === 'antigravity') {
    log?.info?.(`[Memory] 调用${taskLabel}模型: channel=${channel.id || 'unknown'}, model=${model}`)
    const dataDir = path.join(PLUGIN_ROOT, 'data')
    const clientOpts = {
      dataDir,
      channelId: channel.id,
      options: channel.options || {},
      logger: message => log?.info?.(message)
    }
    const client = adapterType === 'gcil'
      ? new GcilClient(clientOpts)
      : new AntigravityClient(clientOpts)
    const response = await client._sendMessage(
      [{ role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() }],
      {
        model,
        maxTokens: task === 'member_memory' ? 1600 : 1024,
        conversationId: `memory-${task}-${Date.now()}`,
        disableTools: true
      }
    )
    const text = client._extractText(response).trim()
    if (!text) throw new Error(`渠道 ${channel.id || 'unknown'} / 模型 ${model}: 响应中没有文本`)
    return text
  }

  if (!apiKey) throw new Error(`渠道 ${channel.id || channelId || 'unknown'} 未配置 API Key`)

  const url = (baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '') +
    `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
  log?.info?.(`[Memory] 调用${taskLabel}模型: channel=${channel.id || 'unknown'}, model=${model}`)

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: task === 'member_memory' ? 1600 : 1024
      },
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
  return channels.find(channel => channel.status !== 'disabled' && ['gemini', 'aistudio'].includes(channel.adapterType)) ||
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
