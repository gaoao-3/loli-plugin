import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const MAX_TOOL_OUTPUT = 20000

function safeName (value, fallback = 'unnamed') {
  const normalized = String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized || fallback
}

function normalizeHeaders (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [String(key), String(val)]))
}

export function resolveStdioServerCommand (command, args = [], platform = process.platform) {
  if (platform !== 'win32') return { command, args }
  let resolved = command
  if (!/[\\/]/.test(command)) {
    try {
      const candidates = String(execFileSync('where.exe', [command], { encoding: 'utf8', windowsHide: true }))
        .split(/\r?\n/).map(line => line.trim()).filter(Boolean)
      resolved = candidates.find(candidate => /\.exe$/i.test(candidate)) ||
        candidates.find(candidate => /\.(?:cmd|bat)$/i.test(candidate)) || command
    } catch {}
  }
  if (/\.(?:cmd|bat)$/i.test(resolved)) {
    try {
      const shim = fs.readFileSync(resolved, 'utf8')
      const match = shim.match(/"%dp0%\\([^"\r\n]+\.js)"/i)
      if (match) return { command: process.execPath, args: [path.resolve(path.dirname(resolved), match[1]), ...args] }
      const modernMatches = [...shim.matchAll(/%~dp0\\([^"\r\n]+\.js)/gi)].map(item => item[1])
      const modernEntry = modernMatches.findLast(item => /(?:^|\\)[^\\]*cli\.js$/i.test(item)) || modernMatches.at(-1)
      if (modernEntry) return { command: process.execPath, args: [path.resolve(path.dirname(resolved), modernEntry), ...args] }
    } catch {}
    throw new Error(`Windows stdio MCP 不直接执行批处理脚本，请把 command 改为可执行文件或 Node JS 入口: ${resolved}`)
  }
  return { command: resolved, args }
}

export function normalizeMcpConfig (value = {}) {
  const servers = Array.isArray(value.servers) ? value.servers : []
  return {
    enable: value.enable === true,
    connectTimeoutMs: Math.max(1000, Math.min(60000, Number(value.connectTimeoutMs) || 10000)),
    callTimeoutMs: Math.max(1000, Math.min(300000, Number(value.callTimeoutMs) || 60000)),
    servers: servers.map((server, index) => ({
      id: safeName(server.id, `server_${index + 1}`),
      name: String(server.name || server.id || `MCP ${index + 1}`),
      enable: server.enable !== false,
      transport: server.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
      command: String(server.command || '').trim(),
      args: Array.isArray(server.args) ? server.args.map(String) : [],
      cwd: server.cwd ? String(server.cwd) : undefined,
      env: normalizeHeaders(server.env),
      url: String(server.url || '').trim(),
      headers: normalizeHeaders(server.headers),
      masterOnly: server.masterOnly !== false,
      allowedTools: Array.isArray(server.allowedTools) ? server.allowedTools.map(String).filter(Boolean) : []
    }))
  }
}

function flattenMcpContent (result) {
  const parts = []
  if (result?.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent))
  for (const item of result?.content || []) {
    if (item.type === 'text') parts.push(item.text || '')
    else if (item.type === 'resource_link') parts.push(`[resource] ${item.name || ''} ${item.uri || ''}`.trim())
    else if (item.type === 'resource') parts.push(item.resource?.text || `[resource] ${item.resource?.uri || ''}`)
    else if (item.type === 'image') parts.push(`[image ${item.mimeType || 'unknown'} omitted: ${String(item.data || '').length} base64 chars]`)
    else if (item.type === 'audio') parts.push(`[audio ${item.mimeType || 'unknown'} omitted]`)
    else parts.push(JSON.stringify(item))
  }
  const text = parts.filter(Boolean).join('\n').trim() || '(MCP tool returned no content)'
  return text.length > MAX_TOOL_OUTPUT ? `${text.slice(0, MAX_TOOL_OUTPUT)}\n…[truncated]` : text
}

export class McpManager {
  #getConfig
  #logger
  #clientFactory
  #transportFactory
  #connections = new Map()
  #signature = ''

  constructor ({ getConfig, logger, clientFactory, transportFactory } = {}) {
    this.#getConfig = getConfig || (() => ({}))
    this.#logger = logger || (() => {})
    this.#clientFactory = clientFactory || ((server) => new Client({ name: `loli-plugin-${server.id}`, version: '0.1.0' }, { capabilities: {} }))
    this.#transportFactory = transportFactory || this.#createTransport.bind(this)
  }

  async init () {
    await this.sync()
    return this
  }

  async reload () {
    this.#signature = ''
    await this.sync()
  }

  async sync () {
    const config = normalizeMcpConfig(this.#getConfig())
    const signature = JSON.stringify(config)
    if (signature === this.#signature) return
    this.#signature = signature
    await this.destroy()
    this.#signature = signature
    if (!config.enable) return
    await Promise.all(config.servers.filter(server => server.enable).map(server => this.#connect(server, config)))
  }

  async #createTransport (server) {
    if (server.transport === 'streamable-http') {
      const url = new URL(server.url)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('MCP URL 仅支持 http(s)')
      return new StreamableHTTPClientTransport(url, {
        requestInit: { headers: server.headers }
      })
    }
    if (!server.command) throw new Error('stdio MCP 缺少 command')
    const spawnTarget = resolveStdioServerCommand(server.command, server.args)
    return new StdioClientTransport({
      command: spawnTarget.command,
      args: spawnTarget.args,
      cwd: server.cwd,
      env: { ...getDefaultEnvironment(), ...server.env },
      stderr: 'pipe'
    })
  }

  async #connect (server, config) {
    const state = { server, status: 'connecting', error: '', tools: [], client: null, transport: null }
    this.#connections.set(server.id, state)
    try {
      const client = this.#clientFactory(server)
      const transport = await this.#transportFactory(server)
      state.client = client
      state.transport = transport
      await client.connect(transport, { timeout: config.connectTimeoutMs })
      const listed = await client.listTools(undefined, { timeout: config.connectTimeoutMs })
      state.tools = (listed.tools || []).filter(tool => server.allowedTools.length === 0 || server.allowedTools.includes(tool.name))
      state.status = 'connected'
      this.#logger(`[MCP] ${server.name} connected: ${state.tools.length} tools`)
    } catch (err) {
      state.status = 'error'
      state.error = err.message
      this.#logger(`[MCP] ${server.name} connection failed: ${err.message}`)
    }
  }

  async getTools ({ event } = {}) {
    await this.sync()
    const tools = []
    for (const state of this.#connections.values()) {
      if (state.status !== 'connected') continue
      if (state.server.masterOnly && event?.isMaster !== true) continue
      for (const remoteTool of state.tools) {
        const exposedName = `mcp__${safeName(state.server.id)}__${safeName(remoteTool.name)}`
        tools.push({
          name: exposedName,
          toolDef: {
            name: exposedName,
            description: `[MCP: ${state.server.name}] ${remoteTool.description || remoteTool.name}`,
            parameters: remoteTool.inputSchema || { type: 'object', properties: {} }
          },
          run: async (args) => {
            const result = await state.client.callTool(
              { name: remoteTool.name, arguments: args || {} },
              undefined,
              { timeout: normalizeMcpConfig(this.#getConfig()).callTimeoutMs }
            )
            const output = flattenMcpContent(result)
            if (result?.isError) throw new Error(output)
            return output
          },
          _mcp: { serverId: state.server.id, remoteName: remoteTool.name }
        })
      }
    }
    return tools
  }

  getStatus () {
    const config = normalizeMcpConfig(this.#getConfig())
    return {
      enabled: config.enable,
      servers: config.servers.map(server => {
        const state = this.#connections.get(server.id)
        return {
          id: server.id,
          name: server.name,
          transport: server.transport,
          enabled: server.enable,
          status: state?.status || (config.enable ? 'disconnected' : 'disabled'),
          tools: state?.tools?.map(tool => tool.name) || [],
          error: state?.error || ''
        }
      })
    }
  }

  async destroy () {
    const states = [...this.#connections.values()]
    this.#connections.clear()
    await Promise.all(states.map(async state => {
      try { await state.client?.close() } catch {}
      try { await state.transport?.close() } catch {}
    }))
  }
}
