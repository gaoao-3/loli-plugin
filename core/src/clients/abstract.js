/**
 * AbstractClient — 消息管道 + 工具调用循环
 * 从 node-chaite clients.ts 精简而来
 *
 * 核心流程:
 *   user msg → _sendMessage() → AI response
 *     ├─ 有 toolCalls → 执行工具（注入事件上下文）→ 结果回传 → 循环
 *     └─ 无 → 返回最终文本
 */
import { randomUUID } from 'crypto'

/** @typedef {import('../types.js').UnifiedMessage} UnifiedMessage */

function toolLimit (value, fallback, maximum) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(1, Math.trunc(parsed)))
}

export class AbstractClient {
  /** @type {LoliStorage} */
  storage
  /** @type {Object[]} 已加载的工具实例 */
  tools = []
  /** @type {Object} */
  options
  /** @type {Function} */
  logger

  /** 子类须覆盖 */
  get adapterType () { return 'abstract' }

  /**
   * @param {Object} opts
   * @param {LoliStorage} opts.storage
   * @param {Object} opts.options - channel options (apiKey, baseUrl, etc.)
   * @param {Function} [opts.logger]
   */
  constructor (opts) {
    this.storage = opts.storage
    this.options = opts.options || {}
    this.logger = opts.logger || (() => {})
  }

  /**
   * 子类实现 — 调用 AI API
   * @param {UnifiedMessage[]} histories
   * @param {Object} options
   * @returns {Promise<UnifiedMessage>}
   */
  async _sendMessage (histories, options) {
    throw new Error('_sendMessage must be implemented by subclass')
  }

  // ── 工具调用循环 ──────────────────────────────

  /**
   * 记录一次模型 API 响应。默认开启，可通过 channel.options.logApiResponses=false 关闭。
   * 只记录转换后的响应内容，不包含 API Key、请求头或图片 base64。
   */
  #logApiResponse (response, options, duration, round) {
    if (this.options.logApiResponses === false) return

    const maxLength = Math.max(200, Number(this.options.apiResponseLogMaxLength) || 4000)
    const contents = (response?.content || []).map(item => {
      if (item.type === 'text' || item.type === 'reasoning') {
        return {
          type: item.type,
          text: item.text || '',
          ...(item.thoughtSignature
            ? { hasThoughtSignature: true, thoughtSignatureLength: item.thoughtSignature.length }
            : {})
        }
      }
      if (item.type === 'toolCall') {
        return {
          type: item.type,
          name: item.name || '',
          args: item.args || '{}',
          ...(item.thoughtSignature
            ? { hasThoughtSignature: true, thoughtSignatureLength: item.thoughtSignature.length }
            : {})
        }
      }
      return { type: item.type || 'unknown' }
    })
    const payload = JSON.stringify({
      adapter: this.adapterType,
      model: options.model || this.options.model || 'unknown',
      round,
      durationMs: duration,
      ...(response?.usage ? { usage: response.usage } : {}),
      content: contents
    })
    const truncated = payload.length > maxLength
      ? `${payload.slice(0, maxLength)}…[truncated ${payload.length - maxLength} chars]`
      : payload

