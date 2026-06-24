import { Router } from 'express'
import fs from 'fs'
import path from 'path'

export default function toolRoutes (ctx) {
  const router = Router()
  const toolsDir = ctx.toolsDir
  const disabledDir = path.join(toolsDir, 'disabled')

  function listTools () {
    const loaded = ctx.engine.toolLoader.getAll()
    const loadedMap = new Map(loaded.map(t => [t.name, t]))

    const tools = []
    const enabledFiles = fs.existsSync(toolsDir) ? fs.readdirSync(toolsDir).filter(f => f.endsWith('.js')) : []
    const disabledFiles = fs.existsSync(disabledDir) ? fs.readdirSync(disabledDir).filter(f => f.endsWith('.js')) : []

    for (const file of enabledFiles) {
      const name = file.replace(/\.js$/, '')
      const t = loadedMap.get(name)
      tools.push({
        name,
        path: path.join(toolsDir, file),
        description: t?.toolDef?.description || t?.toolDef?.function?.description || '无描述',
        enabled: true
      })
    }

    for (const file of disabledFiles) {
      const name = file.replace(/\.js$/, '')
      tools.push({
        name,
        path: path.join(disabledDir, file),
        description: '已禁用',
        enabled: false
      })
    }

    return tools
  }

  router.get('/', (req, res) => {
    res.json(listTools())
  })

  router.post('/reload', async (req, res) => {
    await ctx.engine.toolLoader.init()
    res.json({ ok: true, tools: listTools() })
  })

  router.post('/:name/toggle', async (req, res) => {
    const name = req.params.name
    const enabledPath = path.join(toolsDir, name + '.js')
    const disabledPath = path.join(disabledDir, name + '.js')

    fs.mkdirSync(disabledDir, { recursive: true })

    if (fs.existsSync(enabledPath)) {
      fs.renameSync(enabledPath, disabledPath)
    } else if (fs.existsSync(disabledPath)) {
      fs.renameSync(disabledPath, enabledPath)
    } else {
      return res.status(404).json({ error: 'Tool file not found' })
    }

    await ctx.engine.toolLoader.init()
    res.json({ ok: true, tools: listTools() })
  })

  router.post('/upload', (req, res) => {
    if (!req.files || !req.files.tool) {
      return res.status(400).json({ error: '未上传文件' })
    }
    const file = req.files.tool
    if (!file.name.endsWith('.js')) {
      return res.status(400).json({ error: '仅支持 .js 文件' })
    }
    fs.mkdirSync(toolsDir, { recursive: true })
    const targetPath = path.join(toolsDir, file.name)
    file.mv(targetPath, async (err) => {
      if (err) return res.status(500).json({ error: err.message })
      await ctx.engine.toolLoader.init()
      res.json({ ok: true, file: file.name, tools: listTools() })
    })
  })

  return router
}
