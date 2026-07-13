import fetch from 'node-fetch'
import fs from 'fs'
import path from 'path'
import { CustomTool } from 'chaite'

const CONFIG_PATH = path.join(process.cwd(), 'plugins', 'example', 'qq_config.json')

class SearchMusicTool extends CustomTool {
  name = 'searchMusic'
  function = {
    name: 'searchMusic',
    description: '搜索QQ音乐。返回歌曲列表和 ID (mid)。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '歌名或歌手' }
      },
      required: ['keyword']
    }
  }

  getCookie() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')).cookie_str || ''
      }
    } catch (e) { return '' }
  }

  async run(args) {
    let { keyword } = args
    try {
      const cookie = this.getCookie()
      const body = {
        "comm": { "uin": "0", "authst": "", "ct": 29 },
        "search": {
          "method": "DoSearchForQQMusicMobile",
          "module": "music.search.SearchCgiService",
          "param": {
            "grp": 1, "num_per_page": 10, "page_num": 1, "query": keyword,
            "remoteplace": "miniapp.1109523715", "search_type": 0, "searchid": String(Date.now())
          }
        }
      }

      const res = await fetch(`https://u.y.qq.com/cgi-bin/musicu.fcg`, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
          'Content-Type': 'application/json',
          'Cookie': cookie
        },
        body: JSON.stringify(body)
      }).then(r => r.json())

      if (res.code !== 0) return 'QQ音乐搜索接口异常。'

      let dataBody = res.search?.data?.body || {}
      let list = dataBody.song?.list || dataBody.item_song || []

      if (!list || list.length === 0) return '未找到相关歌曲。'

      return list.map((item, i) => {
        const singer = item.singer?.map(s => s.name).join('/') || '未知'
        const album = item.album?.name ? `《${item.album.name}》` : ''
        return `${i + 1}. ${item.title} - ${singer} ${album} (ID: ${item.mid})`
      }).join('\n')

    } catch (e) {
      return `搜索出错: ${e.message}`
    }
  }
}

export default new SearchMusicTool()
