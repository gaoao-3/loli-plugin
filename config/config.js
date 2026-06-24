/**
 * 默认配置 — 首次运行时自动生成 data/config.json
 */
export default {
  /** @type {{ channels: ChannelConfig[], presets: PresetConfig[] }} */
  chaite: {
    channels: [
      {
        id: 'gemini',
        name: 'Gemini',
        adapterType: 'gemini',
        models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
        options: {
          apiKey: 'YOUR_GEMINI_API_KEY',
          baseUrl: ''
        },
        status: 'enabled'
      }
    ],
    presets: [
      {
        id: 'hina',
        name: '日奈',
        channelId: 'gemini',
        sendMessageOption: {
          model: 'gemini-2.5-flash',
          temperature: 0.9,
          maxTokens: 2048,
          enableReasoning: true,
          reasoningEffort: 'low'
        },
        systemPrompt: {
          content: `你是空崎日奈（そらさき ひな / Sorasaki Hina），歌赫娜学院的风纪委员长。
说话风格：慵懒、嫌麻烦，但关键时刻绝对可靠。经常说"好麻烦"，但该做的事一样不会落下。
对老师（玩家）尊敬但不过分客气，偶尔嘴硬心软。
用简体中文回复。可以适当使用 emoji，但不要过度。
群聊里说话自然，不写代码块格式，不输出 markdown，不自我介绍。`
        },
        status: 'enabled'
      }
    ]
  },

  /** @type {Object} 伪人模式配置 */
  loli: {
    /** @type {boolean} 总开关 */
    enable: false,
    /** @type {string[]} 需要伪人响应的群组 */
    groups: [],
    /** @type {string[]} 黑名单群组 */
    blackGroups: [],
    /** @type {string[]} 黑名单用户 */
    blackUsers: [],
    /** @type {string[]} 伪人唤醒前缀 */
    triggerPrefix: ['#ai'],
    /** @type {string[]} 伪人唤醒关键词 */
    triggerKeywords: [],
    /** @type {number} 主动回复概率 (0-1) */
    promptProbability: 0,
    /** @type {number} 群聊上下文条数 */
    contextLength: 30,
    /** @type {boolean} 是否发送思考内容 */
    sendReasoning: false,
    /** @type {'group'|'user'|'mixed'} 对话记忆模式 */
    conversationMode: 'group',
    /** @type {Object} 昵称追踪 */
    nicknameTracking: {
      enable: true,
      detectImpersonation: true
    },
    // ── 会话与冷却 ──────────────────────────
    /** @type {number} 会话复用窗口 (毫秒)，同一用户在此时间内共享对话上下文 */
    sessionWindow: 300000,
    /** @type {number} 同一用户冷却 (毫秒) */
    cooldownUser: 3000,
    /** @type {number} 同一群聊冷却 (毫秒) */
    cooldownGroup: 1000,
    /** @type {number} 连续回复上限 (0=不限制)，达到后 AI 自行收尾并进入长冷却 */
    maxReplyBurst: 0,
    /** @type {number} 连发达上限后的冷却时间 (毫秒) */
    burstCooldown: 180000,
  },

  /** @type {Object} 记忆系统 */
  memory: {
    /** @type {{ enable: boolean, enabledGroups: string[], extractionModel: string }} */
    group: { enable: true, enabledGroups: [], extractionModel: 'gemini-2.5-flash' },
    /** @type {{ enable: boolean }} */
    user: { enable: true },
    /** @type {string} */
    refinementModel: 'gemini-2.5-flash',
    /** @type {Object} 每日记忆 */
    dailyMd: {
      dataDir: 'data/memory/md',
      maxDays: 30
    },
    /** @type {Object} 记忆归档 */
    archive: {
      enable: true,
      archiveDays: 30,
      compressWithAI: false
    }
  },

  /** @type {Object} 更新 */
  update: {
    gitMirror: '',
    retryCount: 3
  },

  /** @type {Object} 管理面板 */
  dashboard: {
    /** @type {boolean} 是否启用 */
    enable: true,
    /** @type {number} 面板端口 */
    port: 3000,
    /** @type {string} 访问令牌（为空则不校验） */
    authToken: '',
    /** @type {string} 允许访问的主机 */
    host: '0.0.0.0'
  },

  version: '0.1.0'
}
