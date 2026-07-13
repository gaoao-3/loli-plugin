import { asyncLocalStorage, CustomTool } from 'chaite'
import fetch from 'node-fetch'
import md5 from 'md5'
import fs from 'fs'
import path from 'path'

const CONFIG_PATH = path.join(process.cwd(), 'plugins', 'example', 'qq_config.json')

class SendMusicTool extends CustomTool {
  name = 'sendMusic'
  function = {
    name: 'sendMusic',
    description: 'Send QQ Music card (OIDB). Requires ID (mid) from searchMusic.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Music MID (e.g. 004XqlYb0VPIUb)' },
        targetGroupIdOrQQNumber: { type: 'string', description: 'Target ID' }
      },
      required: ['id']
    }
  }

  getConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
      }
    } catch (e) { return {} }
    return {}
  }

  async run(args) {
    const context = asyncLocalStorage.getStore()
    const e = context.getEvent()
    let { id, targetGroupIdOrQQNumber } = args

    try {
      const config = this.getConfig()
      const cookie = config.cookie_str || ''
      const uin = String(config.uin || '0')
      const authst = config.qqmusic_key || ''
      // 【关键】直接读取 Config 里的 GUID，确保与刷新时的一致
      const guid = config.guid || md5(uin + 'music')

      if (uin === '0' || !cookie) {
        console.warn('[SendMusic] ⚠️ 警告: 配置缺失')
      }
      
      // 1. 获取详情 (已修复接口)
      const track = await getTrackInfo(id, cookie, uin, authst, guid)
      
      // 2. 获取链接
      const playUrl = await getPlayUrl(id, track, uin, authst, guid)

      if (!playUrl) return `无法获取播放链接 (ID: ${id})，请检查 VIP 状态或 Cookie。`

      const title = track?.title || "QQ音乐分享"
      const singer = track?.singer || "点击播放"
      
      let picUrl = ''
      if (track?.album_mid) {
        picUrl = `http://y.gtimg.cn/music/photo_new/T002R300x300M000${track.album_mid}.jpg`
      } else if (track?.singer_mid) {
        picUrl = `http://y.gtimg.cn/music/photo_new/T001R300x300M000${track.singer_mid}.jpg`
      } else {
        picUrl = `http://y.gtimg.cn/music/photo_new/T002R300x300M000${id}.jpg`
      }

      const musicData = {
        name: title,
        artist: singer,
        prompt: "[分享]QQ音乐",
        jumpUrl: `https://y.qq.com/n/yqq/song/${id}.html`,
        pic: picUrl,
        url: playUrl
      }

      // OIDB 构造
      let targetObj = e
      let recv_uin = 0; let send_type = 0 
      if (e.isGroup && (!targetGroupIdOrQQNumber || targetGroupIdOrQQNumber == e.group_id)) {
        recv_uin = e.group.gid || e.group_id; send_type = 1; targetObj = e.group
      } else if (targetGroupIdOrQQNumber) {
        const t = Number(targetGroupIdOrQQNumber)
        const g = e.bot.pickGroup(t)
        if (g && g.gid) { recv_uin = t; send_type = 1; targetObj = g }
        else { recv_uin = t; send_type = 0; targetObj = e.bot.pickFriend(t) }
      } else {
        recv_uin = e.friend?.uin || e.user_id; send_type = 0; targetObj = e.friend || e
      }

      if (!e.bot.sendOidb) return "Bot不支持OIDB"

      const body = {
        1: 100497308, 2: 1, 3: 4,
        5: { 1: 1, 2: "0.0.0", 3: "com.tencent.qqmusic", 4: "cbd27cd7c861227d013a25b2d10f0799" },
        6: "", 10: send_type, 11: recv_uin,
        12: {
          10: musicData.name, 11: musicData.artist, 12: musicData.prompt,
          13: musicData.jumpUrl, 14: musicData.pic, 16: musicData.url
        },
        19: 0
      }

      let core = global.core
      if (!core) { try { core = (await import('icqq')).core } catch(err) {} }
      if (!core || !core.pb) return "Core库缺失"

      const payload = await e.bot.sendOidb("OidbSvc.0xb77_9", core.pb.encode(body))
      const result = core.pb.decode(payload)
      if (result[3] !== 0) return `发送被拒 (Code: ${result[3]})`

      return `已发送: ${musicData.name}`

    } catch (err) {
      console.error(err)
      return `错误: ${err.message}`
    }
  }
}

