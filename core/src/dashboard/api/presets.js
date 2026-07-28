import { Router } from 'express'

/** 将引擎中的预设列表同步到 config.chaite.presets 并落盘 */
export async function syncPresetsToConfig (ctx) {
  // savePreset 先更新缓存；必须等独立预设文件真正落盘后再写镜像配置和响应。
  ctx.engine.storage.flush?.()
  const presets = await ctx.engine.listPresets()
  const candidate = structuredClone(ctx.config)
  if (!candidate.chaite) candidate.chaite = {}
  candidate.chaite.presets = presets
  try {
    ctx.saveConfig(candidate)
    return true
  } catch (err) {
    // data/pr 是事实来源，主存储已成功时不把请求误报为完全失败；下次协调会修复镜像。
    ctx.logger?.(`[dashboard] 预设已保存，但 config.json 镜像更新失败: ${err.message}`)
    return false
  }
}

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
    const configMirrorPersisted = await syncPresetsToConfig(ctx)
    res.json({ ok: true, preset: p, configMirrorPersisted })
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
    const configMirrorPersisted = await syncPresetsToConfig(ctx)
    res.json({ ok: true, preset: p, configMirrorPersisted })
  })

  router.delete('/:id', async (req, res) => {
    await ctx.engine.storage.deletePreset(req.params.id)
    const configMirrorPersisted = await syncPresetsToConfig(ctx)
    res.json({ ok: true, configMirrorPersisted })
  })

  return router
}
