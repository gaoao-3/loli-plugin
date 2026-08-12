---
name: sandbox-code
description: >-
  在隔离的 Quicksand 环境运行代码，完成计算、数据处理、格式转换、算法验证以及图片、音视频和文件处理。
  用户要求“运行或执行代码、算一下、处理或分析文件/图片/媒体、转换格式、生成文件”时使用。Use for running code, calculations, data or media processing, format conversion, and generated files.
allowed-tools: run_code fetch_resource
---

# Sandbox Code

- 使用 `run_code`，不要声称代码在机器人宿主机直接执行。
- 需要消息附件时通过工具参数选择当前消息、引用消息或群历史。
- `inputs/` 同时包含媒体和 `resource_manifest.json`。先读取清单中的 `primaryFile` 或 `resources[].file`，再打开对应媒体。
- 禁止使用 `os.listdir("inputs")[0]`、`glob("*")[0]` 等方式猜文件；目录遍历顺序不保证媒体排在清单前。
- 指定了 `resource_filter.input_name` 时，扩展名仍由真实媒体类型决定，应按 `inputs/<别名>.*` 精确匹配并排除 `.json`。
- 只有用户最新一条消息本身带附件时才选 `source: current`；处理上下文中的较早消息必须使用 `source: history` 和对应 `message_id`，不要先浪费一次 current 调用。
- Python 媒体镜像预装 Pillow 与 ffmpeg。调用外部命令仍须检查返回码；若命令无法启动，应捕获 `FileNotFoundError` 后再执行纯 Python 兜底。
- 输出文件写入 `/workspace/outputs/`，由工具负责回传。只有工具结果包含 `artifactDeliveryStatus: "sent"` 且列出 `sentArtifacts` 时，才可以告诉用户“文件已发送”；出现 `partial`、`failed`、`disabled`、`artifactWarnings` 或 `skippedArtifacts` 时必须如实说明未发送及原因。
- 需要公开网络文件且 URL 已知时，优先在同一次 `run_code` 中设置 `network.mode: controlled` 并列出 `network.resources`；宿主审核下载后自动放入 `inputs/`。分步任务也可先调用 `fetch_resource`。
- 联网模式由任务决定：默认 `network.mode: none`；已知 URL 使用 `controlled`；只有 URL 需在运行时动态产生、调用动态 API 或包管理器时才申请 `full`。`full` 只对主人且宿主已开启危险开关时生效，可能访问宿主机和局域网。
- 不要尝试访问宿主机路径、凭据或机器人内部文件。

Python 读取主输入示例：

```python
import json
from pathlib import Path

manifest = json.loads(Path("inputs/resource_manifest.json").read_text("utf-8"))
input_path = Path("inputs") / manifest["primaryFile"]
```
