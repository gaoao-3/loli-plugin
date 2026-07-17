<script setup>
import { ref, reactive, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { api } from './utils/api'

// --- Constants ---
const PAGE_ORDER = ['overview', 'channels', 'presets', 'tools', 'memory', 'config', 'logs']
const MOBILE_PAGES = ['overview', 'channels', 'presets', 'memory', 'config']
const PAGE_TITLES = {
  overview: '// 总览 WORKSPACE',
  channels: '// AI 渠道管理',
  presets: '// 预设角色管理',
  tools: '// 工具扩展插件',
  memory: '// 记忆系统',
  config: '// 系统参数配置',
  logs: '// 终端日志'
}
const CONFIG_TABS = [
  { id: 'trigger', label: '触发与范围' },
  { id: 'session', label: '会话与冷却' },
  { id: 'model', label: '模型与媒体' },
  { id: 'memory', label: '记忆系统' },
  { id: 'system', label: '模板与系统' }
]
const THINKING_LEVEL_OPTIONS = [
  { label: 'OFF', value: 'OFF' },
  { label: 'LOW', value: 'LOW' },
  { label: 'MEDIUM', value: 'MEDIUM' },
  { label: 'HIGH', value: 'HIGH' }
]

// --- State ---
const activeTab = ref('overview')
const activeConfigTab = ref('trigger')
const authorized = ref(false)
const authRequired = ref(false)
const authTokenInput = ref('')
const authError = ref('')
const loading = ref(false)
const system = ref(null)
const channels = ref([])
const presets = ref([])
const tools = ref([])
const memory = ref(null)
const rawConfig = ref(null)
const logs = ref([])
const logsAutoRefresh = ref(true)
const isSidebarCollapsed = ref(false)
const isMobileMenuOpen = ref(false)
const toasts = ref([])

// Form states
const channelModalVisible = ref(false)
const channelFormTitle = ref('添加 AI 渠道')
const channelForm = reactive({
  id: '',
  name: '',
  adapterType: 'gemini',
  models: '',
  apiKey: '',
  baseUrl: '',
  safetyLevel: 'default',
  protocol: 'gemini',
  isEdit: false
})
const isFetchingModels = ref(false)

const presetModalVisible = ref(false)
const presetFormTitle = ref('配置预设角色')
const presetForm = reactive({
  id: '',
  name: '',
  channelId: '',
  model: '',
  prompt: '',
  temperature: 0.9,
  maxTokens: 2048,
  topP: '',
  enableReasoning: true,
  thinkingLevel: 'LOW',
  isEdit: false
})

const toolModalVisible = ref(false)
const selectedToolFile = ref(null)
const toolFileInfo = reactive({
  name: '',
  size: ''
})

// Config form local copy
const localConfig = ref(null)

// Logs filtering
const logsLevelFilter = ref('ALL')
const logsSearchQuery = ref('')
let logsIntervalId = null
const terminalLogsRef = ref(null)

// --- Helper Utilities ---
function showToast(message, type = 'success') {
  const id = Date.now() + Math.random()
  toasts.value.push({ id, message, type })
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }, 3000)
}

function formatChannelAdapter(ch) {
  const adapter = ch.options?.providerType === 'antigravity' ? 'antigravity' : (ch.adapterType || 'gemini')
  return adapter === 'antigravity'
    ? `Antigravity · ${getAntigravityProtocol(ch) === 'gemini' ? 'Gemini' : 'OpenAI'}`
    : adapter
}

function getAntigravityProtocol(ch) {
  if (ch.options?.protocol === 'gemini' || ch.options?.protocol === 'openai') return ch.options.protocol
  return ch.adapterType === 'gemini' ? 'gemini' : 'openai'
}

function formatGeminiSafetyLevel(value) {
  const levels = {
    default: '模型默认',
    off: '关闭附加过滤',
    permissive: '宽松',
    balanced: '均衡',
    strict: '严格'
  }
  return levels[value] || '模型默认'
}

function getToolFileName(filePath) {
  if (!filePath) return '-'
  const clean = filePath.replace(/\\/g, '/')
  const parts = clean.split('/')
  return parts.slice(-2).join('/')
}

// --- API Syncing ---
async function fetchHealth() {
  try {
    const res = await api.get('/health')
    authRequired.value = res.authRequired
    const localToken = localStorage.getItem('loli-dashboard-token')
    if (!authRequired.value || localToken) {
      authorized.value = true
      loadTabData(activeTab.value)
    } else {
      authorized.value = false
    }
  } catch (err) {
    showToast('无法连接后台服务', 'error')
  }
}

async function verifyToken() {
  if (!authTokenInput.value.trim()) {
    authError.value = '请输入验证令牌'
    return
  }
  loading.value = true
  authError.value = ''
  try {
    localStorage.setItem('loli-dashboard-token', authTokenInput.value.trim())
    // Retry health check or just reload status
    const statusRes = await fetch('/api/system/status', {
      headers: { 'Authorization': `Bearer ${authTokenInput.value.trim()}` }
    })
    if (statusRes.ok) {
      authorized.value = true
      showToast('令牌验证成功')
      loadTabData(activeTab.value)
    } else {
      localStorage.removeItem('loli-dashboard-token')
      authError.value = '验证失败，令牌错误'
    }
  } catch (err) {
    localStorage.removeItem('loli-dashboard-token')
    authError.value = err.message || '网络连接异常'
  } finally {
    loading.value = false
  }
}

function logout() {
  localStorage.removeItem('loli-dashboard-token')
  authorized.value = false
  authTokenInput.value = ''
  showToast('已退出登录')
}

