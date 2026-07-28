import fs from 'fs'
import os from 'os'
import path from 'path'
import { CustomTool } from '../../core/index.js'
import { makeImageSegment } from '../bot.js'
import { getConfig } from '../state.js'
import { canUseDokobot, executeDokobot, validateDokobotUrl } from '../dokobot.js'

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])
const MAX_QQ_FILE_BYTES = 20 * 1024 * 1024

function collectImages (root) {
  const files = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full)
    }
  }
  walk(root)
  return files
}

class DokobotDownloadImages extends CustomTool {
  name = 'dokobot_download_images'

  function = {
    name: 'dokobot_download_images',
    description: '使用 Dokobot Chrome Bridge 下载网页中的图片，并最多向当前 QQ 会话发送 4 张。仅主人可用。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '完整 http(s) 网页地址' },
        max: { type: 'integer', description: '最多下载并发送的图片数，范围 1-4' },
        screens: { type: 'integer', description: '滚动加载屏数，范围 1-20' },
        minWidth: { type: 'integer', description: '最小图片宽度，可选' },
        minHeight: { type: 'integer', description: '最小图片高度，可选' },
        includeBackground: { type: 'boolean', description: '是否包含 CSS background-image' }
      },
      required: ['url']
    }
  }

  async run ({ url, max = 4, screens = 3, minWidth, minHeight, includeBackground = false }, context = {}) {
    if (context.event?.isMaster !== true) throw new Error('Dokobot 图片下载仅机器人主人可用')
    const access = canUseDokobot(getConfig()?.dokobot, context)
    if (!access.allowed) throw new Error(access.reason === 'master_only' ? 'Dokobot 图片下载仅机器人主人可用' : 'Dokobot 未启用')
    if (typeof context.event?.reply !== 'function') throw new Error('当前调用没有可回发图片的 QQ 会话')
    const validation = validateDokobotUrl(url, access.config)
    if (!validation.valid) throw new Error(validation.reason)

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loli-dokobot-images-'))
    try {
      const limit = Math.max(1, Math.min(4, Number.parseInt(max, 10) || 4))
      const scrollScreens = Math.max(1, Math.min(20, Number.parseInt(screens, 10) || 3))
      const args = ['download', 'images', '--local', validation.url, '--output', tempDir, '--format', 'jpg,jpeg,png,gif,webp', '--max', String(limit), '--screens', String(scrollScreens), '--max-size', '20mb', '--timeout', String(access.config.timeoutSeconds)]
      if (Number.isFinite(Number(minWidth))) args.push('--min-width', String(Math.max(1, Number.parseInt(minWidth, 10))))
      if (Number.isFinite(Number(minHeight))) args.push('--min-height', String(Math.max(1, Number.parseInt(minHeight, 10))))
      if (includeBackground) args.push('--include-bg')
      if (access.config.reuseTab) args.push('--reuse-tab')
      await executeDokobot(args, access.config)

      const images = collectImages(tempDir).filter(file => {
        const size = fs.statSync(file).size
        return size > 0 && size <= MAX_QQ_FILE_BYTES
      }).slice(0, limit)
      if (images.length === 0) throw new Error('页面没有下载到可回发的图片')
      for (const image of images) await context.event.reply(makeImageSegment(image))
      return JSON.stringify({ ok: true, url: validation.url, sent: images.length })
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }
}

export default new DokobotDownloadImages()
