---
name: dokobot
description: >-
  使用真实 Chrome 浏览器打开并读取网页，包括动态页面、SPA、JavaScript 渲染或需要登录态的页面，并可截图或下载网页图片。
  用户要求“打开网页、读取动态页面、网页截图、下载网页图片”，或 asks to read a dynamic, JavaScript-rendered, or login-required page, take a webpage screenshot, or download page images 时使用。
allowed-tools: dokobot_search dokobot_read dokobot_screenshot dokobot_download_images dokobot_close_session
metadata:
  author: dokobot
  version: "2.3.5"
  homepage: https://dokobot.ai
  id: "173023672318164992"
  emoji: "🌐"
  compatibility: Requires the loli-plugin Dokobot integration and a connected Chrome Bridge.
  openclaw: {"requires": {"bins": ["dokobot"]}, "optionalEnv": ["DOKO_API_KEY"]}
---

# Dokobot Web Access

## Workflow

1. Use `dokobot_read` when the user provides a URL or asks to inspect a specific page.
2. Use `dokobot_search` when a URL must first be discovered, then read the most relevant results with `dokobot_read`.
3. Use `dokobot_screenshot` only when the user needs a rendered visual capture.
4. Use `dokobot_download_images` only when the user asks for images from the page.
5. Close a continued read session with `dokobot_close_session` when it is no longer needed and the tool is available.

## Session handling

- When `dokobot_read` returns `canContinue` and a `sessionId`, continue the same URL with that `sessionId` before starting over.
- Preserve source URLs and distinguish text actually returned by tools from inference.
- Read only as many screens as the task needs; stop when additional reads repeat existing content.

## Guardrails

- Use only the plugin tools exposed in the current conversation. Never invoke Bash or raw Dokobot CLI commands.
- If a required tool is unavailable, permission is denied, or the Bridge fails, report the limitation and offer a non-simulated alternative.
- Never claim that a page was read, captured, or downloaded unless the corresponding tool result confirms success.
- Do not expose logged-in page content, browser state, credentials, or private data to unrelated users.
