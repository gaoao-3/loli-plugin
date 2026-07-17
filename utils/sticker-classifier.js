import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { fetchAndCompressImage } from './common.js'
import { cacheStickerMedia, getSticker, updateStickerMetadata } from './stickers.js'

let queue = Promise.resolve()

export function enqueueStickerClassifications ({ engine, config, event, stickers = [], logger, dbFile } = {}) {
  if (!engine || config?.stickers?.autoClassify === false) return
  for (const sticker of stickers) {
    if (!shouldClassify(sticker)) continue
    queue = queue
      .then(() => classifySticker({ engine, config, event, sticker, logger, dbFile }))
      .catch(err => logger?.warn?.(`[Sticker] 表情 #${sticker.id} 视觉识别失败: ${err.message}`))
  }
}

export async function classifySticker ({ engine, config, event, sticker, logger, dbFile } = {}) {
  if (!engine || !sticker?.id) throw new Error('缺少引擎或表情记录')
  const sourceUrl = await resolveStickerSourceUrl(sticker, event)
  if (!sourceUrl) throw new Error('原始消息段没有可读取的图片 URL，请重新发送该表情后识别')
  const preset = resolveClassifierPreset(config)
  if (!preset?.channelId) throw new Error('没有可用的视觉模型渠道')
  const image = await fetchAndCompressImage(sourceUrl, {
    timeoutMs: 15000,
    retries: 1,
    // 动画 GIF/WebP 必须保留原始帧，不能沿用聊天图片的 JPEG 压缩逻辑。
    imageCompress: { ...(config?.loli?.imageCompress || {}), enable: false }
  })
  const cachedSticker = cacheStickerMedia(sticker.id, image.buffer, image.mimeType, dbFile)
  if (sticker.description) return cachedSticker
  const request = {
    channelId: config?.stickers?.classificationChannelId || config?.memory?.refinementChannelId || preset.channelId,
    presetId: preset.id,
    image: image.buffer.toString('base64'),
    mimeType: image.mimeType,
    model: config?.stickers?.classificationModel || config?.memory?.refinementModel || preset.sendMessageOption?.model
  }
  let result
  let structured = true
  try {
    result = await requestClassification(engine, sticker.id, request, CLASSIFICATION_REQUEST, true)
  } catch (err) {
    structured = false
    logger?.warn?.(`[Sticker] 当前渠道不接受结构化输出参数，降级普通 JSON: ${err.message}`)
    result = await requestClassification(engine, sticker.id, request, CLASSIFICATION_REQUEST, false)
  }
  let parsed
  try {
    parsed = parseClassification(result.finalText)
  } catch (firstError) {
    logger?.warn?.(`[Sticker] 表情 #${sticker.id} 标签 JSON 不完整，正在重试: ${firstError.message}`)
    result = await requestClassification(engine, sticker.id, request, RETRY_CLASSIFICATION_REQUEST, structured)
    parsed = parseClassification(result.finalText, { allowPartial: true })
  }
  const tags = [...parsed.emotions, ...parsed.actions, ...parsed.scenes]
  if (!tags.length) throw new Error('视觉模型没有返回有效标签')
  const updated = updateStickerMetadata(sticker.id, { tags, description: parsed.description }, dbFile)
  logger?.info?.(`[Sticker] 表情 #${sticker.id} 已识别: ${tags.join('、')}`)
  return updated
}

export async function classifyStoredSticker ({ engine, config, event, id, logger, dbFile } = {}) {
  const sticker = getSticker(id, dbFile)
  if (!sticker) throw new Error(`没有找到表情 #${id}`)
  return classifySticker({ engine, config, event, sticker, logger, dbFile })
}

const CLASSIFICATION_REQUEST = `分析这个 QQ 动画表情或贴纸，返回：
{"emotions":["主要情绪"],"actions":["动作或反应"],"scenes":["适用聊天场景"],"description":"一句客观描述"}
要求：每组 1-3 个简短中文词；不得猜人物真实身份；不得输出 Markdown 或 JSON 之外的文字。`

const RETRY_CLASSIFICATION_REQUEST = `分析这个 QQ 表情。只输出一行紧凑 JSON，不要代码块、解释或思考过程：
{"emotions":["情绪"],"actions":["动作"],"scenes":["场景"],"description":"描述"}`

const CLASSIFICATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    emotions: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
    actions: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
    scenes: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
    description: { type: 'string' }
  },
  required: ['emotions', 'actions', 'scenes', 'description']
}

