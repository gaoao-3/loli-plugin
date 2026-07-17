import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import {
  ANTIGRAVITY_GEMINI_BASE_URL,
  ANTIGRAVITY_OPENAI_BASE_URL,
  buildModelListRequest,
  discoverModels,
  parseModelListResponse
} from '../server/model-discovery.js'
import channelRoutes, { normalizeChannelPayload } from '../server/api/channels.js'

test('Antigravity 新渠道默认使用 Gemini 原生协议', () => {
  const channel = normalizeChannelPayload({
    id: 'antigravity',
    adapterType: 'antigravity',
    options: { apiKey: 'secret', baseUrl: ANTIGRAVITY_GEMINI_BASE_URL }
  })
  assert.equal(channel.adapterType, 'gemini')
  assert.equal(channel.options.providerType, 'antigravity')
  assert.equal(channel.options.protocol, 'gemini')
  assert.equal(channel.options.baseUrl, 'http://127.0.0.1:8045')
})

test('旧版 Antigravity 渠道保持 OpenAI 协议并可切换为 Gemini', () => {
  const existing = {
    id: 'antigravity',
    adapterType: 'openai',
    options: { providerType: 'antigravity', baseUrl: ANTIGRAVITY_OPENAI_BASE_URL }
  }
  const unchanged = normalizeChannelPayload({ status: 'disabled' }, existing)
  assert.equal(unchanged.adapterType, 'openai')
  assert.equal(unchanged.options.protocol, 'openai')

  const switched = normalizeChannelPayload({
    adapterType: 'antigravity',
    options: { protocol: 'gemini', baseUrl: ANTIGRAVITY_GEMINI_BASE_URL }
  }, existing)
  assert.equal(switched.adapterType, 'gemini')
  assert.equal(switched.options.protocol, 'gemini')
})

test('Antigravity 模型请求使用 /v1/models 和 Bearer 鉴权', () => {
  const request = buildModelListRequest({
    adapterType: 'antigravity',
    protocol: 'openai',
    baseUrl: 'http://127.0.0.1:8045',
    apiKey: 'test-key'
  })
  assert.equal(request.url, 'http://127.0.0.1:8045/v1/models')
  assert.equal(request.headers.Authorization, 'Bearer test-key')
  assert.equal(request.adapterType, 'openai')
})

test('Antigravity Gemini 协议使用 /v1beta/models 和 x-goog-api-key', () => {
  const request = buildModelListRequest({
    adapterType: 'antigravity',
    protocol: 'gemini',
    baseUrl: ANTIGRAVITY_OPENAI_BASE_URL,
    apiKey: 'test-key'
  })
  assert.equal(request.url, 'http://127.0.0.1:8045/v1beta/models')
  assert.equal(request.headers['x-goog-api-key'], 'test-key')
  assert.equal(request.headers.Authorization, undefined)
  assert.equal(request.adapterType, 'gemini')
})

test('模型响应解析会过滤 Gemini 非生成模型并去重', () => {
  assert.deepEqual(parseModelListResponse({
    data: [{ id: 'claude-sonnet-4-6' }, { id: 'claude-sonnet-4-6' }, { id: 'gemini-3-flash' }]
  }, 'openai'), ['claude-sonnet-4-6', 'gemini-3-flash'])

  assert.deepEqual(parseModelListResponse({
    models: [
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }
    ]
  }, 'gemini'), ['gemini-2.5-flash'])
})

test('模型发现返回模型 ID 且不把密钥放入 URL', async () => {
  let captured
  const models = await discoverModels({
    adapterType: 'antigravity',
    protocol: 'openai',
    apiKey: 'test-key'
  }, async (url, options) => {
    captured = { url, options }
    return new Response(JSON.stringify({ data: [{ id: 'gemini-3.1-pro-high' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  })
  assert.deepEqual(models, ['gemini-3.1-pro-high'])
  assert.equal(captured.url.includes('test-key'), false)
  assert.equal(captured.options.headers.Authorization, 'Bearer test-key')
})

test('渠道 API 可通过服务端代理获取模型列表', async () => {
  const originalFetch = globalThis.fetch
  const app = express()
  app.use(express.json())
  app.use('/channels', channelRoutes({}))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()

  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      data: [{ id: 'claude-sonnet-4-6' }, { id: 'gemini-3.1-pro-high' }]
    }), { status: 200, headers: { 'content-type': 'application/json' } })
    const response = await originalFetch(`http://127.0.0.1:${port}/channels/models/discover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adapterType: 'antigravity', options: { apiKey: 'test-key', protocol: 'openai' } })
    })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).models, ['claude-sonnet-4-6', 'gemini-3.1-pro-high'])
  } finally {
    globalThis.fetch = originalFetch
    await new Promise(resolve => server.close(resolve))
  }
})
