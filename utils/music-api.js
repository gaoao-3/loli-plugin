/**
 * Meting 兼容音乐 API 封装
 *
 * 默认使用公共实例，建议在 config.json 的 music.apiBase 配置自部署地址：
 *   https://github.com/Yuncan050115/ourcraft-music-api （node node.js / docker 均可）
 *
 * 接口形状（已在公共实例实测）：
 *   type=search → { ok, server, songs: [{ id, name, singer }] }（上游 Meting 可能直接返回数组）
 *   type=song   → [{ title, author, url, pic, lrc }]（url 为 302 跳转到真实音频）
 *   type=url    → 302 → 真实音频地址
 *
 * 洛雪兜底：Meting 解析不出播放链接（VIP）时，用 LX-Music-API-Server
 * （公共实例或自部署 https://github.com/MeoProject/lx-music-api-server）
 * 按平台 id 再解析一次，覆盖 tx(qq)/mg(咪咕) 之外的共享源。
 */
import { getConfig } from './state.js'

const DEFAULT_API_BASE = 'https://music.yuncan.xyz'
const DEFAULT_SERVER = 'netease'
const DEFAULT_LX_API_BASE = 'https://lxmusicapi.onrender.com'
const DEFAULT_LX_API_KEY = 'share-v3'

export const MUSIC_SERVERS = ['netease', 'kugou', 'kuwo']

const SERVER_NAMES = {
  netease: '网易云',
  kugou: '酷狗',
  kuwo: '酷我'
}

// Meting 平台 → 洛雪源
const LX_SOURCE = {
  netease: 'wy',
  kugou: 'kg',
  kuwo: 'kw'
}

export function musicServerName (server) {
  return SERVER_NAMES[server] || server
}

export function musicApiConfig () {
  const conf = getConfig()?.music || {}
  return {
    apiBase: String(conf.apiBase || DEFAULT_API_BASE).replace(/\/+$/, ''),
    server: MUSIC_SERVERS.includes(conf.server) ? conf.server : DEFAULT_SERVER,
    // 洛雪兜底解析；lxApiBase 置空字符串可关闭
    lxApiBase: conf.lxApiBase === '' ? '' : String(conf.lxApiBase || DEFAULT_LX_API_BASE).replace(/\/+$/, ''),
    lxApiKey: String(conf.lxApiKey || DEFAULT_LX_API_KEY)
  }
}

export function resolveMusicServer (server) {
  return MUSIC_SERVERS.includes(server) ? server : musicApiConfig().server
}

export async function fetchWithTimeout (url, options = {}, timeoutMs = 15000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
}

async function callApi (params) {
  const { apiBase } = musicApiConfig()
  const response = await fetchWithTimeout(`${apiBase}/api?${new URLSearchParams(params)}`)
  if (!response.ok) throw new Error(`音乐 API 异常 (HTTP ${response.status})`)
  return response.json()
}

/**
 * 搜索歌曲。返回 { server, songs: [{ id, name, singer }] }
 */
export async function searchSongs (keyword, { server, limit = 10 } = {}) {
  server = resolveMusicServer(server)
  const res = await callApi({ server, type: 'search', id: keyword, limit })
  if (res?.ok === false) throw new Error(res.message || '音乐搜索失败')
  const list = Array.isArray(res) ? res : res?.songs
  if (!Array.isArray(list)) throw new Error('音乐搜索返回格式异常')
  return {
    server,
    songs: list.map(item => ({
      id: String(item.id),
      name: item.name || item.title || '',
      singer: item.singer || item.artist || item.author || ''
    })).filter(item => item.id && item.name)
  }
}

/**
 * 获取单曲详情。返回 { server, id, title, author, url, pic }
 * url 为 API 跳转地址，需经 resolveAudioUrl 取真实音频地址。
 *
 * 部分平台（kugou/kuwo）不支持 type=song，此时用搜索结果的
 * title/author 提示 + type=url 跳转地址拼接出等效详情。
 */
export async function getSong (id, { server, hint } = {}) {
  server = resolveMusicServer(server)
  try {
    const res = await callApi({ server, type: 'song', id })
    if (res?.ok === false) throw new Error(res.message || '获取歌曲信息失败')
    const song = Array.isArray(res) ? res[0] : res?.song || res
    if (!song || typeof song !== 'object') throw new Error('歌曲信息返回格式异常')
    const title = song.title || song.name || ''
    if (!title) throw new Error(`未找到歌曲 (id: ${id})`)
    return {
      server,
      id: String(id),
      title,
      author: song.author || song.singer || song.artist || '未知歌手',
      url: song.url || '',
      pic: song.pic || ''
    }
  } catch (err) {
    if (!hint?.title) throw err
    const { apiBase } = musicApiConfig()
    return {
      server,
      id: String(id),
      title: hint.title,
      author: hint.author || '未知歌手',
      url: `${apiBase}/api?${new URLSearchParams({ server, type: 'url', id })}`,
      pic: ''
    }
  }
}

/**
 * type=url / type=song 返回的音频地址通常是 302 跳转，取出最终真实地址。
 * VIP 等无播放地址时平台会返回 200 + JSON 错误，此时返回空串。
 * 网络异常时保留原 API 地址（部分客户端会自行跟随跳转）。
 */
export async function resolveAudioUrl (apiUrl) {
  if (!apiUrl) return ''
  try {
    const response = await fetchWithTimeout(apiUrl, { redirect: 'manual' })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (location) return location
    }
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('json')) return ''
    return apiUrl
  } catch {
    return apiUrl
  }
}

/**
 * 洛雪 API 兜底解析：Meting 拿不到播放链接（VIP）时按平台 id 再试一次。
 * 返回真实音频地址；不可用或未配置时返回空串。
 */
export async function resolveLxAudioUrl (server, id) {
  const { lxApiBase, lxApiKey } = musicApiConfig()
  const source = LX_SOURCE[server]
  if (!lxApiBase || !source || !id) return ''
  try {
    const response = await fetchWithTimeout(`${lxApiBase}/url/${source}/${id}/320k`, {
      headers: { 'X-Request-Key': lxApiKey }
    }, 20000)
    if (!response.ok) return ''
    const body = await response.json()
    // 实测：code=0 且 msg=success 才有有效链接；msg 为失败文案时 url 可能是错误回退
    if (body?.code === 0 && body?.url && /success/i.test(body?.msg || '')) {
      return body.url
    }
  } catch {}
  return ''
}

/** 平台官方歌曲页，作为音乐卡片的点击跳转地址 */
export function songPageUrl (server, id, title = '') {
  switch (server) {
    case 'netease':
      return `https://music.163.com/song?id=${id}`
    case 'kuwo':
      return `https://www.kuwo.cn/play_detail/${id}`
    case 'kugou':
      return `https://www.kugou.com/yy/html/search.html#searchType=song&searchKeyWord=${encodeURIComponent(title)}`
    default:
      return ''
  }
}
