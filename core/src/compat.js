/**
 * 最小 CustomTool 兼容类 — 替代 @hina114514/chaite 的 CustomTool
 * 工具文件只需从插件内置 `core/index.js` 导入 `CustomTool` 即可
 */
export class CustomTool {
  name = ''
  function = {
    name: '',
    description: '',
    parameters: { type: 'object', properties: {}, required: [] }
  }
  async run (args) {
    throw new Error('run() must be implemented by subclass')
  }
}

/** asyncLocalStorage 存根 — 保持工具兼容 */
export const asyncLocalStorage = {
  _store: null,
  getStore () { return this._store },
  run (store, fn) {
    this._store = store
    return fn()
  }
}
