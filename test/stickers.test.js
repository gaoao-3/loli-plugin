import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {
  autoCollectMasterStickers,
  buildStickerDirectivePrompt,
  closeStickerStores,
  collectableStickerSegments,
  deleteSticker,
  extractStickerDirective,
  findSticker,
  getInlineFacePayload,
  getQuotedMessage,
  getSticker,
  injectInlineStickerPayload,
  listStickers,
  saveSticker,
  sendSticker,
  shouldAutoSendSticker,
  setStickerEnabled
} from '../utils/stickers.js'
import { classifySticker, __test as classifierTest } from '../utils/sticker-classifier.js'

function makeDb () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loli-stickers-'))
  return { dir, file: path.join(dir, 'stickers.sqlite') }
}

test('可识别小黄脸、超级表情、收藏表情和图片表情', () => {
  const stickers = collectableStickerSegments([
    { type: 'face', id: 14, big: false, text: '微笑' },
    { type: 'face', id: 483, big: true, text: '略', stickerId: '100483', stickerType: 1 },
    { type: 'bface', file: 'a'.repeat(64) + '123', text: '无语' },
    { type: 'image', file: 'https://example.test/a.gif', asface: true, summary: '动画表情' },
    { type: 'text', text: '忽略文本' }
  ])
  assert.deepEqual(stickers.map(item => item.kind), ['face', 'superface', 'favorite', 'image'])
  assert.deepEqual(stickers[1].payload, {
    type: 'face', id: 483, big: true, stickerId: '100483', stickerType: 1, text: '略'
  })
})

test('发送层提取隐藏表情标记且正文中不残留控制文本', () => {
  const ending = extractStickerDirective('好麻烦……怎么又是这个。[sticker:无语]')
  assert.equal(ending.text, '好麻烦……怎么又是这个。')
  assert.equal(ending.emotion, '无语')
  assert.match(ending.positionedText, /。.$/u)

  const beginning = extractStickerDirective('[表情：嫌弃]\n别闹了。[sticker:开心]')
  assert.equal(beginning.text, '别闹了。')
  assert.equal(beginning.emotion, '嫌弃')
  assert.equal(beginning.positionedText.at(0), '\uE000')

  const nested = extractStickerDirective('这下精准定位了？[sticker:[动画表情]]')
  assert.equal(nested.text, '这下精准定位了？')
  assert.equal(nested.emotion, '[动画表情]')
})

test('只有表情库存在可用内容时才向模型注入真实标签', () => {
  const tmp = makeDb()
  try {
    assert.equal(buildStickerDirectivePrompt({ stickers: { enable: true } }, tmp.file), '')
    saveSticker({
      segment: { type: 'image', file: 'https://example.test/generic.gif', asface: true, summary: '[动画表情]' },
      tags: ['自动收录']
    }, tmp.file)
    assert.equal(buildStickerDirectivePrompt({ stickers: { enable: true } }, tmp.file), '')
    saveSticker({ segment: { type: 'face', id: 14, text: '微笑' }, tags: ['开心'] }, tmp.file)
    const prompt = buildStickerDirectivePrompt({ stickers: { enable: true } }, tmp.file)
    assert.match(prompt, /\[sticker:标签\]/)
    assert.match(prompt, /开心/)
    assert.doesNotMatch(prompt, /自动收录|\[动画表情\]/)
    assert.equal(buildStickerDirectivePrompt({ stickers: { enable: false } }, tmp.file), '')
  } finally {
    closeStickerStores()
    fs.rmSync(tmp.dir, { recursive: true, force: true })
  }
})

test('视觉模型返回的情绪、动作和场景会合并进表情标签', async () => {
  const tmp = makeDb()
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' })
    res.end(png)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const url = `http://127.0.0.1:${server.address().port}/sticker.png`
    const sticker = saveSticker({
      segment: { type: 'image', file: 'sticker-file', url, asface: true, summary: '[动画表情]' },
      tags: ['自动收录']
    }, tmp.file)
    sticker.sourceSegment = { type: 'image', url, asface: true }
    let request
    const engine = {
      sendMessage: async value => {
        request = value
        return { finalText: '{"emotions":["无语"],"actions":["摊手"],"scenes":["吐槽"],"description":"角色无奈地摊手"}' }
      }
    }
    const updated = await classifySticker({
      engine,
      config: { loli: { defaultPreset: 'hina', imageCompress: { enable: false } }, chaite: { presets: [{ id: 'hina', channelId: 'gemini', sendMessageOption: { model: 'vision-model' } }] } },
      sticker,
      dbFile: tmp.file
    })
    assert.equal(request.channelId, 'gemini')
    assert.equal(request.overrideOptions.maxTokens, 1024)
    assert.equal(request.overrideOptions.disableTools, true)
    assert.equal(request.overrideOptions.responseMimeType, 'application/json')
    assert.equal(request.overrideOptions.responseJsonSchema.required.length, 4)
    assert.equal(request.userMessage.content[0].type, 'image')
    assert.deepEqual(new Set(updated.tags), new Set(['自动收录', '[动画表情]', '无语', '摊手', '吐槽']))
    assert.equal(updated.description, '角色无奈地摊手')
    assert.equal(fs.existsSync(updated.payload.file), true)
    assert.match(updated.payload.file, /sticker-assets[\\/]\d+\.png$/u)
  } finally {
    await new Promise(resolve => server.close(resolve))
    closeStickerStores()
    fs.rmSync(tmp.dir, { recursive: true, force: true })
  }
})

