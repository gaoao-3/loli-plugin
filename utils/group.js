import { getBotFramework } from './bot.js'
import { getConfig } from '../index.js'
import { formatTimeToBeiJing } from './common.js'

export class GroupContextCollector {
  /**
   * 获取群组上下文
   * @param {*} bot bot实例
   * @param {string} groupId 群号
   * @param {number} start 起始seq
   * @param {number} length 往前数几条
   * @returns {Promise<Array<*>>}
   */
  async collect (bot = Bot, groupId, start = 0, length = 20) {
    throw new Error('Method not implemented.')
  }
}

export class ICQQGroupContextCollector extends GroupContextCollector {
  /**
   * 获取群组上下文
   * @param {*} bot
   * @param {string} groupId
   * @param {number} start
   * @param {number} length
   * @returns {Promise<Array<*>>}
   */
  async collect (bot = Bot, groupId, start = 0, length = 20) {
    const group = bot.pickGroup(groupId)
    if (!group || typeof group.getChatHistory !== 'function') {
      logger.debug(`[GroupContext] ICQQ group.getChatHistory not available for ${groupId}`)
      return []
    }
    let latestChats = await group.getChatHistory(start, 1)
    if (latestChats.length > 0) {
      let latestChat = latestChats[0]
      if (latestChat) {
        let seq = latestChat.seq || latestChat.message_id
        let chats = []
        while (chats.length < length) {
          let chatHistory = await group.getChatHistory(seq, 20)
          if (!chatHistory || chatHistory.length === 0) {
            break
          }
          chats.push(...chatHistory.reverse())
          if (seq === chatHistory[chatHistory.length - 1].seq || seq === chatHistory[chatHistory.length - 1].message_id) {
            break
          }
          seq = chatHistory[chatHistory.length - 1].seq || chatHistory[chatHistory.length - 1].message_id
        }
        chats = chats.slice(0, length).reverse()
        try {
          let mm = bot.gml
      if (!mm) throw new Error('gml unavailable')
          for (const chat of chats) {
            let sender = mm.get(chat.sender.user_id)
            if (sender) {
              chat.sender = sender
            }
          }
        } catch (err) {
          logger.warn(err)
        }
        return chats
      }
    }
    return []
  }
}

export class TRSSGroupContextCollector extends GroupContextCollector {
  /**
   * 获取群组上下文
   * @param {*} bot
   * @param {string} groupId
   * @param {number} start
   * @param {number} length
   * @returns {Promise<Array<*>>}
   */
  async collect (bot = Bot, groupId, start = 0, length = 20) {
    if (!bot) {
      return []
    }
    const group = bot.pickGroup(groupId)
    if (!group || typeof group.getChatHistory !== 'function') {
      logger.debug(`[GroupContext] TRSS group.getChatHistory not available for ${groupId}`)
      return []
    }
    let chats = await group.getChatHistory(start, length)
    try {
      let mm = bot.gml
      if (!mm) throw new Error('gml unavailable')
      for (const chat of chats) {
        let sender = mm.get(chat.sender.user_id)
        if (sender) {
          chat.sender = sender
        }
      }
    } catch (err) {
      logger.warn(err)
    }
    return chats
  }
}

/**
 * 获取群组上下文 — 框架自适应，采集失败静默降级
 * @param e
 * @param length
 * @returns {Promise<Array<*>>}
 */
export async function getGroupHistory (e, length = 20) {
  const framework = getBotFramework()

  // TRSS-Yunzai (go-cqhttp / NapCat 兼容)
  if (framework === 'trss') {
    try {
      return await new TRSSGroupContextCollector().collect(e.bot, e.group_id, 0, length)
    } catch (err) {
      logger.debug(`[GroupContext] TRSS 采集失败 (${err.message})，回退 icqq`)
    }
  }

  // 通用 icqq（纯 icqq / NapCat 底层兼容）
  try {
    return await new ICQQGroupContextCollector().collect(e.bot, e.group_id, 0, length)
  } catch (err) {
    logger.debug(`[GroupContext] icqq 采集失败 (${err.message})，群上下文不可用`)
  }

  return []
}

/**
 * 获取构建群聊聊天记录的prompt
 * @param e event
 * @param {number} length 长度
 * @returns {Promise<string>}
 */
export async function getGroupContextPrompt (e, length) {
  const {
    groupContextTemplatePrefix = '',
    groupContextTemplateMessage = '',
    groupContextTemplateSuffix = ''
  } = getConfig().llm || {}
  const chats = await getGroupHistory(e, length)
  const rows = chats
    .filter(chat => chat)
    .map(chat => {
      const sender = chat.sender || {}
      return groupContextTemplateMessage
      // eslint-disable-next-line no-template-curly-in-string
        .replace('${message.sender.card}', sender.card || '-')
      // eslint-disable-next-line no-template-curly-in-string
        .replace('${message.sender.nickname}', sender.nickname || '-')
      // eslint-disable-next-line no-template-curly-in-string
        .replace('${message.sender.user_id}', sender.user_id || '-')
      // eslint-disable-next-line no-template-curly-in-string
        .replace('${message.sender.role}', sender.role || '-')
      // eslint-disable-next-line no-template-curly-in-string
        .replace('${message.sender.title}', sender.title || '-')
      // eslint-disable-next-line no-template-curly-in-string
        .replace('${message.time}', chat.time ? formatTimeToBeiJing(chat.time) : '-')
      // eslint-disable-next-line no-template-curly-in-string
        .replace('${message.messageId}', chat.message_id || chat.seq || chat.messageId || '-')
      // eslint-disable-next-line no-template-curly-in-string
        .replace('${message.raw_message}', chat.raw_message || chat.msg || '-')
    }).join('\n')
  return [
    groupContextTemplatePrefix
      // eslint-disable-next-line no-template-curly-in-string
      .replace('${group.group_id}', e.group.group_id || e.group_id || 'unknown')
      // eslint-disable-next-line no-template-curly-in-string
      .replace('${group.name}', e.group.name || e.group_name || 'unknown'),
    rows,
    groupContextTemplateSuffix
  ].join('\n')
}
