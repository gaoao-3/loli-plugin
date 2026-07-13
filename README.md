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
- 🧠 用 SQLite + Markdown 摘要 + 语义向量召回记住你的喜好
- 🛠️ 本地工具热加载，即传即用，不用宝宝动手
- 🎵 支持 QQ 音乐账户、VIP 检测、Cookie 刷新和音乐工具
- 🖥️ 内置 Web 管理面板，支持访问令牌保护

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

SQLite 消息库 + Markdown 摘要
<br>群/用户画像与语义向量召回

</td>
</tr>
<tr>
<td align="center">

### 🛠️ 工具热加载

本地工具文件自动发现
<br>面板一键上传/重载/禁用

</td>
<td align="center">

### 🖥️ Web 面板

随 Yunzai 启动自动运行
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
> 依赖中的 `lolicon-core` 直接跟随其 GitHub 主仓库，无需再应用本地补丁。

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
          "apiKey": "把你的 API Key 放在这里啦，宝宝！"
        },
        "status": "enabled"
      }
    ]
  }
}
```

也可以启动后通过 Web 管理面板配置渠道、模型和预设。修改运行配置后建议重启 Yunzai。

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

### 面板能做什么？

| 模块 | 功能 |
|------|------|
| 📊 总览 | 系统状态、渠道数、工具数、运行时间 |
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

当前记忆链路由三层组成：

1. SQLite 保存原始消息、摘要、画像、记忆块和向量数据。
2. Markdown 保存按天整理的可读摘要，默认目录为 `data/memory/md`。
3. Gemini Embedding 提供语义召回，可在面板中调整模型、维度、Top K 和最低相似度。

群聊记忆、群内用户记忆和私聊用户记忆相互隔离。摘要默认每小时处理，画像按日更新。

· · ─────── ・✦・ ─────── · ·

<div align="center">

## 🏠 萝莉妈妈的家 🏠

</div>

```text
🌸 loli-plugin/
├── 📁 apps/              # 群聊/私聊消息处理模块
├── 📁 config/            # 默认配置文件
│   └── config.js
├── 📁 dashboard/         # 🖥️ Web 管理面板
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── 📁 memory/            # 🧠 记忆系统
│   ├── store.js          # SQLite 存储
│   ├── embedding.js      # 语义向量
│   └── scheduler.js      # 摘要与画像调度
├── 📁 server/            # 🌐 HTTP 服务 + REST API
│   ├── index.js
│   └── api/
├── 📁 utils/             # 🛠️ 工具函数与本地工具
│   ├── reply.js          # AI 自主分段与发送
│   └── tools/            # AI 工具
├── index.js              # 🔌 插件入口
├── package.json          # 📦 依赖配置
├── pnpm-lock.yaml        # 🔒 依赖锁文件
└── pnpm-workspace.yaml   # pnpm 构建配置
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
- 新增内置 Web 管理面板
- 新增本地工具热加载与上传
- 新增 SQLite + Markdown + Embedding 长期记忆
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
