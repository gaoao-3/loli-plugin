/**
 * QQ 音乐搜索工具
 * 适配插件内置引擎，支持可选 cookie（搜索 VIP 歌曲）
 */
import { CustomTool } from '../../core/index.js'
import { fetchWithTimeout, musicAuth } from '../music.js'

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
      const auth = musicAuth()

      const body = {
        comm: { uin: auth.uin, authst: auth.authst, ct: 29 },
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

      const response = await fetchWithTimeout('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
          'Content-Type': 'application/json',
          ...(auth.cookie ? { Cookie: auth.cookie } : {})
        },
        body: JSON.stringify(body)
      })
      if (!response.ok) return `QQ音乐搜索接口异常 (HTTP ${response.status})`
      const res = await response.json()

      if (res.code !== 0) return `QQ音乐搜索接口异常 (code: ${res.code})`

      const dataBody = res.search?.data?.body || {}
      const list = dataBody.song?.list || dataBody.item_song || []

      if (!list || list.length === 0) return `未找到 "${keyword}" 的相关歌曲。`

      return list.map((item, i) => {
        const singer = (item.singer || []).map(s => s.name).join('/') || '未知'
        const album = item.album?.name ? `《${item.album.name}》` : ''
        const mid = item.mid || ''
        const id = item.id || ''
        const title = stripTags(item.title || item.name || '未知歌曲')
        return `${i + 1}. ${title} - ${singer} ${album} [mid:${mid}] [id:${id}]`
      }).join('\n')

    } catch (err) {
      return `QQ音乐搜索出错: ${err.message}`
    }
  }
}

function stripTags (value) {
  return String(value || '').replace(/<[^>]*>/g, '')
}

export default new SearchMusic()
