const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

export function isConfigObject (value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function valueType (value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function validateNestedKeys (value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNestedKeys(item, `${path}[${index}]`))
    return
  }
  if (!isConfigObject(value)) return
  for (const key of Object.keys(value)) {
    if (BLOCKED_KEYS.has(key)) throw new TypeError(`${path}.${key} 是禁止的配置键`)
    validateNestedKeys(value[key], `${path}.${key}`)
  }
}

/**
 * 校验配置对象中的危险键，并对 reference 已知字段执行递归类型检查。
 * 未知扩展字段允许保留，便于插件向前兼容。
 */
export function validateConfigShape (source, reference = {}, path = 'config') {
  if (!isConfigObject(source)) throw new TypeError(`${path} 必须是 JSON 对象`)

  for (const key of Object.keys(source)) {
    if (BLOCKED_KEYS.has(key)) throw new TypeError(`${path}.${key} 是禁止的配置键`)
    const value = source[key]
    const current = reference?.[key]

    if (current !== undefined && current !== null) {
      const expected = valueType(current)
      const actual = valueType(value)
      if (expected !== actual) {
        throw new TypeError(`${path}.${key} 类型错误：应为 ${expected}，实际为 ${actual}`)
      }
    }

    if (isConfigObject(value)) {
      validateConfigShape(value, isConfigObject(current) ? current : {}, `${path}.${key}`)
    } else {
      validateNestedKeys(value, `${path}.${key}`)
    }
  }
  return source
}

/** 防御式深度合并；调用方应先执行 validateConfigShape。 */
export function mergeConfigPatch (target, source) {
  for (const key of Object.keys(source)) {
    if (BLOCKED_KEYS.has(key)) throw new TypeError(`禁止的配置键: ${key}`)
    if (isConfigObject(source[key])) {
      if (!isConfigObject(target[key])) target[key] = {}
      mergeConfigPatch(target[key], source[key])
    } else {
      target[key] = source[key]
    }
  }
  return target
}
