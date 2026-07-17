import { getConfig, saveConfig } from '../utils/state.js'
import { makeForwardMsg } from '../utils/bot.js'
import {
  collectableStickerSegments,
  deleteSticker,
  getQuotedMessage,
  listStickers,
  saveSticker,
  sendSticker,
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
        { reg: '^#自动收录表情\\s*(?:开启|关闭)$', fnc: 'toggleAutoCollect' }
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
        : sticker.kind === 'superface' && !sticker.payload?.stickerId
          ? '⚠️待重新收录'
          : '✅'
      values.push(`#${sticker.id} ${status} ${sticker.text || '-'}｜${sticker.tags.join('、') || '无标签'}｜使用 ${sticker.useCount}`)
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
}

function formatKind (kind) {
  return ({ face: 'QQ 小黄脸', superface: '超级表情', favorite: '收藏表情', marketface: '商城/推荐表情', image: '图片表情' })[kind] || kind
}
