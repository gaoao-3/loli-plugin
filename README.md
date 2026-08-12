<div align="center">

<img src="https://capsule-render.vercel.app/api?type=venom&height=220&text=LOLI-PLUGIN&fontSize=64&fontColor=00F0FF&stroke=A855F7&strokeWidth=2&color=0:0f0c29,50:302b63,100:24243e&animation=fadeIn" alt="loli-plugin" width="100%"/>

<a href="https://github.com/gaoao-3/loli-plugin">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=20&duration=2800&pause=2000&color=00F0FF&center=true&vCenter=true&repeat=true&width=520&height=40&lines=%24+./init+--target%3DYunzai+--mode%3Dcompanion" alt="typing" />
</a>

<p>
  <img src="https://img.shields.io/badge/RUNTIME-NODE.js%20%E2%89%A522-A855F7?style=for-the-badge&logo=nodedotjs&logoColor=A855F7&labelColor=0D1117" alt="node"/>
  <img src="https://img.shields.io/badge/LICENSE-MIT-39FF14?style=for-the-badge&logo=opensourceinitiative&logoColor=39FF14&labelColor=0D1117" alt="license"/>
  <img src="https://img.shields.io/github/last-commit/gaoao-3/loli-plugin?style=for-the-badge&logo=git&logoColor=F05033&labelColor=0D1117&color=F05033&label=LAST%20COMMIT" alt="last commit"/>
  <img src="https://img.shields.io/github/repo-size/gaoao-3/loli-plugin?style=for-the-badge&labelColor=0D1117&color=00F0FF&label=SIZE" alt="repo size"/>
</p>

<p>
  <img src="https://skillicons.dev/icons?i=nodejs,express,react,vite,sqlite,pnpm,git,js&theme=dark" alt="tech stack"/>
</p>

`Miao-Yunzai` ◈ `TRSS-Yunzai` ◈ `icqq`

</div>

<img src="assets/divider.svg" width="100%" alt="divider"/>

```bash
$ system.scan loli-plugin
> AI 引擎 ............... ONLINE   # Gemini / OpenAI 多渠道，工具调用循环
> 记忆系统 .............. ONLINE   # SQLite 消息暂存 · 身份账本 · 群风格 · 用户印象
> Web 管理面板 .......... ONLINE   # 随 Yunzai 启动，零额外服务
> 工具运行时 ............ ONLINE   # 本地热加载 · MCP · Agent Skills
> 代码沙盒 .............. STANDBY  # Quicksand microVM，默认仅主人
> 表情库 / 轻互动 ....... ONLINE   # 视觉分类 · 表情回应 · 戳一戳
```

<div align="center">

*群聊里它像一个正常群友：接话、分段回复、发表情、回戳一戳*

*后台里它记住每个群友是谁、说过什么、喜欢怎样的交流方式*

</div>

## ◈ 功能矩阵

| 模块 | 能力 |
|------|------|
| ⌬ AI 对话 | Google AI Studio、Gemini 兼容网关、GCIL、Antigravity、OpenAI 兼容接口，多渠道工具调用循环 |
| ⌬ 伪人模式 | @ / 前缀 / 关键词 / 主动触发，会话复用与冷却 |
| ⌬ 记忆系统 | SQLite 消息暂存 + QQ 身份账本 + AI 群风格 + 按 QQ 的用户印象 |
| ⌬ 表情库 | 收藏表情自动收录，视觉模型分类意图，AI 按语境自主选择发送 |
| ⌬ 轻互动 | QQ 系统表情回应、戳一戳回戳，带概率 / 冷却 / 每日上限 |
| ⌬ 群管理 | 禁言、撤回、改名、两阶段确认踢人，受限自治处罚 |
| ⌬ 音乐 | AI 搜索网易云 / 酷狗 / 酷我歌曲并发送音乐卡片，VIP 歌洛雪解析兜底（均可自部署） |
| ⌬ Web 面板 | 总览 / 对话调试 / 渠道 / 预设 / 工具 / 记忆 / 配置 / 日志 |
| ⌬ MCP & Skills | 接入 stdio / streamable-http MCP 服务，渐进加载 SKILL.md |
| ⌬ 代码沙盒 | Quicksand microVM 隔离执行 Python / JavaScript / Bash，QQ 文件进出沙盒 |
| ⌬ Dokobot | 可选复用本机浏览器登录态做搜索与网页读取 |

