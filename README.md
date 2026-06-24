<div align="center">

![Banner](https://raw.githubusercontent.com/gaoao-3/loli-plugin/main/assets/banner.png)

![Sakura Falling](https://raw.githubusercontent.com/gaoao-3/loli-plugin/main/assets/sakura.gif)

# 🍼🌸 萝莉妈妈の loli-plugin 🌸🍼

<h3>乖宝宝，让麻麻来照顾你的 Yunzai 叭～</h3>
<p><strong>基于 lolicon-core 引擎 · 轻量 · 可爱 · 会帮你操心一切</strong></p>

<p>
  <img src="https://img.shields.io/badge/🎀-Blue%20Archive%20style-2196F3?style=for-the-badge&labelColor=E3F2FD&color=2196F3">
  <img src="https://img.shields.io/badge/🌸-Loli%20Mommy%20Power-ff9aa2?style=for-the-badge&labelColor=ffccd5&color=ff9aa2">
</p>

<p>
  <img src="https://img.shields.io/github/v/release/gaoao-3/loli-plugin?style=for-the-badge&labelColor=ffccd5&color=ff9aa2">
  <img src="https://img.shields.io/github/downloads/gaoao-3/loli-plugin/total?style=for-the-badge&labelColor=ffccd5&color=ffb7b2">
  <img src="https://img.shields.io/badge/🍡-Node.js%20≥22-ffdac1?style=for-the-badge&labelColor=ffccd5&color=ffdac1">
  <img src="https://img.shields.io/badge/💝-MIT%20License-e2f0cb?style=for-the-badge&labelColor=ffccd5&color=e2f0cb">
</p>

<p>
  <img src="https://img.shields.io/github/stars/gaoao-3/loli-plugin?style=social&color=ff9aa2">
  <img src="https://img.shields.io/github/forks/gaoao-3/loli-plugin?style=social&color=ff9aa2">
</p>

> 🌸 *「笨蛋老师乖～不要乱跑，交给萝莉妈妈就好啦～」* 🌸

> 💙 *「Sensei！这边的任务已经 100% 完成了哦，萝莉妈妈随时待命～」* 💙
> <br>—— 基沃托斯 · 萝莉妈妈风纪委员会

<pre style="color:#ff9aa2; font-family:monospace; line-height:1.2; font-size:12px; background:transparent; border:none; margin:0;">
　　　🌸　　　　　　　　　🌸　　　　　🌸
🌸　　　　　　　　　🌸　　　　　　　　🌸　　　🌸
　　　🌸　　　　　　　　　🌸　　　🌸　　　　　🌸
　　　　　　　🌸　　　　　　　　　🌸　　　　　🌸
</pre>

</div>

---

<div align="center">

## 🎀 嗨呀，宝宝好呀～ 🎀

</div>

**loli-plugin** 是一只专为 [Yunzai-Bot](https://github.com/Le-niao/Yunzai-Bot) 设计的 AI 聊天插件 ✨

它由最会照顾人的 **萝莉妈妈** 亲自守护（蹭蹭），底层驱动是咱家自研的 [lolicon-core](https://github.com/gaoao-3/lolicon-core) AI 引擎。

相比那些笨重的前辈，loli-plugin 就像一个贴心的 babysitter：

- 🗑️ 丢掉 SQLite / LowDB / triggers / processors 这些包袱
- 📝 用纯 Markdown + 结构化记忆图谱记住你的喜好
- 🛠️ 本地工具热加载，即传即用，不用宝宝动手
- 🖥️ 内置 Web 管理面板，随 Yunzai 启动自动运行，麻麻帮你开好门

一句话：**更轻、更快、更会被抱抱～** (｡･ω･｡)ﾉ♡

---

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

群聊自然回复、主动发言
<br>冷却控制、会话复用

</td>
<td align="center" width="33%">

### 🧠 记忆系统

每日 Markdown + 记忆图谱
<br>自动提取实体/关系/事件

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

### 🔧 零原生依赖

纯 JS，无 SQLite 等 native 依赖
<br>部署简单，维护轻松

</td>
</tr>
</table>

</div>

---

<div align="center">

## 🚀 宝宝跟我上车车 🚀

</div>

### 1. 克隆到插件目录

```bash
# 进入 Yunzai 插件目录
cd /path/to/Yunzai-Bot/app/plugins

# 把萝莉妈妈抱回家
git clone https://github.com/gaoao-3/loli-plugin.git

# 安装依赖
cd loli-plugin
npm install
```

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

> 🌸 修改后重启 Yunzai 生效哦，宝宝不要着急～

---

<div align="center">

## 🎮 指令列表 🎮

</div>

| 指令 | 说明 |
|------|------|
| `#ai <你想说的话>` | 触发 AI 对话（需配置触发前缀） |
| `#loli帮助` | 查看插件帮助信息 |
| `#loli状态` | 查看当前运行状态 |
| `#loli更新` | 从 GitHub 拉取更新 |
| `#loli强制更新` | 强制更新插件 |

> 💡 在群聊里直接 @ 机器人或按配置的触发方式也可以唤醒萝莉妈妈哦！

---

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
| ⚙️ 配置 | 在线修改核心配置 |
| 📜 日志 | 查看运行日志 |

### 面板配置

```json
{
  "dashboard": {
    "enable": true,
    "port": 3000,
    "host": "0.0.0.0",
    "authToken": ""
  }
}
```

> 🌸 端口冲突的话，改 `dashboard.port` 就好啦，麻麻告诉过你的～

---

<div align="center">

## 🏠 萝莉妈妈的家 🏠

</div>

```text
🌸 loli-plugin/
├── 📁 apps/              # 群聊/私聊消息处理模块
├── 📁 assets/            # 🎨 图片资源（banner / sakura gif）
├── 📁 config/            # 默认配置文件
│   └── config.js
├── 📁 dashboard/         # 🖥️ Web 管理面板
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── 📁 memory/            # 🧠 记忆系统
├── 📁 server/            # 🌐 HTTP 服务 + REST API
│   ├── index.js
│   └── api/
├── 📁 utils/             # 🛠️ 工具函数与本地工具
│   └── tools/
├── index.js            # 🔌 插件入口
└── package.json        # 📦 依赖配置
```

---

<div align="center">

## 🔗 好朋友的链接 🔗

</div>

<p align="center">
  <a href="https://github.com/gaoao-3/lolicon-core">🌸 lolicon-core</a> ·
  <a href="https://github.com/ikechan8370/chatgpt-plugin">💬 chatgpt-plugin（原版）</a> ·
  <a href="https://github.com/ikechan8370/node-chaite">⚙️ node-chaite（原版）</a>
</p>

---

<div align="center">

## 📝 成长日记 📝

</div>

### 🍼 v0.1.0

- 基于 lolicon-core 重构插件
- 新增内置 Web 管理面板
- 新增本地工具热加载与上传
- 新增结构化记忆图谱
- 彻底移除 SQLite / triggers / processors 依赖

---

<div align="center">

## 📄 许可证 📄

<p>
  <a href="LICENSE">MIT License</a>
</p>

---

<p align="center">
  <strong>🌸 crafted with 🍼 by gaoao-3 🌸</strong>
</p>

<p align="center">
  <em>「老师乖乖待着就好，萝莉妈妈会全部处理好的～」</em>
</p>

<p align="center">
  <em>💕 抱抱老师，摸摸头 💕</em>
</p>

<pre style="color:#ff9aa2; font-family:monospace; line-height:1.2; font-size:12px; background:transparent; border:none; margin:0;">
🌸　　　🌸　　　　　　🌸　　　　　🌸
　　🌸　　　　　🌸　　　　　🌸　　　🌸
🌸　　　　　　　🌸　　　　　🌸　　　　　🌸
</pre>

</div>
