/**
 * MemoryInjector — 把召回的记忆结构化成 prompt 文本
 *
 * 原则：
 *   - 只注入相关事实，避免污染 system prompt。
 *   - 控制总长度，防止 token 爆炸。
 *   - 输出格式稳定，便于模型理解。
 */

export class MemoryInjector {
  /** @type {number} */
  maxLength

  constructor (opts = {}) {
    this.maxLength = opts.maxLength || 2000
  }

  /**
   * 把召回结果转成可注入的文本
   * @param {Object} recall
   * @param {Object[]} recall.entities
   * @param {Object[]} recall.relations
   * @param {string} [recall.text]
   * @returns {string}
   */
  buildPrompt ({ text = '' }) {
    if (!text) return ''
    const header = '以下是与当前对话相关的已知记忆，请作为背景参考（不要主动提及，除非用户问起）：\n'
    const full = header + text
    return full.length > this.maxLength ? full.slice(0, this.maxLength) + '\n...' : full
  }

  /**
   * 把 system prompt 和记忆文本合并
   * @param {UnifiedMessage} systemPrompt
   * @param {string} memoryText
   * @returns {UnifiedMessage}
   */
  inject (systemPrompt, memoryText) {
    if (!memoryText || !systemPrompt) return systemPrompt
    const textPart = systemPrompt.content?.find(c => c.type === 'text')
    if (textPart) {
      textPart.text += '\n\n' + memoryText
    } else {
      systemPrompt.content = systemPrompt.content || []
      systemPrompt.content.push({ type: 'text', text: memoryText })
    }
    return systemPrompt
  }
}
