<div align="center">

✦ 🎀 · 💠 · 🍼 · 💠 · 🎀 ✦

# 🍼 萝莉妈妈の loli-plugin 🎀

<h3>乖宝宝，让麻麻来照顾你的 Yunzai 叭～</h3>

<p><strong>基于 lolicon-core 引擎 · 自然群聊 · 长期记忆 · 可视化管理</strong></p>

<p>
  <img src="https://img.shields.io/github/v/release/gaoao-3/loli-plugin?style=for-the-badge&labelColor=E3F2FD&color=1976D2">
  <img src="https://img.shields.io/github/downloads/gaoao-3/loli-plugin/total?style=for-the-badge&labelColor=E3F2FD&color=42A5F5">
  <img src="https://img.shields.io/badge/🍡-Node.js%20≥22-90CAF9?style=for-the-badge&labelColor=E3F2FD&color=64B5F6">
  <img src="https://img.shields.io/badge/💝-MIT%20License-BBDEFB?style=for-the-badge&labelColor=E3F2FD&color=90CAF9">
</p>

<p>
  <img src="https://img.shields.io/github/stars/gaoao-3/loli-plugin?style=social&color=1976D2">
  <img src="https://img.shields.io/github/forks/gaoao-3/loli-plugin?style=social&color=1976D2">
</p>

> 💙 *「Sensei！这边的任务已经 100% 完成了哦，萝莉妈妈随时待命～」* 💙
> <br>—— 基沃托斯 · 萝莉妈妈风纪委员会

✦ 💠 · 🎀 · 🍼 · 🎀 · 💠 ✦

</div>

· · ─────── ・✦・ ─────── · ·

<div align="center">

## 🎀 嗨呀，宝宝好呀～ 🎀

</div>

**loli-plugin** 是一只专为 Yunzai 生态设计的 AI 聊天插件，支持 **Miao-Yunzai + icqq**，并保留 TRSS-Yunzai 兼容性 ✨

