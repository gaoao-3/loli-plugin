import React, { useState, useRef } from 'react'
import { api } from '../api'
import Icon from '../icons.jsx'
import Modal from '../Modal.jsx'

function getToolFileName(filePath) {
  if (!filePath) return '-'
  const clean = filePath.replace(/\\/g, '/')
  return clean.split('/').slice(-2).join('/')
}

export default function Tools({ tools, refresh, showToast, runTask }) {
  const [modalVisible, setModalVisible] = useState(false)
  const [viewingTool, setViewingTool] = useState(null)
  const [deletingTool, setDeletingTool] = useState(null)
  const [toolSource, setToolSource] = useState('')
  const [sourceLoading, setSourceLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileInfo, setFileInfo] = useState({ name: '', size: '' })
  const fileInputRef = useRef(null)

  const toggleStatus = (t) => runTask(async () => {
    await api.post(`/tools/${encodeURIComponent(t.name)}/toggle`)
    showToast('扩展工具状态已更新')
    await refresh()
  })

  const viewTool = async (t) => {
    setViewingTool(t)
    setToolSource('')
    setSourceLoading(true)
    try {
      const detail = await api.get(`/tools/${encodeURIComponent(t.name)}`)
      setToolSource(detail.content || '')
    } catch {
      setViewingTool(null)
    } finally {
      setSourceLoading(false)
    }
  }

  const deleteTool = () => runTask(async () => {
    if (!deletingTool) return
    await api.delete(`/tools/${encodeURIComponent(deletingTool.name)}`)
    showToast(`工具 ${deletingTool.toolName || deletingTool.name} 已删除`)
    setDeletingTool(null)
    await refresh()
  })

  const reloadTools = () => runTask(async () => {
    await api.post('/tools/reload')
    showToast('工具插件热重载完成')
    await refresh()
  })

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (!file.name.endsWith('.js')) {
      showToast('仅支持上传 .js 格式的扩展工具文件', 'warning')
      return
    }
    setSelectedFile(file)
    setFileInfo({ name: file.name, size: `${(file.size / 1024).toFixed(1)} KB` })
  }

  const clearFile = () => {
    setSelectedFile(null)
    setFileInfo({ name: '', size: '' })
  }

  const submitUpload = () => runTask(async () => {
    if (!selectedFile) return
    const form = new FormData()
    form.append('tool', selectedFile)
    await api.post('/tools/upload', form)
    showToast('自定义工具导入成功')
    setModalVisible(false)
    clearFile()
    await refresh()
  })

  return (
    <div className="pane-content select-text">
      <div className="tool-page-header flex-row justify-between items-center mb-4">
        <h2 className="page-hero-title">工具扩展插件</h2>
        <div className="tool-page-header-actions flex-row gap-2">
          <button className="btn btn-secondary" onClick={reloadTools}>
            <Icon name="refresh" size={12} />重新加载
          </button>
          <button className="btn btn-primary" onClick={() => setModalVisible(true)}>
            <Icon name="upload" size={12} />导入插件
          </button>
        </div>
      </div>

      <div className="flex-column gap-3">
        {tools.length === 0 && (
          <div className="py-12 text-center text-faint text-sm font-semibold">暂无已加载的扩展工具插件</div>
        )}
        {tools.map(t => (
          <div key={t.name} className="tool-tile-card flex-row items-center justify-between gap-4">
            <div className="tool-tile-main flex-row items-center gap-3.5 flex-1 min-w-0">
              <div className="tool-tile-icon">
                <Icon name="tools" size={18} />
              </div>
              <div className="flex-column flex-1 min-w-0">
                <div className="flex-row items-center gap-2">
                  <h3 className="text-sm font-bold text-strong truncate" title={t.toolName || t.name}>{t.toolName || t.name}</h3>
                  <span className="text-[10px] font-mono text-muted truncate">({t.name}.js)</span>
                </div>
                <p className="text-xs text-muted leading-relaxed mt-0.5 truncate" title={t.description}>{t.description || '暂无关于此扩展工具的描述说明。'}</p>
                <p className="text-[9px] font-mono text-faint mt-0.5 truncate" title={t.path}>物理文件: {getToolFileName(t.path)}</p>
              </div>
            </div>
            <div className="tool-tile-actions flex-row items-center gap-3">
              <span className={`badge ${t.enabled ? 'badge-success' : 'badge-gray'}`}>{t.enabled ? '已启用' : '已停用'}</span>
              <button className="tool-view-button btn btn-secondary py-1.5" onClick={() => viewTool(t)}>
                <Icon name="file" size={12} />查看
              </button>
              <button className="tool-delete-button btn btn-danger py-1.5" onClick={() => setDeletingTool(t)}>
                <Icon name="trash" size={12} />删除
              </button>
              <button className={`switch${t.enabled ? ' active' : ''}`} onClick={() => toggleStatus(t)}><span></span></button>
            </div>
          </div>
        ))}
      </div>

      {/* Upload Modal */}
      <Modal open={modalVisible} onClose={() => setModalVisible(false)} maxWidth={450} cardClass="tools-modal">
            <div className="modal-header">
              <span className="modal-title">导入自定义扩展 (.js)</span>
              <button className="modal-close" onClick={() => setModalVisible(false)}>×</button>
            </div>
            <div className="modal-body flex-column gap-3.5">
              <div className="drop-zone" onClick={() => fileInputRef.current?.click()}>
                <input type="file" ref={fileInputRef} accept=".js" className="hidden" onChange={handleFileChange} />
                <div className="drop-zone-icon">
                  <Icon name="upload" size={22} />
                </div>
                <div className="drop-zone-text">
                  <span className="block-label font-bold text-strong">点击区域选择或拖拽 .js 文件</span>
                  <span className="block-sublabel text-[10px] text-muted">文件将保存至 tools 扩展目录下</span>
                </div>
              </div>

              {selectedFile && (
                <div className="file-info-bar">
                  <div className="flex-row items-center gap-2 text-success text-xs">
                    <Icon name="file" size={14} />
                    <span className="font-bold truncate max-w-[200px]">{fileInfo.name}</span>
                    <span className="text-[9px] font-mono opacity-85">{fileInfo.size}</span>
                  </div>
                  <button className="text-danger hover-text-danger font-bold text-xs" onClick={clearFile}>×</button>
                </div>
              )}
            </div>
            <div className="modal-footer justify-end">
              <button className="btn btn-secondary" onClick={() => setModalVisible(false)}>取消</button>
              <button className="btn btn-primary" disabled={!selectedFile} onClick={submitUpload}>上传至服务器</button>
            </div>
      </Modal>

      {/* Source Modal */}
      <Modal open={Boolean(viewingTool)} onClose={() => setViewingTool(null)} maxWidth={900} cardClass="tools-modal">
        <div className="modal-header">
          <span className="modal-title">
            查看工具源码 // {viewingTool?.name}.js
          </span>
          <button className="modal-close" onClick={() => setViewingTool(null)}>×</button>
        </div>
        <div className="modal-body">
          <pre className="tool-source-view">
            {sourceLoading ? '正在读取工具文件…' : toolSource}
          </pre>
        </div>
        <div className="modal-footer justify-end">
          <button className="btn btn-secondary" onClick={() => setViewingTool(null)}>关闭</button>
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal open={Boolean(deletingTool)} onClose={() => setDeletingTool(null)} maxWidth={450} cardClass="tools-modal">
        <div className="modal-header">
          <span className="modal-title">删除工具</span>
          <button className="modal-close" onClick={() => setDeletingTool(null)}>×</button>
        </div>
        <div className="modal-body flex-column gap-2">
          <p className="text-sm text-strong">
            确定永久删除 <strong>{deletingTool?.toolName || deletingTool?.name}</strong>？
          </p>
          <p className="text-xs text-muted">对应的 .js 文件会从服务器移除，此操作无法撤销。</p>
        </div>
        <div className="modal-footer justify-end">
          <button className="btn btn-secondary" onClick={() => setDeletingTool(null)}>取消</button>
          <button className="btn btn-danger" onClick={deleteTool}>确认删除</button>
        </div>
      </Modal>
    </div>
  )
}