async function loadTabData(tab) {
  if (!authorized.value) return
  loading.value = true
  try {
    switch (tab) {
      case 'overview':
        await syncOverview()
        break
      case 'channels':
        await syncChannels()
        break
      case 'presets':
        await syncPresets()
        break
      case 'tools':
        await syncTools()
        break
      case 'memory':
        await syncMemory()
        break
      case 'config':
        await syncConfig()
        break
      case 'logs':
        await syncLogs()
        break
    }
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

// --- Tab: Overview ---
async function syncOverview() {
  const [statusRes, channelsRes, toolsRes] = await Promise.all([
    api.get('/system/status'),
    api.get('/channels'),
    api.get('/tools')
  ])
  system.value = statusRes
  channels.value = channelsRes
  tools.value = toolsRes
}

const overviewActiveChannels = computed(() => {
  return channels.value.filter(c => c.status === 'enabled').length
})

const overviewActiveTools = computed(() => {
  return tools.value.filter(t => t.enabled).length
})

const overviewDetails = computed(() => {
  if (!system.value) return []
  return [
    { key: '系统真实内存', val: system.value.memoryUsage || '未知' },
    { key: '机器人进程内存', val: system.value.processMemory?.rssFormatted || '未知' },
    { key: '当前适配器渠道', val: channels.value.map(c => `${c.name} (${formatChannelAdapter(c)})`).join(', ') || '暂无绑定的渠道' },
    { key: '当前活跃会话', val: system.value.activeSessions || '0' },
    { key: 'Bot 主体账号', val: system.value.botInfo || '未绑定' },
    { key: '系统指令配置', val: system.value.systemPromptCount ? `${system.value.systemPromptCount} 条设定` : '无' }
  ]
})

// --- Tab: Channels ---
async function syncChannels() {
  channels.value = await api.get('/channels')
}

async function toggleChannelStatus(ch) {
  loading.value = true
  const updatedStatus = ch.status === 'enabled' ? 'disabled' : 'enabled'
  try {
    await api.put(`/channels/${ch.id}`, { ...ch, status: updatedStatus })
    showToast('渠道状态已更新')
    await syncChannels()
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

function openAddChannel() {
  channelForm.isEdit = false
  channelFormTitle.value = '添加 AI 渠道'
  channelForm.id = ''
  channelForm.name = ''
  channelForm.adapterType = 'gemini'
  channelForm.models = 'gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash-thinking-exp'
  channelForm.apiKey = ''
  channelForm.baseUrl = ''
  channelForm.safetyLevel = 'default'
  channelForm.protocol = 'gemini'
  channelModalVisible.value = true
}

function openEditChannel(ch) {
  channelForm.isEdit = true
  channelFormTitle.value = '编辑 AI 渠道'
  channelForm.id = ch.id
  channelForm.name = ch.name || ''
  channelForm.adapterType = ch.options?.providerType === 'antigravity' ? 'antigravity' : (ch.adapterType || 'gemini')
  channelForm.protocol = ch.options?.protocol || (ch.adapterType === 'gemini' ? 'gemini' : 'openai')
  channelForm.models = (ch.models || []).join(', ')
  channelForm.apiKey = ch.options?.apiKey || ch.apiKey || ''
  channelForm.baseUrl = ch.options?.baseUrl || ch.baseUrl || ''
  channelForm.safetyLevel = ch.options?.safetyLevel || ch.safetyLevel || 'default'
  channelModalVisible.value = true
}

// Watch protocol changes for antigravity default baseUrls
watch(() => channelForm.protocol, (newProto) => {
  if (channelForm.adapterType === 'antigravity' && !channelForm.isEdit) {
    if (newProto === 'gemini') {
      channelForm.baseUrl = 'http://127.0.0.1:8045'
    } else {
      channelForm.baseUrl = 'http://127.0.0.1:8045/v1'
    }
  }
})

// Watch adapter changes
watch(() => channelForm.adapterType, (newAdapter) => {
  if (newAdapter === 'antigravity' && !channelForm.isEdit) {
    channelForm.protocol = 'gemini'
    channelForm.baseUrl = 'http://127.0.0.1:8045'
    if (!channelForm.id) channelForm.id = 'antigravity'
    if (!channelForm.name) channelForm.name = 'Antigravity Tools'
    channelForm.models = ''
  }
})

const isChannelFormGemini = computed(() => {
  return channelForm.adapterType === 'gemini' || (channelForm.adapterType === 'antigravity' && channelForm.protocol === 'gemini')
})

async function fetchChannelModels() {
  isFetchingModels.value = true
  try {
    const result = await api.post('/channels/models/discover', {
      adapterType: channelForm.adapterType,
      options: {
        apiKey: channelForm.apiKey,
        baseUrl: channelForm.baseUrl,
        ...(channelForm.adapterType === 'antigravity' ? { protocol: channelForm.protocol } : {})
      }
    })
    const fetched = Array.isArray(result?.models) ? result.models : []
    channelForm.models = fetched.join(', ')
    showToast(`已成功获取 ${fetched.length} 个可用模型`)
  } catch (err) {
    console.error(err)
  } finally {
    isFetchingModels.value = false
  }
}

async function saveChannel() {
  if (!channelForm.id.trim() || !channelForm.name.trim()) {
    showToast('请输入渠道 ID 和名称', 'warning')
    return
  }

  loading.value = true
  const models = channelForm.models.split(',').map(s => s.trim()).filter(Boolean)
  const existing = channelForm.isEdit ? channels.value.find(c => c.id === channelForm.id) : null
  
  const options = {
    ...(existing?.options || {}),
    apiKey: channelForm.apiKey,
    baseUrl: channelForm.baseUrl
  }

  if (isChannelFormGemini.value) {
    options.safetyLevel = channelForm.safetyLevel
  } else {
    delete options.safetyLevel
  }

  if (channelForm.adapterType === 'antigravity') {
    options.providerType = 'antigravity'
    options.protocol = channelForm.protocol
  } else {
    delete options.providerType
    delete options.protocol
  }

  const payload = {
    id: channelForm.id.trim(),
    name: channelForm.name.trim(),
    adapterType: channelForm.adapterType === 'antigravity' 
      ? (channelForm.protocol === 'openai' ? 'openai' : 'gemini') 
      : channelForm.adapterType,
    models,
    options,
    status: existing?.status || 'enabled'
  }

  try {
    if (channelForm.isEdit) {
      await api.put(`/channels/${channelForm.id}`, payload)
    } else {
      await api.post('/channels', payload)
    }
    showToast('渠道保存成功')
    channelModalVisible.value = false
    await syncChannels()
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function deleteChannel(ch) {
  if (!confirm(`确认要删除适配器渠道 "${ch.name} (${ch.id})"?`)) return
  loading.value = true
  try {
    await api.delete(`/channels/${ch.id}`)
    showToast('渠道已成功删除')
    await syncChannels()
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

// --- Tab: Presets ---
async function syncPresets() {
  const [presetsRes, channelsRes] = await Promise.all([
    api.get('/presets'),
    api.get('/channels')
  ])
  presets.value = presetsRes
  channels.value = channelsRes
}

async function togglePresetStatus(p) {
  loading.value = true
  const updatedStatus = p.status === 'enabled' ? 'disabled' : 'enabled'
  try {
    await api.put(`/presets/${p.id}`, { ...p, status: updatedStatus })
    showToast('预设状态已更新')
    await syncPresets()
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

function openAddPreset() {
  presetFormTitle.value = '创建预设角色'
  presetForm.id = ''
  presetForm.name = ''
  presetForm.channelId = channels.value[0]?.id || ''
  presetForm.model = ''
  presetForm.prompt = ''
  presetForm.temperature = 0.9
  presetForm.maxTokens = 2048
  presetForm.topP = ''
  presetForm.enableReasoning = true
  presetForm.thinkingLevel = 'LOW'
  presetForm.isEdit = false
  presetModalVisible.value = true
}

function openEditPreset(p) {
  presetFormTitle.value = '系统设置与提示词'
  presetForm.id = p.id
  presetForm.name = p.name || ''
  presetForm.channelId = p.channelId || ''
  presetForm.model = p.sendMessageOption?.model || ''
  presetForm.prompt = p.systemPrompt?.content || ''
  presetForm.temperature = p.sendMessageOption?.temperature ?? 0.9
  presetForm.maxTokens = p.sendMessageOption?.maxTokens ?? 2048
  presetForm.topP = p.sendMessageOption?.topP ?? ''
  presetForm.enableReasoning = p.sendMessageOption?.enableReasoning !== false
  presetForm.thinkingLevel = p.sendMessageOption?.thinkingLevel || 'LOW'
  presetForm.isEdit = true
  presetModalVisible.value = true
}

async function savePreset() {
  if (!presetForm.id.trim() || !presetForm.name.trim()) {
    showToast('请输入预设 ID 和名称', 'warning')
    return
  }

  loading.value = true
  const existing = presetForm.isEdit ? presets.value.find(p => p.id === presetForm.id) : null
  const topPNum = presetForm.topP !== '' ? Number(presetForm.topP) : undefined

  const payload = {
    id: presetForm.id.trim(),
    name: presetForm.name.trim(),
    channelId: presetForm.channelId,
    sendMessageOption: {
      model: presetForm.model.trim(),
      temperature: Number(presetForm.temperature),
      maxTokens: Number(presetForm.maxTokens),
      enableReasoning: presetForm.enableReasoning,
      thinkingLevel: presetForm.thinkingLevel,
      ...(topPNum !== undefined && !Number.isNaN(topPNum) ? { topP: topPNum } : {})
    },
    systemPrompt: {
      content: presetForm.prompt
    },
    status: existing?.status || 'enabled'
  }

  try {
    if (presetForm.isEdit) {
      await api.put(`/presets/${presetForm.id}`, payload)
    } else {
      await api.post('/presets', payload)
    }
    showToast('预设角色保存成功')
    presetModalVisible.value = false
    await syncPresets()
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function deletePreset(p) {
  if (!confirm(`确认要删除角色预设 "${p.name} (${p.id})"?`)) return
  loading.value = true
  try {
    await api.delete(`/presets/${p.id}`)
    showToast('预设角色已成功删除')
    await syncPresets()
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

// --- Tab: Tools ---
async function syncTools() {
  tools.value = await api.get('/tools')
}

async function toggleToolStatus(t) {
  loading.value = true
  try {
    await api.post(`/tools/${encodeURIComponent(t.name)}/toggle`)
    showToast('扩展工具状态已更新')
    await syncTools()
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

async function reloadTools() {
  loading.value = true
  try {
    await api.post('/tools/reload')
    showToast('工具插件热重载完成')
    await syncTools()
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

function handleFileInputChange(e) {
  const file = e.target.files[0]
  if (!file) return
  if (!file.name.endsWith('.js')) {
    showToast('仅支持上传 .js 格式的扩展工具文件', 'warning')
    return
  }
  selectedToolFile.value = file
  toolFileInfo.name = file.name
  toolFileInfo.size = `${(file.size / 1024).toFixed(1)} KB`
}

function clearSelectedToolFile() {
  selectedToolFile.value = null
  toolFileInfo.name = ''
  toolFileInfo.size = ''
}

async function submitToolUpload() {
  if (!selectedToolFile.value) return
  loading.value = true
  const form = new FormData()
  form.append('tool', selectedToolFile.value)
  try {
    await api.post('/tools/upload', form)
    showToast('自定义工具导入成功')
    toolModalVisible.value = false
    clearSelectedToolFile()
    await syncTools()
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

// --- Tab: Memory ---
async function syncMemory() {
  memory.value = await api.get('/memory/stats')
}

function copyMemoryDbPath() {
  if (!memory.value?.dbPath) return
  navigator.clipboard.writeText(memory.value.dbPath)
    .then(() => showToast('物理路径已复制'))
    .catch(() => showToast('复制失败，请手动选择复制', 'warning'))
}

// --- Tab: Config ---
async function syncConfig() {
  const configRes = await api.get('/config')
  rawConfig.value = configRes
  
  // Clone structure to localConfig
  localConfig.value = JSON.parse(JSON.stringify(configRes))
  
  // Ensure array elements are joined into string for textarea editing
  const arrayFields = [
    ['loli', 'triggerPrefix'],
    ['loli', 'triggerKeywords'],
    ['loli', 'groups'],
    ['loli', 'blackGroups'],
    ['loli', 'blackUsers'],
    ['memory', 'group', 'enabledGroups']
  ]
  arrayFields.forEach(keys => {
    let target = localConfig.value
    for (let i = 0; i < keys.length - 1; i++) {
      if (!target) return
      target = target[keys[i]]
    }
    const lastKey = keys[keys.length - 1]
    if (target && Array.isArray(target[lastKey])) {
      target[lastKey] = target[lastKey].join('\n')
    }
  })

  // Ensure default structures exist
  if (!localConfig.value.loli.masterIdentity) {
    localConfig.value.loli.masterIdentity = { enable: true, autoDetect: true, appellation: '', users: [], userIds: [] }
  }
  if (!localConfig.value.stickers) {
    localConfig.value.stickers = { enable: true, autoCollectMaster: true, autoClassify: true, probability: 35, cooldownMs: 60 }
  } else {
    // Convert probability from decimal to percentage (e.g. 0.75 -> 75)
    if (localConfig.value.stickers.probability !== undefined) {
      localConfig.value.stickers.probability = Math.round(Number(localConfig.value.stickers.probability) * 100)
    }
    // Convert cooldownMs from milliseconds to seconds (e.g. 60000 -> 60)
    if (localConfig.value.stickers.cooldownMs !== undefined) {
      localConfig.value.stickers.cooldownMs = Math.round(Number(localConfig.value.stickers.cooldownMs) / 1000)
    }
  }
}

const masterIdentitiesList = computed(() => {
  if (!localConfig.value?.loli?.masterIdentity) return ''
  const masterIdentity = localConfig.value.loli.masterIdentity || {}
  const masterUsers = Array.isArray(masterIdentity.users) ? masterIdentity.users : []
  const masterNames = new Map(masterUsers.map(user => [String(user.userId), user.nickname || '']))
  return (masterIdentity.userIds || [])
    .map(userId => `${userId}${masterNames.get(String(userId)) ? ` · ${masterNames.get(String(userId))}` : ' · 待获取昵称'}`)
    .join('\n')
})

async function saveConfig() {
  if (!localConfig.value) return
  loading.value = true

  const payload = JSON.parse(JSON.stringify(localConfig.value))

  // Sanitize strings back to arrays
  const sanitizeTextToArray = (text) => {
    if (typeof text === 'string') {
      return text.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
    }
    return Array.isArray(text) ? text : []
  }

  payload.loli.triggerPrefix = sanitizeTextToArray(localConfig.value.loli.triggerPrefix)
  payload.loli.triggerKeywords = sanitizeTextToArray(localConfig.value.loli.triggerKeywords)
  payload.loli.groups = sanitizeTextToArray(localConfig.value.loli.groups)
  payload.loli.blackGroups = sanitizeTextToArray(localConfig.value.loli.blackGroups)
  payload.loli.blackUsers = sanitizeTextToArray(localConfig.value.loli.blackUsers)
  payload.memory.group.enabledGroups = sanitizeTextToArray(localConfig.value.memory.group.enabledGroups)

  // Double check numbers
  payload.loli.promptProbability = Number(localConfig.value.loli.promptProbability)
  payload.loli.contextLength = Number(localConfig.value.loli.contextLength) || 30
  payload.loli.sessionWindow = Number(localConfig.value.loli.sessionWindow) || 300000
  payload.loli.cooldownUser = Number(localConfig.value.loli.cooldownUser) || 3000
  payload.loli.cooldownGroup = Number(localConfig.value.loli.cooldownGroup) || 1000
  payload.loli.maxReplyBurst = Number(localConfig.value.loli.maxReplyBurst) || 0
  payload.loli.burstCooldown = Number(localConfig.value.loli.burstCooldown) || 180000
  payload.loli.recallDefault = Number(localConfig.value.loli.recallDefault) || 0
  
  payload.loli.segmentedReply.minLength = Number(localConfig.value.loli.segmentedReply.minLength)
  payload.loli.segmentedReply.maxLength = Number(localConfig.value.loli.segmentedReply.maxLength)
  payload.loli.segmentedReply.maxSegments = Number(localConfig.value.loli.segmentedReply.maxSegments)
  payload.loli.segmentedReply.delayMin = Number(localConfig.value.loli.segmentedReply.delayMin)
  payload.loli.segmentedReply.delayMax = Number(localConfig.value.loli.segmentedReply.delayMax)

  payload.loli.temperature = Number(localConfig.value.loli.temperature)
  payload.loli.maxTokens = Number(localConfig.value.loli.maxTokens)

  payload.loli.imageCompress.maxLongEdge = Number(localConfig.value.loli.imageCompress.maxLongEdge) || 1536
  payload.loli.imageCompress.quality = Number(localConfig.value.loli.imageCompress.quality) || 85
  payload.loli.imageCompress.maxFileSizeKB = Number(localConfig.value.loli.imageCompress.maxFileSizeKB) || 2048

  payload.loli.historyImages.maxImages = Number(localConfig.value.loli.historyImages.maxImages) || 5
  payload.loli.historyImages.maxAgeSeconds = Number(localConfig.value.loli.historyImages.maxAgeSeconds) || 300
  payload.loli.historyImages.contextLength = Number(localConfig.value.loli.historyImages.contextLength) || 30

  payload.memory.groupLearning.minMessages = Number(localConfig.value.memory.groupLearning.minMessages) || 100
  payload.memory.groupLearning.updateEveryMessages = Number(localConfig.value.memory.groupLearning.updateEveryMessages) || 50
  payload.memory.groupLearning.minActiveUsers = Number(localConfig.value.memory.groupLearning.minActiveUsers) || 5
  payload.memory.groupLearning.windowDays = Number(localConfig.value.memory.groupLearning.windowDays) || 14
  payload.memory.groupLearning.autoApplyMinConfidence = Number(localConfig.value.memory.groupLearning.autoApplyMinConfidence) || 0.72
  payload.memory.groupLearning.maxSamplesPerUser = Number(localConfig.value.memory.groupLearning.maxSamplesPerUser) || 30

  payload.memory.embedding.outputDimensionality = Number(localConfig.value.memory.embedding.outputDimensionality) || 768
  payload.memory.embedding.topK = Number(localConfig.value.memory.embedding.topK) || 8
  payload.memory.embedding.minScore = Number(localConfig.value.memory.embedding.minScore) || 0.2

  payload.stickers.probability = Math.max(0, Math.min(1, Number(localConfig.value.stickers.probability) / 100 || 0))
  payload.stickers.cooldownMs = Math.max(0, Number(localConfig.value.stickers.cooldownMs) * 1000 || 0)

  payload.dashboard.port = Number(localConfig.value.dashboard.port) || 3000

  try {
    await api.put('/config', payload)
    showToast('全局系统配置保存成功')
    await syncConfig()
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

// --- Tab: Logs ---
async function syncLogs(showSpinner = false) {
  if (showSpinner) loading.value = true
  try {
    const rawLogs = await api.get('/logs')
    logs.value = Array.isArray(rawLogs) ? rawLogs : []
    nextTick(() => {
      scrollToBottom()
    })
  } catch (err) {
    console.error(err)
  } finally {
    if (showSpinner) loading.value = false
  }
}

function startLogsPolling() {
  stopLogsPolling()
  logsIntervalId = setInterval(() => {
    if (logsAutoRefresh.value && activeTab.value === 'logs') {
      syncLogs(false)
    }
  }, 3000)
}

function stopLogsPolling() {
  if (logsIntervalId) {
    clearInterval(logsIntervalId)
    logsIntervalId = null
  }
}

function scrollToBottom() {
  const container = terminalLogsRef.value
  if (container && logsAutoRefresh.value) {
    container.scrollTop = container.scrollHeight
  }
}

async function handleClearLogs() {
  loading.value = true
  try {
    await api.post('/logs/clear')
    logs.value = []
    showToast('日志已清空')
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}

function handleCopyLogs() {
  const text = filteredLogs.value.map(l => `[${l.timestamp}] [${l.level}] ${l.message}`).join('\n')
  navigator.clipboard.writeText(text)
    .then(() => showToast('日志已复制到剪贴板'))
    .catch(() => showToast('复制失败，请手动选择复制', 'warning'))
}

const filteredLogs = computed(() => {
  return logs.value.filter(log => {
    const matchLevel = logsLevelFilter.value === 'ALL' || log.level === logsLevelFilter.value
    const matchKeyword = !logsSearchQuery.value.trim() || 
      log.message.toLowerCase().includes(logsSearchQuery.value.trim().toLowerCase())
    return matchLevel && matchKeyword
  })
})

function getLogLevelClass(level) {
  const map = {
    DEBUG: 'text-[#8e9099]',
    INFO: 'text-slate-300',
    WARN: 'text-[#fdd663]',
    ERROR: 'text-[#f28b82] font-bold'
  }
  return map[level] || 'text-slate-300'
}

function getLogLevelTagClass(level) {
  const map = {
    DEBUG: 'bg-[#2c2e35] text-[#cbd5e1] border-[#2c2e35]',
    INFO: 'bg-[#a8c7fa]/10 text-[#a8c7fa] border-[#a8c7fa]/20',
    WARN: 'bg-[#fdd663]/10 text-[#fdd663] border-[#fdd663]/20',
    ERROR: 'bg-[#f28b82]/10 text-[#f28b82] border-[#f28b82]/20'
  }
  return map[level] || 'bg-[#2c2e35] text-[#cbd5e1] border-[#2c2e35]'
}

// Watch Active Tab changes
watch(activeTab, (newTab) => {
  loadTabData(newTab)
  if (newTab === 'logs') {
    startLogsPolling()
  } else {
    stopLogsPolling()
  }
  // Update browser hash
  window.location.hash = newTab
})

// Handle hash navigation
function handleHashChange() {
  const hash = window.location.hash.replace('#', '')
  if (PAGE_ORDER.includes(hash)) {
    activeTab.value = hash
  }
}

// --- Lifecycle ---
onMounted(() => {
  fetchHealth()
  window.addEventListener('hashchange', handleHashChange)
  
  // Custom global API interceptor listeners
  window.addEventListener('loli-unauthorized', () => {
    authorized.value = false
  })
  window.addEventListener('loli-error-toast', (e) => {
    showToast(e.detail, 'error')
  })

  // Set initial tab from hash
  const initialHash = window.location.hash.replace('#', '')
  if (PAGE_ORDER.includes(initialHash)) {
    activeTab.value = initialHash
  }
})

onUnmounted(() => {
  window.removeEventListener('hashchange', handleHashChange)
  stopLogsPolling()
})
</script>

<template>
  <div class="app">
    <!-- Background overlay grid (removed for AI Studio style) -->
    <!-- Sidebar Navigation -->
    <aside class="sidebar" :class="{ 'collapsed': isSidebarCollapsed, 'open': isMobileMenuOpen }">
      <div class="sidebar-header">
        <div class="logo">
          <div class="logo-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 100 100">
              <defs>
                <linearGradient id="logoPrimary" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#a8c7fa"/>
                  <stop offset="100%" stop-color="#7da0db"/>
                </linearGradient>
                <linearGradient id="logoGlass" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#ffffff" stop-opacity="0.5"/>
                  <stop offset="100%" stop-color="#ffffff" stop-opacity="0.1"/>
                </linearGradient>
              </defs>
              <rect x="20" y="20" width="20" height="60" rx="8" fill="url(#logoGlass)" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
              <rect x="60" y="20" width="20" height="60" rx="8" fill="url(#logoPrimary)"/>
              <path d="M 30 42 Q 50 32 70 42 L 70 58 Q 50 48 30 58 Z" fill="url(#logoPrimary)" opacity="0.8"/>
              <circle cx="50" cy="50" r="4.5" fill="#ffffff"/>
            </svg>
          </div>
          <div class="logo-text-wrapper" v-if="!isSidebarCollapsed">
            <span class="logo-text">Hina AI Studio</span>
            <span class="logo-subtext">WORKSPACE // DEV</span>
          </div>
        </div>
        <button class="sidebar-close-btn" @click="isMobileMenuOpen = false">×</button>
      </div>

      <nav class="nav">
        <a 
          v-for="page in PAGE_ORDER" 
          :key="page"
          :href="'#' + page" 
          class="nav-item" 
          :class="{ active: activeTab === page }"
          @click="isMobileMenuOpen = false"
        >
          <span class="nav-icon-wrapper">
            <!-- Icon switches -->
            <svg v-if="page === 'overview'" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/></svg>
            <svg v-else-if="page === 'channels'" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <svg v-else-if="page === 'presets'" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/></svg>
            <svg v-else-if="page === 'tools'" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/></svg>
            <svg v-else-if="page === 'memory'" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
            <svg v-else-if="page === 'config'" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <svg v-else-if="page === 'logs'" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
          </span>
          <span class="nav-label" v-if="!isSidebarCollapsed">{{ PAGE_TITLES[page].replace('// ', '') }}</span>
        </a>
      </nav>

      <div class="sidebar-footer">
        <button class="sidebar-collapse-trigger" @click="isSidebarCollapsed = !isSidebarCollapsed" :title="isSidebarCollapsed ? '展开导航栏' : '折叠导航栏'">
          <svg v-if="!isSidebarCollapsed" class="collapse-icon-left" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
          <svg v-else class="collapse-icon-right" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6 6-6"/></svg>
          <span class="collapse-label" v-if="!isSidebarCollapsed">折叠导航栏</span>
        </button>

        <div class="footer-version-row" v-if="!isSidebarCollapsed">
          <span class="version-label">v<span>1.2.0</span></span>
          <button class="btn btn-logout-icon" @click="logout" title="退出登录" v-if="authRequired">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
            <span class="logout-text">退出</span>
          </button>
        </div>
      </div>
    </aside>

    <!-- Main Content wrapper -->
    <div class="main">
      <header class="header">
        <div class="header-left">
          <button class="menu-toggle" @click="isMobileMenuOpen = true" aria-label="Open menu">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
          </button>
          <h1 class="page-title">{{ PAGE_TITLES[activeTab] }}</h1>
        </div>
        <div class="header-right">
          <div class="global-spinner" :class="{ hidden: !loading }"></div>
        </div>
      </header>

      <!-- Viewport pages content -->
      <div class="content-scroller">
        <div class="pages-wrapper">
          
          <!-- Pane 1: Overview -->
          <div class="page-pane" v-show="activeTab === 'overview'">
            <div class="pane-content select-text">
              <div class="card-grid">
                <div class="card">
                  <span class="card-title">系统状态</span>
                  <div class="card-value-row">
                    <span class="card-value">{{ system?.status === 'ok' ? '正常运行' : '运行异常' }}</span>
                    <span class="badge" :class="system?.status === 'ok' ? 'badge-success' : 'badge-danger'">{{ system?.status === 'ok' ? 'OK' : 'ERR' }}</span>
                  </div>
                  <p class="card-subtitle">{{ system?.message || '系统正常运行中' }}</p>
                </div>
                <div class="card">
                  <span class="card-title">可用渠道</span>
                  <div class="card-value-row">
                    <span class="card-value">{{ overviewActiveChannels }}</span>
                    <span class="card-note">共 {{ channels.length }} 个</span>
                  </div>
                  <span class="card-subtitle">支持多适配器热切换</span>
                </div>
                <div class="card">
                  <span class="card-title">可用插件</span>
                  <div class="card-value-row">
                    <span class="card-value">{{ overviewActiveTools }}</span>
                    <span class="card-note">共 {{ tools.length }} 个</span>
                  </div>
                  <span class="card-subtitle">支持热重载与文件上传</span>
                </div>
                <div class="card">
                  <span class="card-title">运行时长</span>
                  <div class="card-value-row">
                    <span class="card-value font-mono">{{ system?.uptime || '0s' }}</span>
                    <span class="card-tag uppercase">UPTIME</span>
                  </div>
                  <span class="card-subtitle">自服务最后一次启动</span>
                </div>
              </div>

              <!-- Quick Actions -->
              <div class="card mt-4">
                <span class="card-section-title">// 快捷导航</span>
                <div class="flex-row gap-2.5 mt-2 flex-wrap">
                  <button class="btn btn-primary" @click="loadTabData('overview')">
                    <svg class="mr-1.5 inline" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M16 3h5v5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 21H3v-5"/></svg>
                    同步数据
                  </button>
                  <button class="btn btn-secondary" @click="activeTab = 'channels'">
                    <svg class="mr-1.5 inline" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" x2="20" y1="21" y2="21"/><line x1="4" x2="20" y1="3" y2="3"/><line x1="12" x2="20" y1="12" y2="12"/><line x1="4" x2="8" y1="12" y2="12"/></svg>
                    管理渠道
                  </button>
                  <button class="btn btn-secondary" @click="activeTab = 'tools'">
                    <svg class="mr-1.5 inline" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/></svg>
                    管理工具
                  </button>
                  <button class="btn btn-secondary" @click="activeTab = 'memory'">
                    <svg class="mr-1.5 inline" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
                    系统数据
                  </button>
                </div>
              </div>

              <!-- Details Table -->
              <div class="card mt-4">
                <div class="flex-row justify-between items-center pb-2 border-b border-[#2c2e35] mb-2">
                  <span class="text-sm font-semibold text-slate-200">// 控制台运行参数明细</span>
                  <span class="badge badge-success font-mono uppercase">Online</span>
                </div>
                <div class="table-container">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>项目指标</th>
                        <th>运行明细</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="item in overviewDetails" :key="item.key">
                        <td class="font-bold text-[#e3e2e6]">{{ item.key }}</td>
                        <td class="font-mono text-slate-400">{{ item.val }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <!-- Pane 2: Channels -->
          <div class="page-pane" v-show="activeTab === 'channels'">
            <div class="pane-content select-text">
              <div class="flex-row justify-between items-center mb-4">
                <h2 class="text-lg font-bold text-white">// AI 渠道管理</h2>
                <button class="btn btn-primary" @click="openAddChannel">
                  <svg class="mr-1.5 inline" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
                  添加新渠道
                </button>
              </div>

              <div class="card">
                <div class="table-container">
                  <table class="data-table channel-table">
                    <thead>
                      <tr>
                        <th>名称 / ID</th>
                        <th>适配器</th>
                        <th>支持模型</th>
                        <th>状态</th>
                        <th class="text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-if="channels.length === 0">
                        <td colspan="5" class="empty-cell">暂无已配置的适配器渠道</td>
                      </tr>
                      <tr v-for="ch in channels" :key="ch.id" class="hover-row">
                        <td>
                          <div class="flex-column">
                            <span class="text-sm font-bold text-[#e3e2e6]">{{ ch.name }}</span>
                            <span class="text-[10px] font-mono text-[#8e9099] mt-0.5">{{ ch.id }}</span>
                          </div>
                        </td>
                        <td>
                          <div class="flex-column gap-1 items-start">
                            <span class="font-mono text-xs uppercase bg-[#2c2e35] px-1.5 py-0.5 rounded text-[#cbd5e1] border border-[#2c2e35]">{{ formatChannelAdapter(ch) }}</span>
                            <span v-if="ch.adapterType === 'gemini'" class="text-[10px] text-[#8e9099]">安全：{{ formatGeminiSafetyLevel(ch.options?.safetyLevel) }}</span>
                          </div>
                        </td>
                        <td>
                          <div class="channel-model-summary" :aria-label="'共 ' + (ch.models || []).length + ' 个模型'">
                            <div class="channel-model-tags">
                              <span v-for="model in (ch.models || []).slice(0, 2)" :key="model" class="channel-model-tag" :title="model">{{ model }}</span>
                              <span v-if="(ch.models || []).length > 2" class="channel-model-more">+{{ (ch.models || []).length - 2 }}</span>
                            </div>
                            <span class="channel-model-count">共 {{ (ch.models || []).length }} 个</span>
                          </div>
                        </td>
                        <td>
                          <span class="badge" :class="ch.status === 'enabled' ? 'badge-success' : 'badge-gray'">{{ ch.status === 'enabled' ? '已启用' : '已禁用' }}</span>
                        </td>
                        <td>
                          <div class="flex-row justify-end gap-2">
                            <button class="btn btn-secondary py-1 px-2 text-[11px]" @click="openEditChannel(ch)">编辑</button>
                            <button class="btn py-1 px-2 text-[11px]" :class="ch.status === 'enabled' ? 'btn-danger' : 'btn-success'" @click="toggleChannelStatus(ch)">
                              {{ ch.status === 'enabled' ? '禁用' : '启用' }}
                            </button>
                            <button class="btn btn-danger py-1 px-2 text-[11px] opacity-70 hover:opacity-100" @click="deleteChannel(ch)">删除</button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <!-- Pane 3: Presets -->
          <div class="page-pane" v-show="activeTab === 'presets'">
            <div class="pane-content select-text">
              <div class="flex-row justify-between items-center mb-4">
                <h2 class="text-lg font-bold text-white">// 预设角色管理</h2>
                <button class="btn btn-primary" @click="openAddPreset">
                  <svg class="mr-1.5 inline" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
                  新建预设
                </button>
              </div>

              <div class="card-grid">
                <div v-if="presets.length === 0" class="col-span-full py-12 text-center text-slate-500 text-sm font-semibold">暂无已配置的角色预设</div>
                <div v-for="p in presets" :key="p.id" class="card flex-column justify-between hover-border">
                  <div class="flex-row justify-between items-start mb-3">
                    <div>
                      <h3 class="text-sm font-bold text-[#e3e2e6]">{{ p.name }}</h3>
                      <p class="text-[10px] font-mono text-[#8e9099] mt-0.5">ID: {{ p.id }}</p>
                    </div>
                    <span class="badge" :class="p.status === 'enabled' ? 'badge-success' : 'badge-gray'">{{ p.status === 'enabled' ? '已启用' : '已禁用' }}</span>
                  </div>

                  <div class="flex-column gap-1.5 text-xs mb-4">
                    <div class="flex-row justify-between items-center">
                      <span class="text-[#8e9099] scale-95 origin-left">绑定渠道：</span>
                      <span class="bg-[#2c2e35] text-[#c7c6ca] text-[9px] font-mono px-1.5 py-0.2 rounded">{{ p.channelId }}</span>
                    </div>
                    <div class="flex-row justify-between items-center">
                      <span class="text-[#8e9099] scale-95 origin-left">执行模型：</span>
                      <span class="font-mono text-slate-300 truncate max-w-[130px] inline-block" :title="p.sendMessageOption?.model">{{ p.sendMessageOption?.model || '-' }}</span>
                    </div>
                    <div class="flex-row justify-between items-center">
                      <span class="text-[#8e9099] scale-95 origin-left">推理细节：</span>
                      <span class="font-mono text-slate-300">{{ p.sendMessageOption?.thinkingLevel || 'LOW' }} {{ p.sendMessageOption?.enableReasoning !== false ? '(COT)' : '(OFF)' }}</span>
                    </div>
                  </div>

                  <div class="flex-row justify-end gap-2 pt-3 border-t border-[#2c2e35]/50 mt-auto">
                    <button class="btn btn-secondary py-1 px-2.5 text-xs" @click="openEditPreset(p)">配置参数</button>
                    <button class="btn py-1 px-2.5 text-xs" :class="p.status === 'enabled' ? 'btn-danger' : 'btn-success'" @click="togglePresetStatus(p)">
                      {{ p.status === 'enabled' ? '禁用' : '启用' }}
                    </button>
                    <button class="btn btn-danger py-1 px-2.5 text-xs opacity-75 hover:opacity-100" @click="deletePreset(p)">删除</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Pane 4: Tools -->
          <div class="page-pane" v-show="activeTab === 'tools'">
            <div class="pane-content select-text">
              <div class="flex-row justify-between items-center mb-4">
                <h2 class="text-lg font-bold text-white">// 工具扩展插件</h2>
                <div class="flex-row gap-2">
                  <button class="btn btn-secondary" @click="reloadTools">
                    <svg class="mr-1.5 inline" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M16 3h5v5"/></svg>
                    重新加载
                  </button>
                  <button class="btn btn-primary" @click="toolModalVisible = true">
                    <svg class="mr-1.5 inline" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                    导入插件
                  </button>
                </div>
              </div>

              <div class="flex-column gap-3">
                <div v-if="tools.length === 0" class="py-12 text-center text-slate-500 text-sm font-semibold">暂无已加载的扩展工具插件</div>
                <div v-for="t in tools" :key="t.name" class="tool-tile-card flex-row items-center justify-between gap-4">
                  <div class="flex-row items-center gap-3.5 flex-1 min-w-0">
                    <!-- Leading Icon -->
                    <div class="tool-tile-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/></svg>
                    </div>
                    <!-- Title & Subtitle Info -->
                    <div class="flex-column flex-1 min-w-0">
                      <div class="flex-row items-center gap-2">
                        <h3 class="text-sm font-bold text-[#e3e2e6] truncate" :title="t.toolName || t.name">{{ t.toolName || t.name }}</h3>
                        <span class="text-[10px] font-mono text-[#8e9099] truncate">({{ t.name }}.js)</span>
                      </div>
                      <p class="text-xs text-[#8e9099] leading-relaxed mt-0.5 truncate" :title="t.description">{{ t.description || '暂无关于此扩展工具的描述说明。' }}</p>
                      <p class="text-[9px] font-mono text-[#666a73] mt-0.5 truncate" :title="t.path">物理文件: {{ getToolFileName(t.path) }}</p>
                    </div>
                  </div>
                  <!-- Trailing Toggle Switch -->
                  <div class="flex-row items-center gap-3">
                    <span class="badge" :class="t.enabled ? 'badge-success' : 'badge-gray'">{{ t.enabled ? '已启用' : '已停用' }}</span>
                    <button class="switch" :class="{ active: t.enabled }" @click="toggleToolStatus(t)">
                      <span></span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Pane 5: Memory -->
          <div class="page-pane" v-show="activeTab === 'memory'">
            <div class="pane-content select-text" v-if="memory">
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div class="card">
                  <span class="card-title">消息索引数</span>
                  <div class="card-value-row">
                    <span class="card-value">{{ memory.messages || 0 }}</span>
                    <span class="text-xs text-[#8e9099] font-semibold">条对话</span>
                  </div>
                  <span class="card-subtitle">已持久化索引的上下文消息</span>
                </div>
                <div class="card">
                  <span class="card-title">摘要与画像</span>
                  <div class="card-value-row">
                    <span class="card-value">{{ (memory.summaries || 0) + (memory.profiles || 0) + (memory.identities || 0) }}</span>
                    <span class="text-xs text-[#8e9099] font-semibold">个维度</span>
                  </div>
                  <span class="card-subtitle">包含 {{ memory.summaries || 0 }} 条群摘要 & {{ memory.profiles || 0 }} 个用户特征</span>
                </div>
                <div class="card">
                  <span class="card-title">向量检索数</span>
                  <div class="card-value-row">
                    <span class="card-value">{{ memory.embeddings || 0 }}</span>
                    <span class="text-xs text-[#8e9099] font-semibold">个向量</span>
                  </div>
                  <span class="card-subtitle">已存储的多维语义特征向量</span>
                </div>
              </div>

              <!-- Memory breakdown -->
              <div class="card">
                <span class="card-section-title mb-6 block">// 记忆库细分构成</span>
                <div class="flex-column gap-5">
                  <div class="progress-item">
                    <div class="flex-row justify-between text-xs mb-1">
                      <span class="text-slate-300 font-medium">群组摘要 (Active Summaries)</span>
                      <span class="badge">{{ memory.summaries || 0 }} 条</span>
                    </div>
                    <div class="progress-bar-track">
                      <div class="progress-bar bg-blue" :style="{ width: Math.min(100, ((memory.summaries || 0) / Math.max(1, memory.messages)) * 100) + '%' }"></div>
                    </div>
                  </div>
                  <div class="progress-item">
                    <div class="flex-row justify-between text-xs mb-1">
                      <span class="text-slate-300 font-medium">群友身份账本 (QQ Identities)</span>
                      <span class="badge">{{ memory.identities || 0 }} 人</span>
                    </div>
                    <div class="progress-bar-track">
                      <div class="progress-bar bg-orange" :style="{ width: Math.min(100, ((memory.identities || 0) / Math.max(1, memory.messages)) * 100) + '%' }"></div>
                    </div>
                  </div>
                  <div class="progress-item">
                    <div class="flex-row justify-between text-xs mb-1">
                      <span class="text-slate-300 font-medium">成员画像 (User Profiles)</span>
                      <span class="badge">{{ memory.profiles || 0 }} 个</span>
                    </div>
                    <div class="progress-bar-track">
                      <div class="progress-bar bg-gray" :style="{ width: Math.min(100, ((memory.profiles || 0) / Math.max(1, memory.embeddings || 1)) * 100) + '%' }"></div>
                    </div>
                  </div>
                  <div class="progress-item">
                    <div class="flex-row justify-between text-xs mb-1">
                      <span class="text-slate-300 font-medium">向量索引块 (Memory Chunks)</span>
                      <span class="badge">{{ memory.chunks || 0 }} 块</span>
                    </div>
                    <div class="progress-bar-track">
                      <div class="progress-bar bg-green" :style="{ width: Math.min(100, ((memory.chunks || 0) / Math.max(1, memory.embeddings || 1)) * 100) + '%' }"></div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- DB Path -->
              <div class="card mt-4">
                <span class="card-section-title block mb-2">// SQLite 数据库文件物理地址</span>
                <div class="flex-row gap-3 items-center bg-black/30 border border-[#2c2e35] rounded-lg p-3">
                  <span class="flex-1 font-mono text-xs text-slate-300 break-all select-all">{{ memory.dbPath || '未检测到 SQLite 数据库物理路径' }}</span>
                  <button class="btn-copy" @click="copyMemoryDbPath" title="复制路径">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Pane 6: Config -->
          <div class="page-pane" v-show="activeTab === 'config'">
            <div class="pane-content select-text" v-if="localConfig">
              <div class="flex-row justify-between items-center mb-4">
                <h2 class="text-lg font-bold text-white">// 系统参数配置</h2>
                <button class="btn btn-primary" @click="saveConfig">
                  <svg class="mr-1.5 inline" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  保存全局配置
                </button>
              </div>

              <!-- Tabs selection inside config page -->
              <div class="config-tabs-nav">
                <button 
                  v-for="tab in CONFIG_TABS" 
                  :key="tab.id"
                  class="config-tab-btn" 
                  :class="{ active: activeConfigTab === tab.id }"
                  @click="activeConfigTab = tab.id"
                >
                  {{ tab.label }}
                </button>
              </div>

              <!-- Config Sheets wrapper -->
              <div class="config-sheets-container mt-4">
                
                <!-- Sheet 1: Trigger -->
                <div class="config-sheet" :class="{ active: activeConfigTab === 'trigger' }">
                  <div class="grid grid-cols-1 lg:grid-cols-5 gap-4">
                    <div class="lg:col-span-3 flex-column gap-4">
                      <div class="card">
                        <span class="card-section-title mb-3 block">// 关键词与触发前缀 (换行分隔)</span>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div class="flex-column gap-1.5">
                            <label class="text-xs text-[#8e9099]">前缀触发词</label>
                            <textarea v-model="localConfig.loli.triggerPrefix" rows="5" class="form-textarea font-mono"></textarea>
                          </div>
                          <div class="flex-column gap-1.5">
                            <label class="text-xs text-[#8e9099]">响应关键词</label>
                            <textarea v-model="localConfig.loli.triggerKeywords" rows="5" class="form-textarea font-mono"></textarea>
                          </div>
                        </div>
                      </div>
                      <div class="card">
                        <span class="card-section-title mb-3 block">// 响应范围名单 (黑白名单, 换行分隔)</span>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div class="flex-column gap-1.5">
                            <label class="text-xs text-[#8e9099]">群白名单 (留空为全部)</label>
                            <textarea v-model="localConfig.loli.groups" rows="5" class="form-textarea font-mono"></textarea>
                          </div>
                          <div class="flex-column gap-1.5">
                            <label class="text-xs text-[#8e9099]">群黑名单</label>
                            <textarea v-model="localConfig.loli.blackGroups" rows="5" class="form-textarea font-mono"></textarea>
                          </div>
                          <div class="flex-column gap-1.5">
                            <label class="text-xs text-[#8e9099]">用户黑名单</label>
                            <textarea v-model="localConfig.loli.blackUsers" rows="5" class="form-textarea font-mono"></textarea>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div class="lg:col-span-2 flex-column gap-4">
                      <div class="card">
                        <span class="card-section-title mb-3 block">// 触发条件开关</span>
                        <div class="flex-column gap-3">
                          <div class="toggle-switch-row">
                            <span class="text-xs font-medium text-slate-300">伪人模式总开关</span>
                            <button class="switch" :class="{ active: localConfig.loli.enable }" @click="localConfig.loli.enable = !localConfig.loli.enable"><span></span></button>
                          </div>
                          <div class="toggle-switch-row">
                            <span class="text-xs font-medium text-slate-300">@ 提到与私聊触发</span>
                            <button class="switch" :class="{ active: localConfig.loli.enableAtTrigger }" @click="localConfig.loli.enableAtTrigger = !localConfig.loli.enableAtTrigger"><span></span></button>
                          </div>
                          <div class="toggle-switch-row">
                            <span class="text-xs font-medium text-slate-300">特定前缀词触发</span>
                            <button class="switch" :class="{ active: localConfig.loli.enablePrefixTrigger }" @click="localConfig.loli.enablePrefixTrigger = !localConfig.loli.enablePrefixTrigger"><span></span></button>
                          </div>
                          <div class="toggle-switch-row">
                            <span class="text-xs font-medium text-slate-300">消息包含关键词触发</span>
                            <button class="switch" :class="{ active: localConfig.loli.enableKeywordTrigger }" @click="localConfig.loli.enableKeywordTrigger = !localConfig.loli.enableKeywordTrigger"><span></span></button>
                          </div>
                          <div class="toggle-switch-row">
                            <span class="text-xs font-medium text-slate-300">群员闲聊主动触发</span>
                            <button class="switch" :class="{ active: localConfig.loli.enableProactiveTrigger }" @click="localConfig.loli.enableProactiveTrigger = !localConfig.loli.enableProactiveTrigger"><span></span></button>
                          </div>
                        </div>
                      </div>

                      <div class="card">
                        <span class="card-section-title mb-3 block">// 默认触发参数</span>
                        <div class="flex-column gap-4">
                          <div class="flex-column gap-1">
                            <label class="text-xs text-[#8e9099]">默认绑定预设 ID</label>
                            <input v-model="localConfig.loli.defaultPreset" type="text" class="form-input">
                          </div>
                          <div class="flex-column gap-3 border border-[#2c2e35] rounded-lg p-3">
                            <div class="toggle-switch-row">
                              <div>
                                <span class="text-xs font-medium text-slate-300">主人识别与特别称呼</span>
                                <p class="text-[10px] text-[#666a73] mt-1">自动读取云崽主人 QQ；主人发言后自动补全 QQ 昵称。</p>
                              </div>
                              <button class="switch" :class="{ active: localConfig.loli.masterIdentity.enable !== false }" @click="localConfig.loli.masterIdentity.enable = !localConfig.loli.masterIdentity.enable; localConfig.loli.masterIdentity.autoDetect = localConfig.loli.masterIdentity.enable"><span></span></button>
                            </div>
                            <div class="flex-column gap-1">
                              <label class="text-xs text-[#8e9099]">已识别主人（QQ · QQ昵称）</label>
                              <textarea :value="masterIdentitiesList" rows="3" class="form-textarea font-mono" readonly placeholder="开启后自动获取"></textarea>
                            </div>
                            <div class="flex-column gap-1">
                              <label class="text-xs text-[#8e9099]">特别称呼（可选）</label>
                              <input v-model="localConfig.loli.masterIdentity.appellation" type="text" class="form-input" placeholder="例如：老师；留空使用昵称或人设默认称呼">
                            </div>
                          </div>
                          <div class="flex-column gap-1">
                            <div class="flex-row justify-between text-xs">
                              <span class="text-[#8e9099]">主动回复概率</span>
                              <span class="font-bold text-[#a8c7fa] bg-[#a8c7fa]/10 px-1.5 py-0.2 rounded font-mono">{{ Number(localConfig.loli.promptProbability || 0).toFixed(2) }}</span>
                            </div>
                            <input v-model="localConfig.loli.promptProbability" type="range" min="0.0" max="1.0" step="0.01" class="ai-range-slider mt-2">
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Sheet 2: Session -->
                <div class="config-sheet" :class="{ active: activeConfigTab === 'session' }">
                  <div class="card">
                    <span class="card-section-title mb-3 block">// 会话上下文及冷却限制</span>
                    <div class="flex-column gap-5">
                      <div class="toggle-switch-row max-w-sm">
                        <span class="text-xs font-medium text-slate-300">附带发送推理思考过程 (Reasoning)</span>
                        <button class="switch" :class="{ active: localConfig.loli.sendReasoning }" @click="localConfig.loli.sendReasoning = !localConfig.loli.sendReasoning"><span></span></button>
                      </div>

                      <div class="toggle-switch-row max-w-sm">
                        <span class="text-xs font-medium text-slate-300">由 AI 自主决定自然分段</span>
                        <button class="switch" :class="{ active: localConfig.loli.segmentedReply.enable !== false }" @click="localConfig.loli.segmentedReply.enable = !localConfig.loli.segmentedReply.enable"><span></span></button>
                      </div>

                      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">对话维度划分模式</label>
                          <select v-model="localConfig.loli.conversationMode" class="form-select">
                            <option value="group">群维度</option>
                            <option value="user">用户维度</option>
                            <option value="mixed">群 + 用户混合</option>
                          </select>
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">携带历史上下文条数</label>
                          <input v-model="localConfig.loli.contextLength" type="number" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">会话自动过期窗口 (ms)</label>
                          <input v-model="localConfig.loli.sessionWindow" type="number" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">用户单人发言冷却 (ms)</label>
                          <input v-model="localConfig.loli.cooldownUser" type="number" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">群聊触发冷却 (ms)</label>
                          <input v-model="localConfig.loli.cooldownGroup" type="number" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">连发限制次数</label>
                          <input v-model="localConfig.loli.maxReplyBurst" type="number" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">防刷屏惩罚冷却 (ms)</label>
                          <input v-model="localConfig.loli.burstCooldown" type="number" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">发送后自动撤回 (秒, 0不撤)</label>
                          <input v-model="localConfig.loli.recallDefault" type="number" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">分段最短字符数</label>
                          <input v-model="localConfig.loli.segmentedReply.minLength" type="number" min="0" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">AI 未分段时的兜底字符数</label>
                          <input v-model="localConfig.loli.segmentedReply.maxLength" type="number" min="1" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">单次最多分段数</label>
                          <input v-model="localConfig.loli.segmentedReply.maxSegments" type="number" min="1" max="20" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">分段最短间隔 (ms)</label>
                          <input v-model="localConfig.loli.segmentedReply.delayMin" type="number" min="0" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">分段最长间隔 (ms)</label>
                          <input v-model="localConfig.loli.segmentedReply.delayMax" type="number" min="0" class="form-input">
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Sheet 3: Model -->
                <div class="config-sheet" :class="{ active: activeConfigTab === 'model' }">
                  <div class="flex-column gap-4">
                    <div class="card">
                      <span class="card-section-title mb-3 block">// 全局模型参数覆盖 (设置为 -1 或 0 代表关闭)</span>
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div class="flex-column gap-1.5">
                          <div class="flex-row justify-between text-xs">
                            <span class="text-[#8e9099]">Temperature (温度覆盖, -1.0 代表不覆盖)</span>
                            <span class="font-bold text-[#a8c7fa] bg-[#a8c7fa]/10 px-1.5 py-0.2 rounded font-mono">{{ localConfig.loli.temperature === -1 ? '默认 (-1)' : Number(localConfig.loli.temperature).toFixed(1) }}</span>
                          </div>
                          <input v-model="localConfig.loli.temperature" type="range" min="-1.0" max="2.0" step="0.1" class="ai-range-slider mt-2">
                        </div>

                        <div class="flex-column gap-1.5">
                          <div class="flex-row justify-between text-xs">
                            <span class="text-[#8e9099]">Max Tokens (长度覆盖, 0 代表不覆盖)</span>
                            <span class="font-bold text-[#a8c7fa] bg-[#a8c7fa]/10 px-1.5 py-0.2 rounded font-mono">{{ localConfig.loli.maxTokens === 0 ? '默认 (0)' : localConfig.loli.maxTokens }}</span>
                          </div>
                          <input v-model="localConfig.loli.maxTokens" type="range" min="0" max="8192" step="256" class="ai-range-slider mt-2">
                        </div>
                      </div>
                    </div>

                    <div class="card">
                      <div class="flex-row justify-between items-center border-b border-[#2c2e35] pb-2 mb-3">
                        <span class="text-xs font-bold text-[#8e9099]">// 多媒体图片自动压缩优化</span>
                        <button class="switch" :class="{ active: localConfig.loli.imageCompress.enable }" @click="localConfig.loli.imageCompress.enable = !localConfig.loli.imageCompress.enable"><span></span></button>
                      </div>
                      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">图片最大分辨率边长 (px)</label>
                          <input v-model="localConfig.loli.imageCompress.maxLongEdge" type="number" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">压缩 JPEG 质量 (1-100)</label>
                          <input v-model="localConfig.loli.imageCompress.quality" type="number" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">限制单张体积最大值 (KB)</label>
                          <input v-model="localConfig.loli.imageCompress.maxFileSizeKB" type="number" class="form-input">
                        </div>
                      </div>
                    </div>

                    <div class="card">
                      <div class="flex-row justify-between items-center border-b border-[#2c2e35] pb-2 mb-3">
                        <span class="text-xs font-bold text-[#8e9099]">// 多模态历史图片深度</span>
                        <button class="switch" :class="{ active: localConfig.loli.historyImages.enable }" @click="localConfig.loli.historyImages.enable = !localConfig.loli.historyImages.enable"><span></span></button>
                      </div>
                      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">携带历史图片最大数量</label>
                          <input v-model="localConfig.loli.historyImages.maxImages" type="number" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">图片缓存有效留存时间 (秒)</label>
                          <input v-model="localConfig.loli.historyImages.maxAgeSeconds" type="number" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">向后回溯消息检测范围</label>
                          <input v-model="localConfig.loli.historyImages.contextLength" type="number" class="form-input">
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Sheet 4: Memory -->
                <div class="config-sheet" :class="{ active: activeConfigTab === 'memory' }">
                  <div class="flex-column gap-4">
                    <div class="card">
                      <span class="card-section-title mb-3 block">// 记忆归纳大模型关联</span>
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                        <div class="toggle-switch-row">
                          <span class="text-xs font-medium text-slate-300">群聊天记录摘要归纳</span>
                          <button class="switch" :class="{ active: localConfig.memory.group.enable }" @click="localConfig.memory.group.enable = !localConfig.memory.group.enable"><span></span></button>
                        </div>
                        <div class="toggle-switch-row">
                          <span class="text-xs font-medium text-slate-300">成员特征行为画像</span>
                          <button class="switch" :class="{ active: localConfig.memory.user.enable }" @click="localConfig.memory.user.enable = !localConfig.memory.user.enable"><span></span></button>
                        </div>
                      </div>

                      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">群摘要模型</label>
                          <input v-model="localConfig.memory.group.extractionModel" type="text" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">群摘要模型渠道 ID</label>
                          <input v-model="localConfig.memory.group.channelId" type="text" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">用户画像模型</label>
                          <input v-model="localConfig.memory.user.extractionModel" type="text" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">用户画像模型渠道 ID</label>
                          <input v-model="localConfig.memory.user.channelId" type="text" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">画像重整归并模型</label>
                          <input v-model="localConfig.memory.refinementModel" type="text" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">画像重整归并渠道 ID</label>
                          <input v-model="localConfig.memory.refinementChannelId" type="text" class="form-input">
                        </div>
                      </div>
                    </div>

                    <div class="card">
                      <div class="flex-row justify-between items-center border-b border-[#2c2e35] pb-2 mb-3">
                        <div>
                          <span class="text-xs font-bold text-[#8e9099]">// 自适应群聊学习</span>
                          <p class="text-[10px] text-[#666a73] mt-1">先提取客观证据，再由当前角色视角形成主观记忆；核心角色人设不会被改写。</p>
                        </div>
                        <button class="switch" :class="{ active: localConfig.memory.groupLearning.enable !== false }" @click="localConfig.memory.groupLearning.enable = !localConfig.memory.groupLearning.enable"><span></span></button>
                      </div>
                      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">主观记忆角色预设 ID</label>
                          <input v-model="localConfig.memory.groupLearning.perspectivePresetId" type="text" class="form-input" placeholder="留空使用默认角色">
                          <span class="text-[10px] text-[#666a73]">切换预设后只注入该角色自己的主观记忆，避免串人设。</span>
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">首次学习消息数</label>
                          <input v-model="localConfig.memory.groupLearning.minMessages" type="number" min="20" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">增量复审消息数</label>
                          <input v-model="localConfig.memory.groupLearning.updateEveryMessages" type="number" min="10" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">最少活跃成员数</label>
                          <input v-model="localConfig.memory.groupLearning.minActiveUsers" type="number" min="2" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">分析窗口（天）</label>
                          <input v-model="localConfig.memory.groupLearning.windowDays" type="number" min="1" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">自动采纳置信度</label>
                          <input v-model="localConfig.memory.groupLearning.autoApplyMinConfidence" type="number" min="0" max="1" step="0.01" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">每位成员最大样本数</label>
                          <input v-model="localConfig.memory.groupLearning.maxSamplesPerUser" type="number" min="5" class="form-input">
                        </div>
                      </div>
                    </div>

                    <div class="card">
                      <div class="flex-row justify-between items-center border-b border-[#2c2e35] pb-2 mb-3">
                        <span class="text-xs font-bold text-[#8e9099]">// 语义向量数据库检索 (Vector Embedding)</span>
                        <button class="switch" :class="{ active: localConfig.memory.embedding.enable }" @click="localConfig.memory.embedding.enable = !localConfig.memory.embedding.enable"><span></span></button>
                      </div>

                      <div class="flex-column gap-4">
                        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
                          <div class="flex-column gap-1.5">
                            <label class="text-xs text-[#8e9099]">Embedding 核心模型</label>
                            <input v-model="localConfig.memory.embedding.model" type="text" class="form-input">
                          </div>
                          <div class="flex-column gap-1.5">
                            <label class="text-xs text-[#8e9099]">Embedding 模型渠道</label>
                            <input v-model="localConfig.memory.embedding.channelId" type="text" class="form-input">
                          </div>
                          <div class="flex-column gap-1.5">
                            <label class="text-xs text-[#8e9099]">向量输出维度</label>
                            <input v-model="localConfig.memory.embedding.outputDimensionality" type="number" class="form-input">
                          </div>
                          <div class="flex-column gap-1.5">
                            <label class="text-xs text-[#8e9099]">召回数量 (topK)</label>
                            <input v-model="localConfig.memory.embedding.topK" type="number" class="form-input">
                          </div>
                          <div class="flex-column gap-1.5">
                            <label class="text-xs text-[#8e9099]">语义最低匹配分数</label>
                            <input v-model="localConfig.memory.embedding.minScore" type="number" step="0.01" class="form-input">
                          </div>
                        </div>

                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">单独启用记忆归纳的群号列表 (换行分隔)</label>
                          <textarea v-model="localConfig.memory.group.enabledGroups" rows="3" class="form-textarea font-mono"></textarea>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Sheet 5: System -->
                <div class="config-sheet" :class="{ active: activeConfigTab === 'system' }">
                  <div class="flex-column gap-4">
                    <div class="card">
                      <span class="card-section-title mb-3 block">// 群聊上下文格式渲染模板 (微调 prompt)</span>
                      <div class="flex-column gap-4">
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">头部附加说明 (Template Prefix)</label>
                          <textarea v-model="localConfig.llm.groupContextTemplatePrefix" rows="3" class="form-textarea font-mono"></textarea>
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">对话行渲染格式 (e.g. $[name]: $[message])</label>
                          <textarea v-model="localConfig.llm.groupContextTemplateMessage" rows="3" class="form-textarea font-mono"></textarea>
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">尾部结束指令 (Template Suffix)</label>
                          <textarea v-model="localConfig.llm.groupContextTemplateSuffix" rows="3" class="form-textarea font-mono"></textarea>
                        </div>
                      </div>
                    </div>

                    <div class="card">
                      <div class="flex-row justify-between items-center border-b border-[#2c2e35] pb-2 mb-3">
                        <div>
                          <span class="text-xs font-bold text-[#8e9099]">// QQ 表情库与 AI 自主表情</span>
                          <p class="text-[10px] text-[#666a73] mt-1">主人发送的表情可自动进入 SQLite 表情库，AI 在正文结束后按情绪标签自然跟发表情。</p>
                        </div>
                        <button class="switch" :class="{ active: localConfig.stickers.enable !== false }" @click="localConfig.stickers.enable = !localConfig.stickers.enable"><span></span></button>
                      </div>
                      <div class="toggle-switch-row">
                        <div>
                          <span class="text-xs font-medium text-slate-300">自动收录主人表情</span>
                          <p class="text-[10px] text-[#666a73] mt-1">支持直接构造小黄脸/超级表情；收藏、商城和推荐表情需先发给机器人收录原始消息段。</p>
                        </div>
                        <button class="switch" :class="{ active: localConfig.stickers.autoCollectMaster !== false }" @click="localConfig.stickers.autoCollectMaster = !localConfig.stickers.autoCollectMaster"><span></span></button>
                      </div>
                      <div class="toggle-switch-row mt-3">
                        <div>
                          <span class="text-xs font-medium text-slate-300">AI 自动识别动画表情标签</span>
                          <p class="text-[10px] text-[#666a73] mt-1">后台使用当前视觉模型识别情绪、动作和适用场景，不阻塞群聊。</p>
                        </div>
                        <button class="switch" :class="{ active: localConfig.stickers.autoClassify !== false }" @click="localConfig.stickers.autoClassify = !localConfig.stickers.autoClassify"><span></span></button>
                      </div>
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                        <div class="flex-column gap-1">
                          <label class="text-xs text-[#8e9099]">跟发表情概率 (1-100)</label>
                          <input v-model="localConfig.stickers.probability" type="number" class="form-input" placeholder="默认 35">
                        </div>
                        <div class="flex-column gap-1">
                          <label class="text-xs text-[#8e9099]">表情发送冷却时间 (秒)</label>
                          <input v-model="localConfig.stickers.cooldownMs" type="number" class="form-input" placeholder="默认 60">
                        </div>
                      </div>
                    </div>

                    <div class="card">
                      <div class="flex-row justify-between items-center border-b border-[#2c2e35] pb-2 mb-3">
                        <span class="text-xs font-bold text-[#8e9099]">// 管理控制台本地服务</span>
                        <button class="switch" :class="{ active: localConfig.dashboard.enable }" @click="localConfig.dashboard.enable = !localConfig.dashboard.enable"><span></span></button>
                      </div>

                      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">控制台监听端口</label>
                          <input v-model="localConfig.dashboard.port" type="number" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">服务绑定 IP (host)</label>
                          <input v-model="localConfig.dashboard.host" type="text" class="form-input">
                        </div>
                        <div class="flex-column gap-1.5">
                          <label class="text-xs text-[#8e9099]">控制台安全令牌 (authToken)</label>
                          <input v-model="localConfig.dashboard.authToken" type="password" class="form-input">
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>

          <!-- Pane 7: Logs -->
          <div class="page-pane" v-show="activeTab === 'logs'">
            <div class="pane-content logs-pane-content flex-column gap-4 select-text">
              
              <!-- Logs Header Actions -->
              <div class="flex-row flex-wrap justify-between items-center gap-4 flex-shrink-0">
                <div class="flex-row gap-3 flex-wrap items-center">
                  <h2 class="text-lg font-bold text-white">// 终端日志</h2>
                  <select v-model="logsLevelFilter" class="form-select py-1 w-[160px]">
                    <option value="ALL">所有日志 (ALL)</option>
                    <option value="DEBUG">运行调试 (DEBUG)</option>
                    <option value="INFO">系统普通 (INFO)</option>
                    <option value="WARN">警告信息 (WARN)</option>
                    <option value="ERROR">致命异常 (ERROR)</option>
                  </select>
                  <input v-model="logsSearchQuery" type="text" placeholder="过滤关键词..." class="form-input py-1 w-[180px]">
                </div>

                <div class="flex-row gap-2">
                  <button class="btn btn-secondary py-1.5" @click="logsAutoRefresh = !logsAutoRefresh">
                    <svg class="mr-1.5 inline" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="9" x2="9" y1="9" y2="15"/><line x1="15" x2="15" y1="9" y2="15"/></svg>
                    <span>{{ logsAutoRefresh ? '暂停刷新' : '恢复刷新' }}</span>
                  </button>
                  <button class="btn btn-secondary py-1.5" @click="handleCopyLogs">
                    <svg class="mr-1.5 inline" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                    复制日志
                  </button>
                  <button class="btn btn-danger py-1.5" @click="handleClearLogs">
                    <svg class="mr-1.5 inline" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    清空日志
                  </button>
                </div>
              </div>

              <!-- Terminal log window -->
              <div class="flex-1 min-h-0 border border-[#2c2e35] bg-[#0b0d10] rounded-lg overflow-hidden flex flex-col">
                <div class="flex-column h-full min-h-0 relative">
                  <div class="h-8 bg-[#13151a] border-b border-[#2c2e35] flex items-center justify-between px-4 flex-shrink-0">
                    <div class="flex-row items-center gap-2 text-[10px] font-mono text-[#8e9099]">
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>
                      <span>TERMINAL OUTPUT // STDOUT</span>
                    </div>
                    <div class="flex gap-1.5">
                      <span class="w-2 h-2 rounded-full bg-red-500/25"></span>
                      <span class="w-2 h-2 rounded-full bg-yellow-500/25"></span>
                      <span class="w-2 h-2 rounded-full bg-green-500/25"></span>
                    </div>
                  </div>
                  <div class="flex-1 overflow-y-auto p-4 font-mono text-[10px] leading-relaxed flex flex-col gap-1.5 bg-black/45" ref="terminalLogsRef">
                    <div v-if="filteredLogs.length === 0" class="py-12 text-center text-slate-500 text-xs font-semibold">暂无匹配的终端日志输出</div>
                    <div 
                      v-else
                      v-for="log in filteredLogs" 
                      :key="log.timestamp + log.message" 
                      class="flex-row items-start gap-2 hover:bg-white/5 py-0.5 px-1 rounded transition-colors select-text"
                    >
                      <span class="text-[#8e9099] select-none">[{{ log.timestamp }}]</span>
                      <span class="text-[9px] font-bold px-1.5 py-0.2 rounded border scale-90 select-none" :class="getLogLevelTagClass(log.level)">{{ log.level }}</span>
                      <span class="break-all whitespace-pre-wrap select-text" :class="getLogLevelClass(log.level)">{{ log.message }}</span>
                    </div>
                  </div>
                </div>
              </div>

              </div>
            </div>
          </div>
        </div>
      </div>

    <!-- Toast Notifications Root -->
    <div class="toast-container">
      <div v-for="t in toasts" :key="t.id" class="toast visible" :class="t.type">
        <span class="toast-text">{{ t.message }}</span>
      </div>
    </div>

    <!-- Auth prompt overlay gate -->
    <div class="auth-overlay" v-if="authRequired && !authorized">
      <div class="auth-card">
        <div class="auth-header">
          <div class="auth-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/></svg>
          </div>
          <h2 class="auth-title">登入 Hina AI Studio</h2>
          <p class="auth-subtitle">此服务受到安全令牌保护，请输入机器人管理员配置的 `authToken` 进行身份校验</p>
        </div>
        <div class="auth-body">
          <div class="flex-column gap-2">
            <label class="text-xs text-[#8e9099] font-medium">安全访问令牌 (authToken)</label>
            <input type="password" v-model="authTokenInput" placeholder="输入验证令牌" class="form-input text-center font-mono py-2" @keyup.enter="verifyToken">
          </div>
          <button class="btn btn-primary w-full py-2.5 mt-2" @click="verifyToken">验证并登入</button>
          <p class="auth-error-msg font-mono text-[10px] text-center mt-2 text-[#f28b82]" v-if="authError">{{ authError }}</p>
        </div>
        <div class="auth-footer text-[9px]">
          GEHENNA BOT WORKSPACE SECURE GATEWAY
        </div>
      </div>
    </div>

    <!-- Modals -->
    <!-- Channel Modal -->
    <div class="modal-overlay" :class="{ hidden: !channelModalVisible }">
      <div class="modal-card max-w-[450px]">
        <div class="modal-header">
          <span class="modal-title">{{ channelFormTitle }}</span>
          <button class="modal-close" @click="channelModalVisible = false">×</button>
        </div>
        <div class="modal-body flex-column gap-3.5">
          <div class="grid grid-cols-2 gap-3">
            <div class="flex-column gap-1">
              <label class="text-[10px] text-[#8e9099] font-medium">渠道 ID</label>
              <input v-model="channelForm.id" type="text" placeholder="gemini" class="form-input" :disabled="channelForm.isEdit">
            </div>
            <div class="flex-column gap-1">
              <label class="text-[10px] text-[#8e9099] font-medium">渠道名称</label>
              <input v-model="channelForm.name" type="text" placeholder="谷歌官方" class="form-input">
            </div>
          </div>
          <div class="flex-column gap-1">
            <label class="text-[10px] text-[#8e9099] font-medium">API 适配器</label>
            <select v-model="channelForm.adapterType" class="form-select">
              <option value="gemini">Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="antigravity">Antigravity Tools</option>
              <option value="anythingllm">AnythingLLM</option>
            </select>
          </div>
          <div class="flex-column gap-1" v-if="channelForm.adapterType === 'antigravity'">
            <label class="text-[10px] text-[#8e9099] font-medium">Antigravity API 协议</label>
            <select v-model="channelForm.protocol" class="form-select">
              <option value="gemini">Gemini 原生（推荐）</option>
              <option value="openai">OpenAI 兼容</option>
            </select>
            <span class="text-[10px] text-[#666a73]">Gemini 原生使用根地址；OpenAI 兼容使用 /v1。</span>
          </div>
          <div class="flex-column gap-1">
            <label class="text-[10px] text-[#8e9099] font-medium">支持模型列表 (英文逗号分隔)</label>
            <div class="flex-row gap-2">
              <input v-model="channelForm.models" type="text" placeholder="gemini-2.5-flash, gemini-2.5-pro" class="form-input flex-1 min-w-0">
              <button type="button" class="btn btn-secondary whitespace-nowrap" @click="fetchChannelModels" :disabled="isFetchingModels">{{ isFetchingModels ? '获取中…' : '获取模型' }}</button>
            </div>
          </div>
          <div class="flex-column gap-1">
            <label class="text-[10px] text-[#8e9099] font-medium">API Key</label>
            <input v-model="channelForm.apiKey" type="password" placeholder="请输入密钥..." class="form-input">
          </div>
          <div class="flex-column gap-1">
            <label class="text-[10px] text-[#8e9099] font-medium">Base URL (API 终结点)</label>
            <input v-model="channelForm.baseUrl" type="text" placeholder="默认使用官方端点，如需中转请填写" class="form-input">
            <span v-if="channelForm.adapterType === 'antigravity'" class="text-[10px] text-[#666a73] block mt-1">
              {{ channelForm.protocol === 'gemini' 
                  ? 'Gemini 原生：127.0.0.1:8045；模型列表读取 /v1beta/models。' 
                  : 'OpenAI 兼容：127.0.0.1:8045/v1；模型列表读取 /v1/models。' 
              }}
            </span>
          </div>
          <div class="flex-column gap-1" v-if="isChannelFormGemini">
            <label class="text-[10px] text-[#8e9099] font-medium">Gemini 安全等级</label>
            <select v-model="channelForm.safetyLevel" class="form-select">
              <option value="default">跟随模型默认</option>
              <option value="off">关闭附加过滤</option>
              <option value="permissive">宽松（仅高风险拦截）</option>
              <option value="balanced">均衡（中高风险拦截）</option>
              <option value="strict">严格（低风险起拦截）</option>
            </select>
            <span class="text-[10px] text-[#666a73]">统一作用于骚扰、仇恨、露骨内容和危险内容；Gemini 核心保护不可关闭。</span>
          </div>
        </div>
        <div class="modal-footer justify-end">
          <button class="btn btn-secondary" @click="channelModalVisible = false">取消</button>
          <button class="btn btn-primary" @click="saveChannel">保存</button>
        </div>
      </div>
    </div>

    <!-- Preset Modal -->
    <div class="modal-overlay" :class="{ hidden: !presetModalVisible }">
      <div class="modal-card max-w-[920px] p-0 flex flex-col overflow-hidden">
        <div class="modal-header px-5 py-3 border-b border-[#2c2e35]">
          <span class="modal-title text-xs font-bold uppercase tracking-wider">{{ presetFormTitle }}</span>
          <button class="modal-close text-lg font-bold" @click="presetModalVisible = false">×</button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-5 gap-0 md:h-[480px] bg-[#0b0d10] overflow-hidden">
          
          <!-- Left: Prompt Sandbox -->
          <div class="md:col-span-3 flex-column h-full overflow-y-auto p-4 border-r border-[#2c2e35]">
            <div class="flex-column gap-1.5 h-full">
              <div class="flex-row justify-between items-center">
                <label class="text-[10px] text-[#a8c7fa] font-bold tracking-wide uppercase">系统指示 (System Instructions)</label>
                <span class="text-[9px] text-[#8e9099] font-mono">System Prompt Editor</span>
              </div>
              <textarea v-model="presetForm.prompt" placeholder="您可以在此处详细定义该角色的系统设定、语气特点与人设偏好..." class="flex-1 w-full font-mono text-xs leading-relaxed bg-[#13151a] border border-[#2c2e35] p-3 rounded-lg focus:border-[#a8c7fa] outline-none resize-none min-h-[260px] text-white"></textarea>
            </div>
          </div>

          <!-- Right: parameters control -->
          <div class="md:col-span-2 flex-column h-full overflow-y-auto p-4 justify-between bg-[#13151a]">
            <div class="flex-column gap-4">
              <div class="flex-row items-center gap-1.5 pb-1.5 border-b border-[#2c2e35]">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a8c7fa" stroke-width="2"><line x1="4" x2="20" y1="21" y2="21"/><line x1="4" x2="20" y1="3" y2="3"/><line x1="12" x2="20" y1="12" y2="12"/><line x1="4" x2="8" y1="12" y2="12"/></svg>
                <span class="text-[10px] font-bold text-[#e3e2e6] uppercase tracking-wide">参数控制 (Settings)</span>
              </div>

              <!-- Identity Row -->
              <div class="grid grid-cols-2 gap-3">
                <div class="flex-column gap-1">
                  <label class="text-[10px] text-[#8e9099] font-medium">预设唯一 ID</label>
                  <input v-model="presetForm.id" type="text" placeholder="hina" class="form-input" :disabled="presetForm.isEdit">
                </div>
                <div class="flex-column gap-1">
                  <label class="text-[10px] text-[#8e9099] font-medium">角色显示名称</label>
                  <input v-model="presetForm.name" type="text" placeholder="空崎日奈" class="form-input">
                </div>
              </div>

              <!-- Channel select -->
              <div class="flex-column gap-1">
                <label class="text-[10px] text-[#8e9099] font-medium">绑定模型渠道</label>
                <select v-model="presetForm.channelId" class="form-select">
                  <option v-for="c in channels" :key="c.id" :value="c.id">{{ c.name }} ({{ c.id }})</option>
                </select>
              </div>

              <!-- Model input -->
              <div class="flex-column gap-1">
                <label class="text-[10px] text-[#8e9099] font-medium">目标执行大模型</label>
                <input v-model="presetForm.model" type="text" placeholder="gemini-2.5-flash" class="form-input">
              </div>

              <!-- Temperature range slider -->
              <div class="flex-column gap-1">
                <div class="flex-row justify-between items-center text-[10px]">
                  <span class="text-[#8e9099] font-medium">温度 (Temperature)</span>
                  <span class="font-mono text-[#a8c7fa] bg-[#a8c7fa]/10 px-1.5 py-0.2 rounded font-bold">{{ Number(presetForm.temperature).toFixed(1) }}</span>
                </div>
                <input v-model="presetForm.temperature" type="range" min="0.0" max="2.0" step="0.1" class="ai-range-slider w-full">
              </div>

              <!-- Max Tokens range slider -->
              <div class="flex-column gap-1">
                <div class="flex-row justify-between items-center text-[10px]">
                  <span class="text-[#8e9099] font-medium">长度 (Max Output Tokens)</span>
                  <span class="font-mono text-[#a8c7fa] bg-[#a8c7fa]/10 px-1.5 py-0.2 rounded font-bold">{{ presetForm.maxTokens }}</span>
                </div>
                <input v-model="presetForm.maxTokens" type="range" min="256" max="8192" step="256" class="ai-range-slider w-full">
              </div>

              <!-- Top P override -->
              <div class="flex-column gap-1">
                <label class="text-[10px] text-[#8e9099] font-medium">核采样比率 (Top P, 留空默认)</label>
                <input v-model="presetForm.topP" type="text" placeholder="可选输入，例如 0.95" class="form-input">
              </div>

              <!-- CoT Reasoning -->
              <div class="flex-column gap-2 p-2 bg-black/20 border border-[#2c2e35] rounded-lg">
                <div class="flex-row justify-between items-center">
                  <div class="flex-column">
                    <span class="text-[11px] font-semibold text-[#e3e2e6]">启动思考模型推理</span>
                    <span class="text-[8px] text-[#8e9099]">支持输出思维链 (CoT)</span>
                  </div>
                  <button class="switch" :class="{ active: presetForm.enableReasoning }" @click="presetForm.enableReasoning = !presetForm.enableReasoning"><span></span></button>
                </div>
                <div class="flex-column gap-1.5 border-t border-[#2c2e35] pt-2">
                  <label class="text-[9px] text-[#8e9099] font-medium">思考字数额度 (Thinking Level)</label>
                  <select v-model="presetForm.thinkingLevel" class="form-select p-1 text-[10px]">
                    <option v-for="opt in THINKING_LEVEL_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Footer block inside right pane -->
            <div class="flex-row justify-end gap-2 pt-4 mt-4 border-t border-[#2c2e35] bg-transparent">
              <button class="btn btn-secondary" @click="presetModalVisible = false">取消</button>
              <button class="btn btn-primary font-bold" @click="savePreset">保存预设</button>
            </div>
          </div>

        </div>
      </div>
    </div>

    <!-- Tool Upload Modal -->
    <div class="modal-overlay" :class="{ hidden: !toolModalVisible }">
      <div class="modal-card max-w-[450px]">
        <div class="modal-header">
          <span class="modal-title">导入自定义扩展 (.js)</span>
          <button class="modal-close" @click="toolModalVisible = false">×</button>
        </div>
        <div class="modal-body flex-column gap-3.5">
          <div class="drop-zone" @click="$refs.toolFileInputRef.click()">
            <input type="file" ref="toolFileInputRef" accept=".js" class="hidden" @change="handleFileInputChange">
            <div class="drop-zone-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
            </div>
            <div class="drop-zone-text">
              <span class="block-label font-bold text-white">点击区域选择或拖拽 .js 文件</span>
              <span class="block-sublabel text-[10px] text-[#8e9099]">文件将保存至 tools 扩展目录下</span>
            </div>
          </div>

          <div class="file-info-bar" v-if="selectedToolFile">
            <div class="flex-row items-center gap-2 text-green-400 text-xs">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span class="font-bold truncate max-w-[200px]">{{ toolFileInfo.name }}</span>
              <span class="text-[9px] font-mono opacity-85">{{ toolFileInfo.size }}</span>
            </div>
            <button class="text-red-400 hover:text-red-300 font-bold text-xs" @click="clearSelectedToolFile">×</button>
          </div>
        </div>
        <div class="modal-footer justify-end">
          <button class="btn btn-secondary" @click="toolModalVisible = false">取消</button>
          <button class="btn btn-primary" :disabled="!selectedToolFile" @click="submitToolUpload">上传至服务器</button>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* Inject simple Vue transitions if needed, but the main layout classes are fully defined in style.css */
</style>
