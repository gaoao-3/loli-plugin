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

export async function classifySticker ({ engine, config, event, sticker, logger, dbFile, force = false } = {}) {
  if (!engine || !sticker?.id) throw new Error('缺少引擎或表情记录')
  const preset = resolveClassifierPreset(config)
  if (!preset?.channelId) throw new Error('没有可用的视觉模型渠道')
  const localFile = String(sticker.payload?.file || '')
  let image
  if (localFile && fs.existsSync(localFile)) {
    image = {
      buffer: fs.readFileSync(localFile),
      mimeType: mimeTypeFromFile(localFile)
    }
  } else {
    const sourceUrl = await resolveStickerSourceUrl(sticker, event)
    if (!sourceUrl) throw new Error('原始消息段没有可读取的图片 URL，请重新发送该表情后识别')
    image = await fetchAndCompressImage(sourceUrl, {
      timeoutMs: 15000,
      retries: 1,
      // 动画 GIF/WebP 必须保留原始帧，不能沿用聊天图片的 JPEG 压缩逻辑。
      imageCompress: { ...(config?.loli?.imageCompress || {}), enable: false }
    })
  }
  const cachedSticker = cacheStickerMedia(sticker.id, image.buffer, image.mimeType, dbFile)
  if (sticker.description && !force) return cachedSticker
  const request = {
    channelId: config?.stickers?.classificationChannelId || preset.channelId,
    presetId: preset.id,
    image: image.buffer.toString('base64'),
    mimeType: image.mimeType,
    model: config?.stickers?.classificationModel || preset.sendMessageOption?.model
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
    if (!parsed.complete) throw new Error('分类字段不完整')
  } catch (firstError) {
    logger?.warn?.(`[Sticker] 表情 #${sticker.id} 标签结果不完整，正在重试: ${firstError.message}`)
    result = await requestClassification(engine, sticker.id, request, RETRY_CLASSIFICATION_REQUEST, structured)
    parsed = parseClassification(result.finalText, { allowPartial: true })
  }
  const tags = parsed.complete
    ? [...parsed.intents, ...parsed.styles, ...parsed.actions, ...parsed.scenes]
    : []
  const updated = updateStickerMetadata(sticker.id, {
    tags,
    intents: parsed.complete ? parsed.intents : undefined,
    styles: parsed.complete ? parsed.styles : undefined,
    risk: parsed.complete ? parsed.risk : 'medium',
    autoSend: parsed.complete && parsed.risk === 'safe',
    description: parsed.description,
    source: 'classifier',
    replaceIntents: parsed.complete,
    replaceStyles: parsed.complete
  }, dbFile)
  if (parsed.complete) {
    logger?.info?.(`[Sticker] 表情 #${sticker.id} 已识别: ${tags.join('、')}`)
  } else {
    logger?.warn?.(`[Sticker] 表情 #${sticker.id} 分类仍不完整，已设为仅手动发送`)
  }
  return updated
}

export async function classifyStoredSticker ({ engine, config, event, id, logger, dbFile, force = true } = {}) {
  const sticker = getSticker(id, dbFile)
  if (!sticker) throw new Error(`没有找到表情 #${id}`)
  return classifySticker({ engine, config, event, sticker, logger, dbFile, force })
}

const CLASSIFICATION_REQUEST = `分析这个 QQ 动画表情或贴纸，返回：
{"intents":["核心意图"],"styles":["表达风格"],"actions":["动作或反应"],"scenes":["适用聊天场景"],"risk":"safe|medium|high","description":"一句客观描述"}
核心意图只能从以下词中选择 1-3 个：开心、兴奋、得意、害羞、惊讶、疑惑、无语、无奈、尴尬、嫌弃、生气、不满、委屈、难过、崩溃、安慰、赞同、称赞、拒绝、催促、调侃、卖萌、打招呼、告别。
风格使用简短词，如可爱、夸张、阴阳怪气、攻击性、粗俗、诡异、卖萌。
risk：普通聊天可安全自动发送为 safe；可能冒犯或语境要求较高为 medium；包含辱骂、色情、粗俗挑衅或强攻击文字为 high。
要求：数组每组 1-3 个简短中文词；不得猜人物真实身份；不得输出 Markdown 或 JSON 之外的文字。`

const RETRY_CLASSIFICATION_REQUEST = `分析这个 QQ 表情。只输出一行紧凑 JSON，不要代码块、解释或思考过程：
{"intents":["核心意图"],"styles":["风格"],"actions":["动作"],"scenes":["场景"],"risk":"safe|medium|high","description":"描述"}`

const CLASSIFICATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intents: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          '开心', '兴奋', '得意', '害羞', '惊讶', '疑惑',
          '无语', '无奈', '尴尬', '嫌弃', '生气', '不满',
          '委屈', '难过', '崩溃', '安慰',
          '赞同', '称赞', '拒绝', '催促',
          '调侃', '卖萌', '打招呼', '告别'
        ]
      },
      minItems: 1,
      maxItems: 3
    },
    styles: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
    actions: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
    scenes: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
    risk: { type: 'string', enum: ['safe', 'medium', 'high'] },
    description: { type: 'string' }
  },
  required: ['intents', 'styles', 'actions', 'scenes', 'risk', 'description']
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
      maxTokens: 1024,
      enableReasoning: false,
      thinkingLevel: 'MINIMAL',
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
  const complete = Array.isArray(parsed.intents) && parsed.intents.length > 0 &&
    Array.isArray(parsed.styles) && parsed.styles.length > 0 &&
    Array.isArray(parsed.actions) && parsed.actions.length > 0 &&
    Array.isArray(parsed.scenes) && parsed.scenes.length > 0 &&
    ['safe', 'medium', 'high'].includes(String(parsed.risk)) &&
    typeof parsed.description === 'string' && parsed.description.trim().length > 0
  return {
    intents: cleanArray(parsed.intents || parsed.emotions || parsed.emotion),
    styles: cleanArray(parsed.styles || parsed.style),
    actions: cleanArray(parsed.actions || parsed.action),
    scenes: cleanArray(parsed.scenes || parsed.scene || parsed.contexts),
    risk: ['safe', 'medium', 'high'].includes(String(parsed.risk)) ? String(parsed.risk) : 'medium',
    description: String(parsed.description || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120),
    complete
  }
}

function parsePartialClassification (_source) {
  return { intents: [], styles: [], actions: [], scenes: [], risk: 'medium', description: '' }
}

function cleanArray (value) {
  const values = Array.isArray(value) ? value : value ? [value] : []
  return [...new Set(values.map(item => String(item).replace(/[\r\n,，、]+/g, ' ').trim()).filter(Boolean))].slice(0, 3)
}

function mimeTypeFromFile (file) {
  return ({
    '.gif': 'image/gif',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg'
  })[String(file).toLowerCase().match(/\.[^.]+$/u)?.[0]] || 'application/octet-stream'
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
