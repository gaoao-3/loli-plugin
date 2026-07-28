/**
 * 帮助与运行状态 — #loli帮助 / #loli状态
 */
import { makeForwardMsg } from '../utils/bot.js'
import { getStats } from '../memory/store.js'
import { resolveMemoryBaseDir } from '../memory/options.js'
import { getStickerStats } from '../utils/stickers.js'
import { getConfig, getDashboardServer, getEngine, PLUGIN_ROOT } from '../utils/state.js'

const loadedAt = Date.now()

export class loliHelp extends plugin {
  constructor () {
    super({
      name: 'loli-帮助',
      dsc: 'loli帮助指令',
      event: 'message',
      priority: 600,
      rule: [
        { reg: '^#loli帮助$', fnc: 'showHelp' },
        { reg: '^#loli状态$', fnc: 'showStatus' }
      ]
    })
  }

  async showHelp (e) {
    const cfg = getConfig() || {}
    const loli = cfg.loli || {}
    const prefix = formatList(loli.triggerPrefix, '#ai')
    const keywords = formatList(loli.triggerKeywords, '未配置')
    const version = cfg.version || '0.1.0'
    const stickerConfig = cfg.stickers || {}
    const stickerProbability = formatStickerProbability(stickerConfig.probability)
    const stickerCooldown = formatStickerCooldown(stickerConfig.cooldownMs)
    const interactionConfig = cfg.interactions || {}
    const reactionConfig = interactionConfig.reaction || {}
    const pokeConfig = interactionConfig.poke || {}

    const sections = [
      [
        '🤖 AI 对话',
        '• @机器人：直接发起对话',
        `• 对话前缀：${prefix}`,
        `• 唤醒关键词：${keywords}`,
        '• 支持图片理解、群聊上下文与自然分段回复',
        '• AI 可自主调用搜索、天气、音乐等工具'
      ].join('\n'),
      [
        '🧠 AI 用户印象',
        '• #我的印象　查看 AI 自主维护的沟通偏好与长期印象',
        '• #用户印象 <QQ号>　查看指定 QQ 的用户印象（主人）',
        '• #立即更新我的印象　立即审查自己的近期原始消息（主人）',
        '• 旧指令 #我的记忆 / #群友记忆 仍可兼容',
        '• #我的身份　查看 QQ 身份账本与防冒充信息'
      ].join('\n'),
      [
        '🎭 AI 群风格',
        '• #群风格　查看 AI 自主维护的紧凑群风格',
        '• #群学习状态　查看快照版本和审查状态',
        '• #立即学习群风格　立即生成一次新快照（主人）',
        '• #群风格回滚 <版本号>　回滚学习结果（主人）'
      ].join('\n'),
      [
        '🛠️ 记忆管理（主人）',
        '• #记忆诊断　查看原始消息、群风格与用户印象状态',
        '• #身份查询 <QQ号>　查询群友真实身份认知'
      ].join('\n'),
      [
        '🎵 QQ 音乐账户（主人）',
        '• #QQ音乐状态　查看登录状态',
        '• #QQ音乐cookie <Cookie>　导入账户 Cookie',
        '• #刷新音乐ck　刷新音乐凭据',
        '• #QQ音乐vip状态　检测 VIP 状态',
        '点歌、搜歌等操作可直接在 AI 对话中提出。'
      ].join('\n'),
      [
        '😶 QQ 表情库',
        '• 回复表情发送 #收录表情 <标签>　加入 AI 表情库（主人）',
        '• #表情库　查看已收录表情',
        '• #测试表情 <ID>　测试发送（主人）',
        '• #停用表情 <ID> / #删除表情 <ID>　管理表情（主人）',
        '• #自动收录表情 开启|关闭　自动收录主人发送的表情',
        '• #表情意图 <ID> <意图...>　修正核心意图并锁定',
        '• #表情风险 <ID> 安全|谨慎|高风险　修正风险等级',
        '• #自动发送表情 <ID> 开启|关闭　控制 AI 自动发送',
        '• #解锁表情 <ID>　允许视觉分类再次更新',
        '• #重新识别表情 <ID>　强制重新生成意图与风险',
        `• 当前策略：每轮 ${stickerProbability} 概率开放表情选择，同一会话冷却 ${stickerCooldown}`,
        'AI 只选择核心意图；发送层再按正文语境、风格和风险挑选具体表情。普通小黄脸可嵌入正文，图片与超级表情独立发送。'
      ].join('\n'),
      [
        '🤏 QQ 轻互动',
        `• 消息表情回应：${toggle(interactionConfig.enable !== false && reactionConfig.enable !== false)}｜开放概率 ${formatProbability(reactionConfig.probability, 0.25)}｜冷却 ${formatStickerCooldown(reactionConfig.cooldownMs ?? 45000)}`,
        `• 被戳后回戳：${toggle(interactionConfig.enable !== false && pokeConfig.enable !== false)}｜回戳概率 ${formatProbability(pokeConfig.returnProbability, 0.35)}｜冷却 ${formatStickerCooldown(pokeConfig.cooldownMs ?? 300000)}`,
        `• 每名群友每天最多回戳 ${formatPositiveInteger(pokeConfig.dailyUserLimit, 3)} 次`,
        '消息回应和发送表情每轮最多采用一种；机器人不会主动戳陌生群友。'
      ].join('\n'),
      [
        '⚙️ 插件管理',
        '• #loli状态　查看实时运行状态',
        '• #loli更新　拉取普通更新（主人）',
        '• #loli强制更新　覆盖本地文件更新（主人）',
        `• 管理面板：http://127.0.0.1:${cfg.dashboard?.port || 3000}/dashboard/`
      ].join('\n')
    ]

    const forward = await makeForwardMsg(e, sections, `✨ 日奈 Loli Plugin v${version} · 指令帮助`)
    return e.reply(forward)
  }

