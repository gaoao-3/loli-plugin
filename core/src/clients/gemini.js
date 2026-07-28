/**
 * Gemini API 客户端
 * 基于 @google/genai SDK
 */
import { GoogleGenAI } from '@google/genai'
import { AbstractClient } from './abstract.js'
import { fromChaiteConverter, intoChaiteConverter } from '../converters/gemini.js'

const SAFETY_CATEGORIES = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT'
]

const SAFETY_THRESHOLDS = {
  off: 'OFF',
  permissive: 'BLOCK_ONLY_HIGH',
  balanced: 'BLOCK_MEDIUM_AND_ABOVE',
  strict: 'BLOCK_LOW_AND_ABOVE'
}

const THOUGHT_SIGNATURE_VALIDATOR_BYPASS = 'skip_thought_signature_validator'

export function normalizeGeminiSafetyLevel (value) {
  const level = String(value || 'default').trim().toLowerCase()
  return ['default', ...Object.keys(SAFETY_THRESHOLDS)].includes(level) ? level : 'default'
}

export function resolveGeminiSafetySettings (value) {
  const threshold = SAFETY_THRESHOLDS[normalizeGeminiSafetyLevel(value)]
  if (!threshold) return undefined
  return SAFETY_CATEGORIES.map(category => ({ category, threshold }))
}

/** 转为 Gemini generateContent 原生 FunctionDeclaration。 */
export function toGeminiFunctionDeclaration (value) {
  const raw = value?.toolDef || value
  const declaration = raw?.function || raw
  if (!declaration?.name) return null
  const {
    type: _type,
    run: _run,
    toolDef: _toolDef,
    function: _function,
    ...geminiDeclaration
  } = declaration
  return geminiDeclaration
}

export function isGeminiThoughtSignatureError (error) {
  return /(?:invalid|corrupted|missing)[^.\n]*thought[_ ]signature|thought[_ ]signature[^.\n]*(?:invalid|corrupted|missing)/i
    .test(String(error?.message || ''))
}

/**
 * 某些 Gemini 兼容渠道会返回不可被它自身再次校验的损坏签名。
 * 仅在服务端已经明确报签名错误后使用官方保底值重试，不主动降级正常签名。
 */
export function withSkippedFunctionCallSignatures (contents) {
  let replacements = 0
  const patched = (contents || []).map(content => {
    let contentChanged = false
    const parts = (content?.parts || []).map(part => {
      if (!part?.functionCall || part.thoughtSignature === THOUGHT_SIGNATURE_VALIDATOR_BYPASS) {
        return part
      }
      replacements++
      contentChanged = true
      return {
        ...part,
        thoughtSignature: THOUGHT_SIGNATURE_VALIDATOR_BYPASS
      }
    })
    return contentChanged ? { ...content, parts } : content
  })
  return {
    contents: replacements > 0 ? patched : contents,
    replacements
  }
}

export class GeminiClient extends AbstractClient {
  get adapterType () { return 'gemini' }

  async #persistSignatureBypass (histories) {
    const changedMessages = []
    for (const message of histories || []) {
      let changed = false
      for (const part of message?.content || []) {
        if (part?.type !== 'toolCall' || part.thoughtSignature === THOUGHT_SIGNATURE_VALIDATOR_BYPASS) {
          continue
        }
        part.thoughtSignature = THOUGHT_SIGNATURE_VALIDATOR_BYPASS
        changed = true
      }
      if (changed && message.id && message.conversationId) changedMessages.push(message)
    }