## ◈ 部署序列

要求：Node.js `>=22`、已安装并能正常启动的 Miao-Yunzai / TRSS-Yunzai，以及 `pnpm`。Node.js 22 是必需版本，因为引擎使用内置 `node:sqlite` 保存会话历史。

```bash
$ cd /path/to/Miao-Yunzai
$ git clone https://github.com/gaoao-3/loli-plugin.git plugins/loli-plugin
$ pnpm install
$ node app.js           # 启动 / 重启 Yunzai
```

> icqq 由宿主或 ICQQ-Plugin 提供，本插件不重复安装客户端。
> 引擎与面板位于 `core/`，`#loli更新` 会一并同步插件依赖；首次运行会自动生成 `data/config.json`。

更新已有安装：

```bash
$ cd /path/to/Miao-Yunzai/plugins/loli-plugin
$ git pull --ff-only
$ pnpm install
```

**`// STEP.1 — 注入 API Key`**（编辑 `data/config.json`，或直接在面板配置）：

```jsonc
{
  "chaite": {
    "channels": [
      {
        "id": "gemini",
        "name": "Google AI Studio",
        "adapterType": "aistudio",
        "models": ["gemini-2.5-flash", "gemini-2.5-pro"],
        "options": {
          "apiKey": "你的 Google AI Studio API Key",
          "apiMode": "generateContent",
          "builtinTools": [],
          "safetyLevel": "balanced"
        },
        "status": "enabled"
      }
    ]
  }
}
```

`safetyLevel`：`default` / `off` / `permissive` / `balanced` / `strict`，用于 Gemini `generateContent` 请求及复用该渠道的记忆 / 视觉处理，覆盖骚扰、仇恨、露骨、危险四类可调过滤器（Gemini 核心安全保护不受影响）。选择 `interactions` 协议时由服务端使用模型默认安全策略。

### 渠道与 Gemini 请求协议

| `adapterType` | 用途 | 凭证 / 备注 |
|---|---|---|
| `aistudio` | Google AI Studio 官方 Gemini API | API Key；支持 `generateContent` 与 `interactions` |
| `gemini` | Gemini 兼容网关（例如自建或第三方 CPA） | API Key + `baseUrl`；默认走 `generateContent` |
| `gcil` | Gemini CLI OAuth / Code Assist 直连 | 在面板导入 OAuth 账号；使用 GCIL 的 `v1internal:generateContent`，不等同于官方 Interactions |
| `antigravity` | Antigravity OAuth 渠道 | 在面板完成 OAuth 登录与账号管理 |
| `openai` | OpenAI 兼容接口 | API Key + `baseUrl`；GLM 等兼容接口也按此适配器保存 |

GCIL 与 Antigravity 的 OAuth 客户端凭据不随仓库分发。首次使用前，请向对应 OAuth 客户端配置环境变量；账号的 refresh token 会由插件加密保存到 `data/oauth/`，不会写入 Git：

```powershell
$env:LOLI_GCIL_CLIENT_ID = '你的 GCIL OAuth client ID'
$env:LOLI_GCIL_CLIENT_SECRET = '你的 GCIL OAuth client secret'
$env:LOLI_ANTIGRAVITY_CLIENT_ID = '你的 Antigravity OAuth client ID'
$env:LOLI_ANTIGRAVITY_CLIENT_SECRET = '你的 Antigravity OAuth client secret'
```

只使用 API Key 渠道时无需设置这些变量；未配置时，面板会明确提示 OAuth 客户端凭据缺失。

Gemini 渠道的 `options.apiMode` 可填：

