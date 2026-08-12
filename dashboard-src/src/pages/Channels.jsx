import React, { useState } from 'react'
import { api } from '../api'
import Icon from '../icons.jsx'
import Modal from '../Modal.jsx'

const SAFETY_LEVELS = {
  default: '模型默认',
  off: '关闭附加过滤',
  permissive: '宽松',
  balanced: '均衡',
  strict: '严格'
}

// GLM 智谱:仅 UI 便利项,保存时按 openai 适配器提交
const GLM_DEFAULTS = {
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  models: 'glm-4.6, glm-4.5-air',
  name: 'GLM'
}

const ANTIGRAVITY_DEFAULTS = {
  baseUrl: 'https://daily-cloudcode-pa.googleapis.com',
  name: 'Antigravity OAuth'
}

// Google AI Studio:官方 API Key 渠道,按独立适配器保存,协议复用 Gemini
const AISTUDIO_DEFAULTS = {
  baseUrl: 'https://generativelanguage.googleapis.com',
  name: 'Google AI Studio'
}

// GCIL(gcli2api):Gemini CLI OAuth 直连 Code Assist 端点
const GCIL_DEFAULTS = {
  baseUrl: 'https://cloudcode-pa.googleapis.com',
  name: 'GCIL'
}

// 适配器展示元数据：标签 + 二次元主题色（sakura/violet/sky/mint/amber）
const ADAPTER_META = {
  gemini: { label: 'Gemini', tone: 'sky' },
  aistudio: { label: 'Google AI Studio', tone: 'amber' },
  gcil: { label: 'GCIL OAuth', tone: 'violet' },
  openai: { label: 'OpenAI', tone: 'mint' },
  antigravity: { label: 'Antigravity OAuth', tone: 'sakura' },
  glm: { label: 'GLM 智谱', tone: 'violet' }
}

// OAuth 账号订阅分级：原始 tier ID → 友好标签 + 主题色（同 gcli2api 映射规则）
const TIER_META = {
  'free-tier': { label: 'Free', tone: 'gray' },
  legacy: { label: 'Free · LEGACY', tone: 'gray' },
  'g1-pro-tier': { label: 'Pro', tone: 'sky' },
  'helium-tier': { label: 'Pro', tone: 'sky' },
  'standard-tier': { label: 'Pro', tone: 'sky' },
  'g1-ultra-tier': { label: 'Ultra', tone: 'violet' },
  'ws-ai-ultra-business-tier': { label: 'Ultra', tone: 'violet' }
}

function accountTierMeta(tier) {
  const raw = String(tier || '').trim()
  if (!raw) return { label: '未知等级', tone: 'gray' }
  return TIER_META[raw.toLowerCase()] || { label: raw, tone: 'amber' }
}

// 从 lastError 提取 HTTP 错误码（仿 gcli2api 错误码徽章）
function accountErrorMeta(account) {
  if (!account?.lastError) return null
  const match = String(account.lastError).match(/HTTP (\d{3})/i) ||
    String(account.lastError).match(/\b(\d{3})\b/)
  return { code: match ? match[1] : null, text: String(account.lastError) }
}

let geminiKeyRowSequence = 0

function createGeminiKeyRow(value = {}) {
  geminiKeyRowSequence += 1
  return {
    rowId: `gemini-key-row-${geminiKeyRowSequence}`,
    projectId: value?.projectId || value?.project || '',
    apiKey: value?.apiKey || value?.key || (typeof value === 'string' ? value : ''),
    enabled: value?.enabled !== false
  }
}

function normalizeGeminiKeyRows(value, includeEmpty = true) {
  const rows = (Array.isArray(value) ? value : []).map(createGeminiKeyRow)
  return rows.length || !includeEmpty ? rows : [createGeminiKeyRow()]
}

