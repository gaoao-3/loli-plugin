/**
 * 日奈控制台 - 前端应用
 * 轻量级 vanilla JS，无构建依赖
 */

const API_BASE = '/api'

const state = {
  currentPage: 'overview',
  system: null,
  channels: [],
  presets: [],
  tools: [],
  memory: null,
  logs: '',
  loading: false,
  theme: 'dark'
}

const THINKING_LEVEL_OPTIONS = ['OFF', 'LOW', 'MEDIUM', 'HIGH']

function normalizeThinkingLevel (value, enableReasoning = true) {
  if (value == null || value === '') {
    return enableReasoning ? 'LOW' : 'OFF'
  }

  const normalized = String(value).toUpperCase()
  switch (normalized) {
    case 'OFF':
    case 'MINIMAL':
      return 'OFF'
    case 'LOW':
    case 'MEDIUM':
    case 'HIGH':
      return normalized
    default:
      return enableReasoning ? 'LOW' : 'OFF'
  }
}

function getThinkingLevelOptionsMarkup (selectedLevel) {
  return THINKING_LEVEL_OPTIONS.map(level => `<option value="${level}" ${selectedLevel === level ? 'selected' : ''}>${level}</option>`).join('')
}

function parseNumberInput (value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

const pages = {
  overview: { title: '总览', render: renderOverview },
  channels: { title: '渠道管理', render: renderChannels },
  presets: { title: '预设管理', render: renderPresets },
  tools: { title: '工具管理', render: renderTools },
  memory: { title: '记忆系统', render: renderMemory },
  config: { title: '系统配置', render: renderConfig },
  logs: { title: '运行日志', render: renderLogs }
}

// ================= API 工具 =================

async function api (path, options = {}) {
  const url = `${API_BASE}${path}`
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || `HTTP ${res.status}`)
    }
    if (res.status === 204) return null
    const contentType = res.headers.get('content-type') || ''
    return contentType.includes('application/json') ? res.json() : res.text()
  } catch (err) {
    showToast(err.message, 'error')
    throw err
  }
}

const get = (path) => api(path)
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })
const put = (path, body) => api(path, { method: 'PUT', body: JSON.stringify(body) })
const del = (path) => api(path, { method: 'DELETE' })

// ================= UI 工具 =================

function showToast (message, type = 'success') {
  const container = document.getElementById('toastContainer')
  const toast = document.createElement('div')
  toast.className = `toast ${type}`
  toast.textContent = message
  container.appendChild(toast)
  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transform = 'translateX(100%)'
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}

function setLoading (loading) {
  state.loading = loading
  const refreshBtn = document.getElementById('refreshBtn')
  if (refreshBtn) refreshBtn.style.opacity = loading ? '0.5' : '1'
}

function formatDate (ts) {
  if (!ts) return '-'
  const d = new Date(ts)
  return d.toLocaleString('zh-CN')
}

function escapeHtml (str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// ================= 路由 =================

function navigate (page) {
  if (!pages[page]) return
  state.currentPage = page
  document.getElementById('pageTitle').textContent = pages[page].title
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page)
  })
  window.location.hash = page
  renderPage()
}

function renderPage () {
  const content = document.getElementById('content')
  content.innerHTML = '<div class="loading"><div class="spinner"></div>加载中...</div>'
  pages[state.currentPage].render(content)
}

// ================= 页面渲染 =================

