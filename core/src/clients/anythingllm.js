/**
 * AnythingLLM 客户端
 * 封装 AnythingLLM REST API，提供文档检索、聊天、文档管理能力
 */

export class AnythingLLMClient {
  /** @type {string} */
  #baseUrl
  /** @type {string} */
  #apiKey
  /** @type {string} */
  #workspace
  /** @type {Function} */
  #logger

  /**
   * @param {Object} opts
   * @param {string} opts.baseUrl - AnythingLLM 服务地址，如 http://localhost:3001
   * @param {string} opts.apiKey - API 密钥
   * @param {string} [opts.workspace='default'] - 默认工作区 slug
   * @param {Function} [opts.logger]
   */
  constructor ({ baseUrl, apiKey, workspace = 'default', logger }) {
    if (!baseUrl) throw new Error('AnythingLLM baseUrl is required')
    if (!apiKey) throw new Error('AnythingLLM apiKey is required')

    this.#baseUrl = baseUrl.replace(/\/+$/, '')
    this.#apiKey = apiKey
    this.#workspace = workspace
    this.#logger = logger || (() => {})
  }

  // ── 核心 API ──────────────────────────────────

  /**
   * 验证 API 密钥是否有效
   * @returns {Promise<boolean>}
   */
  async auth () {
    const res = await this.#get('/api/v1/auth')
    return res?.authenticated === true
  }

  /**
   * 与工作区对话（非流式）
   *
   * @param {Object} params
   * @param {string} params.message - 用户消息
   * @param {'query'|'chat'} [params.mode='query'] - query=检索模式，chat=聊天模式
   * @param {string} [params.workspace] - 工作区 slug，不传则用默认
   * @returns {Promise<{textResponse: string, sources: Array}>}
   */
  async chat ({ message, mode = 'query', workspace }) {
    const slug = workspace || this.#workspace
    const res = await this.#post(`/api/v1/workspace/${slug}/chat`, { message, mode })

    if (!res) throw new Error('AnythingLLM chat returned empty response')

    return {
      textResponse: res.textResponse || '',
      sources: res.sources || [],
      close: res.close // 会话关闭标记
    }
  }

  /**
   * 与工作区对话（流式）
   *
   * @param {Object} params
   * @param {string} params.message
   * @param {'query'|'chat'} [params.mode='query']
   * @param {string} [params.workspace]
   * @param {Function} params.onChunk - (chunk: string) => void
   * @returns {Promise<{textResponse: string, sources: Array}>}
   */
  async streamChat ({ message, mode = 'query', workspace, onChunk }) {
    const slug = workspace || this.#workspace
    const url = `${this.#baseUrl}/api/v1/workspace/${slug}/stream-chat`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.#apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({ message, mode })
    })

    if (!response.ok) {
      throw new Error(`AnythingLLM stream-chat failed: ${response.status} ${response.statusText}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let sources = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '))

      for (const line of lines) {
        const data = line.slice(6) // 去掉 "data: " 前缀
        if (data === '[DONE]') break

        try {
          const parsed = JSON.parse(data)
          if (parsed.textResponse) {
            fullText += parsed.textResponse
            onChunk?.(parsed.textResponse)
          }
          if (parsed.sources) {
            sources = parsed.sources
          }
        } catch {
          // 忽略解析错误的 chunk
        }
      }
    }

    return { textResponse: fullText, sources }
  }

  // ── 文档管理 ──────────────────────────────────

  /**
   * 上传文档
   *
   * @param {Object} params
   * @param {Buffer|Blob|File} params.file - 文件内容
   * @param {string} params.filename - 文件名
   * @returns {Promise<Object>} 上传结果
   */
  async uploadDocument ({ file, filename }) {
    const formData = new FormData()
    formData.append('file', file, filename)

    const url = `${this.#baseUrl}/api/v1/document/upload`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.#apiKey}`
      },
      body: formData
    })

    if (!response.ok) {
      throw new Error(`AnythingLLM upload failed: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * 列出所有文档
   *
   * @returns {Promise<Object>} 文档列表
   */
  async listDocuments () {
    return this.#get('/api/v1/documents')
  }

  /**
   * 将文档添加到工作区
   *
   * @param {Object} params
   * @param {string[]} params.adds - 要添加的文档路径数组
   * @param {string[]} [params.deletes] - 要删除的文档路径数组
   * @param {string} [params.workspace]
   * @returns {Promise<Object>}
   */
  async updateEmbeddings ({ adds = [], deletes = [], workspace }) {
    const slug = workspace || this.#workspace
    return this.#post(`/api/v1/workspace/${slug}/update-embeddings`, { adds, deletes })
  }

  /**
   * 创建文档文件夹
   *
   * @param {string} name - 文件夹名
   * @returns {Promise<Object>}
   */
  async createFolder (name) {
    return this.#post('/api/v1/document/create-folder', { name })
  }

  // ── 工作区管理 ────────────────────────────────

  /**
   * 列出所有工作区
   *
   * @returns {Promise<Object[]>}
   */
  async listWorkspaces () {
    const res = await this.#get('/api/v1/workspaces')
    return res?.workspaces || []
  }

  /**
   * 创建新工作区
   *
   * @param {string} name - 工作区名称
   * @returns {Promise<Object>}
   */
  async createWorkspace (name) {
    return this.#post('/api/v1/workspace/new', { name })
  }

  /**
   * 更新工作区设置
   *
   * @param {Object} params
   * @param {string} [params.name]
   * @param {number} [params.openAiTemp] - 模型温度
   * @param {number} [params.openAiHistory] - 历史消息数
   * @param {string} [params.openAiPrompt] - 系统提示
   * @param {string} [params.workspace]
   * @returns {Promise<Object>}
   */
  async updateWorkspace ({ name, openAiTemp, openAiHistory, openAiPrompt, workspace }) {
    const slug = workspace || this.#workspace
    const body = {}
    if (name !== undefined) body.name = name
    if (openAiTemp !== undefined) body.openAiTemp = openAiTemp
    if (openAiHistory !== undefined) body.openAiHistory = openAiHistory
    if (openAiPrompt !== undefined) body.openAiPrompt = openAiPrompt
    return this.#post(`/api/v1/workspace/${slug}/update`, body)
  }

  /**
   * 删除工作区
   *
   * @param {string} [workspace]
   * @returns {Promise<Object>}
   */
  async deleteWorkspace (workspace) {
    const slug = workspace || this.#workspace
    return this.#delete(`/api/v1/workspace/${slug}`)
  }

  // ── 内部方法 ──────────────────────────────────

  async #get (path) {
    const url = `${this.#baseUrl}${path}`
    this.#logger(`[anythingllm] GET ${path}`)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.#apiKey}`,
        'Accept': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`AnythingLLM GET ${path} failed: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }

  async #post (path, body) {
    const url = `${this.#baseUrl}${path}`
    this.#logger(`[anythingllm] POST ${path}`)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.#apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      throw new Error(`AnythingLLM POST ${path} failed: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }

  async #delete (path) {
    const url = `${this.#baseUrl}${path}`
    this.#logger(`[anythingllm] DELETE ${path}`)

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.#apiKey}`,
        'Accept': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`AnythingLLM DELETE ${path} failed: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }
}
