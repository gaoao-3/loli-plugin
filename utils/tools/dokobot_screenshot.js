import fs from 'fs'
import os from 'os'
import path from 'path'
import { CustomTool } from '../../core/index.js'
import { makeImageSegment } from '../bot.js'
import { getConfig } from '../state.js'
import { canUseDokobot, executeDokobot, validateDokobotUrl } from '../dokobot.js'

const MAX_QQ_FILE_BYTES = 20 * 1024 * 1024

class DokobotScreenshot extends CustomTool {
  name = 'dokobot_screenshot'

  function = {
    name: 'dokobot_screenshot',
    description: '使用已连接的 Dokobot Chrome Bridge 截取完整网页并把图片发送到当前 QQ 会话。仅主人可用。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '完整 http(s) 网页地址' },
        maxScreens: { type: 'integer', description: '最大截图屏数，默认 10，范围 1-20' },
        reuseTab: { type: 'boolean', description: '是否复用已打开的相同 URL 标签页' }
      },
      required: ['url']
    }
  }

  async run ({ url, maxScreens = 10, reuseTab }, context = {}) {
    if (context.event?.isMaster !== true) throw new Error('Dokobot 截图仅机器人主人可用')
    const access = canUseDokobot(getConfig()?.dokobot, context)
    if (!access.allowed) throw new Error(access.reason === 'master_only' ? 'Dokobot 截图仅机器人主人可用' : 'Dokobot 未启用')
    if (typeof context.event?.reply !== 'function') throw new Error('当前调用没有可回发截图的 QQ 会话')
    const validation = validateDokobotUrl(url, access.config)
    if (!validation.valid) throw new Error(validation.reason)

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loli-dokobot-shot-'))
    const output = path.join(tempDir, 'screenshot.jpg')
    try {
      const screens = Math.max(1, Math.min(20, Number.parseInt(maxScreens, 10) || 10))
      const args = ['screenshot', '--local', validation.url, '--output', output, '--max-screens', String(screens), '--timeout', String(access.config.timeoutSeconds)]
      if (reuseTab === true || (reuseTab === undefined && access.config.reuseTab)) args.push('--reuse-tab')
      await executeDokobot(args, access.config)
      if (!fs.existsSync(output)) throw new Error('Dokobot 未生成截图文件')
      const size = fs.statSync(output).size
      if (size <= 0 || size > MAX_QQ_FILE_BYTES) throw new Error(`截图大小不适合 QQ 回发: ${Math.ceil(size / 1024 / 1024)} MiB`)
      await context.event.reply(makeImageSegment(output))
      return JSON.stringify({ ok: true, url: validation.url, sent: true, size })
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }
}

export default new DokobotScreenshot()