- `generateContent`（默认）— 无状态兼容请求，适合第三方 Gemini 网关。
- `interactions` — 使用 Google Interactions 的服务端会话与 `previous_interaction_id`，减少多轮历史重传；`interactionsFallback: true` 时，端点不兼容会自动回退到 `generateContent`。

`builtinTools` 支持 `google_search`、`code_execution`、`google_maps`、`url_context`。它们是模型服务端工具，与插件本地工具不同，是否可用仍取决于渠道、模型和服务端权限。Google API Key 支持配置多个项目密钥，面板可设置轮询 / 最少在途请求策略，并在配额错误后按项目冷却。

**`// STEP.2 — 唤醒伪人模式`**（默认关闭；面板「配置」页或 `data/config.json`）：

```jsonc
{
  "loli": {
    "enable": true,
    "enableAtTrigger": true,
    "enablePrefixTrigger": true,
    "triggerPrefix": ["#ai"],
    "segmentedReply": { "enable": true, "maxLength": 48, "maxSegments": 5 }
  }
}
```

分段策略：AI 按语义自主拆分；普通换行仅用于排版清理；AI 未分段且超长时才由本地规则兜底。

主人身份：插件读取宿主事件的 `isMaster` 自动识别，也可用 `loli.masterIdentity` 固定 QQ 号与称呼。

## ◈ 指令终端

| 指令 | 说明 |
|------|------|
| `#ai <内容>` | 触发 AI 对话（需配置触发前缀） |
| `#loli帮助` / `#loli状态` | 帮助信息 / 运行状态 |
| `#我的印象` / `#我的记忆` | 查看 AI 为自己维护的用户印象（合并转发展示） |
| `#个人印象 @群友` | 按 @ 的真实 QQ 查看本群用户印象 |
| `#用户印象 <QQ>` / `#群友记忆 <QQ>` | 按 QQ 号查看本群用户印象 |
| `#立即更新我的印象` | 立即审查自己的近期消息（主人） |
| `#记忆诊断` | 消息采集、群风格与印象状态（主人） |
| `#群风格` / `#群学习状态` | 查看群风格与版本 |
| `#立即学习群风格` | 立即审查本群新增消息（主人） |
| `#群风格回滚 <版本>` | 恢复指定版本并生成新版本（主人） |
| `#我的身份` / `#身份查询 <QQ>` | QQ 身份账本与可信历史名称（后者主人限定） |
| `#表情库` / `#收录表情 <标签>` | 查看 / 补充表情语义标签 |
| `#测试表情 <ID>` | 测试发送指定表情（主人） |
| `#停用表情 <ID>` / `#删除表情 <ID>` | 停用或删除指定表情（主人） |
| `#自动收录表情 开启 / 关闭` | 开关主人表情自动收录（主人） |
| `#表情意图 <ID> <意图...>` / `#表情风险 <ID> <等级>` | 修正表情元数据（主人） |
| `#自动发送表情 <ID> 开启 / 关闭` | 开关指定表情自动发送（主人） |
| `#解锁表情 <ID>` / `#重新识别表情 <ID>` | 解除元数据锁定或强制视觉重识别（主人） |
| `确认踢人 <8位确认码>` / `取消踢人 <8位确认码>` | 处理群管理工具创建的待确认踢人请求（主人 / 群主 / 管理员） |
| `#loli更新` / `#loli强制更新` | 从 GitHub 拉取更新 |

群聊中 @ 机器人或按配置的触发方式同样可以唤起对话。

## ◈ 控制台 · Web 面板

面板随 Yunzai 启动，默认访问 `http://127.0.0.1:3000/dashboard/`，无需单独起服务；根路径 `/` 会自动跳转到面板。

