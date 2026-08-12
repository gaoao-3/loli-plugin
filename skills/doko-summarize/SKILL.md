---
name: doko-summarize
description: >-
  读取一个或多个网页并生成简短总结、关键要点、行动项或阅读摘要。
  用户要求“总结或概括网页/文章、提炼要点、做 TL;DR、汇总多个链接”，或 asks to summarize web pages, articles, or documents, create a digest, or extract key takeaways 时使用。
allowed-tools: dokobot_read
metadata:
  author: dokobot
  version: "1.2.0"
  homepage: https://dokobot.ai
  id: "173023743399034880"
  emoji: "📋"
  compatibility: Requires the loli-plugin Dokobot read integration.
---

# Web Summarization

## Workflow

1. Read each source with `dokobot_read` and retain its URL and title.
2. When the result includes `canContinue` and a `sessionId`, collect the remaining content before summarizing.
3. Choose brief, key-points, detailed, or multi-page digest form according to the user's requested depth.
4. Preserve important numbers, dates, benchmark values, qualifications, and attributed claims.
5. Separate the source's conclusions from your own interpretation and identify evident promotional or one-sided framing.

## Default format

```markdown
## Summary: [Title]
**Source:** [URL]

### TL;DR
[Concise overview]

### Key points
- [Important point]

### Notable details or limitations
- [Evidence, caveat, or action item]
```

For multiple pages, summarize each source separately before listing shared themes, disagreements, and combined takeaways.

## Guardrails

- Use only `dokobot_read`; never invoke raw CLI or shell commands.
- Exclude navigation, ads, cookie banners, unrelated recommendations, boilerplate, and irrelevant author biographies.
- Do not summarize partial or truncated content as a complete page.
- Do not inject unsupported corrections or opinions into the source summary.
- If the tool is unavailable, permission is denied, or a page cannot be read, state the limitation instead of simulating content.