// 获取详情 (修复版)
async function getTrackInfo(mid, cookie, uin, authst, guid) {
  try {
    const body = {
      "comm": { 
        "ct": 24, 
        "cv": 0, 
        "uin": uin, 
        "guid": guid, 
        "format": "json", 
        "authst": authst 
      },
      "song_detail": { 
        "module": "music.pf_song_detail_svr", 
        "method": "get_song_detail", 
        "param": { "song_mid": mid } 
      }
    }
    
    // 同样使用置空 Cookie 的技巧来规避过期 Cookie 的干扰
    const res = await fetch(`https://u.y.qq.com/cgi-bin/musicu.fcg`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/json', 'Cookie': '' },
      body: JSON.stringify(body)
    }).then(r => r.json())
    
    // 接口返回结构：res.song_detail.data.track_info (对象)
    const info = res.song_detail?.data?.track_info
    
    if (info && info.id > 0) {
      return {
        title: info.title || info.name,
        singer: info.singer?.map(s => s.name).join('/') || "",
        album_mid: info.album?.mid,
        singer_mid: info.singer?.[0]?.mid,
        media_mid: info.file?.media_mid, 
        file: info.file 
      }
    } else {
        console.log(`[SendMusic] ❌ 获取详情失败: ${mid}`, JSON.stringify(res))
    }
  } catch(e) {
      console.error(`[SendMusic] ❌ 详情接口报错:`, e)
  }
  return null
}

// 获取播放链接
async function getPlayUrl(mid, track, uin, authst, guid) {
  const sessionGuid = md5(String(new Date().getTime()))

  const baseReq = {
    "module": "vkey.GetVkeyServer", 
    "method": "CgiGetVkey", 
    "param": { 
      "guid": sessionGuid, 
      "songmid": [mid], 
      "songtype": [0], 
      "uin": "0", 
      "loginflag": 1, 
      "platform": "20",
      "ctx": 1 
    }
  }

  if (track?.media_mid && track?.file) {
    const file = track.file
    const media_mid = track.media_mid
    if (file.size_320mp3 > 0) {
      baseReq.param.filename = [`M800${media_mid}.mp3`]
      console.log(`[SendMusic] 🎵 尝试 M800 (320k)...`)
    } else if (file.size_128mp3 > 0) {
      baseReq.param.filename = [`M500${media_mid}.mp3`]
    }
  }

  const body = {
    "comm": { 
      "uin": uin, 
      "format": "json", 
      "ct": 19, 
      "cv": 1891,
      "guid": guid, 
      "authst": authst, 
      "tmeAppID": "qqmusic",
      "tmeLoginType": 2
    },
    "req_0": baseReq
  }

  try {
    const res = await fetch(`https://u.y.qq.com/cgi-bin/musicu.fcg`, {
      method: 'POST', 
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': '' },
      body: JSON.stringify(body)
    }).then(r => r.json())
    
    const purl = res.req_0?.data?.midurlinfo?.[0]?.purl
    if (purl) {
      if (purl.startsWith('M800')) console.log(`[SendMusic] 🎉 成功 (M800)`)
      else if (purl.startsWith('C400')) console.log(`[SendMusic] ⚠️ 降级 (C400)`)
      
      let prefix = 'http://ws.stream.qqmusic.qq.com/'
      const sip = res.req_0?.data?.sip
      if (sip && sip.length > 0) prefix = sip.find(s => !s.startsWith('https')) || sip[0]
      
      return prefix + purl
    } else {
       console.log(`[SendMusic] ❌ 获取URL失败 (Code: ${res.req_0?.code})`)
    }
  } catch (e) {
    console.error(e)
  }
  return null
}

export default new SendMusicTool()
