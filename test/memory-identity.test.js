import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { collect } from '../memory/collector.js'
import { sanitizeMemoryText } from '../memory/prompt.js'
import { deduplicateRelevantMemories } from '../memory/retriever.js'
import {
  closeMemoryStore,
  getMessagesForDate
} from '../memory/store.js'
import {
  buildProfilePrompt as buildSchedulerProfilePrompt,
  formatMessages
} from '../memory/scheduler.js'
import {
  captureEventMasterIdentity,
  getMasterIdentityConfig,
  resolveEventIdentity
} from '../utils/identity.js'

function makeTempDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loli-memory-identity-'))
}

test('直接注入的画像与摘要不会被向量结果重复召回', () => {
  const direct = { userImpression: '长期画像 A', todayUser: '今日摘要 B' }
  const relevant = deduplicateRelevantMemories([
    { id: 1, text: '长期画像 A' },
    { id: 2, text: '今日摘要  B' },
    { id: 3, text: '旧日相关事实 C' },
    { id: 4, text: '旧日相关事实 C' }
  ], direct)
  assert.deepEqual(relevant.map(item => item.id), [3])
})

test('主人识别开关自动保存 QQ 与昵称，并支持特别称呼', () => {
  const config = {
    loli: {
      masterIdentity: { enable: true, autoDetect: true, userIds: [], users: [], appellation: '老师' }
    }
  }
  const event = {
    isMaster: true,
    user_id: '10001',
    sender: { user_id: '10001', nickname: '主人昵称', card: '' }
  }
  assert.equal(captureEventMasterIdentity(event, config), true)
  assert.deepEqual(getMasterIdentityConfig(config).users, [{ userId: '10001', nickname: '主人昵称' }])
  assert.equal(resolveEventIdentity(event, config).appellation, '老师')
  assert.equal(captureEventMasterIdentity(event, config), false)
})

test('关闭主人识别后不自动采集，也不注入主人身份', () => {
  const config = {
    loli: {
      masterIdentity: { enable: false, autoDetect: false, userIds: ['10001'], users: [], appellation: '老师' }
    }
  }
  const event = { isMaster: true, user_id: '10001', sender: { user_id: '10001', nickname: '主人昵称' } }
  assert.equal(captureEventMasterIdentity(event, config), false)
  assert.equal(resolveEventIdentity(event, config).isMaster, false)
})

test('记忆文本在自然边界截断，不留下破碎的 Markdown 片段', () => {
  const text = '第一条完整事实。\n*   **社交偏好**：这是第二条很长的事实，需要在自然边界结束。\n第三条事实。'
  const result = sanitizeMemoryText(text, 38)
  assert.ok(result.endsWith('…'))
  assert.ok(result.length <= 38)
  assert.equal((result.match(/\*\*/g) || []).length % 2, 0)
  assert.match(result, /[。！？；，\s]…$/)
})

test('助手消息保存机器人 QQ 与当前角色名，不再冒用当前用户 QQ', () => {
  const baseDir = makeTempDir()
  try {
    collect({
      baseDir,
      event: {
        isGroup: true,
        group_id: '10001',
        user_id: '20002',
        message_id: 'msg-1',
        time: Math.floor(Date.now() / 1000),
        sender: { user_id: '20002', card: '测试用户', nickname: '用户昵称', role: 'member' }
      },
      userText: '日奈，你好',
      assistantText: '老师，早上好。',
      assistantIdentity: { userId: '99999', displayName: '日奈', nickname: '日奈' },
      config: { memory: { group: { enable: true }, user: { enable: true } } }
    })
    const groupRows = getMessagesForDate(baseDir, 'group', '10001')
    const assistant = groupRows.find(row => row.role === 'assistant')
    assert.equal(assistant.user_id, '99999')
    assert.equal(assistant.display_name, '日奈')
    const userRows = getMessagesForDate(baseDir, 'group_user', '10001:20002')
    assert.equal(userRows.find(row => row.role === 'assistant').user_id, '99999')
  } finally {
    closeMemoryStore()
    fs.rmSync(baseDir, { recursive: true, force: true })
  }
})

test('旧版助手消息即使误存用户 QQ，也不会再显示成机器人 QQ', () => {
  const text = formatMessages([{
    role: 'assistant', user_id: '20002', nickname: 'AI', display_name: null,
    sender_role: null, created_at: Date.now(), text: '回复内容'
  }], {
    loli: { defaultPreset: 'hina' },
    chaite: { presets: [{ id: 'hina', name: '日奈' }] }
  })
  assert.match(text, /日奈 \[机器人:日奈；机器人QQ:-\]/)
  assert.doesNotMatch(text, /机器人QQ:20002/)
})

test('画像提示明确机器人名字、头衔来源与称呼方向', () => {
  const prompt = buildSchedulerProfilePrompt('摘要', 'group_user', '10001:20002', {
    userId: '20002', displayName: '测试用户', senderTitle: '萝莉妈妈',
    senderRole: 'member', isMaster: true, appellation: '老师'
  }, { name: '日奈', presetId: 'hina' })
  assert.match(prompt, /当前机器人身份: 日奈（预设:hina）/)
  assert.match(prompt, /群专属头衔.*不是用户自称/)
  assert.match(prompt, /机器人应称呼此用户为.*禁止反写/)
})
