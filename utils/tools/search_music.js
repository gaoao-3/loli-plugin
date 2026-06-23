/**
 * QQ 音乐搜索工具
 * 适配 lolicon-core，支持可选 cookie（搜索 VIP 歌曲）
 */
import { CustomTool } from 'lolicon-core'
import fs from 'node:fs'
import path from 'node:path'

const PLUGIN_ROOT = path.resolve('./plugins/chatgpt-plugin')

function getMusicConfig() {
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(PLUGIN_ROOT, 'data/config.json'), 'utf-8')
    )
    return cfg.music || null
  } catch { return null }
}

class SearchMusic extends CustomTool {

  name = 'search_music'

  function = {
    name: 'search_music',
    description: '搜索 QQ 音乐。传入歌曲名或歌手名，返回歌曲列表（含标题、歌手、专辑、mid）。如果用户想听歌或点歌，用这个搜索。搜索到歌曲后可以调用 send_music 发送音乐卡片。',
    parameters: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '搜索关键词，歌曲名或歌手名'
        }
      },
      required: ['keyword']
    }
  }

  async run(args) {
    const { keyword } = args
    try {
      const music = getMusicConfig()
      const cookie = music?.cookie_str || ''

      const body = {
        comm: { uin: music?.uin || '0', authst: '', ct: 29 },
        search: {
          method: 'DoSearchForQQMusicMobile',
          module: 'music.search.SearchCgiService',
          param: {
            grp: 1,
            num_per_page: 10,
            page_num: 1,
            query: keyword,
            remoteplace: 'miniapp.1109523715',
            search_type: 0,
            searchid: String(Date.now())
          }
        }
      }

      const res = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {})
        },
        body: JSON.stringify(body)
      }).then(r => r.json())

      if (res.code !== 0) return `QQ音乐搜索接口异常 (code: ${res.code})`

      const dataBody = res.search?.data?.body || {}
      const list = dataBody.song?.list || dataBody.item_song || []

      if (!list || list.length === 0) return `未找到 "${keyword}" 的相关歌曲。`

      return list.map((item, i) => {
        const singer = (item.singer || []).map(s => s.name).join('/') || '未知'
        const album = item.album?.name ? `《${item.album.name}》` : ''
        const mid = item.mid || ''
        const id = item.id || ''
        return `${i + 1}. ${item.title || item.name} - ${singer} ${album} [mid:${mid}] [id:${id}]`
      }).join('\n')

    } catch (err) {
      return `QQ音乐搜索出错: ${err.message}`
    }
  }
}

export default new SearchMusic()
