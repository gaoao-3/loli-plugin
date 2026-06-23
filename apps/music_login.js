/**
 * QQ音乐登录 - ptlogin QR扫码 + 换票存 cookie
 *
 * 用法：#QQ音乐登录（仅私聊）
 * 流程：获取二维码 → 扫码 → 登录 → 换 qqmusic_key → 存入 data/config.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { getConfig, saveConfig, DATA_DIR } from '../index.js'

const PLUGIN_ROOT = path.resolve('./plugins/loli-plugin')

// ─── hash33: ptqrtoken ───────────────────────────────────────
function hash33(s) {
  let e = 0
  for (let i = 0; i < s.length; i++) {
    e += (e << 5) + s.charCodeAt(i)
  }
  return 2147483647 & e
}

// ─── 简单的 Cookie 罐 ─────────────────────────────────────────
class CookieJar {
  constructor() { this.map = new Map() }
  set(k, v) { this.map.set(k.trim(), v.trim()) }
  get(k) { return this.map.get(k) }
  toString() {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }
  parseHeaders(resp) {
    const cookies = resp.headers.getSetCookie?.() || []
    for (const c of cookies) {
      const m = c.match(/^([^=]+)=([^;]+)/)
      if (m) this.set(m[1].trim(), m[2].trim())
    }
  }
}

// ─── 保存到 config.json ─────────────────────────────────────
function saveMusicConfig(uin, qqmusicKey, cookieStr) {
  const cfg = getConfig()
  cfg.music = cfg.music || {}
  cfg.music.uin = uin
  cfg.music.qqmusic_key = qqmusicKey
  cfg.music.cookie_str = cookieStr
  saveConfig()
  return cfg.music
}

// ─── 获取已保存的音乐配置 ────────────────────────────────────
function getMusicConfig() {
  try {
    return getConfig()?.music || null
  } catch { return null }
}

export { getMusicConfig }

// ─── ptlogin 登录命令 ────────────────────────────────────────
export class QQMusicLogin extends plugin {
  constructor() {
    super({
      name: 'QQ音乐登录',
      dsc: 'QQ音乐扫码登录，获取 cookie 供音乐工具使用',
      event: 'message',
      priority: 600,
      rule: [
        { reg: '^#QQ音乐登录$', fnc: 'startLogin' },
        { reg: '^#QQ音乐状态$', fnc: 'showStatus' },
        { reg: '^#QQ音乐cookie\\s+(.+)$', fnc: 'setCookie' }
      ]
    })
  }

  // #QQ音乐状态 — 查看当前登录状态
  async showStatus(e) {
    const music = getMusicConfig()
    if (!music?.uin) {
      await e.reply('❌ 尚未登录 QQ音乐。\n发送 #QQ音乐登录 进行扫码登录')
      return
    }
    await e.reply(
      `✅ QQ音乐已登录\n` +
      `QQ: ${music.uin}\n` +
      `已配置 cookie: ${music.cookie_str ? '是' : '否'}\n` +
      `qqmusic_key: ${music.qqmusic_key ? '存在' : '无'}`
    )
  }

  // #QQ音乐cookie <cookie字符串> — 手动注入 cookie
  async setCookie(e) {
    if (!e.isPrivate && !e.isMaster) {
      await e.reply('⚠️ 请在私聊中使用此命令以保证安全')
      return
    }
    const match = e.msg.match(/^#QQ音乐cookie\s+(.+)$/)
    if (!match) return
    const cookieStr = match[1].trim()

    const uinMatch = cookieStr.match(/uin=o?0*(\d+)/) ||
                     cookieStr.match(/uin[=:](\d+)/)
    const uin = uinMatch?.[1] || '0'
    const keyMatch = cookieStr.match(/qm_keyst=([^;]+)/) ||
                     cookieStr.match(/qqmusic_key=([^;]+)/)
    const qqmusicKey = keyMatch?.[1] || ''

    saveMusicConfig(uin, qqmusicKey, cookieStr)
    await e.reply(`✅ QQ音乐 cookie 已更新\nQQ: ${uin}${qqmusicKey ? '\n已提取 qqmusic_key' : ''}`)
  }

  // #QQ音乐登录 — 扫码登录主流程
  async startLogin(e) {
    if (!e.isPrivate && e.message_type !== 'private') {
      await e.reply('⚠️ 请在私聊中发送 #QQ音乐登录\n' +
        '（扫码登录涉及 cookie 安全，不宜在群里操作）')
      return
    }

    try {
      // ═══════ Step 1: 获取二维码 ═══════
      const jar = new CookieJar()
      const t = Math.random()
      const qrRes = await fetch(
        `https://ssl.ptlogin2.qq.com/ptqrshow?appid=716027609&e=2&l=M&s=3&d=72&v=4&t=${t}&daid=383&pt_3rd_aid=100497308`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
      )

      jar.parseHeaders(qrRes)
      const qrsig = jar.get('qrsig')
      if (!qrsig) {
        await e.reply('获取二维码失败，请稍后重试')
        return
      }

      const qrBuf = Buffer.from(await qrRes.arrayBuffer())
      const qrBase64 = qrBuf.toString('base64')

      // TRSS-Yunzai segment.image
      let image
      try {
        const { segment } = await import('icqq')
        image = segment.image(`base64://${qrBase64}`)
      } catch {
        const { segment } = await import('oicq')
        image = segment.image(`base64://${qrBase64}`)
      }

      await e.reply([
        '📱 请使用手机 QQ 扫码登录\n（二维码有效期 3 分钟，请尽快扫码）',
        image
      ])

      // ═══════ Step 2: 轮询 ═══════
      const ptqrtoken = hash33(qrsig)
      const pollUrl = `https://ssl.ptlogin2.qq.com/ptqrlogin` +
        `?u1=https%3A%2F%2Fy.qq.com` +
        `&ptqrtoken=${ptqrtoken}` +
        `&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052` +
        `&action=0-0-${Date.now()}` +
        `&js_ver=220301&js_type=1&login_sig=&pt_uistyle=40` +
        `&aid=716027609&daid=383&pt_3rd_aid=100497308&`

      let loggedIn = false
      let pollCount = 0
      const MAX_POLLS = 90 // 3 分钟

      const poll = async () => {
        const pollJar = new CookieJar()
        pollJar.set('qrsig', qrsig)

        const res = await fetch(pollUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Cookie': pollJar.toString()
          }
        })

        pollJar.parseHeaders(res)
        const text = await res.text()

        pollCount++

        // 解析状态码：ptuiCB('0','0','...','0','登录成功！', '昵称')
        if (text.includes('登录成功')) {
          // ✅ 登录成功
          loggedIn = true

          // 提取 uin
          const uinMatch = text.match(/'([^']*)'[^']*'[^']*'登录成功！'\s*,\s*'([^']*)'/)
          const redirectUrl = uinMatch?.[1] || ''
          const nickname = uinMatch?.[2] || '未知'

          // 从 PTLogin 响应中提取 QQ cookies
          const allCookies = new CookieJar()
          const setCookies = res.headers.getSetCookie?.() || []
          for (const c of setCookies) {
            const m = c.match(/^([^=]+)=([^;]+)/)
            if (m) {
              const key = m[1].trim()
              const val = m[2].trim()
              allCookies.set(key, val)
            }
          }

          // 从 redirect URL 提取 uin
          let uin = '0'
          for (const c of setCookies) {
            const m = c.match(/uin=o?0*(\d+)/)
            if (m) { uin = m[1]; break }
          }
          if (!uin || uin === '0') {
            const m = redirectUrl.match(/uin=(\d+)/)
            if (m) uin = m[1]
          }

          // ═══════ Step 3: 换 QQ音乐 cookie ═══════
          let qqmusicKey = ''
          try {
            // 访问 y.qq.com 让 .qq.com 的 cookie 转为 y.qq.com 的 cookie
            const musicCookie = allCookies.toString()
            const authRes = await fetch(
              'https://u.y.qq.com/cgi-bin/musicu.fcg?-=getCookie&data=%7B%7D',
              {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Cookie': musicCookie,
                  'Referer': 'https://y.qq.com/'
                }
              }
            )

            const musicJar = new CookieJar()
            musicJar.parseHeaders(authRes)

            // 尝试提取 qqmusic_key
            // QQ Music auth 可能通过多种方式返回 key
            const musicSetCookies = authRes.headers.getSetCookie?.() || []
            const allMusicCookies = [...setCookies, ...musicSetCookies].join('; ')
            const keyMatch = allMusicCookies.match(/qm_keyst=([^;]+)/)

            if (keyMatch) {
              qqmusicKey = keyMatch[1]
            }

            // 也尝试从响应体中提取
            try {
              const authData = await authRes.json()
              if (authData?.data?.qqmusic_key) {
                qqmusicKey = authData.data.qqmusic_key
              }
            } catch {}

            // 保存完整 cookie（ptlogin + y.qq.com）
            const finalCookieStr = [
              ...setCookies,
              ...musicSetCookies
            ].filter(Boolean).join('; ')

            const saved = saveMusicConfig(uin, qqmusicKey, finalCookieStr)

            await e.reply(
              `✅ QQ音乐登录成功！\n` +
              `QQ: ${uin}\n` +
              `昵称: ${nickname}\n` +
              `${qqmusicKey ? '已获取 qqmusic_key' : '⚠️ 未能获取 qqmusic_key（部分功能可能受限）'}`
            )

          } catch (err) {
            // 降级：保存 ptlogin cookies
            const cookieStr = setCookies.join('; ')
            saveMusicConfig(uin, '', cookieStr)
            await e.reply(
              `✅ QQ登录成功\n` +
              `QQ: ${uin} | 昵称: ${nickname}\n` +
              `⚠️ QQ音乐 cookie 获取失败，已保存基础 cookie\n` +
              `错误: ${err.message}`
            )
          }
          return true
        }

        if (text.includes('已过期') || text.includes('65')) {
          await e.reply('⌛ 二维码已过期，请重新发送 #QQ音乐登录')
          return true
        }

        if (text.includes('已扫描') || text.includes('67')) {
          // 已扫描，等待确认
          if (pollCount === 1) {
            await e.reply('📱 已扫描，请在手机上确认登录...')
          }
        }

        // 继续轮询
        return false
      }

      // 轮询循环
      const timer = setInterval(async () => {
        try {
          const done = await poll()
          if (done) {
            clearInterval(timer)
            loggedIn = true
          }
          if (pollCount >= MAX_POLLS) {
            clearInterval(timer)
            await e.reply('⌛ 登录超时（3分钟），请重新发送 #QQ音乐登录')
          }
        } catch (err) {
          clearInterval(timer)
          await e.reply(`登录异常: ${err.message}`)
        }
      }, 2000)

    } catch (err) {
      await e.reply(`QQ音乐登录失败: ${err.message}`)
    }
  }
}
