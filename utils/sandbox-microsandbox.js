/**
 * Microsandbox 本地 microVM 后端。
 *
 * 不依赖 Docker daemon；每次调用创建临时 microVM，输入写入
 * /workspace/inputs，代码写入 /workspace/outputs 的文件会被收集回传。
 */
import path from 'path'
import { createHash, randomUUID } from 'crypto'
import { hardenedPublicOnlyPolicy, MAX_OUTPUT, resolveLanguage } from './sandbox.js'

const dependencySnapshotBuilds = new Map()

const DEFAULT_IMAGES = {
  python: 'python:3.14-slim',
  javascript: 'node:22-slim',
  typescript: 'node:22-slim',
  java: 'eclipse-temurin:21-jdk',
  go: 'golang:1.24-alpine',
  bash: 'alpine:3.22'
}

const SOURCE_FILES = {
  python: 'main.py',
  javascript: 'main.mjs',
  typescript: 'main.ts',
  java: 'Main.java',
  go: 'main.go',
  bash: 'main.sh'
}

const cutHead = (value, maxLen = MAX_OUTPUT) => {
  const text = String(value || '')
  return text.length > maxLen ? text.slice(0, maxLen) : text
}

function executionCommand (language) {
  const source = `/workspace/${SOURCE_FILES[language]}`
  switch (language) {
    case 'python': return ['python', [source]]
    case 'javascript': return ['node', [source]]
    case 'typescript': return ['node', ['--experimental-strip-types', source]]
    case 'java': return ['/bin/sh', ['-lc', 'cd /workspace && javac Main.java && java Main']]
    case 'go': return ['go', ['run', source]]
    case 'bash': return ['/bin/sh', [source]]
    default: throw new Error(`Microsandbox 暂不支持语言 "${language}"`)
  }
}

function imageFor (cfg, language) {
  return cfg.microsandboxImages?.[language] ||
    (language === 'python' ? cfg.microsandboxImage : '') ||
    DEFAULT_IMAGES[language]
}

/**
 * 规范化 Python 预装依赖。仅允许 PyPI 包名、extras 和版本约束，
 * 禁止 pip 选项、URL、VCS 与本地路径进入自动安装流程。
 */
export function normalizePythonDependencies (value) {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string' ? value.split(/\n/u) : []
  if (items.length > 64) throw new Error('pythonDependencies 最多允许 64 项')

  const requirement = /^[a-z0-9][a-z0-9._-]*(?:\[[a-z0-9._,-]+\])?(?:(?:===|==|~=|!=|<=|>=|<|>)[a-z0-9.*+!_-]+(?:,(?:===|==|~=|!=|<=|>=|<|>)[a-z0-9.*+!_-]+)*)?$/iu
  const normalized = []
  for (const raw of items) {
    const item = String(raw || '').trim().replace(/\s+/gu, '')
    if (!item) continue
    if (item.length > 120 || !requirement.test(item)) {
      throw new Error(`不安全或无效的 Python 依赖声明: ${raw}`)
    }
    if (!normalized.some(existing => existing.toLocaleLowerCase() === item.toLocaleLowerCase())) {
      normalized.push(item)
    }
  }
  return normalized.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
}

export function pythonDependencySnapshotName (cfg, dependencies = normalizePythonDependencies(cfg?.pythonDependencies)) {
  if (dependencies.length === 0) return ''
  const identity = JSON.stringify({
    version: 1,
    image: imageFor(cfg || {}, 'python'),
    dependencies
  })
  return `loli-python-deps-${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`
}

async function createPythonDependencySnapshot ({ Sandbox, Snapshot, MiB, NetworkPolicy }, cfg, snapshotName, dependencies) {
  const name = `loli-deps-build-${randomUUID().slice(0, 12)}`
  const memoryMiB = Math.max(256, Number(cfg.microsandboxMemoryMiB) || 512)
  const cpus = Math.max(1, Number(cfg.microsandboxCpus) || 1)
  const installTimeoutMs = Math.max(30, Number(cfg.dependencyInstallTimeoutSeconds) || 900) * 1000
  let sandbox
  let stopped = false
  try {
    globalThis.logger?.info?.(`[loli] 正在创建 Python 依赖快照 ${snapshotName}: ${dependencies.join(', ')}`)
    let builder = Sandbox.builder(name)
      .image(imageFor(cfg, 'python'))
      .cpus(cpus)
      .memory(MiB(memoryMiB))
      .patch(patch => patch
        .mkdir('/workspace')
        .mkdir('/workspace/inputs')
        .mkdir('/workspace/outputs'))
      .workdir('/workspace')
      .ephemeral(false)
      .maxDuration(Math.max(60, Number(cfg.dependencySnapshotTimeoutSeconds) || 1200))
      .replace()

    if (cfg.microsandboxNetwork === false) {
      throw new Error('创建 Python 依赖快照需要公网下载依赖，请先启用 microsandboxNetwork')
    }
    builder = builder.network(network => network.policy(hardenedPublicOnlyPolicy(NetworkPolicy)).maxConnections(128))
    sandbox = await builder.create()
    const execution = await sandbox.execWith('python', options => options
      .args(['-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir', ...dependencies])
      .cwd('/workspace')
      .timeout(installTimeoutMs))
    if (!execution.success) {
      throw new Error(`Python 依赖安装失败（退出码 ${execution.code}）: ${cutHead(execution.stderr(), 2000)}`)
    }

    await sandbox.stop()
    stopped = true
    const handle = await Sandbox.get(name)
    await handle.snapshot(snapshotName)
    globalThis.logger?.info?.(`[loli] Python 依赖快照已就绪: ${snapshotName}`)
    return snapshotName
  } finally {
    if (sandbox && !stopped) await sandbox.kill().catch(() => {})
    await Sandbox.remove(name).catch(() => {})
  }
}

