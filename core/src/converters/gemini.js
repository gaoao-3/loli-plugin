/**
 * Gemini 消息格式转换器
 * 在 Chaite 统一格式 ↔ Gemini Content/Part 之间转换
 */
import { randomUUID } from 'crypto'

/**
 * UnifiedMessage → Gemini Content[]
 * @param {UnifiedMessage} msg
 * @returns {import('@google/genai').Content}
 */
export function fromChaiteConverter (msg) {
  if (!msg || !msg.role) return null

  switch (msg.role) {
    case 'system': {
      return {
        role: 'user',
        parts: [{ text: '[系统] ' + (msg.content?.[0]?.text || '') }]
      }
    }
    case 'user': {
      const parts = []
      for (const c of (msg.content || [])) {
        switch (c.type) {
          case 'text': {
            if (typeof c.text === 'string' && c.text.trim()) {
              parts.push({ text: c.text })
            }
            break
          }
          case 'image': {
            parts.push({
              inlineData: {
                mimeType: c.mimeType || 'image/jpeg',
                data: c.image
              }
            })
            break
          }
        }
      }
      return parts.length > 0 ? { role: 'user', parts } : null
    }
    case 'assistant': {
      const parts = []
      for (const c of (msg.content || [])) {
        switch (c.type) {
          case 'text': {
            if (typeof c.text === 'string' && c.text.trim()) {
              /** @type {import('@google/genai').Part} */
              const part = { text: c.text }
              if (c.thoughtSignature) part.thoughtSignature = c.thoughtSignature
              parts.push(part)
            }
            break
          }
          case 'reasoning': {
            /** @type {import('@google/genai').Part} */
            const part = { text: c.text || '', thought: true }
            if (c.thoughtSignature) part.thoughtSignature = c.thoughtSignature
            parts.push(part)
            break
          }
          case 'image': {
            /** @type {import('@google/genai').Part} */
            const part = {
              inlineData: {
                mimeType: c.mimeType || 'image/jpeg',
                data: c.image
              }
            }
            if (c.thoughtSignature) part.thoughtSignature = c.thoughtSignature
            parts.push(part)
            break
          }
          case 'toolCall': {
            /** @type {import('@google/genai').Part} */
            const part = {
              functionCall: {
                name: c.name || '',
                args: c.args ? JSON.parse(c.args) : {},
                ...(c.toolId ? { id: c.toolId } : {})
              }
            }
            if (c.thoughtSignature) part.thoughtSignature = c.thoughtSignature
            parts.push(part)
            break
          }
        }
      }
      return parts.length > 0 ? { role: 'model', parts } : null
    }
    case 'tool': {
      return {
        role: 'user',
        parts: msg.content.map(tcr => ({
          functionResponse: {
            name: tcr.name || '',
            response: { result: parseToolResult(tcr.content) },
            ...(tcr.toolId ? { id: tcr.toolId } : {})
          }
        }))
      }
    }
    default:
      return null
  }
}

/**
 * Gemini GenerateContentResponse → UnifiedMessage
 * @param {import('@google/genai').GenerateContentResponse} response
 * @param {string} [model]
 * @returns {UnifiedMessage}
 */
export function intoChaiteConverter (response, model) {
  const id = randomUUID()
  const content = []
  const usage = normalizeGeminiUsage(response.usageMetadata)

  if (!response.candidates?.[0]?.content?.parts) {
    return {
      id,
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      ...(usage ? { usage } : {}),
      timestamp: Date.now()
    }
  }

  for (const part of response.candidates[0].content.parts) {
    const thoughtSignature = getThoughtSignature(part)
    if (part.text !== undefined && part.text !== null) {
      // 检查是否是 reasoning/thought
      const isReasoning = part.thought === true
      content.push({
        type: isReasoning ? 'reasoning' : 'text',
        text: part.text,
        thoughtSignature
      })
    } else if (part.functionCall) {
      content.push({
        type: 'toolCall',
        toolId: part.functionCall.id || undefined,
        name: part.functionCall.name,
        args: JSON.stringify(part.functionCall.args || {}),
        thoughtSignature
      })
    }
    // 处理仅有签名无文本的 thinking block（多轮对话连续性需要）
    else if (part.thought === true && thoughtSignature) {
      content.push({
        type: 'reasoning',
        text: '',
        thoughtSignature
      })
    }
  }

  return {
    id,
    role: 'assistant',
    content,
    ...(usage ? { usage } : {}),
    timestamp: Date.now()
  }
}

/** 把 Gemini SDK / 兼容代理的 usageMetadata 归一化为引擎统一字段。 */
export function normalizeGeminiUsage (metadata) {
  if (!metadata || typeof metadata !== 'object') return null
  const usage = compactUsage({
    inputTokens: tokenNumber(metadata.promptTokenCount ?? metadata.prompt_token_count),
    outputTokens: tokenNumber(metadata.candidatesTokenCount ?? metadata.candidates_token_count),
    reasoningTokens: tokenNumber(metadata.thoughtsTokenCount ?? metadata.thoughts_token_count),
    toolTokens: tokenNumber(metadata.toolUsePromptTokenCount ?? metadata.tool_use_prompt_token_count),
    cachedTokens: tokenNumber(metadata.cachedContentTokenCount ?? metadata.cached_content_token_count),
    totalTokens: tokenNumber(
      metadata.totalTokenCount ??
      metadata.total_token_count ??
      metadata.totalTokens
    )
  })
  if (!usage) return null
  if (usage.totalTokens === undefined) {
    usage.totalTokens =
      (usage.inputTokens || 0) +
      (usage.outputTokens || 0) +
      (usage.reasoningTokens || 0) +
      (usage.toolTokens || 0)
  }
  return usage
}

/**
 * 提取 toolCalls 列表
 * @param {UnifiedMessage} msg
 * @returns {Array<{name:string, args:Object}>}
 */
export function extractToolCalls (msg) {
  if (!msg || msg.role !== 'assistant') return []
  return (msg.content || [])
    .filter(c => c.type === 'toolCall')
    .map(c => ({ name: c.name, args: c.args ? JSON.parse(c.args) : {} }))
}

/**
 * 提取纯文本内容（含 reasoning）
 * @param {UnifiedMessage} msg
 * @returns {string}
 */
export function extractText (msg) {
  if (!msg) return ''
  return (msg.content || [])
    .filter(c => (c.type === 'text' || c.type === 'reasoning') && c.text)
    .map(c => c.text)
    .join('\n')
}

function parseToolResult (content) {
  if (typeof content !== 'string') return content
  try {
    return JSON.parse(content)
  } catch {
    return content || ''
  }
}

/**
 * 官方 SDK 使用 camelCase；部分 Gemini 兼容代理仍返回 REST snake_case。
 * 统一为内部 thoughtSignature，回传 SDK 时仍使用官方 camelCase。
 */
function getThoughtSignature (part) {
  const signature = part?.thoughtSignature ?? part?.thought_signature
  return typeof signature === 'string' && signature ? signature : undefined
}

function tokenNumber (value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : undefined
}

function compactUsage (usage) {
  const entries = Object.entries(usage).filter(([, value]) => value !== undefined)
  return entries.length > 0 ? Object.fromEntries(entries) : null
}