test('分类 JSON 截断时自动重试，并优先使用记忆精炼模型', async () => {
  const tmp = makeDb()
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' })
    res.end(png)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const url = `http://127.0.0.1:${server.address().port}/sticker.png`
    const sticker = saveSticker({ segment: { type: 'image', file: 'retry-file', url, asface: true, summary: '[动画表情]' } }, tmp.file)
    sticker.sourceSegment = { type: 'image', url, asface: true }
    const requests = []
    const engine = {
      sendMessage: async request => {
        requests.push(request)
        return requests.length === 1
          ? { finalText: '```json\n{"emotions"' }
          : { finalText: '{"emotions":["嫌弃"],"actions":["摇头"],"scenes":["拒绝"],"description":"嫌弃地摇头"}' }
      }
    }
    const updated = await classifySticker({
      engine,
      config: {
        loli: { defaultPreset: 'hina', imageCompress: { enable: false } },
        memory: { refinementChannelId: 'memory-channel', refinementModel: 'memory-vision-model' },
        chaite: { presets: [{ id: 'hina', channelId: 'chat-channel', sendMessageOption: { model: 'thinking-chat-model' } }] }
      },
      sticker,
      dbFile: tmp.file
    })
    assert.equal(requests.length, 2)
    assert.equal(requests[0].channelId, 'memory-channel')
    assert.equal(requests[0].overrideOptions.model, 'memory-vision-model')
    assert.ok(updated.tags.includes('嫌弃'))
  } finally {
    await new Promise(resolve => server.close(resolve))
    closeStickerStores()
    fs.rmSync(tmp.dir, { recursive: true, force: true })
  }
})

test('视觉标签解析兼容 JSON 代码块', () => {
  assert.deepEqual(classifierTest.parseClassification('```json\n{"emotions":["开心"],"actions":"挥手","scenes":["打招呼"],"description":"开心挥手"}\n```'), {
    emotions: ['开心'], actions: ['挥手'], scenes: ['打招呼'], description: '开心挥手'
  })
})

test('ICQQ 图片段没有 URL 时通过群对象 getPicUrl 获取下载地址', async () => {
  const source = { type: 'image', file: 'image-param', md5: 'abc', asface: true }
  let received
  const url = await classifierTest.resolveStickerSourceUrl({ sourceSegment: source, payload: {} }, {
    group: {
      getPicUrl: async segment => {
        received = segment
        return 'https://gchat.qpic.cn/example'
      }
    }
  })
  assert.equal(received, source)
  assert.equal(url, 'https://gchat.qpic.cn/example')
})

test('收录指令可读取被回复消息中的原始表情段', async () => {
  const message = [{ type: 'bface', file: 'a'.repeat(64) + '123', text: '无语' }]
  assert.deepEqual(await getQuotedMessage({
    source: { seq: 12 },
    getReply: async () => ({ message })
  }), message)
  assert.deepEqual(await getQuotedMessage({
    message_type: 'group',
    group_id: '100',
    source: { seq: 12 },
    group: { getChatHistory: async () => [{ message }] }
  }), message)
})

test('表情库按内容去重、合并标签并支持检索和停用', () => {
  const tmp = makeDb()
  try {
    const first = saveSticker({ segment: { type: 'bface', file: 'f'.repeat(64) + '123', text: '无语' }, tags: ['嫌弃'] }, tmp.file)
    const second = saveSticker({ segment: { type: 'bface', file: 'f'.repeat(64) + '123', text: '无语' }, tags: ['好麻烦'] }, tmp.file)
    assert.equal(first.id, second.id)
    assert.equal(second.created, false)
    assert.deepEqual(new Set(second.tags), new Set(['嫌弃', '无语', '好麻烦']))
    assert.equal(findSticker({ emotion: '好麻烦' }, tmp.file, () => 0).id, first.id)
    assert.equal(findSticker({ emotion: 'doge' }, tmp.file, () => 0), null)
    assert.equal(findSticker({ emotion: '自动收录' }, tmp.file, () => 0), null)
    assert.equal(setStickerEnabled(first.id, false, tmp.file), true)
    assert.equal(findSticker({ emotion: '无语' }, tmp.file, () => 0), null)
    assert.equal(deleteSticker(first.id, tmp.file), true)
    assert.equal(listStickers({}, tmp.file).length, 0)
  } finally {
    closeStickerStores()
    fs.rmSync(tmp.dir, { recursive: true, force: true })
  }
})

