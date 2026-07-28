import React, { useRef, useEffect, useMemo } from 'react'
import Icon from '../icons.jsx'

const LEVEL_TEXT = {
  DEBUG: 'text-muted',
  INFO: 'text-soft',
  WARN: 'text-warning',
  ERROR: 'text-danger font-bold'
}

const LEVEL_TAG = {
  DEBUG: 'bg-elevated text-soft border-default',
  INFO: 'bg-accent-soft text-accent border-accent-soft',
  WARN: 'bg-warning-soft text-warning border-warning-soft',
  ERROR: 'bg-danger-soft text-danger border-danger-soft'
}

export default function Logs({ logs, autoRefresh, setAutoRefresh, levelFilter, setLevelFilter, searchQuery, setSearchQuery, onClear, onCopy }) {
  const terminalRef = useRef(null)

  const filteredLogs = useMemo(() => logs.filter(log => {
    const matchLevel = levelFilter === 'ALL' || log.level === levelFilter
    const matchKeyword = !searchQuery.trim() || log.message.toLowerCase().includes(searchQuery.trim().toLowerCase())
    return matchLevel && matchKeyword
  }), [logs, levelFilter, searchQuery])

  useEffect(() => {
    const container = terminalRef.current
    if (container && autoRefresh) container.scrollTop = container.scrollHeight
  }, [filteredLogs, autoRefresh])

  return (
    <div className="pane-content logs-pane-content flex-column gap-4 select-text">
      <div className="flex-row flex-wrap justify-between items-center gap-4 flex-shrink-0">
        <div className="flex-row gap-3 flex-wrap items-center">
          <h2 className="text-lg font-bold text-strong">// 终端日志</h2>
          <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)} className="form-select py-1 w-[160px]">
            <option value="ALL">所有日志 (ALL)</option>
            <option value="DEBUG">运行调试 (DEBUG)</option>
            <option value="INFO">系统普通 (INFO)</option>
            <option value="WARN">警告信息 (WARN)</option>
            <option value="ERROR">致命异常 (ERROR)</option>
          </select>
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} type="text" placeholder="过滤关键词..." className="form-input py-1 w-[180px]" />
        </div>

        <div className="flex-row gap-2">
          <button className="btn btn-secondary py-1.5" onClick={() => setAutoRefresh(!autoRefresh)}>
            <Icon name="pause" size={12} />
            <span>{autoRefresh ? '暂停刷新' : '恢复刷新'}</span>
          </button>
          <button className="btn btn-secondary py-1.5" onClick={onCopy}>
            <Icon name="copy" size={12} />复制日志
          </button>
          <button className="btn btn-danger py-1.5" onClick={onClear}>
            <Icon name="trash" size={12} />清空日志
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 border border-default bg-deep rounded-lg overflow-hidden flex flex-col">
        <div className="flex-column h-full min-h-0 relative">
          <div className="h-8 bg-inset border-b flex items-center justify-between px-4 flex-shrink-0">
            <div className="flex-row items-center gap-2 text-[10px] font-mono text-muted">
              <Icon name="logs" size={10} />
              <span>TERMINAL OUTPUT // STDOUT</span>
            </div>
            <div className="flex gap-1.5">
              <span className="w-2 h-2 rounded-full dot dot-danger"></span>
              <span className="w-2 h-2 rounded-full dot dot-warning"></span>
              <span className="w-2 h-2 rounded-full dot dot-success"></span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 font-mono text-[10px] leading-relaxed flex flex-col gap-1.5 terminal-logs" ref={terminalRef}>
            {filteredLogs.length === 0 && (
              <div className="py-12 text-center text-faint text-xs font-semibold">暂无匹配的终端日志输出</div>
            )}
            {filteredLogs.map(log => (
              <div key={log.timestamp + log.message} className="flex-row items-start gap-2 hover-bg-soft py-0.5 px-1 rounded transition-colors select-text">
                <span className="text-muted select-none">[{log.timestamp}]</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border select-none ${LEVEL_TAG[log.level] || LEVEL_TAG.DEBUG}`}>{log.level}</span>
                <span className={`break-all whitespace-pre-wrap select-text ${LEVEL_TEXT[log.level] || LEVEL_TEXT.INFO}`}>{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
