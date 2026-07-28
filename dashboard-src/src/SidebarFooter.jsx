import React, { useEffect, useState } from 'react'
import { api } from './api'
import Icon from './icons.jsx'

const STATUS_POLL_MS = 30 * 1000

const formatUptime = (raw) => {
  const seconds = parseInt(raw, 10)
  if (Number.isNaN(seconds) || seconds < 0) return ''
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d${Math.floor((seconds % 86400) / 3600)}h`
}

/**
 * 侧栏底栏：状态卡片（连通性 + 运行时长 + 版本）+ 操作行（折叠 / 退出）。
 * 独立轮询 /system/status，状态点实时反映面板与引擎的连通性。
 */
export default function SidebarFooter({ collapsed, onToggleCollapse, authRequired, onLogout }) {
  const [status, setStatus] = useState(null)
  const [online, setOnline] = useState(false)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const res = await api.get('/system/status')
        if (!alive) return
        setStatus(res)
        setOnline(true)
      } catch {
        if (alive) setOnline(false)
      }
    }
    tick().catch(() => {})
    const id = setInterval(() => tick().catch(() => {}), STATUS_POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const uptime = formatUptime(status?.uptime)

  return (
    <div className="sidebar-footer">
      <div
        className={`footer-status${online ? ' online' : ''}`}
        title={online ? '面板与引擎连接正常' : '无法连接引擎，30 秒后重试'}
      >
        <span className="status-dot" />
        <div className="footer-status-info">
          <span className="status-text">{online ? '引擎在线' : '连接中断'}</span>
          <span className="status-uptime">{online && uptime ? `已运行 ${uptime}` : '等待自动重连'}</span>
        </div>
        <span className="footer-version">v{status?.version || '…'}</span>
      </div>
      <div className="footer-actions">
        <button className="sidebar-collapse-trigger" onClick={onToggleCollapse} title={collapsed ? '展开导航栏' : '折叠导航栏'}>
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={15} />
          <span className="collapse-label">折叠导航栏</span>
        </button>
        {authRequired && (
          <button className="btn-logout-icon" onClick={onLogout} title="退出登录">
            <Icon name="logout" size={13} />
            <span className="logout-text">退出</span>
          </button>
        )}
      </div>
    </div>
  )
}