  async showStatus (e) {
    const cfg = getConfig() || {}
    const loli = cfg.loli || {}
    const memory = cfg.memory || {}
    const masterIdentity = loli.masterIdentity || {}
    const engine = getEngine()
    const dashboard = getDashboardServer()
    const channels = await readRuntimeChannels(engine, cfg)
    const enabledChannels = channels.filter(channel => channel.status !== 'disabled')
    const presets = (cfg.chaite?.presets || []).filter(preset => preset.status !== 'disabled')
    const routes = presets.slice(0, 3).map(preset => {
      const channel = channels.find(item => item.id === preset.channelId)
      return `${preset.name || preset.id}: ${channel?.name || preset.channelId || '未绑定'} / ${preset.sendMessageOption?.model || '默认模型'}`
    })
    const stats = readMemoryStats(cfg)
    const stickers = readStickerStats()
    const stickerConfig = cfg.stickers || {}
    const stickerProbability = formatStickerProbability(stickerConfig.probability)
    const stickerCooldown = formatStickerCooldown(stickerConfig.cooldownMs)
    const interactionConfig = cfg.interactions || {}
    const reactionConfig = interactionConfig.reaction || {}
    const pokeConfig = interactionConfig.poke || {}

    const lines = [
      `✨ 日奈状态 · v${cfg.version || '0.1.0'}`,
      '',
      `核心引擎：${engine ? '✅ 已就绪' : '❌ 未初始化'}`,
      `运行时间：${formatDuration(Date.now() - loadedAt)}`,
      `管理面板：${dashboard?.listening ? `✅ :${cfg.dashboard?.port || 3000}` : '❌ 未启动'}`,
      `伪人模式：${toggle(loli.enable)}｜分段回复：${toggle(loli.segmentedReply?.enable)}`,
      `触发方式：@ ${toggle(loli.enableAtTrigger)} / 前缀 ${toggle(loli.enablePrefixTrigger)} / 关键词 ${toggle(loli.enableKeywordTrigger)} / 主动 ${toggle(loli.enableProactiveTrigger)}`,
      `主人识别：${toggle(masterIdentity.enable !== false)}｜已识别 ${(masterIdentity.userIds || []).length} 人｜特别称呼：${masterIdentity.appellation || '未设置'}`,
      '',
      `AI 渠道：${enabledChannels.length}/${channels.length} 个启用｜可用模型 ${countModels(enabledChannels)} 个`,
      ...(routes.length ? routes.map(route => `• ${route}`) : ['• 暂无启用的角色预设']),
      '',
      `群消息采集：${toggle(memory.group?.enable)}｜AI 用户印象：${toggle(memory.memberLearning?.enable !== false)}`,
      `AI 群风格：${toggle(memory.groupLearning?.enable !== false)}`,
      stats
        ? `SQLite：消息 ${stats.messages}｜用户印象 ${stats.learnedMembers}｜身份 ${stats.identities}`
        : 'SQLite：⚠️ 暂时无法读取',
      stats ? `群风格：${stats.learnedGroups} 个群/${stats.learningVersions} 版｜用户印象 ${stats.memberMemoryVersions} 版` : '',
      `QQ 表情库：${stickerConfig.enable === false ? '❌ 关闭' : `✅ ${stickers.autoSendable}/${stickers.enabled} 个可自动发送（共 ${stickers.total}）`}`,
      `表情策略：开放概率 ${stickerProbability}｜冷却 ${stickerCooldown}｜自动收录 ${toggle(stickerConfig.autoCollectMaster !== false)}｜视觉识别 ${toggle(stickerConfig.autoClassify !== false)}｜原生超级表情 ${toggle(stickerConfig.nativeSuperface === true)}`,
      `轻互动：消息回应 ${toggle(interactionConfig.enable !== false && reactionConfig.enable !== false)} ${formatProbability(reactionConfig.probability, 0.25)}/${formatStickerCooldown(reactionConfig.cooldownMs ?? 45000)}｜被戳回戳 ${toggle(interactionConfig.enable !== false && pokeConfig.enable !== false)} ${formatProbability(pokeConfig.returnProbability, 0.35)}/${formatStickerCooldown(pokeConfig.cooldownMs ?? 300000)}｜每日 ${formatPositiveInteger(pokeConfig.dailyUserLimit, 3)} 次`,
      '',
      '发送 #loli帮助 查看完整指令。'
    ].filter(line => line !== null && line !== undefined)

    return e.reply(lines.join('\n'))
  }
}

