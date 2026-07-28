/**
 * 配置文件热加载 — 监听 config.json 外部变更并就地刷新内存配置
 *
 * 配置有两条写入路径：进程内 saveConfig 回写、用户/外部直接改文件。
 * 普通运行配置以 config.json 为事实来源；渠道/预设已有独立存储时以 data/ch、data/pr 为准。
 * 自写自读通过 markWritten 基线去重，不会形成回环。
 */
import chokidar from 'chokidar'
import fs from 'fs'
import { validateConfigShape } from '../core/src/dashboard/config-validation.js'

/** 深度合并：用 defaults 补齐 value 缺失的键（数组整体替换，不做元素合并） */
export function mergeDefaults (defaults, value) {
  if (Array.isArray(defaults)) return Array.isArray(value) ? value : [...defaults]
  if (!defaults || typeof defaults !== 'object') return value === undefined ? defaults : value

  const out = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
  for (const key of Object.keys(defaults)) {
    out[key] = mergeDefaults(defaults[key], out[key])
  }
  return out
}

/** 就地替换目标对象内容（保持引用不变，所有持有方立即可见） */
export function replaceInPlace (target, source) {
  for (const key of Object.keys(target)) delete target[key]
  Object.assign(target, source)
  return target
}

/**
 * 将 config.chaite 中的渠道和预设完整同步到引擎存储。
 * config.json 是事实来源，因此不仅更新已有项，也删除配置中已经移除的旧项。
 */
export async function syncChaiteConfigToEngine (engine, chaite = {}) {
  if (!engine) return

  const channels = Array.isArray(chaite.channels) ? chaite.channels : []
  const presets = Array.isArray(chaite.presets) ? chaite.presets : []
  const desiredChannelIds = new Set(channels.map(item => item?.id).filter(Boolean))
  const desiredPresetIds = new Set(presets.map(item => item?.id).filter(Boolean))

  for (const channel of channels) await engine.saveChannel(channel)
  for (const preset of presets) await engine.savePreset(preset)

  const currentPresets = await engine.listPresets()
  for (const preset of currentPresets) {
    if (!desiredPresetIds.has(preset?.id)) {
      if (typeof engine.deletePreset === 'function') await engine.deletePreset(preset.id)
      else await engine.storage?.deletePreset?.(preset.id)
    }
  }

  const currentChannels = await engine.listChannels()
  for (const channel of currentChannels) {
    if (!desiredChannelIds.has(channel?.id)) await engine.deleteChannel(channel.id)
  }
}

/**
 * 协调 config.json 与引擎的渠道/预设存储。
 *
 * data/ch 与 data/pr 是面板实际写入的持久化存储。只要其中已有数据，就以它们为准，
 * 避免旧版 config.json、编辑器快照或工作区恢复把面板刚保存的选择反向覆盖。
 * 仅在对应存储为空时，才把 config.json 中的数据迁移进去。
 */
export async function reconcileChaiteConfigWithEngine (engine, chaite = {}) {
  if (!engine) return false

  const configChannels = Array.isArray(chaite.channels) ? chaite.channels : []
  const configPresets = Array.isArray(chaite.presets) ? chaite.presets : []
  const storedChannels = await engine.listChannels()
  const storedPresets = await engine.listPresets()
  let changed = false

  if (storedChannels.length > 0) {
    if (JSON.stringify(configChannels) !== JSON.stringify(storedChannels)) {
      changed = true
      // 外部快照可能同时替换了 data/ch 文件；重新入队落盘当前内存版本。
      for (const channel of storedChannels) await engine.saveChannel(channel)
    }
    chaite.channels = storedChannels
  } else {
    for (const channel of configChannels) await engine.saveChannel(channel)
  }

  if (storedPresets.length > 0) {
    if (JSON.stringify(configPresets) !== JSON.stringify(storedPresets)) {
      changed = true
      // 保证旧 config.json 触发恢复后，data/pr 也回写为面板当前版本。
      for (const preset of storedPresets) await engine.savePreset(preset)
    }
    chaite.presets = storedPresets
  } else {
    for (const preset of configPresets) await engine.savePreset(preset)
  }

  return changed
}

/**
 * 创建配置热加载器
 * @param {Object} opts
 * @param {string} opts.configPath - 监听的配置文件路径
 * @param {Object} opts.defaults - 默认配置（merge 补齐缺失键）
 * @param {Object} opts.target - 内存配置对象（就地更新，引用不变）
 * @param {Function} [opts.logger]
 * @param {Function} [opts.onReload] - 配置就地更新后执行；可返回 Promise
 * @param {number} [opts.debounceMs]
 */
export function createConfigReloader ({ configPath, defaults, target, logger = () => {}, onReload = null, debounceMs = 500 }) {
  let lastContent = null
  let watcher = null
  let timer = null

  /** 进程内写配置后调用，把基线对齐到自己的写入，避免误判为外部变更 */
  const markWritten = (content) => { lastContent = content }

  /** 立即从磁盘重载一次；内容无变化或解析失败则跳过。返回是否应用了变更 */
  const reload = async () => {
    let raw
    try {
      raw = fs.readFileSync(configPath, 'utf8')
    } catch {
      return false
    }
    if (raw === lastContent) return false

    let parsed
    try {
      parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('配置不是 JSON 对象')
    } catch (err) {
      logger(`config.json 变更但解析失败，已忽略: ${err.message}`)
      return false
    }

    const candidate = mergeDefaults(defaults, parsed)
    try {
      validateConfigShape(candidate, defaults)
    } catch (err) {
      logger(`config.json 变更但结构无效，已忽略: ${err.message}`)
      return false
    }

    lastContent = raw
    replaceInPlace(target, candidate)
    await onReload?.(target)
    logger('config.json 外部变更已热加载')
    return true
  }

  /** 开始监听（幂等） */
  const start = () => {
    if (watcher) return
    try { lastContent = fs.readFileSync(configPath, 'utf8') } catch { lastContent = null }
    watcher = chokidar.watch(configPath, { persistent: true, ignoreInitial: true })
    const onEvent = () => {
      clearTimeout(timer)
      timer = setTimeout(async () => {
        try { await reload() } catch (err) { logger(`config 热加载失败: ${err.message}`) }
      }, debounceMs)
    }
    watcher.on('add', onEvent).on('change', onEvent)
  }

  const stop = async () => {
    clearTimeout(timer)
    await watcher?.close()
    watcher = null
  }

  return { start, stop, reload, markWritten }
}
