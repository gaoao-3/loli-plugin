/**
 * loli-plugin — 日奈 QQ 机器人插件入口
 */
import path from 'path'
import fs from 'fs'
import { createEngine } from 'lolicon-core'
import defaultConfig from './config/config.js'

const PLUGIN_ROOT = path.dirname(new URL(import.meta.url).pathname)
const DATA_DIR = path.join(PLUGIN_ROOT, 'data')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')

let engine = null
let config = null

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

  // 创建引擎（工具目录直接指向源码，chokidar 监听实时生效）
  engine = new createEngine({
    dataDir: DATA_DIR,
    toolsDir: path.join(PLUGIN_ROOT, 'utils', 'tools'),
    logger: (msg) => logger.info(msg)
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
      logger
    })
  } catch (err) {
    logger.warn('[loli] 记忆调度器启动失败:', err.message)
  }

  logger.info(`[loli] 日奈启动了 (v${config.version || '0.1.0'})`)
}

/**
 * 插件卸载
 */
export async function destroy () {
  if (engine) {
    await engine.destroy()
    engine = null
  }
  logger.info('[loli] 日奈已卸载')
}

export { PLUGIN_ROOT, DATA_DIR, saveConfig }