    for (const message of changedMessages) {
      try {
        await this.storage.saveHistory(message)
      } catch (error) {
        this.logger?.(`[Gemini] failed to persist thought signature bypass: ${error.message}`)
      }
    }
  }

  /**
   * 发送消息到 Gemini API
   * @param {UnifiedMessage[]} histories
   * @param {Object} options
   * @returns {Promise<UnifiedMessage>}
   */
  async _sendMessage (histories, options = {}) {
    const apiKey = this.options.apiKey
    if (!apiKey) throw new Error('Gemini API key not configured')

    const model = options.model || this.options.model || 'gemini-2.5-flash'
    const temperature = options.temperature ?? 0.9
    const maxOutputTokens = options.maxTokens || 2048
    const safetySettings = resolveGeminiSafetySettings(options.safetyLevel ?? this.options.safetyLevel)
    const includeServerSideToolInvocations =
      options.includeServerSideToolInvocations ??
      this.options.includeServerSideToolInvocations

    // 初始化客户端
    const genAI = new GoogleGenAI({
      apiKey,
      httpOptions: { baseUrl: this.options.baseUrl || undefined }
    })

    // 转换消息
    const sysMsg = histories.find(h => h.role === 'system')
    const contents = histories
      .filter(h => h.role !== 'system')
      .map(h => fromChaiteConverter(h))
      .filter(Boolean)

    // 转换工具
    const toolDeclarations = (options.disableTools ? [] : (options.tools || []))
      .map(toGeminiFunctionDeclaration)
      .filter(Boolean)

    const convertResponse = (response) => {
      return intoChaiteConverter(response, model)
    }

    // 构建请求
    /** @type {Object} */
    const generateConfig = {
      model,
      contents,
      config: {
        temperature,
        maxOutputTokens,
        ...(options.topP !== undefined ? { topP: options.topP } : {}),
        ...(safetySettings ? { safetySettings } : {}),
        ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
        ...(options.responseJsonSchema ? { responseJsonSchema: options.responseJsonSchema } : {}),
        ...(!options.responseJsonSchema && options.responseSchema ? { responseSchema: options.responseSchema } : {})
      }
    }

    // 思考模式 (Gemini thinking signature 兼容)
    if (options.enableReasoning) {
      /** @type {import('@google/genai').ThinkingLevel} */
      let thinkingLevel
      const requestedLevel = String(options.thinkingLevel || options.reasoningEffort || 'LOW').toUpperCase()
      switch (requestedLevel) {
        case 'OFF':
        case 'MINIMAL':
          thinkingLevel = 'MINIMAL'
          break
        case 'LOW':
          thinkingLevel = 'LOW'
          break
        case 'MEDIUM':
          thinkingLevel = 'MEDIUM'
          break
        case 'HIGH':
          thinkingLevel = 'HIGH'
          break
        default:
          thinkingLevel = 'LOW'
      }

      generateConfig.config.thinkingConfig = {
        thinkingLevel,
        includeThoughts: true
      }
    }

    // 工具声明
    if (toolDeclarations.length > 0) {
      generateConfig.config.tools = [{ functionDeclarations: toolDeclarations }]
      const toolConfig = {}
      if (includeServerSideToolInvocations) {
        toolConfig.includeServerSideToolInvocations = true
      }
      if (options.toolChoice || options.functionCallingMode) {
        toolConfig.functionCallingConfig = {
          mode: options.toolChoice || options.functionCallingMode
        }
      }
      if (Object.keys(toolConfig).length > 0) generateConfig.config.toolConfig = toolConfig
    }

    // 系统提示
    if (sysMsg && contents.length > 0) {
      generateConfig.config.systemInstruction = {
        parts: [{ text: sysMsg.content?.[0]?.text || '' }]
      }
    }

    try {
      const response = await genAI.models.generateContent(generateConfig)
      return convertResponse(response)
    } catch (err) {
      const isSignatureError = isGeminiThoughtSignatureError(err)

      if (isSignatureError) {
        const fallback = withSkippedFunctionCallSignatures(generateConfig.contents)
        if (fallback.replacements > 0) {
          this.logger?.(
            `[Gemini] invalid thought signature from upstream; retrying ${fallback.replacements} function call part(s) with validator bypass`
          )
          const retryConfig = {
            ...generateConfig,
            contents: fallback.contents
          }
          const response = await genAI.models.generateContent(retryConfig)
          // 上游已确认这些签名无效；同步修复内存与持久化历史，
          // 避免后续每次请求都先触发一次相同的 400。
          await this.#persistSignatureBypass(histories)
          return convertResponse(response)
        }
      }

      // 首次请求尚无 functionCall 可替换时，兼容旧渠道：关闭思考模式重试一次。
      if (isSignatureError && generateConfig.config.thinkingConfig) {
        this.logger?.('[Gemini] thought signature error before tool call; retrying without thinking mode')
        const retryConfig = {
          ...generateConfig,
          config: { ...generateConfig.config }
        }
        delete retryConfig.config.thinkingConfig
        try {
          const response = await genAI.models.generateContent(retryConfig)
          return convertResponse(response)
        } catch (retryErr) {
          throw retryErr
        }
      }

      // Gemini SDK 有时把非正常响应包进 Error
      if (err.message?.includes('candidates') || err.status === 400) {
        this.logger?.warn?.('[Gemini] API error:', err.message?.slice(0, 200))
      }
      throw err
    }
  }
}
