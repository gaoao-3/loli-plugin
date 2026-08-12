import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import Icon from '../icons.jsx'

function Switch({ checked, onChange }) {
  return <button type="button" className={`switch${checked ? ' active' : ''}`} onClick={() => onChange(!checked)}><span></span></button>
}

export default function Extensions({ localConfig, setLocalConfig, saveConfig, showToast, runTask }) {
  const [status, setStatus] = useState(null)
  // 默认折叠 MCP 服务卡片，只显示 名称/传输/状态 摘要行；新添加的自动展开
  const [expandedMcp, setExpandedMcp] = useState(new Set())
  const refresh = async () => setStatus(await api.get('/system/extensions'))
  useEffect(() => { refresh().catch(() => {}) }, [])

  if (!localConfig) return <div className="pane-content select-text"></div>
  const setSection = (key, value) => setLocalConfig(prev => ({ ...prev, [key]: { ...prev[key], ...value } }))
  const reload = () => runTask(async () => {
    setStatus(await api.post('/system/extensions/reload'))
    showToast('MCP / Skills 已重新加载')
  })

  // MCP 服务器结构化编辑（RikkaHub 风格：名称 + 传输类型 + 地址）
  const mcpServers = Array.isArray(localConfig.mcp?.servers) ? localConfig.mcp.servers : []
  const mcpStatusById = new Map((status?.mcp?.servers || []).map(server => [server.id, server]))
  const toggleMcpExpanded = (key) => setExpandedMcp(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const mcpServerKey = (server, index) => server._key || `mcp_idx_${index}`
  const setMcpServers = (servers) => setSection('mcp', { servers })
  const updateMcpServer = (index, patch) => setMcpServers(mcpServers.map((server, i) => i === index ? { ...server, ...patch } : server))
  const addMcpServer = () => {
    const key = `mcp_new_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    setMcpServers([...mcpServers, {
      _key: key, id: '', transport: 'streamable-http', enable: true, masterOnly: true,
      url: '', command: '', argsText: '', headersText: ''
    }])
    setExpandedMcp(prev => new Set(prev).add(key))
  }
  const removeMcpServer = (index) => {
    const server = mcpServers[index]
    if (!window.confirm(`确认删除 MCP 服务 ${server.id || `#${index + 1}`}？`)) return
    setMcpServers(mcpServers.filter((_, i) => i !== index))
  }

  return (
    <div className="pane-content select-text">
      <div className="flex-row justify-between items-center mb-4">
        <h2 className="page-hero-title">MCP 与 Agent Skills</h2>
        <div className="flex-row gap-2">
          <button className="btn" onClick={reload}><Icon name="refresh" size={12} />重载连接</button>
          <button className="btn btn-primary" onClick={saveConfig}><Icon name="save" size={12} />保存配置</button>
        </div>
      </div>

      <div className="flex-column gap-4">
        <div className="card">
          <div className="flex-row justify-between items-center border-b pb-2 mb-3">
            <div>
              <span className="card-section-title">// MCP 外部工具服务器</span>
              <p className="text-[10px] text-faint mt-1">支持 stdio 与 Streamable HTTP；工具自动命名为 mcp__服务__工具。</p>
            </div>
            <Switch checked={localConfig.mcp?.enable === true} onChange={value => setSection('mcp', { enable: value })} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
            <div className="flex-column gap-1.5">
              <label className="text-xs text-muted">连接超时 (ms)</label>
              <input className="form-input" type="number" min="1000" value={localConfig.mcp?.connectTimeoutMs ?? 10000} onChange={e => setSection('mcp', { connectTimeoutMs: e.target.value })} />
            </div>
            <div className="flex-column gap-1.5">
              <label className="text-xs text-muted">工具调用超时 (ms)</label>
              <input className="form-input" type="number" min="1000" value={localConfig.mcp?.callTimeoutMs ?? 60000} onChange={e => setSection('mcp', { callTimeoutMs: e.target.value })} />
            </div>
          </div>
          <div className="flex-column gap-3">
            {mcpServers.map((server, index) => {
              const live = mcpStatusById.get(String(server.id || '').trim())
              const isHttp = server.transport !== 'stdio'
              const key = mcpServerKey(server, index)
              const expanded = expandedMcp.has(key)
              return (
                <div key={key} className={`mcp-server-card sub-card border border-default rounded-lg p-3 flex-column gap-3${expanded ? '' : ' is-collapsed'}`}>
                  <div className="flex-row justify-between items-center gap-2">
                    <button
                      type="button"
                      className="account-card-toggle"
                      onClick={() => toggleMcpExpanded(key)}
                      aria-expanded={expanded}
                      title={expanded ? '收起服务配置' : '展开服务配置'}
                    >
                      <div className="account-card-summary">
                        <span className="text-xs font-medium text-strong truncate min-w-0">{server.id || `MCP 服务 #${index + 1}`}</span>
                        <span className={`tier-badge tier-${isHttp ? 'sky' : 'gray'}`}>{isHttp ? 'HTTP' : 'stdio'}</span>
                        {server.enable === false && <span className="badge badge-gray">已停用</span>}
                      </div>
                    </button>
                    <div className="flex-row items-center gap-2 flex-shrink-0">
                      {live && (
                        <span className={`status-pill ${live.status === 'connected' ? 'is-ok' : 'is-err'}`} title={live.error || ''}>
                          {live.status === 'connected' ? `已连接 · ${live.tools.length} tools` : (live.error || live.status)}
                        </span>
                      )}
                      <button
                        type="button"
                        className="account-card-chevron"
                        onClick={() => toggleMcpExpanded(key)}
                        aria-expanded={expanded}
                        title={expanded ? '收起服务配置' : '展开服务配置'}
                        aria-label={expanded ? `收起 ${server.id || `MCP 服务 #${index + 1}`} 配置` : `展开 ${server.id || `MCP 服务 #${index + 1}`} 配置`}
                      >
                        <Icon name="chevronDown" size={12} />
                      </button>
                    </div>
                  </div>
                  {expanded && (
                  <>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">名称</label>
                    <input
                      className="form-input font-mono"
                      value={server.id || ''}
                      placeholder="MT_APK_MCP"
                      onChange={e => updateMcpServer(index, { id: e.target.value })}
                    />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">传输类型</label>
                    <div className="segmented-control">
                      <button type="button" className={isHttp ? 'active' : ''} onClick={() => updateMcpServer(index, { transport: 'streamable-http' })}>
                        Streamable HTTP
                      </button>
                      <button type="button" className={!isHttp ? 'active' : ''} onClick={() => updateMcpServer(index, { transport: 'stdio' })}>
                        stdio 本地命令
                      </button>
                    </div>
                    <span className="text-[10px] text-faint">{isHttp ? '连接远程流式 HTTP MCP 端点' : '在机器人本机启动子进程，通过标准输入输出通信'}</span>
                  </div>
                  {isHttp ? (
                    <>
                      <div className="flex-column gap-1.5">
                        <label className="text-xs text-muted">服务器地址</label>
                        <input
                          className="form-input font-mono"
                          value={server.url || ''}
                          placeholder="http://127.0.0.1:8787/mcp"
                          onChange={e => updateMcpServer(index, { url: e.target.value })}
                        />
                      </div>
                      <details className="mcp-advanced">
                        <summary className="text-[10px] text-accent cursor-pointer">请求头（可选，每行 KEY=VALUE）</summary>
                        <textarea
                          className="form-textarea font-mono mt-1"
                          rows="2"
                          placeholder="Authorization=Bearer xxx"
                          value={server.headersText ?? ''}
                          onChange={e => updateMcpServer(index, { headersText: e.target.value })}
                        />
                      </details>
                    </>
                  ) : (
                    <>
                      <div className="flex-column gap-1.5">
                        <label className="text-xs text-muted">启动命令</label>
                        <input
                          className="form-input font-mono"
                          value={server.command || ''}
                          placeholder="node"
                          onChange={e => updateMcpServer(index, { command: e.target.value })}
                        />
                      </div>
                      <div className="flex-column gap-1.5">
                        <label className="text-xs text-muted">启动参数（每行一个，可留空）</label>
                        <textarea
                          className="form-textarea font-mono"
                          rows="2"
                          placeholder="D:/mcp/server.js"
                          value={server.argsText ?? ''}
                          onChange={e => updateMcpServer(index, { argsText: e.target.value })}
                        />
                      </div>
                    </>
                  )}
                  <div className="flex-row flex-wrap justify-between items-center gap-2 border-t border-default pt-2">
                    <div className="flex-row items-center gap-2">
                      <Switch checked={server.enable !== false} onChange={value => updateMcpServer(index, { enable: value })} />
                      <span className="text-[10px] text-muted">启用</span>
                    </div>
                    <div className="flex-row items-center gap-2">
                      <Switch checked={server.masterOnly !== false} onChange={value => updateMcpServer(index, { masterOnly: value })} />
                      <span className="text-[10px] text-muted">仅主人可用</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-danger py-1 px-2 text-[10px]"
                      onClick={() => removeMcpServer(index)}
                    >
                      <Icon name="trash" size={11} />删除
                    </button>
                  </div>
                  </>
                  )}
                </div>
              )
            })}
            {mcpServers.length === 0 && (
              <p className="text-[10px] text-faint">尚未配置 MCP 服务。点击下方按钮新建连接。</p>
            )}
            <div>
              <button type="button" className="btn btn-secondary" onClick={addMcpServer}>
                <Icon name="plus" size={12} />添加服务器
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex-row justify-between items-center border-b pb-2 mb-3">
            <div>
              <span className="card-section-title">// Agent Skills</span>
              <p className="text-[10px] text-faint mt-1">模型按 name/description 自主调用 activate_skill；Skill 只提供复杂工作流，不控制 Tool 权限。</p>
            </div>
            <Switch checked={localConfig.skills?.enable === true} onChange={value => setSection('skills', { enable: value })} />
          </div>
          <div className="toggle-switch-row mb-3">
            <span className="text-xs font-medium text-soft">仅主人可查看和激活 Skills</span>
            <Switch checked={localConfig.skills?.masterOnly === true} onChange={value => setSection('skills', { masterOnly: value })} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="text-xs text-muted">Skill 目录（每行一个）</label><textarea className="form-textarea font-mono mt-1" rows="5" value={localConfig.skills?.directories ?? 'skills'} onChange={e => setSection('skills', { directories: e.target.value })} /></div>
            <div><label className="text-xs text-muted">禁用的 Skill 名称（每行一个）</label><textarea className="form-textarea font-mono mt-1" rows="5" value={localConfig.skills?.disabled ?? ''} onChange={e => setSection('skills', { disabled: e.target.value })} /></div>
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            {(status?.skills?.skills || []).map(skill => (
              <div key={skill.name} className="border border-default rounded-lg p-3 sub-card">
                <div className="text-xs font-bold text-soft">{skill.name}</div>
                <div className="text-[10px] text-muted mt-1">{skill.description}</div>
                <div className="text-[9px] text-faint font-mono mt-2">{skill.path}</div>
              </div>
            ))}
          </div>
          {status?.skills?.enabled && (status.skills.skills || []).length === 0 && <p className="text-[10px] text-faint mt-3">未发现 Skill。请将包含 SKILL.md 的目录放到配置路径下。</p>}
        </div>
      </div>
    </div>
  )
}
