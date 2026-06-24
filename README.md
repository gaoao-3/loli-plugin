<div align="center">

# 🌸 loli-plugin

*日奈的 Yunzai 机器人插件 — 基于 lolicon-core 引擎*

[![Version](https://img.shields.io/badge/version-0.1.0-ff9aa2?style=flat-square)](https://github.com/gaoao-3/loli-plugin)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?style=flat-square&logo=node.js)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-gaoao--3-181717?style=flat-square&logo=github)](https://github.com/gaoao-3/loli-plugin)

</div>

---

## ✨ 简介

**loli-plugin** 是一款为 [Yunzai-Bot](https://github.com/Le-niao/Yunzai-Bot) 设计的 AI 对话插件，基于自研的 [lolicon-core](https://github.com/gaoao-3/lolicon-core) 轻量级 AI 引擎。

它继承了 chatgpt-plugin 的伪人对话体验，但移除了 SQLite、triggers、processors 等复杂模块，采用纯 Markdown 记忆 + 结构化记忆图谱 + 本地工具热加载的轻量架构。

> 歌赫娜的风纪委员长，虽然嘴上说着"好麻烦"，但老师的委托会好好完成。

---

## 🚀 核心特性

| 特性 | 说明 |
|------|------|
| 🤖 **AI 对话** | 支持 Gemini / OpenAI 多渠道接入，工具调用循环 |
| 🎭 **伪人模式** | 群聊自然回复、主动发言、冷却控制、连续会话 |
| 🧠 **记忆系统** | 每日 Markdown + 结构化记忆图谱，自动提取实体关系 |
| 🛠️ **工具热加载** | 本地工具文件自动发现，Web 面板一键上传/重载 |
| 🖥️ **Web 管理面板** | 随 Yunzai 启动自动运行，无需额外服务 |
| 🔧 **纯 JS 零依赖** | 无 SQLite / LowDB / 原生依赖，部署简单 |

---

## 📦 安装

### 方式一：通过 Yunzai 插件管理器

```bash
# 在 Yunzai 根目录执行
pnpm add -g pnpm
# 然后克隆到插件目录
git clone https://github.com/gaoao-3/loli-plugin.git ./plugins/loli-plugin
```

### 方式二：手动克隆

```bash
cd Yunzai-Bot/app/plugins
git clone https://github.com/gaoao-3/loli-plugin.git

# 进入插件目录安装依赖
cd loli-plugin
npm install
```

然后启动或重启 Yunzai：

```bash
node app.js
```

---

## ⚙️ 快速配置

首次启动后，插件会在 `loli-plugin/data/config.json` 生成默认配置。

至少需要修改 AI 渠道 API Key：

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
          "apiKey": "YOUR_GEMINI_API_KEY"
        },
        "status": "enabled"
      }
    ]
  }
}
```

修改后重启 Yunzai 生效。

---

## 🎮 常用指令

| 指令 | 说明 |
|------|------|
| `#ai <内容>` | 触发 AI 对话（需在配置中开启伪人模式并设置前缀） |
| `#loli帮助` | 查看插件帮助 |
| `#loli状态` | 查看插件运行状态 |
| `#loli更新` | 从 GitHub 更新插件 |
| `#loli强制更新` | 强制更新插件 |

> 更多指令可在 Yunzai 中发送 `#loli帮助` 查看。

---

## 🖥️ Web 管理面板

loli-plugin 内置一个轻量级 Web 管理面板，**随 Yunzai 启动自动运行**，无需单独启动服务。

### 访问地址

```text
http://localhost:3000
```

### 面板功能

- 📊 **总览**：系统状态、渠道数、工具数、运行时间
- 🔌 **渠道管理**：查看/编辑/启用禁用 AI 渠道
- 🎭 **预设管理**：管理角色预设与系统提示词
- 🛠️ **工具管理**：热重载、上传工具文件、启用禁用工具
- 🧠 **记忆系统**：记忆实体与关系统计
- ⚙️ **系统配置**：在线修改核心配置
- 📜 **运行日志**：查看插件日志

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

---

## 🏗️ 项目结构

```
loli-plugin/
├── apps/               # 应用模块（群聊/私聊消息处理）
├── config/             # 默认配置文件
│   └── config.js
├── dashboard/          # Web 管理面板（静态 HTML/CSS/JS）
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── memory/             # 记忆相关模块
├── server/             # 面板 HTTP 服务 + REST API
│   ├── index.js
│   └── api/
├── utils/              # 工具函数与本地工具目录
│   └── tools/
├── index.js            # 插件入口
└── package.json
```

---

## 🔗 相关项目

- [lolicon-core](https://github.com/gaoao-3/lolicon-core) — loli-plugin 的底层 AI 对话引擎
- [chatgpt-plugin](https://github.com/ikechan8370/chatgpt-plugin) — 前身插件（原版）
- [node-chaite](https://github.com/ikechan8370/node-chaite) — 前身核心框架（原版）

---

## 📝 更新日志

### v0.1.0

- 基于 lolicon-core 重构插件
- 新增 Web 管理面板
- 新增本地工具热加载
- 新增结构化记忆图谱
- 移除 SQLite / triggers / processors 依赖

---

## 📄 许可证

[MIT](LICENSE)

---

<div align="center">

*crafted with 💖 by gaoao-3*

</div>