async function renderOverview (container) {
  try {
    setLoading(true)
    const [system, channels, tools] = await Promise.all([
      get('/system/status'),
      get('/channels'),
      get('/tools')
    ])
    state.system = system
    state.channels = channels
    state.tools = tools

    const enabledChannels = channels.filter(c => c.status === 'enabled').length
    const enabledTools = tools.filter(t => t.enabled).length

    container.innerHTML = `
      <div class="page">
        <div class="card-grid">
          <div class="card">
            <div class="card-title">运行状态</div>
            <div class="card-value" style="color: ${system.status === 'ok' ? 'var(--success)' : 'var(--danger)'};">
              ${system.status === 'ok' ? '正常' : '异常'}
            </div>
            <div class="card-subtitle">${system.message || '系统运行中'}</div>
          </div>
          <div class="card">
            <div class="card-title">已启用渠道</div>
            <div class="card-value">${enabledChannels}</div>
            <div class="card-subtitle">共 ${channels.length} 个渠道</div>
          </div>
          <div class="card">
            <div class="card-title">已加载工具</div>
            <div class="card-value">${enabledTools}</div>
            <div class="card-subtitle">共 ${tools.length} 个工具</div>
          </div>
          <div class="card">
            <div class="card-title">运行时间</div>
            <div class="card-value">${system.uptime || '0s'}</div>
            <div class="card-subtitle">自启动以来</div>
          </div>
        </div>

        <div class="section">
          <div class="card">
            <div class="card-header">
              <h3>快速操作</h3>
            </div>
            <div class="flex gap-3">
              <button class="btn" onclick="refreshAll()">🔄 刷新数据</button>
              <button class="btn btn-secondary" onclick="navigate('channels')">⚙️ 管理渠道</button>
              <button class="btn btn-secondary" onclick="navigate('tools')">🧰 管理工具</button>
              <button class="btn btn-secondary" onclick="navigate('memory')">🧠 查看记忆</button>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="card">
            <div class="card-header">
              <h3>最近活动</h3>
            </div>
            <div class="code-block">${escapeHtml(JSON.stringify(system, null, 2))}</div>
          </div>
        </div>
      </div>
    `
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div>加载失败：${escapeHtml(err.message)}</div></div>`
  } finally {
    setLoading(false)
  }
}

async function renderChannels (container) {
  try {
    setLoading(true)
    const channels = await get('/channels')
    state.channels = channels

    container.innerHTML = `
      <div class="page">
        <div class="section-header">
          <h2 class="section-title">AI 渠道</h2>
          <button class="btn btn-sm" onclick="showChannelModal()">+ 添加渠道</button>
        </div>
        <div class="card">
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>适配器</th>
                  <th>模型</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${channels.length ? channels.map(ch => `
                  <tr>
                    <td><strong>${escapeHtml(ch.name)}</strong><br><span class="card-subtitle">${escapeHtml(ch.id)}</span></td>
                    <td>${escapeHtml(ch.adapterType)}</td>
                    <td>${escapeHtml((ch.models || []).join(', '))}</td>
                    <td><span class="badge ${ch.status === 'enabled' ? 'badge-success' : 'badge-secondary'}">${ch.status === 'enabled' ? '启用' : '禁用'}</span></td>
                    <td>
                      <div class="flex gap-2">
                        <button class="btn btn-sm btn-secondary" onclick="showChannelModal('${ch.id}')">编辑</button>
                        <button class="btn btn-sm ${ch.status === 'enabled' ? 'btn-danger' : 'btn-success'}" onclick="toggleChannel('${ch.id}')">${ch.status === 'enabled' ? '禁用' : '启用'}</button>
                      </div>
                    </td>
                  </tr>
                `).join('') : '<tr><td colspan="5" class="empty-state">暂无渠道</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div>加载失败：${escapeHtml(err.message)}</div></div>`
  } finally {
    setLoading(false)
  }
}

async function renderPresets (container) {
  try {
    setLoading(true)
    const presets = await get('/presets')
    state.presets = presets

    container.innerHTML = `
      <div class="page">
        <div class="section-header">
          <h2 class="section-title">预设</h2>
          <button class="btn btn-sm" onclick="showPresetModal()">+ 添加预设</button>
        </div>
        <div class="card-grid">
          ${presets.length ? presets.map(p => `
            <div class="card">
              <div class="card-header">
                <h3>${escapeHtml(p.name)}</h3>
                <span class="badge ${p.status === 'enabled' ? 'badge-success' : 'badge-secondary'}">${p.status === 'enabled' ? '启用' : '禁用'}</span>
              </div>
              <div class="card-subtitle mb-4">渠道: ${escapeHtml(p.channelId)}</div>
              <div class="card-subtitle mb-4">模型: ${escapeHtml(p.sendMessageOption?.model || '-')}</div>
              <div class="card-subtitle mb-4">思考: ${p.sendMessageOption?.enableReasoning === false ? '关闭' : normalizeThinkingLevel(p.sendMessageOption?.thinkingLevel ?? p.sendMessageOption?.reasoningEffort, true)}</div>
              <div class="flex gap-2">
                <button class="btn btn-sm btn-secondary" onclick="showPresetModal('${p.id}')">编辑</button>
                <button class="btn btn-sm ${p.status === 'enabled' ? 'btn-danger' : 'btn-success'}" onclick="togglePreset('${p.id}')">${p.status === 'enabled' ? '禁用' : '启用'}</button>
              </div>
            </div>
          `).join('') : '<div class="empty-state">暂无预设</div>'}
        </div>
      </div>
    `
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div>加载失败：${escapeHtml(err.message)}</div></div>`
  } finally {
    setLoading(false)
  }
}

async function renderTools (container) {
  try {
    setLoading(true)
    const tools = await get('/tools')
    state.tools = tools

    container.innerHTML = `
      <div class="page">
        <div class="section-header">
          <h2 class="section-title">工具插件</h2>
          <div class="flex gap-2">
            <button class="btn btn-sm" onclick="reloadTools()">🔄 热重载</button>
            <button class="btn btn-sm btn-secondary" onclick="showUploadModal()">⬆️ 上传工具</button>
          </div>
        </div>
        <div class="card-grid">
          ${tools.length ? tools.map(t => `
            <div class="card">
              <div class="card-header">
                <h3>${escapeHtml(t.name)}</h3>
                <span class="badge ${t.enabled ? 'badge-success' : 'badge-secondary'}">${t.enabled ? '启用' : '禁用'}</span>
              </div>
              <div class="card-subtitle mb-4">${escapeHtml(t.description || '无描述')}</div>
              <div class="card-subtitle mb-4">路径: ${escapeHtml(t.path || '-')}</div>
              <div class="flex gap-2">
                <button class="btn btn-sm ${t.enabled ? 'btn-danger' : 'btn-success'}" onclick="toggleTool('${t.name}')">${t.enabled ? '禁用' : '启用'}</button>
              </div>
            </div>
          `).join('') : '<div class="empty-state">暂无工具</div>'}
        </div>
      </div>
    `
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div>加载失败：${escapeHtml(err.message)}</div></div>`
  } finally {
    setLoading(false)
  }
}

async function renderMemory (container) {
  try {
    setLoading(true)
    const memory = await get('/memory/stats')
    state.memory = memory

    container.innerHTML = `
      <div class="page">
        <div class="card-grid">
          <div class="card">
            <div class="card-title">实体数量</div>
            <div class="card-value">${memory.entities || 0}</div>
          </div>
          <div class="card">
            <div class="card-title">关系数量</div>
            <div class="card-value">${memory.relations || 0}</div>
          </div>
          <div class="card">
            <div class="card-title">归档文件</div>
            <div class="card-value">${memory.archives || 0}</div>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <h3>记忆统计</h3>
          </div>
          <div class="code-block">${escapeHtml(JSON.stringify(memory, null, 2))}</div>
        </div>
      </div>
    `
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div>加载失败：${escapeHtml(err.message)}</div></div>`
  } finally {
    setLoading(false)
  }
}

async function renderConfig (container) {
  try {
    setLoading(true)
    const config = await get('/config')

    const imageCompress = config.loli?.imageCompress || {}
    const historyImages = config.loli?.historyImages || {}

    container.innerHTML = `
      <div class="page">
        <div class="section-header">
          <h2 class="section-title">系统配置</h2>
          <button class="btn btn-sm" onclick="saveConfig()">💾 保存</button>
        </div>

        <div class="card">
          <div class="card-header"><h3>基础设置</h3></div>
          <div class="form-group">
            <label class="form-label">伪人模式总开关</label>
            <select class="form-select" id="cfg-loli-enable">
              <option value="true" ${config.loli?.enable ? 'selected' : ''}>启用</option>
              <option value="false" ${!config.loli?.enable ? 'selected' : ''}>禁用</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">上下文条数</label>
            <input class="form-input" type="number" id="cfg-loli-contextLength" value="${config.loli?.contextLength || 30}">
          </div>
          <div class="form-group">
            <label class="form-label">用户冷却 (ms)</label>
            <input class="form-input" type="number" id="cfg-loli-cooldownUser" value="${config.loli?.cooldownUser || 3000}">
          </div>
          <div class="form-group">
            <label class="form-label">群聊冷却 (ms)</label>
            <input class="form-input" type="number" id="cfg-loli-cooldownGroup" value="${config.loli?.cooldownGroup || 1000}">
          </div>
          <div class="form-group">
            <label class="form-label">主动回复概率</label>
            <input class="form-input" type="number" step="0.1" min="0" max="1" id="cfg-loli-promptProbability" value="${config.loli?.promptProbability || 0}">
          </div>
          <div class="form-group">
            <label class="form-label">发送思考内容</label>
            <select class="form-select" id="cfg-loli-sendReasoning">
              <option value="true" ${config.loli?.sendReasoning ? 'selected' : ''}>启用</option>
              <option value="false" ${!config.loli?.sendReasoning ? 'selected' : ''}>禁用</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">会话复用窗口 (ms)</label>
            <input class="form-input" type="number" id="cfg-loli-sessionWindow" value="${config.loli?.sessionWindow || 300000}">
          </div>
          <div class="form-group">
            <label class="form-label">连续回复上限 (0=不限)</label>
            <input class="form-input" type="number" id="cfg-loli-maxReplyBurst" value="${config.loli?.maxReplyBurst || 0}">
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>图片压缩</h3></div>
          <div class="form-group">
            <label class="form-label">启用图片压缩</label>
            <select class="form-select" id="cfg-img-enable">
              <option value="true" ${imageCompress.enable !== false ? 'selected' : ''}>启用</option>
              <option value="false" ${imageCompress.enable === false ? 'selected' : ''}>禁用</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">长边最大像素</label>
            <input class="form-input" type="number" id="cfg-img-maxLongEdge" value="${imageCompress.maxLongEdge || 1536}">
          </div>
          <div class="form-group">
            <label class="form-label">JPEG 质量 (1-100)</label>
            <input class="form-input" type="number" min="1" max="100" id="cfg-img-quality" value="${imageCompress.quality || 85}">
          </div>
          <div class="form-group">
            <label class="form-label">最大文件大小 (KB)</label>
            <input class="form-input" type="number" id="cfg-img-maxFileSizeKB" value="${imageCompress.maxFileSizeKB || 2048}">
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>历史图片识别</h3></div>
          <div class="form-group">
            <label class="form-label">启用历史图片识别</label>
            <select class="form-select" id="cfg-himg-enable">
              <option value="true" ${historyImages.enable !== false ? 'selected' : ''}>启用</option>
              <option value="false" ${historyImages.enable === false ? 'selected' : ''}>禁用</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">最多收集张数</label>
            <input class="form-input" type="number" id="cfg-himg-maxImages" value="${historyImages.maxImages || 5}">
          </div>
          <div class="form-group">
            <label class="form-label">最大时效 (秒)</label>
            <input class="form-input" type="number" id="cfg-himg-maxAgeSeconds" value="${historyImages.maxAgeSeconds || 300}">
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>管理面板</h3></div>
          <div class="form-group">
            <label class="form-label">面板端口</label>
            <input class="form-input" type="number" id="cfg-dash-port" value="${config.dashboard?.port || 3000}">
          </div>
          <div class="form-group">
            <label class="form-label">访问令牌 (为空不校验)</label>
            <input class="form-input" type="password" id="cfg-dash-authToken" value="${config.dashboard?.authToken || ''}">
          </div>
        </div>
      </div>
    `
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div>加载失败：${escapeHtml(err.message)}</div></div>`
  } finally {
    setLoading(false)
  }
}

async function renderLogs (container) {
  try {
    setLoading(true)
    const logs = await get('/logs')
    container.innerHTML = `
      <div class="page">
        <div class="section-header">
          <h2 class="section-title">运行日志</h2>
          <button class="btn btn-sm btn-secondary" onclick="clearLogs()">🗑️ 清空</button>
        </div>
        <div class="card">
          <div class="code-block" style="max-height: 70vh; overflow-y: auto;">${escapeHtml(logs || '暂无日志')}</div>
        </div>
      </div>
    `
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div>加载失败：${escapeHtml(err.message)}</div></div>`
  } finally {
    setLoading(false)
  }
}

// ================= 操作 =================

async function refreshAll () {
  renderPage()
}

async function toggleChannel (id) {
  try {
    const ch = state.channels.find(c => c.id === id)
    if (!ch) return
    ch.status = ch.status === 'enabled' ? 'disabled' : 'enabled'
    await put('/channels/' + id, ch)
    showToast('渠道状态已更新')
    renderPage()
  } catch (err) {
    console.error(err)
  }
}

async function togglePreset (id) {
  try {
    const p = state.presets.find(x => x.id === id)
    if (!p) return
    p.status = p.status === 'enabled' ? 'disabled' : 'enabled'
    await put('/presets/' + id, p)
    showToast('预设状态已更新')
    renderPage()
  } catch (err) {
    console.error(err)
  }
}

async function toggleTool (name) {
  try {
    await post('/tools/' + encodeURIComponent(name) + '/toggle')
    showToast('工具状态已更新')
    renderPage()
  } catch (err) {
    console.error(err)
  }
}

async function reloadTools () {
  try {
    await post('/tools/reload')
    showToast('工具已热重载')
    renderPage()
  } catch (err) {
    console.error(err)
  }
}

async function saveConfig () {
  try {
    const config = {
      loli: {
        enable: document.getElementById('cfg-loli-enable').value === 'true',
        contextLength: parseInt(document.getElementById('cfg-loli-contextLength').value),
        cooldownUser: parseInt(document.getElementById('cfg-loli-cooldownUser').value),
        cooldownGroup: parseInt(document.getElementById('cfg-loli-cooldownGroup').value),
        promptProbability: parseFloat(document.getElementById('cfg-loli-promptProbability').value),
        sendReasoning: document.getElementById('cfg-loli-sendReasoning').value === 'true',
        sessionWindow: parseInt(document.getElementById('cfg-loli-sessionWindow').value),
        maxReplyBurst: parseInt(document.getElementById('cfg-loli-maxReplyBurst').value),
        imageCompress: {
          enable: document.getElementById('cfg-img-enable').value === 'true',
          maxLongEdge: parseInt(document.getElementById('cfg-img-maxLongEdge').value),
          quality: parseInt(document.getElementById('cfg-img-quality').value),
          maxFileSizeKB: parseInt(document.getElementById('cfg-img-maxFileSizeKB').value)
        },
        historyImages: {
          enable: document.getElementById('cfg-himg-enable').value === 'true',
          maxImages: parseInt(document.getElementById('cfg-himg-maxImages').value),
          maxAgeSeconds: parseInt(document.getElementById('cfg-himg-maxAgeSeconds').value)
        }
      },
      dashboard: {
        port: parseInt(document.getElementById('cfg-dash-port').value),
        authToken: document.getElementById('cfg-dash-authToken').value
      }
    }
    await put('/config', config)
    showToast('配置已保存')
  } catch (err) {
    console.error(err)
  }
}

async function clearLogs () {
  try {
    await post('/logs/clear')
    showToast('日志已清空')
    renderPage()
  } catch (err) {
    console.error(err)
  }
}

// ================= Modal =================

function showModal (title, content, footer = '') {
  const modal = document.createElement('div')
  modal.className = 'modal-overlay active'
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="modal-close" onclick="closeModal(this)">×</button>
      </div>
      <div class="modal-body">${content}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    </div>
  `
  modal.addEventListener('click', e => {
    if (e.target === modal) closeModal(modal.querySelector('.modal-close'))
  })
  document.body.appendChild(modal)
}

function closeModal (el) {
  const modal = el.closest('.modal-overlay')
  if (modal) modal.remove()
}

function showChannelModal (id) {
  const ch = id ? state.channels.find(c => c.id === id) : null
  showModal(
    id ? '编辑渠道' : '添加渠道',
    `
      <div class="form-group">
        <label class="form-label">ID</label>
        <input class="form-input" id="ch-id" value="${ch ? escapeHtml(ch.id) : ''}" ${ch ? 'disabled' : ''}>
      </div>
      <div class="form-group">
        <label class="form-label">名称</label>
        <input class="form-input" id="ch-name" value="${ch ? escapeHtml(ch.name) : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">适配器</label>
        <select class="form-select" id="ch-adapter">
          <option value="gemini" ${ch?.adapterType === 'gemini' ? 'selected' : ''}>Gemini</option>
          <option value="openai" ${ch?.adapterType === 'openai' ? 'selected' : ''}>OpenAI</option>
          <option value="anythingllm" ${ch?.adapterType === 'anythingllm' ? 'selected' : ''}>AnythingLLM</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">模型 (逗号分隔)</label>
        <input class="form-input" id="ch-models" value="${ch ? escapeHtml((ch.models || []).join(', ')) : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">API Key</label>
        <input class="form-input" type="password" id="ch-apiKey" value="${ch ? escapeHtml(ch.options?.apiKey || '') : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Base URL</label>
        <input class="form-input" id="ch-baseUrl" value="${ch ? escapeHtml(ch.options?.baseUrl || '') : ''}">
      </div>
    `,
    `
      <button class="btn btn-secondary" onclick="closeModal(this)">取消</button>
      <button class="btn" onclick="submitChannel('${id || ''}')">保存</button>
    `
  )
}

async function submitChannel (id) {
  const data = {
    id: id || document.getElementById('ch-id').value,
    name: document.getElementById('ch-name').value,
    adapterType: document.getElementById('ch-adapter').value,
    models: document.getElementById('ch-models').value.split(',').map(s => s.trim()).filter(Boolean),
    options: {
      apiKey: document.getElementById('ch-apiKey').value,
      baseUrl: document.getElementById('ch-baseUrl').value
    },
    status: 'enabled'
  }
  try {
    if (id) {
      await put('/channels/' + id, data)
    } else {
      await post('/channels', data)
    }
    showToast('渠道已保存')
    closeModal(document.querySelector('.modal-close'))
    renderPage()
  } catch (err) {
    console.error(err)
  }
}

function showPresetModal (id) {
  const p = id ? state.presets.find(x => x.id === id) : null
  showModal(
    id ? '编辑预设' : '添加预设',
    `
      <div class="form-group">
        <label class="form-label">ID</label>
        <input class="form-input" id="ps-id" value="${p ? escapeHtml(p.id) : ''}" ${p ? 'disabled' : ''}>
      </div>
      <div class="form-group">
        <label class="form-label">名称</label>
        <input class="form-input" id="ps-name" value="${p ? escapeHtml(p.name) : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">渠道 ID</label>
        <input class="form-input" id="ps-channelId" value="${p ? escapeHtml(p.channelId) : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">默认模型</label>
        <input class="form-input" id="ps-model" value="${p ? escapeHtml(p.sendMessageOption?.model || '') : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Temperature</label>
        <input class="form-input" type="number" step="0.1" id="ps-temperature" value="${p ? p.sendMessageOption?.temperature || 0.9 : 0.9}">
      </div>
      <div class="form-group">
        <label class="form-label">Max Tokens</label>
        <input class="form-input" type="number" min="1" id="ps-maxTokens" value="${p ? p.sendMessageOption?.maxTokens || 2048 : 2048}">
      </div>
      <div class="form-group">
        <label class="form-label">启用思考</label>
        <select class="form-select" id="ps-enableReasoning">
          <option value="true" ${p?.sendMessageOption?.enableReasoning !== false ? 'selected' : ''}>启用</option>
          <option value="false" ${p?.sendMessageOption?.enableReasoning === false ? 'selected' : ''}>禁用</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">思考等级</label>
        <select class="form-select" id="ps-thinkingLevel">
          ${getThinkingLevelOptionsMarkup(normalizeThinkingLevel(p?.sendMessageOption?.thinkingLevel ?? p?.sendMessageOption?.reasoningEffort, p?.sendMessageOption?.enableReasoning !== false))}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Top P</label>
        <input class="form-input" type="number" step="0.05" min="0" max="1" id="ps-topP" value="${p && p.sendMessageOption?.topP != null ? p.sendMessageOption.topP : ''}" placeholder="可选">
      </div>
      <div class="form-group">
        <label class="form-label">System Prompt</label>
        <textarea class="form-textarea" id="ps-systemPrompt">${p ? escapeHtml(p.systemPrompt?.content || '') : ''}</textarea>
      </div>
    `,
    `
      <button class="btn btn-secondary" onclick="closeModal(this)">取消</button>
      <button class="btn" onclick="submitPreset('${id || ''}')">保存</button>
    `
  )
}

async function submitPreset (id) {
  const enableReasoning = document.getElementById('ps-enableReasoning').value === 'true'
  const thinkingLevel = normalizeThinkingLevel(document.getElementById('ps-thinkingLevel').value, enableReasoning)
  const topPValue = document.getElementById('ps-topP').value.trim()
  const data = {
    id: id || document.getElementById('ps-id').value,
    name: document.getElementById('ps-name').value,
    channelId: document.getElementById('ps-channelId').value,
    sendMessageOption: {
      model: document.getElementById('ps-model').value,
      temperature: parseNumberInput(document.getElementById('ps-temperature').value, 0.9),
      maxTokens: parseInt(document.getElementById('ps-maxTokens').value) || 2048,
      enableReasoning,
      thinkingLevel,
      reasoningEffort: thinkingLevel.toLowerCase(),
      ...(topPValue ? { topP: parseNumberInput(topPValue, 1) } : {})
    },
    systemPrompt: {
      content: document.getElementById('ps-systemPrompt').value
    },
    status: 'enabled'
  }
  try {
    if (id) {
      await put('/presets/' + id, data)
    } else {
      await post('/presets', data)
    }
    showToast('预设已保存')
    closeModal(document.querySelector('.modal-close'))
    renderPage()
  } catch (err) {
    console.error(err)
  }
}

function showUploadModal () {
  showModal(
    '上传工具文件',
    `
      <div class="upload-zone" id="uploadZone">
        <div class="empty-state-icon">📁</div>
        <div>拖拽文件到此处或点击选择</div>
        <input type="file" id="uploadFile" accept=".js" class="hidden">
      </div>
      <div id="uploadInfo" class="mt-4"></div>
    `,
    `
      <button class="btn btn-secondary" onclick="closeModal(this)">取消</button>
      <button class="btn" id="uploadSubmit" onclick="submitUpload()">上传</button>
    `
  )

  const zone = document.getElementById('uploadZone')
  const input = document.getElementById('uploadFile')
  const info = document.getElementById('uploadInfo')

  zone.addEventListener('click', () => input.click())
  zone.addEventListener('dragover', e => {
    e.preventDefault()
    zone.classList.add('dragover')
  })
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'))
  zone.addEventListener('drop', e => {
    e.preventDefault()
    zone.classList.remove('dragover')
    input.files = e.dataTransfer.files
    updateUploadInfo()
  })
  input.addEventListener('change', updateUploadInfo)

  function updateUploadInfo () {
    const file = input.files[0]
    info.innerHTML = file ? `<div class="badge badge-success">已选择: ${escapeHtml(file.name)} (${(file.size / 1024).toFixed(1)} KB)</div>` : ''
  }
}

async function submitUpload () {
  const input = document.getElementById('uploadFile')
  if (!input.files[0]) {
    showToast('请先选择文件', 'warning')
    return
  }
  const form = new FormData()
  form.append('tool', input.files[0])
  try {
    const res = await fetch(`${API_BASE}/tools/upload`, { method: 'POST', body: form })
    if (!res.ok) throw new Error(await res.text())
    showToast('工具上传成功')
    closeModal(document.querySelector('.modal-close'))
    renderPage()
  } catch (err) {
    showToast(err.message, 'error')
  }
}

// ================= 初始化 =================

function init () {
  // 路由处理
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault()
      navigate(item.dataset.page)
      document.getElementById('sidebar').classList.remove('open')
    })
  })

  document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open')
  })

  document.getElementById('sidebarClose').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open')
  })

  document.getElementById('refreshBtn').addEventListener('click', () => renderPage())

  document.getElementById('themeBtn').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark'
    document.body.classList.toggle('light-theme', state.theme === 'light')
  })

  // 初始页面
  const hash = window.location.hash.replace('#', '') || 'overview'
  navigate(hash)
}

// 等待 DOM 加载
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

// 全局暴露函数供 HTML 内联事件使用
window.navigate = navigate
window.showChannelModal = showChannelModal
window.submitChannel = submitChannel
window.toggleChannel = toggleChannel
window.showPresetModal = showPresetModal
window.submitPreset = submitPreset
window.togglePreset = togglePreset
window.showUploadModal = showUploadModal
window.submitUpload = submitUpload
window.toggleTool = toggleTool
window.reloadTools = reloadTools
window.refreshAll = refreshAll
window.saveConfig = saveConfig
window.clearLogs = clearLogs
window.closeModal = closeModal
