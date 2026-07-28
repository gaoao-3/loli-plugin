import React, { useState } from 'react'
import { api } from '../api'
import Icon from '../icons.jsx'
import Modal from '../Modal.jsx'

const SAFETY_LEVELS = {
  default: '模型默认',
  off: '关闭附加过滤',
  permissive: '宽松',
  balanced: '均衡',
  strict: '严格'
}

// GLM 智谱:仅 UI 便利项,保存时按 openai 适配器提交
const GLM_DEFAULTS = {
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  models: 'glm-4.6, glm-4.5-air',
  name: 'GLM'
}

const emptyForm = {
  id: '', name: '', adapterType: 'gemini', models: '', apiKey: '', baseUrl: '',
  safetyLevel: 'default', isEdit: false
}

export default function Channels({ channels, refresh, showToast, runTask }) {
  const [modalVisible, setModalVisible] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [modelsExpanded, setModelsExpanded] = useState(false)
  const [newModel, setNewModel] = useState('')
  const [modelTests, setModelTests] = useState({})

  const showSaveResult = (result, successMessage) => {
    showToast(result?.configMirrorPersisted === false
      ? `${successMessage}；config.json 镜像更新失败，将在后续自动修复`
      : successMessage)
  }

  const isGemini = form.adapterType === 'gemini'

  const modelList = form.models.split(',').map(s => s.trim()).filter(Boolean)

  const setModels = (list) => setForm(f => ({ ...f, models: list.join(', ') }))

  const addModel = () => {
    const model = newModel.trim()
    if (!model) return
    if (modelList.includes(model)) {
      showToast('该模型已在列表中', 'warning')
      return
    }
    setModels([...modelList, model])
    setNewModel('')
  }

  const removeModel = (model) => setModels(modelList.filter(m => m !== model))

  const testModelByName = async (model) => {
    setModelTests(t => ({ ...t, [model]: { status: 'testing' } }))
    try {
      const result = await api.post('/channels/models/test', {
        adapterType: form.adapterType === 'glm' ? 'openai' : form.adapterType,
        options: {
          apiKey: form.apiKey,
          baseUrl: form.baseUrl,
          ...(isGemini ? { safetyLevel: form.safetyLevel } : {})
        },
        model
      })
      setModelTests(t => ({
        ...t,
        [model]: result?.ok
          ? { status: 'ok', latencyMs: result.latencyMs, reply: result.reply }
          : { status: 'fail', error: result?.error || '测试失败' }
      }))
    } catch (err) {
      setModelTests(t => ({ ...t, [model]: { status: 'fail', error: err?.message || '请求失败' } }))
    }
  }

  const isTestingAny = modelList.some(m => modelTests[m]?.status === 'testing')

  const testAllModels = async () => {
    // 并发 3 路，避免一次性打满中转渠道
    const queue = [...modelList]
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length > 0) await testModelByName(queue.shift())
    })
    await Promise.all(workers)
  }

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }))

  const openAdd = () => {
    setForm({
      ...emptyForm,
      models: 'gemini-2.5-flash, gemini-2.5-pro, gemini-2.0-flash-thinking-exp'
    })
    setModelsExpanded(true)
    setNewModel('')
    setModelTests({})
    setModalVisible(true)
  }

  const openEdit = (ch) => {
    setForm({
      id: ch.id,
      name: ch.name || '',
      adapterType: ch.adapterType || 'gemini',
      models: (ch.models || []).join(', '),
      apiKey: ch.options?.apiKey || ch.apiKey || '',
      baseUrl: ch.options?.baseUrl || ch.baseUrl || '',
      safetyLevel: ch.options?.safetyLevel || ch.safetyLevel || 'default',
      isEdit: true
    })
    setModelsExpanded(false)
    setNewModel('')
    setModelTests({})
    setModalVisible(true)
  }

  const onAdapterChange = (e) => {
    const adapterType = e.target.value
    setForm(f => ({
      ...f,
      adapterType,
      // GLM 按 openai 处理,预填官方端点/默认模型/名称(名称仅在为空时填)
      ...(adapterType === 'glm' ? {
        baseUrl: GLM_DEFAULTS.baseUrl,
        models: GLM_DEFAULTS.models,
        name: f.name.trim() ? f.name : GLM_DEFAULTS.name
      } : {})
    }))
  }

  const fetchChannelModels = async () => {
    setIsFetchingModels(true)
    try {
      const result = await api.post('/channels/models/discover', {
        adapterType: form.adapterType === 'glm' ? 'openai' : form.adapterType,
        options: {
          apiKey: form.apiKey,
          baseUrl: form.baseUrl
        }
      })
      const fetched = Array.isArray(result?.models) ? result.models : []
      setForm(f => ({ ...f, models: fetched.join(', ') }))
      setModelsExpanded(true)
      showToast(`已成功获取 ${fetched.length} 个可用模型`)
    } catch (err) {
      console.error(err)
    } finally {
      setIsFetchingModels(false)
    }
  }

  const saveChannel = () => runTask(async () => {
    if (!form.id.trim() || !form.name.trim()) {
      showToast('请输入渠道 ID 和名称', 'warning')
      return
    }
    const models = form.models.split(',').map(s => s.trim()).filter(Boolean)
    const existing = form.isEdit ? channels.find(c => c.id === form.id) : null
    const options = { ...(existing?.options || {}) }
    delete options.providerType
    delete options.protocol
    options.apiKey = form.apiKey
    options.baseUrl = form.baseUrl
    if (isGemini) options.safetyLevel = form.safetyLevel
    else delete options.safetyLevel
    const payload = {
      id: form.id.trim(),
      name: form.name.trim(),
      // GLM 仅 UI 便利项,实际按 openai 适配器保存
      adapterType: form.adapterType === 'glm' ? 'openai' : form.adapterType,
      models,
      options,
      status: existing?.status || 'enabled'
    }
    const result = form.isEdit
      ? await api.put(`/channels/${form.id}`, payload)
      : await api.post('/channels', payload)
    showSaveResult(result, '渠道保存成功')
    setModalVisible(false)
    await refresh()
  })

  const toggleStatus = (ch) => runTask(async () => {
    const result = await api.put(`/channels/${ch.id}`, { ...ch, status: ch.status === 'enabled' ? 'disabled' : 'enabled' })
    showSaveResult(result, '渠道状态已更新')
    await refresh()
  })

  const deleteChannel = (ch) => runTask(async () => {
    if (!window.confirm(`确认要删除适配器渠道 "${ch.name} (${ch.id})"?`)) return
    const result = await api.delete(`/channels/${ch.id}`)
    showSaveResult(result, '渠道已成功删除')
    await refresh()
  })

  return (
    <div className="pane-content select-text">
      <div className="flex-row justify-between items-center mb-4">
        <h2 className="text-lg font-bold text-strong">// AI 渠道管理</h2>
        <button className="btn btn-primary" onClick={openAdd}>
          <Icon name="plus" size={12} />添加新渠道
        </button>
      </div>

      <div className="card">
        <div className="table-container">
          <table className="data-table channel-table">
            <thead>
              <tr>
                <th>名称 / ID</th><th>适配器</th><th>支持模型</th><th>状态</th><th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {channels.length === 0 && (
                <tr><td colSpan="5" className="empty-cell">暂无已配置的适配器渠道</td></tr>
              )}
              {channels.map(ch => (
                <tr key={ch.id} className="hover-row">
                  <td>
                    <div className="flex-column">
                      <span className="text-sm font-bold text-strong">{ch.name}</span>
                      <span className="text-[10px] font-mono text-muted mt-0.5">{ch.id}</span>
                    </div>
                  </td>
                  <td>
                    <div className="flex-column gap-1 items-start">
                      <span className="font-mono text-xs uppercase bg-elevated px-1.5 py-0.5 rounded text-soft border border-default">{ch.adapterType || 'gemini'}</span>
                      {ch.adapterType === 'gemini' && (
                        <span className="text-[10px] text-muted">安全：{SAFETY_LEVELS[ch.options?.safetyLevel] || '模型默认'}</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="channel-model-summary" aria-label={`共 ${(ch.models || []).length} 个模型`}>
                      <div className="channel-model-tags">
                        {(ch.models || []).slice(0, 2).map(model => (
                          <span key={model} className="channel-model-tag" title={model}>{model}</span>
                        ))}
                        {(ch.models || []).length > 2 && (
                          <span className="channel-model-more">+{(ch.models || []).length - 2}</span>
                        )}
                      </div>
                      <span className="channel-model-count">共 {(ch.models || []).length} 个</span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${ch.status === 'enabled' ? 'badge-success' : 'badge-gray'}`}>{ch.status === 'enabled' ? '已启用' : '已禁用'}</span>
                  </td>
                  <td>
                    <div className="flex-row justify-end gap-2">
                      <button className="btn btn-secondary py-1 px-2 text-[11px]" onClick={() => openEdit(ch)}>编辑</button>
                      <button className={`btn py-1 px-2 text-[11px] ${ch.status === 'enabled' ? 'btn-danger' : 'btn-success'}`} onClick={() => toggleStatus(ch)}>
                        {ch.status === 'enabled' ? '禁用' : '启用'}
                      </button>
                      <button className="btn btn-danger py-1 px-2 text-[11px] opacity-70 hover:opacity-100" onClick={() => deleteChannel(ch)}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Channel Modal */}
      <Modal open={modalVisible} onClose={() => setModalVisible(false)} maxWidth={450}>
            <div className="modal-header">
              <span className="modal-title">{form.isEdit ? '编辑 AI 渠道' : '添加 AI 渠道'}</span>
              <button className="modal-close" onClick={() => setModalVisible(false)}>×</button>
            </div>
            <div className="modal-body flex-column gap-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex-column gap-1">
                  <label className="text-[10px] text-muted font-medium">渠道 ID</label>
                  <input value={form.id} onChange={set('id')} type="text" placeholder="gemini" className="form-input" disabled={form.isEdit} />
                </div>
                <div className="flex-column gap-1">
                  <label className="text-[10px] text-muted font-medium">渠道名称</label>
                  <input value={form.name} onChange={set('name')} type="text" placeholder="谷歌官方" className="form-input" />
                </div>
              </div>
              <div className="flex-column gap-1">
                <label className="text-[10px] text-muted font-medium">API 适配器</label>
                <select value={form.adapterType} onChange={onAdapterChange} className="form-select">
                  <option value="gemini">Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="anythingllm">AnythingLLM</option>
                  <option value="glm">GLM 智谱 API Key</option>
                </select>
              </div>
              <div className="flex-column gap-1">
                <label className="text-[10px] text-muted font-medium">支持模型列表</label>
                <div className="flex-row gap-2">
                  <button type="button" className="model-list-toggle" onClick={() => setModelsExpanded(v => !v)} aria-expanded={modelsExpanded}>
                    <span className="model-list-toggle-text">
                      {modelList.length === 0 ? '暂无模型' : `共 ${modelList.length} 个模型`}
                    </span>
                    <Icon name="chevronDown" size={12} />
                  </button>
                  <button type="button" className="btn btn-secondary whitespace-nowrap" onClick={fetchChannelModels} disabled={isFetchingModels}>
                    {isFetchingModels ? '获取中…' : '获取模型'}
                  </button>
                </div>
                {modelsExpanded && (
                  <div className="model-editor">
                    {modelList.length > 1 && (
                      <div className="model-editor-toolbar">
                        <button type="button" className="model-test-all" onClick={testAllModels} disabled={isTestingAny}>
                          {isTestingAny ? '测试中…' : '全部测试'}
                        </button>
                      </div>
                    )}
                    {modelList.length === 0 && (
                      <span className="text-[10px] text-faint">暂无模型，请在下方添加或点击"获取模型"</span>
                    )}
                    {modelList.map(model => {
                      const test = modelTests[model]
                      const testTitle = test?.status === 'fail'
                        ? test.error
                        : test?.status === 'ok'
                          ? (test.reply ? `回复：${test.reply}` : '测试通过')
                          : `测试 ${model}`
                      return (
                        <span key={model} className="model-editor-tag" title={test?.status === 'fail' ? test.error : model}>
                          <button
                            type="button"
                            className={`model-editor-tag-test${test ? ` is-${test.status}` : ''}`}
                            onClick={() => testModelByName(model)}
                            disabled={test?.status === 'testing'}
                            title={testTitle}
                            aria-label={`测试 ${model}`}
                          >
                            {test?.status === 'testing' ? '…' : test?.status === 'ok' ? '✓' : test?.status === 'fail' ? '✗' : <Icon name="play" size={9} />}
                          </button>
                          <span className="model-editor-tag-text">{model}</span>
                          {test?.status === 'ok' && <span className="model-test-latency">{test.latencyMs}ms</span>}
                          <button type="button" className="model-editor-tag-remove" onClick={() => removeModel(model)} aria-label={`移除 ${model}`}>×</button>
                        </span>
                      )
                    })}
                    <div className="flex-row gap-2 model-editor-add">
                      <input
                        value={newModel}
                        onChange={e => setNewModel(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addModel() } }}
                        type="text"
                        placeholder="输入模型名，回车添加"
                        className="form-input flex-1 min-w-0"
                      />
                      <button type="button" className="btn btn-secondary whitespace-nowrap" onClick={addModel} disabled={!newModel.trim()}>添加</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex-column gap-1">
                <label className="text-[10px] text-muted font-medium">API Key</label>
                <input value={form.apiKey} onChange={set('apiKey')} type="password" placeholder="请输入密钥..." className="form-input" />
              </div>
              <div className="flex-column gap-1">
                <label className="text-[10px] text-muted font-medium">Base URL (API 终结点)</label>
                <input value={form.baseUrl} onChange={set('baseUrl')} type="text" placeholder="默认使用官方端点，如需中转请填写" className="form-input" />
              </div>
              {isGemini && (
                <div className="flex-column gap-1">
                  <label className="text-[10px] text-muted font-medium">Gemini 安全等级</label>
                  <select value={form.safetyLevel} onChange={set('safetyLevel')} className="form-select">
                    <option value="default">跟随模型默认</option>
                    <option value="off">关闭附加过滤</option>
                    <option value="permissive">宽松（仅高风险拦截）</option>
                    <option value="balanced">均衡（中高风险拦截）</option>
                    <option value="strict">严格（低风险起拦截）</option>
                  </select>
                  <span className="text-[10px] text-faint">统一作用于骚扰、仇恨、露骨内容和危险内容；Gemini 核心保护不可关闭。</span>
                </div>
              )}
            </div>
            <div className="modal-footer justify-end">
              <button className="btn btn-secondary" onClick={() => setModalVisible(false)}>取消</button>
              <button className="btn btn-primary" onClick={saveChannel}>保存</button>
            </div>
      </Modal>

    </div>
  )
}