async function requestClassification (engine, stickerId, request, prompt, structured = true) {
  return engine.sendMessage({
    channelId: request.channelId,
    presetId: request.presetId,
    conversationId: `sticker-classifier:${stickerId}:${randomUUID()}`,
    userMessage: {
      role: 'user',
      content: [
        { type: 'image', image: request.image, mimeType: request.mimeType },
        { type: 'text', text: prompt }
      ]
    },
    overrideOptions: {
      model: request.model,
      temperature: 0.1,
      maxTokens: 1024,
      enableReasoning: false,
      thinkingLevel: 'OFF',
      disableTools: true,
      ...(structured
        ? { responseMimeType: 'application/json', responseJsonSchema: CLASSIFICATION_JSON_SCHEMA }
        : {})
    },
    systemPromptOverride: '你是 QQ 表情语义标注器。只分析图片表达的情绪、动作和聊天用途，只输出严格 JSON，不调用工具，不进行角色扮演。'
  })
}

function shouldClassify (sticker) {
  if (!['image', 'marketface', 'favorite'].includes(sticker.kind)) return false
  const sourceAvailable = Boolean(sticker.sourceSegment || findHttpUrl(sticker.payload))
  if (!sourceAvailable) return false
  if (!sticker.description) return true
  if (sticker.kind === 'image') {
    const file = String(sticker.payload?.file || '')
    return !file || !fs.existsSync(file)
  }
  return false
}

async function resolveStickerSourceUrl (sticker, event) {
  const direct = findHttpUrl(sticker.sourceSegment) || findHttpUrl(sticker.payload)
  if (direct) return direct
  const source = sticker.sourceSegment
  if (!source) return ''
  const contact = event?.group || event?.friend
  if (typeof contact?.getPicUrl === 'function') {
    try {
      const url = await contact.getPicUrl(source)
      if (typeof url === 'string' && /^https?:\/\//iu.test(url)) return url
    } catch {}
  }
  return ''
}

function resolveClassifierPreset (config = {}) {
  const presets = config?.chaite?.presets || []
  const presetId = config?.stickers?.classificationPresetId || config?.loli?.defaultPreset
  return presets.find(item => item.id === presetId && item.status !== 'disabled') ||
    presets.find(item => item.status !== 'disabled') || presets[0]
}

function parseClassification (text, { allowPartial = false } = {}) {
  const source = String(text || '').replace(/```(?:json)?/giu, '').replace(/```/gu, '').trim()
  const match = source.match(/\{[\s\S]*\}/u)
  let parsed
  try {
    if (!match) throw new Error('missing object')
    parsed = JSON.parse(match[0])
  } catch {
    if (!allowPartial) throw new Error(`视觉模型返回的 JSON 不完整: ${source.slice(0, 100) || '(空)'}`)
    parsed = parsePartialClassification(source)
  }
  return {
    emotions: cleanArray(parsed.emotions || parsed.emotion),
    actions: cleanArray(parsed.actions || parsed.action),
    scenes: cleanArray(parsed.scenes || parsed.scene || parsed.contexts),
    description: String(parsed.description || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120)
  }
}

function parsePartialClassification (source) {
  const values = [...String(source).matchAll(/"([^"\r\n]{1,20})"/gu)].map(match => match[1])
    .filter(value => !['emotions', 'emotion', 'actions', 'action', 'scenes', 'scene', 'contexts', 'description'].includes(value))
  if (!values.length) throw new Error(`视觉模型重试后仍被截断: ${String(source).slice(0, 100) || '(空)'}`)
  return { emotions: values.slice(0, 3), actions: [], scenes: [], description: '' }
}

function cleanArray (value) {
  const values = Array.isArray(value) ? value : value ? [value] : []
  return [...new Set(values.map(item => String(item).replace(/[\r\n,，、]+/g, ' ').trim()).filter(Boolean))].slice(0, 3)
}

function findHttpUrl (value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return ''
  if (typeof value === 'string') return /^https?:\/\//iu.test(value) ? value : ''
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findHttpUrl(item, depth + 1)
      if (found) return found
    }
  } else if (typeof value === 'object') {
    for (const item of Object.values(value)) {
      const found = findHttpUrl(item, depth + 1)
      if (found) return found
    }
  }
  return ''
}

export const __test = { parseClassification, shouldClassify, resolveStickerSourceUrl }