function formatList (values, fallback) {
  return Array.isArray(values) && values.length ? values.join('、') : fallback
}

function toggle (enabled) {
  return enabled ? '✅' : '❌'
}

function countModels (channels) {
  return new Set(channels.flatMap(channel => Array.isArray(channel.models) ? channel.models : []).filter(Boolean)).size
}

function formatDuration (milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days) return `${days}天 ${hours}小时`
  if (hours) return `${hours}小时 ${minutes}分钟`
  if (minutes) return `${minutes}分钟`
  return `${seconds}秒`
}

function formatStickerProbability (value) {
  return formatProbability(value, 0.35)
}

function formatStickerCooldown (value) {
  const configured = Number(value)
  const milliseconds = Number.isFinite(configured) ? Math.max(0, configured) : 60000
  if (milliseconds >= 60000 && milliseconds % 60000 === 0) return `${milliseconds / 60000}分钟`
  return `${Math.round(milliseconds / 1000)}秒`
}

function formatProbability (value, fallback) {
  const configured = Number(value)
  const probability = Number.isFinite(configured) ? Math.max(0, Math.min(1, configured)) : fallback
  return `${Math.round(probability * 100)}%`
}

function formatPositiveInteger (value, fallback) {
  const configured = Number(value)
  return Number.isFinite(configured) ? Math.max(0, Math.floor(configured)) : fallback
}

async function readRuntimeChannels (engine, cfg) {
  try {
    const channels = await engine?.listChannels?.()
    if (Array.isArray(channels)) return channels
  } catch {}
  return Array.isArray(cfg.chaite?.channels) ? cfg.chaite.channels : []
}

function readMemoryStats (cfg) {
  try {
    return getStats(resolveMemoryBaseDir(cfg, PLUGIN_ROOT))
  } catch {
    return null
  }
}

function readStickerStats () {
  try {
    return getStickerStats()
  } catch {
    return { total: 0, enabled: 0, autoSendable: 0, uses: 0 }
  }
}
