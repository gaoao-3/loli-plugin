/**
 * Hina AI Studio - Vanilla JS Dashboard Controller
 * Pure Vanilla JS, No Build Tools, Fluid Gestures & Dynamic Animations
 */

const API_BASE = '/api';

const state = {
  currentPage: 'overview',
  authorized: false,
  loading: false,
  system: null,
  channels: [],
  presets: [],
  tools: [],
  memory: null,
  logs: [],
  config: null,
  isSidebarCollapsed: false,
  logsAutoRefresh: true,
  logsRefreshTimer: null,
  selectedPresetId: null,
  selectedChannelId: null,
  selectedToolFile: null
};

const PAGE_ORDER = ['overview', 'channels', 'presets', 'tools', 'memory', 'config', 'logs'];
const PAGE_TITLES = {
  overview: '// 总览 WORKSPACE',
  channels: '// AI 渠道管理',
  presets: '// 预设角色管理',
  tools: '// 工具扩展插件',
  memory: '// 记忆系统',
  config: '// 系统参数配置',
  logs: '// 终端日志'
};

const THINKING_LEVEL_OPTIONS = [
  { label: 'OFF', value: 'OFF' },
  { label: 'LOW', value: 'LOW' },
  { label: 'MEDIUM', value: 'MEDIUM' },
  { label: 'HIGH', value: 'HIGH' }
];

// ================= API Engine with Auth Interceptor =================

async function api(path, options = {}) {
  const token = localStorage.getItem('loli-dashboard-token');
  const url = `${API_BASE}${path}`;
  
  const headers = { ...options.headers };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(url, { ...options, headers });
    
    if (res.status === 401) {
      localStorage.removeItem('loli-dashboard-token');
      showAuthOverlay(true);
      throw new Error('未授权，请先验证 Token');
    }
    
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    
    if (res.status === 204) return null;
    const contentType = res.headers.get('content-type') || '';
    return contentType.includes('application/json') ? res.json() : res.text();
  } catch (err) {
    if (res?.status !== 401) {
      showToast(err.message, 'error');
    }
    throw err;
  }
}

const get = (path) => api(path);
const post = (path, body) => api(path, { method: 'POST', ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
const put = (path, body) => api(path, { method: 'PUT', body: JSON.stringify(body) });
const del = (path) => api(path, { method: 'DELETE' });

// ================= UI Helpers =================

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-text">${message}</span>
  `;
  container.appendChild(toast);

  // Trigger browser reflow for entry slide animation
  toast.offsetHeight;
  toast.classList.add('visible');

  setTimeout(() => {
    toast.classList.remove('visible');
    toast.classList.add('exiting');
    setTimeout(() => toast.remove(), 250);
  }, 2800);
}

function showLoading(show) {
  state.loading = show;
  const spinner = document.getElementById('globalSpinner');
  if (spinner) {
    spinner.classList.toggle('hidden', !show);
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getToolFileName(path) {
  if (!path) return '-';
  const clean = path.replace(/\\/g, '/');
  const parts = clean.split('/');
  return parts.slice(-2).join('/');
}

function showAuthOverlay(show) {
  const overlay = document.getElementById('authOverlay');
  if (overlay) {
    overlay.classList.toggle('hidden', !show);
    if (show) {
      document.getElementById('auth-token-input').focus();
    }
  }
}

// ================= Navigation and Physical Page Slider =================

function navigate(pageId) {
  if (!PAGE_ORDER.includes(pageId)) return;
  
  const pageIndex = PAGE_ORDER.indexOf(pageId);
  const oldPage = state.currentPage;
  state.currentPage = pageId;

  // 1. Update document location hash
  if (window.location.hash !== `#${pageId}`) {
    window.location.hash = pageId;
  }

  // 2. Set Active Nav items (Sidebar & Mobile Nav)
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-page') === pageId);
  });
  document.querySelectorAll('.bottom-nav-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-page') === pageId);
  });

  // 3. Update Title
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) {
    titleEl.textContent = PAGE_TITLES[pageId] || '// WORKSPACE';
  }

  // 4. Translate Pages container (Smooth horizontal sliding transition)
  const wrapper = document.getElementById('pagesWrapper');
  if (wrapper) {
    wrapper.style.transform = `translateX(-${pageIndex * (100 / PAGE_ORDER.length)}%)`;
  }

  // 5. Manage stdout logs polling
  if (pageId === 'logs') {
    startLogsPolling();
  } else {
    stopLogsPolling();
  }

  // 6. Sidebar Mobile overlay drawer auto-close
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.classList.remove('open');
  }

  // 7. Load Tab specific data
  loadTabData(pageId);
}

function loadTabData(pageId) {
  switch (pageId) {
    case 'overview':
      syncOverview();
      break;
    case 'channels':
      syncChannels();
      break;
    case 'presets':
      syncPresets();
      break;
    case 'tools':
      syncTools();
      break;
    case 'memory':
      syncMemory();
      break;
    case 'config':
      syncConfig();
      break;
    case 'logs':
      syncLogs(true);
      break;
  }
}

// ================= Tab Implementation Controllers =================

// --- Tab 1: Overview ---
async function syncOverview() {
  try {
    showLoading(true);
    const [system, channels, tools] = await Promise.all([
      get('/system/status'),
      get('/channels'),
      get('/tools')
    ]);
    
    state.system = system;
    state.channels = channels;
    state.tools = tools;

    const enabledChannels = channels.filter(c => c.status === 'enabled').length;
    const enabledTools = tools.filter(t => t.enabled).length;

    // Update Overview Cards values
    document.getElementById('ov-status').textContent = system.status === 'ok' ? '正常运行' : '运行异常';
    const badge = document.getElementById('ov-status-badge');
    badge.textContent = system.status === 'ok' ? 'OK' : 'ERR';
    badge.className = `badge ${system.status === 'ok' ? 'badge-success' : 'badge-danger'}`;
    document.getElementById('ov-message').textContent = system.message || '系统一切正常';
    
    document.getElementById('ov-channels-active').textContent = enabledChannels;
    document.getElementById('ov-channels-total').textContent = `共 ${channels.length} 个`;

    document.getElementById('ov-tools-active').textContent = enabledTools;
    document.getElementById('ov-tools-total').textContent = `共 ${tools.length} 个`;

    document.getElementById('ov-uptime').textContent = system.uptime || '0s';

    // Render detailed specifications table
    const detailsBody = document.getElementById('ov-details-body');
    const items = [
      { key: '系统真实内存', val: system.memoryUsage || '未知' },
      { key: '机器人进程内存', val: system.processMemory?.rssFormatted || '未知' },
      { key: '当前适配器渠道', val: channels.map(c => `${c.name} (${c.adapterType})`).join(', ') || '暂无绑定的渠道' },
      { key: '当前活跃会话', val: system.activeSessions || '0' },
      { key: 'Bot 主体账号', val: system.botInfo || '未绑定' },
      { key: '系统指令配置', val: system.systemPromptCount ? `${system.systemPromptCount} 条设定` : '无' }
    ];
    
    detailsBody.innerHTML = items.map(item => `
      <tr>
        <td class="font-bold text-[#e3e2e6]">${escapeHtml(item.key)}</td>
        <td class="font-mono text-slate-400">${escapeHtml(item.val)}</td>
      </tr>
    `).join('');

  } catch (err) {
    console.error(err);
  } finally {
    showLoading(false);
  }
}

