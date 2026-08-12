import React, { useState } from 'react'
import Icon from '../icons.jsx'
import Mascot from '../components/Mascot.jsx'
import { useTypewriter, useTilt } from '../fx.js'

const ADAPTER_LABELS = {
  gemini: 'Gemini',
  aistudio: 'Google AI Studio',
  gcil: 'GCIL OAuth',
  openai: 'OpenAI',
  antigravity: 'Antigravity OAuth'
}

// 3D 倾斜统计卡
function StatCard({ tone, icon, title, badge, value, sub, mono }) {
  const ref = useTilt(5)
  return (
    <div ref={ref} className={`card stat-card tilt-card tone-${tone}`}>
      <div className="stat-head">
        <span className="stat-icon"><Icon name={icon} size={16} /></span>
        <span className="card-title">{title}</span>
        {badge}
      </div>
      <span className={`stat-value${mono ? ' font-mono' : ''}`}>{value}</span>
      <span className="card-subtitle">{sub}</span>
    </div>
  )
}

export default function Overview({ system, channels, tools, onRefresh, onNavigate }) {
  const [avatarBroken, setAvatarBroken] = useState(false)
  const activeChannels = channels.filter(c => c.status === 'enabled').length
  const activeTools = tools.filter(t => t.enabled).length

  // Bot 主体账号（QQ 号 + 昵称），头像走 QQ 官方头像接口
  const bot = system?.botAccounts?.[0]
  const botAvatar = bot?.id && !avatarBroken
    ? `https://q1.qlogo.cn/g?b=qq&nk=${bot.id}&s=100`
    : ''

  // galgame 对话框字幕：打字机逐字输出
  const subtitle = system?.status === 'ok' ? '欢迎回来，一切运行正常 ♪' : '检测到异常，建议查看终端日志'
  const typedSubtitle = useTypewriter(subtitle)

  const details = !system ? [] : [
    { key: '系统真实内存', val: system.memoryUsage || '未知' },
    { key: '机器人进程内存', val: system.processMemory?.rssFormatted || '未知' },
    { key: '当前适配器渠道', val: channels.map(c => `${c.name} (${ADAPTER_LABELS[c.adapterType] || c.adapterType || 'Gemini'})`).join(', ') || '暂无绑定的渠道' },
    { key: 'Bot 主体账号', val: system.botInfo || '未绑定' }
  ]

  return (
    <div className="pane-content select-text">
      <div className="kawaii-banner mb-4 mt-2">
        <span className="name-plate">「{bot?.nickname || 'Hina'}」</span>
        <span className="kawaii-banner-spark s1" aria-hidden="true">✦</span>
        <span className="kawaii-banner-spark s2" aria-hidden="true">✧</span>
        <span className="kawaii-banner-spark s3" aria-hidden="true">✦</span>
        <div className="flex-row items-center gap-3 min-w-0">
          {botAvatar ? (
            <img
              src={botAvatar}
              onError={() => setAvatarBroken(true)}
              className="bot-avatar"
              alt="Bot 头像"
            />
          ) : (
            <span className="bot-avatar bot-avatar-fallback"><Icon name="presets" size={20} /></span>
          )}
          <div className="flex-column gap-1 min-w-0">
            <span className="kawaii-banner-title">{bot?.nickname ? `${bot.nickname} 的控制台` : 'Hina 控制台'}</span>
            <span className="kawaii-banner-sub type-caret">{typedSubtitle}</span>
          </div>
        </div>
        <div className="flex-row items-center gap-3 flex-shrink-0">
          <Mascot size={52} />
          <button className="btn btn-primary flex-shrink-0" onClick={onRefresh}>
            <Icon name="refresh" size={12} />同步数据
          </button>
        </div>
      </div>

      <div className="card-grid stat-grid">
        <StatCard
          tone="sakura"
          icon="overview"
          title="系统状态"
          badge={<span className={`badge ${system?.status === 'ok' ? 'badge-success' : 'badge-danger'}`}>{system?.status === 'ok' ? 'OK' : 'ERR'}</span>}
          value={system?.status === 'ok' ? '正常运行' : '运行异常'}
          sub={system?.message || '系统正常运行中'}
        />
        <StatCard
          tone="sky"
          icon="channels"
          title="可用渠道"
          badge={<span className="badge badge-gray">共 {channels.length} 个</span>}
          value={activeChannels}
          sub="支持多适配器热切换"
        />
        <StatCard
          tone="violet"
          icon="tools"
          title="可用插件"
          badge={<span className="badge badge-gray">共 {tools.length} 个</span>}
          value={activeTools}
          sub="支持热重载与文件上传"
        />
        <StatCard
          tone="mint"
          icon="logs"
          title="运行时长"
          badge={<span className="badge badge-gray font-mono uppercase">UPTIME</span>}
          value={system?.uptime || '0s'}
          sub="自服务最后一次启动"
          mono
        />
      </div>

      <div className="card mt-4">
        <span className="card-section-title">快捷导航</span>
        <div className="flex-row gap-2.5 mt-2 flex-wrap">
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
          <span className="card-section-title">控制台运行参数明细</span>
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