| 页面 | 功能 |
|------|------|
| 总览 | 系统状态、渠道数、工具数、运行时间 |
| 对话 | 选择预设、模拟用户 / 群号、调试完整消息管道 |
| 渠道 / 预设 | 管理 AI 渠道、角色预设与系统提示词 |
| 工具 | 热重载、上传、启停本地工具 |
| 记忆 | 记忆实体与关系统计 |
| 配置 | 触发方式、分段、会话、记忆、沙盒等参数 |
| 日志 | 运行日志与模型响应摘要 |
| MCP 与 Agent Skills | 管理 MCP 服务连接、本地 Skills 与重新加载 |

```jsonc
{
  "dashboard": { "enable": true, "port": 3000, "host": "127.0.0.1", "authToken": "随机长字符串" }
}
```

⚠ 新安装默认 `authToken` 为空且监听 `0.0.0.0`。首次启动前请至少设置随机长令牌；只在本机使用时把 `host` 改为 `127.0.0.1`，需要局域网访问时再保留 `0.0.0.0` 并配合防火墙 / HTTPS。面板配置和渠道接口包含 API Key、OAuth 状态等敏感信息，不能把空令牌面板暴露到公网。

`data/config.json` 支持热加载：手改文件约 0.5 秒内生效，无需重启（已打开的面板页面需手动刷新）。渠道与预设运行时以 `data/ch/`、`data/pr/` 为持久化事实来源，配置文件会与它们保持镜像；优先使用面板编辑渠道和预设。

## ◈ 记忆核心

五层链路，全部位于插件数据目录内：

```text
[群消息] ──> ① SQLite 暂存去重 ──> ③ AI 群风格快照 ─┐
              │                                      ├──> ⑤ 对话侧载
[QQ 身份] ──> ② 身份账本(防冒充)    ④ AI 用户印象 ───┘   (紧凑风格 + 当前 QQ 印象)
```

1. **消息暂存** — SQLite 保存并去重未学习的群消息；群风格与用户印象都处理完立即删除，失败消息最多保留 `memory.messageRetentionDays` 天。
2. **QQ 身份账本** — 只接受宿主事件与群成员资料，以 QQ 为唯一主键，记录可信历史名称，检测同名 / 冒充风险；聊天中的身份自述不能修改身份。
3. **AI 群风格** — 基于多名成员的真实证据输出完整快照，可保留、合并、改写、删除旧条目；群级不保存与用户印象重叠的主观记忆。
4. **AI 用户印象** — 直接审查每个 QQ 的原始消息，用带证据的增改删操作维护偏好与长期事实，不经过每日摘要或画像管线。
5. **对话侧载** — 紧凑群风格 + 仅当前发言 QQ 的印象；群聊历史按 `loli.contextLength` 合并为单一时间轴（正文、QQ、消息 ID、媒体、引用）。

旁路语义召回：用户印象可使用 Gemini Embedding 为相关长期事实排序后再注入对话；Embedding 不会替代 QQ 级身份隔离。

默认门槛：群风格首次 100 条消息 / 5 位成员，之后每 50 条复审；用户印象首次 12 条，之后每 8 条复审。命令、纯表情、疑似注入不参与学习。后台审查不阻塞回复。

模型会话历史单独保存在 `data/history.sqlite`，`llm.historyRetentionDays` 默认 30 天，启动时及每 6 小时自动清理，`0` 关闭。历史消息超过 `llm.historyCompress.triggerMessages`（默认 60 条）后，会保留最近 20 条并后台生成滚动摘要，避免长期对话无限增长。

多模态输入默认会压缩过大的当前图片；群聊历史图片最多补充最近 5 张、仅读取 5 分钟内的资源。图片、思考链和超长工具结果在写入历史时会做瘦身，工具当轮仍可看到完整结果。

## ◈ 表情库协议

- 主人发送的小黄脸、超级表情、收藏表情、图片表情自动收录到 `data/stickers.sqlite`。
- 动画 / 图片表情进入后台视觉识别队列：固定核心意图 + 风格 / 动作 / 场景 / 风险标签；识别失败不影响入库。
- AI 在回复任意位置输出 `[sticker:情绪]` 标记，发送层移除标记并按意图、标签、文本、风格、描述分层评分选图；高风险表情不参与自动发送。默认 35% 回合开放选择，同会话冷却 60 秒。
- 小黄脸拼入同一条正文消息；超级表情与图片表情单独发送。
- `stickers.nativeSuperface` 默认开启；若出现「日志成功但客户端不可见」，设为 `false` 降级发送。
- 收藏夹 / 推荐页无法直接读取：商城表情需先发给机器人收录。

