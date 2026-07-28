/**
 * Microsandbox + Playwright 无头浏览器后端。
 *
 * 浏览器运行在一次性 microVM 中；宿主只向虚拟机注入与官方镜像同版本的
 * playwright-core JS 控制库，不暴露机器人工作目录。
 */
import path from 'path'
import net from 'net'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'
import { hardenedPublicOnlyPolicy } from './sandbox.js'
import { collectMicrosandboxArtifacts } from './sandbox-microsandbox.js'

const require = createRequire(import.meta.url)
const PLAYWRIGHT_CORE_DIR = path.dirname(require.resolve('playwright-core/package.json'))
const RESULT_MARKER = '__LOLI_BROWSER_RESULT__'
const MAX_ACTIONS = 20
const MAX_TEXT = 12000

const RUNNER = String.raw`
const { createRequire } = await import('node:module')
const require = createRequire(import.meta.url)
const { chromium } = require('/opt/playwright-core')
const fs = await import('node:fs/promises')

const task = JSON.parse(await fs.readFile('/workspace/browser-task.json', 'utf8'))
const marker = '${RESULT_MARKER}'
const clip = (value, max = ${MAX_TEXT}) => {
  const text = String(value ?? '')
  return text.length > max ? text.slice(0, max) + '\n…（已截断）' : text
}
const safeName = (value, fallback) => {
  const name = String(value || fallback).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
  return name && !name.startsWith('.') ? name : fallback
}
const result = { actions: [], downloads: [] }
let browser

function locatorFor (page, action) {
  if (action.role) {
    return page.getByRole(action.role, action.name ? { name: action.name } : {})
  }
  if (action.selector) return page.locator(action.selector)
  if (action.text) return page.getByText(action.text, { exact: false })
  throw new Error(action.type + ' 需要 selector、role/name 或 text')
}

async function retryNetworkChange (operation) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!/ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/.test(String(error?.message))) {
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)))
    }
  }
  throw lastError
}

try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  })
  const context = await browser.newContext({
    acceptDownloads: true,
    ignoreHTTPSErrors: task.ignoreHTTPSErrors === true,
    viewport: {
      width: Math.max(320, Math.min(1920, Number(task.viewportWidth) || 1280)),
      height: Math.max(240, Math.min(1080, Number(task.viewportHeight) || 720))
    }
  })
  const page = await context.newPage()
  page.setDefaultTimeout(task.timeoutMs)
  page.setDefaultNavigationTimeout(task.timeoutMs)

  const pendingDownloads = []
  page.on('download', download => {
    const job = (async () => {
      const filename = safeName(download.suggestedFilename(), 'download.bin')
      await download.saveAs('/workspace/outputs/' + filename)
      result.downloads.push(filename)
    })()
    pendingDownloads.push(job)
  })

  await retryNetworkChange(() => page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: task.timeoutMs }))
  result.actions.push({ type: 'goto', ok: true, url: page.url() })

  for (let index = 0; index < task.actions.length; index++) {
    const action = task.actions[index]
    const timeout = Math.max(100, Math.min(task.timeoutMs, Number(action.timeoutMs) || task.timeoutMs))
    const entry = { index: index + 1, type: action.type, ok: true }
    try {
      switch (action.type) {
        case 'goto':
          await retryNetworkChange(() => page.goto(action.url, { waitUntil: 'domcontentloaded', timeout }))
          entry.url = page.url()
          break
        case 'click':
          await locatorFor(page, action).first().click({ timeout })
          break
        case 'fill':
          await locatorFor(page, action).first().fill(String(action.value ?? ''), { timeout })
          break
        case 'type':
          await locatorFor(page, action).first().pressSequentially(String(action.value ?? ''), { timeout })
          break
        case 'press':
          await locatorFor(page, action).first().press(String(action.key || 'Enter'), { timeout })
          break
        case 'select':
          await locatorFor(page, action).first().selectOption(String(action.value ?? ''), { timeout })
          break
        case 'check':
          await locatorFor(page, action).first().check({ timeout })
          break
        case 'uncheck':
          await locatorFor(page, action).first().uncheck({ timeout })
          break
        case 'wait':
          await page.waitForTimeout(Math.max(0, Math.min(10000, Number(action.timeoutMs) || 1000)))
          break
        case 'wait_for':
          await locatorFor(page, action).first().waitFor({ state: 'visible', timeout })
          break
        case 'extract':
          entry.text = clip(await locatorFor(page, action).first().innerText({ timeout }), 4000)
          break
        case 'screenshot': {
          const filename = safeName(action.filename, 'step-' + (index + 1) + '.png')
          await page.screenshot({
            path: '/workspace/outputs/' + (filename.endsWith('.png') ? filename : filename + '.png'),
            fullPage: action.fullPage === true
          })
          entry.filename = filename.endsWith('.png') ? filename : filename + '.png'
          break
        }
        case 'back':
          await retryNetworkChange(() => page.goBack({ waitUntil: 'domcontentloaded', timeout }))
          break
        case 'reload':
          await retryNetworkChange(() => page.reload({ waitUntil: 'domcontentloaded', timeout }))
          break
        default:
          throw new Error('不支持的浏览器动作: ' + action.type)
      }
    } catch (error) {
      entry.ok = false
      entry.error = clip(error.message, 1000)
      result.actions.push(entry)
      throw error
    }
    result.actions.push(entry)
  }

  if (task.screenshot === true) {
    await page.screenshot({
      path: '/workspace/outputs/browser-final.png',
      fullPage: task.fullPage === true
    })
    result.screenshot = 'browser-final.png'
  }

  await page.waitForTimeout(300)
  await Promise.allSettled(pendingDownloads)
  result.title = await page.title()
  result.url = page.url()
  result.text = clip(await page.locator('body').innerText().catch(() => ''), ${MAX_TEXT})
  console.log(marker + JSON.stringify(result))
} catch (error) {
  result.error = clip(error?.stack || error?.message || error, 4000)
  console.log(marker + JSON.stringify(result))
  process.exitCode = 1
} finally {
  await browser?.close().catch(() => {})
}
`

