import React, { useState, useEffect, useRef, useCallback } from 'react'
import { api } from './api'
import Icon from './icons.jsx'
import Petals from './particles.jsx'
import Overview from './pages/Overview.jsx'
import Channels from './pages/Channels.jsx'
import Presets from './pages/Presets.jsx'
import Tools from './pages/Tools.jsx'
import Extensions from './pages/Extensions.jsx'
import Memory from './pages/Memory.jsx'
import Config from './pages/Config.jsx'
import Logs from './pages/Logs.jsx'

import SidebarFooter from './SidebarFooter.jsx'
import Preloader from './components/Preloader.jsx'
import { burstSparkles } from './fx.js'

const PAGES = [
  { id: 'overview', title: '// 总览 WORKSPACE', short: '总览', tone: '#8ec5ff' },
  { id: 'channels', title: '// AI 渠道管理', short: '渠道', tone: '#7ee8d8' },
  { id: 'presets', title: '// 预设角色管理', short: '预设', tone: '#d6b4ff' },
  { id: 'tools', title: '// 工具扩展插件', short: '工具', tone: '#ffd28e' },
  { id: 'extensions', title: '// MCP 与 Agent Skills', short: '扩展', tone: '#8ee8ff' },
  { id: 'memory', title: '// 记忆系统', short: '记忆', tone: '#8effc1' },
  { id: 'config', title: '// 系统参数配置', short: '配置', tone: '#ffb3c1' },
  { id: 'logs', title: '// 终端日志', short: '日志', tone: '#9fb7ff' }
]
const PAGE_ORDER = PAGES.map(p => p.id)
const PAGE_TITLES = Object.fromEntries(PAGES.map(p => [p.id, p.title]))
const PAGE_SHORT = Object.fromEntries(PAGES.map(p => [p.id, p.short]))
const PAGE_TONES = Object.fromEntries(PAGES.map(p => [p.id, p.tone]))

