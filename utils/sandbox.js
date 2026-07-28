/**
 * 代码沙盒公共入口 — Microsandbox microVM 后端。
 */

import os from 'node:os'

/** 支持的语言 */
export const LANGUAGES = ['python', 'javascript', 'typescript', 'java', 'go', 'bash']

/** 单路输出最大字符数 */
export const MAX_OUTPUT = 4096

function currentHostCidrs () {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(address => address && !address.internal && address.address)
    .map(address => {
      const isV6 = address.family === 'IPv6' || address.family === 6
      return `${address.address}/${isV6 ? 128 : 32}`
    })
}

/**
 * 生成加固的仅公网策略：保留 SDK 的 DNS 规则与公网放行规则，
 * 并在公网规则前显式拒绝宿主当前所有网卡地址。
 */
export function hardenedPublicOnlyPolicy (NetworkPolicy, hostCidrs = currentHostCidrs()) {
  if (typeof NetworkPolicy?.publicOnly !== 'function') {
    throw new Error('当前 Microsandbox 不支持仅公网网络策略，已拒绝启动联网沙盒')
  }
  const policy = NetworkPolicy.publicOnly()
  const rules = Array.isArray(policy?.rules) ? policy.rules : []
  const dnsRules = rules.filter(rule =>
    rule?.action === 'allow' &&
    Array.isArray(rule.ports) &&
    rule.ports.some(port => Number(port?.start) === 53 && Number(port?.end) === 53)
  )
  const otherRules = rules.filter(rule => !dnsRules.includes(rule))
  const denyRules = [...new Set(hostCidrs)].map(cidr => ({
    direction: 'egress',
    destination: { kind: 'cidr', cidr },
    protocols: [],
    ports: [],
    action: 'deny'
  }))
  return {
    ...policy,
    defaultEgress: 'deny',
    rules: [...dnsRules, ...denyRules, ...otherRules]
  }
}

/** 语言名规范化与校验 */
export function resolveLanguage (name) {
  const lang = String(name || '').trim().toLowerCase()
  if (!LANGUAGES.includes(lang)) {
    throw new Error(`不支持的语言 "${name}"，支持: ${LANGUAGES.join(', ')}`)
  }
  return lang
}

/**
 * 在一次性 Microsandbox microVM 中执行代码。
 */
export async function executeCode (options) {
  const { executeMicrosandboxCode } = await import('./sandbox-microsandbox.js')
  return executeMicrosandboxCode(options)
}
