---
name: sandbox-browser
description: 在隔离的 Microsandbox 浏览器中执行网页导航、点击、填写、提取和截图任务。
allowed-tools: browser_use
---

# Sandbox Browser

用户要求自动操作公开网页、测试网页交互或生成网页截图时使用 `browser_use`。

- 把相关操作合并成清晰的 actions 序列。
- 不要在未获授权时提交订单、发布内容或执行其他外部状态变更。
- 登录态任务优先说明隔离浏览器可能没有用户现有会话。
