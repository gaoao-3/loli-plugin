/**
 * LoliEngine — loli-plugin 内置 AI 引擎
 * 统一管理：存储 / 渠道 / 客户端 / 工具 / 历史
 */
import { LoliStorage } from './storage.js'
import { ToolLoader } from './loaders/tools.js'
import { GeminiClient } from './clients/gemini.js'
import { OpenAIClient } from './clients/openai.js'
import { AnythingLLMClient } from './clients/anythingllm.js'
import { v4 as uuidv4 } from 'uuid'
import { Memory } from './memory/index.js'

/** 渠道适配器注册表 */
const CLIENT_REGISTRY = {
  gemini: GeminiClient,
  openai: OpenAIClient
}

export class LoliEngine {
  /** @type {LoliStorage} */
  storage
  /** @type {ToolLoader} */
  toolLoader
  /** @type {Map<string, AbstractClient>} */
  #clients = new Map()
  /** @type {Memory|null} */
  #memory = null
  /** @type {AbstractClient|null} */
  #currentClient = null
  /** @type {AnythingLLMClient|null} */
  #anythingllm = null
  /** @type {import('node:http').Server|null} */
  #dashboardServer = null
  /** @type {Object} */
  #opts

  /**
   * @param {Object} opts
   * @param {string} opts.dataDir
   * @param {string} [opts.toolsDir]
   * @param {Function} [opts.logger] - (msg) => void
   * @param {boolean} [opts.enableMemory=true]
   * @param {Object} [opts.master] - 主人配置 { userId, label, aliases }
   * @param {Object} [opts.anythingllm] - AnythingLLM 配置 { baseUrl, apiKey, workspace }
   */
  constructor (opts = {}) {
    this.#opts = opts
    this.storage = new LoliStorage(opts.dataDir).open()
    this.toolLoader = new ToolLoader({
      toolsDir: opts.toolsDir || opts.dataDir + '/tools',
      logger: opts.logger
    })
    if (opts.enableMemory !== false) {
      this.#memory = new Memory({
        storage: this.storage,
        extractFn: (prompt) => this.#extractMemory(prompt),
        logger: opts.logger,
        master: opts.master
      })
    }
    if (opts.anythingllm?.baseUrl && opts.anythingllm?.apiKey) {
      this.#anythingllm = new AnythingLLMClient({
        baseUrl: opts.anythingllm.baseUrl,
        apiKey: opts.anythingllm.apiKey,
        workspace: opts.anythingllm.workspace || 'default',
        logger: opts.logger
      })
    }
  }

  /** 初始化（加载工具 + 记忆） */
  async init () {
    await this.toolLoader.init()
    if (this.#memory) await this.#memory.init()
    return this
  }

  /** 清理资源 */
  async destroy () {
    await this.stopDashboard()
    await this.toolLoader.destroy()
    if (this.#memory) await this.#memory.destroy()
    this.storage.close()
    this.#clients.clear()
  }

  /**
   * 调用当前客户端进行记忆提取
   * @param {string} prompt
   * @returns {Promise<string>}
   */
  async #extractMemory (prompt) {
    if (!this.#currentClient) return ''
    try {
      const msg = {
        id: uuidv4(),
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        timestamp: Date.now()
      }
      const result = await this.#currentClient._sendMessage([msg], {
        model: 'gemini-2.5-flash',
        temperature: 0.2
      })
      return (result.content || [])
        .filter(c => c.type === 'text' || c.type === 'reasoning')
        .map(c => c.text)
        .join('\n')
        .replace(/\[usage:.*?\]/g, '')
        .trim()
    } catch (err) {
      this.#opts.logger?.(`[memory] extract error: ${err.message}`)
      return ''
    }
  }

  /**
   * 获取或创建客户端
   * @param {string} channelId
   * @returns {Promise<AbstractClient>}
   */
  async getClient (channelId) {
    if (this.#clients.has(channelId)) return this.#clients.get(channelId)

    const channel = await this.storage.getChannel(channelId)
    if (!channel) throw new Error(`Channel not found: ${channelId}`)

    const opts = {
      storage: this.storage,
      options: channel.options || {},
      logger: this.#opts.logger
    }

    const adapter = channel.adapterType || 'gemini'
    const ClientClass = CLIENT_REGISTRY[adapter]
    if (!ClientClass) throw new Error(`Unsupported adapter: ${adapter}`)
    const client = new ClientClass(opts)

    this.#clients.set(channelId, client)
    return client
  }

  /**
   * 发送 AI 消息（完整管道）
   *
   * @param {Object} params
   * @param {string} params.channelId
   * @param {string} [params.presetId]
   * @param {string} [params.conversationId]
   * @param {UnifiedMessage} params.userMessage
   * @param {string} [params.userId] - 用于记忆召回
   * @param {string} [params.groupId] - 用于记忆召回
   * @param {Object} [params.event] - Yunzai 事件
   * @param {Object} [params.overrideOptions] - 覆盖 preset 的选项
   * @param {string} [params.overrideOptions.systemOverride] - 旧版临时 system prompt 覆盖字段
   * @param {string} [params.systemPromptOverride] - 临时覆盖本轮 system prompt
   * @returns {Promise<{response: UnifiedMessage, finalText: string, usage?: Object}>}
   */
  async sendMessage ({ channelId, presetId, conversationId, userMessage, userId, groupId, event, overrideOptions = {}, systemPromptOverride }) {
    // 加载渠道
    const channel = await this.storage.getChannel(channelId)
    if (!channel) throw new Error(`Channel not found: ${channelId}`)

    // 加载预设
    const { systemOverride, ...cleanOverrideOptions } = overrideOptions || {}
    const promptOverride = typeof systemPromptOverride === 'string'
      ? systemPromptOverride
      : systemOverride
    let sendOpts = cleanOverrideOptions
    let systemPrompt = null

    if (presetId) {
      const preset = await this.storage.getPreset(presetId)
      if (preset) {
        sendOpts = { ...(preset.sendMessageOption || {}), ...cleanOverrideOptions }
        if (preset.systemPrompt?.content) {
          systemPrompt = {
            id: 'system-' + presetId,
            role: 'system',
            content: [{ type: 'text', text: preset.systemPrompt.content }],
            timestamp: Date.now()
          }
        }
      }
    }

    if (typeof promptOverride === 'string' && promptOverride.trim()) {
      systemPrompt = {
        id: 'system-override-' + (presetId || 'default'),
        role: 'system',
        content: [{ type: 'text', text: promptOverride }],
        timestamp: Date.now()
      }
    }

    // 确保 model
    if (!sendOpts.model) {
      sendOpts.model = channel.models?.[0] || 'gemini-2.5-flash'
    }

    // 获取客户端
    const client = await this.getClient(channelId)
    this.#currentClient = client

    // 会话 ID
    const cid = conversationId || uuidv4()

    // 工具按请求、按回合解析。Skill 激活状态只存在于本次请求，
    // 激活后下一回合才暴露其 allowed-tools，避免全量 schema 常驻。
    const toolState = { activatedSkills: new Set() }
    const toolProvider = async ({ round = 0 } = {}) => {
      const availableTools = this.toolLoader.getAll()
      const context = {
        event,
        userMessage,
        channelId,
        presetId,
        round,
        toolState,
        availableTools
      }
      let localTools = availableTools
      if (typeof this.#opts.localToolProvider === 'function') {
        try {
          localTools = await this.#opts.localToolProvider(context) || []
        } catch (err) {
          localTools = []
          this.#opts.logger?.(`[loli] local tools unavailable: ${err.message}`)
        }
      }
      let externalTools = []
      if (typeof this.#opts.externalToolProvider === 'function') {
        try {
          externalTools = await this.#opts.externalToolProvider(context) || []
        } catch (err) {
          this.#opts.logger?.(`[loli] external tools unavailable: ${err.message}`)
        }
      }
      return [...localTools, ...externalTools]
    }

    // 从事件中补全 userId / groupId
    if (event) {
      if (!userId && event.user_id) userId = String(event.user_id)
      if (!groupId && event.group_id) groupId = String(event.group_id)
    }

    // 外部上下文（例如 Skill 元数据目录）只注入本轮，不写入历史。
    if (typeof this.#opts.externalContextProvider === 'function') {
      try {
        const extraContext = await this.#opts.externalContextProvider({ event, userMessage, channelId, presetId })
        if (typeof extraContext === 'string' && extraContext.trim()) {
          if (!systemPrompt) {
            systemPrompt = {
              id: 'external-context-' + (presetId || 'default'),
              role: 'system',
              content: [{ type: 'text', text: extraContext.trim() }],
              timestamp: Date.now()
            }
          } else {
            const content = Array.isArray(systemPrompt.content) ? [...systemPrompt.content] : []
            const textIndex = content.findIndex(item => item?.type === 'text')
            if (textIndex >= 0) {
              content[textIndex] = { ...content[textIndex], text: `${content[textIndex].text || ''}\n\n${extraContext.trim()}`.trim() }
            } else {
              content.unshift({ type: 'text', text: extraContext.trim() })
            }
            systemPrompt = { ...systemPrompt, content }
          }
        }
      } catch (err) {
        this.#opts.logger?.(`[loli] external context unavailable: ${err.message}`)
      }
    }

    // 记忆召回并注入 system prompt
    if (this.#memory) {
      const userText = this.#extractUserText(userMessage)
      const memoryText = this.#memory.recall({ userId, groupId, queryText: userText, limit: 8 })
      if (memoryText && systemPrompt) {
        systemPrompt = this.#memory.injector.inject(systemPrompt, memoryText)
      }
    }

    // 发送（注入 AnythingLLM 客户端到工具上下文）
    // 工具除了原始事件，也需要拿到模型本轮实际看到的消息内容。
    // 例如群聊历史图片已经被压缩为 base64 注入 userMessage，原始 event 中并不存在。
    const toolContext = { event, userMessage, anythingllm: this.#anythingllm, executionReports: [] }
    const result = await client.sendMessage({
      userMessage,
      conversationId: cid,
      options: sendOpts,
      systemPrompt,
      toolProvider,
      event,
      toolContext
    })
    result.executionReports = toolContext.executionReports

    // 异步提取并保存记忆
    if (this.#memory) {
      const userText = this.#extractUserText(userMessage)
      const assistantText = result.finalText
      this.#memory.record({ userText, assistantText, event }).catch(() => {})
    }

    return result
  }

  #extractUserText (userMessage) {
    if (!userMessage) return ''
    return (userMessage.content || [])
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text)
      .join('\n')
  }

  /**
   * 快捷：纯文本发送
   * @param {string} text
   * @param {Object} opts
   * @returns {Promise<string>}
   */
  async chat (text, opts = {}) {
    const userMsg = {
      id: uuidv4(),
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp: Date.now()
    }
    const result = await this.sendMessage({
      ...opts,
      userMessage: userMsg
    })
    return result.finalText
  }

  // ─── AnythingLLM 集成 ────────────────────────────

  /**
   * 设置 AnythingLLM 客户端（运行时注入）
   * @param {Object} opts
   * @param {string} opts.baseUrl
   * @param {string} opts.apiKey
   * @param {string} [opts.workspace='default']
   */
  setAnythingLLM (opts) {
    this.#anythingllm = new AnythingLLMClient({
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      workspace: opts.workspace || 'default',
      logger: this.#opts.logger
    })
  }

  /** 获取 AnythingLLM 客户端实例 */
  getAnythingLLM () {
    return this.#anythingllm
  }

  // ─── 可选管理面板 ──────────────────────────────

  /**
   * 启动插件内置的管理面板。
   * 插件可通过 options 注入配置持久化、日志和外部记忆统计，无需承载面板代码。
   */
  async startDashboard (options = {}) {
    if (this.#dashboardServer?.listening) return this.#dashboardServer

    const { startDashboard } = await import('./dashboard/index.js')
    const config = options.config || {}
    const port = options.port ?? config.dashboard?.port ?? 3000
    const host = options.host ?? config.dashboard?.host ?? '127.0.0.1'
    const ctx = {
      ...options,
      engine: this,
      config,
      toolsDir: options.toolsDir || this.#opts.toolsDir || this.#opts.dataDir + '/tools',
      logs: options.logs || [],
      saveConfig: options.saveConfig || (() => {}),
      logger: options.logger || this.#opts.logger || (() => {})
    }

    this.#dashboardServer = await startDashboard(ctx, port, host)
    return this.#dashboardServer
  }

  async stopDashboard () {
    if (!this.#dashboardServer) return
    const server = this.#dashboardServer
    this.#dashboardServer = null
    const { stopDashboard } = await import('./dashboard/index.js')
    await stopDashboard(server)
  }

  getDashboardServer () {
    return this.#dashboardServer
  }

  // ─── 快捷方法 ──────────────────────────────────

  getHistory (conversationId, limit) {
    return this.storage.getHistory(conversationId, limit)
  }

  clearHistory (conversationId) {
    return this.storage.clearHistory(conversationId)
  }

  async saveChannel (ch) {
    const saved = await this.storage.saveChannel(ch)
    this.#clients.delete(saved.id)
    return saved
  }
  listChannels () { return this.storage.listChannels() }
  async deleteChannel (id) {
    this.#clients.delete(id)
    return this.storage.deleteChannel(id)
  }
  savePreset (p) { return this.storage.savePreset(p) }
  listPresets () { return this.storage.listPresets() }
  getPreset (id) { return this.storage.getPreset(id) }

  /** 导出可读的记忆图谱 Markdown */
  getMemoryMarkdown () {
    return this.#memory ? this.#memory.toMarkdown() : ''
  }

  /** 获取记忆实例（用于管理面板） */
  getMemory () {
    return this.#memory
  }
}
