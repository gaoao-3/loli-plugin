import React from 'react'
import Icon from '../icons.jsx'

export default function Memory({ memory, showToast }) {
  if (!memory) return <div className="pane-content select-text"></div>

  const copyDbPath = () => {
    if (!memory.dbPath) return
    navigator.clipboard.writeText(memory.dbPath)
      .then(() => showToast('物理路径已复制'))
      .catch(() => showToast('复制失败，请手动选择复制', 'warning'))
  }

  const bars = [
    { label: '群友身份账本 (QQ Identities)', value: `${memory.identities || 0} 人`, width: Math.min(100, ((memory.identities || 0) / Math.max(1, memory.messages)) * 100), cls: 'bg-orange' },
    { label: '已形成用户印象 (User Impressions)', value: `${memory.learnedMembers || 0} 人`, width: Math.min(100, ((memory.learnedMembers || 0) / Math.max(1, memory.identities)) * 100), cls: 'bg-blue' },
    { label: 'Gemini 记忆向量 (Embeddings)', value: `${memory.embeddings || 0} 条`, width: Math.min(100, ((memory.embeddings || 0) / Math.max(1, memory.memberMemoryVersions)) * 100), cls: 'bg-violet' },
    { label: '用户印象版本 (Impression Versions)', value: `${memory.memberMemoryVersions || 0} 版`, width: Math.min(100, ((memory.memberMemoryVersions || 0) / Math.max(1, memory.messages)) * 100), cls: 'bg-green' },
    { label: '群风格版本 (Group Style Versions)', value: `${memory.learningVersions || 0} 版`, width: Math.min(100, ((memory.learningVersions || 0) / Math.max(1, memory.messages)) * 100), cls: 'bg-gray' }
  ]

  return (
    <div className="pane-content select-text">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <div className="card stat-card tone-amber">
          <div className="stat-head">
            <span className="stat-icon"><Icon name="memory" size={16} /></span>
            <span className="card-title">待学习原始证据</span>
            <span className="badge badge-gray">条消息</span>
          </div>
          <span className="stat-value">{memory.messages || 0}</span>
          <span className="card-subtitle">双方处理后自动删除，不参与日常聊天侧载</span>
        </div>
        <div className="card stat-card tone-sky">
          <div className="stat-head">
            <span className="stat-icon"><Icon name="presets" size={16} /></span>
            <span className="card-title">AI 用户印象</span>
            <span className="badge badge-gray">位群友</span>
          </div>
          <span className="stat-value">{memory.learnedMembers || 0}</span>
          <span className="card-subtitle">累计 {memory.memberMemoryVersions || 0} 个可追溯版本</span>
        </div>
        <div className="card stat-card tone-violet">
          <div className="stat-head">
            <span className="stat-icon"><Icon name="channels" size={16} /></span>
            <span className="card-title">AI 群风格</span>
            <span className="badge badge-gray">个群</span>
          </div>
          <span className="stat-value">{memory.learnedGroups || 0}</span>
          <span className="card-subtitle">累计 {memory.learningVersions || 0} 个群风格版本</span>
        </div>
        <div className="card stat-card tone-sky">
          <div className="stat-head">
            <span className="stat-icon"><Icon name="memory" size={16} /></span>
            <span className="card-title">Gemini 记忆向量</span>
            <span className="badge badge-gray">条向量</span>
          </div>
          <span className="stat-value">{memory.embeddings || 0}</span>
          <span className="card-subtitle">用于按当前问题语义召回相关长期事实</span>
        </div>
      </div>

      <div className="card">
        <span className="card-section-title mb-6 block">待处理证据、用户印象与群风格</span>
        <div className="flex-column gap-5">
          {bars.map(bar => (
            <div className="progress-item" key={bar.label}>
              <div className="flex-row justify-between text-xs mb-1">
                <span className="text-soft font-medium">{bar.label}</span>
                <span className="badge">{bar.value}</span>
              </div>
              <div className="progress-bar-track">
                <div className={`progress-bar ${bar.cls}`} style={{ width: bar.width + '%' }}></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card mt-4">
        <span className="card-section-title block mb-2">SQLite 数据库文件物理地址</span>
        <div className="flex-row gap-3 items-center bg-deep border border-default rounded-lg p-3">
          <span className="flex-1 font-mono text-xs text-soft break-all select-all">{memory.dbPath || '未检测到 SQLite 数据库物理路径'}</span>
          <button className="btn-copy" onClick={copyDbPath} title="复制路径">
            <Icon name="copy" size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
