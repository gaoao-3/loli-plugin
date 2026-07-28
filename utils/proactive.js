import { normalizeSegment } from './bot.js'
import { stripIdentityPrompt } from './identity.js'

const MEANINGFUL_SEGMENT_TYPES = new Set([
  'text', 'image', 'flash', 'face', 'mface', 'video', 'record', 'file', 'json', 'xml', 'share', 'music'
])

/** 仅在当前事件确实包含可回应内容时允许主动触发。 */
export function hasMeaningfulProactiveEvent (event) {
  if (String(event?.msg || '').trim()) return true
  return (Array.isArray(event?.message) ? event.message : []).some(raw => {
    const segment = normalizeSegment(raw)
    if (!MEANINGFUL_SEGMENT_TYPES.has(segment.type)) return false
    if (segment.type === 'text') return Boolean(String(segment.text || '').trim())
    return true
  })
}

/** 身份头本身不算消息；真实文本或成功注入的媒体才算。 */
export function hasMeaningfulUserMessage (message) {
  const content = Array.isArray(message?.content) ? message.content : []
  const text = content
    .filter(item => item?.type === 'text')
    .map(item => item.text || '')
    .join('\n')
  if (stripIdentityPrompt(text)) return true
  return content.some(item => ['image', 'video', 'audio', 'file'].includes(item?.type))
}

/** 主动回复约束只进入本轮 system prompt，不写入用户消息或长期记忆。 */
export function buildProactiveSystemDirective ({ groupId, userId, messageId } = {}) {
  return `[主动回复边界]
当前群号：${String(groupId || '-')}
当前发送者 QQ：${String(userId || '-')}
当前消息 ID：${String(messageId || '-')}
请只根据“当前消息”和本 system prompt 中标记为当前群的时间线自然、简短地回应。
禁止引用、延续或猜测其他群、其他会话以及当前材料中没有出现的话题；当前材料不足以形成有意义回复时，保持沉默。`
}

