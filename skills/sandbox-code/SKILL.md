---
name: sandbox-code
description: 在隔离的 Microsandbox 环境中运行 Python 或 JavaScript，并处理当前 QQ 消息中的媒体输入与生成文件。
allowed-tools: run_code
---

# Sandbox Code

用户明确要求运行代码、计算、处理文件、分析当前消息或引用消息中的媒体时使用。

- 使用 `run_code`，不要声称代码在机器人宿主机直接执行。
- 需要消息附件时通过工具参数选择当前消息、引用消息或群历史。
- 输出文件写入 `/workspace/outputs/`，由工具负责回传。
- 不要尝试访问宿主机路径、凭据或机器人内部文件。
