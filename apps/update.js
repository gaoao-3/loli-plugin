/**
 * 更新指令 — #loli更新 / #loli强制更新
 */
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { makeForwardMsg } from '../utils/bot.js'

const execFileAsync = promisify(execFile)
const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const UPDATE_TIMEOUT = 60000
const DEPENDENCY_INSTALL_TIMEOUT = 180000
const RESTART_DELAY = 2000
const MAX_LOG_COMMITS = 20
const REPOSITORY_URL = 'https://github.com/gaoao-3/loli-plugin'
const GIT_CONFIG = ['-c', 'user.name=loli', '-c', 'user.email=loli@bot']

let updating = false

export class loliUpdate extends plugin {
  constructor () {
    super({
      name: 'loli-更新',
      dsc: 'loli更新指令',
      event: 'message',
      priority: 600,
      rule: [
        { reg: '^#loli更新$', fnc: 'doUpdate' },
        { reg: '^#loli强制更新$', fnc: 'doForceUpdate' }
      ]
    })
  }

  async doUpdate (e) {
    return this.runUpdate(e, false)
  }

  async doForceUpdate (e) {
    return this.runUpdate(e, true)
  }

  async runUpdate (e, force) {
    if (!e.isMaster) {
      return e.reply(force
        ? '只有主人可以强制更新 loli-plugin。'
        : '只有主人可以更新 loli-plugin。')
    }

    if (updating) return e.reply('已有更新任务正在执行，请勿重复操作。')

    updating = true
    try {
      await checkGit()
      const oldHead = await getHead()

      await e.reply(force
        ? '🔄 正在强制更新 loli-plugin，请稍候...'
        : '🔄 正在更新 loli-plugin，请稍候...')

      if (force) {
        await runGit(['checkout', '.'])
        await runGit(['clean', '-fd'])
      }

      await runGit(['pull', '--no-rebase'])
      const newHead = await getHead()
      const pluginUpdated = oldHead !== newHead

      if (!pluginUpdated) {
        const updatedAt = await getLatestCommitTime()
        return e.reply([
          '✅ loli-plugin 已完成检查',
          `loli-plugin：已是最新版 ${shortHead(newHead)}`,
          '内置核心与管理面板：随插件保持一致',
          `最后更新：${updatedAt}`
        ].join('\n'))
      }

      await e.reply('📦 正在同步插件与内置核心所需依赖...')
      await syncDependencies()
      const updatedAt = await getLatestCommitTime()

      let commits = []
      let totalCount = 0
      if (pluginUpdated) {
        const [logResult, countResult] = await Promise.all([
          runGit([
            'log',
            `${oldHead}..${newHead}`,
            `--max-count=${MAX_LOG_COMMITS}`,
            '--reverse',
            '--pretty=format:%h%x1f%cd%x1f%s',
            '--date=format:%m-%d %H:%M'
          ]),
          runGit(['rev-list', '--count', `${oldHead}..${newHead}`])
        ])
        commits = parseUpdateLog(logResult.stdout)
        totalCount = Number.parseInt(countResult.stdout.trim(), 10) || commits.length
      }

      const nodes = buildUpdateForwardNodes({
        force,
        oldHead,
        newHead,
        updatedAt,
        commits,
        totalCount,
        pluginUpdated
      })
      const title = buildUpdateTitle({ totalCount })

      try {
        const forward = await makeForwardMsg(e, nodes, title)
        const result = await e.reply(forward)
        scheduleRestart(e)
        return result
      } catch (forwardError) {
        globalThis.logger?.warn?.(`[loli] 更新成功，但合并转发构建失败：${forwardError.message}`)
        const result = await e.reply([title, ...nodes].join('\n\n'))
        scheduleRestart(e)
        return result
      }
    } catch (error) {
      return e.reply(`❌ 更新失败：${formatError(error)}`)
    } finally {
      updating = false
    }
  }
}

