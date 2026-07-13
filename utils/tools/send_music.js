/**
 * QQ 音乐卡片发送工具
 * 使用 OneBot v11 send_group_msg / send_private_msg
 * 获取真实播放链接 + 专辑封面，发送 custom music 段
 */
import { createHash } from 'node:crypto'
import { CustomTool } from 'lolicon-core'
import { fetchWithTimeout, musicAuth, readMusicConfig, stableMusicGuid } from '../music.js'
import { makeMusicSegment } from '../bot.js'

class SendMusic extends CustomTool {

  name = 'send_music'

  function = {
    name: 'send_music',
    description: '发送 QQ 音乐卡片到当前聊天。需要先通过 search_music 获取歌曲的 mid（非数字 id），然后调用此工具发送自定义音乐分享卡片。',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: '歌曲 mid，如 004XqlYb0VPIUb（从 search_music 搜索结果中获取）'
        }
      },
      required: ['id']
    }
  }

  async run (args, context) {
    const { id: mid } = args
    const e = context?.event
    if (!e) return '错误: 无法获取事件对象'

    try {
      // 1. 获取歌曲详情
      const track = await getTrackInfo(mid)
      const playUrl = await getPlayUrl(mid, track)

      if (!playUrl) {
        if (track?.id) {
          try {
            await sendMusicSegment(e, createNativeMusicSegment(track.id))
            return `✅ 已发送 QQ 音乐原生卡片：${track.title} - ${track.singer}`
          } catch {}
        }
        await sendLinkFallback(e, mid, track)
        return `已发送 QQ 音乐链接 (mid: ${mid})，无法获取播放链接`
      }

      const title = track?.title || 'QQ音乐分享'
      const singer = track?.singer || '点击播放'

      const picUrl = getCoverUrl(track)

      // 2. 构建 custom music 段
      const musicData = {
        name: title,
        artist: singer,
        prompt: '[分享]QQ音乐',
        jumpUrl: `https://y.qq.com/n/yqq/song/${mid}.html`,
        pic: picUrl,
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
        await e.reply(`[QQ音乐分享] ${title} - ${singer}\nhttps://y.qq.com/n/yqq/song/${mid}.html`, true)
        return `已发送 QQ 音乐链接 (mid: ${mid})，卡片发送失败: ${sendErr.message}`
      }

      return `✅ 已发送：${title} - ${singer}`

    } catch (err) {
      console.error('[SendMusic]', err)
      // 最终降级
      try {
        const jumpUrl = `https://y.qq.com/n/yqq/song/${mid}.html`
        await e.reply(`[QQ音乐分享] ${jumpUrl}`, true)
        return `已发送 QQ 音乐链接 (mid: ${mid})`
      } catch (err2) {
        return `发送音乐失败: ${err2.message}`
      }
    }
  }
}

// ========== 辅助函数 ==========

async function getTrackInfo(mid) {
  try {
    const auth = musicAuth()
    const music = readMusicConfig() || {}
    const guid = music.guid || stableMusicGuid(auth.uin)
    const body = {
      comm: { ct: 24, cv: 0, uin: auth.uin, guid, format: 'json', authst: auth.authst },
      song_detail: {
        module: 'music.pf_song_detail_svr',
        method: 'get_song_detail',
        param: { song_mid: mid }
      }
    }
    const response = await fetchWithTimeout('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      // 过期 Cookie 会让歌曲详情接口直接拒绝请求，鉴权信息放在 comm 中即可。
      headers: { 'Content-Type': 'application/json', Cookie: '' },
      body: JSON.stringify(body)
    })
    if (!response.ok) throw new Error(`歌曲详情 HTTP ${response.status}`)
    const res = await response.json()

    const info = res.song_detail?.data?.track_info
    if (info && info.id > 0) {
      return {
        title: info.title || info.name,
        id: info.id,
        singer: info.singer?.map(s => s.name).join('/') || '',
        album_mid: info.album?.mid,
        singer_mid: info.singer?.[0]?.mid,
        media_mid: info.file?.media_mid,
        file: info.file
      }
    }
  } catch (e) {
    console.error('[SendMusic] getTrackInfo:', e)
  }
  return null
}

function getCoverUrl (track) {
  if (track?.album_mid) {
    return `https://y.qq.com/music/photo_new/T002R300x300M000${track.album_mid}.jpg?max_age=2592000`
  }
  if (track?.singer_mid) {
    return `https://y.qq.com/music/photo_new/T001R300x300M000${track.singer_mid}.jpg?max_age=2592000`
  }
  return 'https://y.qq.com/mediastyle/global/img/album_300.png'
}

function createNativeMusicSegment (songId) {
  return makeMusicSegment('qq', songId)
}

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

async function sendLinkFallback (e, mid, track) {
  const title = track?.title || 'QQ音乐分享'
  const singer = track?.singer || '未知歌手'
  return e.reply(`[QQ音乐分享] ${title} - ${singer}\nhttps://y.qq.com/n/yqq/song/${mid}.html`, true)
}

async function getPlayUrl(mid, track) {
  const auth = musicAuth()
  const music = readMusicConfig() || {}
  const guid = music.guid || stableMusicGuid(auth.uin)
  const sessionGuid = createHash('md5').update(String(Date.now())).digest('hex')
  const param = {
    guid: sessionGuid,
    songmid: [mid],
    songtype: [0],
    uin: '0',
    loginflag: 1,
    platform: '20',
    ctx: 1
  }

  if (track?.media_mid && track?.file) {
    const { file, media_mid } = track
    if (file.size_320mp3 > 0) param.filename = [`M800${media_mid}.mp3`]
    else if (file.size_128mp3 > 0) param.filename = [`M500${media_mid}.mp3`]
  }

  try {
    const body = {
      comm: {
        ct: 19,
        cv: 1891,
        uin: auth.uin,
        guid,
        format: 'json',
        authst: auth.authst,
        tmeAppID: 'qqmusic',
        tmeLoginType: 2
      },
      req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param }
    }
    const response = await fetchWithTimeout('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: '' },
      body: JSON.stringify(body)
    })
    if (!response.ok) throw new Error(`播放地址 HTTP ${response.status}`)
    const res = await response.json()

    const purl = res.req_0?.data?.midurlinfo?.find(m => m.purl)?.purl
    if (purl) {
      const sip = res.req_0?.data?.sip || []
      const rawPrefix = sip.find(s => s.startsWith('https://')) || sip[0] || 'https://ws.stream.qqmusic.qq.com/'
      const prefix = rawPrefix.replace(/^http:\/\//i, 'https://')
      return prefix + purl
    }
  } catch (e) {
    console.error('[SendMusic] getPlayUrl:', e)
  }
  return null
}

export default new SendMusic()
