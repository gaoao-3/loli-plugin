/**
 * Gemini API 客户端
 * 基于 @google/genai SDK
 */
import { AbstractClient } from './abstract.js'
import { hasGeminiApiKey, withGeminiKeyPool } from './gemini-key-pool.js'
import { fromChaiteConverter, intoChaiteConverter } from '../converters/gemini.js'
import {
  intoChaiteInteraction,
  toInteractionDelta,
  toInteractionSteps
} from '../converters/gemini-interactions.js'

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

export const GEMINI_BUILTIN_TOOLS = [
  'google_search',
  'code_execution',
  'google_maps',
  'url_context'
]

const GENERATE_CONTENT_BUILTIN_TOOLS = {
  google_search: 'googleSearch',
  code_execution: 'codeExecution',
  google_maps: 'googleMaps',
  url_context: 'urlContext'
}

export function normalizeGeminiBuiltinTools (value) {
  if (!Array.isArray(value)) return []
  const allowed = new Set(GEMINI_BUILTIN_TOOLS)
  const normalized = [...new Set(value.map(item => String(item || '').trim().toLowerCase()))]
    .filter(name => allowed.has(name))
  // Google 当前拒绝在同一请求中组合 Maps 与 Code Execution；保持先配置者。
  if (normalized.includes('google_maps') && normalized.includes('code_execution')) {
    const mapsIndex = normalized.indexOf('google_maps')
    const codeIndex = normalized.indexOf('code_execution')
    normalized.splice(Math.max(mapsIndex, codeIndex), 1)
  }
  return normalized
}

export function toInteractionBuiltinTools (value) {
  return normalizeGeminiBuiltinTools(value).map(type => ({ type }))
}

export function toGenerateContentBuiltinTools (value) {
  return normalizeGeminiBuiltinTools(value)
    .map(name => ({ [GENERATE_CONTENT_BUILTIN_TOOLS[name]]: {} }))
}

export function normalizeGeminiApiMode (value) {
  return String(value || '').trim().toLowerCase() === 'interactions'
    ? 'interactions'
    : 'generateContent'
}

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

/** 转为 Interactions API 的 function tool。 */
export function toInteractionFunctionTool (value) {
  const declaration = toGeminiFunctionDeclaration(value)
  if (!declaration?.name) return null
  return {
    type: 'function',
    name: declaration.name,
    ...(declaration.description ? { description: declaration.description } : {}),
    parameters: declaration.parametersJsonSchema || declaration.parameters || {
      type: 'object',
      properties: {}
    }
  }
}

function interactionErrorStatus (error) {
  return Number(error?.status || error?.statusCode || error?.code)
}

export function isInteractionCompatibilityError (error) {
  const status = interactionErrorStatus(error)
  if ([400, 404, 405, 422, 501].includes(status)) return true
  return /interactions? api|previous_interaction_id|interaction (?:not found|expired)|not implemented/i
    .test(String(error?.message || ''))
}

function normalizeThinkingLevel (options) {
  const requested = String(options.thinkingLevel || options.reasoningEffort || 'LOW').toLowerCase()
  if (requested === 'off') return 'minimal'
  return ['minimal', 'low', 'medium', 'high'].includes(requested) ? requested : 'low'
}

