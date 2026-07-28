export const LEGACY_PROACTIVE_PLACEHOLDER = '（基于以上群聊上下文，自然地说一句简短的话加入讨论，不要自我介绍，不要提"上下文"或"以上内容"）'

export function removeInternalMemoryPlaceholder (value) {
  const text = String(value || '').trim()
  return text === LEGACY_PROACTIVE_PLACEHOLDER ? '' : text
}

