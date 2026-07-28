/**
 * lolicon-core — 轻量级 AI 对话引擎
 *
 * @example
 *   import { createEngine } from './core/index.js'
 *   const engine = await createEngine({ dataDir: './data' })
 *   const reply = await engine.chat('你好', { channelId: 'my-gemini' })
 */
export { LoliEngine as createEngine } from './src/engine.js'
export { LoliStorage } from './src/storage.js'
export { ToolLoader } from './src/loaders/tools.js'
export { GeminiClient } from './src/clients/gemini.js'
export { OpenAIClient } from './src/clients/openai.js'
export { AbstractClient } from './src/clients/abstract.js'
export { CustomTool, asyncLocalStorage } from './src/compat.js'