// --- Tab 2: Channels ---
async function syncChannels() {
  try {
    showLoading(true);
    const channels = await get('/channels');
    state.channels = channels;

    const listBody = document.getElementById('channels-list-body');
    if (!listBody) return;

    if (channels.length === 0) {
      listBody.innerHTML = `<tr><td colspan="5" class="empty-cell">暂无已配置的适配器渠道</td></tr>`;
      return;
    }

    listBody.innerHTML = channels.map(ch => `
      <tr class="hover-row">
        <td>
          <div class="flex-column">
            <span class="text-sm font-bold text-[#e3e2e6]">${escapeHtml(ch.name)}</span>
            <span class="text-[10px] font-mono text-[#8e9099] mt-0.5">${escapeHtml(ch.id)}</span>
          </div>
        </td>
        <td>
          <span class="font-mono text-xs uppercase bg-[#2c2e35] px-1.5 py-0.5 rounded text-[#cbd5e1] border border-[#2c2e35]">${escapeHtml(ch.adapterType)}</span>
        </td>
        <td>
          <span class="font-mono text-xs text-slate-300 truncate max-w-[200px] block" title="${escapeHtml((ch.models || []).join(', '))}">${escapeHtml((ch.models || []).join(', ') || '-')}</span>
        </td>
        <td>
          <span class="badge ${ch.status === 'enabled' ? 'badge-success' : 'badge-gray'}">${ch.status === 'enabled' ? '已启用' : '已禁用'}</span>
        </td>
        <td>
          <div class="flex-row justify-end gap-2">
            <button class="btn btn-secondary py-1 px-2 text-[11px]" onclick="handleOpenChannelEdit('${ch.id}')">编辑</button>
            <button class="btn ${ch.status === 'enabled' ? 'btn-danger' : 'btn-success'} py-1 px-2 text-[11px]" onclick="toggleChannelStatus('${ch.id}', '${ch.status}')">
              ${ch.status === 'enabled' ? '禁用' : '启用'}
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error(err);
  } finally {
    showLoading(false);
  }
}

async function toggleChannelStatus(id, currentStatus) {
  try {
    showLoading(true);
    const updatedStatus = currentStatus === 'enabled' ? 'disabled' : 'enabled';
    const channel = state.channels.find(c => c.id === id);
    if (!channel) return;

    await put(`/channels/${id}`, { ...channel, status: updatedStatus });
    showToast('渠道状态已更新');
    syncChannels();
  } catch (err) {
    console.error(err);
  } finally {
    showLoading(false);
  }
}

function handleOpenChannelAdd() {
  state.selectedChannelId = null;
  document.getElementById('channelModalTitle').textContent = '添加 AI 渠道';
  document.getElementById('channel-form-id').value = '';
  document.getElementById('channel-form-id').disabled = false;
  document.getElementById('channel-form-name').value = '';
  document.getElementById('channel-form-adapter').value = 'gemini';
  document.getElementById('channel-form-models').value = 'gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash-thinking-exp';
  document.getElementById('channel-form-apikey').value = '';
  document.getElementById('channel-form-baseurl').value = '';
  
  document.getElementById('channelModal').classList.remove('hidden');
}

function handleOpenChannelEdit(id) {
  const ch = state.channels.find(c => c.id === id);
  if (!ch) return;

  state.selectedChannelId = id;
  document.getElementById('channelModalTitle').textContent = '编辑 AI 渠道';
  
  document.getElementById('channel-form-id').value = ch.id;
  document.getElementById('channel-form-id').disabled = true;
  document.getElementById('channel-form-name').value = ch.name || '';
  document.getElementById('channel-form-adapter').value = ch.adapterType || 'gemini';
  document.getElementById('channel-form-models').value = (ch.models || []).join(', ');
  document.getElementById('channel-form-apikey').value = ch.apiKey || '';
  document.getElementById('channel-form-baseurl').value = ch.baseUrl || '';

  document.getElementById('channelModal').classList.remove('hidden');
}

function closeChannelModal() {
  document.getElementById('channelModal').classList.add('hidden');
}

async function saveChannelForm() {
  const id = document.getElementById('channel-form-id').value.trim();
  const name = document.getElementById('channel-form-name').value.trim();
  const adapterType = document.getElementById('channel-form-adapter').value;
  const modelsInput = document.getElementById('channel-form-models').value;
  const apiKey = document.getElementById('channel-form-apikey').value.trim();
  const baseUrl = document.getElementById('channel-form-baseurl').value.trim();

  if (!id || !name) {
    showToast('请输入渠道 ID 和名称', 'warning');
    return;
  }

  const models = modelsInput.split(',').map(s => s.trim()).filter(Boolean);
  const payload = {
    id,
    name,
    adapterType,
    models,
    apiKey,
    baseUrl: baseUrl || undefined,
    status: state.selectedChannelId ? state.channels.find(c => c.id === state.selectedChannelId)?.status : 'enabled'
  };

  try {
    showLoading(true);
    if (state.selectedChannelId) {
      await put(`/channels/${state.selectedChannelId}`, payload);
    } else {
      await post('/channels', payload);
    }
    showToast('渠道保存成功');
    closeChannelModal();
    syncChannels();
  } catch (err) {
    console.error(err);
  } finally {
    showLoading(false);
  }
}

// --- Tab 3: Presets ---
async function syncPresets() {
  try {
    showLoading(true);
    const [presets, channels] = await Promise.all([
      get('/presets'),
      get('/channels')
    ]);
    state.presets = presets;
    state.channels = channels;

    // Fill channel select list inside presets modal
    const sel = document.getElementById('preset-form-channel');
    if (sel) {
      sel.innerHTML = channels.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${c.id})</option>`).join('');
    }

    const listGrid = document.getElementById('presets-list-grid');
    if (!listGrid) return;

    if (presets.length === 0) {
      listGrid.innerHTML = `<div class="col-span-full py-12 text-center text-slate-500 text-sm font-semibold">暂无已配置的角色预设</div>`;
      return;
    }

    listGrid.innerHTML = presets.map(p => {
      const reasoning = p.sendMessageOption?.enableReasoning !== false;
      const thinking = p.sendMessageOption?.thinkingLevel || 'LOW';
      
      return `
        <div class="card flex-column justify-between hover-border">
          <div class="flex-row justify-between items-start mb-3">
            <div>
              <h3 class="text-sm font-bold text-[#e3e2e6]">${escapeHtml(p.name)}</h3>
              <p class="text-[10px] font-mono text-[#8e9099] mt-0.5">ID: ${escapeHtml(p.id)}</p>
            </div>
            <span class="badge ${p.status === 'enabled' ? 'badge-success' : 'badge-gray'}">${p.status === 'enabled' ? '已启用' : '已禁用'}</span>
          </div>

          <div class="flex-column gap-1.5 text-xs mb-4">
            <div class="flex-row justify-between items-center">
              <span class="text-[#8e9099] scale-95 origin-left">绑定渠道：</span>
              <span class="bg-[#2c2e35] text-[#c7c6ca] text-[9px] font-mono px-1.5 py-0.2 rounded">${escapeHtml(p.channelId)}</span>
            </div>
            <div class="flex-row justify-between items-center">
              <span class="text-[#8e9099] scale-95 origin-left">执行模型：</span>
              <span class="font-mono text-slate-300 truncate max-w-[130px] inline-block" title="${escapeHtml(p.sendMessageOption?.model || '')}">${escapeHtml(p.sendMessageOption?.model || '-')}</span>
            </div>
            <div class="flex-row justify-between items-center">
              <span class="text-[#8e9099] scale-95 origin-left">推理细节：</span>
              <span class="font-mono text-slate-300">${escapeHtml(thinking)} ${reasoning ? '(COT)' : '(OFF)'}</span>
            </div>
          </div>

          <div class="flex-row justify-end gap-2 pt-3 border-t border-[#2c2e35]/50 mt-auto">
            <button class="btn btn-secondary py-1 px-2.5 text-xs" onclick="handleOpenPresetEdit('${p.id}')">配置参数</button>
            <button class="btn ${p.status === 'enabled' ? 'btn-danger' : 'btn-success'} py-1 px-2.5 text-xs" onclick="togglePresetStatus('${p.id}', '${p.status}')">
              ${p.status === 'enabled' ? '禁用' : '启用'}
            </button>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error(err);
  } finally {
    showLoading(false);
  }
}

async function togglePresetStatus(id, currentStatus) {
  try {
    showLoading(true);
    const updatedStatus = currentStatus === 'enabled' ? 'disabled' : 'enabled';
    const preset = state.presets.find(p => p.id === id);
    if (!preset) return;

    await put(`/presets/${id}`, { ...preset, status: updatedStatus });
    showToast('预设角色状态已更新');
    syncPresets();
  } catch (err) {
    console.error(err);
  } finally {
    showLoading(false);
  }
}

function handleOpenPresetAdd() {
  state.selectedPresetId = null;
  document.getElementById('presetModalTitle').textContent = '创建预设角色';
  document.getElementById('preset-form-id').value = '';
  document.getElementById('preset-form-id').disabled = false;
  document.getElementById('preset-form-name').value = '';
  document.getElementById('preset-form-channel').value = state.channels[0]?.id || '';
  document.getElementById('preset-form-model').value = '';
  document.getElementById('preset-form-prompt').value = '';
  
  // Set slider defaults
  document.getElementById('preset-form-temp').value = 0.9;
  document.getElementById('preset-form-temp-val').textContent = '0.9';
  document.getElementById('preset-form-tokens').value = 2048;
  document.getElementById('preset-form-tokens-val').textContent = '2048';
  document.getElementById('preset-form-topp').value = '';
  
  // Switch & Select COT
  setSwitchState('preset-form-reasoning', true);
  
  const levelSelect = document.getElementById('preset-form-thinking-level');
  levelSelect.innerHTML = THINKING_LEVEL_OPTIONS.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
  levelSelect.value = 'LOW';

  document.getElementById('presetModal').classList.remove('hidden');
}

function handleOpenPresetEdit(id) {
  const p = state.presets.find(pr => pr.id === id);
  if (!p) return;

  state.selectedPresetId = id;
  document.getElementById('presetModalTitle').textContent = '系统设置与提示词 (Hina AI Studio)';
  
  document.getElementById('preset-form-id').value = p.id;
  document.getElementById('preset-form-id').disabled = true;
  document.getElementById('preset-form-name').value = p.name || '';
  document.getElementById('preset-form-channel').value = p.channelId || '';
  document.getElementById('preset-form-model').value = p.sendMessageOption?.model || '';
  document.getElementById('preset-form-prompt').value = p.systemPrompt?.content || '';
  
  const temp = p.sendMessageOption?.temperature ?? 0.9;
  document.getElementById('preset-form-temp').value = temp;
  document.getElementById('preset-form-temp-val').textContent = Number(temp).toFixed(1);
  
  const tokens = p.sendMessageOption?.maxTokens ?? 2048;
  document.getElementById('preset-form-tokens').value = tokens;
  document.getElementById('preset-form-tokens-val').textContent = tokens;

  document.getElementById('preset-form-topp').value = p.sendMessageOption?.topP ?? '';

  setSwitchState('preset-form-reasoning', p.sendMessageOption?.enableReasoning !== false);
  
  const levelSelect = document.getElementById('preset-form-thinking-level');
  levelSelect.innerHTML = THINKING_LEVEL_OPTIONS.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
  levelSelect.value = p.sendMessageOption?.thinkingLevel || 'LOW';

  document.getElementById('presetModal').classList.remove('hidden');
}

function closePresetModal() {
  document.getElementById('presetModal').classList.add('hidden');
}

async function savePresetForm() {
  const id = document.getElementById('preset-form-id').value.trim();
  const name = document.getElementById('preset-form-name').value.trim();
  const channelId = document.getElementById('preset-form-channel').value;
  const model = document.getElementById('preset-form-model').value.trim();
  const prompt = document.getElementById('preset-form-prompt').value;
  
  const temperature = Number(document.getElementById('preset-form-temp').value);
  const maxTokens = Number(document.getElementById('preset-form-tokens').value);
  const topPStr = document.getElementById('preset-form-topp').value.trim();
  const topP = topPStr ? Number(topPStr) : undefined;

  const enableReasoning = getSwitchState('preset-form-reasoning');
  const thinkingLevel = document.getElementById('preset-form-thinking-level').value;

  if (!id || !name) {
    showToast('请输入预设 ID 和名称', 'warning');
    return;
  }

  const payload = {
    id,
    name,
    channelId,
    sendMessageOption: {
      model,
      temperature,
      maxTokens,
      enableReasoning,
      thinkingLevel,
      ...(topP !== undefined && !Number.isNaN(topP) ? { topP } : {})
    },
    systemPrompt: {
      content: prompt
    },
    status: state.selectedPresetId ? state.presets.find(p => p.id === state.selectedPresetId)?.status : 'enabled'
  };

  try {
    showLoading(true);
    if (state.selectedPresetId) {
      await put(`/presets/${state.selectedPresetId}`, payload);
    } else {
      await post('/presets', payload);
    }
    showToast('预设角色保存成功');
    closePresetModal();
    syncPresets();
  } catch (err) {
    console.error(err);
  } finally {
    showLoading(false);
  }
}

// --- Tab 4: Tools ---
async function syncTools() {
  try {
    showLoading(true);
    const tools = await get('/tools');
    state.tools = tools;

    const listGrid = document.getElementById('tools-list-grid');
    if (!listGrid) return;

    if (tools.length === 0) {
      listGrid.innerHTML = `<div class="col-span-full py-12 text-center text-slate-500 text-sm font-semibold">暂无已加载的扩展工具插件</div>`;
      return;
    }

    listGrid.innerHTML = tools.map(t => `
      <div class="card flex-column justify-between hover-border">
        <div class="flex-row justify-between items-start">
          <div>
            <h3 class="text-sm font-bold text-[#e3e2e6] truncate max-w-[150px]" title="${escapeHtml(t.toolName || t.name)}">${escapeHtml(t.toolName || t.name)}</h3>
            <p class="text-[10px] font-mono text-[#8e9099] mt-0.5">${escapeHtml(t.name)}.js</p>
          </div>
          <span class="badge ${t.enabled ? 'badge-success' : 'badge-gray'}">${t.enabled ? '已加载' : '已停用'}</span>
        </div>

        <p class="text-xs text-[#8e9099] leading-relaxed my-4 min-h-[44px]">${escapeHtml(t.description || '暂无关于此扩展工具的描述说明。')}</p>

        <div class="flex-column gap-3 mt-auto">
          <div class="flex-row justify-between text-[10px] font-mono text-[#8e9099] pb-2.5 border-b border-[#2c2e35] min-w-0">
            <span>物理文件：</span>
            <span class="truncate max-w-[150px] inline-block" title="${escapeHtml(t.path || '')}">
              ${escapeHtml(getToolFileName(t.path))}
            </span>
          </div>
          
          <button class="btn w-full ${t.enabled ? 'btn-danger' : 'btn-success'} py-1.5 text-xs font-bold" onclick="toggleToolStatus('${t.name}')">
            ${t.enabled ? '停用此扩展' : '启用此扩展'}
          </button>
        </div>
      </div>
    `).join('');

  } catch (err) {
    console.error(err);
  } finally {
    showLoading(false);
  }
}

async function toggleToolStatus(name) {
  try {
    showLoading(true);
    await post(`/tools/${encodeURIComponent(name)}/toggle`);
    showToast('扩展工具状态已更新');
    syncTools();
  } catch (err) {
    console.error(err);
  } finally {
    showLoading(false);
  }
}

async function handleReloadTools() {
  try {
    showLoading(true);
    await post('/tools/reload');
    showToast('工具插件热重载完成');
    syncTools();
  } catch (err) {
    console.error(err);
  } finally {
    showLoading(false);
  }
}

function handleOpenToolUpload() {
  state.selectedToolFile = null;
  const fileInput = document.getElementById('tool-form-file');
  if (fileInput) fileInput.value = '';
  
  document.getElementById('toolFileInfoBar').classList.add('hidden');
  document.getElementById('toolUploadBtn').disabled = true;
  document.getElementById('toolModal').classList.remove('hidden');
}

function closeToolModal() {
  document.getElementById('toolModal').classList.add('hidden');
}

function handleSelectToolFile(file) {
  if (!file) return;
  if (!file.name.endsWith('.js')) {
    showToast('仅支持上传 .js 格式的扩展工具文件', 'warning');
    return;
  }

  state.selectedToolFile = file;
  document.getElementById('toolFileName').textContent = file.name;
  document.getElementById('toolFileSize').textContent = `(${(file.size / 1024).toFixed(1)} KB)`;
  
  document.getElementById('toolFileInfoBar').classList.remove('hidden');
  document.getElementById('toolUploadBtn').disabled = false;
}

function clearSelectedToolFile() {
  state.selectedToolFile = null;
  const fileInput = document.getElementById('tool-form-file');
  if (fileInput) fileInput.value = '';
  document.getElementById('toolFileInfoBar').classList.add('hidden');
  document.getElementById('toolUploadBtn').disabled = true;
}

async function submitToolUpload() {
  if (!state.selectedToolFile) return;

  const form = new FormData();
  form.append('tool', state.selectedToolFile);

  try {
    showLoading(true);
    await post('/tools/upload', form);
    showToast('自定义工具导入成功');
    closeToolModal();
    syncTools();
  } catch (err) {
    console.error(err);
  } finally {
    showLoading(false);
  }
}

// --- Tab 5: Memory ---
async function syncMemory() {
  try {
    showLoading(true);
    const memory = await get('/memory/stats');
    state.memory = memory;

    document.getElementById('mem-messages').textContent = memory.messages || 0;
    document.getElementById('mem-total-dims').textContent = (memory.summaries || 0) + (memory.profiles || 0);
    document.getElementById('mem-dims-subtitle').textContent = `包含 ${memory.summaries || 0} 条群摘要 & ${memory.profiles || 0} 个用户特征`;
    document.getElementById('mem-embeddings').textContent = memory.embeddings || 0;

    // Progress Bars Rendering
    const getPercent = (value, max) => {
      const m = Math.max(1, max);
      return Math.min(100, ((value || 0) / m) * 100);
    };

    const maxBase = memory.messages || 1;
    const embedBase = memory.embeddings || 1;

    // Set percentage values & widths
    document.getElementById('mem-prog-summaries-val').textContent = `${memory.summaries || 0} 条`;
    document.getElementById('mem-prog-summaries').style.width = `${getPercent(memory.summaries, maxBase)}%`;

    document.getElementById('mem-prog-archived-val').textContent = `${memory.archivedSummaries || 0} 份`;
    document.getElementById('mem-prog-archived').style.width = `${getPercent(memory.archivedSummaries, maxBase)}%`;

    document.getElementById('mem-prog-profiles-val').textContent = `${memory.profiles || 0} 个`;
    document.getElementById('mem-prog-profiles').style.width = `${getPercent(memory.profiles, embedBase)}%`;

    document.getElementById('mem-prog-chunks-val').textContent = `${memory.chunks || 0} 块`;
    document.getElementById('mem-prog-chunks').style.width = `${getPercent(memory.chunks, embedBase)}%`;

    document.getElementById('mem-db-path').textContent = memory.dbPath || '未检测到 SQLite 数据库物理路径';

  } catch (err) {
    console.error(err);
  } finally {
    showLoading(false);
  }
}

// --- Tab 6: Config ---
async function syncConfig() {
  try {
    showLoading(true);
    const config = await get('/config');
    state.config = config;

    const arrayToText = (val) => Array.isArray(val) ? val.join('\n') : (val || '');

    // Set form fields
    document.getElementById('inp-triggerPrefix').value = arrayToText(config.loli?.triggerPrefix);
    document.getElementById('inp-triggerKeywords').value = arrayToText(config.loli?.triggerKeywords);
    document.getElementById('inp-groups').value = arrayToText(config.loli?.groups);
    document.getElementById('inp-blackGroups').value = arrayToText(config.loli?.blackGroups);
    document.getElementById('inp-blackUsers').value = arrayToText(config.loli?.blackUsers);

    // Switches
    setSwitchState('sw-enable', config.loli?.enable);
    setSwitchState('sw-enableAtTrigger', config.loli?.enableAtTrigger);
    setSwitchState('sw-enablePrefixTrigger', config.loli?.enablePrefixTrigger);
    setSwitchState('sw-enableKeywordTrigger', config.loli?.enableKeywordTrigger);
    setSwitchState('sw-enableProactiveTrigger', config.loli?.enableProactiveTrigger);

    document.getElementById('inp-defaultPreset').value = config.loli?.defaultPreset || '';
    
    // Proactive probability slider
    const prob = config.loli?.promptProbability || 0;
    document.getElementById('inp-promptProbability').value = prob;
    document.getElementById('val-promptProbability').textContent = Number(prob).toFixed(2);

    // Tab 2: Session config sheets
    setSwitchState('sw-sendReasoning', config.loli?.sendReasoning);
    setSwitchState('sw-segmentedReply', config.loli?.segmentedReply?.enable !== false);
    document.getElementById('inp-conversationMode').value = config.loli?.conversationMode || 'group';
    document.getElementById('inp-contextLength').value = config.loli?.contextLength || 30;
    document.getElementById('inp-sessionWindow').value = config.loli?.sessionWindow || 300000;
    document.getElementById('inp-cooldownUser').value = config.loli?.cooldownUser || 3000;
    document.getElementById('inp-cooldownGroup').value = config.loli?.cooldownGroup || 1000;
    document.getElementById('inp-maxReplyBurst').value = config.loli?.maxReplyBurst || 0;
    document.getElementById('inp-burstCooldown').value = config.loli?.burstCooldown || 180000;
    document.getElementById('inp-recallDefault').value = config.loli?.recallDefault || 0;
    document.getElementById('inp-segmentMinLength').value = config.loli?.segmentedReply?.minLength ?? 10;
    document.getElementById('inp-segmentMaxLength').value = config.loli?.segmentedReply?.maxLength ?? 48;
    document.getElementById('inp-segmentMaxSegments').value = config.loli?.segmentedReply?.maxSegments ?? 5;
    document.getElementById('inp-segmentDelayMin').value = config.loli?.segmentedReply?.delayMin ?? 500;
    document.getElementById('inp-segmentDelayMax').value = config.loli?.segmentedReply?.delayMax ?? 1200;

    // Tab 3: Model parameters sheets
    const temp = config.loli?.temperature ?? -1;
    document.getElementById('inp-global-temp').value = temp;
    document.getElementById('val-global-temp').textContent = temp === -1 ? '默认 (-1)' : Number(temp).toFixed(1);

    const tokens = config.loli?.maxTokens ?? 0;
    document.getElementById('inp-global-tokens').value = tokens;
    document.getElementById('val-global-tokens').textContent = tokens === 0 ? '默认 (0)' : tokens;

    // Compress
    setSwitchState('sw-compress-enable', config.loli?.imageCompress?.enable);
    document.getElementById('inp-compress-maxLongEdge').value = config.loli?.imageCompress?.maxLongEdge || 1536;
    document.getElementById('inp-compress-quality').value = config.loli?.imageCompress?.quality || 85;
    document.getElementById('inp-compress-maxFileSizeKB').value = config.loli?.imageCompress?.maxFileSizeKB || 2048;

    // History Images
    setSwitchState('sw-history-enable', config.loli?.historyImages?.enable);
    document.getElementById('inp-history-maxImages').value = config.loli?.historyImages?.maxImages || 5;
    document.getElementById('inp-history-maxAgeSeconds').value = config.loli?.historyImages?.maxAgeSeconds || 300;
    document.getElementById('inp-history-contextLength').value = config.loli?.historyImages?.contextLength || 30;

    // Tab 4: Memory parameters sheets
    setSwitchState('sw-mem-group-enable', config.memory?.group?.enable);
    setSwitchState('sw-mem-user-enable', config.memory?.user?.enable);
    document.getElementById('inp-mem-group-model').value = config.memory?.group?.extractionModel || 'gemini-2.5-flash';
    document.getElementById('inp-mem-group-channel').value = config.memory?.group?.channelId || 'gemini';
    document.getElementById('inp-mem-user-model').value = config.memory?.user?.extractionModel || 'gemini-2.5-flash';
    document.getElementById('inp-mem-user-channel').value = config.memory?.user?.channelId || 'gemini';
    document.getElementById('inp-mem-refine-model').value = config.memory?.refinementModel || 'gemini-2.5-flash';
    document.getElementById('inp-mem-refine-channel').value = config.memory?.refinementChannelId || 'gemini';

    // Embedding
    setSwitchState('sw-embed-enable', config.memory?.embedding?.enable);
    document.getElementById('inp-embed-model').value = config.memory?.embedding?.model || 'gemini-embedding-2';
    document.getElementById('inp-embed-channel').value = config.memory?.embedding?.channelId || 'gemini';
    document.getElementById('inp-embed-dim').value = config.memory?.embedding?.outputDimensionality || 768;
    document.getElementById('inp-embed-topk').value = config.memory?.embedding?.topK || 8;
    document.getElementById('inp-embed-minScore').value = config.memory?.embedding?.minScore || 0.2;
    document.getElementById('inp-mem-group-enabledGroups').value = arrayToText(config.memory?.group?.enabledGroups);

    // Tab 5: System parameters sheets
    document.getElementById('inp-tpl-prefix').value = config.llm?.groupContextTemplatePrefix || '';
    document.getElementById('inp-tpl-message').value = config.llm?.groupContextTemplateMessage || '';
    document.getElementById('inp-tpl-suffix').value = config.llm?.groupContextTemplateSuffix || '';

    setSwitchState('sw-dash-enable', config.dashboard?.enable);
    document.getElementById('inp-dash-port').value = config.dashboard?.port || 3000;
    document.getElementById('inp-dash-host').value = config.dashboard?.host || '0.0.0.0';
    document.getElementById('inp-dash-token').value = config.dashboard?.authToken || '';

  } catch (err) {
    console.error(err);
  } finally {
    showLoading(false);
  }
}

async function handleSaveConfig() {
  if (!state.config) return;

  const sanitizeArray = (val) => {
    if (typeof val === 'string') {
      return val.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    }
    return [];
  };

  const payload = {
    loli: {
      enable: getSwitchState('sw-enable'),
      enableAtTrigger: getSwitchState('sw-enableAtTrigger'),
      enablePrefixTrigger: getSwitchState('sw-enablePrefixTrigger'),
      enableKeywordTrigger: getSwitchState('sw-enableKeywordTrigger'),
      enableProactiveTrigger: getSwitchState('sw-enableProactiveTrigger'),
      defaultPreset: document.getElementById('inp-defaultPreset').value.trim(),
      promptProbability: Number(document.getElementById('inp-promptProbability').value),
      triggerPrefix: sanitizeArray(document.getElementById('inp-triggerPrefix').value),
      triggerKeywords: sanitizeArray(document.getElementById('inp-triggerKeywords').value),
      groups: sanitizeArray(document.getElementById('inp-groups').value),
      blackGroups: sanitizeArray(document.getElementById('inp-blackGroups').value),
      blackUsers: sanitizeArray(document.getElementById('inp-blackUsers').value),
      
      // Session
      sendReasoning: getSwitchState('sw-sendReasoning'),
      conversationMode: document.getElementById('inp-conversationMode').value,
      contextLength: Number(document.getElementById('inp-contextLength').value) || 30,
      sessionWindow: Number(document.getElementById('inp-sessionWindow').value) || 300000,
      cooldownUser: Number(document.getElementById('inp-cooldownUser').value) || 3000,
      cooldownGroup: Number(document.getElementById('inp-cooldownGroup').value) || 1000,
      maxReplyBurst: Number(document.getElementById('inp-maxReplyBurst').value) || 0,
      burstCooldown: Number(document.getElementById('inp-burstCooldown').value) || 180000,
      recallDefault: Number(document.getElementById('inp-recallDefault').value) || 0,
      segmentedReply: {
        enable: getSwitchState('sw-segmentedReply'),
        minLength: Number(document.getElementById('inp-segmentMinLength').value),
        maxLength: Number(document.getElementById('inp-segmentMaxLength').value),
        maxSegments: Number(document.getElementById('inp-segmentMaxSegments').value),
        delayMin: Number(document.getElementById('inp-segmentDelayMin').value),
        delayMax: Number(document.getElementById('inp-segmentDelayMax').value)
      },
      
      // Model overrides
      temperature: Number(document.getElementById('inp-global-temp').value),
      maxTokens: Number(document.getElementById('inp-global-tokens').value),
      
      // Image compress
      imageCompress: {
        enable: getSwitchState('sw-compress-enable'),
        maxLongEdge: Number(document.getElementById('inp-compress-maxLongEdge').value) || 1536,
        quality: Number(document.getElementById('inp-compress-quality').value) || 85,
        maxFileSizeKB: Number(document.getElementById('inp-compress-maxFileSizeKB').value) || 2048
      },
      
      // History images
      historyImages: {
        enable: getSwitchState('sw-history-enable'),
        maxImages: Number(document.getElementById('inp-history-maxImages').value) || 5,
        maxAgeSeconds: Number(document.getElementById('inp-history-maxAgeSeconds').value) || 300,
        contextLength: Number(document.getElementById('inp-history-contextLength').value) || 30
      }
    },
    memory: {
      group: {
        enable: getSwitchState('sw-mem-group-enable'),
        enabledGroups: sanitizeArray(document.getElementById('inp-mem-group-enabledGroups').value),
        extractionModel: document.getElementById('inp-mem-group-model').value.trim(),
        channelId: document.getElementById('inp-mem-group-channel').value.trim()
      },
      user: {
        enable: getSwitchState('sw-mem-user-enable'),
        extractionModel: document.getElementById('inp-mem-user-model').value.trim(),
        channelId: document.getElementById('inp-mem-user-channel').value.trim()
      },
      refinementModel: document.getElementById('inp-mem-refine-model').value.trim(),
      refinementChannelId: document.getElementById('inp-mem-refine-channel').value.trim(),
      embedding: {
        enable: getSwitchState('sw-embed-enable'),
        model: document.getElementById('inp-embed-model').value.trim(),
        channelId: document.getElementById('inp-embed-channel').value.trim(),
        outputDimensionality: Number(document.getElementById('inp-embed-dim').value) || 768,
        topK: Number(document.getElementById('inp-embed-topk').value) || 8,
        minScore: Number(document.getElementById('inp-embed-minScore').value) || 0.2
      }
    },
    llm: {
      groupContextTemplatePrefix: document.getElementById('inp-tpl-prefix').value,
      groupContextTemplateMessage: document.getElementById('inp-tpl-message').value,
      groupContextTemplateSuffix: document.getElementById('inp-tpl-suffix').value
    },
    dashboard: {
      enable: getSwitchState('sw-dash-enable'),
      port: Number(document.getElementById('inp-dash-port').value) || 3000,
      host: document.getElementById('inp-dash-host').value.trim(),
      authToken: document.getElementById('inp-dash-token').value
    }
  };

  try {
    showLoading(true);
    await put('/config', payload);
    showToast('全局系统配置保存成功');
    syncConfig();
  } catch (err) {
    console.error(err);
  } finally {
    showLoading(false);
  }
}

// --- Tab 7: Logs ---
async function syncLogs(showSpinner = false) {
  try {
    if (showSpinner) showLoading(true);
    const rawLogs = await get('/logs');
    state.logs = Array.isArray(rawLogs) ? rawLogs : [];

    renderLogsStdout();
  } catch (err) {
    console.error(err);
  } finally {
    if (showSpinner) showLoading(false);
  }
}

function renderLogsStdout() {
  const container = document.getElementById('terminalLogs');
  if (!container) return;

  const levelSelect = document.getElementById('logs-level-select');
  const searchInput = document.getElementById('logs-search-input');
  
  const levelFilter = levelSelect ? levelSelect.value : 'ALL';
  const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

  const filtered = state.logs.filter(log => {
    const matchLevel = levelFilter === 'ALL' || log.level === levelFilter;
    const matchKeyword = !keyword || log.message.toLowerCase().includes(keyword);
    return matchLevel && matchKeyword;
  });

  const getLogLevelClass = (level) => {
    const map = {
      DEBUG: 'text-[#8e9099]',
      INFO: 'text-slate-300',
      WARN: 'text-[#fdd663]',
      ERROR: 'text-[#f28b82] font-bold'
    };
    return map[level] || 'text-slate-300';
  };

  const getLogLevelTagClass = (level) => {
    const map = {
      DEBUG: 'bg-[#2c2e35] text-[#cbd5e1] border-[#2c2e35]',
      INFO: 'bg-[#a8c7fa]/10 text-[#a8c7fa] border-[#a8c7fa]/20',
      WARN: 'bg-[#fdd663]/10 text-[#fdd663] border-[#fdd663]/20',
      ERROR: 'bg-[#f28b82]/10 text-[#f28b82] border-[#f28b82]/20'
    };
    return map[level] || 'bg-[#2c2e35] text-[#cbd5e1] border-[#2c2e35]';
  };

  if (filtered.length === 0) {
    container.innerHTML = `<div class="py-12 text-center text-slate-500 text-xs font-semibold">暂无匹配的终端日志输出</div>`;
    return;
  }

  container.innerHTML = filtered.map(log => `
    <div class="flex-row items-start gap-2 hover:bg-white/5 py-0.5 px-1 rounded transition-colors select-text">
      <span class="text-[#8e9099] select-none">[${escapeHtml(log.timestamp)}]</span>
      <span class="text-[9px] font-bold px-1.5 py-0.2 rounded border scale-90 select-none ${getLogLevelTagClass(log.level)}">${escapeHtml(log.level)}</span>
      <span class="break-all whitespace-pre-wrap select-text ${getLogLevelClass(log.level)}">${escapeHtml(log.message)}</span>
    </div>
  `).join('');

  // Scroll to bottom if auto refresh is enabled
  if (state.logsAutoRefresh) {
    container.scrollTop = container.scrollHeight;
  }
}

function startLogsPolling() {
  stopLogsPolling();
  state.logsRefreshTimer = setInterval(() => {
    if (state.logsAutoRefresh && state.currentPage === 'logs') {
      syncLogs(false);
    }
  }, 3000);
}

function stopLogsPolling() {
  if (state.logsRefreshTimer) {
    clearInterval(state.logsRefreshTimer);
    state.logsRefreshTimer = null;
  }
}

async function handleClearLogs() {
  try {
    showLoading(true);
    await post('/logs/clear');
    state.logs = [];
    renderLogsStdout();
    showToast('日志已清空');
  } catch (err) {
    console.error(err);
  } finally {
    showLoading(false);
  }
}

function handleCopyLogs() {
  const levelSelect = document.getElementById('logs-level-select');
  const searchInput = document.getElementById('logs-search-input');
  
  const levelFilter = levelSelect ? levelSelect.value : 'ALL';
  const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

  const filtered = state.logs.filter(log => {
    const matchLevel = levelFilter === 'ALL' || log.level === levelFilter;
    const matchKeyword = !keyword || log.message.toLowerCase().includes(keyword);
    return matchLevel && matchKeyword;
  });

  const text = filtered.map(l => `[${l.timestamp}] [${l.level}] ${l.message}`).join('\n');
  navigator.clipboard.writeText(text)
    .then(() => showToast('日志已复制到剪贴板'))
    .catch(() => showToast('复制失败，请手动选择复制', 'warning'));
}

// ================= Toggle Switches state management helpers =================

function getSwitchState(id) {
  const sw = document.getElementById(id);
  return sw ? sw.classList.contains('active') : false;
}

function setSwitchState(id, active) {
  const sw = document.getElementById(id);
  if (sw) {
    sw.classList.toggle('active', !!active);
  }
}

function initSwitchListeners() {
  document.body.addEventListener('click', (e) => {
    const sw = e.target.closest('.switch');
    if (sw) {
      sw.classList.toggle('active');
    }
  });
}

// ================= Mobile Navigation bar populator =================

function populateMobileBottomNav() {
  const nav = document.getElementById('bottomNav');
  if (!nav) return;

  const items = [
    { id: 'overview', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>', label: '总览' },
    { id: 'channels', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" x2="20" y1="21" y2="21"/><line x1="4" x2="20" y1="3" y2="3"/><line x1="12" x2="20" y1="12" y2="12"/><line x1="4" x2="8" y1="12" y2="12"/></svg>', label: '渠道' },
    { id: 'presets', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>', label: '预设' },
    { id: 'memory', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>', label: '记忆' },
    { id: 'config', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>', label: '设置' }
  ];

  nav.innerHTML = items.map(item => `
    <button class="bottom-nav-item ${item.id === state.currentPage ? 'active' : ''}" data-page="${item.id}">
      <span class="bottom-nav-icon">${item.icon}</span>
      <span class="bottom-nav-label">${item.label}</span>
    </button>
  `).join('');

  // Add click events on mobile bottom nav
  nav.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      navigate(btn.getAttribute('data-page'));
    });
  });
}

// ================= Touch Swiping Gestures & Edge Drawer Engine =================

function initTouchGestures() {
  const scroller = document.getElementById('contentScroller');
  const sidebar = document.getElementById('sidebar');
  const edgeHandle = document.getElementById('edgeGestureHandle');
  if (!scroller) return;

  let startX = 0;
  let startY = 0;
  let isEdgeDrag = false;
  let cancelSwipe = false;

  scroller.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;

    // 1. Detect edge pull
    isEdgeDrag = startX < 20;

    // 2. Swiping cancellation lists
    const target = touch.target;
    cancelSwipe = !!(
      target.closest('.ai-range-slider') ||
      target.closest('textarea') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest('table') ||
      target.closest('pre') ||
      target.closest('#terminalLogs')
    );

    if (isEdgeDrag && edgeHandle) {
      edgeHandle.classList.add('pulled');
    }
  }, { passive: true });

  scroller.addEventListener('touchmove', (e) => {
    if (cancelSwipe) return;
    if (!isEdgeDrag) return;
    
    const touch = e.touches[0];
    const diffX = touch.clientX - startX;
    
    // Dragged sufficiently to open menu drawer
    if (diffX > 50) {
      if (sidebar) sidebar.classList.add('open');
      isEdgeDrag = false;
      if (edgeHandle) edgeHandle.classList.remove('pulled');
    }
  }, { passive: true });

  scroller.addEventListener('touchend', (e) => {
    if (edgeHandle) edgeHandle.classList.remove('pulled');
    
    if (isEdgeDrag) {
      isEdgeDrag = false;
      return;
    }

    if (cancelSwipe) {
      cancelSwipe = false;
      return;
    }

    if (e.changedTouches.length !== 1) return;
    const touch = e.changedTouches[0];
    const diffX = touch.clientX - startX;
    const diffY = touch.clientY - startY;

    // Slope calculation: require a flat horizontal motion (diffX > 2 * diffY)
    if (Math.abs(diffX) > Math.abs(diffY) * 2.0 && Math.abs(diffX) > 75) {
      const currentIndex = PAGE_ORDER.indexOf(state.currentPage);
      if (diffX > 0) {
        // Swipe Right -> previous pane
        if (currentIndex > 0) {
          navigate(PAGE_ORDER[currentIndex - 1]);
        }
      } else {
        // Swipe Left -> next pane
        if (currentIndex < PAGE_ORDER.length - 1) {
          navigate(PAGE_ORDER[currentIndex + 1]);
        }
      }
    }
  }, { passive: true });
}

// ================= Listeners Declarations =================

function initSidebarToggle() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebarClose = document.getElementById('sidebarClose');
  const sidebar = document.getElementById('sidebar');

  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.add('open');
    });
  }

  if (sidebarClose && sidebar) {
    sidebarClose.addEventListener('click', () => {
      sidebar.classList.remove('open');
    });
  }
}

function initSidebarCollapse() {
  const btn = document.getElementById('sidebarCollapseTrigger');
  const sidebar = document.getElementById('sidebar');
  if (!btn || !sidebar) return;

  // Read cache
  const isCollapsed = localStorage.getItem('hina-sidebar-collapsed') === 'true';
  state.isSidebarCollapsed = isCollapsed;
  sidebar.classList.toggle('collapsed', isCollapsed);
  
  btn.querySelector('.collapse-icon-left').classList.toggle('hidden', isCollapsed);
  btn.querySelector('.collapse-icon-right').classList.toggle('hidden', !isCollapsed);

  btn.addEventListener('click', () => {
    const nextState = !state.isSidebarCollapsed;
    state.isSidebarCollapsed = nextState;
    localStorage.setItem('hina-sidebar-collapsed', String(nextState));
    
    sidebar.classList.toggle('collapsed', nextState);
    btn.querySelector('.collapse-icon-left').classList.toggle('hidden', nextState);
    btn.querySelector('.collapse-icon-right').classList.toggle('hidden', !nextState);
  });
}

function initRangeSliders() {
  // Sync Range value badge indicators in real time
  
  // 1. Presets Temp slider
  const tempInp = document.getElementById('preset-form-temp');
  const tempVal = document.getElementById('preset-form-temp-val');
  if (tempInp && tempVal) {
    tempInp.addEventListener('input', (e) => {
      tempVal.textContent = Number(e.target.value).toFixed(1);
    });
  }

  // 2. Presets Tokens slider
  const tokensInp = document.getElementById('preset-form-tokens');
  const tokensVal = document.getElementById('preset-form-tokens-val');
  if (tokensInp && tokensVal) {
    tokensInp.addEventListener('input', (e) => {
      tokensVal.textContent = e.target.value;
    });
  }

  // 3. Config Proactive probability
  const probInp = document.getElementById('inp-promptProbability');
  const probVal = document.getElementById('val-promptProbability');
  if (probInp && probVal) {
    probInp.addEventListener('input', (e) => {
      probVal.textContent = Number(e.target.value).toFixed(2);
    });
  }

  // 4. Config global temperature cover
  const gTemp = document.getElementById('inp-global-temp');
  const gTempVal = document.getElementById('val-global-temp');
  if (gTemp && gTempVal) {
    gTemp.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      gTempVal.textContent = v === -1 ? '默认 (-1)' : v.toFixed(1);
    });
  }

  // 5. Config global max tokens cover
  const gTok = document.getElementById('inp-global-tokens');
  const gTokVal = document.getElementById('val-global-tokens');
  if (gTok && gTokVal) {
    gTok.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      gTokVal.textContent = v === 0 ? '默认 (0)' : v;
    });
  }
}

function initConfigTabs() {
  const container = document.querySelector('.config-sheets-container');
  if (!container) return;

  document.querySelectorAll('.config-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Deactivate others
      document.querySelectorAll('.config-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.config-sheet').forEach(s => s.classList.remove('active'));

      // Activate clicked
      btn.classList.add('active');
      const targetSheet = document.getElementById(`sheet-${btn.getAttribute('data-tab')}`);
      if (targetSheet) {
        targetSheet.classList.add('active');
      }
    });
  });
}

function initLogsHandlers() {
  const levelSelect = document.getElementById('logs-level-select');
  const searchInput = document.getElementById('logs-search-input');
  
  if (levelSelect) {
    levelSelect.addEventListener('change', renderLogsStdout);
  }
  if (searchInput) {
    searchInput.addEventListener('input', renderLogsStdout);
  }

  // Auto-refresh toggle
  const toggleBtn = document.getElementById('logsToggleRefreshBtn');
  const toggleText = document.getElementById('logsToggleRefreshText');
  if (toggleBtn && toggleText) {
    toggleBtn.addEventListener('click', () => {
      const next = !state.logsAutoRefresh;
      state.logsAutoRefresh = next;
      
      toggleText.textContent = next ? '暂停刷新' : '自动刷新';
      toggleBtn.classList.toggle('active', !next);
      showToast(next ? '开启自动更新日志' : '暂停日志自动滚动');
    });
  }
}

function initAuthHandlers() {
  const submitBtn = document.getElementById('authSubmitBtn');
  const input = document.getElementById('auth-token-input');
  const errEl = document.getElementById('authErrorMsg');

  const attemptLogin = async () => {
    const val = input.value.trim();
    if (!val) {
      showToast('请输入访问令牌', 'warning');
      return;
    }

    try {
      showLoading(true);
      errEl.classList.add('hidden');
      
      // Attempt status call using the new token in temporary headers
      const res = await fetch(`${API_BASE}/system/status`, {
        headers: { 'Authorization': `Bearer ${val}` }
      });

      if (res.ok) {
        localStorage.setItem('loli-dashboard-token', val);
        showAuthOverlay(false);
        showToast('令牌校验成功，欢迎进入控制台');
        
        // Trigger dashboard reload
        state.authorized = true;
        navigate('overview');
      } else {
        errEl.textContent = 'Token 校验失败，请重试';
        errEl.classList.remove('hidden');
      }
    } catch (err) {
      errEl.textContent = `网络错误: ${err.message}`;
      errEl.classList.remove('hidden');
    } finally {
      showLoading(false);
    }
  };

  if (submitBtn) {
    submitBtn.addEventListener('click', attemptLogin);
  }
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') attemptLogin();
    });
  }

  // Logout handler
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('loli-dashboard-token');
      showAuthOverlay(true);
      showToast('您已安全登出控制台');
    });
  }
}

function initToolUploadZone() {
  const zone = document.getElementById('toolDropZone');
  const fileInput = document.getElementById('tool-form-file');
  if (!zone || !fileInput) return;

  zone.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleSelectToolFile(e.target.files[0]);
    }
  });

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dragover');
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleSelectToolFile(e.dataTransfer.files[0]);
    }
  });
}

function initMemoryCopy() {
  const btn = document.getElementById('copyMemPathBtn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const path = document.getElementById('mem-db-path').textContent.trim();
    navigator.clipboard.writeText(path)
      .then(() => showToast('SQLite 物理路径已成功复制到剪贴板'))
      .catch(() => showToast('复制失败，请手动选择复制', 'warning'));
  });
}

// Global refresher
window.refreshAllData = () => {
  loadTabData(state.currentPage);
  showToast('控制台数据已完成同步');
};

// ================= Global Entry Initialization =================

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Setup Navigation items click listeners
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.getAttribute('data-page');
      navigate(page);
    });
  });

  // 2. Initialize bottom navigation and elements
  populateMobileBottomNav();
  initSidebarToggle();
  initSidebarCollapse();
  initSwitchListeners();
  initRangeSliders();
  initConfigTabs();
  initLogsHandlers();
  initAuthHandlers();
  initToolUploadZone();
  initMemoryCopy();
  initTouchGestures();

  // 3. Setup initial auth verification
  const token = localStorage.getItem('loli-dashboard-token');
  try {
    const healthRes = await fetch(`${API_BASE}/health`);
    if (!healthRes.ok) throw new Error(`HTTP ${healthRes.status}`);
    const health = await healthRes.json();

    if (health.authRequired && !token) {
      showAuthOverlay(true);
      return;
    }

    state.authorized = true;
    let hash = window.location.hash.replace('#', '');
    if (!PAGE_ORDER.includes(hash)) hash = 'overview';
    navigate(hash);
  } catch (err) {
    showToast(`无法连接管理面板服务: ${err.message}`, 'error');
    showAuthOverlay(false);
  }
});
