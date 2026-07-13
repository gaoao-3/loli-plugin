import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSegmentedReplyConfig, sendReplyChunks, splitReplyText } from '../utils/reply.js'

test('keeps short replies and disabled segmentation in one message', () => {
  assert.deepEqual(splitReplyText(' 简短回复。 ', { maxLength: 20 }), ['简短回复。'])
  assert.deepEqual(splitReplyText('第一句。第二句。', {
    enable: false,
    maxLength: 4
  }), ['第一句。第二句。'])
  assert.deepEqual(splitReplyText('   ', {}), [])
  assert.deepEqual(splitReplyText('配置为空也正常。', null), ['配置为空也正常。'])
})

test('keeps a short multi-sentence reply together when the model did not add line breaks', () => {
  assert.deepEqual(splitReplyText('今天有点困。不过事情已经做好了！放心吧。', {
    minLength: 4,
    maxLength: 80,
    maxSegments: 5
  }), ['今天有点困。不过事情已经做好了！放心吧。'])
})

test('cleans model line breaks without treating them as message boundaries', () => {
  const text = '第一句话已经说完整了。第二句话也有足够的内容！\n第三句话作为最后一段。'
  const chunks = splitReplyText(text, {
    minLength: 4,
    maxLength: 80,
    maxSegments: 5
  })

  assert.deepEqual(chunks, ['第一句话已经说完整了。第二句话也有足够的内容！第三句话作为最后一段。'])
  assert.ok(chunks.every(chunk => !chunk.includes('\n')))
})

test('uses the AI marker as the explicit message boundary', () => {
  assert.deepEqual(splitReplyText('第一行\n第二行\n第三行', {
    minLength: 10,
    maxLength: 48,
    maxSegments: 5
  }), ['第一行第二行第三行'])

  assert.deepEqual(splitReplyText('嗯，让我看看。 <|split|> 找到了，是配置的问题。\n改这里就好。 <|split|> 已经处理完了。', {
    minLength: 10,
    maxLength: 48,
    maxSegments: 5
  }), ['嗯，让我看看。', '找到了，是配置的问题。改这里就好。', '已经处理完了。'])
})

test('normalizes literal escaped newlines and blank lines from model output', () => {
  const actual = splitReplyText('第一段\\n\\n第二段\r\n\r\n第三段', {
    minLength: 1,
    maxLength: 80,
    maxSegments: 5
  })

  assert.deepEqual(actual, ['第一段第二段第三段'])
  assert.ok(actual.every(chunk => !/[\r\n]|\\[rn]/.test(chunk)))
})

test('removes an unexpected marker when segmented replies are disabled', () => {
  assert.deepEqual(splitReplyText('第一段<|split|>第二段', {
    enable: false
  }), ['第一段 第二段'])
})

test('does not split URLs, decimal numbers, at markers, or emoji graphemes', () => {
  const text = '版本是 3.14，请查看 https://example.com/search?q=1.2&lang=zh 然后告诉 [at:Alice] 结果🙂。'
  const chunks = splitReplyText(text, {
    minLength: 1,
    maxLength: 12,
    maxSegments: 10
  })

  assert.equal(chunks.join('').replace(/\s+/g, ''), text.replace(/\s+/g, ''))
  assert.ok(chunks.some(chunk => chunk.includes('3.14')))
  assert.ok(chunks.some(chunk => chunk.includes('https://example.com/search?q=1.2&lang=zh')))
  assert.ok(chunks.some(chunk => chunk.includes('[at:Alice]')))
  assert.equal(chunks.filter(chunk => chunk.includes('🙂')).length, 1)
  assert.ok(chunks.every(chunk => !/^\d+$/.test(chunk)))
})

test('keeps repeated punctuation together and handles English sentence dots', () => {
  assert.deepEqual(splitReplyText('真的？！你确定吗？好吧！', {
    minLength: 1,
    maxLength: 80,
    maxSegments: 5
  }), ['真的？！你确定吗？好吧！'])

  assert.deepEqual(splitReplyText('Done. Next sentence. End.', {
    minLength: 1,
    maxLength: 80,
    maxSegments: 5
  }), ['Done. Next sentence. End.'])

  assert.deepEqual(splitReplyText('“做好了。”然后休息吧。', {
    minLength: 1,
    maxLength: 80,
    maxSegments: 5
  }), ['“做好了。”然后休息吧。'])

  assert.deepEqual(splitReplyText('He said "done." Then left.', {
    minLength: 1,
    maxLength: 80,
    maxSegments: 5
  }), ['He said "done." Then left.'])

  assert.deepEqual(splitReplyText('Wait... This is next.', {
    minLength: 1,
    maxLength: 80,
    maxSegments: 5
  }), ['Wait... This is next.'])
})

test('groups many short sentences without collapsing them into one oversized message', () => {
  const text = '好。好。好。好。好。好。好。好。好。好。好。好。'
  const chunks = splitReplyText(text, {
    minLength: 6,
    maxLength: 10,
    maxSegments: 10
  })

  assert.ok(chunks.length > 1)
  assert.equal(chunks.join(''), text)
  assert.ok(chunks.every(chunk => Array.from(chunk).length <= 10))
})

test('hard-splits long unpunctuated text and respects the segment limit', () => {
  const text = '这是一段没有任何标点而且必须通过字符长度来兜底切开的很长很长的中文回复内容'
  const chunks = splitReplyText(text, {
    minLength: 3,
    maxLength: 8,
    maxSegments: 3
  })

  assert.equal(chunks.length, 3)
  assert.equal(chunks.join(''), text)
})

test('normalizes invalid delay and length settings', () => {
  assert.deepEqual(normalizeSegmentedReplyConfig({
    minLength: 999,
    maxLength: 20,
    maxSegments: 0,
    delayMin: 2000,
    delayMax: 500
  }), {
    enable: true,
    minLength: 20,
    maxLength: 20,
    maxSegments: 1,
    delayMin: 500,
    delayMax: 2000
  })

})

test('sends chunks sequentially with recall options and no trailing delay', async () => {
  const replies = []
  const delays = []
  const event = {
    async reply (...args) {
      replies.push(args)
    }
  }

  const sent = await sendReplyChunks(event, ['一', '二', '三'], {
    delayMin: 100,
    delayMax: 200,
    recallSeconds: 30,
    random: () => 0,
    sleep: async delay => delays.push(delay),
    transform: chunk => [`消息${chunk}`]
  })

  assert.equal(sent, 3)
  assert.deepEqual(replies, [
    [['消息一'], false, { recallMsg: 30 }],
    [['消息二'], false, { recallMsg: 30 }],
    [['消息三'], false, { recallMsg: 30 }]
  ])
  assert.deepEqual(delays, [100, 100])
})

test('stops sending when a segment fails', async () => {
  const attempts = []
  const event = {
    async reply (message) {
      attempts.push(message)
      if (attempts.length === 2) throw new Error('send failed')
    }
  }

  await assert.rejects(sendReplyChunks(event, ['一', '二', '三'], {
    delayMin: 0,
    delayMax: 0
  }), /send failed/)
  assert.deepEqual(attempts, ['一', '二'])
})
