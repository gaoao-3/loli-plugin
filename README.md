<div align="center">

<img src="https://capsule-render.vercel.app/api?type=venom&height=220&text=LOLI-PLUGIN&fontSize=64&fontColor=00F0FF&stroke=A855F7&strokeWidth=2&color=0:0f0c29,50:302b63,100:24243e&animation=fadeIn" alt="loli-plugin" width="100%"/>

<a href="https://github.com/gaoao-3/loli-plugin">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=20&duration=2800&pause=1200&color=00F0FF&center=true&vCenter=true&multiline=true&repeat=true&width=720&height=60&lines=%24+./init+--target%3DYunzai+--mode%3Dcompanion;AI+%C2%B7+MEMORY+%C2%B7+TOOLS+%C2%B7+SANDBOX+%E2%80%94+ALL+SYSTEMS+ONLINE" alt="typing" />
</a>

<p>
  <img src="https://img.shields.io/github/v/release/gaoao-3/loli-plugin?style=for-the-badge&logo=github&logoColor=00F0FF&labelColor=0D1117&color=00F0FF" alt="release"/>
  <img src="https://img.shields.io/github/downloads/gaoao-3/loli-plugin/total?style=for-the-badge&labelColor=0D1117&color=FF2E63" alt="downloads"/>
  <img src="https://img.shields.io/badge/RUNTIME-NODE.js%20%E2%89%A522-A855F7?style=for-the-badge&logo=nodedotjs&logoColor=A855F7&labelColor=0D1117" alt="node"/>
  <img src="https://img.shields.io/badge/LICENSE-MIT-39FF14?style=for-the-badge&logo=opensourceinitiative&logoColor=39FF14&labelColor=0D1117" alt="license"/>
</p>

<p>
  <img src="https://img.shields.io/github/last-commit/gaoao-3/loli-plugin?style=for-the-badge&logo=git&logoColor=F05033&labelColor=0D1117&color=F05033&label=LAST%20COMMIT" alt="last commit"/>
  <img src="https://img.shields.io/github/commit-activity/m/gaoao-3/loli-plugin?style=for-the-badge&labelColor=0D1117&color=00F0FF&label=COMMITS%2FM" alt="commit activity"/>
  <img src="https://img.shields.io/github/languages/top/gaoao-3/loli-plugin?style=for-the-badge&logo=javascript&logoColor=FF2E63&labelColor=0D1117&color=FF2E63" alt="top language"/>
  <img src="https://img.shields.io/github/repo-size/gaoao-3/loli-plugin?style=for-the-badge&labelColor=0D1117&color=A855F7&label=SIZE" alt="repo size"/>
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
> 代码沙盒 .............. STANDBY  # Microsandbox microVM，默认仅主人
> 表情库 / 轻互动 ....... ONLINE   # 视觉分类 · 表情回应 · 戳一戳
```

<div align="center">

*群聊里它像一个正常群友：接话、分段回复、发表情、回戳一戳*

*后台里它记住每个群友是谁、说过什么、喜欢怎样的交流方式*

</div>

## ◈ 功能矩阵

| 模块 | 能力 |
|------|------|
| ⌬ AI 对话 | Gemini / OpenAI 多渠道接入，工具调用循环，AI 自主判断消息分段 |
| ⌬ 伪人模式 | @ / 前缀 / 关键词 / 主动触发，会话复用与冷却 |
| ⌬ 记忆系统 | SQLite 消息暂存 + QQ 身份账本 + AI 群风格 + 按 QQ 的用户印象 |
| ⌬ 表情库 | 收藏表情自动收录，视觉模型分类意图，AI 按语境自主选择发送 |
| ⌬ 轻互动 | QQ 系统表情回应、戳一戳回戳，带概率 / 冷却 / 每日上限 |
| ⌬ 群管理 | 禁言、撤回、改名、两阶段确认踢人，受限自治处罚 |
| ⌬ QQ 音乐 | 账户状态、VIP 检测、Cookie 自动刷新，AI 可搜索并发送音乐 |
| ⌬ Web 面板 | 总览 / 对话调试 / 渠道 / 预设 / 工具 / 记忆 / 配置 / 日志 |
| ⌬ MCP & Skills | 接入 stdio / streamable-http MCP 服务，渐进加载 SKILL.md |
| ⌬ 代码沙盒 | microVM 执行六种语言 + 无头浏览器，QQ 文件进出沙盒 |
| ⌬ Dokobot | 可选复用本机浏览器登录态做搜索与网页读取 |

## ◈ 部署序列

```bash
$ cd /path/to/Miao-Yunzai/plugins
$ git clone https://github.com/gaoao-3/loli-plugin.git
$ cd loli-plugin && pnpm install
$ node ../app.js        # 启动 / 重启 Yunzai
```

> icqq 由宿主或 ICQQ-Plugin 提供，本插件不重复安装客户端。
> 引擎与面板位于 `core/`，`#loli更新` 会一并更新。

