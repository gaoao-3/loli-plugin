import { getConfig, getEngine, saveConfig } from '../utils/state.js'
import { makeForwardMsg } from '../utils/bot.js'
import { classifyStoredSticker } from '../utils/sticker-classifier.js'
import {
  CORE_STICKER_INTENTS,
  collectableStickerSegments,
  deleteSticker,
  getSticker,
  getQuotedMessage,
  listStickers,
  saveSticker,
  sendSticker,
  setStickerManualMetadata,
  setStickerEnabled
} from '../utils/stickers.js'

export class loliStickers extends plugin {
  constructor () {
    super({
      name: 'loli-表情库',
      dsc: '收藏 QQ 表情并供 AI 自主调用',
      event: 'message',
      priority: 600,
      rule: [
        { reg: '^#收录表情(?:\\s+.*)?$', fnc: 'collectSticker' },
        { reg: '^#表情库$', fnc: 'showLibrary' },
        { reg: '^#(?:发送|测试)表情(?:\\s+\\d+)$', fnc: 'testSticker' },
        { reg: '^#(?:删除|停用)表情(?:\\s+\\d+)$', fnc: 'disableSticker' },
        { reg: '^#自动收录表情\\s*(?:开启|关闭)$', fnc: 'toggleAutoCollect' },
        { reg: '^#表情意图\\s+\\d+\\s+.+$', fnc: 'setStickerIntents' },
        { reg: '^#表情风险\\s+\\d+\\s+(?:安全|谨慎|高风险|safe|medium|high)$', fnc: 'setStickerRisk' },
        { reg: '^#自动发送表情\\s+\\d+\\s*(?:开启|关闭)$', fnc: 'toggleStickerAutoSend' },
        { reg: '^#解锁表情\\s+\\d+$', fnc: 'unlockStickerMetadata' },
        { reg: '^#重新识别表情\\s+\\d+$', fnc: 'reclassifySticker' }
      ]
    })
  }

