import {
  listChunksMissingEmbedding,
  listEmbeddedChunks,
  upsertEmbedding
} from './store.js'

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com'
const REQUEST_TIMEOUT_MS = 45 * 1000
const REQUEST_RETRIES = 2

export function getEmbeddingConfig (config = {}) {
  const embedding = config?.memory?.embedding || {}
  const provider = embedding.provider || 'gemini'
  const channel = (config?.chaite?.channels || []).find(ch => ch.id === (embedding.channelId || 'gemini')) ||
    (config?.chaite?.channels || []).find(ch => ch.adapterType === 'gemini') ||
    (config?.chaite?.channels || [])[0]

  return {
    enable: embedding.enable !== false,
    provider,
    channelId: embedding.channelId || channel?.id || 'gemini',
    model: embedding.model || 'gemini-embedding-2',
    outputDimensionality: Number(embedding.outputDimensionality || 768),
    topK: Number(embedding.topK || 8),
    minScore: Number(embedding.minScore ?? 0.2),
    batchSize: Number(embedding.batchSize || 8),
    apiKey: embedding.apiKey || channel?.options?.apiKey || '',
    baseUrl: embedding.baseUrl || channel?.options?.baseUrl || DEFAULT_BASE_URL
  }
}

export async function embedPendingChunks ({ baseDir, config, logger, limit }) {
  const cfg = getEmbeddingConfig(config)
  if (!cfg.enable || cfg.provider !== 'gemini' || !cfg.apiKey) return 0

  const chunks = listChunksMissingEmbedding(baseDir, {
    provider: cfg.provider,
    model: cfg.model,
    dimensions: cfg.outputDimensionality,
    limit: limit || cfg.batchSize
  })
  let done = 0

  for (const chunk of chunks) {
    const input = formatDocumentForEmbedding(chunk.text, chunk.title)
    try {
      const vector = await embedText(input, cfg)
      if (!vector.length) continue
      upsertEmbedding(baseDir, {
        chunkId: chunk.id,
        provider: cfg.provider,
        model: cfg.model,
        dimensions: vector.length,
        vector: vectorToBlob(vector),
        hash: chunk.hash
      })
      done++
    } catch (err) {
      logger?.warn?.(`[Memory] chunk ${chunk.id} embedding 失败: ${err.message.slice(0, 120)}`)
    }
  }

  return done
}

export async function searchRelevantChunks ({ baseDir, config, groupId, userId, queryText }) {
  const cfg = getEmbeddingConfig(config)
  const query = String(queryText || '').trim()
  if (!cfg.enable || cfg.provider !== 'gemini' || !cfg.apiKey || !query) return []

  const targets = []
  if (groupId) targets.push({ scope: 'group', targetId: String(groupId) })
  if (userId) {
    targets.push(groupId
      ? { scope: 'group_user', targetId: `${groupId}:${userId}` }
      : { scope: 'private_user', targetId: String(userId) })
  }
  if (targets.length === 0) return []

  const queryVector = await embedText(formatQueryForEmbedding(query), cfg)
  if (!queryVector.length) return []

  const candidates = listEmbeddedChunks(baseDir, {
    provider: cfg.provider,
    model: cfg.model,
    targets,
    limit: 0
  })

  return candidates
    .map(row => ({
      ...row,
      score: cosineSimilarity(queryVector, blobToVector(row.vector))
    }))
    .filter(row => Number.isFinite(row.score) && row.score >= cfg.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, cfg.topK)
}

export async function embedText (text, cfg) {
  const model = cfg.model || 'gemini-embedding-2'
  const baseUrl = (cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '')
  const apiRoot = baseUrl.endsWith('/v1beta') ? baseUrl : `${baseUrl}/v1beta`
  const url = `${apiRoot}/models/${encodeURIComponent(model)}:embedContent`
  const body = {
    model: `models/${model}`,
    content: { parts: [{ text }] },
    output_dimensionality: cfg.outputDimensionality || 768
  }

  let res
  let lastError
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt++) {
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': cfg.apiKey
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      if (res.ok || res.status < 500 || attempt === REQUEST_RETRIES) break
    } catch (err) {
      lastError = err
      if (attempt === REQUEST_RETRIES) throw err
    }
    await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)))
  }
  if (!res) throw lastError || new Error('Gemini embedding request failed')
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(json?.error?.message || `Gemini embedding HTTP ${res.status}`)
  }

  const values = json?.embedding?.values || json?.embeddings?.[0]?.values || json?.embeddings?.values || []
  return Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : []
}

export function formatQueryForEmbedding (text) {
  return `task: search result | query: ${String(text || '').slice(0, 2000)}`
}

export function formatDocumentForEmbedding (text, title = 'none') {
  const cleanTitle = title || 'none'
  return `title: ${cleanTitle} | text: ${String(text || '').slice(0, 6000)}`
}

export function vectorToBlob (vector) {
  return Buffer.from(new Float32Array(vector).buffer)
}

export function blobToVector (blob) {
  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob)
  const values = new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4))
  return Array.from(values)
}

function cosineSimilarity (a, b) {
  if (a.length === 0 || a.length !== b.length) return Number.NaN
  const n = a.length
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na > 0 && nb > 0 ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}
