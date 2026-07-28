import { CustomTool } from '../../core/index.js'
import { getConfig } from '../state.js'
import { canUseDokobot, executeDokobot } from '../dokobot.js'

class DokobotCloseSession extends CustomTool {
  name = 'dokobot_close_session'

  function = {
    name: 'dokobot_close_session',
    description: '关闭不再需要的 Dokobot 网页读取会话。仅主人可用。',
    parameters: {
      type: 'object',
      properties: { sessionId: { type: 'string', description: 'Dokobot 返回的 Session ID' } },
      required: ['sessionId']
    }
  }

  async run ({ sessionId }, context = {}) {
    if (context.event?.isMaster !== true) throw new Error('Dokobot 会话管理仅机器人主人可用')
    const access = canUseDokobot(getConfig()?.dokobot, context)
    if (!access.allowed) throw new Error(access.reason === 'master_only' ? 'Dokobot 会话管理仅机器人主人可用' : 'Dokobot 未启用')
    const id = String(sessionId || '').trim()
    if (!/^[a-zA-Z0-9_-]{6,200}$/.test(id)) throw new Error('Session ID 格式无效')
    const result = await executeDokobot(['close', id], access.config)
    return result.stdout.trim() || `Session ${id} closed`
  }
}

export default new DokobotCloseSession()
