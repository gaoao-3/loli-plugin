import test from 'node:test'
import assert from 'node:assert/strict'
import { AbstractClient } from '../node_modules/lolicon-core/src/clients/abstract.js'

class ResponseLogClient extends AbstractClient {
  get adapterType () { return 'test' }

  async _sendMessage () {
    return {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: '思考过程' },
        { type: 'text', text: '最终回复' }
      ],
      timestamp: Date.now()
    }
  }
}

function createStorage () {
  const histories = []
  return {
    getHistory: async () => [...histories],
    saveHistory: async message => { histories.push(message) }
  }
}

test('records a sanitized API response summary', async () => {
  const logs = []
  const client = new ResponseLogClient({
    storage: createStorage(),
    options: { apiKey: 'secret-key', apiResponseLogMaxLength: 1000 },
    logger: message => logs.push(message)
  })

  await client.sendMessage({
    conversationId: 'test-conversation',
    userMessage: { role: 'user', content: [{ type: 'text', text: '你好' }] },
    options: { model: 'test-model' }
  })

  assert.equal(logs.length, 1)
  assert.match(logs[0], /^\[loli] API response /)
  assert.match(logs[0], /"model":"test-model"/)
  assert.match(logs[0], /最终回复/)
  assert.doesNotMatch(logs[0], /secret-key/)
})

test('can disable API response logging per channel', async () => {
  const logs = []
  const client = new ResponseLogClient({
    storage: createStorage(),
    options: { logApiResponses: false },
    logger: message => logs.push(message)
  })

  await client.sendMessage({
    conversationId: 'test-conversation',
    userMessage: { role: 'user', content: [{ type: 'text', text: '你好' }] },
    options: { model: 'test-model' }
  })

  assert.deepEqual(logs, [])
})
