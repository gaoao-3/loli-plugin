import React from 'react'
import Icon from '../icons.jsx'

export default function Overview({ system, channels, tools, onRefresh, onNavigate }) {
  const activeChannels = channels.filter(c => c.status === 'enabled').length
  const activeTools = tools.filter(t => t.enabled).length

  const details = !system ? [] : [
    { key: '系统真实内存', val: system.memoryUsage || '未知' },
    { key: '机器人进程内存', val: system.processMemory?.rssFormatted || '未知' },
    { key: '当前适配器渠道', val: channels.map(c => `${c.name} (${c.adapterType || 'gemini'})`).join(', ') || '暂无绑定的渠道' },
    { key: '当前活跃会话', val: system.activeSessions || '0' },
    { key: 'Bot 主体账号', val: system.botInfo || '未绑定' },
    { key: '系统指令配置', val: system.systemPromptCount ? `${system.systemPromptCount} 条设定` : '无' }
  ]

  return (
    <div className="pane-content select-text">
      <div className="card-grid">
        <div className="card">
          <span className="card-title">系统状态</span>
          <div className="card-value-row">
            <span className="card-value">{system?.status === 'ok' ? '正常运行' : '运行异常'}</span>
            <span className={`badge ${system?.status === 'ok' ? 'badge-success' : 'badge-danger'}`}>{system?.status === 'ok' ? 'OK' : 'ERR'}</span>
          </div>
          <p className="card-subtitle">{system?.message || '系统正常运行中'}</p>
        </div>
        <div className="card">
          <span className="card-title">可用渠道</span>
          <div className="card-value-row">
            <span className="card-value">{activeChannels}</span>
            <span className="card-note">共 {channels.length} 个</span>
          </div>
          <span className="card-subtitle">支持多适配器热切换</span>
        </div>
        <div className="card">
          <span className="card-title">可用插件</span>
          <div className="card-value-row">
            <span className="card-value">{activeTools}</span>
            <span className="card-note">共 {tools.length} 个</span>
          </div>
          <span className="card-subtitle">支持热重载与文件上传</span>
        </div>
        <div className="card">
          <span className="card-title">运行时长</span>
          <div className="card-value-row">
            <span className="card-value font-mono">{system?.uptime || '0s'}</span>
            <span className="card-tag uppercase">UPTIME</span>
          </div>
          <span className="card-subtitle">自服务最后一次启动</span>
        </div>
      </div>

      <div className="card mt-4">
        <span className="card-section-title">// 快捷导航</span>
        <div className="flex-row gap-2.5 mt-2 flex-wrap">
          <button className="btn btn-primary" onClick={onRefresh}>
            <Icon name="refresh" size={12} />同步数据
          </button>
          <button className="btn btn-secondary" onClick={() => onNavigate('channels')}>
            <Icon name="sliders" size={12} />管理渠道
          </button>
          <button className="btn btn-secondary" onClick={() => onNavigate('tools')}>
            <Icon name="tools" size={12} />管理工具
          </button>
          <button className="btn btn-secondary" onClick={() => onNavigate('memory')}>
            <Icon name="memory" size={12} />系统数据
          </button>
        </div>
      </div>

      <div className="card mt-4">
        <div className="flex-row justify-between items-center pb-2 border-b mb-2">
          <span className="text-sm font-semibold text-soft">// 控制台运行参数明细</span>
          <span className="badge badge-success font-mono uppercase">Online</span>
        </div>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr><th>项目指标</th><th>运行明细</th></tr>
            </thead>
            <tbody>
              {details.map(item => (
                <tr key={item.key}>
                  <td className="font-bold text-strong">{item.key}</td>
                  <td className="font-mono text-muted">{item.val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
