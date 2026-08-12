/**
 * 音乐卡片发送工具
 * 使用 OneBot v11 send_group_msg / send_private_msg
 * 通过 Meting 兼容 API 获取真实播放链接 + 专辑封面，发送 custom music 段
 */
import { CustomTool } from '../../core/index.js'
import {
  MUSIC_SERVERS,
  getSong,
  musicServerName,
  resolveAudioUrl,
  resolveLxAudioUrl,
  songPageUrl
} from '../music-api.js'

class SendMusic extends CustomTool {

  name = 'send_music'

  function = {
    name: 'send_music',
    description: '发送音乐卡片到当前聊天。需要先通过 search_music 获取歌曲的 id 和平台，然后调用此工具发送自定义音乐分享卡片。',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: '歌曲 id（从 search_music 搜索结果中获取）'
        },
        server: {
          type: 'string',
          enum: MUSIC_SERVERS,
          description: '音源平台，必须与搜索时使用的平台一致：netease=网易云，kugou=酷狗，kuwo=酷我'
        },
        title: {
          type: 'string',
          description: '歌曲标题（从 search_music 结果中原样带上，部分平台需要）'
        },
        singer: {
          type: 'string',
          description: '歌手名（从 search_music 结果中原样带上，部分平台需要）'
        }
      },
      required: ['id']
    }
  }

  async run (args, context) {
    const id = String(args?.id || '').trim()
    const e = context?.event
    if (!e) return '错误: 无法获取事件对象'
    if (!id) return '错误: 缺少歌曲 id'

    try {
      // 1. 获取歌曲详情与真实播放链接
      const track = await getSong(id, {
        server: args.server,
        hint: { title: args.title, author: args.singer }
      })
      let playUrl = await resolveAudioUrl(track.url)
      const platform = musicServerName(track.server)
      const jumpUrl = songPageUrl(track.server, track.id, track.title) || track.url

      // Meting 解析失败（VIP）→ 洛雪 API 兜底
      let viaLx = false
      if (!playUrl) {
        playUrl = await resolveLxAudioUrl(track.server, track.id)
        viaLx = Boolean(playUrl)
      }

      if (!playUrl) {
        return `${platform}无法提供「${track.title}」的播放链接（可能是 VIP 歌曲）。请调用 search_music 换其他平台搜索后重试。`
      }

      // 2. 构建 custom music 段
      const musicData = {
        name: track.title,
        artist: track.author,
        prompt: `[分享]${platform}音乐`,
        jumpUrl,
        pic: track.pic,
        url: playUrl
      }
      const musicSegment = {
        type: 'music',
        data: {
          type: 'custom',
          url: musicData.jumpUrl,
          audio: musicData.url,
          title: musicData.name,
          image: musicData.pic,
          content: musicData.artist
        }
      }

      // 3. 发送：优先 OneBot v11 API，降级 reply
      try {
        await sendMusicSegment(e, musicSegment, musicData)
      } catch (sendErr) {
        // 降级：reply 文本 + 链接
        await e.reply(`[音乐分享] ${track.title} - ${track.author}\n${jumpUrl}`, true)
        return `已发送音乐链接 (id: ${id})，卡片发送失败: ${sendErr.message}`
      }

      return `✅ 已发送：${track.title} - ${track.author}（${platform}${viaLx ? '，备用解析' : ''}）`

    } catch (err) {
      console.error('[SendMusic]', err)
      return `发送音乐失败: ${err.message}`
    }
  }
}

// ========== 辅助函数 ==========

async function sendMusicSegment (e, musicSegment, musicData) {
  const bot = e.bot || (typeof Bot !== 'undefined' ? Bot : null)
  const isGroup = e.isGroup || Boolean(e.group_id)
  if (musicData && typeof bot?.sendOidb === 'function') {
    return sendOidbMusicCard(e, bot, musicData)
  }
  if (bot?.sendApi) {
    const action = isGroup ? 'send_group_msg' : 'send_private_msg'
    const target = isGroup
      ? { group_id: e.group_id || e.sender?.group_id }
      : { user_id: e.sender?.user_id || e.user_id }
    return bot.sendApi(action, { ...target, message: [musicSegment] })
  }
  if (bot?.sendGroupMsg && isGroup) return bot.sendGroupMsg(e.group_id, [musicSegment])
  if (bot?.sendPrivateMsg && !isGroup) return bot.sendPrivateMsg(e.sender?.user_id || e.user_id, [musicSegment])
  return e.reply([musicSegment], true)
}

async function sendOidbMusicCard (e, bot, musicData) {
  let core = globalThis.core
  if (!core?.pb) {
    try {
      core = (await import('icqq')).core
    } catch {}
  }
  if (!core?.pb) throw new Error('无法加载 ICQQ protobuf 核心')

  const isGroup = e.isGroup || Boolean(e.group_id)
  const recvUin = isGroup
    ? (e.group?.gid || e.group_id)
    : (e.friend?.uin || e.user_id || e.sender?.user_id)
  if (!recvUin) throw new Error('无法确定音乐卡片接收者')

  const body = {
    1: 100497308,
    2: 1,
    3: 4,
    5: { 1: 1, 2: '0.0.0', 3: 'com.tencent.qqmusic', 4: 'cbd27cd7c861227d013a25b2d10f0799' },
    6: '',
    10: isGroup ? 1 : 0,
    11: recvUin,
    12: {
      10: musicData.name,
      11: musicData.artist,
      12: musicData.prompt,
      13: musicData.jumpUrl,
      14: musicData.pic,
      16: musicData.url
    },
    19: 0
  }
  const payload = await bot.sendOidb('OidbSvc.0xb77_9', core.pb.encode(body))
  const result = core.pb.decode(payload)
  if (result[3] !== 0) throw new Error(`OIDB 发送被拒 (code: ${result[3]})`)
}

export default new SendMusic()
