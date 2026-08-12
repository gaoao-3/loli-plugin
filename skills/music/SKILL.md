---
name: music
description: >-
  点歌、听歌、找歌或搜歌，并向当前 QQ 会话发送音乐分享卡片；支持按歌曲名或歌手从网易云、酷狗、酷我查找。
  用户说“点歌、听歌、找歌、搜歌、来一首”，或要求发送音乐卡片时使用。Use for requests to play or find a song, or send a music card.
allowed-tools: search_music send_music
---

# Music

1. 先调用 `search_music` 获取歌曲 `id` 和平台 `server`。
2. 根据用户指定或最匹配的结果调用 `send_music`，`server` 必须与搜索时一致，并原样带上 `title` / `singer`。
3. 搜索结果不明确时先让用户选择，不要随意发送错误歌曲。
4. 提示无播放链接（VIP）或搜不到时，换其他平台（netease / kugou / kuwo）重新搜索再试。