function parseRunnerResult (stdout, stderr, success, code) {
  const markerAt = stdout.lastIndexOf(RESULT_MARKER)
  if (markerAt < 0) {
    return {
      error: `浏览器进程退出码 ${code}`,
      stderr: String(stderr || '').slice(0, 4096),
      stdout: String(stdout || '').slice(0, 4096)
    }
  }
  const line = stdout.slice(markerAt + RESULT_MARKER.length).split(/\r?\n/u)[0]
  try {
    const result = JSON.parse(line)
    if (!success && !result.error) result.error = `浏览器进程退出码 ${code}`
    return result
  } catch {
    return {
      error: '浏览器返回了无法解析的结果',
      stderr: String(stderr || '').slice(0, 4096)
    }
  }
}

function isPrivateIp (hostname) {
  const value = hostname.replace(/^\[|\]$/gu, '').toLowerCase()
  if (net.isIPv4(value)) {
    const [a, b] = value.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
  }
  if (net.isIPv6(value)) {
    return value === '::' || value === '::1' ||
      value.startsWith('fc') || value.startsWith('fd') ||
      /^fe[89ab]/u.test(value)
  }
  return false
}

function assertPublicHttpUrl (value, label = 'url') {
  let url
  try {
    url = new URL(String(value || ''))
  } catch {
    throw new Error(`${label} 必须是有效的 http/https 地址`)
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label} 只允许 http/https 地址`)
  }
  const hostname = url.hostname.toLowerCase()
  if (url.username || url.password ||
      hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') || isPrivateIp(hostname)) {
    throw new Error(`${label} 不允许访问 localhost、私网或带账号密码的地址`)
  }
  return url
}

export function normalizeBrowserTask (args, cfg = {}) {
  const url = assertPublicHttpUrl(args?.url)

  const actions = Array.isArray(args?.actions) ? args.actions : []
  if (actions.length > MAX_ACTIONS) {
    throw new Error(`单次最多执行 ${MAX_ACTIONS} 个浏览器动作`)
  }
  for (const action of actions) {
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      throw new Error('每个浏览器动作都必须包含 type')
    }
    if (action.type === 'goto') {
      assertPublicHttpUrl(action.url, 'goto.url')
    }
  }

  return {
    url: url.toString(),
    actions,
    // 模型有时会同时请求步骤截图和最终截图；步骤截图已能满足回传需求时
    // 不再额外生成 browser-final.png，避免 QQ 连续收到两张重复画面。
    screenshot: args?.screenshot === true && !actions.some(action => action.type === 'screenshot'),
    fullPage: args?.fullPage === true,
    viewportWidth: Number(args?.viewportWidth) || 1280,
    viewportHeight: Number(args?.viewportHeight) || 720,
    ignoreHTTPSErrors: cfg.browserIgnoreHTTPSErrors === true,
    timeoutMs: Math.max(1000, (Number(cfg.browserTimeoutSeconds) || 45) * 1000)
  }
}

/**
 * 在一次性 Microsandbox microVM 中执行声明式 Playwright 任务。
 */
export async function executeBrowserTask ({ args, cfg, sdk, playwrightCoreDir = PLAYWRIGHT_CORE_DIR }) {
  const task = normalizeBrowserTask(args, cfg)
  const { Sandbox, MiB, NetworkPolicy } = sdk || await import('microsandbox')
  const name = `loli-browser-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  const memoryMiB = Math.max(512, Number(cfg.browserMemoryMiB) || 1024)
  const cpus = Math.max(1, Number(cfg.browserCpus) || 2)
  const timeoutMs = task.timeoutMs

  let builder = Sandbox.builder(name)
    .image(cfg.microsandboxBrowserImage || 'mcr.microsoft.com/playwright:v1.61.0-noble')
    .cpus(cpus)
    .memory(MiB(memoryMiB))
    .patch(patch => patch
      .mkdir('/workspace')
      .mkdir('/workspace/outputs')
      .copyDir(playwrightCoreDir, '/opt/playwright-core'))
    .env('PLAYWRIGHT_BROWSERS_PATH', '/ms-playwright')
    .workdir('/workspace')
    .ephemeral(true)
    .maxDuration(Math.max(1, Number(cfg.sandboxTimeoutSeconds) || 300))
    .replace()

  if (cfg.microsandboxNetwork === false) {
    builder = builder.disableNetwork()
  } else {
    builder = builder.network(network => network.policy(hardenedPublicOnlyPolicy(NetworkPolicy)).maxConnections(128))
  }

  let sandbox
  try {
    sandbox = await builder.create()
    const guestFs = sandbox.fs()
    await guestFs.write('/workspace/browser-task.json', JSON.stringify(task))
    await guestFs.write('/workspace/browser-runner.mjs', RUNNER)

    const execution = await sandbox.execWith('node', options => options
      .args(['/workspace/browser-runner.mjs'])
      .cwd('/workspace')
      .timeout(timeoutMs + 10000))
    const output = parseRunnerResult(
      execution.stdout(),
      execution.stderr(),
      execution.success,
      execution.code
    )
    output.artifacts = await collectMicrosandboxArtifacts(guestFs, {
      maxFiles: 8,
      maxBytes: 20 * 1024 * 1024
    })
    return output
  } finally {
    if (sandbox) {
      await sandbox.kill().catch(() => {})
      await Sandbox.remove(name).catch(() => {})
    }
  }
}
