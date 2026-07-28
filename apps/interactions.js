import { getConfig } from '../utils/state.js'
import { isPokeToSelf, pokeUser, shouldReturnPoke } from '../utils/interactions.js'

export class loliInteractions extends plugin {
  constructor () {
    super({
      name: 'loli-轻互动',
      dsc: 'QQ 消息表情回应与戳一戳',
      event: 'notice.group.poke',
      priority: 600,
      rule: [{
        reg: '.*',
        fnc: 'handlePoke',
        log: false
      }]
    })
  }

  async handlePoke (e) {
    if (!isPokeToSelf(e)) return false
    const config = getConfig() || {}
    if (!shouldReturnPoke(config)) return false
    try {
      await pokeUser(e, e.operator_id, config)
    } catch (err) {
      logger?.warn?.(`[Interaction] 回戳 ${e.operator_id} 失败: ${err.message}`)
    }
    // 戳一戳只是轻互动，不阻止其他 notice 插件继续处理。
    return false
  }
}
