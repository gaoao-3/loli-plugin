/** 代码沙盒公共入口 — Microsoft Quicksand microVM。 */

/** 支持的语言 */
export const LANGUAGES = ['python', 'javascript', 'bash']

/** 单路输出最大字符数 */
export const MAX_OUTPUT = 4096

/** 语言名规范化与校验 */
export function resolveLanguage (name) {
  const lang = String(name || '').trim().toLowerCase()
  if (!LANGUAGES.includes(lang)) {
    throw new Error(`不支持的语言 "${name}"，支持: ${LANGUAGES.join(', ')}`)
  }
  return lang
}

/** 在一次性、完全断网的 Quicksand microVM 中执行代码。 */
export async function executeCode (options) {
  const language = resolveLanguage(options.language || options.cfg?.defaultLanguage)
  const executeQuicksand = options.quicksandExecute ||
    (await import('./sandbox-quicksand.js')).executeQuicksandCode
  return executeQuicksand({ ...options, language })
}
