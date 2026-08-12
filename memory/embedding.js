import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { fileURLToPath } from 'url'
import { hasGeminiApiKey, withGeminiKeyPool } from '../core/src/clients/gemini-key-pool.js'
import {
  deleteStaleMemberMemoryEmbeddings,
  listMemberMemoryEmbeddings,
  upsertMemberMemoryEmbedding
} from './store.js'

const __filename = fileURLToPath(import.meta.url)
const PLUGIN_ROOT = path.dirname(path.dirname(__filename))

export function normalizeEmbeddingConfig (config = {}) {
  const value = config?.memory?.embedding || {}
  return {
    enable: value.enable === true,
    channelId: String(value.channelId || 'gemini').trim(),
    model: String(value.model || 'gemini-embedding-2').trim(),
    dimensions: clampInteger(value.dimensions, 128, 3072, 768),
    topK: clampInteger(value.topK, 1, 30, 6),
    minSimilarity: clampNumber(value.minSimilarity, -1, 1, 0.25)
  }
}

export function cosineSimilarity (left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length === 0) return -1
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let i = 0; i < left.length; i++) {
    const a = Number(left[i]) || 0
    const b = Number(right[i]) || 0
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  if (leftNorm === 0 || rightNorm === 0) return -1
  return dot / Math.sqrt(leftNorm * rightNorm)
}

/** 复用已配置 Gemini 渠道执行通用文本 Embedding。 */
export async function embedTextsWithConfiguredGemini ({
  config, channelId = 'gemini', model = 'gemini-embedding-2', dimensions = 768, texts = [], taskType
}) {
  const settings = {
    channelId: String(channelId || 'gemini').trim(),
    model: String(model || 'gemini-embedding-2').trim(),
    dimensions: clampInteger(dimensions, 128, 3072, 768)
  }
  const embed = createGeminiEmbedder(config, settings)
  if (!embed) throw new Error(`Gemini Embedding 渠道“${settings.channelId}”未配置 API Key`)
  return embed(texts, taskType, settings)
}

export async function syncMemberMemoryEmbeddings ({
  baseDir, groupId, userId, memories = [], config, logger = console, embedTexts
}) {
  const settings = normalizeEmbeddingConfig(config)
  if (!settings.enable || !baseDir || !groupId || !userId) return { embedded: 0, removed: 0 }
  const embed = embedTexts || createGeminiEmbedder(config, settings)
  if (!embed) return { embedded: 0, removed: 0 }

  const normalized = normalizeMemories(memories)
  const liveKeys = normalized.map(item => item.key)
  const existing = listMemberMemoryEmbeddings(baseDir, groupId, userId, settings.model, settings.dimensions)
  const pending = normalized.filter(item => existing.get(item.key)?.contentHash !== item.contentHash)
  if (pending.length > 0) {
    const vectors = await embed(pending.map(item => item.content), 'RETRIEVAL_DOCUMENT', settings)
    if (vectors.length !== pending.length) throw new Error(`Embedding 数量不匹配: ${vectors.length}/${pending.length}`)
    for (let i = 0; i < pending.length; i++) {
      upsertMemberMemoryEmbedding(baseDir, {
        groupId,
        userId,
        memoryKey: pending[i].key,
        contentHash: pending[i].contentHash,
        model: settings.model,
        dimensions: settings.dimensions,
        vector: vectors[i]
      })
    }
  }
  const removed = deleteStaleMemberMemoryEmbeddings(baseDir, groupId, userId, liveKeys, settings.model, settings.dimensions)
  if (pending.length > 0 || removed > 0) {
    logger?.info?.(`[Embedding] 群 ${groupId} 用户 ${userId}: 新增/更新=${pending.length}, 清理=${removed}`)
  }
  return { embedded: pending.length, removed }
}

