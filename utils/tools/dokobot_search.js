/**
 * 网页搜索工具 — 可选 Dokobot 本地浏览器，SearXNG 作为默认/回退链路
 */
import { CustomTool } from '../../core/index.js'
import { getConfig } from '../state.js'
import { canUseDokobot, DOKOBOT_SEARCH_ENGINES, searchWithDokobot } from '../dokobot.js'

const SEARXNG = 'http://localhost:8080/search'
const TIMEOUT_MS = 15000
const MAX_SNIPPET = 300
const MAX_RESULTS = 10

class DokobotSearch extends CustomTool {

  name = 'dokobot_search'

  function = {
    name: 'dokobot_search',
    description: `搜索互联网获取实时信息。启用 Dokobot 时可复用本机浏览器搜索动态页面，否则使用 SearXNG。
适用场景：查资料、核实事实、获取最新新闻、查询技术文档。
每次最多${MAX_RESULTS}条，支持翻页。`,
    parameters: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '搜索关键词，用中文或英文。尽量用精准的关键词而非整句'
        },
        page: {
          type: 'integer',
          description: `页码，默认1，每页${MAX_RESULTS}条`
        },
        engine: {
          type: 'string',
          enum: Object.keys(DOKOBOT_SEARCH_ENGINES),
          description: 'Dokobot 本地搜索引擎；未填写时使用面板默认值'
        }
      },
      required: ['keyword']
    }
  }

  async run(args, context = {}) {
    const { keyword, page = 1, engine } = args
    const access = canUseDokobot(getConfig()?.dokobot, context)

    if (access.allowed) {
      try {
        return JSON.stringify(await searchWithDokobot(keyword, access.config, { page, engine }))
      } catch (err) {
        if (!access.config.fallback) {
          return JSON.stringify({ query: keyword, provider: 'dokobot-local', error: `Dokobot 搜索失败: ${err.message}` })
        }
      }
    }

    // 1. 构建请求
    const params = new URLSearchParams({
      q: keyword,
      format: 'json',
      pageno: String(page),
      categories: 'general',
      language: 'zh-CN'
    })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const res = await fetch(`${SEARXNG}?${params}`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'ChaiteBot/1.0' }
      })
      clearTimeout(timer)

      if (!res.ok) {
        return JSON.stringify({
          query: keyword,
          error: `搜索引擎返回 HTTP ${res.status}，请稍后重试`
        })
      }

      const data = await res.json()

      // 2. 去重 + 格式化结果
      const seen = new Set()
      const formatted = []

      for (const r of data.results || []) {
        // 去重
        const canonicalUrl = (r.url || '').replace(/\/+$/, '')
        if (seen.has(canonicalUrl)) continue
        seen.add(canonicalUrl)
        if (formatted.length >= MAX_RESULTS) break

        // 摘要：优先 snippet，其次 content
        const raw = r.snippet || r.content || ''
        const snippet = raw.replace(/\s+/g, ' ').trim()

        formatted.push({
          i: formatted.length + 1,
          title: r.title || '',
          snippet: snippet.slice(0, snippet.length > MAX_SNIPPET ? MAX_SNIPPET : snippet.length),
          url: r.url || '',
          engines: r.engines || (r.engine && [r.engine]) || [],
          score: r.score != null ? Math.round(r.score * 100) / 100 : null,
          date: r.publishedDate || r.pubdate || null
        })
      }

      // 3. 构建返回
      const output = {
        query: keyword,
        page,
        provider: 'searxng',
        total: data.number_of_results ?? formatted.length,
        results: formatted
      }

      // 如果有直接答案（百科摘要 / 天气 / 汇率等），附在顶部
      if (Array.isArray(data.answers) && data.answers.length > 0) {
        output.answers = data.answers.slice(0, 3).map(a => ({
          answer: (a.answer || a.title || '').replace(/<[^>]+>/g, '').trim(),
          url: a.url || ''
        }))
      }

      // 如果有相关搜索建议
      if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
        output.suggestions = data.suggestions.slice(0, 5)
      }

      if (formatted.length === 0 && !output.answers) {
        output.hint = '没有找到相关结果，试试换关键词或更精准的表述'
      }

      return JSON.stringify(output)

    } catch (err) {
      clearTimeout(timer)
      if (err.name === 'AbortError') {
        return JSON.stringify({
          query: keyword,
          error: `搜索超时（${TIMEOUT_MS / 1000}秒），请稍后重试或简化关键词`
        })
      }
      return JSON.stringify({ query: keyword, error: `搜索失败: ${err.message}` })
    }
  }
}

export default new DokobotSearch()
