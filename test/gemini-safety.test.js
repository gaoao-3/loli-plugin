import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEngine } from 'lolicon-core'
import {
  normalizeGeminiSafetyLevel,
  resolveGeminiSafetySettings
} from 'lolicon-core/clients/gemini'
import { normalizeChannelPayload } from '../server/api/channels.js'

test('Gemini 安全等级映射为四类官方 safetySettings', () => {
  assert.equal(resolveGeminiSafetySettings('default'), undefined)
  assert.equal(resolveGeminiSafetySettings('invalid'), undefined)
  const balanced = resolveGeminiSafetySettings('balanced')
  assert.equal(balanced.length, 4)
  assert.ok(balanced.every(item => item.threshold === 'BLOCK_MEDIUM_AND_ABOVE'))
  assert.deepEqual(resolveGeminiSafetySettings('off').map(item => item.threshold), Array(4).fill('OFF'))
  assert.equal(normalizeGeminiSafetyLevel('STRICT'), 'strict')
})

test('渠道保存兼容旧扁平字段并保留既有 options', () => {
  const channel = normalizeChannelPayload({
    id: 'gemini', adapterType: 'gemini', apiKey: 'new-key', safetyLevel: 'strict'
  }, {
    id: 'gemini', options: { apiKey: 'old-key', baseUrl: 'https://example.test', logApiResponses: true }
  })
  assert.equal(channel.options.apiKey, 'new-key')
  assert.equal(channel.options.baseUrl, 'https://example.test')
  assert.equal(channel.options.logApiResponses, true)
  assert.equal(channel.options.safetyLevel, 'strict')
  assert.equal(channel.apiKey, undefined)

  const cleared = normalizeChannelPayload({ options: { baseUrl: '' } }, channel)
  assert.equal(cleared.options.baseUrl, '')
})

test('渠道热更新后重建 Gemini 客户端并立即使用新安全等级', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loli-gemini-safety-'))
  const engine = new createEngine({ dataDir })
  try {
    await engine.init()
    await engine.saveChannel({
      id: 'gemini', name: 'Gemini', adapterType: 'gemini', models: [],
      options: { apiKey: 'test-key', safetyLevel: 'balanced' }, status: 'enabled'
    })
    const before = await engine.getClient('gemini')
    assert.equal(before.options.safetyLevel, 'balanced')
    await engine.saveChannel({
      id: 'gemini', name: 'Gemini', adapterType: 'gemini', models: [],
      options: { apiKey: 'test-key', safetyLevel: 'strict' }, status: 'enabled'
    })
    const after = await engine.getClient('gemini')
    assert.notEqual(after, before)
    assert.equal(after.options.safetyLevel, 'strict')
  } finally {
    await engine.destroy()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
