import { Router } from 'express'
import os from 'os'

function formatBytes (bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit >= 3 ? 2 : 1)} ${units[unit]}`
}

function normalizeBotId (value) {
  if (value === undefined || value === null || value === '' || value === 88888 || value === '88888') return ''
  return String(value)
}

export function getBotAccounts (bot = globalThis.Bot) {
  if (!bot) return []

  const configuredIds = Array.isArray(bot.uin) ? bot.uin : [bot.uin ?? bot.self_id]
  const accounts = []

  for (const configuredId of configuredIds) {
    const instance = bot[configuredId] || (Array.isArray(bot.uin) ? null : bot)
    const id = normalizeBotId(instance?.self_id ?? instance?.uin ?? configuredId)
    if (!id || accounts.some(account => account.id === id)) continue

    const nickname = instance?.nickname || instance?.info?.nickname || instance?.account?.nickname || ''
    accounts.push({ id, nickname: String(nickname || '') })
  }

  return accounts
}

function formatBotInfo (accounts) {
  if (accounts.length === 0) return '未绑定'
  return accounts.map((account, index) => {
    const label = account.nickname ? `${account.nickname} (${account.id})` : account.id
    return index === 0 && accounts.length > 1 ? `${label} [主账号]` : label
  }).join('、')
}

export default function systemRoutes (ctx) {
  const router = Router()
  const startTime = Date.now()

  router.get('/status', async (req, res) => {
    try {
      const stats = await ctx.engine.storage.stats()
      const uptime = Math.floor((Date.now() - startTime) / 1000)
      const tools = ctx.engine.toolLoader.getAll()
      const channels = await ctx.engine.listChannels()
      const totalMemory = os.totalmem()
      const freeMemory = os.freemem()
      const usedMemory = Math.max(0, totalMemory - freeMemory)
      const processMemory = process.memoryUsage()
      const botAccounts = getBotAccounts(
        typeof ctx.getBot === 'function' ? await ctx.getBot() : globalThis.Bot
      )
      res.json({
        status: 'ok',
        message: '系统运行正常',
        version: ctx.config.version || '0.1.0',
        uptime: `${uptime}s`,
        botInfo: formatBotInfo(botAccounts),
        botAccounts,
        memoryUsage: `${formatBytes(usedMemory)} / ${formatBytes(totalMemory)} (${Math.round(usedMemory / totalMemory * 100)}%)`,
        physicalMemory: {
          total: totalMemory,
          used: usedMemory,
          free: freeMemory,
          usagePercent: Math.round(usedMemory / totalMemory * 100)
        },
        processMemory: {
          rss: processMemory.rss,
          heapUsed: processMemory.heapUsed,
          rssFormatted: formatBytes(processMemory.rss),
          heapUsedFormatted: formatBytes(processMemory.heapUsed)
        },
        stats: {
          totalKeys: stats.totalKeys,
          channels: channels.length,
          tools: tools.length
        }
      })
    } catch (err) {
      res.status(500).json({ status: 'error', message: err.message })
    }
  })

  router.get('/health', (req, res) => {
    res.json({ status: 'ok' })
  })

  router.get('/dokobot', async (req, res) => {
    if (typeof ctx.dokobot?.getStatus !== 'function') {
      return res.status(503).json({ available: false, error: 'Dokobot 状态检查未挂载' })
    }
    try {
      res.json(await ctx.dokobot.getStatus())
    } catch (err) {
      res.status(500).json({ available: false, error: err.message })
    }
  })

  router.get('/extensions', async (req, res) => {
    if (typeof ctx.extensions?.getStatus !== 'function') {
      return res.status(503).json({ error: 'MCP / Skills 状态检查未挂载' })
    }
    try {
      res.json(await ctx.extensions.getStatus())
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  router.post('/extensions/reload', async (req, res) => {
    if (typeof ctx.extensions?.reload !== 'function') {
      return res.status(503).json({ error: 'MCP / Skills 重载未挂载' })
    }
    try {
      res.json(await ctx.extensions.reload())
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  return router
}
