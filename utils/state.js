/**
 * loli-plugin 共享状态与生命周期
 *
 * 将原本散落在 index.js 中的全局状态、辅助函数和初始化逻辑抽取出来，
 * 供 apps/、utils/、server/ 等模块共享，同时避免与 Yunzai 插件入口产生循环依赖。
 */
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { createEngine } from 'lolicon-core'
import defaultConfig from '../config/config.js'

const __filename = fileURLToPath(import.meta.url)
const PLUGIN_ROOT = path.dirname(path.dirname(__filename))
const DATA_DIR = path.join(PLUGIN_ROOT, 'data')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
const TOOLS_DIR = path.join(PLUGIN_ROOT, 'utils', 'tools')

export { PLUGIN_ROOT, DATA_DIR, TOOLS_DIR }

let engine = null
let config = null
let server = null
let pluginLogger = null

// 运行日志缓冲区（供管理面板查看）
const logBuffer = []
const MAX_LOGS = 500

function pushLog (level, ...args) {
  const line = `[${new Date().toLocaleString('zh-CN')}] [${level}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`
  logBuffer.push(line)
  if (logBuffer.length > MAX_LOGS) logBuffer.shift()
}

function wrapLogger () {
  if (typeof logger === 'undefined') {
    return {
      info: (...args) => { console.log(...args); pushLog('INFO', ...args) },
      warn: (...args) => { console.warn(...args); pushLog('WARN', ...args) },
      error: (...args) => { console.error(...args); pushLog('ERROR', ...args) },
      debug: (...args) => { pushLog('DEBUG', ...args) }
    }
  }
  return {
    info: (...args) => { logger.info(...args); pushLog('INFO', ...args) },
    warn: (...args) => { logger.warn(...args); pushLog('WARN', ...args) },
    error: (...args) => { logger.error(...args); pushLog('ERROR', ...args) },
    debug: (...args) => { logger.debug?.(...args); pushLog('DEBUG', ...args) }
  }
}

function mergeDefaults (defaults, value) {
  if (Array.isArray(defaults)) return Array.isArray(value) ? value : [...defaults]
  if (!defaults || typeof defaults !== 'object') return value === undefined ? defaults : value

  const out = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
  for (const key of Object.keys(defaults)) {
    out[key] = mergeDefaults(defaults[key], out[key])
  }
  return out
}

function loadConfig () {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        config = mergeDefaults(defaultConfig, parsed)
      } else {
        throw new Error('parsed config is not an object')
      }
    } catch (err) {
      console.warn(`[loli] 配置文件 ${CONFIG_PATH} 读取失败，使用默认配置: ${err.message}`)
      config = JSON.parse(JSON.stringify(defaultConfig))
      fs.mkdirSync(DATA_DIR, { recursive: true })
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
    }
  } else {
    config = JSON.parse(JSON.stringify(defaultConfig))
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
  }
  return config
}

export const saveConfig = () => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    console.warn('[loli] saveConfig skipped: config is not loaded')
    return
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
}

export const getEngine = () => engine
export const getConfig = () => config
export const getDashboardServer = () => server
export const getLogBuffer = () => logBuffer

/**
 * 插件初始化
 * 带幂等保护：如果引擎已存在则跳过，避免 Yunzai 多次 new 实例时重复初始化。
 */
export async function initPlugin () {
  if (engine) {
    pluginLogger?.warn('[loli] 引擎已初始化，跳过重复 init')
    return
  }

  loadConfig()
  pluginLogger = wrapLogger()
  const l = pluginLogger

  engine = new createEngine({
    dataDir: DATA_DIR,
    toolsDir: TOOLS_DIR,
    enableMemory: false,
    logger: (msg) => l.info(msg)
  })
  await engine.init()

  // 自动注册渠道和预设到存储
  const chaiteConfig = config.chaite || {}
  const channels = chaiteConfig.channels || []
  const presets = chaiteConfig.presets || []

  for (const ch of channels) {
    await engine.saveChannel(ch)
  }
  for (const p of presets) {
    await engine.savePreset(p)
  }

  // 启动记忆调度器
  try {
    const { startScheduler } = await import('../memory/scheduler.js')
    startScheduler({
      dataDir: config.memory?.dailyMd?.dataDir || path.join(DATA_DIR, 'memory/md'),
      archiveDays: config.memory?.archive?.archiveDays || 30,
      logger: l
    })
  } catch (err) {
    l.warn('[loli] 记忆调度器启动失败:', err.message)
  }

  // 启动管理面板
  if (config.dashboard?.enable !== false) {
    try {
      const { startServer } = await import('../server/index.js')
      const serverCtx = {
        engine,
        config,
        saveConfig,
        dataDir: DATA_DIR,
        toolsDir: TOOLS_DIR,
        logs: logBuffer,
        logger: (msg) => l.info(msg)
      }
      server = await startServer(serverCtx, config.dashboard?.port || 3000)
    } catch (err) {
      l.warn('[loli] 管理面板启动失败:', err.message)
    }
  }

  l.info(`[loli] 日奈启动了 (v${config.version || '0.1.0'})`)
}

/**
 * 插件卸载
 */
export async function destroyPlugin () {
  try {
    const { stopScheduler } = await import('../memory/scheduler.js')
    const { closeMemoryStore } = await import('../memory/store.js')
    stopScheduler()
    closeMemoryStore()
  } catch (err) {
    pluginLogger?.warn('[loli] 记忆系统卸载失败:', err.message)
  }
  if (server) {
    await new Promise(resolve => {
      server.close(() => resolve())
      server = null
    })
  }
  if (engine) {
    await engine.destroy()
    engine = null
  }
  pluginLogger?.info('[loli] 日奈已卸载')
}