export function scheduleRestart (e, delay = RESTART_DELAY) {
  const timer = setTimeout(() => {
    restartBot(e).catch(async error => {
      globalThis.logger?.error?.(`[loli] 更新完成后自动重启失败：${formatError(error)}`)
      try {
        await e.reply('⚠️ 更新已完成，但自动重启失败，请发送 #重启 手动应用更新。')
      } catch {}
    })
  }, Math.max(0, Number(delay) || 0))
  timer.unref?.()
  return timer
}

async function restartBot (e) {
  const { Restart } = await import('../../other/restart.js')
  if (typeof Restart !== 'function') throw new Error('当前运行环境未提供 Restart')
  return new Restart(e).restart()
}

export function parseUpdateLog (output) {
  return String(output || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [hash = '', time = '', ...subjectParts] = line.split('\x1f')
      return {
        hash: hash.trim(),
        time: time.trim(),
        subject: subjectParts.join('\x1f').trim()
      }
    })
    .filter(commit => commit.hash && commit.subject)
}

export function buildUpdateForwardNodes ({
  force = false,
  oldHead = '',
  newHead = '',
  updatedAt = '',
  commits = [],
  totalCount = commits.length,
  pluginUpdated = oldHead !== newHead
} = {}) {
  const nodes = [
    [
      '✅ 插件、内置核心与管理面板更新完成',
      `更新方式：${force ? '强制更新' : '普通更新'}`,
      `loli-plugin：${pluginUpdated ? `${shortHead(oldHead)} → ${shortHead(newHead)}` : `已是最新版 ${shortHead(newHead)}`}`,
      '核心形态：插件内置，版本与插件一致',
      `最后更新：${updatedAt || '未知'}`,
      `插件新增提交：${totalCount} 个`,
      '将在 2 秒后自动重启以应用更新'
    ].join('\n')
  ]

  for (const commit of commits) {
    nodes.push([
      `📝 ${commit.hash}${commit.time ? ` · ${commit.time}` : ''}`,
      commit.subject
    ].join('\n'))
  }

  if (totalCount > commits.length) {
    nodes.push(`其余 ${totalCount - commits.length} 个提交未展开，请前往 GitHub 查看完整记录。`)
  }

  nodes.push(`🔗 完整更新记录\n${REPOSITORY_URL}/commits/main`)
  return nodes
}

async function runGit (args) {
  return execFileAsync('git', [...GIT_CONFIG, ...args], {
    cwd: PLUGIN_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    timeout: UPDATE_TIMEOUT,
    maxBuffer: 1024 * 1024
  })
}

async function runPnpm (args) {
  const options = {
    cwd: PLUGIN_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    timeout: DEPENDENCY_INSTALL_TIMEOUT,
    maxBuffer: 2 * 1024 * 1024
  }

  if (process.platform === 'win32') {
    const command = ['pnpm', ...args].join(' ')
    return execFileAsync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], options)
  }

  return execFileAsync('pnpm', args, options)
}

async function checkGit () {
  try {
    await execFileAsync('git', ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000
    })
  } catch {
    throw new Error('未检测到 Git，请先安装 Git。')
  }
}

async function syncDependencies () {
  try {
    await runPnpm(['--version'])
  } catch {
    throw new Error('插件已拉取更新，但未检测到 pnpm，无法同步依赖。')
  }

  await runPnpm([
    'install',
    '--ignore-workspace',
    '--frozen-lockfile',
    '--ignore-scripts',
    '--reporter=append-only'
  ])
}

async function getHead () {
  const result = await runGit(['rev-parse', 'HEAD'])
  return result.stdout.trim()
}

async function getLatestCommitTime () {
  const result = await runGit([
    'log',
    '-1',
    '--pretty=format:%cd',
    '--date=format:%Y-%m-%d %H:%M'
  ])
  return result.stdout.trim() || '未知'
}

function shortHead (head) {
  return String(head || '未知').slice(0, 7)
}

function buildUpdateTitle ({ totalCount }) {
  return `🚀 loli-plugin 更新日志 · ${totalCount} 个提交`
}

function formatError (error) {
  const detail = error?.stderr || error?.stdout || error?.message || '未知错误'
  return String(detail).trim().slice(0, 500)
}
