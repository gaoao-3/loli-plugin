import test from 'node:test'
import assert from 'node:assert/strict'
import { getBotAccounts } from '../server/api/system.js'

test('reads a Miao-Yunzai primary bot account', () => {
  assert.deepEqual(getBotAccounts({ uin: 123456, nickname: '日奈' }), [
    { id: '123456', nickname: '日奈' }
  ])
})

test('reads TRSS-Yunzai multi-account bots and ignores its placeholder id', () => {
  const bot = {
    uin: [88888, 10001, 10002],
    10001: { self_id: 10001, nickname: '主号' },
    10002: { self_id: 10002, info: { nickname: '副号' } }
  }

  assert.deepEqual(getBotAccounts(bot), [
    { id: '10001', nickname: '主号' },
    { id: '10002', nickname: '副号' }
  ])
})