**`// STEP.1 — 注入 API Key`**（编辑 `data/config.json`，或直接在面板配置）：

```jsonc
{
  "chaite": {
    "channels": [
      {
        "id": "gemini",
        "adapterType": "gemini",
        "models": ["gemini-2.5-flash", "gemini-2.5-pro"],
        "options": { "apiKey": "你的 API Key", "safetyLevel": "balanced" },
        "status": "enabled"
      }
    ]
  }
}
```

`safetyLevel`：`default` / `off` / `permissive` / `balanced` / `strict`，同时作用于聊天与记忆提炼，覆盖骚扰、仇恨、露骨、危险四类可调过滤器（Gemini 核心安全保护不受影响）。

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
| `#我的印象` | 查看 AI 为自己维护的用户印象（合并转发展示） |
| `#用户印象 <QQ>` | 查看指定 QQ 印象（主人） |
| `#立即更新我的印象` | 立即审查自己的近期消息（主人） |
| `#记忆诊断` | 消息采集、群风格与印象状态（主人） |
| `#群风格` / `#群学习状态` | 查看群风格与版本 |
| `#立即学习群风格` | 立即审查本群新增消息（主人） |
| `#群风格回滚 <版本>` | 恢复指定版本并生成新版本（主人） |
| `#我的身份` / `#身份查询 <QQ>` | QQ 身份账本与可信历史名称（后者主人限定） |
| `#表情库` / `#收录表情 <标签>` | 查看 / 补充表情语义标签 |
| `#表情意图` `#表情风险` `#自动发送表情` `#解锁表情` `#重新识别表情` | 修正或交还表情元数据（主人） |
| `#QQ音乐状态` `#刷新QQ音乐` `#QQ音乐vip检测` | QQ 音乐账户管理（主人） |
| `#QQ音乐cookie <Cookie>` | 私聊导入 Cookie（主人，严禁群聊发送） |
| `#loli更新` / `#loli强制更新` | 从 GitHub 拉取更新 |

群聊中 @ 机器人或按配置的触发方式同样可以唤起对话。

## ◈ 控制台 · Web 面板

面板随 Yunzai 启动，默认接入 `http://localhost:3000`，无需单独起服务。

| 页面 | 功能 |
|------|------|
| 总览 | 系统状态、渠道数、工具数、运行时间 |
| 对话 | 选择预设、模拟用户 / 群号、调试完整消息管道 |
| 渠道 / 预设 | 管理 AI 渠道、角色预设与系统提示词 |
| 工具 | 热重载、上传、启停本地工具 |
| 记忆 | 记忆实体与关系统计 |
| 配置 | 触发方式、分段、会话、记忆、沙盒等参数 |
| 日志 | 运行日志与模型响应摘要 |
| MCP 与 Skills | 管理 MCP 服务连接与本地 Skills |

```jsonc
{
  "dashboard": { "enable": true, "port": 3000, "host": "0.0.0.0", "authToken": "随机长字符串" }
}
```

⚠ `authToken` 为空时不校验身份；默认监听 `0.0.0.0`，公网暴露前务必设置令牌并在外层加 HTTPS。

`data/config.json` 支持热加载：手改文件约 0.5 秒内生效，无需重启（已打开的面板页面需手动刷新）。

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

默认门槛：群风格首次 100 条消息 / 5 位成员，之后每 50 条复审；用户印象首次 12 条，之后每 8 条复审。命令、纯表情、疑似注入不参与学习。后台审查不阻塞回复。

模型会话历史单独保存在 `data/history.sqlite`，`llm.historyRetentionDays` 默认 30 天，启动时及每 6 小时自动清理，`0` 关闭。

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

安全建议：保持 `masterOnly: true`，用 `allowedDomains` 限制域名，`allowPrivateNetwork` 保持关闭。插件不自动安装扩展，未安装时原搜索 / 读取链路不受影响。

## ◈ MCP × Agent Skills

