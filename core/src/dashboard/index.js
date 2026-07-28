import express from 'express'
import path from 'path'
import fileUpload from 'express-fileupload'
import { fileURLToPath } from 'url'
import apiRoutes from './api/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CORE_ROOT = path.resolve(__dirname, '..', '..')

/**
 * 创建管理面板 HTTP 服务器
 * @param {Object} ctx
 * @param {import('../../engine.js').LoliEngine} ctx.engine
 * @param {Object} ctx.config
 * @param {Function} ctx.saveConfig
 * @param {Function} ctx.logger
 */
export function createServer (ctx) {
  const app = express()

  // 全局 charset 中间件 — 所有 text/* 和 application/json 响应追加 utf-8
  app.use((req, res, next) => {
    const origSend = res.send
    res.send = function (body) {
      const ct = res.getHeader('Content-Type')
      if (ct && typeof ct === 'string') {
        if ((ct.startsWith('text/') || ct.startsWith('application/json')) && !ct.includes('charset')) {
          res.setHeader('Content-Type', `${ct}; charset=utf-8`)
        }
      }
      return origSend.call(this, body)
    }
    next()
  })

  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  app.use(fileUpload({ createParentPath: true }))

  // 静态面板文件 — 显式设置 charset=utf-8，防止中文 Windows 浏览器回退到 GBK
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml'
  }
  const staticOpts = {
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase()
      if (mimeTypes[ext]) {
        res.setHeader('Content-Type', `${mimeTypes[ext]}; charset=utf-8`)
      }
    }
  }
  app.use('/dashboard', express.static(path.join(CORE_ROOT, 'dashboard'), staticOpts))

  // API 路由
  app.use('/api', apiRoutes(ctx))

  // 根路径重定向到面板
  app.get('/', (req, res) => {
    res.redirect('/dashboard')
  })

  // 面板路由兜底（SPA）
  app.get('/dashboard/*', (req, res) => {
    res.type('html').sendFile(path.join(CORE_ROOT, 'dashboard', 'index.html'))
  })

  // 错误处理
  app.use((err, req, res, next) => {
    ctx.logger?.(`[dashboard] ${err.message}`)
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
export function startDashboard (ctx, port = 3000, host = '127.0.0.1') {
  const app = createServer(ctx)
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const address = server.address()
      const actualPort = typeof address === 'object' && address ? address.port : port
      const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host
      ctx.logger?.(`[dashboard] 管理面板已启动: http://${displayHost}:${actualPort}`)
      resolve(server)
    })
    server.on('error', reject)
  })
}

export function stopDashboard (server) {
  if (!server) return Promise.resolve()
  return new Promise((resolve, reject) => {
    server.close(err => {
      if (err) reject(err)
      else resolve()
    })
  })
}

// 兼容早期直接使用 HTTP 服务函数的调用方。
export const startServer = startDashboard