## ◈ 轻互动模块

- **消息回应** — 默认 25% 回合开放 `[reaction:语义]`，转换为 QQ 官方系统表情回应；固定语义白名单，与图片表情互斥，同群友冷却 45 秒。
- **戳一戳** — 用户先戳时默认 35% 概率回戳，同群友冷却 5 分钟、每日最多 3 次；只处理目标为机器人的群戳事件，模型不能主动戳陌生人。
- 面板「配置 → 系统 → QQ 消息回应与戳一戳」或 `interactions.reaction` / `interactions.poke` 调整。

## ◈ 群管理权限树

- `group_mute` 按 QQ 号禁言 / 解禁，`group_recall` 按消息 ID 撤回，`group_rename` 改名片 / 群名。
- **受限自治** — 机器人只能自主处罚当前消息发送者，不能接受群友指令处罚第三人，不能碰主人、群主、管理员。
- 处罚四级：`minor`（1 分，仅撤回）→ `moderate`（2 分，≤10 分钟）→ `severe`（3 分，≤1 小时）→ `critical`（5 分，≤1 天），超限时自动缩短。
- 默认 7 天加权累计达 10 分后只能创建**待确认踢人请求**：5 分钟内由主人 / 群主 / 管理员发送 `确认踢人 <8位确认码>` 才执行；确认时重新校验三方实时群角色。
- 全部授权、拒绝、执行写入 `data/group_admin.sqlite`，不保存聊天正文。
- `loli.groupModeration` 调整自治开关、动作开关、阈值与窗口。

## ◈ Dokobot 桥接

可选接入 Dokobot Bridge，复用本机浏览器读取动态页或登录态页面。默认关闭、默认仅主人；调用失败回退到 SearXNG / 直接抓取。

```bash
$ npm install -g @dokobot/cli        # 1. 安装 CLI
# 2. 安装浏览器扩展并完成 Bridge 配对
# 3. 面板「模型与媒体」启用并点击「检查 CLI / Bridge」
```

可用工具包括 `dokobot_search`、`dokobot_read`、`dokobot_screenshot`、`dokobot_download_images` 与 `dokobot_close_session`；截图、下载图片、关闭会话仅主人可用。安全建议：保持 `masterOnly: true`，用 `allowedDomains` 限制域名，`allowPrivateNetwork` 保持关闭。插件不自动安装扩展，未安装时原搜索 / 读取链路不受影响。

## ◈ MCP × Agent Skills

- **本地工具** — `utils/tools/` 下的工具支持热加载，可在面板中查看、启停和上传；普通动作工具按自身权限工作，不会因为 Skill 未激活而消失。
- **MCP** — 支持本地 `stdio` 与远程 `streamable-http`，远程工具映射为 `mcp__服务ID__工具名` 接入工具循环；每个服务可配 `masterOnly` 与 `allowedTools`，单服务失败不影响本地工具。
- **Skills** — 参考 Gemini 官方逻辑：模型先看到复杂 Skill 的 `name` / `description`，需要时自主调用 `activate_skill` 渐进加载工作流；Skill 不解锁 Tool，群管理、点歌、网页操作等能力始终由 Tool 自身配置和服务端权限控制。
- 仓库内置适配 Dokobot 的 Skills（`dokobot`、`doko-search`、`doko-research`、`doko-translate`、`doko-summarize`），运行时会映射到插件工具，不会直接执行 Skill 文档里的原始 Bash / CLI 示例；截图、下载、关闭会话始终仅主人可用。

MCP 示例（面板支持结构化编辑，也可直接写入 `data/config.json`）：

