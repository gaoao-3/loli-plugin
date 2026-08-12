import { buildModelListRequest } from './model-discovery.js'
import { resolveGeminiSafetySettings } from '../clients/gemini.js'

const TEST_TIMEOUT_MS = 30000
const TEST_PROMPT = 'Hi'
const MAX_REPLY_LENGTH = 120

/**
 * 构造最小化对话测试请求。复用模型列表接口的 URL/鉴权推导，
 * 再把 /models 换成 generateContent 或 chat/completions。
 */
export function buildModelTestRequest ({ adapterType, baseUrl, apiKey, model, safetyLevel, apiMode } = {}) {
  const actualAdapter = adapterType === 'aistudio' ? 'gemini' : (adapterType || 'openai')
  const target = String(model || '').trim().replace(/^models\//, '')
  if (!target) throw new Error('缺少要测试的模型')
  if (actualAdapter === 'gemini' && !apiKey) throw new Error('测试 Gemini 模型前请填写 API Key')

  const base = buildModelListRequest({ adapterType: actualAdapter, baseUrl, apiKey })
  const headers = { ...base.headers, 'Content-Type': 'application/json' }

  if (actualAdapter === 'gemini') {
    if (apiMode === 'interactions') {
      const targetUrl = new URL(base.url)
      targetUrl.pathname = targetUrl.pathname
        .replace(/\/models\/?$/i, '')
        .replace(/\/v1beta\/?$/i, '/v1beta2/interactions')
      if (!/\/interactions$/i.test(targetUrl.pathname)) {
        targetUrl.pathname = `${targetUrl.pathname.replace(/\/+$/, '')}/v1beta2/interactions`
      }
      return {
        url: targetUrl.toString(),
        headers,
        body: {
          model: target,
          input: TEST_PROMPT,
          store: false,
          generation_config: { max_output_tokens: 16 }
        },
        adapterType: actualAdapter,
        responseKind: 'interactions'
      }
    }
    const url = base.url.replace(/\/models$/i, `/models/${encodeURIComponent(target)}:generateContent`)
    const body = {
      contents: [{ role: 'user', parts: [{ text: TEST_PROMPT }] }],
      generationConfig: { maxOutputTokens: 16 }
    }
    const safetySettings = resolveGeminiSafetySettings(safetyLevel)
    if (safetySettings) body.safetySettings = safetySettings
    return { url, headers, body, adapterType: actualAdapter, responseKind: 'generateContent' }
  }
  if (actualAdapter === 'openai') {
    const url = base.url.replace(/\/models$/i, '/chat/completions')
    const body = {
      model: target,
      messages: [{ role: 'user', content: TEST_PROMPT }],
      max_tokens: 16
    }
    return { url, headers, body, adapterType: actualAdapter }
  }
  throw new Error(`适配器 ${actualAdapter} 暂不支持模型测试`)
}

function extractUpstreamError (payload) {
  const raw = payload?.error?.message || payload?.error || payload?.message
  if (typeof raw === 'string' && raw.trim()) return raw.trim().slice(0, 200)
  return ''
}

function extractReply (payload, adapterType, responseKind) {
  let text
  if (responseKind === 'interactions') {
    text = payload?.output_text
    if (!text) {
      text = (payload?.steps || [])
        .filter(step => step?.type === 'model_output')
        .flatMap(step => step.content || [])
        .filter(item => item?.type === 'text')
        .map(item => item.text || '')
        .join('')
    }
  } else if (adapterType === 'gemini') {
    const parts = payload?.candidates?.[0]?.content?.parts
    if (Array.isArray(parts)) text = parts.map(p => p?.text || '').join('')
  } else {
    text = payload?.choices?.[0]?.message?.content
  }
  if (typeof text !== 'string' || !text.trim()) return undefined
  return text.trim().slice(0, MAX_REPLY_LENGTH)
}

export async function testModel (input = {}, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node.js 环境不支持网络请求')
  const request = buildModelTestRequest(input)
  const startedAt = Date.now()
  let response
  try {
    response = await fetchImpl(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      redirect: 'error',
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS)
    })
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(`模型响应超时（${TEST_TIMEOUT_MS / 1000} 秒）`)
    }
    throw new Error(`无法连接模型服务：${err?.message || '网络错误'}`)
  }
  const latencyMs = Date.now() - startedAt

  let payload = null
  try { payload = await response.json() } catch { /* 非 JSON 响应 */ }

  if (!response.ok) {
    const reason = ({
      401: '鉴权失败，请检查 API Key',
      403: '请求被拒绝，请检查访问权限',
      404: '模型不存在或接口路径错误',
      429: '触发速率限制'
    })[response.status]
    const detail = extractUpstreamError(payload)
    throw new Error(`HTTP ${response.status}${reason ? `：${reason}` : ''}${detail ? `（${detail}）` : ''}`)
  }

  return { ok: true, latencyMs, reply: extractReply(payload, request.adapterType, request.responseKind) }
}
