/**
 * QQ 音乐卡片发送工具
 * 使用 OneBot v11 send_group_msg / send_private_msg
 * 获取真实播放链接 + 专辑封面，发送 custom music 段
 */
import { createHash } from 'node:crypto'
import { CustomTool } from 'lolicon-core'

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
        // 没有播放链接，发分享链接降级
        const jumpUrl = `https://y.qq.com/n/yqq/song/${mid}.html`
        await e.reply(`[QQ音乐分享] ${jumpUrl}`, true)
        return `已发送 QQ 音乐链接 (mid: ${mid})，无法获取播放链接`
      }

      const title = track?.title || 'QQ音乐分享'
      const singer = track?.singer || '点击播放'

      // 专辑封面
      let picUrl = ''
      if (track?.album_mid) {
        picUrl = `http://y.gtimg.cn/music/photo_new/T002R300x300M000${track.album_mid}.jpg`
      } else if (track?.singer_mid) {
        picUrl = `http://y.gtimg.cn/music/photo_new/T001R300x300M000${track.singer_mid}.jpg`
      } else {
        picUrl = `http://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg`
      }

      // 2. 构建 custom music 段
      const musicSegment = {
        type: 'music',
        data: {
          type: 'custom',
          url: `https://y.qq.com/n/yqq/song/${mid}.html`,
          audio: playUrl,
          title,
          image: picUrl,
          singer
        }
      }

      // 3. 发送：优先 OneBot v11 API，降级 reply
      const bot = e.bot || (typeof Bot !== 'undefined' ? Bot : null)
      const isGroup = e.isGroup || !!e.group_id

      try {
        if (bot?.sendApi) {
          if (isGroup) {
            const groupId = e.group_id || e.sender?.group_id
            await bot.sendApi('send_group_msg', {
              group_id: groupId,
              message: [musicSegment]
            })
          } else {
            const userId = e.sender?.user_id || e.user_id
            await bot.sendApi('send_private_msg', {
              user_id: userId,
              message: [musicSegment]
            })
          }
        } else if (bot?.sendGroupMsg && isGroup) {
          await bot.sendGroupMsg(e.group_id, [musicSegment])
        } else if (bot?.sendPrivateMsg && !isGroup) {
          await bot.sendPrivateMsg(e.sender?.user_id || e.user_id, [musicSegment])
        } else {
          await e.reply([musicSegment], true)
        }
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
    const body = {
      comm: { ct: 24, cv: 0, uin: '0', format: 'json', authst: '' },
      song_detail: {
        module: 'music.pf_song_detail_svr',
        method: 'get_song_detail',
        param: { song_mid: mid }
      }
    }
    const res = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(r => r.json())

    const info = res.song_detail?.data?.track_info
    if (info && info.id > 0) {
      return {
        title: info.title || info.name,
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

async function getPlayUrl(mid, track) {
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
    const quality = [
      ['size_flac',   'F000', 'flac'],
      ['size_320mp3', 'M800', 'mp3'],
      ['size_128mp3', 'M500', 'mp3'],
      ['size_96aac',  'C400', 'm4a']
    ]
    const filenames = []
    for (const [key, prefix, ext] of quality) {
      if (file[key] > 0) filenames.push(`${prefix}${media_mid}.${ext}`)
    }
    if (filenames.length) param.filename = filenames
  }

  try {
    const body = {
      comm: { ct: '19', cv: 1891, uin: '0', tmeAppID: 'qqmusic', tmeLoginType: 2 },
      req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param }
    }
    const res = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(r => r.json())

    const purl = res.req_0?.data?.midurlinfo?.find(m => m.purl)?.purl
    if (purl) {
      const sip = res.req_0?.data?.sip || []
      const prefix = sip.find(s => !s.startsWith('https')) || sip[0] || 'http://ws.stream.qqmusic.qq.com/'
      return prefix + purl
    }
  } catch (e) {
    console.error('[SendMusic] getPlayUrl:', e)
  }
  return null
}

export default new SendMusic()
