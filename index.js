/**
 * loli-plugin — 日奈 QQ 机器人插件入口
 */
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { createEngine } from 'lolicon-core'
import defaultConfig from './config/config.js'
import { startServer } from './server/index.js'

const __filename = fileURLToPath(import.meta.url)
const PLUGIN_ROOT = path.dirname(__filename)
const DATA_DIR = path.join(PLUGIN_ROOT, 'data')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
const TOOLS_DIR = path.join(PLUGIN_ROOT, 'utils', 'tools')

let engine = null
let config = null
let server = null
let serverCtx = null
let pluginLogger = null

// 运行日志缓冲区（供管理面板查看）
const logBuffer = []
const MAX_LOGS = 500

function pushLog (level, ...args) {
  const line = `[${new Date().toLocaleString('zh-CN')}] [${level}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`
  logBuffer.push(line)
  if (logBuffer.length > MAX_LOGS) logBuffer.shift()
}

/**
 * 包装 Yunzai logger，同时写入面板日志缓冲区
 */
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

/**
 * 加载配置（文件 → 对象）
 */
function loadConfig () {
  if (fs.existsSync(CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } else {
    config = JSON.parse(JSON.stringify(defaultConfig))
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
  }
  return config
}

/** 保存配置 */
function saveConfig () {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
}

/** 获取引擎实例 */
export function getEngine () { return engine }

/** 获取配置 */
export function getConfig () { return config }

/** 获取管理面板服务器实例 */
export function getDashboardServer () { return server }

/**
 * 插件入口 — TRSS-Yunzai 规范
 */
export const rule = {}

/**
 * 插件初始化
 * TRSS-Yunzai loader 会调用此函数
 */
export async function init () {
  loadConfig()
  pluginLogger = wrapLogger()
  const l = pluginLogger

  // 创建引擎（工具目录直接指向源码，chokidar 监听实时生效）
  engine = new createEngine({
    dataDir: DATA_DIR,
    toolsDir: TOOLS_DIR,
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
    const { startScheduler } = await import('./memory/scheduler.js')
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
      serverCtx = {
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
export async function destroy () {
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

export { PLUGIN_ROOT, DATA_DIR, TOOLS_DIR, saveConfig }
