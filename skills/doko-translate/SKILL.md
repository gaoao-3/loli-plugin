---
name: doko-translate
description: >-
  读取网页并在保留标题、列表、表格、代码块和链接结构的前提下翻译。
  用户要求“翻译网页、文章或文档、把英文页面译成中文、对照多语言版本”，或 asks to translate a web page, article, or document while preserving structure 时使用。
allowed-tools: dokobot_read
metadata:
  author: dokobot
  version: "1.2.0"
  homepage: https://dokobot.ai
  id: "173023722402349056"
  emoji: "🌍"
  compatibility: Requires the loli-plugin Dokobot read integration.
---

# Web Translation

## Workflow

1. Read the source page with `dokobot_read`.
2. When the result includes `canContinue` and a `sessionId`, collect the remaining sections through the same session before translating.
3. Infer the target language from the request; if it is omitted, use the user's conversation language.
4. Translate the collected content consistently while preserving the original structure.
5. Include the source URL and note any section that could not be read.

## Translation rules

- Preserve heading levels, list numbering, table shape, links, and section order.
- Translate natural-language headings, paragraphs, list items, captions, and relevant table cells.
- Keep code blocks, inline code, URLs, file paths, commands, API names, identifiers, config keys, versions, and product names unchanged.
- Use established technical terminology and keep one translation for each term throughout the page.
- Translate for meaning and context rather than word by word.
- Keep an important source-language term in parentheses on first use when translation alone could be ambiguous.
- If source and target languages are the same, explain that no translation is needed.

## Guardrails

- Use only `dokobot_read`; never invoke raw CLI or shell commands.
- Do not translate missing, truncated, or unread content as though it were present.
- Do not alter code examples or silently remove structural elements.
- If the tool is unavailable, permission is denied, or the page cannot be read, state the limitation instead of simulating a translation.