- **MCP** — 支持本地 `stdio` 与远程 `streamable-http`，远程工具映射为 `mcp__服务ID__工具名` 接入工具循环；每个服务可配 `masterOnly` 与 `allowedTools`，单服务失败不影响本地工具。
- **Skills** — 从插件根目录 `skills/` 扫描，启动时只向模型展示 `name` / `description`，调用 `activate_skill` 后读取完整 `SKILL.md`；`read_skill_resource` 仅允许 Skill 目录内的安全文本。
- 仓库内置适配 Dokobot 官方五个 Skill（`dokobot`、`doko-search`、`doko-research`、`doko-translate`、`doko-summarize`），Bash / CLI 示例在运行时映射到插件工具；截图、下载、关闭会话始终仅主人可用。

## ◈ 代码沙盒

基于 [Microsandbox](https://github.com/microsandbox/microsandbox) microVM（Windows Hypervisor Platform，无需 Docker Desktop）。`npx msb doctor` 检查虚拟化条件。

- `run_code` — python / javascript / typescript / java / go / bash，stdout、stderr、返回值交给 AI 转述。
- `browser_use` — microVM 内无头 Chromium，动作列表式操作；网络强制仅公网，阻断宿主机、localhost、云元数据与局域网。
- 每次调用后沙盒即销毁，碰不到本机文件与凭据；`microsandboxNetwork: false` 可完全断网；默认仅主人可用。
- `pythonDependencies` 声明 PyPI 依赖，首次运行自动构建内容寻址快照，后续调用直接复用。
- **QQ 文件进出沙盒**（`sandbox.mediaIO`，默认开）— 当前 / 引用 / 群历史资源自动进入 `inputs/`（≤4 个，单个 ≤20MB，合计 ≤40MB）；`resource_filter` 按来源、发送者、消息 ID、媒体序号精确定位；产物写入 `outputs/` 自动回发，普通文件走群文件 / 离线文件。

<details>
<summary><b>▸ CONFIG::SANDBOX</b> — 核心配置表（面板可改，即时生效）</summary>

| 键 | 默认 | 说明 |
|----|------|------|
| `enable` | `false` | 总开关 |
| `masterOnly` | `true` | 仅主人可用 |
| `mediaIO` | `true` | QQ 媒体进沙盒与产物回发 |
| `browserEnable` | `true` | 启用 `browser_use` |
| `microsandboxImage` | `python:3.14-slim` | Python OCI 镜像 |
| `microsandboxMemoryMiB` / `microsandboxCpus` | `512` / `1` | 代码 microVM 资源 |
| `browserMemoryMiB` / `browserCpus` | `1024` / `2` | 浏览器 microVM 资源 |
| `sandboxTimeoutSeconds` | `300` | microVM 最长存活 |
| `requestTimeoutSeconds` | `120` | 单次执行超时 |

</details>

首次调用浏览器工具会下载固定版本 Playwright 镜像，耗时与磁盘占用明显高于后续调用。

## ◈ 源码拓扑

```text
loli-plugin/
├── apps/             # 消息处理模块（对话、帮助、记忆、表情、音乐、更新）
├── config/           # 默认配置（首启生成 data/config.json）
├── core/             # 内置 AI 引擎、REST API 与面板静态资源
│   ├── src/
│   └── dashboard/    # 已构建面板（dashboard-src 产物）
├── dashboard-src/    # 面板源码（React + Vite）
├── memory/           # SQLite 存储、身份账本、群风格、用户印象、调度
├── utils/            # 工具函数与本地 AI 工具
│   └── tools/
├── skills/           # Agent Skills（SKILL.md）
├── data/             # 运行时数据（配置、SQLite、表情资源）
├── test/             # node:test 测试
└── index.js          # 插件入口
```

```bash
$ pnpm test                              # node --test test/*.test.js
$ cd dashboard-src && npm run build      # 重建面板至 core/dashboard
```

<img src="assets/divider.svg" width="100%" alt="divider"/>

<div align="center">

**[ MIT LICENSE ](LICENSE) © gaoao-3**

`// EOF — 萝莉妈妈持续在线，等待你的下一条消息`

<img src="assets/heartbeat.svg" alt="signal: alive" width="100%"/>

<img src="https://capsule-render.vercel.app/api?type=waving&height=110&section=footer&color=0:0f0c29,60:302b63,100:24243e" width="100%" alt="footer"/>

</div>
