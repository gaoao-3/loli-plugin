import { Router } from 'express'

export default function presetRoutes (ctx) {
  const router = Router()

  router.get('/', async (req, res) => {
    const presets = await ctx.engine.listPresets()
    res.json(presets)
  })

  router.post('/', async (req, res) => {
    const p = req.body
    if (!p.id || !p.name) return res.status(400).json({ error: '缺少 id 或 name' })
    await ctx.engine.savePreset(p)
    res.json({ ok: true, preset: p })
  })

  router.get('/:id', async (req, res) => {
    const p = await ctx.engine.storage.getPreset(req.params.id)
    if (!p) return res.status(404).json({ error: 'Preset not found' })
    res.json(p)
  })

  router.put('/:id', async (req, res) => {
    const p = req.body
    p.id = req.params.id
    await ctx.engine.savePreset(p)
    res.json({ ok: true, preset: p })
  })

  router.delete('/:id', async (req, res) => {
    await ctx.engine.storage.deletePreset(req.params.id)
    res.json({ ok: true })
  })

  return router
}
