/**
 * 网页内容读取工具 — 提取网页正文
 * 使用 @mozilla/readability 提取可读内容
 */
import { CustomTool } from 'lolicon-core'
import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'

const TIMEOUT_MS = 20000
const MAX_TEXT_LEN = 8000   // 返回正文上限，防 token 爆炸
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ChaiteBot/1.0'

class WebRead extends CustomTool {

  name = 'web_read'

  function = {
    name: 'web_read',
    description: `读取网页正文内容。输入 URL，返回页面标题和提取的正文文本。
适用场景：搜索到链接后深入了解内容、查看技术文档、阅读文章。
正文上限约${MAX_TEXT_LEN}字符，超长页面会自动截断。`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要读取的网页 URL（完整地址，含 https://）'
        }
      },
      required: ['url']
    }
  }

  async run(args) {
    const { url } = args

    // 基础校验
    if (!url || !/^https?:\/\/.+/i.test(url)) {
      return JSON.stringify({ url, error: '无效的 URL，需要完整的 http(s):// 地址' })
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      // 1. 抓取页面
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        }
      })
      clearTimeout(timer)

      if (!res.ok) {
        return JSON.stringify({ url, error: `获取页面失败: HTTP ${res.status}` })
      }

      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('application/pdf')) {
        return JSON.stringify({ url, error: 'PDF 文件暂不支持直接读取' })
      }
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        return JSON.stringify({
          url,
          error: `不支持的内容类型: ${contentType.slice(0, 50)}（仅支持 HTML 页面）`
        })
      }

      const html = await res.text()

      // 2. 提取正文
      const dom = new JSDOM(html, { url })
      const reader = new Readability(dom.window.document)
      const article = reader.parse()

      if (!article) {
        return JSON.stringify({ url, error: '无法提取页面正文内容，可能是动态页面或纯图片页面' })
      }

      // 3. 清理文本
      const title = (article.title || '').trim()
      const textOnly = dom.window.document.createElement('div')
      textOnly.innerHTML = article.content || ''
      let text = textOnly.textContent || ''
      // 压缩空白 + 合并多余空行
      text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

      // 4. 截断
      const totalLen = text.length
      let truncated = false
      if (totalLen > MAX_TEXT_LEN) {
        text = text.slice(0, MAX_TEXT_LEN)
        truncated = true
      }

      return JSON.stringify({
        url,
        title,
        length: totalLen,
        truncated,
        text
      })

    } catch (err) {
      clearTimeout(timer)
      if (err.name === 'AbortError') {
        return JSON.stringify({ url, error: `读取超时（${TIMEOUT_MS / 1000}秒），页面可能过大或无法访问` })
      }
      return JSON.stringify({ url, error: `读取失败: ${err.message}` })
    }
  }
}

export default new WebRead()
