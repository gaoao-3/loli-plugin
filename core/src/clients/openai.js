/**
 * OpenAI API 客户端
 */
import OpenAI from 'openai'
import { AbstractClient } from './abstract.js'
import { fromChaiteConverter, intoChaiteConverter } from '../converters/openai.js'

/** 把内部 Gemini FunctionDeclaration 转为 OpenAI Chat Completions tool。 */
export function toOpenAITool (value) {
  const raw = value?.toolDef || value
  const declaration = raw?.function || raw
  if (!declaration?.name) return null
  const openAIFunction = {
    name: declaration.name,
    ...(declaration.description ? { description: declaration.description } : {}),
    parameters: declaration.parameters ||
      declaration.parametersJsonSchema ||
      { type: 'object', properties: {} },
    ...(declaration.strict !== undefined ? { strict: declaration.strict } : {})
  }
  return { type: 'function', function: openAIFunction }
}

export class OpenAIClient extends AbstractClient {
  get adapterType () { return 'openai' }

  async _sendMessage (histories, options = {}) {
    const apiKey = this.options.apiKey
    if (!apiKey) throw new Error('OpenAI API key not configured')

    const model = options.model || this.options.model || 'gpt-4o'
    const temperature = options.temperature ?? 0.9
    const maxTokens = options.maxTokens || 2048

    const client = new OpenAI({
      apiKey,
      baseURL: this.options.baseUrl || undefined
    })

    const messages = []
    for (const h of histories) {
      const converted = fromChaiteConverter(h)
      if (Array.isArray(converted)) {
        messages.push(...converted)
      } else if (converted) {
        messages.push(converted)
      }
    }

    // 工具
    const toolDefs = (options.disableTools ? [] : (options.tools || []))
      .map(toOpenAITool)
      .filter(Boolean)

    /** @type {Object} */
    const params = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens
    }
    if (options.topP !== undefined) params.top_p = options.topP
    if (toolDefs.length > 0) {
      params.tools = toolDefs
      params.tool_choice = 'auto'
    }

    // 思考模式 (OpenAI o-series reasoning_effort)
    if (options.enableReasoning) {
      const effortMap = { OFF: 'minimal', MINIMAL: 'minimal', LOW: 'low', MEDIUM: 'medium', HIGH: 'high' }
      const level = String(options.thinkingLevel || options.reasoningEffort || 'LOW').toUpperCase()
      const effort = effortMap[level] || 'low'
      if (effort === 'minimal') {
        // minimal: 不发送 reasoning_effort，让模型自行决定
      } else {
        params.reasoning_effort = effort
      }
      // o-series 不支持 temperature
      if (model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')) {
        delete params.temperature
        delete params.max_tokens
      }
    }

    const completion = await client.chat.completions.create(params)
    return intoChaiteConverter(completion.choices[0], model, completion.usage)
  }
}
