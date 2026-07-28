/**
 * loli-plugin 共享状态与生命周期
 *
 * 将原本散落在 index.js 中的全局状态、辅助函数和初始化逻辑抽取出来，
 * 供 apps/、utils/ 等模块共享，同时避免与 Yunzai 插件入口产生循环依赖。
 */
import path from 'path'
import fs from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import { createEngine } from '../core/index.js'
import defaultConfig from '../config/config.js'
import { getMemoryDataDir } from '../memory/options.js'
import { mergeDetectedMasterIdentities } from './identity.js'
import {
  createConfigReloader,
  mergeDefaults,
  reconcileChaiteConfigWithEngine,
  replaceInPlace
} from './config-watcher.js'
import { McpManager } from './mcp-manager.js'
import { SkillManager } from './skill-manager.js'
import { loadConfigFile, saveConfigFile } from './config-storage.js'
import { validateConfigShape } from '../core/src/dashboard/config-validation.js'

const __filename = fileURLToPath(import.meta.url)
const PLUGIN_ROOT = path.dirname(path.dirname(__filename))
const DATA_DIR = path.join(PLUGIN_ROOT, 'data')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
const TOOLS_DIR = path.join(PLUGIN_ROOT, 'utils', 'tools')

export { PLUGIN_ROOT, DATA_DIR, TOOLS_DIR }

let engine = null
let config = null
let pluginLogger = null
let mcpManager = null
let skillManager = null
let historyCleanupTimer = null

const HISTORY_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000

function normalizeHistoryRetentionDays (value) {
  const days = Number(value)
  if (!Number.isFinite(days)) return 30
  return Math.max(0, Math.min(3650, Math.floor(days)))
}

function runHistoryCleanup () {
  if (!engine?.storage?.pruneHistory) return
  const days = normalizeHistoryRetentionDays(config?.llm?.historyRetentionDays)
  if (days === 0) return
  const result = engine.storage.pruneHistory(Date.now() - days * 24 * 60 * 60 * 1000)
  if (result.deleted > 0) {
    pluginLogger?.info(`[loli] 已清理 ${result.deleted} 条过期模型会话历史，释放 ${(result.bytes / 1024 / 1024).toFixed(1)} MiB`)
  }
}

function startHistoryCleanup () {
  clearInterval(historyCleanupTimer)
  try {
    runHistoryCleanup()
  } catch (err) {
    pluginLogger?.warn(`[loli] 启动时清理模型会话历史失败: ${err.message}`)
  }
  historyCleanupTimer = setInterval(() => {
    try {
      runHistoryCleanup()
    } catch (err) {
      pluginLogger?.warn(`[loli] 模型会话历史自动清理失败: ${err.message}`)
    }
  }, HISTORY_CLEANUP_INTERVAL_MS)
  historyCleanupTimer.unref?.()
}

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

function loadConfig () {
  const loaded = loadConfigFile(CONFIG_PATH, defaultConfig, {
    logger: message => console.warn(`[loli] ${message}`),
    validate: value => validateConfigShape(value, defaultConfig)
  })
  config = mergeDefaults(defaultConfig, loaded)
  validateConfigShape(config, defaultConfig)
  return config
}

/** @type {ReturnType<typeof createConfigReloader>|null} 配置热加载器（initPlugin 启动，destroyPlugin 停止） */
let configReloader = null

export const saveConfig = (nextConfig = config) => {
  if (!nextConfig || typeof nextConfig !== 'object' || Array.isArray(nextConfig)) {
    console.warn('[loli] saveConfig skipped: config is not loaded')
    return false
  }
  validateConfigShape(nextConfig, defaultConfig)
  // 先完成磁盘提交，再更新共享对象；写入失败时运行时配置保持原样。
  const serialized = saveConfigFile(CONFIG_PATH, nextConfig)
  if (nextConfig !== config) replaceInPlace(config, nextConfig)
  // 对齐热加载基线，自己的写入不会被误判为外部变更
  configReloader?.markWritten(serialized)
  return config
}

