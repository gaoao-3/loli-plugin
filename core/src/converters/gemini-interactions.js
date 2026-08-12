import { randomUUID } from 'crypto'

function interactionContent (part) {
  if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
    return { type: 'text', text: part.text }
  }
  if (part?.type === 'image' && part.image) {
    return {
      type: 'image',
      data: part.image,
      mime_type: part.mimeType || 'image/jpeg'
    }
  }
  return null
}

function legacyCallId (message, index) {
  const base = String(message?.id || 'message').replace(/[^a-zA-Z0-9_-]/g, '_')
  return `legacy_${base}_${index}`
}

/** 将本地统一历史转换为 Interactions API 的步骤时间线。 */
export function toInteractionSteps (histories = []) {
  const steps = []
  const pendingByName = new Map()

  const rememberCall = (name, id) => {
    const queue = pendingByName.get(name) || []
    queue.push(id)
    pendingByName.set(name, queue)
  }
  const resolveCall = (name, explicitId, message, index) => {
    if (explicitId) return explicitId
    const queue = pendingByName.get(name)
    if (queue?.length) return queue.shift()
    return legacyCallId(message, index)
  }

  for (const message of histories || []) {
    if (!message || message.role === 'system') continue
    const parts = Array.isArray(message.content) ? message.content : []

    if (message.role === 'user') {
      const content = parts.map(interactionContent).filter(Boolean)
      if (content.length > 0) steps.push({ type: 'user_input', content })
      continue
    }

    if (message.role === 'assistant') {
      let output = []
      const flushOutput = () => {
        if (output.length > 0) steps.push({ type: 'model_output', content: output })
        output = []
      }

      parts.forEach((part, index) => {
        const content = interactionContent(part)
        if (content) {
          output.push(content)
          return
        }
        if (part?.type === 'reasoning') {
          flushOutput()
          const summary = typeof part.text === 'string' && part.text
            ? [{ type: 'text', text: part.text }]
            : []
          if (summary.length > 0 || part.thoughtSignature) {
            steps.push({
              type: 'thought',
              ...(summary.length > 0 ? { summary } : {}),
              ...(part.thoughtSignature ? { signature: part.thoughtSignature } : {})
            })
          }
          return
        }
        if (part?.type === 'toolCall' && part.name) {
          flushOutput()
          const id = part.toolId || legacyCallId(message, index)
          let args = {}
          try { args = JSON.parse(part.args || '{}') } catch {}
          steps.push({
            type: 'function_call',
            id,
            name: part.name,
            arguments: args,
            ...(part.thoughtSignature ? { signature: part.thoughtSignature } : {})
          })
          rememberCall(part.name, id)
        }
      })
      flushOutput()
      continue
    }

    if (message.role === 'tool') {
      parts.forEach((part, index) => {
        if (part?.type !== 'toolCallResult' || !part.name) return
        steps.push({
          type: 'function_result',
          call_id: resolveCall(part.name, part.toolId, message, index),
          name: part.name,
          result: [{ type: 'text', text: String(part.content ?? '') }]
        })
      })
    }
  }

  return steps
}

/** 有 previous_interaction_id 时只发送本轮新增的最后一条消息。 */
export function toInteractionDelta (histories = []) {
  const last = [...(histories || [])].reverse().find(message => message?.role !== 'system')
  return last ? toInteractionSteps([last]) : []
}

function normalizeNumber (value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

export function normalizeInteractionUsage (usage) {
  if (!usage || typeof usage !== 'object') return null
  const normalized = {
    inputTokens: normalizeNumber(usage.total_input_tokens),
    outputTokens: normalizeNumber(usage.total_output_tokens),
    reasoningTokens: normalizeNumber(usage.total_thought_tokens),
    toolTokens: normalizeNumber(usage.total_tool_use_tokens),
    cachedTokens: normalizeNumber(usage.total_cached_tokens),
    totalTokens: normalizeNumber(usage.total_tokens)
  }
  for (const key of Object.keys(normalized)) {
    if (normalized[key] === undefined) delete normalized[key]
  }
  return Object.keys(normalized).length > 0 ? normalized : null
}

/** Interaction.steps → 插件统一消息。 */
export function intoChaiteInteraction (interaction, model) {
  const content = []

  for (const step of interaction?.steps || []) {
    if (step?.type === 'thought') {
      const text = (step.summary || [])
        .filter(item => item?.type === 'text')
        .map(item => item.text || '')
        .join('')
      content.push({
        type: 'reasoning',
        text,
        ...(step.signature ? { thoughtSignature: step.signature } : {})
      })
      continue
    }
    if (step?.type === 'function_call') {
      content.push({
        type: 'toolCall',
        toolId: step.id,
        name: step.name,
        args: JSON.stringify(step.arguments || {}),
        ...(step.signature ? { thoughtSignature: step.signature } : {})
      })
      continue
    }
    if (step?.type !== 'model_output') continue
    for (const item of step.content || []) {
      if (item?.type === 'text') {
        content.push({ type: 'text', text: item.text || '' })
      } else if (item?.type === 'image' && (item.data || item.uri)) {
        content.push({
          type: 'image',
          image: item.data || item.uri,
          mimeType: item.mime_type || 'image/png'
        })
      }
    }
  }

  if (content.length === 0 && typeof interaction?.output_text === 'string') {
    content.push({ type: 'text', text: interaction.output_text })
  }

  const usage = normalizeInteractionUsage(interaction?.usage)
  return {
    id: randomUUID(),
    role: 'assistant',
    content,
    model,
    interactionId: interaction?.id,
    ...(usage ? { usage } : {}),
    timestamp: Date.now()
  }
}
