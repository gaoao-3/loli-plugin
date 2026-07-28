/**
 * browser_use — 在 Microsandbox microVM 中使用 Playwright 控制无头浏览器。
 */
import path from 'path'
import { CustomTool } from '../../core/index.js'
import { DATA_DIR, getConfig } from '../state.js'
import { executeBrowserTask } from '../sandbox-browser.js'
import { buildExecutionReportNodes, deliverArtifacts } from './run_code.js'

const ACTION_TYPES = [
  'goto', 'click', 'fill', 'type', 'press', 'select',
  'check', 'uncheck', 'wait', 'wait_for', 'extract',
  'screenshot', 'back', 'reload'
]

async function queueBrowserReport (context, report) {
  if (Array.isArray(context?.executionReports)) {
    context.executionReports.push(report)
    return
  }
  // 没有汇总队列时不额外刷屏；工具 JSON 仍包含完整动作结果。
}

export async function runBrowser (args, context, cfg, execute = executeBrowserTask) {
  if (!cfg?.enable || cfg.browserEnable === false) {
    return JSON.stringify({
      error: '浏览器沙盒未启用',
      hint: '请启用 sandbox.enable 和 sandbox.browserEnable'
    })
  }
  if (cfg.masterOnly !== false && !context?.event?.isMaster) {
    return JSON.stringify({ error: '仅主人可使用浏览器控制功能' })
  }
  if (cfg.microsandboxNetwork === false) {
    return JSON.stringify({ error: '浏览器需要公网访问，请启用 sandbox.microsandboxNetwork' })
  }

  const startedAt = Date.now()
  const event = context?.event
  try {
    const output = await execute({ args, cfg })
    const artifacts = Array.isArray(output.artifacts) ? output.artifacts : []
    delete output.artifacts

    if (cfg.executionReport !== false) {
      await queueBrowserReport(context, {
        language: 'browser',
        nodes: buildExecutionReportNodes({
          code: JSON.stringify({ url: args?.url, actions: args?.actions || [] }, null, 2),
          language: 'browser',
          output: {
            stdout: JSON.stringify(output, null, 2),
            stderr: '',
            result: output.url || '',
            error: output.error
          },
          artifacts,
          durationMs: Date.now() - startedAt
        })
      })
    }

    if (artifacts.length > 0) {
      if (cfg.mediaIO !== false && typeof event?.reply === 'function') {
        const { sent, skipped } = await deliverArtifacts(event, artifacts, path.join(DATA_DIR, 'sandbox'))
        if (sent.length > 0) output.sentArtifacts = sent
        if (skipped.length > 0) output.skippedArtifacts = skipped
      } else {
        output.artifactCount = artifacts.length
      }
    }
    return JSON.stringify(output)
  } catch (error) {
    const output = {
      error: `浏览器执行失败: ${error.message}`,
      hint: '首次运行需要下载 Playwright 浏览器镜像；请确认网络、磁盘空间和 WHP/KVM 可用'
    }
    if (cfg.executionReport !== false) {
      await queueBrowserReport(context, {
        language: 'browser',
        nodes: buildExecutionReportNodes({
          code: JSON.stringify({ url: args?.url, actions: args?.actions || [] }, null, 2),
          language: 'browser',
          output,
          durationMs: Date.now() - startedAt
        })
      })
    }
    return JSON.stringify(output)
  }
}

class BrowserUse extends CustomTool {
  name = 'browser_use'

  function = {
    name: 'browser_use',
    description: `在隔离的 Microsandbox microVM 中使用无头 Chromium 浏览网页。
适合打开动态网页、读取正文、点击按钮、填写表单、截图和下载公开文件。网络策略只允许公网，无法访问机器人宿主机、localhost 或局域网。
一次调用可依次执行多个动作；优先使用稳定的 CSS selector 或 role/name。动作失败时会返回已完成步骤和错误。
需要看页面时设置 screenshot=true，截图会自动通过 QQ 发给用户。不要用于绕过验证码、登录保护或网站访问控制。`,
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '起始网页的完整 http/https URL'
        },
        actions: {
          type: 'array',
          maxItems: 20,
          description: '按顺序执行的浏览器动作',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ACTION_TYPES },
              selector: { type: 'string', description: 'CSS 选择器' },
              role: { type: 'string', description: 'ARIA role，例如 button/textbox/link' },
              name: { type: 'string', description: 'ARIA 可访问名称，配合 role 使用' },
              text: { type: 'string', description: '按可见文本定位，或 type 动作的定位文本' },
              value: { type: 'string', description: 'fill/type/select 要写入或选择的值' },
              key: { type: 'string', description: 'press 的按键，例如 Enter、Control+A' },
              url: { type: 'string', description: 'goto 动作的目标 URL' },
              filename: { type: 'string', description: 'screenshot 的 PNG 文件名' },
              timeoutMs: { type: 'number', description: '该动作超时；wait 动作表示等待时长，最多 10000ms' },
              fullPage: { type: 'boolean', description: 'screenshot 是否截取完整页面' }
            },
            required: ['type']
          }
        },
        screenshot: {
          type: 'boolean',
          description: '所有动作完成后是否生成并发送最终页面截图；actions 已包含 screenshot 时不会重复生成'
        },
        fullPage: {
          type: 'boolean',
          description: '最终截图是否包含完整滚动页面'
        },
        viewportWidth: {
          type: 'number',
          description: '视口宽度，默认 1280，范围 320-1920'
        },
        viewportHeight: {
          type: 'number',
          description: '视口高度，默认 720，范围 240-1080'
        }
      },
      required: ['url']
    }
  }

  async run (args, context) {
    return runBrowser(args, context, getConfig()?.sandbox)
  }
}

export default new BrowserUse()