test('自动发送概率可关闭、限制并完整开启', () => {
  assert.equal(shouldAutoSendSticker({ stickers: { probability: 0 } }, () => 0), false)
  assert.equal(shouldAutoSendSticker({ stickers: { probability: 0.35 } }, () => 0.34), true)
  assert.equal(shouldAutoSendSticker({ stickers: { probability: 0.35 } }, () => 0.35), false)
  assert.equal(shouldAutoSendSticker({ stickers: { probability: 1 } }, () => 0.999), true)
})

test('只自动收录主人直接发送的表情', () => {
  const tmp = makeDb()
  try {
    const config = { stickers: { enable: true, autoCollectMaster: true } }
    const ordinary = autoCollectMasterStickers({ isMaster: false, message: [{ type: 'face', id: 1 }] }, config, tmp.file)
    assert.equal(ordinary.length, 0)
    const saved = autoCollectMasterStickers({
      isMaster: true,
      user_id: '10001',
      message_id: 'm1',
      message: [{ type: 'face', id: 14, text: '微笑' }]
    }, config, tmp.file)
    assert.equal(saved.length, 1)
    assert.equal(getSticker(saved[0].id, tmp.file).kind, 'face')
  } finally {
    closeStickerStores()
    fs.rmSync(tmp.dir, { recursive: true, force: true })
  }
})

test('发送已存表情后更新使用次数', async () => {
  const tmp = makeDb()
  try {
    const sticker = saveSticker({ segment: { type: 'face', id: 14, text: '微笑' }, tags: ['开心'] }, tmp.file)
    let sent
    let quoted
    await sendSticker({ reply: async (value, quote) => { sent = value; quoted = quote } }, sticker, tmp.file)
    assert.equal(sent[0].type, 'face')
    assert.equal(sent[0].id, 14)
    assert.equal(quoted, false)
    assert.equal(getSticker(sticker.id, tmp.file).useCount, 1)
  } finally {
    closeStickerStores()
    fs.rmSync(tmp.dir, { recursive: true, force: true })
  }
})

test('普通 QQ 小黄脸可拼进正文消息，超级表情和图片表情保持独立发送', () => {
  const face = {
    kind: 'face',
    payload: { type: 'face', id: 14, big: false }
  }
  const superface = {
    kind: 'superface',
    payload: { type: 'face', id: 483, big: true, stickerId: '100483' }
  }
  const image = {
    kind: 'image',
    payload: { type: 'image', file: 'https://example.test/a.gif', asface: true }
  }

  const payload = getInlineFacePayload(face)
  const directive = extractStickerDirective('前半句[sticker:微笑]后半句')
  assert.deepEqual(injectInlineStickerPayload(directive.positionedText, payload), [
    '前半句',
    { type: 'face', id: 14, big: false },
    '后半句'
  ])
  assert.equal(getInlineFacePayload(superface), null)
  assert.equal(getInlineFacePayload(image), null)
})

test('重发收到的图片表情时不会把 QQ 文件参数当作本地文件上传', async () => {
  const tmp = makeDb()
  try {
    const url = 'https://multimedia.nt.qq.com.cn/download?fileid=test'
    const sticker = saveSticker({
      segment: { type: 'image', file: 'qq-image-param-300-300.jpg', url, asface: true, summary: '[动画表情]' }
    }, tmp.file)
    let sent
    await sendSticker({ reply: async value => { sent = value[0] } }, sticker, tmp.file)
    assert.deepEqual(sent, { type: 'image', file: url, asface: true })
  } finally {
    closeStickerStores()
    fs.rmSync(tmp.dir, { recursive: true, force: true })
  }
})

test('图片表情主发送和回退都失败后自动停用，避免持续超时', async () => {
  const tmp = makeDb()
  try {
    const sticker = saveSticker({
      segment: { type: 'image', file: 'expired-param.jpg', url: 'https://example.test/expired.jpg', asface: true, summary: '[动画表情]' }
    }, tmp.file)
    await assert.rejects(() => sendSticker({ reply: async () => { throw new Error('packet timeout') } }, sticker, tmp.file), /packet timeout/)
    assert.equal(getSticker(sticker.id, tmp.file).enabled, false)
  } finally {
    closeStickerStores()
    fs.rmSync(tmp.dir, { recursive: true, force: true })
  }
})