    this.logger(`[loli] API response ${truncated}`)
  }

  async #sendAndLog (histories, options, round) {
    const startedAt = Date.now()
    const response = await this._sendMessage(histories, options)
    this.#logApiResponse(response, options, Date.now() - startedAt, round)
    return response
  }

  /**
   * 发送消息（含工具调用循环 + 历史管理）
   *
   * @param {Object} params
   * @param {UnifiedMessage} params.userMessage
   * @param {string} params.conversationId
   * @param {Object} params.options - sendMessageOption
   * @param {UnifiedMessage} [params.systemPrompt]
   * @param {Object[]} [params.tools] - 此轮可用的工具实例
   * @param {Object} [params.event] - Yunzai 事件，注入工具上下文
   * @param {Object} [params.toolContext] - 额外工具上下文（如 anythingllm 客户端）
   * @returns {Promise<{response: UnifiedMessage, finalText: string, usage?: Object}>}
   */
  async sendMessage ({ userMessage, conversationId, options = {}, systemPrompt, tools = [], toolProvider, event, toolContext }) {
    const resolveTools = async (round) => {
      const resolved = typeof toolProvider === 'function'
        ? await toolProvider({ round, event, toolContext })
        : tools
      return Array.isArray(resolved) ? resolved : []
    }
    let activeTools = await resolveTools(0)
    this.tools = activeTools
    // 请求选项优先于渠道选项；限制上界避免错误配置导致模型无限调用。
    const maxToolRounds = toolLimit(options.maxToolRounds ?? this.options.maxToolRounds, 8, 20)
    const maxSameToolCalls = toolLimit(options.maxSameToolCalls ?? this.options.maxSameToolCalls, 2, 10)
    const historyLimit = toolLimit(options.historyLimit ?? this.options.historyLimit, 50, 200)

    // 1. 加载历史
    let histories = await this.storage.getHistory(conversationId, historyLimit)

    // 2. 注入本轮系统提示。systemPrompt 不写入历史，避免旧 system 污染后续动态上下文。
    const withSystemPrompt = (messages) => {
      if (!systemPrompt) return messages
      return [systemPrompt, ...messages.filter(h => h.role !== 'system')]
    }
    histories = withSystemPrompt(histories)

    // 3. 保存用户消息
    userMessage.id = userMessage.id || randomUUID()
    userMessage.conversationId = conversationId
    await this.storage.saveHistory(userMessage)
    histories.push(userMessage)

    // 4. 首轮调用
    const callCount = {}
    let currentResponse = await this.#sendAndLog(histories, {
      ...options,
      tools: this.#buildToolDefs(activeTools)
    }, 0)
    let usage = mergeTokenUsage(null, currentResponse.usage)

    // 5. 保存模型响应
    currentResponse.id = currentResponse.id || randomUUID()
    currentResponse.conversationId = conversationId
    await this.storage.saveHistory(currentResponse)

    // 6. 工具调用循环
    let round = 0
    while (this._hasToolCalls(currentResponse) && round < maxToolRounds) {
      round++

      const toolCalls = this._getToolCalls(currentResponse)
      const toolResults = []

      for (const tc of toolCalls) {
        const key = tc.name
        callCount[key] = (callCount[key] || 0) + 1

        if (callCount[key] > maxSameToolCalls) {
          toolResults.push({ toolId: tc.toolId, name: tc.name, content: `[TOOL_LIMIT] 调用次数已达上限 (${maxSameToolCalls})` })
          continue
        }

        const tool = activeTools.find(t => this.#toolName(t) === tc.name)
        if (!tool) {
          toolResults.push({ toolId: tc.toolId, name: tc.name, content: `[TOOL_NOT_FOUND] 工具 "${tc.name}" 未安装` })
          continue
        }

        const result = await this.#executeTool(tool, tc.args, event, toolContext)
        toolResults.push({ toolId: tc.toolId, name: tc.name, content: result })
      }

      // 工具结果写入历史
      const toolMsg = {
        id: randomUUID(),
        role: 'tool',
        conversationId,
        content: toolResults.map(tr => ({
          type: 'toolCallResult',
          toolId: tr.toolId,
          name: tr.name,
          content: tr.content
        })),
        timestamp: Date.now()
      }
      await this.storage.saveHistory(toolMsg)

      // 当前工具续轮直接沿用模型刚返回的完整响应，确保 Gemini 的
      // thoughtSignature 及其 Part 位置原样回传；落盘历史只用于跨轮恢复。
      histories.push(currentResponse, toolMsg)
      activeTools = await resolveTools(round)
      this.tools = activeTools
      currentResponse = await this.#sendAndLog(histories, {
        ...options,
        tools: this.#buildToolDefs(activeTools)
      }, round)
      usage = mergeTokenUsage(usage, currentResponse.usage)
      currentResponse.id = currentResponse.id || randomUUID()
      currentResponse.conversationId = conversationId
      await this.storage.saveHistory(currentResponse)
    }

    // 7. 提取最终文本
    const finalText = this._extractText(currentResponse)
    if (usage) {
      this.logger(`[loli] token usage ${JSON.stringify({
        adapter: this.adapterType,
        model: options.model || this.options.model || 'unknown',
        calls: round + 1,
        ...usage
      })}`)
    }

    return { response: currentResponse, finalText, ...(usage ? { usage } : {}) }
  }

  // ── 工具执行（可被子类覆盖） ──────────────────

  /**
   * 执行单个工具调用
   * @param {Object} tool - 工具实例 { name, toolDef, run }
   * @param {Object} args - 工具参数
   * @param {Object} [event] - Yunzai 事件上下文
   * @param {Object} [toolContext] - 额外工具上下文（如 anythingllm 客户端）
   * @returns {Promise<string>}
   */
  async #executeTool (tool, args, event, toolContext) {
    try {
      const runFn = typeof tool.run === 'function' ? tool.run : tool
      if (!runFn) throw new Error(`工具 ${tool.name} 没有 run() 方法`)

      // 构建上下文：工具可通过第二个参数拿到事件和额外客户端
      const context = { ...toolContext }
      if (event) context.event = event

      const start = Date.now()
      const result = await runFn(args, context)
      const duration = Date.now() - start

      this.logger(`[loli] tool ${tool.name}(${duration}ms): ${JSON.stringify(args).slice(0, 60)} → ${typeof result === 'string' ? result.slice(0, 40) : 'object'}`)

      return typeof result === 'string' ? result : JSON.stringify(result)
    } catch (err) {
      this.logger(`[loli] tool ${tool.name} error: ${err.message}`)
      return `[TOOL_ERROR] ${err.message}`
    }
  }

  // ── 工具定义提取 ──────────────────────────────

  /** 将工具实例转为 AI 可用的函数定义数组 */
  #buildToolDefs (tools) {
    return tools.map(t => {
      const raw = t?.toolDef || t?.function || t
      const def = raw?.function || raw
      if (!def?.name) return null
      const {
        run: _run,
        toolDef: _toolDef,
        function: _function,
        _file,
        ...declaration
      } = def
      return declaration
    }).filter(Boolean)
  }

  #toolName (tool) {
    return tool?.name ||
      tool?.toolDef?.name ||
      tool?.toolDef?.function?.name ||
      tool?.function?.name ||
      ''
  }

  // ── 辅助 ──────────────────────────────────────

  /** @param {UnifiedMessage} msg */
  _hasToolCalls (msg) {
    return (msg.content || []).some(c => c.type === 'toolCall')
  }

  /** @returns {Array<{name:string, args:Object}>} */
  _getToolCalls (msg) {
    return (msg.content || [])
      .filter(c => c.type === 'toolCall')
      .map(c => ({ toolId: c.toolId, name: c.name, args: c.args ? JSON.parse(c.args) : {} }))
  }

  _extractText (msg) {
    if (!msg) return ''
    return (msg.content || [])
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text)
      .join('\n')
      .replace(/\[usage:.*?\]/g, '')
      .trim()
  }

  /**
   * 提取推理/思考内容
   * @param {UnifiedMessage} msg
   * @returns {string}
   */
  _extractReasoning (msg) {
    if (!msg) return ''
    return (msg.content || [])
      .filter(c => c.type === 'reasoning' && c.text)
      .map(c => c.text)
      .join('\n')
      .trim()
  }
}

export function mergeTokenUsage (current, next) {
  if (!next || typeof next !== 'object') return current || null
  const keys = [
    'inputTokens',
    'outputTokens',
    'reasoningTokens',
    'toolTokens',
    'cachedTokens',
    'totalTokens'
  ]
  const merged = { ...(current || {}) }
  let found = false
  for (const key of keys) {
    const value = Number(next[key])
    if (!Number.isFinite(value) || value < 0) continue
    merged[key] = (Number(merged[key]) || 0) + Math.trunc(value)
    found = true
  }
  return found || current ? merged : null
}