它由最会照顾人的 **萝莉妈妈** 亲自守护（蹭蹭），底层驱动是咱家自研的 [lolicon-core](https://github.com/gaoao-3/lolicon-core) AI 引擎。

相比那些笨重的前辈，loli-plugin 就像一个贴心的 babysitter：

- 💬 AI 自主判断消息分段，长回复不再像公告一样一次塞满
- 🧠 用 SQLite 摘要、角色主观记忆和语义向量召回延续互动
- 🛠️ 本地工具热加载，即传即用，不用宝宝动手
- 🎵 支持 QQ 音乐账户、VIP 检测、Cookie 刷新和音乐工具
- 🖥️ 使用 lolicon-core 自带 Web 管理面板，支持访问令牌保护

一句话：**更轻、更快、更会被抱抱～** (｡･ω･｡)ﾉ♡

· · ─────── ・✦・ ─────── · ·

<div align="center">

## 🌟 萝莉妈妈会什么 🌟

</div>

<div align="center">

<table>
<tr>
<td align="center" width="33%">

### 🤖 AI 对话

支持 Gemini / OpenAI 多渠道接入
<br>工具调用循环，聪明又懂事

</td>
<td align="center" width="33%">

### 🎭 伪人模式

@ / 前缀 / 关键词 / 主动触发
<br>AI 自主分段、冷却与会话复用

</td>
<td align="center" width="33%">

### 🧠 记忆系统

SQLite 消息库 + 身份账本
<br>客观画像、角色主观记忆与语义召回

</td>
</tr>
<tr>
<td align="center">

### 🛠️ 工具热加载

本地工具文件自动发现
<br>core 面板一键上传/重载/禁用

</td>
<td align="center">

### 🖥️ Web 面板

由 lolicon-core 提供并随 Yunzai 启动
<br>无需单独起服务

</td>
<td align="center">

### 🎵 QQ 音乐

账户状态、VIP 检测与自动刷新
<br>AI 可自主搜索和发送音乐

</td>
</tr>
</table>

</div>

· · ─────── ・✦・ ─────── · ·

<div align="center">

## 🚀 宝宝跟我上车车 🚀

</div>

### 1. 克隆到插件目录

```bash
# 进入 Miao-Yunzai 插件目录
cd /path/to/Miao-Yunzai/plugins

# 把萝莉妈妈抱回家
git clone https://github.com/gaoao-3/loli-plugin.git

# 安装依赖
cd loli-plugin
pnpm install
```

> Miao-Yunzai 的 icqq 由宿主或 ICQQ-Plugin 提供，loli-plugin 不会重复安装另一份客户端。
> 依赖中的 `lolicon-core` 直接锁定其 GitHub 主仓库提交，无需本地补丁；面板和引擎升级由 core 仓库统一发布。

### 2. 启动或重启 Yunzai

```bash
node app.js
```

### 3. 修改 API Key

首次启动后，编辑 `loli-plugin/data/config.json`：

```json
{
  "chaite": {
    "channels": [
      {
        "id": "gemini",
        "name": "Gemini",
        "adapterType": "gemini",
        "models": ["gemini-2.5-flash", "gemini-2.5-pro"],
        "options": {
          "apiKey": "把你的 API Key 放在这里啦，宝宝！",
          "safetyLevel": "balanced"
        },
        "status": "enabled"
      }
    ]
  }
}
```

也可以启动后通过 Web 管理面板配置渠道、模型和预设。修改运行配置后建议重启 Yunzai。

Gemini 渠道的 `safetyLevel` 支持 `default`（模型默认）、`off`（关闭附加过滤）、`permissive`（仅高风险拦截）、`balanced`（中高风险拦截）和 `strict`（低风险起拦截）。该设置会同时用于正常聊天与记忆提炼，并统一覆盖骚扰、仇恨、露骨内容和危险内容四类可调过滤器；Gemini 的核心安全保护不受此设置影响。

### 4. 开启伪人模式

伪人模式默认关闭。可在管理面板的「配置」页面开启，也可修改 `data/config.json`：

```json
{
  "loli": {
    "enable": true,
    "enableAtTrigger": true,
    "enablePrefixTrigger": true,
    "triggerPrefix": ["#ai"],
    "segmentedReply": {
      "enable": true,
      "maxLength": 48,
      "maxSegments": 5,
      "delayMin": 500,
      "delayMax": 1200
    }
  }
}
```

开启自主分段后，插件会提示 AI 按语义决定是否拆成多条消息。普通换行只用于排版清理；AI 未主动分段且回复过长时，才由本地规则兜底切分。

如需让 AI 明确识别机器人主人，并使用固定称呼，可追加：

```json
{
  "loli": {
    "masterIdentity": {
      "userIds": ["主人QQ号"],
      "appellation": "老师"
    }
  }
}
```

插件也会读取宿主事件的 `isMaster` 自动识别主人。群友身份始终以 QQ 号为唯一主键，群名片、昵称、群角色和头衔只作为补充信息，避免同名成员或改名后画像串位。`#群记忆`、`#群画像`、`#我的记忆`、`#我的画像` 会以合并转发形式展示，长内容按段落拆分，不再直接截断。

· · ─────── ・✦・ ─────── · ·

<div align="center">

## 🎮 指令列表 🎮

</div>

| 指令 | 说明 |
|------|------|
| `#ai <你想说的话>` | 触发 AI 对话（需配置触发前缀） |
| `#loli帮助` | 查看插件帮助信息 |
| `#loli状态` | 查看当前运行状态 |
| `#群记忆` / `#群画像` | 查看本群摘要或画像 |
| `#我的记忆` / `#我的画像` | 查看当前用户摘要或画像 |
| `#记忆诊断` | 查看记忆任务及向量统计（仅主人） |
| `#立即摘要` | 立即处理待摘要记忆（仅主人） |
| `#群风格` / `#群学习状态` | 查看客观群文化、角色主观记忆与版本状态 |
| `#立即学习群风格` | 立即审查本群新增消息（仅主人） |
| `#群风格回滚 <版本>` | 恢复指定群风格版本并生成新版本（仅主人） |
| `#我的身份` | 查看当前 QQ 的平台身份账本与可信历史名称 |
| `#身份查询 <QQ>` | 查询指定群友的身份账本（仅主人） |
| `#QQ音乐状态` | 查看 QQ 音乐账户状态（仅主人） |
| `#QQ音乐cookie <Cookie>` | 私聊导入 QQ 音乐 Cookie（仅主人） |
| `#刷新QQ音乐` | 手动刷新 QQ 音乐 Cookie（仅主人） |
| `#QQ音乐vip检测` | 检查当前 QQ 音乐 VIP 权限（仅主人） |
| `#loli更新` | 从 GitHub 拉取更新 |
| `#loli强制更新` | 强制更新插件 |

> 💡 在群聊里直接 @ 机器人或按配置的触发方式也可以唤醒萝莉妈妈哦！
> 🔐 Cookie 必须由主人私聊导入，请勿在群聊或公开日志中发送。

· · ─────── ・✦・ ─────── · ·

<div align="center">

## 🖥️ 管理面板 🖥️

</div>

启动 Yunzai 后，浏览器访问：

```text
http://localhost:3000
```

✨ 面板会自动启动，不需要宝宝单独跑服务！✨

面板静态资源、Vue 源码、HTTP 服务与 REST API 均位于 `lolicon-core`；本插件只在 [utils/state.js](utils/state.js) 中向引擎注入插件配置、运行日志、工具目录、宿主 Bot 和 SQLite 记忆统计。插件卸载时由 `engine.destroy()` 一并关闭面板，因此更新面板不再改动插件业务代码。

### 面板能做什么？

| 模块 | 功能 |
|------|------|
| 📊 总览 | 系统状态、渠道数、工具数、运行时间 |
| 💬 对话 | 选择预设、模拟用户/群号、调试完整消息管道和历史 |
| 🔌 渠道 | 查看/编辑/启用禁用 AI 渠道 |
| 🎭 预设 | 管理角色预设和系统提示词 |
| 🛠️ 工具 | 热重载、上传新工具、启用禁用 |
| 🧠 记忆 | 记忆实体与关系统计 |
| ⚙️ 配置 | 触发方式、AI 分段、会话、记忆与系统参数 |
| 📜 日志 | 查看运行日志与模型响应摘要 |

### 面板配置

```json
{
  "dashboard": {
    "enable": true,
    "port": 3000,
    "host": "0.0.0.0",
    "authToken": "请设置一段随机长字符串"
  }
}
```

`authToken` 为空时面板不校验身份。如果监听在 `0.0.0.0` 或通过公网访问，强烈建议设置令牌；端口冲突时可修改 `dashboard.port`。

### 记忆系统

当前记忆链路由六层组成：

1. SQLite 旁听并去重保存合格群消息，同时隔离群、群内用户和私聊用户记忆。
2. QQ 身份账本只接受宿主事件和群成员资料，以 QQ 为稳定主键，记录可信历史名称并检测同名或主人冒充风险。
3. `memory.groupLearning.perspectivePresetId` 可固定主观记忆的角色预设；留空时跟随 `loli.defaultPreset`。每份主观记忆都记录角色 ID，切换角色后不会注入其他角色的主观记忆。
4. 用户与群事实画像保存长期客观事实；Gemini Embedding 负责按当前话题召回相关历史。
5. 自适应群聊后台先提取带消息证据的客观观察，再让当前角色设定从第一人称形成可修正的主观记忆和未来策略。

### QQ 表情库

- 主人直接发送的小黄脸、超级表情、收藏表情和图片表情可自动收录到 `data/stickers.sqlite`。
- 动画/图片表情会进入后台视觉识别队列，由当前模型生成情绪、动作和适用场景标签；识别失败不影响原始表情入库。
- 回复表情发送 `#收录表情 无语 嫌弃` 可补充语义标签；`#表情库` 查看已收录内容。
- AI 可在最终回复的任意自然位置选择性输出隐藏的 `[sticker:情绪]` 标记，发送层会移除标记；普通 QQ 小黄脸会在标记所在位置拼进同一条正文消息，超级表情和图片表情才单独发送。
- 发送层只接受表情库中的真实语义标签；未命中不会随机发送。默认 35% 的回合向模型开放表情选择，同一会话冷却 60 秒；模型一旦选择合法表情就会发送，不再二次随机丢弃。
- ICQQ 对原生超级表情可能返回成功但不实际落消息；当前 `stickers.nativeSuperface` 默认开启，若出现“日志成功但客户端不可见”，可设为 `false` 降级发送。
- QQ 客户端的收藏夹和推荐页不能直接读取；商城或推荐表情需先由用户发送给机器人，再保存原始消息段复用。
6. 群级自适应设定独立于核心角色预设；所有更新受证据、置信度和容量限制，保留版本并支持回滚。

群风格首次默认需要 100 条有效消息、5 位不同成员，之后每新增 50 条复审一次。单人样本会被限流，命令、纯表情和疑似提示词注入不会参与风格学习。角色主观记忆的置信度不能高于其客观证据，聊天里的身份自述也不能修改 QQ 身份。可在管理面板「配置 → 记忆」中调整学习阈值。摘要默认每小时处理，事实画像按日更新，后台反思不阻塞正常回复。

· · ─────── ・✦・ ─────── · ·

<div align="center">

## 🏠 萝莉妈妈的家 🏠

</div>

```text
🌸 loli-plugin/
├── 📁 apps/              # 群聊/私聊消息处理模块
├── 📁 config/            # 默认配置文件
│   └── config.js
├── 📁 memory/            # 🧠 记忆系统
│   ├── store.js          # SQLite 存储
│   ├── embedding.js      # 语义向量
│   ├── identity.js       # QQ 身份账本与防冒充提示
│   ├── group-learning.js # 客观观察/角色主观反思闭环
│   └── scheduler.js      # 摘要与画像调度
├── 📁 utils/             # 🛠️ 工具函数与本地工具
│   ├── reply.js          # AI 自主分段与发送
│   └── tools/            # AI 工具
├── index.js              # 🔌 插件入口
├── package.json          # 📦 依赖配置
└── pnpm-lock.yaml        # 🔒 依赖锁文件
```

· · ─────── ・✦・ ─────── · ·

<div align="center">

## 🔗 好朋友的链接 🔗

</div>

<p align="center">
  <a href="https://github.com/gaoao-3/lolicon-core">🌸 lolicon-core</a> ·
  <a href="https://github.com/ikechan8370/chatgpt-plugin">💬 chatgpt-plugin（原版）</a> ·
  <a href="https://github.com/ikechan8370/node-chaite">⚙️ node-chaite（原版）</a>
</p>

· · ─────── ・✦・ ─────── · ·

<div align="center">

## 📝 成长日记 📝

</div>

### 🍼 v0.1.0

- 基于 lolicon-core 重构插件
- Web 管理面板迁移至 lolicon-core，与插件业务代码分离
- 新增本地工具热加载与上传
- 新增 SQLite + Embedding 长期记忆
- 新增 AI 自主分段回复与本地超长兜底
- 新增 Miao-Yunzai / TRSS-Yunzai 消息兼容层
- 新增 QQ 音乐账户管理、VIP 检测和自动刷新
- `lolicon-core` 支持本轮系统提示覆盖与模型响应摘要日志

· · ─────── ・✦・ ─────── · ·

<div align="center">

## 📄 许可证 📄

<p>
  <a href="LICENSE">MIT License</a>
</p>

✦ 🎀 · 💠 · 🍼 · 💠 · 🎀 ✦

<p align="center">
  <strong>crafted with 🍼 by gaoao-3</strong>
</p>

<p align="center">
  <em>「老师乖乖待着就好，萝莉妈妈会全部处理好的～」</em>
</p>

<p align="center">
  <em>💕 抱抱老师，摸摸头 💕</em>
</p>

</div>
