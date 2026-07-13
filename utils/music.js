import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const MUSIC_CONFIG_PATH = path.join(PLUGIN_ROOT, 'data', 'qq_music.json')
const LEGACY_CONFIG_PATH = path.join(PLUGIN_ROOT, 'data', 'config.json')

export { MUSIC_CONFIG_PATH }

export class CookieJar {
  constructor (cookie = '') {
    this.map = new Map()
    if (cookie) this.parseCookie(cookie)
  }

  set (key, value) {
    if (key && value !== undefined) this.map.set(String(key).trim(), String(value).trim())
  }

  get (key) {
    return this.map.get(key)
  }

  parseCookie (cookie) {
    for (const part of String(cookie).split(';')) {
      const index = part.indexOf('=')
      if (index <= 0) continue
      const key = part.slice(0, index).trim()
      if (/^(path|domain|expires|max-age|samesite|secure|httponly)$/i.test(key)) continue
      this.set(key, part.slice(index + 1))
    }
    return this
  }

  parseHeaders (response) {
    for (const cookie of getSetCookieHeaders(response)) {
      const match = cookie.match(/^([^=;]+)=([^;]*)/)
      if (match) this.set(match[1], match[2])
    }
    return this
  }

  toString () {
    return [...this.map.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
  }
}

export function getSetCookieHeaders (response) {
  if (typeof response?.headers?.getSetCookie === 'function') return response.headers.getSetCookie()
  const combined = response?.headers?.get?.('set-cookie')
  return combined ? combined.split(/,(?=\s*[^;,=]+=[^;,]*)/) : []
}

export function readMusicConfig () {
  try {
    if (fs.existsSync(MUSIC_CONFIG_PATH)) {
      const current = JSON.parse(fs.readFileSync(MUSIC_CONFIG_PATH, 'utf8'))
      if (current?.uin || current?.cookie_str || current?.psrf_qqrefresh_token) return current
    }
    const legacy = JSON.parse(fs.readFileSync(LEGACY_CONFIG_PATH, 'utf8'))?.music
    if (legacy) {
      writeMusicConfig(legacy)
      return legacy
    }
  } catch {}
  try {
    return fs.existsSync(MUSIC_CONFIG_PATH)
      ? JSON.parse(fs.readFileSync(MUSIC_CONFIG_PATH, 'utf8'))
      : null
  } catch {
    return null
  }
}

export function writeMusicConfig (music) {
  fs.mkdirSync(path.dirname(MUSIC_CONFIG_PATH), { recursive: true })
  fs.writeFileSync(MUSIC_CONFIG_PATH, JSON.stringify(music || {}, null, 2), 'utf8')
  return music
}

export function musicAuth (music = readMusicConfig()) {
  const uin = normalizeMusicUin(music?.uin)
  return {
    uin,
    cookie: music?.cookie_str || '',
    authst: music?.qqmusic_key || ''
  }
}

export function stableMusicGuid (uin) {
  return createHash('md5').update(`${normalizeMusicUin(uin)}music`).digest('hex')
}

export function normalizeMusicUin (value) {
  const normalized = String(value || '0').replace(/^o/i, '').replace(/^0+/, '')
  return normalized || '0'
}

export function musicConfigFromCookie (cookie, previous = {}) {
  const jar = new CookieJar(cookie)
  const rawUin = jar.get('uin') || jar.get('p_uin') || jar.get('qq_uin') || previous.uin || '0'
  const uin = normalizeMusicUin(rawUin)
  const musicKey = jar.get('qqmusic_key') || jar.get('qm_keyst') || jar.get('musickey') ||
    previous.qqmusic_key || previous.qm_keyst || ''
  return {
    ...previous,
    uin,
    psrf_qqopenid: jar.get('psrf_qqopenid') || previous.psrf_qqopenid || '',
    psrf_qqrefresh_token: jar.get('psrf_qqrefresh_token') || previous.psrf_qqrefresh_token || '',
    psrf_qqaccess_token: jar.get('psrf_qqaccess_token') || previous.psrf_qqaccess_token || '',
    psrf_qqunionid: jar.get('psrf_qqunionid') || previous.psrf_qqunionid || '',
    qqmusic_key: musicKey,
    qm_keyst: musicKey,
    guid: previous.guid || stableMusicGuid(uin),
    cookie_str: jar.toString()
  }
}

export function buildMusicCookie (music = {}) {
  const jar = new CookieJar(music.cookie_str || '')
  const fields = {
    uin: music.uin ? `o${normalizeMusicUin(music.uin)}` : '',
    psrf_qqopenid: music.psrf_qqopenid,
    psrf_qqrefresh_token: music.psrf_qqrefresh_token,
    psrf_qqaccess_token: music.psrf_qqaccess_token,
    psrf_qqunionid: music.psrf_qqunionid,
    qqmusic_key: music.qqmusic_key,
    qm_keyst: music.qm_keyst || music.qqmusic_key
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value) jar.set(key, value)
  }
  return jar.toString()
}

export async function refreshMusicAuth (music) {
  if (!music?.uin || !music?.psrf_qqrefresh_token) {
    throw new Error('缺少 uin 或 psrf_qqrefresh_token，请先设置完整 QQ音乐 Cookie')
  }
  const uin = normalizeMusicUin(music.uin)
  const guid = music.guid || stableMusicGuid(uin)
  const body = {
    comm: {
      _channelid: '19',
      _os_version: '6.2.9200-2',
      authst: music.qqmusic_key || music.qm_keyst || '',
      ct: '19',
      cv: '1891',
      guid,
      patch: '118',
      tmeAppID: 'qqmusic',
      tmeLoginType: 2,
      uin: '0'
    },
    req_0: {
      module: 'music.login.LoginServer',
      method: 'Login',
      param: {
        appid: 100497308,
        access_token: music.psrf_qqaccess_token || '',
        musicid: Number(uin),
        musickey: music.qqmusic_key || music.qm_keyst || '',
        openid: music.psrf_qqopenid || '',
        refresh_token: music.psrf_qqrefresh_token,
        unionid: music.psrf_qqunionid || ''
      }
    }
  }
  const response = await fetchWithTimeout('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'QQMusic/12.0.0 (iPhone; iOS 16.0; Scale/3.00)'
    },
    body: JSON.stringify(body)
  })
  if (!response.ok) throw new Error(`刷新接口 HTTP ${response.status}`)
  const json = await response.json()
  if (json.req_0?.code !== 0) throw new Error(`刷新接口 Code ${json.req_0?.code ?? 'unknown'}`)
  const data = json.req_0.data || {}
  const next = {
    ...music,
    uin,
    guid,
    psrf_qqaccess_token: data.access_token || music.psrf_qqaccess_token || '',
    psrf_qqrefresh_token: data.refresh_token || music.psrf_qqrefresh_token,
    psrf_qqopenid: data.openid || music.psrf_qqopenid || '',
    psrf_qqunionid: data.unionid || music.psrf_qqunionid || '',
    qqmusic_key: data.musickey || music.qqmusic_key || music.qm_keyst || '',
    qm_keyst: data.musickey || music.qm_keyst || music.qqmusic_key || '',
    last_refresh_time: new Date().toISOString()
  }
  next.cookie_str = buildMusicCookie(next)
  return next
}

export async function fetchWithTimeout (url, options = {}, timeoutMs = 15000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
}