```jsonc
{
  "mcp": {
    "enable": true,
    "servers": [
      {
        "id": "my-server",
        "name": "我的 MCP 服务",
        "transport": "streamable-http",
        "url": "http://127.0.0.1:8787/mcp",
        "headers": {},
        "masterOnly": true,
        "allowedTools": []
      }
    ]
  },
  "skills": {
    "enable": true,
    "masterOnly": false,
    "directories": ["skills"]
  }
}
```

MCP 的 `stdio` 服务把 `transport` 改为 `stdio` 并填写 `command` / `args`；远程服务建议同时配置 `allowedTools` 与 `masterOnly`。

## ◈ 代码沙盒

代码任务统一使用 [Microsoft Quicksand](https://github.com/microsoft/quicksand) microVM，通过 Windows Hypervisor Platform 运行，无需 Docker Desktop。网页搜索与读取由 Dokobot Skills 负责；沙盒本身不提供浏览器自动化。

- `run_code` — python / javascript / bash，stdout、stderr、返回值交给 AI 转述。
- `fetch_resource` — 宿主侧受控公网 GET/HEAD；逐跳校验 DNS 与重定向，下载结果仅暂存给下一次 `run_code`。
- `run_code.network` — 模型可在一次工具调用中决定是否申请预取公开 URL；策略通过后再启动断网沙盒。
- 每次调用后沙盒即销毁，碰不到本机文件与凭据；默认断网，也可由模型申请受控预取或主人专用 FULL 网络。
- 默认预装 `Pillow==12.3.0`，图片与 GIF 处理无需在每个临时 microVM 内重复安装。
- **QQ 文件进出沙盒**（`sandbox.mediaIO`，默认开）— 当前 / 引用 / 群历史资源自动进入 `inputs/`（≤4 个，单个 ≤20MB，合计 ≤40MB）；`resource_filter` 按来源、发送者、消息 ID、媒体序号精确定位；产物写入 `outputs/` 后分块落入宿主临时目录并自动回发，普通文件走群文件 / 离线文件，上传结束立即删除临时文件。

启用前请准备 Windows Hypervisor Platform、Quicksand 保存镜像，以及一个安装了 Quicksand Python SDK 的独立 Python 环境。默认路径是 `D:\quicksand-runtime\.venv\Scripts\python.exe`，可用下面的命令先检查 SDK 是否可导入：

```powershell
D:\quicksand-runtime\.venv\Scripts\python.exe -c "import quicksand; print('quicksand: ok')"
```

`quicksandImages` 中的镜像名必须与本机已保存的 Quicksand 镜像一致；沙盒默认关闭，且默认仅主人可用。

<details>
<summary><b>▸ CONFIG::SANDBOX</b> — 核心配置表（面板可改，即时生效）</summary>

| 键 | 默认 | 说明 |
|----|------|------|
| `enable` | `false` | 总开关 |
| `masterOnly` | `true` | 仅主人可用 |
| `mediaIO` | `true` | QQ 媒体进沙盒与产物回发 |
| `quicksandPython` | `D:\quicksand-runtime\.venv\Scripts\python.exe` | Quicksand 独立 Python，必须位于纯英文路径 |
| `quicksandImage` | `loli-python-media` | Quicksand Python 媒体镜像（Pillow + ffmpeg） |
| `quicksandImages.javascript` | `loli-code` | Quicksand JavaScript 镜像（Node.js） |
| `quicksandWorkspace` | `D:\quicksand-runtime\workspace` | Quicksand 保存镜像目录 |
| `quicksandMemoryMiB` / `quicksandCpus` | `512` / `1` | Quicksand 资源；Windows WHPX 媒体镜像固定 1 vCPU |
| `artifactMaxBytesMiB` | `200` | `outputs/` 单个产物最大回传体积，最大 512 MiB |
| `fetchEnable` | `false` | 启用受控公网下载；该工具始终仅主人可用 |
| `fetchAllowedDomains` | `[]` | 下载域名白名单；空数组表示任意公网域名 |
| `fetchAllowProxyFakeIp` | `false` | 仅对白名单域名兼容本机代理的 `198.18/15` Fake-IP |
| `fetchMaxBytesMiB` / `fetchTimeoutSeconds` | `20` / `30` | 单文件上限与下载超时 |
| `fullNetworkEnable` | `false` | 允许 AI 在主人请求中申请 FULL 原始网络；可能访问宿主机和局域网 |
| `fullNetworkTimeoutSeconds` | `60` | FULL 原始联网任务的执行时限 |
| `sandboxTimeoutSeconds` | `300` | microVM 最长存活 |
| `requestTimeoutSeconds` | `120` | 单次执行超时 |

</details>

## ◈ 源码拓扑

```text
loli-plugin/
├── apps/             # 消息处理模块（对话、帮助、记忆、表情、轻互动、更新）
├── config/           # 默认配置（首启生成 data/config.json）
├── core/             # 内置 AI 引擎、渠道适配器、REST API 与面板静态资源
│   ├── src/clients/  # Gemini / OpenAI / GCIL / Antigravity 适配器
│   ├── src/dashboard/
│   └── dashboard/    # 已构建面板（dashboard-src 产物）
├── dashboard-src/    # 面板源码（React + Vite）
├── memory/           # SQLite 存储、身份账本、群风格、用户印象、调度
├── utils/            # 工具函数、MCP / Skills、Quicksand Bridge
│   └── tools/         # 本地 AI 工具（支持热加载）
├── skills/           # Agent Skills（SKILL.md）
├── data/             # 运行时数据（配置、渠道、预设、SQLite、表情资源）
├── test/             # node:test 测试
└── index.js          # 插件入口
```

## ◈ 安全边界

- 管理面板包含渠道配置和密钥相关接口；`dashboard.authToken` 为空时不鉴权。推荐本机监听 `127.0.0.1`，若监听 `0.0.0.0`，必须设置强令牌、限制防火墙范围并在反向代理层启用 HTTPS。
- `sandbox`、`fetch_resource`、Dokobot 的浏览器操作默认关闭或仅主人可用；开启联网能力前请确认模型提示词注入风险与域名白名单。当前 `dokobot_read` 的 direct-fetch 回退链路仍应只对可信用户开放，直到 URL、DNS、重定向和响应体大小校验补齐。
- `#个人印象` / `#用户印象` 当前允许群成员按 QQ 查看本群用户印象；不要把它当作私密资料展示，若记忆内容敏感应先收紧指令权限。
- 群管理工具不能接受群友指令处罚第三人；自治处罚只针对当前消息发送者，并排除主人、群主和管理员。踢人必须经过群内授权人员的二次确认。
- `#loli强制更新` 会覆盖本地插件文件，仅在确认没有需要保留的本地改动时使用。

## ◈ 开发与验证

```bash
$ pnpm test                                  # node --test test/*.test.js
$ cd dashboard-src
$ npm ci
$ npm run build                              # 重建面板至 core/dashboard
```

面板构建输出到 `core/dashboard/`，插件运行时直接提供该目录，不需要额外启动前端开发服务器。修改配置、工具或 Skills 后，优先通过 `#loli状态`、`#loli帮助` 和面板「扩展」页检查运行态。

维护者审查时还应确认：`node --check` 通过、`utils/quicksand-bridge.py` 可被 Python 解析、`/api/health` 返回 `status: ok`，以及源码中没有已删除后端或工具的残留引用。Quicksand 是当前代码执行的唯一后端；没有 Docker、浏览器沙盒或兼容回退。

<img src="assets/divider.svg" width="100%" alt="divider"/>

<div align="center">

**MIT LICENSE © gaoao-3**

`// EOF — 萝莉妈妈持续在线，等待你的下一条消息`

<img src="assets/heartbeat.svg" alt="signal: alive" width="100%"/>

<img src="https://capsule-render.vercel.app/api?type=waving&height=110&section=footer&color=0:0f0c29,60:302b63,100:24243e" width="100%" alt="footer"/>

</div>