/** 构建 Interactions API 请求，便于独立验证协议边界。 */
export function buildGeminiInteractionRequest ({
  histories,
  options,
  model,
  previousInteractionId,
  systemText,
  interactionInput
}) {
  const generationConfig = {
    max_output_tokens: options.maxTokens || 2048
  }
  if (options.enableReasoning) {
    generationConfig.thinking_level = normalizeThinkingLevel(options)
    generationConfig.thinking_summaries = 'auto'
  }
  const rawToolChoice = options.toolChoice ?? options.functionCallingMode
  const toolChoice = typeof rawToolChoice === 'string' ? rawToolChoice.toLowerCase() : ''
  const allowedTools = Array.isArray(options.allowedTools)
    ? [...new Set(options.allowedTools.map(name => String(name).trim()).filter(Boolean))]
    : []
  if (rawToolChoice && typeof rawToolChoice === 'object') {
    generationConfig.tool_choice = rawToolChoice
  } else if (allowedTools.length > 0) {
    generationConfig.tool_choice = {
      allowed_tools: {
        ...(['auto', 'any', 'none', 'validated'].includes(toolChoice) ? { mode: toolChoice } : {}),
        tools: allowedTools
      }
    }
  } else if (['auto', 'any', 'none', 'validated'].includes(toolChoice)) {
    generationConfig.tool_choice = toolChoice
  }

  const functionTools = (options.disableTools ? [] : (options.tools || []))
    .map(toInteractionFunctionTool)
    .filter(Boolean)
  const tools = options.disableTools
    ? []
    : [...toInteractionBuiltinTools(options.builtinTools), ...functionTools]
  const schema = options.responseJsonSchema || options.responseSchema
  const responseMimeType = options.responseMimeType || (schema ? 'application/json' : undefined)

  return {
    model,
    input: interactionInput ?? (previousInteractionId
      ? toInteractionDelta(histories)
      : toInteractionSteps(histories)),
    store: true,
    generation_config: generationConfig,
    ...(previousInteractionId ? { previous_interaction_id: previousInteractionId } : {}),
    ...(systemText ? { system_instruction: systemText } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(schema
      ? {
          response_format: {
            type: 'text',
            mime_type: responseMimeType,
            schema
          }
        }
      : {}),
    ...(!schema && responseMimeType ? { response_mime_type: responseMimeType } : {})
  }
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

  #genAI
  #interactionStates = new Map()

  constructor (opts) {
    super(opts)
    this.channelId = String(opts.channelId || 'gemini')
    this.#genAI = opts.genAI || null
  }

  #withGenAI (operation, purpose, poolOptions = {}) {
    if (this.#genAI) return operation(this.#genAI, { id: 'injected', projectId: 'injected', poolSize: 1 })
    return withGeminiKeyPool(this.options, operation, { logger: this.logger, purpose, ...poolOptions })
  }

  #interactionStateKey (conversationId) {
    return `ix:${this.channelId}:${conversationId}`
  }

  async #loadInteractionState (conversationId, model) {
    const key = this.#interactionStateKey(conversationId)
    let state = this.#interactionStates.get(key)
    if (!state && typeof this.storage?.get === 'function') {
      state = await this.storage.get(key)
      if (state) this.#interactionStates.set(key, state)
    }
    return state?.model === model ? state : null
  }

  async #saveInteractionState (conversationId, model, interactionId, keyEntry, replaySteps) {
    if (!interactionId) return
    const key = this.#interactionStateKey(conversationId)
    const state = {
      channelId: this.channelId,
      conversationId,
      model,
      interactionId,
      replaySteps,
      replayVersion: 1,
      keyId: keyEntry?.id,
      projectId: keyEntry?.projectId,
      updatedAt: Date.now()
    }
    this.#interactionStates.set(key, state)
    if (typeof this.storage?.put === 'function') await this.storage.put(key, state)
  }

  async #clearInteractionState (conversationId) {
    const key = this.#interactionStateKey(conversationId)
    this.#interactionStates.delete(key)
    if (typeof this.storage?.remove === 'function') await this.storage.remove(key)
  }

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
    if (!this.#genAI && !hasGeminiApiKey(this.options)) throw new Error('Gemini API key not configured')

    const apiMode = normalizeGeminiApiMode(options.apiMode ?? this.options.apiMode)
    if (apiMode === 'interactions') {
      try {
        return await this.#sendInteractions(histories, options)
      } catch (error) {
        const fallbackEnabled = options.interactionsFallback ?? this.options.interactionsFallback ?? true
        if (!fallbackEnabled || !isInteractionCompatibilityError(error)) throw error
        await this.#clearInteractionState(String(options.conversationId || 'global'))
        const fallbackModel = options.model || this.options.model || 'default'
        this.logger?.(`[Gemini] Interactions API unavailable; falling back to generateContent (model=${fallbackModel}, channel=${this.channelId || 'unknown'}): ${String(error?.message || error).slice(0, 200)}`)
        return this.#sendGenerateContent(histories, options)
      }
    }
    // 旧协议产生的轮次不会进入 Google 服务端会话；切回 Interactions 时必须全量重建。
    await this.#clearInteractionState(String(options.conversationId || 'global'))
    return this.#sendGenerateContent(histories, options)
  }

  async #sendInteractions (histories, options = {}) {
    options = { ...this.options, ...options }
    const model = options.model || this.options.model || 'gemini-2.5-flash'
    const conversationId = String(options.conversationId || 'global')
    const sysMsg = histories.find(message => message.role === 'system')
    const systemText = sysMsg?.content?.find(part => part?.type === 'text')?.text || ''
    const loadedState = await this.#loadInteractionState(conversationId, model)
    return this.#withGenAI(async (genAI, keyEntry) => {
      const sameProject = loadedState?.projectId === keyEntry.projectId
      const state = sameProject ? loadedState : null
      const delta = loadedState?.interactionId ? toInteractionDelta(histories) : null
      const localReplay = () => toInteractionSteps(histories)
      const storedReplay = Array.isArray(loadedState?.replaySteps)
        ? loadedState.replaySteps
        : null

      const create = async ({ previousInteractionId, interactionInput, replayPrefix }) => {
        const request = buildGeminiInteractionRequest({
          histories,
          options,
          model,
          previousInteractionId,
          systemText,
          interactionInput
        })
        const interaction = await genAI.interactions.create(request)
        if (['failed', 'cancelled'].includes(interaction?.status)) {
          const error = new Error(`Interactions API returned status ${interaction.status}`)
          error.status = 502
          throw error
        }
        // 官方无状态重放要求模型步骤保持原样。这里保存实际请求 input 与原始响应 steps，
        // 正常轮次仍只发送增量；仅在服务端 ID 失效或跨 Project 时使用完整时间线重建。
        const replayInput = Array.isArray(replayPrefix)
          ? [...replayPrefix, ...(request.input || [])]
          : localReplay()
        const replaySteps = [...replayInput, ...(interaction?.steps || [])]
        await this.#saveInteractionState(
          conversationId,
          model,
          interaction?.id,
          keyEntry,
          replaySteps
        )
        return intoChaiteInteraction(interaction, model)
      }

      // previous_interaction_id 只在创建它的 Project 内有效。跨项目时用保存的官方
      // steps 加本轮增量重建；旧版状态没有 replaySteps 时兼容使用本地历史。
      const initialInput = state?.interactionId
        ? delta
        : (storedReplay && delta ? [...storedReplay, ...delta] : undefined)
      const initialPrefix = state?.interactionId
        ? storedReplay
        : (initialInput ? [] : null)

      try {
        return await create({
          previousInteractionId: state?.interactionId,
          interactionInput: initialInput,
          replayPrefix: initialPrefix
        })
      } catch (error) {
        // 免费层状态仅保留一天，或用户在 AI Studio 删除记录后，按官方无状态格式
        // 原样重放已保存的 steps；旧版状态才退回本地统一历史转换。
        if (!state?.interactionId || !isInteractionCompatibilityError(error)) throw error
        const rebuildInput = storedReplay && delta
          ? [...storedReplay, ...delta]
          : localReplay()
        this.logger?.(`[Gemini] previous interaction expired; rebuilding from preserved interaction steps: ${String(error?.message || error).slice(0, 160)}`)
        await this.#clearInteractionState(conversationId)
        return create({ interactionInput: rebuildInput, replayPrefix: [] })
      }
    }, 'interactions', { preferredProjectId: loadedState?.projectId })
  }

  async #sendGenerateContent (histories, options = {}) {
    if (!this.#genAI && !hasGeminiApiKey(this.options)) throw new Error('Gemini API key not configured')

    const model = options.model || this.options.model || 'gemini-2.5-flash'
    const maxOutputTokens = options.maxTokens || 2048
    const safetySettings = resolveGeminiSafetySettings(options.safetyLevel ?? this.options.safetyLevel)
    const includeServerSideToolInvocations =
      options.includeServerSideToolInvocations ??
      this.options.includeServerSideToolInvocations

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
    const builtinTools = options.disableTools
      ? []
      : toGenerateContentBuiltinTools(options.builtinTools ?? this.options.builtinTools)

    const convertResponse = (response) => {
      return intoChaiteConverter(response, model)
    }

    // 构建请求
    /** @type {Object} */
    const generateConfig = {
      model,
      contents,
      config: {
        maxOutputTokens,
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
    if (toolDeclarations.length > 0 || builtinTools.length > 0) {
      generateConfig.config.tools = [
        ...builtinTools,
        ...(toolDeclarations.length > 0 ? [{ functionDeclarations: toolDeclarations }] : [])
      ]
      const toolConfig = {}
      const mixesBuiltinAndFunctions = builtinTools.length > 0 && toolDeclarations.length > 0
      if (includeServerSideToolInvocations || mixesBuiltinAndFunctions) {
        toolConfig.includeServerSideToolInvocations = true
      }
      const functionCallingMode = typeof options.toolChoice === 'string'
        ? options.toolChoice
        : options.functionCallingMode
      const allowedFunctionNames = Array.isArray(options.allowedTools)
        ? [...new Set(options.allowedTools.map(name => String(name).trim()).filter(Boolean))]
        : []
      if (functionCallingMode || allowedFunctionNames.length > 0 || mixesBuiltinAndFunctions) {
        toolConfig.functionCallingConfig = {
          ...(functionCallingMode
            ? { mode: functionCallingMode }
            : mixesBuiltinAndFunctions ? { mode: 'VALIDATED' } : {}),
          ...(allowedFunctionNames.length > 0 ? { allowedFunctionNames } : {})
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

    return this.#withGenAI(async genAI => {
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
    }, 'generateContent')
  }
}
