/**
 * 机器人框架探测
 */

/**
 * 探测当前运行的 Yunzai 底层框架类型
 * @returns {'trss' | 'icqq' | 'unknown'}
 */
export function getBotFramework () {
  if (typeof Bot === 'undefined') return 'unknown'

  // TRSS-Yunzai 通常暴露 adapter 对象或版本号中包含 TRSS
  if (Bot?.adapter || Bot?.version?.name?.toUpperCase()?.includes('TRSS')) {
    return 'trss'
  }

  // 默认按 icqq 兼容路径处理
  return 'icqq'
}
