/**
 * 更新指令 — #loli更新 / #loli强制更新
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { makeForwardMsg } from '../utils/bot.js'

const execFileAsync = promisify(execFile)
const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const UPDATE_TIMEOUT = 60000
const DEPENDENCY_UPDATE_TIMEOUT = 180000
const MAX_LOG_COMMITS = 20
const REPOSITORY_URL = 'https://github.com/gaoao-3/loli-plugin'
const CORE_REPOSITORY_URL = 'https://github.com/gaoao-3/lolicon-core'
const GIT_CONFIG = ['-c', 'user.name=loli', '-c', 'user.email=loli@bot']
const CORE_LOCK_PATHS = [
  path.join(PLUGIN_ROOT, 'node_modules', '.pnpm', 'lock.yaml'),
  path.join(PLUGIN_ROOT, 'pnpm-lock.yaml')
]

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
      const oldCoreRevision = await getCoreRevision()

      await e.reply(force
        ? '🔄 正在强制更新 loli-plugin，请稍候...'
        : '🔄 正在更新 loli-plugin，请稍候...')

      if (force) {
        await runGit(['checkout', '.'])
        await runGit(['clean', '-fd'])
      }

      await runGit(['pull', '--no-rebase'])
      const newHead = await getHead()
      const updatedAt = await getLatestCommitTime()
      const pluginUpdated = oldHead !== newHead

      await e.reply('📦 正在检查并更新 lolicon-core 核心依赖...')
      let coreUpdate
      try {
        coreUpdate = await updateCoreDependency(oldCoreRevision)
      } catch (coreError) {
        const pluginStatus = pluginUpdated
          ? `loli-plugin 已更新至 ${shortHead(newHead)}`
          : 'loli-plugin 已是最新版'
        throw new Error(`${pluginStatus}，但 lolicon-core 更新失败：${formatError(coreError)}`)
      }

      if (!pluginUpdated && !coreUpdate.updated) {
        return e.reply([
          '✅ loli-plugin 与 lolicon-core 均已完成检查',
          `loli-plugin：已是最新版 ${shortHead(newHead)}`,
          `lolicon-core：${formatCoreStatus(coreUpdate)}`,
          `最后更新：${updatedAt}`
        ].join('\n'))
      }

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
        pluginUpdated,
        coreUpdate
      })
      const title = buildUpdateTitle({ pluginUpdated, coreUpdated: coreUpdate.updated, totalCount })

      try {
        const forward = await makeForwardMsg(e, nodes, title)
        return await e.reply(forward)
      } catch (forwardError) {
        globalThis.logger?.warn?.(`[loli] 更新成功，但合并转发构建失败：${forwardError.message}`)
        return e.reply([title, ...nodes].join('\n\n'))
      }
    } catch (error) {
      return e.reply(`❌ 更新失败：${formatError(error)}`)
    } finally {
      updating = false
    }
  }
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
  pluginUpdated = oldHead !== newHead,
  coreUpdate = {}
} = {}) {
  const nodes = [
    [
      '✅ 插件与核心依赖更新完成',
      `更新方式：${force ? '强制更新' : '普通更新'}`,
      `loli-plugin：${pluginUpdated ? `${shortHead(oldHead)} → ${shortHead(newHead)}` : `已是最新版 ${shortHead(newHead)}`}`,
      `lolicon-core：${formatCoreStatus(coreUpdate)}`,
      `最后更新：${updatedAt || '未知'}`,
      `插件新增提交：${totalCount} 个`
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

  const links = []
  if (pluginUpdated) links.push(`loli-plugin：${REPOSITORY_URL}/commits/main`)
  links.push(`lolicon-core：${CORE_REPOSITORY_URL}/commits/main`)
  nodes.push(`🔗 完整更新记录\n${links.join('\n')}`)
  return nodes
}

export function parseCoreRevision (lockfile) {
  return String(lockfile || '')
    .match(/https:\/\/codeload\.github\.com\/gaoao-3\/lolicon-core\/tar\.gz\/([a-f0-9]{40})/i)?.[1] || ''
}

export function parseInstalledCoreRevision (output) {
  try {
    const projects = JSON.parse(String(output || '[]'))
    const resolved = projects?.[0]?.dependencies?.['lolicon-core']?.resolved || ''
    return parseCoreRevision(resolved)
  } catch {
    return ''
  }
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
    timeout: DEPENDENCY_UPDATE_TIMEOUT,
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

async function checkPnpm () {
  try {
    await runPnpm(['--version'])
  } catch {
    throw new Error('未检测到 pnpm，无法更新 lolicon-core 核心依赖。')
  }
}

async function updateCoreDependency (beforeRevision = '') {
  await checkPnpm()
  if (!beforeRevision) beforeRevision = await getInstalledCoreRevision()

  await runPnpm([
    'update',
    'lolicon-core',
    '--lockfile=false',
    '--no-save',
    '--reporter=append-only'
  ])
  const afterRevision = await getInstalledCoreRevision() || await getCoreRevision()
  return {
    beforeRevision,
    afterRevision,
    updated: Boolean(beforeRevision && afterRevision && beforeRevision !== afterRevision),
    refreshed: true
  }
}

async function getInstalledCoreRevision () {
  try {
    const result = await runPnpm(['list', 'lolicon-core', '--depth=0', '--json'])
    return parseInstalledCoreRevision(result.stdout)
  } catch {
    return ''
  }
}

async function getCoreRevision () {
  for (const lockPath of CORE_LOCK_PATHS) {
    try {
      const revision = parseCoreRevision(await readFile(lockPath, 'utf8'))
      if (revision) return revision
    } catch {}
  }
  return ''
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

function formatCoreStatus ({ beforeRevision = '', afterRevision = '', updated = false, refreshed = false } = {}) {
  if (updated) return `${shortHead(beforeRevision)} → ${shortHead(afterRevision)}`
  if (afterRevision) return `已是最新版 ${shortHead(afterRevision)}`
  return refreshed ? '依赖刷新完成' : '未检查'
}

function buildUpdateTitle ({ pluginUpdated, coreUpdated, totalCount }) {
  if (pluginUpdated && coreUpdated) return `🚀 loli-plugin 与 lolicon-core 更新完成 · ${totalCount} 个插件提交`
  if (pluginUpdated) return `🚀 loli-plugin 更新日志 · ${totalCount} 个提交`
  return '📦 lolicon-core 更新完成'
}

function formatError (error) {
  const detail = error?.stderr || error?.stdout || error?.message || '未知错误'
  return String(detail).trim().slice(0, 500)
}