export default function App() {
  const [activeTab, setActiveTab] = useState('overview')
  const [authorized, setAuthorized] = useState(false)
  const [authRequired, setAuthRequired] = useState(false)
  const [authTokenInput, setAuthTokenInput] = useState('')
  const [authError, setAuthError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [toasts, setToasts] = useState([])

  // 预加载页：首屏数据就绪（或进入登录门）后淡出
  const [booted, setBooted] = useState(false)
  const [bootFading, setBootFading] = useState(false)
  const [preloaderGone, setPreloaderGone] = useState(false)
  const bootStartRef = useRef(Date.now())

  // Page data
  const [system, setSystem] = useState(null)
  const [channels, setChannels] = useState([])
  const [presets, setPresets] = useState([])
  const [tools, setTools] = useState([])
  const [memory, setMemory] = useState(null)
  const [localConfig, setLocalConfig] = useState(null)
  const configRevisionRef = useRef(null)

  // Logs
  const [logs, setLogs] = useState([])
  const [logsAutoRefresh, setLogsAutoRefresh] = useState(true)
  const [logsLevelFilter, setLogsLevelFilter] = useState('ALL')
  const [logsSearchQuery, setLogsSearchQuery] = useState('')

  const activeTabRef = useRef(activeTab)
  activeTabRef.current = activeTab

  /* ─── Toast ─── */
  const showToast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type, exiting: false }])
    // 先标记退场播放滑出动画，再移除
    setTimeout(() => setToasts(prev => prev.map(t => (t.id === id ? { ...t, exiting: true } : t))), 2700)
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }, [])

  const runTask = useCallback(async (fn) => {
    setLoading(true)
    try {
      await fn()
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  /* ─── Data syncing ─── */
  const syncOverview = useCallback(async () => {
    const [statusRes, channelsRes, toolsRes] = await Promise.all([
      api.get('/system/status'), api.get('/channels'), api.get('/tools')
    ])
    setSystem(statusRes)
    setChannels(channelsRes)
    setTools(toolsRes)
  }, [])

  const syncChannels = useCallback(async () => setChannels(await api.get('/channels')), [])

  const syncPresets = useCallback(async () => {
    const [presetsRes, channelsRes] = await Promise.all([api.get('/presets'), api.get('/channels')])
    setPresets(presetsRes)
    setChannels(channelsRes)
  }, [])

  const syncTools = useCallback(async () => setTools(await api.get('/tools')), [])
  const syncMemory = useCallback(async () => setMemory(await api.get('/memory/stats')), [])

  const syncConfig = useCallback(async () => {
    const [response, channelsRes] = await Promise.all([api.getWithMeta('/config'), api.get('/channels')])
    setChannels(channelsRes)
    const configRes = response.data
    configRevisionRef.current = response.headers.get('etag')
    const local = JSON.parse(JSON.stringify(configRes))
    const arrayFields = [
      ['loli', 'triggerPrefix'], ['loli', 'triggerKeywords'], ['loli', 'groups'],
      ['loli', 'blackGroups'], ['loli', 'blackUsers'], ['memory', 'group', 'enabledGroups'],
      ['dokobot', 'allowedDomains'], ['sandbox', 'fetchAllowedDomains'],
      ['skills', 'directories'], ['skills', 'disabled']
    ]
    arrayFields.forEach(keys => {
      let target = local
      for (let i = 0; i < keys.length - 1; i++) {
        if (!target) return
        target = target[keys[i]]
      }
      const lastKey = keys[keys.length - 1]
      if (target && Array.isArray(target[lastKey])) target[lastKey] = target[lastKey].join('\n')
    })
    // MCP 服务器保持结构化数组，补充编辑态文本字段（args/headers 按行编辑）
    // _key 为前端渲染/折叠状态的稳定标识，保存时剔除
    if (local.mcp) {
      const servers = Array.isArray(local.mcp.servers) ? local.mcp.servers : []
      local.mcp.servers = servers.map((server, index) => ({
        ...server,
        _key: `mcp_${index}_${Math.random().toString(36).slice(2, 8)}`,
        argsText: Array.isArray(server.args) ? server.args.join('\n') : '',
        headersText: Object.entries(server.headers || {}).map(([k, v]) => `${k}=${v}`).join('\n')
      }))
    }
    if (!local.loli.masterIdentity) {
      local.loli.masterIdentity = { enable: true, autoDetect: true, appellation: '', users: [], userIds: [] }
    }
    if (!local.stickers) {
      local.stickers = { enable: true, autoCollectMaster: true, autoClassify: true, probability: 35, cooldownMs: 60 }
    } else {
      if (local.stickers.probability !== undefined) local.stickers.probability = Math.round(Number(local.stickers.probability) * 100)
      if (local.stickers.cooldownMs !== undefined) local.stickers.cooldownMs = Math.round(Number(local.stickers.cooldownMs) / 1000)
    }
    // 轻互动（表情回应/戳一戳）：冷却毫秒 → 秒
    if (!local.interactions) {
      local.interactions = {
        enable: true,
        reaction: { enable: true, probability: 0.25, cooldownMs: 45 },
        poke: { enable: true, returnProbability: 0.35, cooldownMs: 300, dailyUserLimit: 3 }
      }
    } else {
      if (local.interactions.reaction?.cooldownMs !== undefined) local.interactions.reaction.cooldownMs = Math.round(Number(local.interactions.reaction.cooldownMs) / 1000)
      if (local.interactions.poke?.cooldownMs !== undefined) local.interactions.poke.cooldownMs = Math.round(Number(local.interactions.poke.cooldownMs) / 1000)
    }
    setLocalConfig(local)
  }, [])

  const syncLogs = useCallback(async () => {
    const rawLogs = await api.get('/logs')
    setLogs(Array.isArray(rawLogs) ? rawLogs : [])
  }, [])

  const loadTabData = useCallback((tab) => {
    if (!authorized) return Promise.resolve()
    const syncs = {
      overview: syncOverview, channels: syncChannels, presets: syncPresets,
      tools: syncTools, extensions: syncConfig, memory: syncMemory, config: syncConfig, logs: syncLogs
    }
    return runTask(syncs[tab])
  }, [authorized, runTask, syncOverview, syncChannels, syncPresets, syncTools, syncMemory, syncConfig, syncLogs])

  /* ─── Auth ─── */
  const fetchHealth = useCallback(async () => {
    try {
      const res = await api.get('/health')
      setAuthRequired(res.authRequired)
      const localToken = localStorage.getItem('loli-dashboard-token')
      if (!res.authRequired || localToken) {
        setAuthorized(true)
      } else {
        setAuthorized(false)
      }
    } catch {
      showToast('无法连接后台服务', 'error')
    }
  }, [showToast])

  const verifyToken = async () => {
    if (!authTokenInput.trim()) {
      setAuthError('请输入验证令牌')
      return
    }
    setLoading(true)
    setAuthError('')
    try {
      localStorage.setItem('loli-dashboard-token', authTokenInput.trim())
      const statusRes = await fetch('/api/system/status', {
        headers: { Authorization: `Bearer ${authTokenInput.trim()}` }
      })
      if (statusRes.ok) {
        setAuthorized(true)
        showToast('令牌验证成功')
      } else {
        localStorage.removeItem('loli-dashboard-token')
        setAuthError('验证失败，令牌错误')
      }
    } catch (err) {
      localStorage.removeItem('loli-dashboard-token')
      setAuthError(err.message || '网络连接异常')
    } finally {
      setLoading(false)
    }
  }

  const logout = () => {
    localStorage.removeItem('loli-dashboard-token')
    setAuthorized(false)
    setAuthTokenInput('')
    showToast('已退出登录')
  }

  /* ─── Config save ─── */
  const saveConfig = () => runTask(async () => {
    if (!localConfig) return
    const payload = JSON.parse(JSON.stringify(localConfig))
    const toArray = (text) => {
      if (typeof text === 'string') return text.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
      return Array.isArray(text) ? text : []
    }
    // 每行 KEY=VALUE（或 KEY: VALUE）→ 对象，用于 MCP 请求头
    const parseKeyValueLines = (text) => Object.fromEntries(
      String(text || '').split('\n').map(line => line.trim()).filter(Boolean)
        .map(line => {
          const eq = line.indexOf('=')
          const sep = eq >= 0 ? eq : line.indexOf(':')
          if (sep <= 0) return null
          return [line.slice(0, sep).trim(), line.slice(sep + 1).trim()]
        })
        .filter(Boolean)
    )
    payload.loli.triggerPrefix = toArray(localConfig.loli.triggerPrefix)
    payload.loli.triggerKeywords = toArray(localConfig.loli.triggerKeywords)
    payload.loli.groups = toArray(localConfig.loli.groups)
    payload.loli.blackGroups = toArray(localConfig.loli.blackGroups)
    payload.loli.blackUsers = toArray(localConfig.loli.blackUsers)
    payload.memory.group.enabledGroups = toArray(localConfig.memory.group.enabledGroups)
    payload.dokobot.allowedDomains = toArray(localConfig.dokobot.allowedDomains)
    payload.skills.directories = toArray(localConfig.skills.directories)
    payload.skills.disabled = toArray(localConfig.skills.disabled)
    // MCP 服务器：结构化编辑 → 提交前还原 args/headers，剔除编辑态字段
    payload.mcp.servers = (Array.isArray(localConfig.mcp.servers) ? localConfig.mcp.servers : []).map((server, index) => {
      const { _key, argsText, headersText, ...rest } = server
      return {
        ...rest,
        id: String(server.id || '').trim() || `server_${index + 1}`,
        transport: server.transport === 'stdio' ? 'stdio' : 'streamable-http',
        url: String(server.url || '').trim(),
        command: String(server.command || '').trim(),
        args: String(argsText || '').split('\n').map(s => s.trim()).filter(Boolean),
        headers: parseKeyValueLines(headersText)
      }
    })

    const N = Number
    payload.loli.promptProbability = N(localConfig.loli.promptProbability)
    payload.loli.contextLength = N(localConfig.loli.contextLength) || 30
    payload.loli.sessionWindow = N(localConfig.loli.sessionWindow) || 300000
    payload.loli.cooldownUser = N(localConfig.loli.cooldownUser) || 3000
    payload.loli.cooldownGroup = N(localConfig.loli.cooldownGroup) || 1000
    payload.loli.maxReplyBurst = N(localConfig.loli.maxReplyBurst) || 0
    payload.loli.burstCooldown = N(localConfig.loli.burstCooldown) || 180000
    payload.loli.recallDefault = N(localConfig.loli.recallDefault) || 0
    payload.loli.segmentedReply.minLength = N(localConfig.loli.segmentedReply.minLength)
    payload.loli.segmentedReply.maxLength = N(localConfig.loli.segmentedReply.maxLength)
    payload.loli.segmentedReply.maxSegments = N(localConfig.loli.segmentedReply.maxSegments)
    payload.loli.segmentedReply.delayMin = N(localConfig.loli.segmentedReply.delayMin)
    payload.loli.segmentedReply.delayMax = N(localConfig.loli.segmentedReply.delayMax)
    delete payload.loli.temperature
    payload.loli.maxTokens = N(localConfig.loli.maxTokens)
    payload.loli.imageCompress.maxLongEdge = N(localConfig.loli.imageCompress.maxLongEdge) || 1536
    payload.loli.imageCompress.quality = N(localConfig.loli.imageCompress.quality) || 85
    payload.loli.imageCompress.maxFileSizeKB = N(localConfig.loli.imageCompress.maxFileSizeKB) || 2048
    payload.loli.historyImages.maxImages = N(localConfig.loli.historyImages.maxImages) || 5
    payload.loli.historyImages.maxAgeSeconds = N(localConfig.loli.historyImages.maxAgeSeconds) || 300
    payload.loli.historyImages.contextLength = N(localConfig.loli.historyImages.contextLength) || 30
    payload.sandbox.requestTimeoutSeconds = N(localConfig.sandbox.requestTimeoutSeconds) || 120
    payload.sandbox.sandboxTimeoutSeconds = N(localConfig.sandbox.sandboxTimeoutSeconds) || 300
    payload.sandbox.quicksandMemoryMiB = N(localConfig.sandbox.quicksandMemoryMiB) || 512
    payload.sandbox.quicksandCpus = 1
    payload.sandbox.fetchAllowedDomains = typeof localConfig.sandbox.fetchAllowedDomains === 'string'
      ? localConfig.sandbox.fetchAllowedDomains.split(/\n/).map(s => s.trim()).filter(Boolean)
      : (Array.isArray(localConfig.sandbox.fetchAllowedDomains) ? localConfig.sandbox.fetchAllowedDomains : [])
    payload.sandbox.fetchMaxBytesMiB = Math.max(1, Math.min(20, N(localConfig.sandbox.fetchMaxBytesMiB) || 20))
    payload.sandbox.fetchTimeoutSeconds = Math.max(5, Math.min(120, N(localConfig.sandbox.fetchTimeoutSeconds) || 30))
    payload.sandbox.fullNetworkTimeoutSeconds = Math.max(5, Math.min(120, N(localConfig.sandbox.fullNetworkTimeoutSeconds) || 60))
    if (payload.llm?.groupTimeline) {
      payload.llm.groupTimeline.maxChars = Math.max(500, Math.min(12000, N(localConfig.llm.groupTimeline.maxChars) || 3000))
    }
    payload.memory.groupLearning.minMessages = N(localConfig.memory.groupLearning.minMessages) || 100
    payload.memory.groupLearning.updateEveryMessages = N(localConfig.memory.groupLearning.updateEveryMessages) || 50
    payload.memory.groupLearning.minActiveUsers = N(localConfig.memory.groupLearning.minActiveUsers) || 5
    payload.memory.groupLearning.windowDays = N(localConfig.memory.groupLearning.windowDays) || 14
    payload.memory.groupLearning.autoApplyMinConfidence = N(localConfig.memory.groupLearning.autoApplyMinConfidence) || 0.72
    payload.memory.groupLearning.maxSamplesPerUser = N(localConfig.memory.groupLearning.maxSamplesPerUser) || 30
    payload.memory.messageRetentionDays = Math.max(1, N(localConfig.memory.messageRetentionDays) || 30)
    payload.memory.memberLearning.minMessages = N(localConfig.memory.memberLearning.minMessages) || 12
    payload.memory.memberLearning.updateEveryMessages = N(localConfig.memory.memberLearning.updateEveryMessages) || 8
    payload.memory.memberLearning.windowDays = N(localConfig.memory.memberLearning.windowDays) || 30
    payload.memory.memberLearning.reviewMaxMessages = N(localConfig.memory.memberLearning.reviewMaxMessages) || 50
    payload.memory.memberLearning.autoApplyMinConfidence = N(localConfig.memory.memberLearning.autoApplyMinConfidence) || 0.72
    payload.memory.memberLearning.injectMinConfidence = N(localConfig.memory.memberLearning.injectMinConfidence) || 0.68
    payload.stickers.probability = Math.max(0, Math.min(1, N(localConfig.stickers.probability) / 100 || 0))
    payload.stickers.cooldownMs = Math.max(0, N(localConfig.stickers.cooldownMs) * 1000 || 0)
    // 轻互动：概率收敛 0-1，冷却秒 → 毫秒
    if (payload.interactions && localConfig.interactions) {
      payload.interactions.reaction.probability = Math.max(0, Math.min(1, N(localConfig.interactions.reaction?.probability) || 0))
      payload.interactions.reaction.cooldownMs = Math.max(0, N(localConfig.interactions.reaction?.cooldownMs) * 1000 || 0)
      payload.interactions.poke.returnProbability = Math.max(0, Math.min(1, N(localConfig.interactions.poke?.returnProbability) || 0))
      payload.interactions.poke.cooldownMs = Math.max(0, N(localConfig.interactions.poke?.cooldownMs) * 1000 || 0)
      payload.interactions.poke.dailyUserLimit = N(localConfig.interactions.poke?.dailyUserLimit) || 0
    }
    payload.dashboard.port = N(localConfig.dashboard.port) || 3000
    payload.dokobot.timeoutSeconds = Math.max(5, Math.min(300, N(localConfig.dokobot.timeoutSeconds) || 60))
    payload.dokobot.screens = Math.max(1, Math.min(20, N(localConfig.dokobot.screens) || 3))
    payload.dokobot.maxTextChars = Math.max(1000, Math.min(50000, N(localConfig.dokobot.maxTextChars) || 12000))
    payload.mcp.connectTimeoutMs = Math.max(1000, Math.min(60000, N(localConfig.mcp.connectTimeoutMs) || 10000))
    payload.mcp.callTimeoutMs = Math.max(1000, Math.min(300000, N(localConfig.mcp.callTimeoutMs) || 60000))

    const revision = configRevisionRef.current
    try {
      await api.put('/config', payload, revision ? { 'If-Match': revision } : {})
    } catch (err) {
      // 后台自动保存（主人身份捕获/表情收录/学习调度）会顶掉修订号导致 409：
      // 面板提交的是全量配置，对齐最新修订号重试一次，避免用户配置静默丢失。
      if (err?.status !== 409) throw err
      const fresh = await api.getWithMeta('/config')
      configRevisionRef.current = fresh.headers.get('etag')
      await api.put('/config', payload, configRevisionRef.current ? { 'If-Match': configRevisionRef.current } : {})
    }
    const nextToken = String(payload.dashboard?.authToken || '').trim()
    if (nextToken) localStorage.setItem('loli-dashboard-token', nextToken)
    else localStorage.removeItem('loli-dashboard-token')
    setAuthRequired(Boolean(nextToken))
    showToast('全局系统配置保存成功')
    await syncConfig()
  })

  /* ─── Effects ─── */
  useEffect(() => {
    fetchHealth()
    const onHash = () => {
      const hash = window.location.hash.replace('#', '')
      if (PAGE_ORDER.includes(hash)) setActiveTab(hash)
    }
    window.addEventListener('hashchange', onHash)
    const onUnauthorized = () => setAuthorized(false)
    const onErrorToast = (e) => showToast(e.detail, 'error')
    window.addEventListener('loli-unauthorized', onUnauthorized)
    window.addEventListener('loli-error-toast', onErrorToast)
    onHash()
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('loli-unauthorized', onUnauthorized)
      window.removeEventListener('loli-error-toast', onErrorToast)
    }
  }, [fetchHealth, showToast])

  useEffect(() => {
    if (authorized) {
      Promise.resolve(loadTabData(activeTab))
        .catch(() => {})
        .finally(() => setBooted(true))
    }
  }, [activeTab, authorized]) // eslint-disable-line react-hooks/exhaustive-deps

  // 预加载页：就绪后播放淡出再卸载；至少展示 900ms；8s 兜底避免后台异常时卡死
  const bootReady = booted || (authRequired && !authorized)
  useEffect(() => {
    const failsafe = setTimeout(() => setBooted(true), 8000)
    return () => clearTimeout(failsafe)
  }, [])
  useEffect(() => {
    if (!bootReady) return undefined
    const wait = Math.max(0, 900 - (Date.now() - bootStartRef.current))
    const t1 = setTimeout(() => setBootFading(true), wait)
    const t2 = setTimeout(() => setPreloaderGone(true), wait + 500)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [bootReady])

  // 全局：主按钮点击时星光迸发
  useEffect(() => {
    const onClick = (e) => {
      const btn = e.target.closest?.('.btn-primary')
      if (btn && !btn.disabled) burstSparkles(e)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  // 主动切换页签：同步写入 hash（hashchange 不会再回写）
  const changeTab = (tab) => {
    setActiveTab(tab)
    window.location.hash = tab
  }

  // 日志轮询
  useEffect(() => {
    if (activeTab !== 'logs' || !logsAutoRefresh || !authorized) return undefined
    const id = setInterval(() => {
      syncLogs().catch(err => console.error(err))
    }, 3000)
    return () => clearInterval(id)
  }, [activeTab, logsAutoRefresh, authorized, syncLogs])

  /* ─── Page props ─── */
  const common = { showToast, runTask }
  const pages = {
    overview: <Overview system={system} channels={channels} tools={tools} onRefresh={() => loadTabData('overview')} onNavigate={changeTab} />,
    channels: <Channels channels={channels} refresh={syncChannels} {...common} />,
    presets: <Presets presets={presets} channels={channels} refresh={syncPresets} {...common} />,
    tools: <Tools tools={tools} refresh={syncTools} {...common} />,
    extensions: <Extensions localConfig={localConfig} setLocalConfig={setLocalConfig} saveConfig={saveConfig} {...common} />,
    memory: <Memory memory={memory} showToast={showToast} />,
    config: <Config localConfig={localConfig} setLocalConfig={setLocalConfig} saveConfig={saveConfig} channels={channels} />,
    logs: (
      <Logs
        logs={logs}
        autoRefresh={logsAutoRefresh} setAutoRefresh={setLogsAutoRefresh}
        levelFilter={logsLevelFilter} setLevelFilter={setLogsLevelFilter}
        searchQuery={logsSearchQuery} setSearchQuery={setLogsSearchQuery}
        onClear={() => runTask(async () => { await api.post('/logs/clear'); setLogs([]); showToast('日志已清空') })}
        onCopy={() => {
          const text = logs.filter(l => (logsLevelFilter === 'ALL' || l.level === logsLevelFilter) && (!logsSearchQuery.trim() || l.message.toLowerCase().includes(logsSearchQuery.trim().toLowerCase()))).map(l => `[${l.timestamp}] [${l.level}] ${l.message}`).join('\n')
          navigator.clipboard.writeText(text).then(() => showToast('日志已复制到剪贴板')).catch(() => showToast('复制失败，请手动选择复制', 'warning'))
        }}
      />
    )
  }

  return (
    <div className="app">
      <Petals />
      {!preloaderGone && <Preloader fading={bootFading} />}

      {/* Sidebar */}
      <aside className={`sidebar${isSidebarCollapsed ? ' collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="logo">
            <div className="logo-icon" style={{ '--tone': PAGE_TONES.presets }}>
              <Icon name="presets" size={18} />
            </div>
            <div className="logo-text-wrapper">
              <span className="logo-text">Hina AI Studio</span>
              <span className="logo-subtext">WORKSPACE // DEV</span>
            </div>
          </div>
        </div>

        <nav className="nav">
          {PAGE_ORDER.map(page => (
            <a
              key={page}
              href={'#' + page}
              className={`nav-item${activeTab === page ? ' active' : ''}`}
              style={{ '--tone': PAGE_TONES[page] }}
              onClick={(e) => { e.preventDefault(); changeTab(page) }}
            >
              <span className="nav-icon-wrapper"><Icon name={page} size={18} /></span>
              <span className="nav-label">{PAGE_TITLES[page].replace('// ', '')}</span>
            </a>
          ))}
        </nav>

        <SidebarFooter
          collapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(v => !v)}
          authRequired={authRequired}
          onLogout={logout}
        />
      </aside>

      {/* Main */}
      <div className="main">
        <header className="header">
          <div className="header-left">
            <h1 className="page-title" key={activeTab} style={{ '--tone': PAGE_TONES[activeTab] }}>{PAGE_TITLES[activeTab]}</h1>
          </div>
          <div className="header-right">
            <div className={`global-spinner${loading ? '' : ' hidden'}`}></div>
          </div>
        </header>

        <div className="content-scroller">
          {PAGE_ORDER.map(page => (
            <div key={page} className={`page-pane${activeTab === page ? ' active' : ''}`} style={{ '--tone': PAGE_TONES[page] }}>
              {activeTab === page && pages[page]}
            </div>
          ))}
        </div>
      </div>

      {/* 移动端底部导航 */}
      <nav className="bottom-nav">
        {PAGE_ORDER.map(page => (
          <a
            key={page}
            href={'#' + page}
            className={`bottom-nav-item${activeTab === page ? ' active' : ''}`}
            style={{ '--tone': PAGE_TONES[page] }}
            onClick={(e) => { e.preventDefault(); changeTab(page) }}
          >
            <span className="nav-icon-wrapper"><Icon name={page} size={20} /></span>
            <span>{PAGE_SHORT[page]}</span>
          </a>
        ))}
      </nav>

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}${t.exiting ? ' exiting' : ''}`}>
            <span className="toast-text">{t.message}</span>
          </div>
        ))}
      </div>

      {/* Auth gate */}
      {authRequired && !authorized && (
        <div className="auth-overlay">
          <div className="auth-card">
            <div className="auth-header">
              <div className="auth-icon" style={{ '--tone': PAGE_TONES.presets }}>
                <Icon name="shield" size={24} />
              </div>
              <h2 className="auth-title">登入 Hina AI Studio</h2>
              <p className="auth-subtitle">此服务受到安全令牌保护，请输入机器人管理员配置的 `authToken` 进行身份校验</p>
            </div>
            <div className="auth-body">
              <div className="flex-column gap-2">
                <label className="text-xs text-muted font-medium">安全访问令牌 (authToken)</label>
                <input
                  type="password"
                  value={authTokenInput}
                  onChange={e => setAuthTokenInput(e.target.value)}
                  placeholder="输入验证令牌"
                  className="form-input text-center font-mono py-2"
                  onKeyDown={e => e.key === 'Enter' && verifyToken()}
                />
              </div>
              <button className="btn btn-primary w-full py-2.5 mt-2" onClick={verifyToken}>验证并登入</button>
              {authError && <p className="font-mono text-[10px] text-center mt-2 text-danger">{authError}</p>}
            </div>
            <div className="auth-footer text-[9px]">GEHENNA BOT WORKSPACE SECURE GATEWAY</div>
          </div>
        </div>
      )}
    </div>
  )
}
