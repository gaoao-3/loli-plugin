import path from 'path'

export function getMemoryDataDir (config, fallback = 'data/memory/md') {
  return config?.memory?.dataDir || fallback
}

export function resolveMemoryBaseDir (config, rootDir, fallback = 'data/memory/md') {
  const value = getMemoryDataDir(config, fallback)
  return path.isAbsolute(value) ? value : path.resolve(rootDir, value)
}

export function getMessageRetentionDays (config) {
  return positiveNumber(config?.memory?.messageRetentionDays, 30)
}

function positiveNumber (value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 1 ? number : fallback
}