export const getEngine = () => engine
export const getConfig = () => config
export const getDashboardServer = () => engine?.getDashboardServer?.() || null
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
  await syncHostMasterIdentities()
  pluginLogger = wrapLogger()
  const l = pluginLogger

  mcpManager = new McpManager({
    getConfig: () => config?.mcp,
    logger: (msg) => l.info(msg)
  })
  skillManager = new SkillManager({
    getConfig: () => config?.skills,
    pluginRoot: PLUGIN_ROOT,
    logger: (msg) => l.info(msg)
  })

  // 配置热加载：外部手改 config.json 就地生效，无需重启（面板/进程内保存不受影响）
  // 回环保护：restore→saveConfig 若仍被反复判为外部变更（典型原因：另一个实例共享同一
  // data 目录、内存里持旧版渠道/预设，两边互相“恢复”），连续命中即停 watchers 并报警，
  // 避免双实例乒乓把日志和磁盘刷爆。
  let restoreHistory = []
  configReloader = createConfigReloader({
    configPath: CONFIG_PATH,
    defaults: defaultConfig,
    target: config,
    logger: (msg) => l.info(`[loli] ${msg}`),
    onReload: async (reloadedConfig) => {
      if (!reloadedConfig.chaite) reloadedConfig.chaite = {}
      const restored = await reconcileChaiteConfigWithEngine(engine, reloadedConfig.chaite)
      if (!restored) return
      const now = Date.now()
      restoreHistory = restoreHistory.filter(t => now - t < 60_000)
      restoreHistory.push(now)
      if (restoreHistory.length > 3) {
        l.warn('[loli] config.json 渠道/预设在 1 分钟内被反复改写，疑似有第二个实例共享同一 data 目录（如 SMB 共享/双开）。已停用配置热加载，请只保留一个机器人实例后重启。')
        await configReloader.stop()
        return
      }
      l.warn('[loli] 检测到 config.json 中的渠道/预设落后，已保留面板持久化版本')
      saveConfig()
    }
  })

  engine = new createEngine({
    dataDir: DATA_DIR,
    toolsDir: TOOLS_DIR,
    enableMemory: false,
    logger: (msg) => l.info(msg),
    localToolProvider: async (context) => skillManager.getLocalTools(context.availableTools, context),
    externalToolProvider: async (context) => [
      ...(await mcpManager.getTools(context)),
      ...skillManager.getTools(context)
    ],
    externalContextProvider: async (context) => skillManager.getCatalogContext(context)
  })
  await engine.init()
  startHistoryCleanup()
  await Promise.all([mcpManager.init(), skillManager.init()])

  // 渠道/预设以 data/ch、data/pr 为持久化事实来源；存储为空时才从 config.json 迁移。
  if (!config.chaite) config.chaite = {}
  if (await reconcileChaiteConfigWithEngine(engine, config.chaite)) saveConfig()
  configReloader.start()

  // 重启后补处理已入库但尚未完成视觉标签的图片表情。
  try {
    const { listStickers } = await import('./stickers.js')
    const { enqueueStickerClassifications } = await import('./sticker-classifier.js')
    const pending = listStickers({ enabled: true, limit: 200 })
    enqueueStickerClassifications({ engine, config, stickers: pending, logger: l })
  } catch (err) {
    l.warn(`[Sticker] 启动视觉识别补偿失败: ${err.message}`)
  }

  // 启动记忆调度器
  try {
    const { startScheduler } = await import('../memory/scheduler.js')
    startScheduler({
      dataDir: getMemoryDataDir(config, path.join(DATA_DIR, 'memory/md')),
      logger: l
    })
  } catch (err) {
    l.warn('[loli] 记忆调度器启动失败:', err.message)
  }

  // 启动管理面板
  if (config.dashboard?.enable !== false) {
    try {
      if (typeof engine.startDashboard !== 'function') {
        throw new Error('内置核心不包含管理面板，请更新 loli-plugin')
      }
      await engine.startDashboard({
        config,
        saveConfig,
        toolsDir: TOOLS_DIR,
        logs: logBuffer,
        logger: (msg) => l.info(msg),
        getBot: () => globalThis.Bot,
        dokobot: {
          getStatus: async () => {
            const { getDokobotStatus } = await import('./dokobot.js')
            return getDokobotStatus(config.dokobot)
          }
        },
        extensions: {
          getStatus: async () => ({
            mcp: mcpManager.getStatus(),
            skills: skillManager.getStatus()
          }),
          reload: async () => {
            await mcpManager.reload()
            skillManager.reload()
            return { mcp: mcpManager.getStatus(), skills: skillManager.getStatus() }
          }
        },
        memory: {
          getStats: async () => {
            const { getStats } = await import('../memory/store.js')
            const { resolveMemoryBaseDir } = await import('../memory/options.js')
            return getStats(resolveMemoryBaseDir(config, PLUGIN_ROOT))
          }
        }
      })
    } catch (err) {
      l.warn('[loli] 管理面板启动失败:', err.message)
    }
  }

  l.info(`[loli] 日奈启动了 (v${config.version || '0.1.0'})`)
}

async function syncHostMasterIdentities () {
  const master = config?.loli?.masterIdentity
  if (master?.enable === false || master?.autoDetect === false) return
  try {
    const hostConfigUrl = pathToFileURL(path.resolve(PLUGIN_ROOT, '..', '..', 'lib', 'config', 'config.js')).href
    const hostConfig = (await import(hostConfigUrl)).default
    const ids = Array.isArray(hostConfig?.masterQQ) ? hostConfig.masterQQ : []
    const detected = ids.map(userId => ({ userId, nickname: findBotNickname(userId) }))
    if (mergeDetectedMasterIdentities(config, detected)) saveConfig()
  } catch (err) {
    pluginLogger?.debug?.(`[loli] 自动读取宿主主人列表失败: ${err.message}`)
  }
}

function findBotNickname (userId) {
  const id = String(userId || '')
  const botRoot = globalThis.Bot
  const candidates = [botRoot, ...Object.values(botRoot || {})].filter(Boolean)
  for (const bot of candidates) {
    const friend = bot?.fl?.get?.(Number(id)) || bot?.fl?.get?.(id)
    const nickname = friend?.nickname || friend?.nick || friend?.remark
    if (nickname) return String(nickname)
  }
  return ''
}

/**
 * 插件卸载
 */
export async function destroyPlugin () {
  clearInterval(historyCleanupTimer)
  historyCleanupTimer = null
  await configReloader?.stop()
  configReloader = null
  await mcpManager?.destroy()
  mcpManager = null
  skillManager = null
  try {
    const { stopScheduler } = await import('../memory/scheduler.js')
    const { closeMemoryStore } = await import('../memory/store.js')
    const { closeStickerStores } = await import('./stickers.js')
    stopScheduler()
    closeMemoryStore()
    closeStickerStores()
  } catch (err) {
    pluginLogger?.warn('[loli] 记忆系统卸载失败:', err.message)
  }
  if (engine) {
    await engine.destroy()
    engine = null
  }
  pluginLogger?.info('[loli] 日奈已卸载')
}
