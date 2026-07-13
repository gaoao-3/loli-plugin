import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.logger ||= {
  debug () {},
  info () {},
  warn () {},
  error () {}
}

const { getBotFramework, getEventBot, getGroupId, normalizeSegment } = await import('../utils/bot.js')
const { buildGroupContextPrompt, getGroupHistory } = await import('../utils/group.js')
const { addInteractionHint, intoUserMessage } = await import('../utils/message.js')

test('normalizes ICQQ flat and OneBot wrapped message segments', () => {
  assert.deepEqual(normalizeSegment('hello'), { type: 'text', text: 'hello' })
  assert.deepEqual(normalizeSegment({ type: 'at', qq: 10001, text: 'Alice' }), {
    type: 'at', qq: 10001, text: 'Alice'
  })
  assert.deepEqual(normalizeSegment({ type: 'image', data: { url: 'https://example.com/a.jpg' } }), {
    type: 'image', data: { url: 'https://example.com/a.jpg' }, url: 'https://example.com/a.jpg'
  })
})

test('uses the ICQQ event group and excludes the current message by message id or seq', async () => {
  const bot = { uin: 10000 }
  const group = {
    gid: 20000,
    bot,
    async getChatHistory () {
      return {
        messages: [
          { message_id: 'old', seq: 10, sender: { user_id: 1 }, message: [{ type: 'text', text: 'old' }] },
          { message_id: 'current-id', seq: 11, sender: { user_id: 2 }, message: [{ type: 'text', text: 'current' }] }
        ]
      }
    }
  }
  const event = { isGroup: true, group, message_id: 'current-id', seq: 11 }

  assert.equal(getEventBot(event), bot)
  assert.equal(getGroupId(event), 20000)
  assert.equal(getBotFramework(event), 'icqq')
  const history = await getGroupHistory(event, 20, {
    excludeMessageId: [event.message_id, event.seq]
  })
  assert.equal(history.length, 1)
  assert.equal(history[0].message_id, 'old')
})

test('keeps the newest ICQQ entries when history is returned newest first', async () => {
  const bot = { uin: 10000 }
  const group = {
    gid: 20001,
    bot,
    async getChatHistory () {
      return [
        { seq: 30, time: 300, sender: { user_id: 1 }, message: [{ type: 'text', text: 'newest' }] },
        { seq: 20, time: 200, sender: { user_id: 2 }, message: [{ type: 'text', text: 'middle' }] },
        { seq: 10, time: 100, sender: { user_id: 3 }, message: [{ type: 'text', text: 'oldest' }] }
      ]
    }
  }
  const history = await getGroupHistory({ isGroup: true, group }, 2)
  assert.deepEqual(history.map(item => item.seq), [20, 30])
})

test('converts wrapped OneBot and flat ICQQ segments into one user message', async () => {
  const event = {
    isGroup: true,
    self_id: 10000,
    sender: { user_id: 123, card: 'Alice' },
    message: [
      { type: 'at', data: { qq: '10000', name: 'bot' } },
      { type: 'text', data: { text: ' wrapped ' } },
      { type: 'text', text: 'flat' },
      { type: 'face', id: 14 }
    ]
  }
  const message = await intoUserMessage(event, {
    useRawMessage: false,
    handleAtMsg: true,
    excludeAtBot: true,
    handleReplyImage: false
  })
  const text = message.content.find(item => item.type === 'text')?.text
  assert.match(text, /^\[发送者: Alice\]/)
  assert.match(text, /wrapped/)
  assert.match(text, /flat/)
  assert.match(text, /\[表情\]/)
  assert.doesNotMatch(text, /@bot/)
})

test('marks a bot mention explicitly without keeping the bot at segment', async () => {
  const event = {
    isGroup: true,
    self_id: 10000,
    sender: { user_id: 123, card: 'Alice' },
    message: [
      { type: 'at', qq: 10000, text: '日奈' },
      { type: 'text', text: ' 在吗' }
    ]
  }
  let message = await intoUserMessage(event, {
    useRawMessage: false,
    handleAtMsg: true,
    excludeAtBot: true,
    handleReplyImage: false
  })
  message = addInteractionHint(message, '用户明确 @ 了你，这条消息是在直接对你说。')
  const texts = message.content.filter(item => item.type === 'text').map(item => item.text)

  assert.equal(texts[0], '[当前交互] 用户明确 @ 了你，这条消息是在直接对你说。')
  assert.match(texts[1], /在吗/)
  assert.doesNotMatch(texts[1], /@日奈|@10000/)
})

test('strips the wake prefix while preserving sender context', async () => {
  const message = await intoUserMessage({
    isGroup: true,
    self_id: 10000,
    sender: { user_id: 123, card: 'Alice' },
    message: [{ type: 'text', text: '#ai 今天天气怎么样' }]
  }, {
    useRawMessage: false,
    toggleMode: 'prefix',
    togglePrefix: '#ai',
    handleReplyImage: false
  })
  const text = message.content.find(item => item.type === 'text')?.text
  assert.match(text, /^\[发送者: Alice\]/)
  assert.match(text, /今天天气怎么样/)
  assert.doesNotMatch(text, /#ai/)
})

test('builds ICQQ group context chronologically from segment-only history', () => {
  const context = buildGroupContextPrompt(
    { group_id: 20000, group: { gid: 20000, name: '测试群' } },
    [
      {
        seq: 12,
        time: 200,
        sender: { uin: 2, card_name: 'Bob', role: 'admin' },
        message: [{ type: 'text', text: '后说' }, { type: 'image', file: 'a.jpg' }]
      },
      {
        seq: 11,
        time: 100,
        user_id: 1,
        nickname: 'Alice',
        message: [{ type: 'text', data: { text: '先说' } }]
      },
      { seq: 13, time: 300, sender: { user_id: 3 }, message: [] }
    ],
    {
      groupContextTemplatePrefix: '<group id="${group.group_id}" name="${group.name}">',
      groupContextTemplateMessage: '${message.sender.name}|${message.sender.user_id}|${message.sender.role}|${message.raw_message}',
      groupContextTemplateSuffix: '</group>'
    }
  )

  assert.equal(context, [
    '<group id="20000" name="测试群">',
    'Alice|1|member|先说',
    'Bob|2|admin|后说 [图片: a.jpg]',
    '</group>'
  ].join('\n'))
})
