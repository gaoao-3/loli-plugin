/**
 * Bilibili 搜索工具 - 搜索视频/B站内容
 */
import { CustomTool } from 'lolicon-core'

class BiliSearch extends CustomTool {

  name = 'bili_search'

  function = {
    name: 'bili_search',
    description: '搜索B站(Bilibili)视频。传入关键词搜索视频，返回视频标题、UP主、播放量、BV号和链接。也可用于搜索番剧。',
    parameters: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '搜索关键词'
        },
        limit: {
          type: 'number',
          description: '返回结果数量，默认5，最多10'
        }
      },
      required: ['keyword']
    }
  }

  async run(args, _context) {
    const { keyword, limit = 5 } = args
    const actualLimit = Math.min(Math.max(limit || 5, 1), 10)

    try {
      const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(keyword)}&page=1&page_size=${actualLimit}`
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': 'https://www.bilibili.com/'
        }
      })

      if (!res.ok) {
        return `搜索失败: HTTP ${res.status}`
      }

      const data = await res.json()

      if (data.code !== 0) {
        return `B站API返回错误: ${data.message || '未知错误'}`
      }

      const videos = data?.data?.result || []

      if (videos.length === 0) {
        return `未找到 "${keyword}" 的相关B站视频。`
      }

      const list = videos.map((v, i) => {
        const title = v.title?.replace(/<em class="keyword">|<\/em>/g, '')
        const author = v.author
        const play = v.play > 10000 ? `${(v.play / 10000).toFixed(1)}万` : v.play
        const danmaku = v.video_review
        const bvid = v.bvid
        const url = `https://www.bilibili.com/video/${bvid}`
        return `${i + 1}. ${title}\n   UP: ${author} | 播放: ${play} | 弹幕: ${danmaku}\n   ${url}`
      })

      return `搜索 "${keyword}" B站结果:\n${list.join('\n')}`
    } catch (err) {
      return `B站搜索出错: ${err.message}`
    }
  }
}

export default new BiliSearch()
