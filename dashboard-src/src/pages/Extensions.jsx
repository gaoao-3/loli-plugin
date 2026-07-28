import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import Icon from '../icons.jsx'

function Switch({ checked, onChange }) {
  return <button type="button" className={`switch${checked ? ' active' : ''}`} onClick={() => onChange(!checked)}><span></span></button>
}

export default function Extensions({ localConfig, setLocalConfig, saveConfig, showToast, runTask }) {
  const [status, setStatus] = useState(null)
  const refresh = async () => setStatus(await api.get('/system/extensions'))
  useEffect(() => { refresh().catch(() => {}) }, [])

  if (!localConfig) return <div className="pane-content select-text"></div>
  const setSection = (key, value) => setLocalConfig(prev => ({ ...prev, [key]: { ...prev[key], ...value } }))
  const reload = () => runTask(async () => {
    setStatus(await api.post('/system/extensions/reload'))
    showToast('MCP / Skills 已重新加载')
  })

  return (
    <div className="pane-content select-text">
      <div className="flex-row justify-between items-center mb-4">
        <h2 className="text-lg font-bold text-strong">// MCP 与 Agent Skills</h2>
        <div className="flex-row gap-2">
          <button className="btn" onClick={reload}><Icon name="refresh" size={12} />重载连接</button>
          <button className="btn btn-primary" onClick={saveConfig}><Icon name="save" size={12} />保存配置</button>
        </div>
      </div>

      <div className="flex-column gap-4">
        <div className="card">
          <div className="flex-row justify-between items-center border-b pb-2 mb-3">
            <div>
              <span className="text-xs font-bold text-muted">// MCP 外部工具服务器</span>
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
          <label className="text-xs text-muted">MCP Servers JSON</label>
          <textarea className="form-textarea font-mono mt-1" rows="14" value={localConfig.mcp?.servers ?? '[]'} onChange={e => setSection('mcp', { servers: e.target.value })} placeholder={'[{\n  "id": "demo",\n  "transport": "streamable-http",\n  "url": "http://127.0.0.1:3001/mcp",\n  "masterOnly": true\n}]'} />
          <div className="mt-3 flex-column gap-2">
            {(status?.mcp?.servers || []).map(server => (
              <div key={server.id} className="flex-row justify-between items-center border border-default rounded-lg p-2">
                <span className="text-xs font-mono">{server.name} · {server.transport} · {server.tools.length} tools</span>
                <span className={`text-[10px] font-mono ${server.status === 'connected' ? 'text-success' : 'text-danger'}`}>{server.status}{server.error ? ` · ${server.error}` : ''}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="flex-row justify-between items-center border-b pb-2 mb-3">
            <div>
              <span className="text-xs font-bold text-muted">// Agent Skills</span>
              <p className="text-[10px] text-faint mt-1">启动时只暴露 name/description；activate_skill 后才加载完整 SKILL.md。</p>
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
              <div key={skill.name} className="border border-default rounded-lg p-3">
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
