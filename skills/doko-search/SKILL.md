---
name: doko-search
description: >-
  使用 Dokobot/Chrome 搜索互联网并读取结果页，获取实时资料、新闻、价格、事实、技术文档和链接。
  用户说“搜索、联网搜索、查资料、查新闻、查价格、找网页或链接”，或 asks to search or look up current web information, news, prices, facts, documentation, or URLs 时使用。
allowed-tools: dokobot_search dokobot_read
metadata:
  author: dokobot
  version: "1.2.1"
  homepage: https://dokobot.ai
  id: "173023680392200192"
  emoji: "🔍"
  compatibility: Requires the loli-plugin Dokobot integration; search may use the configured browser or fallback provider.
---

# Web Search

## Workflow

1. Turn the request into a concise, specific query and call `dokobot_search`.
2. Inspect titles, snippets, dates, and URLs before selecting results.
3. Read promising sources with `dokobot_read`; do not infer article contents from snippets alone.
4. Refine the query using names, dates, exact phrases, domains, or missing evidence when initial results are weak.
5. Answer with the source URLs actually used and identify any search-provider fallback reported by the tool.

## Search strategy

- Prefer current and primary sources for time-sensitive facts, official documentation, and product behavior.
- Use platform-specific or domain-specific queries when the user names a site.
- Search in the target content language when it improves recall.
- When a dynamic result returns `canContinue` and a `sessionId`, continue that read session before abandoning the source.
- Switch query wording or provider when results are repetitive, irrelevant, blocked, or dominated by stale pages.

## Guardrails

- Use only `dokobot_search` and `dokobot_read`; never invoke raw CLI or shell commands.
- Do not invent URLs, citations, page contents, or freshness claims.
- If a tool is unavailable, permission is denied, or every provider fails, state the limitation instead of simulating results.
