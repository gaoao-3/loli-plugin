import express from 'express'
import path from 'path'
import fileUpload from 'express-fileupload'
import { fileURLToPath } from 'url'
import apiRoutes from './api/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(__dirname, '..')

/**
 * 创建管理面板 HTTP 服务器
 * @param {Object} ctx
 * @param {import('lolicon-core').LoliEngine} ctx.engine
 * @param {Object} ctx.config
 * @param {Function} ctx.saveConfig
 * @param {Function} ctx.logger
 */
export function createServer (ctx) {
  const app = express()

  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  app.use(fileUpload({ createParentPath: true }))

  // 静态面板文件
  app.use('/dashboard', express.static(path.join(PLUGIN_ROOT, 'dashboard')))

  // API 路由
  app.use('/api', apiRoutes(ctx))

  // 根路径重定向到面板
  app.get('/', (req, res) => {
    res.redirect('/dashboard')
  })

  // 面板路由兜底（SPA）
  app.get('/dashboard/*', (req, res) => {
    res.sendFile(path.join(PLUGIN_ROOT, 'dashboard', 'index.html'))
  })

  // 错误处理
  app.use((err, req, res, next) => {
    ctx.logger(`[dashboard] ${err.message}`)
    res.status(500).json({ error: err.message })
  })

  return app
}

/**
 * 启动服务器
 * @param {Object} ctx
 * @param {number} port
 * @returns {Promise<http.Server>}
 */
export function startServer (ctx, port) {
  const app = createServer(ctx)
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      ctx.logger(`[dashboard] 管理面板已启动: http://localhost:${port}`)
      resolve(server)
    })
    server.on('error', reject)
  })
}
