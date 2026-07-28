import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

function isConfigObject (value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function syncDirectory (dir) {
  let fd
  try {
    fd = fs.openSync(dir, 'r')
    fs.fsyncSync(fd)
  } catch {
    // Windows may reject fsync on directory handles; the file itself is already synced.
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch {}
    }
  }
}

/** 原子替换文本文件：同目录临时文件写入并 fsync 后再 rename。 */
export function atomicWriteTextFile (file, content) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  let mode = 0o600
  try { mode = fs.statSync(file).mode } catch {}
  let fd
  try {
    fd = fs.openSync(temp, 'wx', mode)
    fs.writeFileSync(fd, content, 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(temp, file)
    syncDirectory(dir)
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch {}
    }
    try { fs.unlinkSync(temp) } catch {}
  }
}

/**
 * 保存配置，并在覆盖有效旧配置前更新 .bak。
 * 返回实际写入的序列化内容，供 watcher 对齐自写基线。
 */
export function saveConfigFile (file, value, { backup = true } = {}) {
  if (!isConfigObject(value)) throw new TypeError('config must be an object')
  const serialized = JSON.stringify(value, null, 2)
  if (serialized === undefined) throw new TypeError('config is not serializable')

  if (backup && fs.existsSync(file)) {
    const current = fs.readFileSync(file, 'utf8')
    try {
      const parsed = JSON.parse(current)
      if (isConfigObject(parsed)) atomicWriteTextFile(`${file}.bak`, current)
    } catch {
      // Never replace a known-good backup with a damaged main file.
    }
  }

  atomicWriteTextFile(file, serialized)
  return serialized
}

function readConfigObject (file, validate) {
  const raw = fs.readFileSync(file, 'utf8')
  const parsed = JSON.parse(raw)
  if (!isConfigObject(parsed)) throw new TypeError('配置不是 JSON 对象')
  validate?.(parsed)
  return { parsed, raw }
}

function preserveCorruptFile (file) {
  if (!fs.existsSync(file)) return null
  const suffix = new Date().toISOString().replace(/[:.]/g, '-')
  const target = `${file}.corrupt-${suffix}`
  fs.renameSync(file, target)
  return target
}

/**
 * 读取主配置。主文件损坏时优先恢复 .bak；没有可用备份时保留损坏文件再生成默认配置。
 */
export function loadConfigFile (file, defaults, { logger = () => {}, validate } = {}) {
  if (!fs.existsSync(file)) {
    saveConfigFile(file, defaults, { backup: false })
    return structuredClone(defaults)
  }

  try {
    return readConfigObject(file, validate).parsed
  } catch (mainError) {
    let preserved = null
    try {
      preserved = preserveCorruptFile(file)
    } catch (preserveError) {
      throw new Error(`配置读取失败且无法保留损坏文件: ${mainError.message}; ${preserveError.message}`)
    }

    const backupFile = `${file}.bak`
    try {
      const backup = readConfigObject(backupFile, validate)
      atomicWriteTextFile(file, backup.raw)
      logger(`配置文件损坏，已从备份恢复；损坏副本保留在 ${preserved}`)
      return backup.parsed
    } catch (backupError) {
      saveConfigFile(file, defaults, { backup: false })
      logger(`配置文件损坏且备份不可用，已生成默认配置；损坏副本保留在 ${preserved}（${backupError.message}）`)
      return structuredClone(defaults)
    }
  }
}
