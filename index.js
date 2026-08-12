/**
 * loli-plugin — 日奈 QQ 机器人插件入口
 *
 * Miao-Yunzai / TRSS-Yunzai 的 PluginsLoader 要求插件入口导出可实例化的类。
 * 所有业务模块均以类形式导出，生命周期逻辑（引擎初始化、管理面板启动/卸载）
 * 由 apps/loli.js 的 init/destroy 方法负责。
 */
import { loli } from './apps/loli.js'
import { loliHelp } from './apps/help.js'
import { loliMemory } from './apps/memory.js'
import { loliUpdate } from './apps/update.js'
import { loliStickers } from './apps/stickers.js'
import { loliInteractions } from './apps/interactions.js'

export { loli, loliHelp, loliMemory, loliUpdate, loliStickers, loliInteractions }
