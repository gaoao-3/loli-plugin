/**
 * Microsoft Quicksand 代码沙盒后端。
 *
 * Quicksand 的 Python SDK 运行在独立纯英文目录中；Node 通过一次性 JSON
 * Bridge 传入代码和文件。microVM 仍然每次新建、每次销毁。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { MAX_OUTPUT } from './sandbox.js'

const BRIDGE_PATH = fileURLToPath(new URL('./quicksand-bridge.py', import.meta.url))
const DEFAULT_PYTHON = 'D:\\quicksand-runtime\\.venv\\Scripts\\python.exe'
const MAX_BRIDGE_OUTPUT_BYTES = 128 * 1024 * 1024

export function toWellFormedText (value) {
  const text = String(value ?? '')
  let result = ''
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index)
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = text.charCodeAt(index + 1)
      if (next >= 0xDC00 && next <= 0xDFFF) {
        result += text[index] + text[index + 1]
        index++
      } else {
        result += '\uFFFD'
      }
    } else if (unit >= 0xDC00 && unit <= 0xDFFF) {
      result += '\uFFFD'
    } else {
      result += text[index]
    }
  }
  return result
}

function childEnvironment () {
  const env = { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }
  for (const key of ['ALL_PROXY', 'all_proxy', 'HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy']) {
    delete env[key]
  }
  return env
}

export function buildQuicksandRequest ({ code, language = 'python', networkMode = 'none', cfg, inputs = [], artifactDir = '' }) {
  const normalizedLanguage = String(language || 'python').toLowerCase()
  const defaultImages = {
    python: 'loli-python-media',
    javascript: 'loli-code',
    bash: 'loli-python-media'
  }
  const configuredImage = cfg?.quicksandImages?.[normalizedLanguage] ||
    (normalizedLanguage === 'python' ? cfg?.quicksandImage : '')
  return {
    code: toWellFormedText(code),
    language: normalizedLanguage,
    network_mode: networkMode === 'full' ? 'full' : 'none',
    image: toWellFormedText(configuredImage || defaultImages[normalizedLanguage] || ''),
    workspace: toWellFormedText(cfg?.quicksandWorkspace || 'D:\\quicksand-runtime\\workspace'),
    memory_mib: Math.max(128, Number(cfg?.quicksandMemoryMiB) || 512),
    cpus: Math.max(1, Number(cfg?.quicksandCpus) || 1),
    timeout_seconds: networkMode === 'full'
      ? Math.max(1, Math.min(
          Number(cfg?.requestTimeoutSeconds) || 120,
          Number(cfg?.fullNetworkTimeoutSeconds) || 60
        ))
      : Math.max(1, Number(cfg?.requestTimeoutSeconds) || 120),
    max_output_chars: MAX_OUTPUT,
    max_artifacts: 4,
    max_artifact_bytes: Math.max(1, Math.min(512, Number(cfg?.artifactMaxBytesMiB) || 200)) * 1024 * 1024,
    artifact_dir: toWellFormedText(artifactDir),
    inputs: inputs.map(input => ({
      filename: path.basename(toWellFormedText(input.filename)),
      data: Buffer.from(input.bytes || []).toString('base64')
    }))
  }
}

function runBridge (python, request, { spawnImpl = spawn } = {}) {
  const timeoutMs = (Math.max(
    Number(request.timeout_seconds) || 120,
    Number(request.sandbox_timeout_seconds) || 300
  ) + 30) * 1000

  return new Promise((resolve, reject) => {
    const child = spawnImpl(python, [BRIDGE_PATH], {
      cwd: path.dirname(BRIDGE_PATH),
      env: childEnvironment(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const stdout = []
    const stderr = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false

    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(reject, new Error(`Quicksand Bridge 超时（${Math.round(timeoutMs / 1000)} 秒）`))
    }, timeoutMs)

    child.on('error', error => finish(reject, new Error(`无法启动 Quicksand Python: ${error.message}`)))
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_BRIDGE_OUTPUT_BYTES) {
        child.kill()
        finish(reject, new Error('Quicksand Bridge 返回数据超过 128 MiB'))
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length
      if (stderrBytes <= 1024 * 1024) stderr.push(chunk)
    })
    child.on('close', code => {
      if (settled) return
      let payload
      try {
        payload = JSON.parse(Buffer.concat(stdout).toString('utf8'))
      } catch {
        const detail = Buffer.concat(stderr).toString('utf8').trim()
        finish(reject, new Error(`Quicksand Bridge 返回无效 JSON（退出码 ${code}）${detail ? `: ${detail}` : ''}`))
        return
      }
      if (!payload?.ok) {
        finish(reject, new Error(payload?.error || `Quicksand Bridge 失败（退出码 ${code}）`))
        return
      }
      finish(resolve, payload.result)
    })

    child.stdin.on('error', error => finish(reject, error))
    child.stdin.end(JSON.stringify(request))
  })
}

export async function executeQuicksandCode ({ code, language, networkMode = 'none', cfg, inputs = [], spawnImpl }) {
  const normalizedLanguage = String(language || 'python').toLowerCase()
  if (!['python', 'javascript', 'bash'].includes(normalizedLanguage)) {
    throw new Error(`Quicksand 暂不支持语言 "${language}"`)
  }
  const python = String(cfg?.quicksandPython || DEFAULT_PYTHON).trim()
  if (!python) throw new Error('未配置 quicksandPython')
  const artifactBase = String(cfg?.quicksandArtifactDir || '').trim() || path.join(os.tmpdir(), 'loli-quicksand-artifacts')
  fs.mkdirSync(artifactBase, { recursive: true })
  const artifactDir = fs.mkdtempSync(path.join(artifactBase, 'run-'))
  let result
  try {
    result = await runBridge(python, {
      ...buildQuicksandRequest({ code, language: normalizedLanguage, networkMode, cfg, inputs, artifactDir }),
      sandbox_timeout_seconds: Math.max(1, Number(cfg?.sandboxTimeoutSeconds) || 300)
    }, { spawnImpl })
  } catch (error) {
    fs.rmSync(artifactDir, { recursive: true, force: true })
    throw error
  }
  result.artifacts = (result.artifacts || []).map(item => ({
    filename: path.basename(String(item.filename || 'artifact.bin')),
    size: Number(item.size) || 0,
    ...(item.path
      ? { localPath: path.resolve(String(item.path)) }
      : { bytes: Buffer.from(String(item.data || ''), 'base64') })
  }))
  if (result.artifacts.length === 0) fs.rmSync(artifactDir, { recursive: true, force: true })
  return result
}
