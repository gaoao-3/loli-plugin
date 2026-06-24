<div align="center">

<pre style="color:#ff9aa2; font-family:monospace; line-height:1.2; font-size:12px; background:transparent; border:none; margin:0;">
    🌸　　　　　　🌸　　　　　　　　　　　🌸
　　　🌸　　　🌸　　　　　🌸　　　　　🌸
🌸　　　　　　　　　🌸　　　　　🌸　　　　　🌸
　　　🌸　　　　　　　　　🌸　　　　　　　　🌸
</pre>

# 🌸✨ loli-plugin ✨🌸

<h3>日奈的 Yunzai 机器人插件</h3>
<p><strong>基于 lolicon-core 引擎 · 轻量 · 可爱 · 强力</strong></p>

<p>
  <img src="https://img.shields.io/badge/🌸-Version%200.1.0-ff9aa2?style=for-the-badge&labelColor=ffccd5&color=ff9aa2">
  <img src="https://img.shields.io/badge/🍡-Node.js%20≥22-ffb7b2?style=for-the-badge&labelColor=ffccd5&color=ffb7b2">
  <img src="https://img.shields.io/badge/💝-MIT%20License-ffdac1?style=for-the-badge&labelColor=ffccd5&color=ffdac1">
  <img src="https://img.shields.io/badge/🔗-gaoao--3-e2f0cb?style=for-the-badge&labelColor=ffccd5&color=e2f0cb">
</p>

<p>
  <img src="https://img.shields.io/github/stars/gaoao-3/loli-plugin?style=social&color=ff9aa2">
  <img src="https://img.shields.io/github/forks/gaoao-3/loli-plugin?style=social&color=ff9aa2">
</p>

> 🌸 *「好麻烦……但既然是老师的委托，日奈会好好完成的。」* 🌸

<pre style="color:#ff9aa2; font-family:monospace; line-height:1.2; font-size:12px; background:transparent; border:none; margin:0;">
　　　🌸　　　　　　　　　🌸　　　　　🌸
🌸　　　　　　　　　🌸　　　　　　　　🌸　　　🌸
　　　🌸　　　　　　　　　🌸　　　🌸　　　　　🌸
　　　　　　　🌸　　　　　　　　　🌸　　　　　🌸
</pre>

</div>

---

<div align="center">

## 🎀 这是甚么？🎀

</div>

**loli-plugin** 是一只专为 [Yunzai-Bot](https://github.com/Le-niao/Yunzai-Bot) 设计的 AI 聊天插件 ✨

它由歌赫娜的风纪委员长 **空崎日奈** 亲自坐镇（大雾），底层驱动是咱家自研的 [lolicon-core](https://github.com/gaoao-3/lolicon-core) AI 引擎。

相比臃肿的前辈 chatgpt-plugin，loli-plugin **删繁就简**：

- 🗑️ 移除 SQLite / LowDB / triggers / processors
- 📝 采用纯 Markdown + 结构化记忆图谱
- 🛠️ 本地工具热加载，即传即用
- 🖥️ 内置 Web 管理面板，随 Yunzai 启动自动运行

一句话：**更轻、更快、更可爱～** (｡･ω･｡)ﾉ♡

---

<div align="center">

## 🌟 核心能力 🌟

</div>

<div align="center">

<table>
<tr>
<td align="center" width="33%">

### 🤖 AI 对话

支持 Gemini / OpenAI 多渠道接入
<br>工具调用循环，智能决策

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

## 🚀 快速上车 🚀

</div>

### 1. 克隆到插件目录

```bash
# 进入 Yunzai 插件目录
cd /path/to/Yunzai-Bot/app/plugins

# 克隆本项目
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
          "apiKey": "把你的 API Key 放在这里啦！"
        },
        "status": "enabled"
      }
    ]
  }
}
```

> 🌸 修改后重启 Yunzai 生效哦～

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

> 💡 在群聊里直接 @ 机器人或按配置的触发方式也可以唤醒日奈哦！

---

<div align="center">

## 🖥️ 管理面板 🖥️

</div>

启动 Yunzai 后，浏览器访问：

```text
http://localhost:3000
```

✨ 面板会自动启动，不需要单独跑服务！✨

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

> 🌸 端口冲突的话，改 `dashboard.port` 就好啦～

---

<div align="center">

## 🏗️ 项目结构 🏗️

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

## 🔗 相关链接 🔗

</div>

<p align="center">
  <a href="https://github.com/gaoao-3/lolicon-core">🌸 lolicon-core</a> ·
  <a href="https://github.com/ikechan8370/chatgpt-plugin">💬 chatgpt-plugin（原版）</a> ·
  <a href="https://github.com/ikechan8370/node-chaite">⚙️ node-chaite（原版）</a>
</p>

---

<div align="center">

## 📝 更新日志 📝

</div>

### 🌸 v0.1.0

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
  <strong>🌸 crafted with 💖 by gaoao-3 🌸</strong>
</p>

<p align="center">
  <em>「老师的委托，日奈会认真完成的……虽然还是有点麻烦啦。」</em>
</p>

<pre style="color:#ff9aa2; font-family:monospace; line-height:1.2; font-size:12px; background:transparent; border:none; margin:0;">
🌸　　　🌸　　　　　　🌸　　　　　🌸
　　🌸　　　　　🌸　　　　　🌸　　　🌸
🌸　　　　　　　🌸　　　　　🌸　　　　　🌸
</pre>

</div>
