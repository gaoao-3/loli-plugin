/**
 * 音乐搜索工具
 * 通过 Meting 兼容 API（见 utils/music-api.js）搜索网易云/酷狗/酷我歌曲
 */
import { CustomTool } from '../../core/index.js'
import { MUSIC_SERVERS, musicServerName, searchSongs } from '../music-api.js'

class SearchMusic extends CustomTool {

  name = 'search_music'

  function = {
    name: 'search_music',
    description: '搜索歌曲（支持网易云、酷狗、酷我）。传入歌曲名或歌手名，返回歌曲列表（含标题、歌手、id、平台）。如果用户想听歌或点歌，用这个搜索。搜索到歌曲后调用 send_music 发送音乐卡片。',
    parameters: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '搜索关键词，歌曲名或歌手名，如 "周杰伦 晴天"'
        },
        server: {
          type: 'string',
          enum: MUSIC_SERVERS,
          description: '音源平台：netease=网易云（默认），kugou=酷狗，kuwo=酷我。一个平台搜不到时可换平台重试。'
        }
      },
      required: ['keyword']
    }
  }

  async run (args) {
    const keyword = String(args?.keyword || '').trim()
    if (!keyword) return '错误: 缺少搜索关键词'

    try {
      const { server, songs } = await searchSongs(keyword, { server: args.server })
      if (!songs.length) {
        return `在${musicServerName(server)}未找到 "${keyword}" 相关歌曲，可以换个关键词或换个平台（${MUSIC_SERVERS.filter(s => s !== server).join(' / ')}）再试。`
      }
      const lines = songs.map((song, i) => `${i + 1}. ${song.name} - ${song.singer} (id: ${song.id})`)
      return [
        `"${keyword}" 在${musicServerName(server)}的搜索结果：`,
        ...lines,
        `调用 send_music 发送时请带上对应的 id 和 server="${server}"。结果不明确时先让用户选择，不要擅自发送。`
      ].join('\n')
    } catch (err) {
      return `音乐搜索出错: ${err.message}`
    }
  }
}

export default new SearchMusic()
