import React, { useState } from 'react'
import { api } from '../api'
import Icon from '../icons.jsx'
import Modal from '../Modal.jsx'

const THINKING_LEVELS = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']

const emptyForm = {
  id: '', name: '', channelId: '', model: '', prompt: '',
  temperature: 0.9, maxTokens: 2048, topP: '',
  enableReasoning: true, thinkingLevel: 'LOW', isEdit: false
}

export default function Presets({ presets, channels, refresh, showToast, runTask }) {
  const [modalVisible, setModalVisible] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const selectedChannel = channels.find(channel => channel.id === form.channelId)
  const usesGoogleSamplingDefaults = ['gemini', 'aistudio', 'antigravity'].includes(selectedChannel?.adapterType)

  const showSaveResult = (result, successMessage) => {
    showToast(result?.configMirrorPersisted === false
      ? `${successMessage}；config.json 镜像更新失败，将在后续自动修复`
      : successMessage)
  }

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }))
  const setVal = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const openAdd = () => {
    setForm({ ...emptyForm, channelId: channels[0]?.id || '' })
    setModalVisible(true)
  }

  const openEdit = (p) => {
    setForm({
      id: p.id,
      name: p.name || '',
      channelId: p.channelId || '',
      model: p.sendMessageOption?.model || '',
      prompt: p.systemPrompt?.content || '',
      temperature: p.sendMessageOption?.temperature ?? 0.9,
      maxTokens: p.sendMessageOption?.maxTokens ?? 2048,
      topP: p.sendMessageOption?.topP ?? '',
      enableReasoning: p.sendMessageOption?.enableReasoning !== false,
      thinkingLevel: p.sendMessageOption?.thinkingLevel === 'OFF'
        ? 'MINIMAL'
        : (p.sendMessageOption?.thinkingLevel || 'LOW'),
      isEdit: true
    })
    setModalVisible(true)
  }

  const savePreset = () => runTask(async () => {
    if (!form.id.trim() || !form.name.trim()) {
      showToast('请输入预设 ID 和名称', 'warning')
      return
    }
    const existing = form.isEdit ? presets.find(p => p.id === form.id) : null
    const topPNum = form.topP !== '' ? Number(form.topP) : undefined
    const samplingOptions = usesGoogleSamplingDefaults
      ? {}
      : {
          temperature: Number(form.temperature),
          ...(topPNum !== undefined && !Number.isNaN(topPNum) ? { topP: topPNum } : {})
        }
    const payload = {
      id: form.id.trim(),
      name: form.name.trim(),
      channelId: form.channelId,
      sendMessageOption: {
        model: form.model.trim(),
        maxTokens: Number(form.maxTokens),
        enableReasoning: form.enableReasoning,
        thinkingLevel: form.thinkingLevel,
        ...samplingOptions
      },
      systemPrompt: { content: form.prompt },
      status: existing?.status || 'enabled'
    }
    const result = form.isEdit
      ? await api.put(`/presets/${form.id}`, payload)
      : await api.post('/presets', payload)
    showSaveResult(result, '预设角色保存成功')
    setModalVisible(false)
    await refresh()
  })

  const toggleStatus = (p) => runTask(async () => {
    const result = await api.put(`/presets/${p.id}`, { ...p, status: p.status === 'enabled' ? 'disabled' : 'enabled' })
    showSaveResult(result, '预设状态已更新')
    await refresh()
  })

  const deletePreset = (p) => runTask(async () => {
    if (!window.confirm(`确认要删除角色预设 "${p.name} (${p.id})"?`)) return
    const result = await api.delete(`/presets/${p.id}`)
    showSaveResult(result, '预设角色已成功删除')
    await refresh()
  })

  return (
    <div className="pane-content select-text">
      <div className="flex-row justify-between items-center mb-4">
        <h2 className="page-hero-title">预设角色管理</h2>
        <button className="btn btn-primary" onClick={openAdd}>
          <Icon name="plus" size={12} />新建预设
        </button>
      </div>

      <div className="card-grid collage-grid">
        {presets.length === 0 && (
          <div className="col-span-full py-12 text-center text-faint text-sm font-semibold">暂无已配置的角色预设</div>
        )}
        {presets.map(p => (
          <div key={p.id} className="card flex-column justify-between hover-border">
            <div className="flex-row justify-between items-start mb-3">
              <div className="flex-row items-center gap-2.5 min-w-0">
                <span className="avatar-bubble"><Icon name="presets" size={16} /></span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-strong truncate">{p.name}</h3>
                  <p className="text-[10px] font-mono text-muted mt-0.5">ID: {p.id}</p>
                </div>
              </div>
              <span className={`badge badge-stamp ${p.status === 'enabled' ? 'badge-success' : 'badge-gray'}`}>{p.status === 'enabled' ? '已启用' : '已禁用'}</span>
            </div>

            <div className="flex-column gap-1.5 text-xs mb-4">
              <div className="flex-row justify-between items-center">
                <span className="text-muted">绑定渠道：</span>
                <span className="bg-elevated text-soft text-[9px] font-mono px-1.5 py-0.2 rounded">{p.channelId}</span>
              </div>
              <div className="flex-row justify-between items-center">
                <span className="text-muted">执行模型：</span>
                <span className="font-mono text-soft truncate max-w-[130px] inline-block" title={p.sendMessageOption?.model}>{p.sendMessageOption?.model || '-'}</span>
              </div>
              <div className="flex-row justify-between items-center">
                <span className="text-muted">推理细节：</span>
                <span className="font-mono text-soft">{p.sendMessageOption?.thinkingLevel || 'LOW'} {p.sendMessageOption?.enableReasoning !== false ? '(COT)' : '(OFF)'}</span>
              </div>
            </div>

            <div className="flex-row justify-end gap-2 pt-3 border-t mt-auto">
              <button className="btn btn-secondary py-1 px-2.5 text-xs" onClick={() => openEdit(p)}>配置参数</button>
              <button className={`btn py-1 px-2.5 text-xs ${p.status === 'enabled' ? 'btn-danger' : 'btn-success'}`} onClick={() => toggleStatus(p)}>
                {p.status === 'enabled' ? '禁用' : '启用'}
              </button>
              <button className="btn btn-danger py-1 px-2.5 text-xs opacity-75 hover:opacity-100" onClick={() => deletePreset(p)}>删除</button>
            </div>
          </div>
        ))}
      </div>

      {/* Preset Modal */}
      <Modal open={modalVisible} onClose={() => setModalVisible(false)} maxWidth={920} cardClass="p-0 flex flex-col overflow-hidden preset-modal">
            <div className="modal-header px-5 py-3 border-b mb-0">
              <span className="modal-title text-xs font-bold uppercase tracking-wider">{form.isEdit ? '系统设置与提示词' : '配置预设角色'}</span>
              <button className="modal-close text-lg font-bold" onClick={() => setModalVisible(false)}>×</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-0 md:h-[480px] bg-deep overflow-hidden preset-editor-grid">

              {/* Left: prompt editor */}
              <div className="md:col-span-3 flex-column h-full overflow-y-auto p-4 border-r preset-pane-left">
                <div className="flex-column gap-1.5 h-full">
                  <div className="flex-row justify-between items-center">
                    <label className="pane-label uppercase">系统指示 (System Instructions)</label>
                    <span className="text-[9px] text-muted font-mono">System Prompt Editor</span>
                  </div>
                  <textarea
                    value={form.prompt}
                    onChange={set('prompt')}
                    placeholder="您可以在此处详细定义该角色的系统设定、语气特点与人设偏好..."
                    className="flex-1 w-full font-mono text-xs leading-relaxed bg-inset border border-default p-3 rounded-lg resize-none min-h-[260px] text-strong"
                  />
                </div>
              </div>

              {/* Right: params */}
              <div className="md:col-span-2 flex-column h-full overflow-y-auto p-4 justify-between bg-inset preset-pane-right">
                <div className="flex-column gap-4">
                  <div className="pb-1.5 border-b">
                    <span className="pane-label uppercase">参数控制 (Settings)</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex-column gap-1">
                      <label className="text-[10px] text-muted font-medium">预设唯一 ID</label>
                      <input value={form.id} onChange={set('id')} type="text" placeholder="hina" className="form-input" disabled={form.isEdit} />
                    </div>
                    <div className="flex-column gap-1">
                      <label className="text-[10px] text-muted font-medium">角色显示名称</label>
                      <input value={form.name} onChange={set('name')} type="text" placeholder="空崎日奈" className="form-input" />
                    </div>
                  </div>

                  <div className="flex-column gap-1">
                    <label className="text-[10px] text-muted font-medium">绑定模型渠道</label>
                    <select value={form.channelId} onChange={set('channelId')} className="form-select">
                      {channels.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                    </select>
                  </div>

                  <div className="flex-column gap-1">
                    <label className="text-[10px] text-muted font-medium">目标执行大模型</label>
                    <input value={form.model} onChange={set('model')} type="text" placeholder="gemini-2.5-flash" className="form-input" />
                  </div>

                  {!usesGoogleSamplingDefaults && (
                    <div className="flex-column gap-1">
                      <div className="flex-row justify-between items-center text-[10px]">
                        <span className="text-muted font-medium">温度 (Temperature)</span>
                        <span className="param-chip">{Number(form.temperature).toFixed(1)}</span>
                      </div>
                      <input value={form.temperature} onChange={set('temperature')} type="range" min="0.0" max="2.0" step="0.1" className="ai-range-slider w-full" />
                    </div>
                  )}

                  <div className="flex-column gap-1">
                    <div className="flex-row justify-between items-center text-[10px]">
                      <span className="text-muted font-medium">长度 (Max Output Tokens)</span>
                      <span className="param-chip">{form.maxTokens}</span>
                    </div>
                    <input value={form.maxTokens} onChange={set('maxTokens')} type="range" min="256" max="8192" step="256" className="ai-range-slider w-full" />
                  </div>

                  {!usesGoogleSamplingDefaults && (
                    <div className="flex-column gap-1">
                      <label className="text-[10px] text-muted font-medium">核采样比率 (Top P, 留空默认)</label>
                      <input value={form.topP} onChange={set('topP')} type="text" placeholder="可选输入，例如 0.95" className="form-input" />
                    </div>
                  )}

                  <div className="flex-column gap-2 p-2 bg-deep border border-default rounded-lg reasoning-card">
                    <div className="flex-row justify-between items-center">
                      <div className="flex-column">
                        <span className="text-[11px] font-semibold text-strong">启动思考模型推理</span>
                        <span className="text-[8px] text-muted">支持输出思维链 (CoT)</span>
                      </div>
                      <button className={`switch${form.enableReasoning ? ' active' : ''}`} onClick={() => setVal('enableReasoning', !form.enableReasoning)}><span></span></button>
                    </div>
                    <div className="flex-column gap-1.5 border-t pt-2">
                      <label className="text-[9px] text-muted font-medium">思考等级 (Thinking Level)</label>
                      <select value={form.thinkingLevel} onChange={set('thinkingLevel')} className="form-select p-1 text-[10px]">
                        {THINKING_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="flex-row justify-end gap-2 pt-4 mt-4 border-t bg-transparent">
                  <button className="btn btn-secondary" onClick={() => setModalVisible(false)}>取消</button>
                  <button className="btn btn-primary font-bold" onClick={savePreset}>保存预设</button>
                </div>
              </div>

            </div>
      </Modal>
    </div>
  )
}