test('超级表情发送失败时退化为普通 QQ 表情', async () => {
  const tmp = makeDb()
  try {
    const sticker = saveSticker({ segment: { type: 'face', id: 66, big: true, text: '爱心' } }, tmp.file)
    const sent = []
    await sendSticker({
      reply: async value => {
        sent.push(value[0])
        if (sent.length === 1) throw new Error('客户端不支持超级表情')
      }
    }, sticker, tmp.file, { nativeSuperface: true })
    assert.equal(sent.length, 2)
    assert.equal(sent[0].big, true)
    assert.equal(sent[1].big, false)
    assert.equal(getSticker(sticker.id, tmp.file).useCount, 1)
  } finally {
    closeStickerStores()
    fs.rmSync(tmp.dir, { recursive: true, force: true })
  }
})

test('超级表情保留 ICQQ sticker 元数据并原位补全旧记录', async () => {
  const tmp = makeDb()
  try {
    const old = saveSticker({ segment: { type: 'face', id: 483, big: true, text: '略' } }, tmp.file)
    const updated = saveSticker({
      segment: { type: 'face', id: 483, big: true, text: '略', stickerId: '100483', stickerType: 1 }
    }, tmp.file)
    assert.equal(updated.id, old.id)
    assert.equal(updated.created, false)
    assert.equal(updated.payload.stickerId, '100483')
    assert.equal(updated.payload.stickerType, 1)

    let sent
    await sendSticker({ reply: async value => { sent = value[0] } }, updated, tmp.file, { nativeSuperface: true })
    assert.deepEqual(sent, {
      type: 'face', id: 483, big: true, stickerId: '100483', stickerType: 1, text: '略'
    })
  } finally {
    closeStickerStores()
    fs.rmSync(tmp.dir, { recursive: true, force: true })
  }
})

test('缺少 stickerId 的旧超级表情不会提供给模型或自动匹配', () => {
  const tmp = makeDb()
  try {
    saveSticker({ segment: { type: 'face', id: 483, big: true, text: '略' }, tags: ['略'] }, tmp.file)
    const ready = saveSticker({
      segment: { type: 'face', id: 476, big: true, text: '不是吧', stickerId: '78', stickerType: 1 },
      tags: ['不是吧']
    }, tmp.file)
    const prompt = buildStickerDirectivePrompt({ stickers: { enable: true } }, tmp.file)
    assert.doesNotMatch(prompt, /(?:^|、)略(?:、|。)/u)
    assert.match(prompt, /不是吧/u)
    assert.equal(findSticker({ emotion: '略' }, tmp.file, () => 0), null)
    assert.equal(findSticker({ emotion: '不是吧' }, tmp.file, () => 0).id, ready.id)
  } finally {
    closeStickerStores()
    fs.rmSync(tmp.dir, { recursive: true, force: true })
  }
})

test('ICQQ 默认把原生超级表情降级为可见的普通 QQ 表情', async () => {
  const tmp = makeDb()
  try {
    const sticker = saveSticker({
      segment: { type: 'face', id: 480, big: true, text: '散味儿', stickerId: '82', stickerType: 1 }
    }, tmp.file)
    let sent
    await sendSticker({ reply: async value => { sent = value[0] } }, sticker, tmp.file)
    assert.deepEqual(sent, { type: 'face', id: 480, big: false })
    assert.equal(getSticker(sticker.id, tmp.file).useCount, 1)
  } finally {
    closeStickerStores()
    fs.rmSync(tmp.dir, { recursive: true, force: true })
  }
})

test('Miao-Yunzai 环境优先使用未吞异常的原始回复函数', async () => {
  const tmp = makeDb()
  try {
    const sticker = saveSticker({ segment: { type: 'face', id: 66, big: true, text: '爱心' } }, tmp.file)
    const sent = []
    await sendSticker({
      reply: async () => assert.fail('不应使用会吞掉异常的包装回复函数'),
      replyNew: async (value, quote) => {
        sent.push({ payload: value[0], quote })
        if (sent.length === 1) throw new Error('客户端不支持超级表情')
        return { message_id: 'ok' }
      }
    }, sticker, tmp.file, { nativeSuperface: true })
    assert.equal(sent.length, 2)
    assert.equal(sent[0].payload.big, true)
    assert.equal(sent[1].payload.big, false)
    assert.equal(sent[1].quote, false)
    assert.equal(getSticker(sticker.id, tmp.file).useCount, 1)
  } finally {
    closeStickerStores()
    fs.rmSync(tmp.dir, { recursive: true, force: true })
  }
})
