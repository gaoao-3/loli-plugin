/**
 * QQ音乐账户管理 - Cookie 导入、自动刷新与 VIP 检测
 *
 * 首次使用需由主人私聊导入包含 refresh token 的完整 Cookie。
 */
import {
  CookieJar,
  fetchWithTimeout,
  musicConfigFromCookie,
  normalizeMusicUin,
  readMusicConfig,
  refreshMusicAuth,
  stableMusicGuid,
  writeMusicConfig
} from '../utils/music.js'

// ─── 保存到 config.json ─────────────────────────────────────
function saveMusicConfig (music) {
  return writeMusicConfig({ ...(readMusicConfig() || {}), ...music })
}

// ─── 获取已保存的音乐配置 ────────────────────────────────────
function getMusicConfig() {
  return readMusicConfig()
}

export { getMusicConfig }

// ─── ptlogin 登录命令 ────────────────────────────────────────
export class QQMusicAccount extends plugin {
  constructor() {
    super({
      name: 'QQ音乐账户',
      dsc: 'QQ音乐 Cookie 导入、自动刷新与 VIP 检测',
      event: 'message',
      priority: 600,
      rule: [
        { reg: '^#QQ音乐状态$', fnc: 'showStatus' },
        { reg: '^#QQ音乐cookie\\s+(.+)$', fnc: 'setCookie' },
        { reg: '^#?(?:刷新QQ音乐|刷新(?:音乐|点歌)ck)$', fnc: 'refreshCookie' },
        { reg: '^#?(?:QQ音乐|音乐|点歌)(?:vip状态|vip检测)$', fnc: 'checkVipStatus' }
      ]
    })

    this.task = {
      name: 'QQ音乐Cookie自动刷新',
      cron: '0 0 4 */2 * *',
      fnc: () => this.refreshCookie()
    }
  }

  // #QQ音乐状态 — 查看当前登录状态
  async showStatus(e) {
    if (!e.isMaster) return e.reply('只有主人可以查看 QQ音乐登录状态。')
    const music = getMusicConfig()
    if (!music?.uin) {
      await e.reply('❌ 尚未配置 QQ音乐账号。\n请由主人私聊发送 #QQ音乐cookie <完整Cookie>')
      return
    }
    await e.reply(
      `✅ QQ音乐账户已配置\n` +
      `QQ: ${music.uin}\n` +
      `已配置 cookie: ${music.cookie_str ? '是' : '否'}\n` +
      `qqmusic_key: ${music.qqmusic_key ? '存在' : '无'}\n` +
      `refresh_token: ${music.psrf_qqrefresh_token ? '存在' : '无'}\n` +
      `最后刷新: ${music.last_refresh_time || '从未'}\n` +
      `配置文件: data/qq_music.json`
    )
  }

  // #QQ音乐cookie <cookie字符串> — 手动注入 cookie
  async setCookie(e) {
    if (!e.isMaster) return e.reply('只有主人可以设置 QQ音乐 cookie。')
    if (!e.isPrivate && e.message_type !== 'private') return e.reply('⚠️ 请在私聊中使用此命令以保证安全')
    const match = e.msg.match(/^#QQ音乐cookie\s+(.+)$/)
    if (!match) return
    const cookieStr = new CookieJar(match[1].trim()).toString()

    const music = musicConfigFromCookie(cookieStr, getMusicConfig() || {})
    saveMusicConfig(music)
    await e.reply(`✅ QQ音乐 cookie 已更新\nQQ: ${music.uin}${music.qqmusic_key ? '\n已提取 qqmusic_key' : ''}${music.psrf_qqrefresh_token ? '\n已提取 refresh_token' : ''}`)
  }

  async refreshCookie (e) {
    if (e && !e.isMaster) return e.reply('只有主人可以刷新 QQ音乐 Cookie。')
    try {
      if (e) await e.reply('正在刷新 QQ音乐 Cookie...')
      const next = await refreshMusicAuth(getMusicConfig())
      saveMusicConfig(next)
      if (e) await e.reply('✅ QQ音乐 Cookie 刷新成功。')
      return true
    } catch (err) {
      logger?.error?.(`[QQ音乐] Cookie 刷新失败: ${err.message}`)
      if (e) await e.reply(`❌ QQ音乐 Cookie 刷新失败：${err.message}`)
      return false
    }
  }

  async checkVipStatus (e) {
    if (!e.isMaster) return e.reply('只有主人可以检测 QQ音乐 VIP。')
    const music = getMusicConfig()
    if (!music?.uin) return e.reply('❌ 尚未配置 QQ音乐账号。')
    const uin = normalizeMusicUin(music.uin)
    const body = {
      comm: {
        g_tk: 5381,
        uin: Number(uin),
        guid: music.guid || stableMusicGuid(uin),
        authst: music.qqmusic_key || music.qm_keyst || '',
        format: 'json',
        ct: 24,
        cv: 4747474,
        platform: 'yqq.json',
        needNewCode: 1
      },
      req_0: {
        module: 'userInfo.VipQueryServer',
        method: 'SRFVipQuery_V2',
        param: { uin_list: [uin] }
      }
    }
    try {
      const response = await fetchWithTimeout('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': music.cookie_str || '',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify(body)
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const json = await response.json()
      if (json.req_0?.code !== 0) throw new Error(`API Code ${json.req_0?.code ?? 'unknown'}`)
      const info = json.req_0.data?.infoMap?.[uin]
      if (!info) return e.reply('⚠️ VIP 查询成功，但没有返回当前账号信息。')
      const vip = info.iVipFlag === 1
      const superVip = info.iSuperVip === 1 || info.iNewVip === 1
      const status = superVip ? '💎 豪华绿钻/超级会员' : vip ? '✅ 绿钻 VIP' : '❌ 普通用户'
      return e.reply(`📊 QQ音乐账号: ${uin}\n身份: ${status}\n权限: ${vip || superVip ? '正常' : '受限'}${info.endTime ? `\n到期: ${info.endTime}` : ''}`)
    } catch (err) {
      return e.reply(`❌ VIP 检测失败：${err.message}`)
    }
  }
}