function maskGeminiApiKey(value) {
  const key = String(value || '').trim()
  if (!key) return ''
  if (key.length <= 8) return `${key.slice(0, 2)}••••`
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

function serializeGeminiKeyRows(value) {
  return (Array.isArray(value) ? value : []).map((item, index) => {
    const apiKey = String(item?.apiKey || '').trim()
    if (!apiKey) return null
    const projectId = String(item?.projectId || '').trim() || `project-${index + 1}`
    return { id: projectId, projectId, apiKey, ...(item?.enabled === false ? { enabled: false } : {}) }
  }).filter(Boolean)
}

// 与 serializeGeminiKeyRows 的 id 生成规则保持一致，用于把后端结果映射回行
function geminiKeyEntryId(item, index) {
  return String(item?.projectId || '').trim() || `project-${index + 1}`
}

const emptyForm = {
  id: '', name: '', adapterType: 'gemini', models: '', apiKey: '', baseUrl: '',
  safetyLevel: 'default', apiMode: 'generateContent', interactionsFallback: true,
  builtinTools: [],
  geminiKeys: [createGeminiKeyRow()], keyPoolStrategy: 'round_robin', keyCooldownSeconds: '60',
  antiTruncation: true, maxAntiTruncationRounds: '2',
  loadBalanceStrategy: 'smart',
  quotaProtectionThreshold: '0', quotaProtectionModels: '*', isEdit: false
}

const GEMINI_BUILTIN_TOOL_OPTIONS = [
  { id: 'google_search', label: 'Google 搜索' },
  { id: 'code_execution', label: '代码执行' },
  { id: 'google_maps', label: 'Google Maps' },
  { id: 'url_context', label: 'URL Context' }
]

export default function Channels({ channels, refresh, showToast, runTask }) {
  const [modalVisible, setModalVisible] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [modelsExpanded, setModelsExpanded] = useState(false)
  const [keyPoolExpanded, setKeyPoolExpanded] = useState(true)
  const [expandedGeminiKeys, setExpandedGeminiKeys] = useState(new Set())
  // rowId -> { phase: 'testing'|'ok'|'fail', latencyMs, error, cooldownRemainingMs }
  const [keyTests, setKeyTests] = useState({})
  const [keysTestingAll, setKeysTestingAll] = useState(false)
  const [newModel, setNewModel] = useState('')
  const [modelTests, setModelTests] = useState({})
  const [antigravityOAuth, setAntigravityOAuth] = useState({
    loading: false, authUrl: '', callbackUrl: '', status: null
  })
  const [gcilImport, setGcilImport] = useState({ visible: false, text: '' })
  // accountId -> { phase: 'probing'|'testing', result: { ok, message } }
  const [accountOps, setAccountOps] = useState({})
  // 默认折叠账号卡片：只显示邮箱/徽章/健康度摘要行，展开后才显示操作按钮与详情
  const [expandedAccounts, setExpandedAccounts] = useState(new Set())

  const showSaveResult = (result, successMessage) => {
    showToast(result?.configMirrorPersisted === false
      ? `${successMessage}；config.json 镜像更新失败，将在后续自动修复`
      : successMessage)
  }

  const isGemini = ['gemini', 'aistudio'].includes(form.adapterType)
  const isAistudio = form.adapterType === 'aistudio'
  const isAntigravity = form.adapterType === 'antigravity'
  const isGcil = form.adapterType === 'gcil'
  const isOAuthAdapter = isAntigravity || isGcil
  const oauthProvider = isGcil ? 'gcil' : 'antigravity'

  const modelList = form.models.split(',').map(s => s.trim()).filter(Boolean)

  const setModels = (list) => setForm(f => ({ ...f, models: list.join(', ') }))

  const addModel = () => {
    const model = newModel.trim()
    if (!model) return
    if (modelList.includes(model)) {
      showToast('该模型已在列表中', 'warning')
      return
    }
    setModels([...modelList, model])
    setNewModel('')
  }

  const removeModel = (model) => setModels(modelList.filter(m => m !== model))

  const testModelByName = async (model) => {
    setModelTests(t => ({ ...t, [model]: { status: 'testing' } }))
    try {
      const result = await api.post('/channels/models/test', {
        id: form.id,
        adapterType: form.adapterType === 'glm' ? 'openai' : form.adapterType,
        options: {
          apiKey: form.apiKey,
          apiKeys: serializeGeminiKeyRows(form.geminiKeys),
          keyPoolStrategy: form.keyPoolStrategy,
          keyCooldownSeconds: Number(form.keyCooldownSeconds) || 60,
          baseUrl: form.baseUrl,
          ...(isGemini ? { safetyLevel: form.safetyLevel, apiMode: form.apiMode, builtinTools: form.builtinTools } : {})
        },
        model
      })
      setModelTests(t => ({
        ...t,
        [model]: result?.ok
          ? { status: 'ok', latencyMs: result.latencyMs, reply: result.reply }
          : { status: 'fail', error: result?.error || '测试失败' }
      }))
    } catch (err) {
      setModelTests(t => ({ ...t, [model]: { status: 'fail', error: err?.message || '请求失败' } }))
    }
  }

  const isTestingAny = modelList.some(m => modelTests[m]?.status === 'testing')

  const testAllModels = async () => {
    // 并发 3 路，避免一次性打满中转渠道
    const queue = [...modelList]
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length > 0) await testModelByName(queue.shift())
    })
    await Promise.all(workers)
  }

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }))

  const updateGeminiKey = (rowId, key) => (e) => setForm(f => ({
    ...f,
    geminiKeys: f.geminiKeys.map(item => item.rowId === rowId
      ? { ...item, [key]: e.target.value }
      : item)
  }))

  const addGeminiKey = () => setForm(f => ({
    ...f,
    geminiKeys: [...f.geminiKeys, createGeminiKeyRow()]
  }))

  const removeGeminiKey = (rowId) => setForm(f => {
    const remaining = f.geminiKeys.filter(item => item.rowId !== rowId)
    return { ...f, geminiKeys: remaining.length ? remaining : [createGeminiKeyRow()] }
  })

  const toggleGeminiKeyExpanded = (rowId) => setExpandedGeminiKeys(prev => {
    const next = new Set(prev)
    if (next.has(rowId)) next.delete(rowId)
    else next.add(rowId)
    return next
  })

  const toggleGeminiKeyEnabled = (rowId) => setForm(f => ({
    ...f,
    geminiKeys: f.geminiKeys.map(item => item.rowId === rowId
      ? { ...item, enabled: item.enabled === false }
      : item)
  }))

  // Key 测活：单个（传 rowId）或全部；失败的 Key 第一时间禁用（保存后生效）
  const testGeminiKeys = async (rowId = null) => {
    const rows = form.geminiKeys
      .map((item, index) => ({ item, entryId: geminiKeyEntryId(item, index) }))
      .filter(({ item }) => item.apiKey.trim())
    const targets = rowId ? rows.filter(r => r.item.rowId === rowId) : rows
    if (!targets.length) {
      showToast('请先填写 API Key', 'warning')
      return
    }
    setKeyTests(t => {
      const next = { ...t }
      for (const r of targets) next[r.item.rowId] = { ...(next[r.item.rowId] || {}), phase: 'testing' }
      return next
    })
    if (!rowId) setKeysTestingAll(true)
    try {
      const result = await api.post('/channels/keys/test', {
        id: form.id,
        adapterType: 'aistudio',
        options: {
          apiKeys: serializeGeminiKeyRows(form.geminiKeys),
          keyPoolStrategy: form.keyPoolStrategy,
          keyCooldownSeconds: Number(form.keyCooldownSeconds) || 60,
          baseUrl: form.baseUrl
        },
        ...(rowId ? { keyId: targets[0].entryId } : {})
      })
      const byEntryId = new Map((result?.results || []).map(r => [r.id, r]))
      const cooldownById = new Map((result?.status || []).map(s => [s.id, s.cooldownRemainingMs]))
      const failedRowIds = []
      setKeyTests(t => {
        const next = { ...t }
        for (const r of targets) {
          const res = byEntryId.get(r.entryId)
          if (!res) continue
          const cooldownRemainingMs = cooldownById.get(r.entryId) || 0
          next[r.item.rowId] = res.ok
            ? { phase: 'ok', latencyMs: res.latencyMs, cooldownRemainingMs }
            : { phase: 'fail', error: res.error || `HTTP ${res.status}`, cooldownRemainingMs }
          if (!res.ok) failedRowIds.push(r.item.rowId)
        }
        return next
      })
      if (failedRowIds.length) {
        // 第一时间禁用失效 Key，避免继续参与请求
        setForm(f => ({
          ...f,
          geminiKeys: f.geminiKeys.map(item => failedRowIds.includes(item.rowId)
            ? { ...item, enabled: false }
            : item)
        }))
        showToast(`测活完成：${failedRowIds.length} 个 Key 失效，已自动禁用（保存后生效）`, 'warning')
      } else {
        showToast(rowId ? '该 Key 测活通过' : `全部 ${targets.length} 个 Key 测活通过`, 'success')
      }
    } catch {
      // request() 已弹错误 toast；清掉 testing 状态
      setKeyTests(t => {
        const next = { ...t }
        for (const r of targets) if (next[r.item.rowId]?.phase === 'testing') delete next[r.item.rowId]
        return next
      })
    } finally {
      setKeysTestingAll(false)
    }
  }

  // 拉取已保存渠道的 Key 池运行时状态（冷却/禁用），静默失败
  const refreshGeminiKeyStatus = async (channelId, rows) => {
    if (!channelId || !rows?.length) return
    try {
      const result = await api.get(`/channels/${encodeURIComponent(channelId)}/keys/status`)
      const byId = new Map((result?.status || []).map(s => [s.id, s]))
      setKeyTests(t => {
        const next = { ...t }
        rows.forEach((item, index) => {
          const s = byId.get(geminiKeyEntryId(item, index))
          if (!s) return
          const prev = next[item.rowId] || {}
          next[item.rowId] = { ...prev, cooldownRemainingMs: s.cooldownRemainingMs || 0 }
        })
        return next
      })
    } catch { /* 仅状态展示，忽略失败 */ }
  }

  // 行状态展示：禁用 > 测活中 > 失败 > 冷却 > 正常 > 未测
  const geminiKeyStatusInfo = (item) => {
    if (item.enabled === false) return { tone: 'disabled', label: '已禁用' }
    const t = keyTests[item.rowId]
    if (t?.phase === 'testing') return { tone: 'testing', label: '测活中…' }
    if (t?.phase === 'fail') return { tone: 'fail', label: t.error || '测活失败' }
    if (t?.cooldownRemainingMs > 0) return { tone: 'cooldown', label: `冷却 ${Math.ceil(t.cooldownRemainingMs / 1000)}s` }
    if (t?.phase === 'ok') return { tone: 'ok', label: `正常 · ${t.latencyMs}ms` }
    return { tone: 'idle', label: '未测活' }
  }

  const openAdd = () => {
    setForm({
      ...emptyForm,
      models: 'gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash-thinking-exp'
    })
    setModelsExpanded(true)
    setKeyPoolExpanded(true)
    setExpandedGeminiKeys(new Set())
    setKeyTests({})
    setKeysTestingAll(false)
    setNewModel('')
    setModelTests({})
    setAntigravityOAuth({ loading: false, authUrl: '', callbackUrl: '', status: null })
    setGcilImport({ visible: false, text: '' })
    setExpandedAccounts(new Set())
    setModalVisible(true)
  }

  const refreshAntigravityOAuthStatus = async (channelId = form.id, provider = oauthProvider) => {
    if (!channelId) return
    try {
      const status = await api.get(`/channels/${encodeURIComponent(channelId)}/oauth/${provider}/status`)
      setAntigravityOAuth(current => ({ ...current, status }))
    } catch {
      setAntigravityOAuth(current => ({ ...current, status: null }))
    }
  }

  const openEdit = (ch) => {
    const geminiKeyRows = normalizeGeminiKeyRows(ch.options?.apiKeys)
    setForm({
      id: ch.id,
      name: ch.name || '',
      adapterType: ch.adapterType || 'gemini',
      models: (ch.models || []).join(', '),
      apiKey: ch.options?.apiKey || ch.apiKey || '',
      geminiKeys: geminiKeyRows,
      keyPoolStrategy: ch.options?.keyPoolStrategy || 'round_robin',
      keyCooldownSeconds: String(ch.options?.keyCooldownSeconds ?? 60),
      baseUrl: ch.options?.baseUrl || ch.baseUrl || '',
      safetyLevel: ch.options?.safetyLevel || ch.safetyLevel || 'default',
      apiMode: ch.options?.apiMode || 'generateContent',
      interactionsFallback: ch.options?.interactionsFallback !== false,
      builtinTools: Array.isArray(ch.options?.builtinTools) ? ch.options.builtinTools : [],
      antiTruncation: ch.options?.antiTruncation !== false,
      maxAntiTruncationRounds: String(ch.options?.maxAntiTruncationRounds ?? 2),
      loadBalanceStrategy: ch.options?.loadBalanceStrategy || 'smart',
      quotaProtectionThreshold: String(ch.options?.quotaProtectionThreshold ?? 0),
      quotaProtectionModels: Array.isArray(ch.options?.quotaProtectionModels)
        ? ch.options.quotaProtectionModels.join(', ')
        : (ch.options?.quotaProtectionModels || '*'),
      isEdit: true
    })
    setModelsExpanded(false)
    // 已有多个有效 Key 时默认收起 Key 池，避免刷屏
    setKeyPoolExpanded(geminiKeyRows.filter(item => item.apiKey.trim()).length <= 1)
    setExpandedGeminiKeys(new Set())
    setKeyTests({})
    setKeysTestingAll(false)
    setNewModel('')
    setModelTests({})
    setAntigravityOAuth({ loading: false, authUrl: '', callbackUrl: '', status: null })
    setGcilImport({ visible: false, text: '' })
    setExpandedAccounts(new Set())
    setModalVisible(true)
    if (ch.adapterType === 'antigravity' || ch.adapterType === 'gcil') {
      refreshAntigravityOAuthStatus(ch.id, ch.adapterType)
    } else if (ch.adapterType === 'aistudio') {
      refreshGeminiKeyStatus(ch.id, geminiKeyRows)
    }
  }

  const onAdapterChange = (e) => {
    const adapterType = e.target.value
    setForm(f => ({
      ...f,
      adapterType,
      // GLM 按 openai 处理,预填官方端点/默认模型/名称(名称仅在为空时填)
      ...(adapterType === 'glm' ? {
        baseUrl: GLM_DEFAULTS.baseUrl,
        models: GLM_DEFAULTS.models,
        name: f.name.trim() ? f.name : GLM_DEFAULTS.name
      } : {}),
      ...(adapterType === 'antigravity' ? {
        baseUrl: ANTIGRAVITY_DEFAULTS.baseUrl,
        models: '',
        apiKey: '',
        name: f.name.trim() ? f.name : ANTIGRAVITY_DEFAULTS.name
      } : {}),
      // AI Studio 预填官方端点(名称仅在为空时填)
      ...(adapterType === 'aistudio' ? {
        baseUrl: AISTUDIO_DEFAULTS.baseUrl,
        name: f.name.trim() ? f.name : AISTUDIO_DEFAULTS.name
      } : {}),
      // GCIL 预填云端直连端点
      ...(adapterType === 'gcil' ? {
        baseUrl: GCIL_DEFAULTS.baseUrl,
        name: f.name.trim() ? f.name : GCIL_DEFAULTS.name
      } : {})
    }))
  }

  const fetchChannelModels = async () => {
    setIsFetchingModels(true)
    try {
      const result = await api.post('/channels/models/discover', {
        id: form.id,
        adapterType: form.adapterType === 'glm' ? 'openai' : form.adapterType,
        options: {
          apiKey: form.apiKey,
          apiKeys: serializeGeminiKeyRows(form.geminiKeys),
          baseUrl: form.baseUrl
        }
      })
      const fetched = Array.isArray(result?.models) ? result.models : []
      setForm(f => ({ ...f, models: fetched.join(', ') }))
      setModelsExpanded(true)
      showToast(`已成功获取 ${fetched.length} 个可用模型`)
    } catch (err) {
      console.error(err)
    } finally {
      setIsFetchingModels(false)
    }
  }

  const startAntigravityOAuth = async () => {
    if (!form.isEdit) {
      showToast('请先保存渠道，再进行 OAuth 登录', 'warning')
      return
    }
    setAntigravityOAuth(current => ({ ...current, loading: true, authUrl: '' }))
    try {
      const result = await api.post(`/channels/${encodeURIComponent(form.id)}/oauth/${oauthProvider}/start`, {})
      setAntigravityOAuth(current => ({ ...current, loading: false, authUrl: result.authUrl || '' }))
      if (result.authUrl) window.open(result.authUrl, '_blank', 'noopener,noreferrer')
      showToast('OAuth 登录页已生成；授权后请粘贴浏览器最终地址')
    } catch (err) {
      setAntigravityOAuth(current => ({ ...current, loading: false }))
      showToast(err?.message || '启动 OAuth 登录失败', 'error')
    }
  }

  const finishAntigravityOAuth = async () => {
    const callbackUrl = antigravityOAuth.callbackUrl.trim()
    if (!callbackUrl) {
      showToast('请粘贴授权后的完整回调 URL', 'warning')
      return
    }
    setAntigravityOAuth(current => ({ ...current, loading: true }))
    try {
      const result = await api.post(`/channels/${encodeURIComponent(form.id)}/oauth/${oauthProvider}/callback-url`, { callbackUrl })
      setAntigravityOAuth(current => ({
        ...current,
        loading: false,
        callbackUrl: '',
        authUrl: '',
        status: result.status || current.status
      }))
      showToast(result.message || 'Antigravity OAuth 登录成功')
    } catch (err) {
      setAntigravityOAuth(current => ({ ...current, loading: false }))
      showToast(err?.message || '完成 OAuth 登录失败', 'error')
    }
  }

  const removeAntigravityAccount = async (account) => {
    if (!window.confirm(`确认删除 OAuth 账号 ${account.email || account.accountId}？`)) return
    setAntigravityOAuth(current => ({ ...current, loading: true }))
    try {
      const result = await api.delete(
        `/channels/${encodeURIComponent(form.id)}/oauth/${oauthProvider}/accounts/${encodeURIComponent(account.accountId)}`
      )
      setAntigravityOAuth(current => ({
        ...current,
        loading: false,
        status: result.status || { connected: false, total: 0, enabled: 0, accounts: [] }
      }))
      showToast(isGcil ? 'GCIL OAuth 账号已删除' : 'Antigravity OAuth 账号已删除')
    } catch (err) {
      setAntigravityOAuth(current => ({ ...current, loading: false }))
      showToast(err?.message || '删除 OAuth 账号失败', 'error')
    }
  }

  const importGcilCredentialFile = async () => {
    let payload
    try {
      payload = JSON.parse(gcilImport.text.trim())
    } catch {
      showToast('凭证 JSON 格式无效', 'warning')
      return
    }
    setAntigravityOAuth(current => ({ ...current, loading: true }))
    try {
      const result = await api.post(`/channels/${encodeURIComponent(form.id)}/oauth/gcil/import`, { credential: payload })
      setAntigravityOAuth(current => ({ ...current, loading: false, status: result.status || current.status }))
      setGcilImport({ visible: false, text: '' })
      showToast(result.message || '凭证导入成功')
    } catch (err) {
      setAntigravityOAuth(current => ({ ...current, loading: false }))
      showToast(err?.message || '导入凭证失败', 'error')
    }
  }

  const setAccountOp = (accountId, patch) => setAccountOps(current => ({
    ...current,
    [accountId]: { ...(current[accountId] || {}), ...patch }
  }))

  const toggleAccountExpanded = (accountId) => setExpandedAccounts(prev => {
    const next = new Set(prev)
    if (next.has(accountId)) next.delete(accountId)
    else next.add(accountId)
    return next
  })

  // 账号检验：探活 + 回填 tier/project，刷新账号列表
  const probeOAuthAccount = async (account) => {
    setAccountOp(account.accountId, { phase: 'probing', result: null })
    try {
      const result = await api.post(
        `/channels/${encodeURIComponent(form.id)}/oauth/${oauthProvider}/accounts/${encodeURIComponent(account.accountId)}/probe`,
        {}
      )
      setAccountOp(account.accountId, {
        phase: null,
        result: result.ok
          ? { ok: true, message: `检验通过 · ${result.latencyMs}ms` }
          : { ok: false, message: result.error || '检验失败' }
      })
      if (result.status) setAntigravityOAuth(current => ({ ...current, status: result.status }))
    } catch (err) {
      setAccountOp(account.accountId, { phase: null, result: { ok: false, message: err?.message || '检验失败' } })
    }
  }

  // 单账号消息测试
  const testOAuthAccount = async (account) => {
    setAccountOp(account.accountId, { phase: 'testing', result: null })
    try {
      const result = await api.post(
        `/channels/${encodeURIComponent(form.id)}/oauth/${oauthProvider}/accounts/${encodeURIComponent(account.accountId)}/test`,
        { model: modelList[0] || undefined }
      )
      setAccountOp(account.accountId, {
        phase: null,
        result: result.ok
          ? { ok: true, message: `回复正常 · ${result.latencyMs}ms${result.reply ? ` · ${result.reply.slice(0, 30)}` : ''}` }
          : { ok: false, message: result.error || '测试失败' }
      })
      if (result.status) setAntigravityOAuth(current => ({ ...current, status: result.status }))
    } catch (err) {
      setAccountOp(account.accountId, { phase: null, result: { ok: false, message: err?.message || '测试失败' } })
    }
  }

  // 导出凭证为 gcli2api 兼容 JSON 文件
  const exportOAuthAccount = async (account) => {
    setAccountOp(account.accountId, { phase: 'exporting', result: null })
    try {
      const token = localStorage.getItem('loli-dashboard-token')
      const res = await fetch(
        `/api/channels/${encodeURIComponent(form.id)}/oauth/${oauthProvider}/accounts/${encodeURIComponent(account.accountId)}/export`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      )
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `gcil-${account.email || account.accountId}.json`
      link.click()
      URL.revokeObjectURL(url)
      setAccountOp(account.accountId, { phase: null, result: { ok: true, message: '凭证已导出' } })
    } catch (err) {
      setAccountOp(account.accountId, { phase: null, result: { ok: false, message: err?.message || '导出失败' } })
    }
  }

  // 批量检验全部账号（串行，避免触发限流）
  const probeAllOAuthAccounts = async () => {
    const accounts = antigravityOAuth.status?.accounts || []
    if (!accounts.length) return
    for (const account of accounts) {
      // eslint-disable-next-line no-await-in-loop
      await probeOAuthAccount(account)
    }
    showToast('全部账号检验完成')
  }

  const toggleAntigravityAccount = async (account) => {
    setAntigravityOAuth(current => ({ ...current, loading: true }))
    try {
      const result = await api.patch(
        `/channels/${encodeURIComponent(form.id)}/oauth/${oauthProvider}/accounts/${encodeURIComponent(account.accountId)}`,
        { enabled: !account.enabled }
      )
      setAntigravityOAuth(current => ({ ...current, loading: false, status: result.status }))
    } catch (err) {
      setAntigravityOAuth(current => ({ ...current, loading: false }))
      showToast(err?.message || '更新 OAuth 账号失败', 'error')
    }
  }

  const updateAntigravityAccount = async (account, patch) => {
    setAntigravityOAuth(current => ({ ...current, loading: true }))
    try {
      const result = await api.patch(
        `/channels/${encodeURIComponent(form.id)}/oauth/${oauthProvider}/accounts/${encodeURIComponent(account.accountId)}`,
        patch
      )
      setAntigravityOAuth(current => ({ ...current, loading: false, status: result.status }))
    } catch (err) {
      setAntigravityOAuth(current => ({ ...current, loading: false }))
      showToast(err?.message || '更新 OAuth 账号失败', 'error')
    }
  }

  const refreshAntigravityQuotas = async (accountId) => {
    setAntigravityOAuth(current => ({ ...current, loading: true }))
    try {
      const result = await api.post(
        `/channels/${encodeURIComponent(form.id)}/oauth/antigravity/quota`,
        accountId ? { accountId } : {}
      )
      setAntigravityOAuth(current => ({ ...current, loading: false, status: result.status }))
      const failed = (result.results || []).filter(item => !item.ok).length
      showToast(failed > 0 ? `额度已刷新，${failed} 个账号失败` : '额度刷新成功', failed > 0 ? 'warning' : 'success')
    } catch (err) {
      setAntigravityOAuth(current => ({ ...current, loading: false }))
      showToast(err?.message || '额度刷新失败', 'error')
    }
  }

  const saveChannel = () => runTask(async () => {
    if (!form.id.trim() || !form.name.trim()) {
      showToast('请输入渠道 ID 和名称', 'warning')
      return
    }
    const models = form.models.split(',').map(s => s.trim()).filter(Boolean)
    const existing = form.isEdit ? channels.find(c => c.id === form.id) : null
    const options = { ...(existing?.options || {}) }
    delete options.providerType
    delete options.protocol
    options.apiKey = form.apiKey
    options.baseUrl = form.baseUrl
    if (isAntigravity || isGcil) delete options.apiKey
    if (isGcil) {
      options.antiTruncation = form.antiTruncation !== false
      options.maxAntiTruncationRounds = Math.max(0, Math.min(5, Math.trunc(Number(form.maxAntiTruncationRounds) || 2)))
    } else {
      delete options.antiTruncation
      delete options.maxAntiTruncationRounds
    }
    if (isAntigravity) {
      options.loadBalanceStrategy = form.loadBalanceStrategy
      options.quotaProtectionThreshold = Math.max(
        0, Math.min(1, Number(form.quotaProtectionThreshold) || 0)
      )
      options.quotaProtectionModels = form.quotaProtectionModels
        .split(',').map(item => item.trim()).filter(Boolean)
    }
    if (isGemini) {
      options.safetyLevel = form.safetyLevel
      options.apiMode = form.apiMode
      options.interactionsFallback = form.interactionsFallback
      options.builtinTools = form.builtinTools
      if (isAistudio) {
        options.apiKeys = serializeGeminiKeyRows(form.geminiKeys)
        options.keyPoolStrategy = form.keyPoolStrategy
        options.keyCooldownSeconds = Math.max(5, Math.min(600, Number(form.keyCooldownSeconds) || 60))
      } else {
        // 通用 Gemini 格式渠道只用单 Key
        delete options.apiKeys
        delete options.keyPoolStrategy
        delete options.keyCooldownSeconds
      }
    } else {
      delete options.safetyLevel
      delete options.apiMode
      delete options.interactionsFallback
      delete options.builtinTools
      delete options.apiKeys
      delete options.keyPoolStrategy
      delete options.keyCooldownSeconds
    }
    const payload = {
      id: form.id.trim(),
      name: form.name.trim(),
      // GLM 仅 UI 便利项,实际按 openai 适配器保存
      adapterType: form.adapterType === 'glm' ? 'openai' : form.adapterType,
      models,
      options,
      status: existing?.status || 'enabled'
    }
    const result = form.isEdit
      ? await api.put(`/channels/${form.id}`, payload)
      : await api.post('/channels', payload)
    showSaveResult(result, '渠道保存成功')
    setModalVisible(false)
    await refresh()
  })

  const toggleStatus = (ch) => runTask(async () => {
    const result = await api.put(`/channels/${ch.id}`, { ...ch, status: ch.status === 'enabled' ? 'disabled' : 'enabled' })
    showSaveResult(result, '渠道状态已更新')
    await refresh()
  })

  // 渠道分组：OAuth 登录渠道 vs 普通 Key 渠道
  const OAUTH_ADAPTERS = ['antigravity', 'gcil']
  const oauthChannels = channels.filter(ch => OAUTH_ADAPTERS.includes(ch.adapterType))
  const keyChannels = channels.filter(ch => !OAUTH_ADAPTERS.includes(ch.adapterType))

  const deleteChannel = (ch) => runTask(async () => {
    if (!window.confirm(`确认要删除适配器渠道 "${ch.name} (${ch.id})"?`)) return
    const result = await api.delete(`/channels/${ch.id}`)
    showSaveResult(result, '渠道已成功删除')
    await refresh()
  })

  const renderChannelCard = (ch) => {
    const meta = ADAPTER_META[ch.adapterType || 'gemini'] || ADAPTER_META.gemini
    const enabled = ch.status === 'enabled'
    return (
      <article key={ch.id} className={`channel-card tone-${meta.tone}${enabled ? '' : ' is-disabled'}`}>
        <span className="channel-card-glow" aria-hidden="true" />
        <header className="channel-card-head">
          <div className="channel-card-identity min-w-0">
            <span className="channel-card-name truncate">{ch.name}</span>
            <span className="channel-card-id font-mono truncate">{ch.id}</span>
          </div>
          <span className={`badge badge-stamp ${enabled ? 'badge-success' : 'badge-gray'}`}>{enabled ? '已启用' : '已禁用'}</span>
        </header>
        <div className="channel-card-meta">
          <span className="channel-adapter-chip">{meta.label}</span>
          {['gemini', 'aistudio'].includes(ch.adapterType) && (
            <span className="channel-adapter-note">
              {ch.options?.apiMode === 'interactions' ? 'Interactions' : 'generateContent'}
              {' · '}{ch.options?.apiMode === 'interactions'
                ? '服务端会话'
                : `安全：${SAFETY_LEVELS[ch.options?.safetyLevel] || '模型默认'}`}
            </span>
          )}
        </div>
        <div className="channel-card-models">
          <div className="channel-model-tags">
            {(ch.models || []).slice(0, 3).map(model => (
              <span key={model} className="channel-model-tag" title={model}>{model}</span>
            ))}
            {(ch.models || []).length > 3 && (
              <span className="channel-model-more">+{(ch.models || []).length - 3}</span>
            )}
            {(ch.models || []).length === 0 && (
              <span className="channel-model-empty">未配置模型</span>
            )}
          </div>
          <span className="channel-model-count">共 {(ch.models || []).length} 个模型</span>
        </div>
        <footer className="channel-card-actions">
          <button className="btn btn-secondary" onClick={() => openEdit(ch)}>编辑</button>
          <button className={`btn ${enabled ? 'btn-danger' : 'btn-success'}`} onClick={() => toggleStatus(ch)}>
            {enabled ? '禁用' : '启用'}
          </button>
          <button
            className="channel-card-delete"
            title="删除渠道"
            aria-label={`删除 ${ch.name}`}
            onClick={() => deleteChannel(ch)}
          >
            <Icon name="trash" size={12} />
          </button>
        </footer>
      </article>
    )
  }

  return (
    <div className="pane-content select-text channels-page">
      <header className="page-hero mb-4">
        <div className="flex-column gap-1 min-w-0">
          <h2 className="page-hero-title">AI 渠道管理</h2>
          <p className="page-hero-sub">模型接入渠道 · 共 {channels.length} 个</p>
        </div>
        <button className="btn btn-primary" onClick={openAdd}>
          <Icon name="plus" size={12} />添加新渠道
        </button>
      </header>

      {channels.length === 0 ? (
        <div className="channel-empty">
          <span className="channel-empty-spark" aria-hidden="true">✦</span>
          <span className="channel-empty-title">还没有配置任何渠道</span>
          <span className="channel-empty-sub">点击右上角「添加新渠道」，接入第一个 AI 模型吧</span>
        </div>
      ) : (
        <div className="flex-column gap-4">
          {keyChannels.length > 0 && (
            <section className="channel-group">
              <header className="channel-group-head">
                <span className="channel-group-title">普通 Key 渠道</span>
                <span className="channel-group-count">{keyChannels.length} 个</span>
              </header>
              <div className="channel-card-grid collage-grid">
                {keyChannels.map(renderChannelCard)}
              </div>
            </section>
          )}
          {oauthChannels.length > 0 && (
            <section className="channel-group">
              <header className="channel-group-head">
                <span className="channel-group-title">OAuth 渠道</span>
                <span className="channel-group-count">{oauthChannels.length} 个</span>
              </header>
              <div className="channel-card-grid collage-grid">
                {oauthChannels.map(renderChannelCard)}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Channel Modal */}
      <Modal open={modalVisible} onClose={() => setModalVisible(false)} maxWidth={520} cardClass="channel-modal">
            <div className="modal-header">
              <span className="modal-title channel-modal-title">{form.isEdit ? '编辑 AI 渠道' : '添加 AI 渠道'}</span>
              <button className="modal-close" onClick={() => setModalVisible(false)}>×</button>
            </div>
            <div className="modal-body flex-column gap-3">

              {/* 基础信息 */}
              <section className="form-section tone-sakura">
                <header className="form-section-head">
                  <span className="form-section-dot" aria-hidden="true" />
                  <span className="form-section-title">基础信息</span>
                  <span className="form-section-spark" aria-hidden="true">✦</span>
                </header>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex-column gap-1">
                    <label className="text-[10px] text-muted font-medium">渠道 ID</label>
                    <input value={form.id} onChange={set('id')} type="text" placeholder="gemini" className="form-input" disabled={form.isEdit} />
                  </div>
                  <div className="flex-column gap-1">
                    <label className="text-[10px] text-muted font-medium">渠道名称</label>
                    <input value={form.name} onChange={set('name')} type="text" placeholder="谷歌官方" className="form-input" />
                  </div>
                </div>
                <div className="flex-column gap-1 mt-3">
                  <label className="text-[10px] text-muted font-medium">API 适配器</label>
                  <select value={form.adapterType} onChange={onAdapterChange} className="form-select">
                    <optgroup label="普通 Key 渠道">
                      <option value="gemini">Gemini</option>
                      <option value="aistudio">Google AI Studio</option>
                      <option value="openai">OpenAI</option>
                      <option value="glm">GLM 智谱 API Key</option>
                    </optgroup>
                    <optgroup label="OAuth 渠道">
                      <option value="gcil">GCIL OAuth（Gemini CLI 直连）</option>
                      <option value="antigravity">Antigravity OAuth</option>
                    </optgroup>
                  </select>
                </div>
              </section>

              {/* 接口与模型 */}
              <section className="form-section tone-violet">
                <header className="form-section-head">
                  <span className="form-section-dot" aria-hidden="true" />
                  <span className="form-section-title">接口与模型</span>
                  <span className="form-section-spark" aria-hidden="true">✦</span>
                </header>
                <div className="flex-column gap-3">
                  <div className="flex-column gap-1">
                    <label className="text-[10px] text-muted font-medium">支持模型列表</label>
                    <div className="flex-row gap-2">
                      <button type="button" className="model-list-toggle" onClick={() => setModelsExpanded(v => !v)} aria-expanded={modelsExpanded}>
                        <span className="model-list-toggle-text">
                          {modelList.length === 0 ? '暂无模型' : `共 ${modelList.length} 个模型`}
                        </span>
                        <Icon name="chevronDown" size={12} />
                      </button>
                      <button type="button" className="btn btn-secondary whitespace-nowrap" onClick={fetchChannelModels} disabled={isFetchingModels}>
                        {isFetchingModels ? '获取中…' : '获取模型'}
                      </button>
                    </div>
                    {modelsExpanded && (
                      <div className="model-editor">
                        {modelList.length > 1 && (
                          <div className="model-editor-toolbar">
                            <button type="button" className="model-test-all" onClick={testAllModels} disabled={isTestingAny}>
                              {isTestingAny ? '测试中…' : '全部测试'}
                            </button>
                          </div>
                        )}
                        {modelList.length === 0 && (
                          <span className="text-[10px] text-faint">暂无模型，请在下方添加或点击"获取模型"</span>
                        )}
                        {modelList.map(model => {
                          const test = modelTests[model]
                          const testTitle = test?.status === 'fail'
                            ? test.error
                            : test?.status === 'ok'
                              ? (test.reply ? `回复：${test.reply}` : '测试通过')
                              : `测试 ${model}`
                          return (
                            <span key={model} className="model-editor-tag" title={test?.status === 'fail' ? test.error : model}>
                              <button
                                type="button"
                                className={`model-editor-tag-test${test ? ` is-${test.status}` : ''}`}
                                onClick={() => testModelByName(model)}
                                disabled={test?.status === 'testing'}
                                title={testTitle}
                                aria-label={`测试 ${model}`}
                              >
                                {test?.status === 'testing' ? '…' : test?.status === 'ok' ? '✓' : test?.status === 'fail' ? '✗' : <Icon name="play" size={9} />}
                              </button>
                              <span className="model-editor-tag-text">{model}</span>
                              {test?.status === 'ok' && <span className="model-test-latency">{test.latencyMs}ms</span>}
                              <button type="button" className="model-editor-tag-remove" onClick={() => removeModel(model)} aria-label={`移除 ${model}`}>×</button>
                            </span>
                          )
                        })}
                        <div className="flex-row gap-2 model-editor-add">
                          <input
                            value={newModel}
                            onChange={e => setNewModel(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addModel() } }}
                            type="text"
                            placeholder="输入模型名，回车添加"
                            className="form-input flex-1 min-w-0"
                          />
                          <button type="button" className="btn btn-secondary whitespace-nowrap" onClick={addModel} disabled={!newModel.trim()}>添加</button>
                        </div>
                      </div>
                    )}
                  </div>
                  {!isOAuthAdapter && (
                    <div className="flex-column gap-1">
                      <label className="text-[10px] text-muted font-medium">{isAistudio ? 'API Key（单 Key 兼容，优先使用 Key 池）' : 'API Key'}</label>
                      <input value={form.apiKey} onChange={set('apiKey')} type="password" placeholder="请输入密钥..." className="form-input" />
                    </div>
                  )}
                  {isAistudio && (() => {
                    const filledKeyCount = form.geminiKeys.filter(item => item.apiKey.trim()).length
                    return (
                    <div className="flex-column gap-3 col-span-2 border border-default rounded-lg p-3 sub-card">
                      <div className="flex-column gap-2">
                        <label className="text-[10px] text-muted font-medium">AI Studio 多项目 Key 池</label>
                        <button type="button" className="model-list-toggle" onClick={() => setKeyPoolExpanded(v => !v)} aria-expanded={keyPoolExpanded}>
                          <span className="model-list-toggle-text">
                            {filledKeyCount === 0 ? '未配置项目 Key' : `已配置 ${filledKeyCount} 个项目 Key`}
                          </span>
                          <Icon name="chevronDown" size={12} />
                        </button>
                        {keyPoolExpanded && (
                          <>
                            <div className="flex-column gap-2 mt-1">
                              {form.geminiKeys.length > 0 && (
                                <div className="gemini-key-head" aria-hidden="true">
                                  <span />
                                  <span>项目标识（可选）</span>
                                  <span>API Key</span>
                                  <span />
                                </div>
                              )}
                              {form.geminiKeys.map((item, index) => {
                                const filled = item.apiKey.trim().length > 0
                                const rowExpanded = !filled || expandedGeminiKeys.has(item.rowId)
                                const status = geminiKeyStatusInfo(item)
                                const disabled = item.enabled === false
                                const dot = (
                                  <button
                                    type="button"
                                    className={`gemini-key-dot is-${status.tone}`}
                                    onClick={() => toggleGeminiKeyEnabled(item.rowId)}
                                    title={`${status.label}；点击${disabled ? '启用' : '禁用'}此 Key`}
                                    aria-label={`Key ${index + 1} ${status.label}，点击${disabled ? '启用' : '禁用'}`}
                                  />
                                )
                                if (!rowExpanded) {
                                  return (
                                    <div key={item.rowId} className={`gemini-key-row is-collapsed${disabled ? ' is-disabled' : ''}`}>
                                      <button
                                        type="button"
                                        className="gemini-key-summary"
                                        onClick={() => toggleGeminiKeyExpanded(item.rowId)}
                                        aria-expanded="false"
                                        title="展开编辑"
                                      >
                                        {dot}
                                        <span className="gemini-key-index">{index + 1}</span>
                                        <span className="gemini-key-summary-project">{item.projectId.trim() || `项目 ${index + 1}`}</span>
                                        <span className={`gemini-key-summary-status is-${status.tone}`}>{status.label}</span>
                                        <span className="gemini-key-summary-secret">{maskGeminiApiKey(item.apiKey)}</span>
                                        <Icon name="chevronDown" size={11} />
                                      </button>
                                      <button
                                        type="button"
                                        className="gemini-key-remove"
                                        onClick={() => removeGeminiKey(item.rowId)}
                                        title="移除此 Key"
                                        aria-label={`移除项目 ${index + 1} 的 Key`}
                                      >
                                        <Icon name="trash" size={12} />
                                      </button>
                                    </div>
                                  )
                                }
                                return (
                                  <div key={item.rowId} className={`gemini-key-row${disabled ? ' is-disabled' : ''}`}>
                                    <span className="gemini-key-index">{dot}{index + 1}</span>
                                    <input
                                      value={item.projectId}
                                      onChange={updateGeminiKey(item.rowId, 'projectId')}
                                      type="text"
                                      placeholder={`项目 ${index + 1}`}
                                      className="form-input gemini-key-project"
                                      aria-label={`Key ${index + 1} 项目标识（可选）`}
                                    />
                                    <input
                                      value={item.apiKey}
                                      onChange={updateGeminiKey(item.rowId, 'apiKey')}
                                      type="password"
                                      placeholder="AIza..."
                                      className="form-input gemini-key-secret"
                                      aria-label={`Key ${index + 1} API Key`}
                                    />
                                    <div className="gemini-key-actions">
                                      {filled && (
                                        <button
                                          type="button"
                                          className={`gemini-key-test is-${status.tone}`}
                                          onClick={() => testGeminiKeys(item.rowId)}
                                          disabled={status.tone === 'testing'}
                                          title={`测活此 Key（${status.label}）`}
                                          aria-label={`测活 Key ${index + 1}`}
                                        >
                                          {status.tone === 'testing' ? '…' : <Icon name="play" size={10} />}
                                        </button>
                                      )}
                                      {filled && (
                                        <button
                                          type="button"
                                          className="gemini-key-collapse"
                                          onClick={() => toggleGeminiKeyExpanded(item.rowId)}
                                          title="收起"
                                          aria-label={`收起 Key ${index + 1}`}
                                          aria-expanded="true"
                                        >
                                          <Icon name="chevronDown" size={12} />
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className="gemini-key-remove"
                                        onClick={() => removeGeminiKey(item.rowId)}
                                        title="移除此 Key"
                                        aria-label={`移除项目 ${index + 1} 的 Key`}
                                      >
                                        <Icon name="trash" size={12} />
                                      </button>
                                    </div>
                                    {status.tone !== 'idle' && (
                                      <span className={`gemini-key-statusline is-${status.tone}`}>{status.label}</span>
                                    )}
                                  </div>
                                )
                              })}
                              <div className="gemini-key-toolbar">
                                <button type="button" className="btn btn-secondary gemini-key-add" onClick={addGeminiKey}>
                                  <Icon name="plus" size={13} />添加项目 Key
                                </button>
                                {filledKeyCount > 0 && (
                                  <button
                                    type="button"
                                    className="btn btn-secondary gemini-key-test-all"
                                    onClick={() => testGeminiKeys()}
                                    disabled={keysTestingAll}
                                  >
                                    {keysTestingAll ? '测活中…' : '全部测活'}
                                  </button>
                                )}
                              </div>
                            </div>
                            <span className="text-[9px] text-faint">直接分别填写即可；项目标识留空会自动生成。若多个 Key 属于同一 Google Cloud 项目，请填写相同标识以共享 429 冷却。配置池后，上方单 Key 不参与请求。</span>
                          </>
                        )}
                      </div>
                      {keyPoolExpanded && (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex-column gap-1">
                            <label className="text-[10px] text-muted font-medium">负载策略</label>
                            <select value={form.keyPoolStrategy} onChange={set('keyPoolStrategy')} className="form-select">
                              <option value="round_robin">按项目轮询</option>
                              <option value="least_inflight">最少在途请求</option>
                            </select>
                          </div>
                          <div className="flex-column gap-1">
                            <label className="text-[10px] text-muted font-medium">429 默认冷却（秒）</label>
                            <input value={form.keyCooldownSeconds} onChange={set('keyCooldownSeconds')} type="number" min="5" max="600" className="form-input" />
                          </div>
                        </div>
                      )}
                    </div>
                    )
                  })()}
                  <div className="flex-column gap-1">
                    <label className="text-[10px] text-muted font-medium">Base URL (API 终结点)</label>
                    <input value={form.baseUrl} onChange={set('baseUrl')} type="text" placeholder="默认使用官方端点，如需中转请填写" className="form-input" />
                  </div>
                </div>
              </section>

              {/* 负载与额度保护（Antigravity） */}
              {isAntigravity && (
                <section className="form-section tone-sky">
                  <header className="form-section-head">
                    <span className="form-section-dot" aria-hidden="true" />
                    <span className="form-section-title">负载与额度保护</span>
                    <span className="form-section-spark" aria-hidden="true">✦</span>
                  </header>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex-column gap-1">
                      <label className="text-[10px] text-muted font-medium">多账号负载策略</label>
                      <select value={form.loadBalanceStrategy} onChange={set('loadBalanceStrategy')} className="form-select">
                        <option value="smart">智能均衡（推荐）</option>
                        <option value="round_robin">轮询</option>
                        <option value="least_connections">最少在途</option>
                        <option value="weighted_round_robin">加权轮询</option>
                      </select>
                    </div>
                    <div className="flex-column gap-1">
                      <label className="text-[10px] text-muted font-medium">额度保护阈值（0~1）</label>
                      <input
                        value={form.quotaProtectionThreshold}
                        onChange={set('quotaProtectionThreshold')}
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        className="form-input"
                      />
                    </div>
                    <div className="flex-column gap-1 col-span-2">
                      <label className="text-[10px] text-muted font-medium">额度保护模型（逗号分隔，* 为全部）</label>
                      <input
                        value={form.quotaProtectionModels}
                        onChange={set('quotaProtectionModels')}
                        type="text"
                        placeholder="*"
                        className="form-input"
                      />
                    </div>
                  </div>
                </section>
              )}

              {/* GCIL 高级特性（抗截断/search 接地） */}
              {isGcil && (
                <section className="form-section tone-mint">
                  <header className="form-section-head">
                    <span className="form-section-dot" aria-hidden="true" />
                    <span className="form-section-title">高级特性</span>
                    <span className="form-section-spark" aria-hidden="true">✦</span>
                  </header>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex-column gap-1">
                      <label className="text-[10px] text-muted font-medium">流式抗截断</label>
                      <select
                        value={form.antiTruncation ? 'true' : 'false'}
                        onChange={e => setForm(f => ({ ...f, antiTruncation: e.target.value === 'true' }))}
                        className="form-select"
                      >
                        <option value="true">开启（推荐）</option>
                        <option value="false">关闭</option>
                      </select>
                      <span className="text-[10px] text-faint">回复达到 maxTokens 截断时自动续写</span>
                    </div>
                    <div className="flex-column gap-1">
                      <label className="text-[10px] text-muted font-medium">最大续写轮数</label>
                      <input
                        value={form.maxAntiTruncationRounds}
                        onChange={set('maxAntiTruncationRounds')}
                        type="number" min="0" max="5"
                        className="form-input"
                        disabled={!form.antiTruncation}
                      />
                      <span className="text-[10px] text-faint">0-5 轮，默认 2 轮</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-faint mt-2">
                    提示：模型名加 <code className="font-mono">-search</code> 后缀（如 gemini-2.5-pro-search）可启用 Google Search 接地
                  </span>
                </section>
              )}

              {/* OAuth 账号（Antigravity / GCIL） */}
              {isOAuthAdapter && (
                <section className="form-section tone-sakura">
                  <header className="form-section-head">
                    <span className="form-section-dot" aria-hidden="true" />
                    <span className="form-section-title">{isGcil ? 'GCIL OAuth 账号' : 'Antigravity OAuth 账号'}</span>
                    <span className="form-section-spark" aria-hidden="true">✦</span>
                  </header>
                  <div className="flex-column gap-2">
                    <div className="flex-row justify-between items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-muted">
                        {antigravityOAuth.status?.connected
                          ? `账号 ${antigravityOAuth.status.total} 个 · 启用 ${antigravityOAuth.status.enabled} 个 · 额度模型 ${antigravityOAuth.status.quotaModels || 0} 个${antigravityOAuth.status.coolingAccounts ? ` · 冷却账号 ${antigravityOAuth.status.coolingAccounts} 个` : ''}`
                          : '支持多账号轮询、最少在途和模型级额度冷却'}
                      </span>
                      <div className="flex-row gap-1">
                        {isAntigravity && (antigravityOAuth.status?.accounts || []).length > 0 && (
                          <button
                            type="button"
                            className="btn btn-secondary whitespace-nowrap"
                            onClick={() => refreshAntigravityQuotas()}
                            disabled={antigravityOAuth.loading}
                          >
                            刷新全部额度
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-secondary whitespace-nowrap"
                          onClick={startAntigravityOAuth}
                          disabled={antigravityOAuth.loading || !form.isEdit}
                        >
                          {antigravityOAuth.loading ? '处理中…' : '添加账号'}
                        </button>
                        {isGcil && (antigravityOAuth.status?.accounts || []).length > 0 && (
                          <button
                            type="button"
                            className="btn btn-secondary whitespace-nowrap"
                            onClick={probeAllOAuthAccounts}
                            disabled={antigravityOAuth.loading}
                          >
                            全部检验
                          </button>
                        )}
                        {isGcil && (
                          <button
                            type="button"
                            className="btn btn-secondary whitespace-nowrap"
                            onClick={() => setGcilImport(current => ({ ...current, visible: !current.visible }))}
                            disabled={antigravityOAuth.loading || !form.isEdit}
                          >
                            导入凭证
                          </button>
                        )}
                      </div>
                    </div>
                    {isGcil && gcilImport.visible && (
                      <div className="flex-column gap-2">
                        <span className="text-[10px] text-muted">
                          粘贴 gcli2api 凭证文件或 Gemini CLI oauth_creds.json 的内容，需包含 refresh_token。
                        </span>
                        <textarea
                          value={gcilImport.text}
                          onChange={e => setGcilImport(current => ({ ...current, text: e.target.value }))}
                          rows="5"
                          className="form-textarea font-mono"
                          placeholder='{"access_token": "...", "refresh_token": "...", "project_id": "..."}'
                        />
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={importGcilCredentialFile}
                          disabled={antigravityOAuth.loading || !gcilImport.text.trim()}
                        >
                          校验并导入
                        </button>
                      </div>
                    )}
                    {!form.isEdit && (
                      <span className="text-[10px] text-faint">新增渠道需要先保存，重新打开编辑后即可登录。</span>
                    )}
                    {antigravityOAuth.authUrl && (
                      <div className="flex-column gap-2">
                        <a
                          href={antigravityOAuth.authUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-accent break-all"
                        >
                          打开 Google 授权页面
                        </a>
                        <span className="text-[10px] text-muted">
                          同机浏览器会自动完成；手机授权时 localhost 无法打开属于正常，请复制地址栏完整 URL 粘贴到下方。
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => refreshAntigravityOAuthStatus(form.id)}
                          disabled={antigravityOAuth.loading}
                        >
                          已完成授权，刷新账号列表
                        </button>
                        <textarea
                          value={antigravityOAuth.callbackUrl}
                          onChange={e => setAntigravityOAuth(current => ({ ...current, callbackUrl: e.target.value }))}
                          rows="3"
                          className="form-textarea font-mono"
                          placeholder="粘贴 http://localhost:端口/?state=...&code=..."
                        />
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={finishAntigravityOAuth}
                          disabled={antigravityOAuth.loading || !antigravityOAuth.callbackUrl.trim()}
                        >
                          完成登录并保存凭证
                        </button>
                      </div>
                    )}
                    {(antigravityOAuth.status?.accounts || []).length > 0 && (
                      <div className="flex-column gap-3 max-h-72 overflow-y-auto">
                        {antigravityOAuth.status.accounts.map(account => {
                          const quotaEntries = Object.entries(account.quotas || {})
                          const quotaGroups = Array.isArray(account.quotaGroups) ? account.quotaGroups : []
                          const modelRemainingValues = quotaEntries
                            .filter(([, quota]) => quota?.remaining !== null && quota?.remaining !== undefined)
                            .map(([, quota]) => Number(quota.remaining))
                            .filter(Number.isFinite)
                          const windowRemainingValues = quotaGroups
                            .flatMap(group => group.buckets || [])
                            .filter(bucket => bucket?.remaining !== null && bucket?.remaining !== undefined)
                            .map(bucket => Number(bucket.remaining))
                            .filter(Number.isFinite)
                          const remainingValues = windowRemainingValues.length > 0
                            ? windowRemainingValues
                            : modelRemainingValues
                          const minimumRemaining = remainingValues.length > 0
                            ? Math.min(...remainingValues)
                            : null
                          const activeCooldowns = Object.entries(account.cooldowns || {})
                          const tierMeta = accountTierMeta(account.tier)
                          const errorMeta = accountErrorMeta(account)
                          const healthPct = Math.round(Number(account.healthScore ?? 1) * 100)
                          const healthTone = healthPct >= 80 ? 'mint' : healthPct >= 50 ? 'amber' : 'danger'
                          const nearestRecovery = activeCooldowns
                            .map(([, until]) => Number(until))
                            .filter(until => until > Date.now())
                            .sort((a, b) => a - b)[0]
                          const accountExpanded = expandedAccounts.has(account.accountId)
                          return (
                            <div key={account.accountId} className={`antigravity-account-card flex-column gap-3${account.enabled ? '' : ' is-disabled'}${accountExpanded ? '' : ' is-collapsed'}`}>
                              <div className="flex-row justify-between items-center gap-2">
                                <button
                                  type="button"
                                  className="account-card-toggle"
                                  onClick={() => toggleAccountExpanded(account.accountId)}
                                  aria-expanded={accountExpanded}
                                  title={accountExpanded ? '收起账号详情' : '展开账号详情'}
                                >
                                  <div className="account-card-summary">
                                    <span className="text-xs font-medium text-strong truncate min-w-0">{account.email || account.accountId}</span>
                                    <span className={`tier-badge tier-${tierMeta.tone}`}>{tierMeta.label}</span>
                                    {!account.enabled && <span className="badge badge-gray">已停用</span>}
                                    {account.enabled && (errorMeta
                                      ? <span className="badge badge-danger">{errorMeta.code ? `错误码: ${errorMeta.code}` : '有错误'}</span>
                                      : <span className="badge badge-success">无错误</span>)}
                                  </div>
                                </button>
                                <div className="flex-row items-center gap-2 flex-shrink-0">
                                  <span className="text-[10px] font-mono text-muted" title={`健康度 ${healthPct}%`}>{healthPct}%</span>
                                  <button
                                    type="button"
                                    className="account-card-chevron"
                                    onClick={() => toggleAccountExpanded(account.accountId)}
                                    aria-expanded={accountExpanded}
                                    title={accountExpanded ? '收起账号详情' : '展开账号详情'}
                                    aria-label={accountExpanded ? `收起 ${account.email || account.accountId} 详情` : `展开 ${account.email || account.accountId} 详情`}
                                  >
                                    <Icon name="chevronDown" size={12} />
                                  </button>
                                </div>
                              </div>
                              {accountOps[account.accountId]?.result && (
                                <span className={`text-[10px] px-1 ${accountOps[account.accountId].result.ok ? 'text-success' : 'text-danger'} break-all`}>
                                  {accountOps[account.accountId].result.message}
                                </span>
                              )}
                              {accountExpanded && (
                              <>
                              <span className="text-[10px] text-muted">
                                {[
                                  ...(account.credits || []).length > 0
                                    ? [`积分 ${account.credits.map(item => item.creditAmount ?? '?').join('/')}`]
                                    : [],
                                  ...(minimumRemaining !== null ? [`最低剩余 ${Math.round(minimumRemaining * 100)}%`] : []),
                                  ...(activeCooldowns.length > 0
                                    ? [`${activeCooldowns.length} 个模型冷却${nearestRecovery ? `（${new Date(nearestRecovery).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 恢复）` : ''}`]
                                    : [])
                                ].join(' · ') || '暂无额度数据'}
                              </span>
                              <span className="account-health-row" title={`健康度 ${healthPct}%`}>
                                <span className="text-[10px] text-faint">健康</span>
                                <span className="account-health-bar">
                                  <span className={`account-health-fill is-${healthTone}`} style={{ width: `${healthPct}%` }} />
                                </span>
                                <span className="text-[10px] font-mono text-muted">{healthPct}%</span>
                              </span>
                              <div className="flex-row flex-wrap gap-1">
                                {isGcil && (
                                  <>
                                    <button
                                      type="button"
                                      className="btn btn-secondary py-1 px-2 text-[10px]"
                                      onClick={() => probeOAuthAccount(account)}
                                      disabled={antigravityOAuth.loading || accountOps[account.accountId]?.phase}
                                    >
                                      {accountOps[account.accountId]?.phase === 'probing' ? '检验中…' : '检验'}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-secondary py-1 px-2 text-[10px]"
                                      onClick={() => testOAuthAccount(account)}
                                      disabled={antigravityOAuth.loading || !account.enabled || accountOps[account.accountId]?.phase}
                                    >
                                      {accountOps[account.accountId]?.phase === 'testing' ? '测试中…' : '消息测试'}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-secondary py-1 px-2 text-[10px]"
                                      onClick={() => exportOAuthAccount(account)}
                                      disabled={antigravityOAuth.loading || accountOps[account.accountId]?.phase}
                                    >
                                      {accountOps[account.accountId]?.phase === 'exporting' ? '导出中…' : '导出'}
                                    </button>
                                  </>
                                )}
                                {isAntigravity && (
                                  <button
                                    type="button"
                                    className="btn btn-secondary py-1 px-2 text-[10px]"
                                    onClick={() => refreshAntigravityQuotas(account.accountId)}
                                    disabled={antigravityOAuth.loading || !account.enabled}
                                  >
                                    查额度
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className={`btn py-1 px-2 text-[10px] ${account.enabled ? 'btn-danger' : 'btn-success'}`}
                                  onClick={() => toggleAntigravityAccount(account)}
                                  disabled={antigravityOAuth.loading}
                                >
                                  {account.enabled ? '停用' : '启用'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-danger py-1 px-2 text-[10px]"
                                  onClick={() => removeAntigravityAccount(account)}
                                  disabled={antigravityOAuth.loading}
                                >
                                  删除
                                </button>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <label className="flex-column gap-1 text-[10px] text-muted">
                                  <span>优先级</span>
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    defaultValue={account.priority || 0}
                                    className="form-input py-1"
                                    onBlur={e => updateAntigravityAccount(account, { priority: Number(e.target.value) })}
                                    disabled={antigravityOAuth.loading}
                                  />
                                </label>
                                <label className="flex-column gap-1 text-[10px] text-muted">
                                  <span>权重</span>
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.1"
                                    defaultValue={account.weight ?? 1}
                                    className="form-input py-1"
                                    onBlur={e => updateAntigravityAccount(account, { weight: Number(e.target.value) })}
                                    disabled={antigravityOAuth.loading}
                                  />
                                </label>
                              </div>
                              <label className="flex-column gap-1 text-[10px] text-muted">
                                <span>Project ID（多项目账号可手动修正）</span>
                                <input
                                  type="text"
                                  defaultValue={account.projectId || ''}
                                  className="form-input py-1 font-mono"
                                  placeholder="my-gcp-project-id"
                                  onBlur={e => {
                                    const value = e.target.value.trim()
                                    if (value !== (account.projectId || '')) {
                                      updateAntigravityAccount(account, { projectId: value })
                                    }
                                  }}
                                  disabled={antigravityOAuth.loading}
                                />
                              </label>
                              {account.lastError && (
                                <details className="account-error-details">
                                  <summary className="text-[10px] text-danger cursor-pointer px-1">
                                    查看报错{account.lastErrorAt ? `（${new Date(account.lastErrorAt).toLocaleString('zh-CN')}）` : ''}
                                  </summary>
                                  <span className="text-[10px] text-danger break-all px-1 font-mono">{account.lastError}</span>
                                </details>
                              )}
                              {quotaGroups.length > 0 && (
                                <details className="quota-window-details border border-default rounded bg-deep">
                                  <summary className="quota-window-summary text-[10px] text-accent cursor-pointer p-2">
                                    <span>额度详情 · {quotaGroups.length} 个模型组</span>
                                    {account.quotaUpdatedAt ? ` · ${new Date(account.quotaUpdatedAt).toLocaleString()}` : ''}
                                  </summary>
                                  <div className="flex-column gap-2 p-2">
                                    {quotaGroups.map((group, groupIndex) => (
                                      <div key={`${group.displayName}-${groupIndex}`} className={`quota-group-card border border-default rounded p-3 bg-inset ${/claude|gpt/i.test(group.displayName) ? 'tone-violet' : 'tone-sky'}`}>
                                        <div className="pane-label mb-2">
                                          {/claude|gpt/i.test(group.displayName) ? 'Claude / GPT' : 'Gemini'}
                                        </div>
                                        <div className="quota-window-grid">
                                          {(group.buckets || []).map(bucket => {
                                            const valid = bucket?.remaining !== null &&
                                              bucket?.remaining !== undefined &&
                                              Number.isFinite(Number(bucket.remaining))
                                            const remaining = valid ? Number(bucket.remaining) : null
                                            const percentage = valid ? Math.round(remaining * 100) : null
                                            return (
                                              <div key={bucket.bucketId || bucket.window} className="quota-window-card flex-column gap-1.5">
                                                <div className="flex-row justify-between text-[10px]">
                                                  <span className="font-bold text-muted">
                                                    {bucket.window === '5h' ? '5 小时' : bucket.window === 'weekly' ? '每周' : bucket.window}
                                                  </span>
                                                  <span className="font-mono text-strong">{percentage === null ? 'N/A' : `${percentage}%`}</span>
                                                </div>
                                                <div className="quota-progress rounded overflow-hidden bg-elevated">
                                                  <div
                                                    className={percentage !== null && percentage < 20 ? 'is-low' : ''}
                                                    style={{ width: `${percentage ?? 0}%` }}
                                                  />
                                                </div>
                                                <span className="text-[9px] text-faint whitespace-nowrap">
                                                  {bucket.resetTime
                                                    ? `重置 ${new Date(bucket.resetTime).toLocaleString()}`
                                                    : '暂无重置时间'}
                                                </span>
                                              </div>
                                            )
                                          })}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              )}
                              </>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Gemini API 协议与安全等级 */}
              {isGemini && (
                <section className="form-section tone-mint">
                  <header className="form-section-head">
                    <span className="form-section-dot" aria-hidden="true" />
                    <span className="form-section-title">Gemini API 协议</span>
                    <span className="form-section-spark" aria-hidden="true">✦</span>
                  </header>
                  <div className="flex-column gap-3">
                    <div className="flex-column gap-1">
                      <label className="text-[10px] text-muted font-medium">请求协议</label>
                      <select value={form.apiMode} onChange={set('apiMode')} className="form-select">
                        <option value="generateContent">generateContent（兼容模式）</option>
                        <option value="interactions">Interactions（服务端会话）</option>
                      </select>
                      <span className="text-[10px] text-faint">
                        {form.apiMode === 'interactions'
                          ? '使用 previous_interaction_id 降低多轮历史重传；请求默认由 Google 存储，免费层通常保留 1 天。'
                          : '保持现有无状态请求，适合第三方 Gemini 兼容网关。'}
                      </span>
                    </div>
                    {form.apiMode === 'interactions' && (
                      <div className="flex-column gap-1">
                        <label className="text-[10px] text-muted font-medium">协议不兼容时</label>
                        <select
                          value={form.interactionsFallback ? 'true' : 'false'}
                          onChange={e => setForm(current => ({ ...current, interactionsFallback: e.target.value === 'true' }))}
                          className="form-select"
                        >
                          <option value="true">自动回退 generateContent（推荐）</option>
                          <option value="false">直接报错，不回退</option>
                        </select>
                      </div>
                    )}
                    <div className="flex-column gap-2">
                      <label className="text-[10px] text-muted font-medium">谷歌原生工具</label>
                      <div className="grid grid-cols-2 gap-2">
                        {GEMINI_BUILTIN_TOOL_OPTIONS.map(tool => {
                          const checked = form.builtinTools.includes(tool.id)
                          return (
                            <label key={tool.id} className="flex-row items-center gap-2 text-[11px] text-muted cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => setForm(current => ({
                                  ...current,
                                  builtinTools: checked
                                    ? current.builtinTools.filter(item => item !== tool.id)
                                    : [
                                        ...current.builtinTools.filter(item => !(
                                          (tool.id === 'google_maps' && item === 'code_execution') ||
                                          (tool.id === 'code_execution' && item === 'google_maps')
                                        )),
                                        tool.id
                                      ]
                                }))}
                              />
                              <span>{tool.label}</span>
                            </label>
                          )
                        })}
                      </div>
                      <span className="text-[10px] text-faint">由 Google 服务器执行；可与插件本地函数工具同时使用。Maps 与代码执行受上游限制，开启其中一个会关闭另一个。</span>
                    </div>
                    <div className="flex-column gap-1">
                      <label className="text-[10px] text-muted font-medium">安全等级</label>
                      <select
                        value={form.safetyLevel}
                        onChange={set('safetyLevel')}
                        className="form-select"
                        disabled={form.apiMode === 'interactions'}
                      >
                      <option value="default">跟随模型默认</option>
                      <option value="off">关闭附加过滤</option>
                      <option value="permissive">宽松（仅高风险拦截）</option>
                      <option value="balanced">均衡（中高风险拦截）</option>
                      <option value="strict">严格（低风险起拦截）</option>
                      </select>
                      <span className="text-[10px] text-faint">
                        {form.apiMode === 'interactions'
                          ? 'Interactions API 当前不支持自定义 safetySettings，将跟随模型默认。'
                          : '统一作用于骚扰、仇恨、露骨内容和危险内容；Gemini 核心保护不可关闭。'}
                      </span>
                    </div>
                  </div>
                </section>
              )}
            </div>
            <div className="modal-footer justify-end">
              <button className="btn btn-secondary" onClick={() => setModalVisible(false)}>取消</button>
              <button className="btn btn-primary" onClick={saveChannel}>保存</button>
            </div>
      </Modal>

    </div>
  )
}