/** 确保依赖快照存在；同一快照的并发首次调用只构建一次。 */
export async function ensurePythonDependencySnapshot (sdk, cfg) {
  const dependencies = normalizePythonDependencies(cfg?.pythonDependencies)
  const snapshotName = pythonDependencySnapshotName(cfg, dependencies)
  if (!snapshotName) return ''
  const { Sandbox, Snapshot } = sdk || {}
  if (!Sandbox || typeof Snapshot?.open !== 'function') {
    throw new Error('当前 Microsandbox 不支持依赖快照，请升级 Microsandbox')
  }

  if (!dependencySnapshotBuilds.has(snapshotName)) {
    const build = (async () => {
      try {
        await Snapshot.open(snapshotName)
        return snapshotName
      } catch {
        return createPythonDependencySnapshot(sdk, cfg, snapshotName, dependencies)
      }
    })()
    dependencySnapshotBuilds.set(snapshotName, build)
  }
  try {
    return await dependencySnapshotBuilds.get(snapshotName)
  } finally {
    dependencySnapshotBuilds.delete(snapshotName)
  }
}

export async function collectMicrosandboxArtifacts (fs, { maxFiles = 4, maxBytes = 20 * 1024 * 1024 } = {}) {
  let entries
  try {
    entries = await fs.list('/workspace/outputs')
  } catch {
    return []
  }

  const artifacts = []
  for (const entry of entries.filter(item => item?.kind === 'file').slice(0, maxFiles)) {
    if (entry.size > maxBytes) continue
    try {
      const bytes = Buffer.from(await fs.read(entry.path))
      if (bytes.byteLength > maxBytes) continue
      artifacts.push({
        filename: path.basename(entry.path),
        bytes,
        size: bytes.byteLength
      })
    } catch { /* 单个文件失败不影响其余产物 */ }
  }
  return artifacts
}

/**
 * 在一次性 Microsandbox microVM 中执行代码。
 * sdk 参数仅用于测试注入。
 */
export async function executeMicrosandboxCode ({ code, language, cfg, sdk, inputs = [] }) {
  const lang = resolveLanguage(language || cfg.defaultLanguage)
  const runtime = sdk || await import('microsandbox')
  const { Sandbox, MiB, NetworkPolicy } = runtime
  const dependencySnapshot = lang === 'python'
    ? await ensurePythonDependencySnapshot(runtime, cfg)
    : ''
  const name = `loli-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  const memoryMiB = Math.max(128, Number(cfg.microsandboxMemoryMiB) || 512)
  const cpus = Math.max(1, Number(cfg.microsandboxCpus) || 1)
  const timeoutMs = Math.max(1, Number(cfg.requestTimeoutSeconds) || 120) * 1000

  let builder = Sandbox.builder(name)
  builder = dependencySnapshot
    ? builder.fromSnapshot(dependencySnapshot)
    : builder.image(imageFor(cfg, lang)).patch(patch => patch
        .mkdir('/workspace')
        .mkdir('/workspace/inputs')
        .mkdir('/workspace/outputs'))
  builder = builder
    .cpus(cpus)
    .memory(MiB(memoryMiB))
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
    await guestFs.write(`/workspace/${SOURCE_FILES[lang]}`, code)
    for (const input of inputs) {
      await guestFs.write(`/workspace/inputs/${path.basename(input.filename)}`, input.bytes)
    }

    const [command, args] = executionCommand(lang)
    const execution = await sandbox.execWith(command, options => options.args(args).cwd('/workspace').timeout(timeoutMs))
    const stdout = execution.stdout()
    const stderr = execution.stderr()
    const out = {
      stdout: cutHead(stdout),
      stderr: cutHead(stderr),
      result: '',
      truncated: stdout.length > MAX_OUTPUT || stderr.length > MAX_OUTPUT
    }
    if (!execution.success) {
      out.error = {
        name: 'ProcessExitError',
        value: `进程退出码 ${execution.code}`,
        traceback: cutHead(stderr)
      }
    }
    out.artifacts = await collectMicrosandboxArtifacts(guestFs)
    return out
  } finally {
    if (sandbox) {
      await sandbox.kill().catch(() => {})
      await Sandbox.remove(name).catch(() => {})
    }
  }
}