  async collectSticker (e) {
    if (!e.isMaster) return e.reply('只有主人可以收录表情。')
    const quoted = await getQuotedMessage(e)
    const segments = collectableStickerSegments(quoted)
    if (!segments.length) return e.reply('请回复一个小黄脸、超级表情、收藏表情或图片表情，再发送“#收录表情 标签”。')
    const tags = String(e.msg || '').replace(/^#收录表情/u, '').trim().split(/[\s,，、/]+/).filter(Boolean)
    const saved = segments.map(segment => saveSticker({
      segment,
      tags,
      sourceUserId: e.user_id || e.sender?.user_id,
      sourceMessageId: e.source?.seq || e.reply_id
    }))
    return e.reply(`✅ 已收录 ${saved.length} 个表情：${saved.map(item => `#${item.id} ${item.text}`).join('、')}${tags.length ? `\n标签：${tags.join('、')}` : ''}`)
  }

  async showLibrary (e) {
    const stickers = listStickers({ limit: 60 })
    if (!stickers.length) return e.reply('表情库还是空的。回复一个表情发送“#收录表情 标签”即可添加。')
    const groups = new Map()
    for (const sticker of stickers) {
      const values = groups.get(sticker.kind) || []
      const status = !sticker.enabled
        ? '⛔'
        : !sticker.autoSend
          ? '🛡️仅手动'
        : sticker.kind === 'superface' && !sticker.payload?.stickerId
          ? '⚠️待重新收录'
          : '✅'
      const lock = sticker.manualLocked ? '｜🔒人工锁定' : ''
      values.push(`#${sticker.id} ${status} ${sticker.text || '-'}｜意图 ${sticker.intents.join('、') || '未标注'}｜使用 ${sticker.useCount}${lock}`)
      groups.set(sticker.kind, values)
    }
    const nodes = [...groups.entries()].map(([kind, lines]) => `${formatKind(kind)}（${lines.length}）\n${lines.join('\n')}`)
    return e.reply(await makeForwardMsg(e, nodes, `QQ 表情库 · 共 ${stickers.length} 个`))
  }

  async testSticker (e) {
    if (!e.isMaster) return e.reply('只有主人可以测试表情。')
    const id = Number(String(e.msg || '').match(/\d+/)?.[0])
    const sticker = listStickers({ limit: 200 }).find(item => item.id === id)
    if (!sticker) return e.reply(`没有找到表情 #${id}。`)
    try {
      await sendSticker(e, sticker, undefined, {
        nativeSuperface: getConfig()?.stickers?.nativeSuperface === true
      })
      return true
    } catch (err) {
      return e.reply(`表情 #${id} 发送失败：${String(err.message || err).slice(0, 160)}`)
    }
  }

  async disableSticker (e) {
    if (!e.isMaster) return e.reply('只有主人可以管理表情库。')
    const id = Number(String(e.msg || '').match(/\d+/)?.[0])
    const remove = String(e.msg || '').startsWith('#删除')
    const changed = remove ? deleteSticker(id) : setStickerEnabled(id, false)
    return e.reply(changed ? `✅ 已${remove ? '删除' : '停用'}表情 #${id}` : `没有找到表情 #${id}`)
  }

  async toggleAutoCollect (e) {
    if (!e.isMaster) return e.reply('只有主人可以修改自动收录设置。')
    const enable = String(e.msg || '').includes('开启')
    const cfg = getConfig()
    cfg.stickers = { ...(cfg.stickers || {}), enable: true, autoCollectMaster: enable }
    saveConfig()
    return e.reply(`✅ 主人表情自动收录已${enable ? '开启' : '关闭'}`)
  }

  async setStickerIntents (e) {
    if (!e.isMaster) return e.reply('只有主人可以修改表情意图。')
    const match = String(e.msg || '').match(/^#表情意图\s+(\d+)\s+(.+)$/u)
    const id = Number(match?.[1])
    const raw = String(match?.[2] || '').trim()
    const intents = raw === '清空'
      ? []
      : [...new Set(raw.split(/[\s,，、/]+/u).filter(Boolean))]
    const invalid = intents.filter(intent => !CORE_STICKER_INTENTS.includes(intent))
    if (invalid.length) {
      return e.reply(`不支持的核心意图：${invalid.join('、')}\n可用：${CORE_STICKER_INTENTS.join('、')}`)
    }
    const sticker = setStickerManualMetadata(id, { intents })
    if (!sticker) return e.reply(`没有找到表情 #${id}`)
    return e.reply(`✅ 表情 #${id} 意图已设为：${sticker.intents.join('、') || '空'}（已人工锁定）`)
  }

  async setStickerRisk (e) {
    if (!e.isMaster) return e.reply('只有主人可以修改表情风险。')
    const match = String(e.msg || '').match(/^#表情风险\s+(\d+)\s+(安全|谨慎|高风险|safe|medium|high)$/u)
    const id = Number(match?.[1])
    const risk = ({ 安全: 'safe', 谨慎: 'medium', 高风险: 'high' })[match?.[2]] || match?.[2]
    const sticker = setStickerManualMetadata(id, { risk })
    if (!sticker) return e.reply(`没有找到表情 #${id}`)
    return e.reply(`✅ 表情 #${id} 风险已设为 ${sticker.risk}${sticker.autoSend ? '' : '，当前仅手动发送'}（已人工锁定）`)
  }

  async toggleStickerAutoSend (e) {
    if (!e.isMaster) return e.reply('只有主人可以修改自动发送设置。')
    const match = String(e.msg || '').match(/^#自动发送表情\s+(\d+)\s*(开启|关闭)$/u)
    const id = Number(match?.[1])
    try {
      const sticker = setStickerManualMetadata(id, { autoSend: match?.[2] === '开启' })
      if (!sticker) return e.reply(`没有找到表情 #${id}`)
      return e.reply(`✅ 表情 #${id} AI 自动发送已${sticker.autoSend ? '开启' : '关闭'}（已人工锁定）`)
    } catch (err) {
      return e.reply(String(err.message || err))
    }
  }

  async unlockStickerMetadata (e) {
    if (!e.isMaster) return e.reply('只有主人可以解除表情锁定。')
    const id = Number(String(e.msg || '').match(/\d+/u)?.[0])
    if (!getSticker(id)) return e.reply(`没有找到表情 #${id}`)
    const sticker = setStickerManualMetadata(id, { unlock: true })
    return e.reply(`✅ 表情 #${id} 已解除人工锁定，后续可由视觉分类更新`)
  }

  async reclassifySticker (e) {
    if (!e.isMaster) return e.reply('只有主人可以重新识别表情。')
    const id = Number(String(e.msg || '').match(/\d+/u)?.[0])
    if (!getSticker(id)) return e.reply(`没有找到表情 #${id}`)
    const engine = getEngine()
    if (!engine) return e.reply('AI 引擎尚未就绪。')
    try {
      setStickerManualMetadata(id, { unlock: true })
      const sticker = await classifyStoredSticker({
        engine,
        config: getConfig(),
        event: e,
        id,
        logger,
        force: true
      })
      return e.reply(`✅ 表情 #${id} 已重新识别：${sticker.intents.join('、') || '无核心意图'}｜风险 ${sticker.risk}`)
    } catch (err) {
      return e.reply(`表情 #${id} 重新识别失败：${String(err.message || err).slice(0, 160)}`)
    }
  }
}

function formatKind (kind) {
  return ({ face: 'QQ 小黄脸', superface: '超级表情', favorite: '收藏表情', marketface: '商城/推荐表情', image: '图片表情' })[kind] || kind
}