export async function rankMemberMemories ({
  baseDir, groupId, userId, queryText, memories = [], config, logger = console, embedTexts
}) {
  const settings = normalizeEmbeddingConfig(config)
  const normalized = normalizeMemories(memories)
  if (!settings.enable || !queryText || normalized.length <= settings.topK) return normalized.map(item => item.memory)

  try {
    await syncMemberMemoryEmbeddings({ baseDir, groupId, userId, memories, config, logger, embedTexts })
    const embed = embedTexts || createGeminiEmbedder(config, settings)
    if (!embed) return fallbackMemories(normalized, settings.topK)
    const [queryVector] = await embed([String(queryText)], 'RETRIEVAL_QUERY', settings)
    const stored = listMemberMemoryEmbeddings(baseDir, groupId, userId, settings.model, settings.dimensions)
    const ranked = normalized
      .map(item => {
        const similarity = cosineSimilarity(queryVector, stored.get(item.key)?.vector)
        const confidence = clampNumber(item.memory?.confidence, 0, 1, 0)
        return { ...item, similarity, score: similarity * 0.85 + confidence * 0.15 }
      })
      .filter(item => item.similarity >= settings.minSimilarity)
      .sort((a, b) => b.score - a.score)
      .slice(0, settings.topK)
    return ranked.length > 0 ? ranked.map(item => item.memory) : fallbackMemories(normalized, settings.topK)
  } catch (error) {
    logger?.warn?.(`[Embedding] 语义召回失败，回退置信度顺序: ${String(error?.message || error).slice(0, 200)}`)
    return fallbackMemories(normalized, settings.topK)
  }
}

function createGeminiEmbedder (config, settings) {
  const channel = resolveChannel(config, settings.channelId)
  if (!hasGeminiApiKey(channel?.options)) return null
  return async (texts, taskType, currentSettings = settings) => {
    const embedding2 = /(?:^|\/)gemini-embedding-2(?:$|[-:])/u.test(currentSettings.model)
    const config = {
      outputDimensionality: currentSettings.dimensions,
      ...(!embedding2 && taskType ? { taskType } : {})
    }
    const contentObjects = texts.map(text => ({
      role: 'user',
      parts: [{ text: embedding2 ? formatEmbedding2Text(text, taskType) : String(text) }]
    }))
    return withGeminiKeyPool(channel.options, async client => {
      const response = await client.models.embedContent({ model: currentSettings.model, contents: contentObjects, config })
      const vectors = (response?.embeddings || []).map(item => Array.from(item?.values || []))
      if (vectors.length === texts.length) return vectors

      // 个别旧网关会错误聚合多条 Content；仅在这种情况下逐条重试。
      const fallback = []
      for (const content of contentObjects) {
        const single = await client.models.embedContent({ model: currentSettings.model, contents: content, config })
        fallback.push(Array.from(single?.embeddings?.[0]?.values || []))
      }
      return fallback
    }, { purpose: `embedding:${currentSettings.model}` })
  }
}

function formatEmbedding2Text (text, taskType) {
  const content = String(text)
  if (taskType === 'RETRIEVAL_QUERY') return `task: search result | query: ${content}`
  if (taskType === 'RETRIEVAL_DOCUMENT') return `title: none | text: ${content}`
  return content
}

function fallbackMemories (normalized, limit) {
  return [...normalized]
    .sort((left, right) => Number(right.memory?.confidence || 0) - Number(left.memory?.confidence || 0))
    .slice(0, limit)
    .map(item => item.memory)
}

function resolveChannel (config, channelId) {
  const configured = (config?.chaite?.channels || []).find(channel => channel?.id === channelId)
  if (hasGeminiApiKey(configured?.options)) return configured
  if (!/^[a-zA-Z0-9_-]+$/u.test(channelId)) return configured
  try {
    return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'data', 'ch', `${channelId}.json`), 'utf8'))
  } catch {
    return configured
  }
}

function normalizeMemories (memories) {
  return (Array.isArray(memories) ? memories : [])
    .filter(memory => String(memory?.content || '').trim())
    .map(memory => {
      const content = String(memory.content).trim()
      const contentHash = createHash('sha256').update(content).digest('hex')
      return { memory, content, contentHash, key: contentHash.slice(0, 24) }
    })
}

function clampInteger (value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback
}

function clampNumber (value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}
