import React, { useState } from 'react'
import Icon from '../icons.jsx'
import { api } from '../api.js'

const TABS = [
  { id: 'trigger', label: '触发与范围' },
  { id: 'session', label: '会话与冷却' },
  { id: 'model', label: '模型与媒体' },
  { id: 'memory', label: '记忆系统' },
  { id: 'system', label: '模板与系统' }
]

function Switch({ checked, onChange }) {
  return (
    <button type="button" className={`switch${checked ? ' active' : ''}`} onClick={() => onChange(!checked)}>
      <span></span>
    </button>
  )
}

// 渠道 ID 输入 + 已配置渠道快捷切换
function ChannelInput({ channels, value, onChange, placeholder }) {
  const list = Array.isArray(channels) ? channels : []
  const matched = list.some(c => c.id === value)
  return (
    <div className="flex-row gap-2 items-center">
      <input value={value} onChange={onChange} type="text" className="form-input" placeholder={placeholder} />
      <select
        className="form-select channel-quick-select"
        value={matched ? value : ''}
        onChange={(e) => e.target.value && onChange({ target: { value: e.target.value } })}
        title="快捷切换渠道"
      >
        <option value="">快捷切换渠道</option>
        {list.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
      </select>
    </div>
  )
}

export default function Config({ localConfig, setLocalConfig, saveConfig, channels = [] }) {
  const [tab, setTab] = useState('trigger')
  const [dokobotStatus, setDokobotStatus] = useState(null)
  const [checkingDokobot, setCheckingDokobot] = useState(false)

  if (!localConfig) return <div className="pane-content select-text"></div>

  // 路径式深更新
  const setPath = (path, value) => setLocalConfig(prev => {
    const keys = path.split('.')
    const root = { ...prev }
    let src = prev
    let dst = root
    for (let i = 0; i < keys.length - 1; i++) {
      dst[keys[i]] = { ...src[keys[i]] }
      dst = dst[keys[i]]
      src = src[keys[i]]
    }
    dst[keys[keys.length - 1]] = value
    return root
  })
  const bind = (path) => ({
    value: path.split('.').reduce((o, k) => o?.[k], localConfig) ?? '',
    onChange: (e) => setPath(path, e.target.value)
  })
  const bindSwitch = (path) => ({
    checked: !!path.split('.').reduce((o, k) => o?.[k], localConfig),
    onChange: (v) => setPath(path, v)
  })

  const checkDokobot = async () => {
    setCheckingDokobot(true)
    try {
      setDokobotStatus(await api.get('/system/dokobot'))
    } catch (err) {
      setDokobotStatus({ available: false, error: err.message })
    } finally {
      setCheckingDokobot(false)
    }
  }

  const loli = localConfig.loli
  const masterIdentity = loli.masterIdentity || {}
  const masterUsers = Array.isArray(masterIdentity.users) ? masterIdentity.users : []
  const masterNames = new Map(masterUsers.map(u => [String(u.userId), u.nickname || '']))
  const masterIdentitiesList = (masterIdentity.userIds || [])
    .map(id => `${id}${masterNames.get(String(id)) ? ` · ${masterNames.get(String(id))}` : ' · 待获取昵称'}`)
    .join('\n')

  return (
    <div className="pane-content select-text">
      <div className="flex-row justify-between items-center mb-4">
        <h2 className="text-lg font-bold text-strong">// 系统参数配置</h2>
        <button className="btn btn-primary" onClick={saveConfig}>
          <Icon name="save" size={12} />保存全局配置
        </button>
      </div>

      <div className="config-tabs-nav">
        {TABS.map(t => (
          <button key={t.id} className={`config-tab-btn${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="config-sheets-container mt-4">

        {/* Sheet 1: 触发与范围 */}
        {tab === 'trigger' && (
          <div className="config-sheet">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              <div className="lg:col-span-3 flex-column gap-4">
                <div className="card">
                  <span className="card-section-title mb-3 block">// 关键词与触发前缀 (换行分隔)</span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">前缀触发词</label>
                      <textarea {...bind('loli.triggerPrefix')} rows="5" className="form-textarea font-mono"></textarea>
                    </div>
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">响应关键词</label>
                      <textarea {...bind('loli.triggerKeywords')} rows="5" className="form-textarea font-mono"></textarea>
                    </div>
                  </div>
                </div>
                <div className="card">
                  <span className="card-section-title mb-3 block">// 响应范围名单 (黑白名单, 换行分隔)</span>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">群白名单 (留空为全部)</label>
                      <textarea {...bind('loli.groups')} rows="5" className="form-textarea font-mono"></textarea>
                    </div>
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">群黑名单</label>
                      <textarea {...bind('loli.blackGroups')} rows="5" className="form-textarea font-mono"></textarea>
                    </div>
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">用户黑名单</label>
                      <textarea {...bind('loli.blackUsers')} rows="5" className="form-textarea font-mono"></textarea>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-2 flex-column gap-4">
                <div className="card">
                  <span className="card-section-title mb-3 block">// 触发条件开关</span>
                  <div className="flex-column gap-3">
                    <div className="toggle-switch-row">
                      <span className="text-xs font-medium text-soft">伪人模式总开关</span>
                      <Switch {...bindSwitch('loli.enable')} />
                    </div>
                    <div className="toggle-switch-row">
                      <span className="text-xs font-medium text-soft">@ 提到与私聊触发</span>
                      <Switch {...bindSwitch('loli.enableAtTrigger')} />
                    </div>
                    <div className="toggle-switch-row">
                      <span className="text-xs font-medium text-soft">特定前缀词触发</span>
                      <Switch {...bindSwitch('loli.enablePrefixTrigger')} />
                    </div>
                    <div className="toggle-switch-row">
                      <span className="text-xs font-medium text-soft">消息包含关键词触发</span>
                      <Switch {...bindSwitch('loli.enableKeywordTrigger')} />
                    </div>
                    <div className="toggle-switch-row">
                      <span className="text-xs font-medium text-soft">群员闲聊主动触发</span>
                      <Switch {...bindSwitch('loli.enableProactiveTrigger')} />
                    </div>
                  </div>
                </div>

                <div className="card">
                  <span className="card-section-title mb-3 block">// 默认触发参数</span>
                  <div className="flex-column gap-4">
                    <div className="flex-column gap-1">
                      <label className="text-xs text-muted">默认绑定预设 ID</label>
                      <input {...bind('loli.defaultPreset')} type="text" className="form-input" />
                    </div>
                    <div className="flex-column gap-3 border border-default rounded-lg p-3">
                      <div className="toggle-switch-row">
                        <div>
                          <span className="text-xs font-medium text-soft">主人识别与特别称呼</span>
                          <p className="text-[10px] text-faint mt-1">自动读取云崽主人 QQ；主人发言后自动补全 QQ 昵称。</p>
                        </div>
                        <Switch
                          checked={masterIdentity.enable !== false}
                          onChange={(v) => { setPath('loli.masterIdentity.enable', v); setPath('loli.masterIdentity.autoDetect', v) }}
                        />
                      </div>
                      <div className="flex-column gap-1">
                        <label className="text-xs text-muted">已识别主人（QQ · QQ昵称）</label>
                        <textarea value={masterIdentitiesList} rows="3" className="form-textarea font-mono" readOnly placeholder="开启后自动获取"></textarea>
                      </div>
                      <div className="flex-column gap-1">
                        <label className="text-xs text-muted">特别称呼（可选）</label>
                        <input {...bind('loli.masterIdentity.appellation')} type="text" className="form-input" placeholder="例如：老师；留空使用昵称或人设默认称呼" />
                      </div>
                    </div>
                    <div className="flex-column gap-1">
                      <div className="flex-row justify-between text-xs">
                        <span className="text-muted">主动回复概率</span>
                        <span className="font-bold text-accent bg-accent-soft px-1.5 py-0.2 rounded font-mono">{Number(loli.promptProbability || 0).toFixed(2)}</span>
                      </div>
                      <input {...bind('loli.promptProbability')} type="range" min="0.0" max="1.0" step="0.01" className="ai-range-slider mt-2" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sheet 2: 会话与冷却 */}
        {tab === 'session' && (
          <div className="config-sheet">
            <div className="card">
              <span className="card-section-title mb-3 block">// 会话上下文及冷却限制</span>
              <div className="flex-column gap-5">
                <div className="toggle-switch-row max-w-sm">
                  <span className="text-xs font-medium text-soft">附带发送推理思考过程 (Reasoning)</span>
                  <Switch {...bindSwitch('loli.sendReasoning')} />
                </div>
                <div className="toggle-switch-row max-w-sm">
                  <span className="text-xs font-medium text-soft">由 AI 自主决定自然分段</span>
                  <Switch checked={loli.segmentedReply?.enable !== false} onChange={(v) => setPath('loli.segmentedReply.enable', v)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">对话维度划分模式</label>
                    <select {...bind('loli.conversationMode')} className="form-select">
                      <option value="group">群维度</option>
                      <option value="user">用户维度</option>
                      <option value="mixed">群 + 用户混合</option>
                    </select>
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">携带历史上下文条数</label>
                    <input {...bind('loli.contextLength')} type="number" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">会话自动过期窗口 (ms)</label>
                    <input {...bind('loli.sessionWindow')} type="number" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">模型会话历史保留天数（0 不清理）</label>
                    <input {...bind('llm.historyRetentionDays')} type="number" min="0" max="3650" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">用户单人发言冷却 (ms)</label>
                    <input {...bind('loli.cooldownUser')} type="number" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">群聊触发冷却 (ms)</label>
                    <input {...bind('loli.cooldownGroup')} type="number" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">连发限制次数</label>
                    <input {...bind('loli.maxReplyBurst')} type="number" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">防刷屏惩罚冷却 (ms)</label>
                    <input {...bind('loli.burstCooldown')} type="number" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">发送后自动撤回 (秒, 0不撤)</label>
                    <input {...bind('loli.recallDefault')} type="number" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">分段最短字符数</label>
                    <input {...bind('loli.segmentedReply.minLength')} type="number" min="0" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">AI 未分段时的兜底字符数</label>
                    <input {...bind('loli.segmentedReply.maxLength')} type="number" min="1" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">单次最多分段数</label>
                    <input {...bind('loli.segmentedReply.maxSegments')} type="number" min="1" max="20" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">分段最短间隔 (ms)</label>
                    <input {...bind('loli.segmentedReply.delayMin')} type="number" min="0" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">分段最长间隔 (ms)</label>
                    <input {...bind('loli.segmentedReply.delayMax')} type="number" min="0" className="form-input" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sheet 3: 模型与媒体 */}
        {tab === 'model' && (
          <div className="config-sheet">
            <div className="flex-column gap-4">
              <div className="card">
                <span className="card-section-title mb-3 block">// 全局模型参数覆盖 (设置为 -1 或 0 代表关闭)</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="flex-column gap-1.5">
                    <div className="flex-row justify-between text-xs">
                      <span className="text-muted">Temperature (温度覆盖, -1.0 代表不覆盖)</span>
                      <span className="font-bold text-accent bg-accent-soft px-1.5 py-0.2 rounded font-mono">{loli.temperature === -1 ? '默认 (-1)' : Number(loli.temperature).toFixed(1)}</span>
                    </div>
                    <input {...bind('loli.temperature')} type="range" min="-1.0" max="2.0" step="0.1" className="ai-range-slider mt-2" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <div className="flex-row justify-between text-xs">
                      <span className="text-muted">Max Tokens (长度覆盖, 0 代表不覆盖)</span>
                      <span className="font-bold text-accent bg-accent-soft px-1.5 py-0.2 rounded font-mono">{loli.maxTokens === 0 ? '默认 (0)' : loli.maxTokens}</span>
                    </div>
                    <input {...bind('loli.maxTokens')} type="range" min="0" max="8192" step="256" className="ai-range-slider mt-2" />
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="flex-row justify-between items-center border-b pb-2 mb-3">
                  <div>
                    <span className="text-xs font-bold text-muted">// Dokobot 本地搜索与登录态网页读取</span>
                    <p className="text-[10px] text-faint mt-1">复用本机浏览器 Bridge，为 dokobot_search / dokobot_read 读取动态页面；失败可自动回退现有搜索和抓取链路。</p>
                  </div>
                  <Switch {...bindSwitch('dokobot.enable')} />
                </div>
                <div className="flex-column gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="toggle-switch-row">
                      <span className="text-xs font-medium text-soft">仅主人可用</span>
                      <Switch checked={localConfig.dokobot?.masterOnly !== false} onChange={(v) => setPath('dokobot.masterOnly', v)} />
                    </div>
                    <div className="toggle-switch-row">
                      <span className="text-xs font-medium text-soft">失败自动回退</span>
                      <Switch checked={localConfig.dokobot?.fallback !== false} onChange={(v) => setPath('dokobot.fallback', v)} />
                    </div>
                    <div className="toggle-switch-row">
                      <span className="text-xs font-medium text-soft">复用浏览器标签页</span>
                      <Switch checked={localConfig.dokobot?.reuseTab === true} onChange={(v) => setPath('dokobot.reuseTab', v)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="flex-column gap-1.5 md:col-span-2">
                      <label className="text-xs text-muted">CLI 命令或绝对路径</label>
                      <input {...bind('dokobot.cliPath')} type="text" className="form-input font-mono" placeholder="dokobot" />
                    </div>
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">默认搜索引擎</label>
                      <select {...bind('dokobot.searchEngine')} className="form-select">
                        <option value="google">Google</option>
                        <option value="bing">Bing</option>
                        <option value="duckduckgo">DuckDuckGo</option>
                        <option value="baidu">百度</option>
                        <option value="sogou">搜狗</option>
                      </select>
                    </div>
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">超时 (秒)</label>
                      <input {...bind('dokobot.timeoutSeconds')} type="number" min="5" max="300" className="form-input" />
                    </div>
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">默认读取屏数</label>
                      <input {...bind('dokobot.screens')} type="number" min="1" max="20" className="form-input" />
                    </div>
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">最大返回字符数</label>
                      <input {...bind('dokobot.maxTextChars')} type="number" min="1000" max="50000" className="form-input" />
                    </div>
                    <div className="toggle-switch-row md:col-span-2">
                      <div>
                        <span className="text-xs font-medium text-soft">允许访问本机/私网</span>
                        <p className="text-[10px] text-faint mt-1">高风险选项，默认关闭。</p>
                      </div>
                      <Switch checked={localConfig.dokobot?.allowPrivateNetwork === true} onChange={(v) => setPath('dokobot.allowPrivateNetwork', v)} />
                    </div>
                    <div className="flex-column gap-1.5 md:col-span-4">
                      <label className="text-xs text-muted">允许域名（每行一个，空白表示不额外限制公网域名）</label>
                      <textarea {...bind('dokobot.allowedDomains')} rows="3" className="form-textarea font-mono" placeholder={'github.com\ndokobot.ai'} />
                    </div>
                  </div>
                  <div className="flex-row items-center gap-3 flex-wrap">
                    <button type="button" className="btn" onClick={checkDokobot} disabled={checkingDokobot}>
                      {checkingDokobot ? '检查中…' : '检查 CLI / Bridge'}
                    </button>
                    {dokobotStatus && (
                      <span className={`text-[10px] font-mono ${dokobotStatus.available ? 'text-success' : 'text-danger'}`}>
                        {dokobotStatus.available ? (dokobotStatus.bridgeOutput || 'Dokobot 命令可用') : (dokobotStatus.error || 'Dokobot 不可用')}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-faint">先安装 @dokobot/cli 并完成浏览器 Bridge 配对；此开关不会自动安装扩展。登录态可能含敏感数据，建议保持“仅主人可用”并配置域名白名单。</p>
                </div>
              </div>

              <div className="card">
                <div className="flex-row justify-between items-center border-b pb-2 mb-3">
                  <span className="text-xs font-bold text-muted">// 多媒体图片自动压缩优化</span>
                  <Switch {...bindSwitch('loli.imageCompress.enable')} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">图片最大分辨率边长 (px)</label>
                    <input {...bind('loli.imageCompress.maxLongEdge')} type="number" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">压缩 JPEG 质量 (1-100)</label>
                    <input {...bind('loli.imageCompress.quality')} type="number" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">限制单张体积最大值 (KB)</label>
                    <input {...bind('loli.imageCompress.maxFileSizeKB')} type="number" className="form-input" />
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="flex-row justify-between items-center border-b pb-2 mb-3">
                  <span className="text-xs font-bold text-muted">// 多模态历史图片深度</span>
                  <Switch {...bindSwitch('loli.historyImages.enable')} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">携带历史图片最大数量</label>
                    <input {...bind('loli.historyImages.maxImages')} type="number" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">图片缓存有效留存时间 (秒)</label>
                    <input {...bind('loli.historyImages.maxAgeSeconds')} type="number" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">向后回溯消息检测范围</label>
                    <input {...bind('loli.historyImages.contextLength')} type="number" className="form-input" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sheet 4: 记忆系统 */}
        {tab === 'memory' && (
          <div className="config-sheet">
            <div className="flex-column gap-4">
              <div className="card">
                <div className="flex-row justify-between items-center border-b pb-2 mb-3">
                  <div>
                    <span className="text-xs font-bold text-muted">// AI 自主用户印象</span>
                    <p className="text-[10px] text-faint mt-1">按 QQ 直接审查原始群消息，自主合并、修正和删除互动偏好与长期事实；不生成摘要或画像。</p>
                  </div>
                  <Switch checked={localConfig.memory.memberLearning?.enable !== false} onChange={(v) => setPath('memory.memberLearning.enable', v)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">审查模型</label>
                    <input {...bind('memory.memberLearning.model')} type="text" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">审查模型渠道 ID</label>
                    <ChannelInput channels={channels} {...bind('memory.memberLearning.channelId')} placeholder="留空使用 gemini" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">首次审查消息数</label>
                    <input {...bind('memory.memberLearning.minMessages')} type="number" min="4" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">增量复审消息数</label>
                    <input {...bind('memory.memberLearning.updateEveryMessages')} type="number" min="3" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">审查窗口（天）</label>
                    <input {...bind('memory.memberLearning.windowDays')} type="number" min="1" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">单次最多读取消息数</label>
                    <input {...bind('memory.memberLearning.reviewMaxMessages')} type="number" min="12" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">自动采纳置信度</label>
                    <input {...bind('memory.memberLearning.autoApplyMinConfidence')} type="number" min="0" max="1" step="0.01" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">注入最低置信度</label>
                    <input {...bind('memory.memberLearning.injectMinConfidence')} type="number" min="0" max="1" step="0.01" className="form-input" />
                  </div>
                </div>
                <div className="flex-column gap-1.5 mt-4">
                  <label className="text-xs text-muted">采集并学习的群号列表（换行分隔，留空代表全部允许群）</label>
                  <textarea {...bind('memory.group.enabledGroups')} rows="3" className="form-textarea font-mono"></textarea>
                </div>
              </div>

              <div className="card">
                <div className="flex-row justify-between items-center border-b pb-2 mb-3">
                  <div>
                    <span className="text-xs font-bold text-muted">// AI 自主群风格</span>
                    <p className="text-[10px] text-faint mt-1">AI 根据跨成员证据维护完整的紧凑群风格快照，可主动合并、改写和删除旧条目；不再生成重复的群级主观记忆。</p>
                  </div>
                  <Switch checked={localConfig.memory.groupLearning?.enable !== false} onChange={(v) => setPath('memory.groupLearning.enable', v)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">群风格审查模型</label>
                    <input {...bind('memory.groupLearning.model')} type="text" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">群风格模型渠道 ID</label>
                    <ChannelInput channels={channels} {...bind('memory.groupLearning.channelId')} placeholder="留空使用 gemini" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">首次学习消息数</label>
                    <input {...bind('memory.groupLearning.minMessages')} type="number" min="20" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">增量复审消息数</label>
                    <input {...bind('memory.groupLearning.updateEveryMessages')} type="number" min="10" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">最少活跃成员数</label>
                    <input {...bind('memory.groupLearning.minActiveUsers')} type="number" min="2" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">分析窗口（天）</label>
                    <input {...bind('memory.groupLearning.windowDays')} type="number" min="1" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">自动采纳置信度</label>
                    <input {...bind('memory.groupLearning.autoApplyMinConfidence')} type="number" min="0" max="1" step="0.01" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">每位成员最大样本数</label>
                    <input {...bind('memory.groupLearning.maxSamplesPerUser')} type="number" min="5" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">未处理证据最长保留天数</label>
                    <input {...bind('memory.messageRetentionDays')} type="number" min="1" className="form-input" />
                    <span className="text-[10px] text-faint">双方已消费的消息会立即清理；这里只限制尚未达到学习门槛或处理失败的消息。</span>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="flex-row justify-between items-center border-b pb-2 mb-3">
                  <div>
                    <span className="text-xs font-bold text-muted">// 会话历史压缩（滚动摘要）</span>
                    <p className="text-[10px] text-faint mt-1">会话超过阈值后，最老的消息由记忆模型合并成摘要，控制多轮对话的 token 开销。</p>
                  </div>
                  <Switch checked={localConfig.llm?.historyCompress?.enable !== false} onChange={(v) => setPath('llm.historyCompress.enable', v)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">压缩模型</label>
                    <input {...bind('llm.historyCompress.model')} type="text" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">压缩模型渠道 ID</label>
                    <ChannelInput channels={channels} {...bind('llm.historyCompress.channelId')} placeholder="留空使用群风格渠道" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">每轮重发历史条数上限</label>
                    <input {...bind('llm.historyMaxMessages')} type="number" min="1" max="200" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">压缩触发消息数</label>
                    <input {...bind('llm.historyCompress.triggerMessages')} type="number" min="2" max="500" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">单次压缩批量条数</label>
                    <input {...bind('llm.historyCompress.batchSize')} type="number" min="1" max="200" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">摘要硬截断字符数</label>
                    <input {...bind('llm.historyCompress.maxSummaryChars')} type="number" min="200" max="5000" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">压缩时保留最近条数</label>
                    <input {...bind('llm.historyCompress.keepRecent')} type="number" min="1" max="100" className="form-input" />
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* Sheet 5: 模板与系统 */}
        {tab === 'system' && (
          <div className="config-sheet">
            <div className="flex-column gap-4">
              <div className="card">
                <div className="flex-row justify-between items-center border-b pb-2 mb-3">
                  <div>
                    <span className="text-xs font-bold text-muted">// 群聊历史定位信息</span>
                    <p className="text-[10px] text-faint mt-1">消息正文、QQ、消息 ID、媒体与引用已合并为一份；历史条数继续使用“会话与冷却”中的群聊上下文数量。</p>
                  </div>
                  <Switch checked={localConfig.llm?.groupTimeline?.enable !== false} onChange={(v) => setPath('llm.groupTimeline.enable', v)} />
                </div>
                <div className="grid grid-cols-1 gap-4">
                  <div className="toggle-switch-row">
                    <span className="text-xs font-medium text-soft">包含当前消息定位信息</span>
                    <Switch checked={localConfig.llm?.groupTimeline?.includeCurrent !== false} onChange={(v) => setPath('llm.groupTimeline.includeCurrent', v)} />
                  </div>
                </div>
              </div>

              <div className="card">
                <span className="card-section-title mb-3 block">// 群聊上下文格式渲染模板 (微调 prompt)</span>
                <div className="flex-column gap-4">
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">头部附加说明 (Template Prefix)</label>
                    <textarea {...bind('llm.groupContextTemplatePrefix')} rows="3" className="form-textarea font-mono"></textarea>
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">对话行渲染格式 (e.g. $[name]: $[message])</label>
                    <textarea {...bind('llm.groupContextTemplateMessage')} rows="3" className="form-textarea font-mono"></textarea>
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">尾部结束指令 (Template Suffix)</label>
                    <textarea {...bind('llm.groupContextTemplateSuffix')} rows="3" className="form-textarea font-mono"></textarea>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="flex-row justify-between items-center border-b pb-2 mb-3">
                  <div>
                    <span className="text-xs font-bold text-muted">// QQ 表情库与 AI 自主表情</span>
                    <p className="text-[10px] text-faint mt-1">主人发送的表情可自动进入 SQLite 表情库，AI 在正文结束后按情绪标签自然跟发表情。</p>
                  </div>
                  <Switch checked={localConfig.stickers?.enable !== false} onChange={(v) => setPath('stickers.enable', v)} />
                </div>
                <div className="toggle-switch-row">
                  <div>
                    <span className="text-xs font-medium text-soft">自动收录主人表情</span>
                    <p className="text-[10px] text-faint mt-1">支持直接构造小黄脸/超级表情；收藏、商城和推荐表情需先发给机器人收录原始消息段。</p>
                  </div>
                  <Switch checked={localConfig.stickers?.autoCollectMaster !== false} onChange={(v) => setPath('stickers.autoCollectMaster', v)} />
                </div>
                <div className="toggle-switch-row mt-3">
                  <div>
                    <span className="text-xs font-medium text-soft">AI 自动识别动画表情标签</span>
                    <p className="text-[10px] text-faint mt-1">后台使用当前视觉模型识别情绪、动作和适用场景，不阻塞群聊。</p>
                  </div>
                  <Switch checked={localConfig.stickers?.autoClassify !== false} onChange={(v) => setPath('stickers.autoClassify', v)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                  <div className="flex-column gap-1">
                    <label className="text-xs text-muted">跟发表情概率 (1-100)</label>
                    <input {...bind('stickers.probability')} type="number" className="form-input" placeholder="默认 35" />
                  </div>
                  <div className="flex-column gap-1">
                    <label className="text-xs text-muted">表情发送冷却时间 (秒)</label>
                    <input {...bind('stickers.cooldownMs')} type="number" className="form-input" placeholder="默认 60" />
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="flex-row justify-between items-center border-b pb-2 mb-3">
                  <div>
                    <span className="text-xs font-bold text-muted">// QQ 消息回应与戳一戳</span>
                    <p className="text-[10px] text-faint mt-1">轻互动能力：AI 概率性给消息贴表情回应；被戳时按概率回戳，不会主动戳陌生人。</p>
                  </div>
                  <Switch checked={localConfig.interactions?.enable !== false} onChange={(v) => setPath('interactions.enable', v)} />
                </div>

                <div className="flex-column gap-4">
                  <div className="flex-column gap-3 border border-default rounded-lg p-3">
                    <div className="toggle-switch-row">
                      <div>
                        <span className="text-xs font-medium text-soft">消息表情回应 (Reaction)</span>
                        <p className="text-[10px] text-faint mt-1">每轮按概率向模型开放消息表情回应。</p>
                      </div>
                      <Switch {...bindSwitch('interactions.reaction.enable')} />
                    </div>
                    <div className="flex-column gap-1">
                      <div className="flex-row justify-between text-xs">
                        <span className="text-muted">表情回应概率</span>
                        <span className="font-bold text-accent bg-accent-soft px-1.5 py-0.2 rounded font-mono">{Number(localConfig.interactions?.reaction?.probability || 0).toFixed(2)}</span>
                      </div>
                      <input {...bind('interactions.reaction.probability')} type="range" min="0.0" max="1.0" step="0.01" className="ai-range-slider mt-2" />
                    </div>
                    <div className="flex-column gap-1">
                      <label className="text-xs text-muted">同一群同一用户回应冷却 (秒)</label>
                      <input {...bind('interactions.reaction.cooldownMs')} type="number" min="0" className="form-input" />
                    </div>
                  </div>

                  <div className="flex-column gap-3 border border-default rounded-lg p-3">
                    <div className="toggle-switch-row">
                      <div>
                        <span className="text-xs font-medium text-soft">戳一戳回戳 (Poke)</span>
                        <p className="text-[10px] text-faint mt-1">仅对用户先戳机器人做概率回戳。</p>
                      </div>
                      <Switch {...bindSwitch('interactions.poke.enable')} />
                    </div>
                    <div className="flex-column gap-1">
                      <div className="flex-row justify-between text-xs">
                        <span className="text-muted">回戳概率</span>
                        <span className="font-bold text-accent bg-accent-soft px-1.5 py-0.2 rounded font-mono">{Number(localConfig.interactions?.poke?.returnProbability || 0).toFixed(2)}</span>
                      </div>
                      <input {...bind('interactions.poke.returnProbability')} type="range" min="0.0" max="1.0" step="0.01" className="ai-range-slider mt-2" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex-column gap-1">
                        <label className="text-xs text-muted">回戳冷却 (秒)</label>
                        <input {...bind('interactions.poke.cooldownMs')} type="number" min="0" className="form-input" />
                      </div>
                      <div className="flex-column gap-1">
                        <label className="text-xs text-muted">每人每日回戳上限</label>
                        <input {...bind('interactions.poke.dailyUserLimit')} type="number" min="0" className="form-input" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="flex-row justify-between items-center border-b pb-2 mb-3">
                  <div>
                    <span className="text-xs font-bold text-muted">// 代码与浏览器沙盒 (Microsandbox)</span>
                    <p className="text-[10px] text-faint mt-1">使用本机 microVM 隔离执行，无需 Docker；支持代码、无头 Chromium、QQ 媒体输入与 outputs/ 产物回发。</p>
                  </div>
                  <Switch {...bindSwitch('sandbox.enable')} />
                </div>
                <div className="flex-column gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="toggle-switch-row">
                      <span className="text-xs font-medium text-soft">仅主人可用 (masterOnly)</span>
                      <Switch checked={localConfig.sandbox?.masterOnly !== false} onChange={(v) => setPath('sandbox.masterOnly', v)} />
                    </div>
                    <div className="toggle-switch-row">
                      <span className="text-xs font-medium text-soft">QQ 文件进出沙盒 (mediaIO)</span>
                      <Switch checked={localConfig.sandbox?.mediaIO !== false} onChange={(v) => setPath('sandbox.mediaIO', v)} />
                    </div>
                    <div className="toggle-switch-row">
                      <span className="text-xs font-medium text-soft">发送工具执行记录</span>
                      <Switch checked={localConfig.sandbox?.executionReport !== false} onChange={(v) => setPath('sandbox.executionReport', v)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="toggle-switch-row">
                      <span className="text-xs font-medium text-soft">启用无头浏览器 (browser_use)</span>
                      <Switch checked={localConfig.sandbox?.browserEnable !== false} onChange={(v) => setPath('sandbox.browserEnable', v)} />
                    </div>
                    <div className="toggle-switch-row">
                      <span className="text-xs font-medium text-soft">浏览器忽略 HTTPS 证书错误</span>
                      <Switch checked={localConfig.sandbox?.browserIgnoreHTTPSErrors === true} onChange={(v) => setPath('sandbox.browserIgnoreHTTPSErrors', v)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">默认语言</label>
                      <select {...bind('sandbox.defaultLanguage')} className="form-select">
                        <option value="python">python</option>
                        <option value="javascript">javascript</option>
                        <option value="typescript">typescript</option>
                        <option value="java">java</option>
                        <option value="go">go</option>
                        <option value="bash">bash</option>
                      </select>
                    </div>
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">单次请求/执行超时 (秒)</label>
                      <input {...bind('sandbox.requestTimeoutSeconds')} type="number" className="form-input" />
                    </div>
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">沙盒最长存活 (秒)</label>
                      <input {...bind('sandbox.sandboxTimeoutSeconds')} type="number" className="form-input" />
                    </div>
                    <div className="flex-column gap-1.5 md:col-span-2">
                      <label className="text-xs text-muted">Python OCI 镜像</label>
                      <input {...bind('sandbox.microsandboxImage')} type="text" className="form-input" placeholder="python:3.14-slim" />
                    </div>
                    <div className="flex-column gap-1.5 md:col-span-3">
                      <label className="text-xs text-muted">Python 预装依赖（每行一个，无需 Docker）</label>
                      <textarea {...bind('sandbox.pythonDependencies')} rows="5" className="form-textarea font-mono" placeholder={'pillow\nnumpy\npandas\nopenpyxl'} />
                      <p className="text-[10px] text-faint">首次运行会在 Microsandbox microVM 内安装并保存快照；镜像或列表变化时自动生成新快照。</p>
                    </div>
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">依赖安装超时 (秒)</label>
                      <input {...bind('sandbox.dependencyInstallTimeoutSeconds')} type="number" min="30" className="form-input" />
                    </div>
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">快照构建最长时间 (秒)</label>
                      <input {...bind('sandbox.dependencySnapshotTimeoutSeconds')} type="number" min="60" className="form-input" />
                    </div>
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">microVM 内存 (MiB)</label>
                      <input {...bind('sandbox.microsandboxMemoryMiB')} type="number" min="128" className="form-input" />
                    </div>
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">microVM vCPU</label>
                      <input {...bind('sandbox.microsandboxCpus')} type="number" min="1" className="form-input" />
                    </div>
                    <div className="toggle-switch-row">
                      <span className="text-xs font-medium text-soft">允许受限公网访问</span>
                      <Switch checked={localConfig.sandbox?.microsandboxNetwork !== false} onChange={(v) => setPath('sandbox.microsandboxNetwork', v)} />
                    </div>
                    <div className="flex-column gap-1.5 md:col-span-2">
                      <label className="text-xs text-muted">Playwright 浏览器 OCI 镜像</label>
                      <input {...bind('sandbox.microsandboxBrowserImage')} type="text" className="form-input" placeholder="mcr.microsoft.com/playwright:v1.61.0-noble" />
                    </div>
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">浏览器动作超时 (秒)</label>
                      <input {...bind('sandbox.browserTimeoutSeconds')} type="number" min="1" className="form-input" />
                    </div>
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">浏览器 microVM 内存 (MiB)</label>
                      <input {...bind('sandbox.browserMemoryMiB')} type="number" min="512" className="form-input" />
                    </div>
                    <div className="flex-column gap-1.5">
                      <label className="text-xs text-muted">浏览器 microVM vCPU</label>
                      <input {...bind('sandbox.browserCpus')} type="number" min="1" className="form-input" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="flex-row justify-between items-center border-b pb-2 mb-3">
                  <span className="text-xs font-bold text-muted">// 管理控制台本地服务</span>
                  <Switch {...bindSwitch('dashboard.enable')} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">控制台监听端口</label>
                    <input {...bind('dashboard.port')} type="number" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">服务绑定 IP (host)</label>
                    <input {...bind('dashboard.host')} type="text" className="form-input" />
                  </div>
                  <div className="flex-column gap-1.5">
                    <label className="text-xs text-muted">控制台安全令牌 (authToken)</label>
                    <input {...bind('dashboard.authToken')} type="password" className="form-input" />
                  </div>
                </div>
                <p className="text-[10px] text-muted mt-3">端口、绑定 IP 和控制台开关会在下次重启 Yunzai 后生效；安全令牌保存后立即生效。</p>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
