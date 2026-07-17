const ANTIGRAVITY_GEMINI_BASE_URL = 'http://127.0.0.1:8045'
const ANTIGRAVITY_OPENAI_BASE_URL = 'http://127.0.0.1:8045/v1'
const OPENAI_BASE_URL = 'https://api.openai.com/v1'
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const REQUEST_TIMEOUT_MS = 15000

function parseHttpUrl (value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Base URL 格式无效')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Base URL 仅支持 HTTP 或 HTTPS')
  }
  if (url.username || url.password) {
    throw new Error('Base URL 不能包含用户名或密码')
  }
  url.search = ''
  url.hash = ''
  return url
}

function appendPath (url, suffix) {
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${suffix}`
  return url.toString()
}

export function buildModelListRequest ({ adapterType, providerType, protocol, baseUrl, apiKey } = {}) {
  const isAntigravity = adapterType === 'antigravity' || providerType === 'antigravity'
  const actualAdapter = isAntigravity
    ? (protocol === 'openai' ? 'openai' : 'gemini')
    : (adapterType || 'openai')
  const headers = { Accept: 'application/json' }
  let url

  if (actualAdapter === 'gemini') {
    if (!apiKey) throw new Error('获取 Gemini 模型列表前请填写 API Key')
    const target = parseHttpUrl(baseUrl || (isAntigravity ? ANTIGRAVITY_GEMINI_BASE_URL : GEMINI_BASE_URL))
    let path = target.pathname.replace(/\/+$/, '')
    if (isAntigravity && path === '/v1') {
      target.pathname = ''
      path = ''
    }
    if (/\/models$/i.test(path)) url = target.toString()
    else if (/\/v1(?:beta)?$/i.test(path)) url = appendPath(target, '/models')
    else if (!path) url = appendPath(target, '/v1beta/models')
    else url = appendPath(target, '/v1beta/models')
    headers['x-goog-api-key'] = apiKey
  } else if (actualAdapter === 'openai') {
    const target = parseHttpUrl(baseUrl || (isAntigravity ? ANTIGRAVITY_OPENAI_BASE_URL : OPENAI_BASE_URL))
    let path = target.pathname.replace(/\/+$/, '')
    path = path.replace(/\/(?:chat\/completions|responses|models)$/i, '')
    target.pathname = path
    if (!path) target.pathname = '/v1'
    url = appendPath(target, '/models')
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  } else {
    throw new Error(`适配器 ${actualAdapter} 暂不支持自动获取模型列表`)
  }

  return { url, headers, adapterType: actualAdapter }
}

export function parseModelListResponse (payload, adapterType) {
  const source = adapterType === 'gemini'
    ? payload?.models
    : (payload?.data || payload?.models || payload)
  if (!Array.isArray(source)) return []

  const models = source
    .filter(item => {
      if (adapterType !== 'gemini' || !Array.isArray(item?.supportedGenerationMethods)) return true
      return item.supportedGenerationMethods.includes('generateContent')
    })
    .map(item => typeof item === 'string' ? item : (item?.id || item?.name))
    .map(id => String(id || '').replace(/^models\//, '').trim())
    .filter(Boolean)

  return [...new Set(models)]
}

export async function discoverModels (input = {}, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('当前 Node.js 环境不支持网络请求')
  const request = buildModelListRequest(input)
  let response
  try {
    response = await fetchImpl(request.url, {
      method: 'GET',
      headers: request.headers,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(`获取模型列表超时（${REQUEST_TIMEOUT_MS / 1000} 秒）`)
    }
    throw new Error(`无法连接模型服务：${err?.message || '网络错误'}`)
  }

  if (!response.ok) {
    const reason = ({
      401: '鉴权失败，请检查 API Key',
      403: '请求被拒绝，请检查访问权限',
      404: '未找到模型接口，请确认 Base URL（Antigravity 应以 /v1 结尾）'
    })[response.status]
    throw new Error(`模型服务返回 HTTP ${response.status}${reason ? `：${reason}` : ''}`)
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('模型服务返回的不是有效 JSON')
  }
  const models = parseModelListResponse(payload, request.adapterType)
  if (models.length === 0) throw new Error('模型服务未返回可用模型')
  return models
}

export {
  ANTIGRAVITY_GEMINI_BASE_URL,
  ANTIGRAVITY_OPENAI_BASE_URL,
  ANTIGRAVITY_OPENAI_BASE_URL as ANTIGRAVITY_BASE_URL
}
