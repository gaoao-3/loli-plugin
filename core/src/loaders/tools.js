/**
 * 工具热加载器 — 基于 chokidar + 内存 Map
 * 替代 chaite 的 ToolManager + SQLite tool_groups 全栈
 */
import chokidar from 'chokidar'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

export class ToolLoader {
  /** @type {Map<string, Object>} name → tool instance */
  #tools = new Map()
  /** @type {string} */
  #toolsDir
  /** @type {Function} */
  #logger
  /** @type {chokidar.FSWatcher|null} */
  #watcher = null
  /** @type {NodeJS.Timeout|null} */
  #debounce = null

  /**
   * @param {Object} opts
   * @param {string} opts.toolsDir - 工具 JS 文件目录
   * @param {Function} [opts.logger]
   */
  constructor (opts) {
    this.#toolsDir = opts.toolsDir
    this.#logger = opts.logger || (() => {})
  }

  /** 初始化：扫描目录 + 启动监听 */
  async init () {
    await this.#scanAll()
    this.#startWatch()
    return this
  }

  /** 获取全部已加载工具 */
  getAll () {
    return [...this.#tools.values()]
  }

  /** 获取全部工具定义（给 AI 用） */
  getAllDefs () {
    return this.getAll().map(t => t.toolDef || t).filter(Boolean)
  }

  /** 按名称获取 */
  get (name) {
    return this.#tools.get(name)
  }

  /** 重新扫描并加载全部工具 */
  async #scanAll () {
    if (!fs.existsSync(this.#toolsDir)) return
    const files = fs.readdirSync(this.#toolsDir).filter(f => f.endsWith('.js'))
    const prev = new Set(this.#tools.keys())

    for (const file of files) {
      const name = file.replace(/\.js$/, '')
      prev.delete(name)
      await this.#loadTool(name, file)
    }

    // 清理已删除的工具
    for (const dead of prev) {
      this.#tools.delete(dead)
      this.#logger(`[loli] tool unloaded: ${dead}`)
    }

    const names = [...this.#tools.keys()]
    if (names.length > 0) {
      this.#logger(`[loli] ${names.length} tools loaded: [${names.join(', ')}]`)
    }
  }

  /** 加载单个工具文件 */
  async #loadTool (name, filename) {
    const filePath = path.join(this.#toolsDir, filename)
    try {
      // Windows 绝对路径必须用 file:// 协议
      const url = 'file:///' + filePath.replace(/\\/g, '/') + '?t=' + Date.now()
      const mod = await import(url)
      const tool = mod.default || mod
      if (!tool || (!tool.run && !tool.function)) {
        throw new Error(`Invalid tool: missing run() or function def`)
      }

      // 统一包装
      const rawDeclaration = tool.function || tool.toolDef?.function || tool.toolDef || tool
      const {
        run: _run,
        toolDef: _toolDef,
        function: _function,
        _file,
        ...declaration
      } = rawDeclaration
      const toolName = declaration?.name || tool.name || name
      const instance = {
        name: toolName,
        // 内部统一保存 Gemini FunctionDeclaration 形状；
        // OpenAI 等适配器在真正发请求时再转换成各自的外层格式。
        toolDef: declaration,
        run: tool.run || tool,
        _file: filename
      }
      this.#tools.set(name, instance)
    } catch (err) {
      this.#logger(`[loli] tool load error: ${name} — ${err.message}`)
    }
  }

  /** 启动文件监听（防抖 500ms） */
  #startWatch () {
    if (!fs.existsSync(this.#toolsDir)) return

    this.#watcher = chokidar.watch(this.#toolsDir, {
      persistent: true,
      ignoreInitial: true,
      depth: 0
    })

    const rescan = () => {
      clearTimeout(this.#debounce)
      this.#debounce = setTimeout(() => {
        this.#scanAll().catch(e => this.#logger(`[loli] tool scan error: ${e.message}`))
      }, 500)
    }

    this.#watcher.on('add', (fp) => {
      if (fp.endsWith('.js')) rescan()
    })
    this.#watcher.on('change', (fp) => {
      if (fp.endsWith('.js')) rescan()
    })
    this.#watcher.on('unlink', (fp) => {
      if (fp.endsWith('.js')) {
        const name = path.basename(fp, '.js')
        this.#tools.delete(name)
        rescan()
      }
    })
  }

  /** 清理 */
  async destroy () {
    clearTimeout(this.#debounce)
    await this.#watcher?.close()
    this.#tools.clear()
  }
}
