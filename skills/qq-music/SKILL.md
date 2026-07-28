---
name: qq-music
description: 搜索 QQ 音乐并向当前 QQ 会话发送音乐分享卡片。
allowed-tools: search_music send_music
---

# QQ Music

用户提出搜歌、点歌或发送音乐卡片时使用。

1. 先调用 `search_music` 获取歌曲 `mid`。
2. 根据用户指定或最匹配的结果调用 `send_music`。
3. 搜索结果不明确时先让用户选择，不要随意发送错误歌曲。
