---
name: doko-translate
description: >-
  Translate web page content while preserving structure and formatting. Reads any web page via a real Chrome browser and translates it section by section, keeping headings, lists, tables, and code blocks intact.
read_when:
  - User asks to translate a web page or article into another language
  - Reading foreign-language documentation, news, or blog posts
  - Need to understand content in a language the user doesn't speak
  - Translating technical documentation while preserving code examples
  - Comparing content across different language versions of a page
emoji: "🌍"
homepage: https://dokobot.ai
compatibility: Requires @dokobot/cli (npm install -g @dokobot/cli), Chrome browser with Dokobot extension, and local bridge (dokobot install-bridge).
allowed-tools: dokobot_read
metadata:
  author: dokobot
  version: "1.2.0"
id: "173023722402349056"
---

# Web Translation — Translate Pages with Structure Preserved

## loli-plugin runtime adapter

This Skill runs inside loli-plugin. Do not invoke Bash or raw `dokobot` commands. Read the source with `dokobot_read`, continue with its `sessionId` when needed, then translate the returned content in the model while preserving structure. The shell examples below are reference documentation only.

Translate any web page into the user's language while keeping the original structure intact. Headings stay as headings, tables stay as tables, code blocks remain untouched. The result reads like a native-language document, not a raw machine translation dump.

## How it works

1. Read the page with `dokobot read`
2. Translate the extracted content section by section
3. Preserve all structural elements (headings, lists, tables, code, links)

```bash
# Read a foreign-language page
dokobot read --local 'https://example.jp/technical-guide'
```

Then translate the returned content into the target language.

## Translation rules

### Preserve structure exactly
- Keep all heading levels (`#`, `##`, `###`) unchanged
- Keep list formatting (bullets, numbered lists) unchanged
- Keep table structure (columns, alignment) unchanged
- Keep code blocks and inline code **untranslated** — code is universal
- Keep URLs, file paths, and command-line examples unchanged

### What to translate
- Headings text
- Paragraph body text
- List item text
- Table cell text (except code/technical identifiers)
- Image alt text and captions

### What NOT to translate
- Code blocks and inline code
- URLs and links
- Brand names, product names, project names
- Technical identifiers (API names, function names, config keys)
- Version numbers

## Handling long pages

For long pages, `dokobot read` may return a `sessionId` with `canContinue: true`. Continue reading, then translate the full content:

```bash
# First read
dokobot read --local 'https://example.com/long-article'

# Continue reading from where it stopped
dokobot read --local 'https://example.com/long-article' --session-id <SESSION_ID> --screens 5

# Translate all collected content together for consistency
```

Translate the entire page as a whole for term consistency — don't translate each chunk independently.

## Language detection

- If the user doesn't specify a target language, translate into the language they're using in the conversation
- If the source and target language are the same, tell the user — don't "translate" into the same language
- For multilingual pages (e.g., code docs with English API names and Japanese descriptions), only translate the natural-language portions

## Quality guidelines

- **Terminology consistency.** Use the same translation for a term throughout the document. If "container" is translated as "容器" in paragraph 1, don't switch to "集装箱" in paragraph 5.
- **Technical accuracy.** For technical content, prefer established translations used in official documentation. When in doubt, keep the English term with a parenthetical translation on first occurrence: "container (容器)".
- **Natural flow.** Translate for meaning, not word-by-word. A translated sentence should read naturally in the target language.
- **Context-aware.** The same word can mean different things in different contexts. "Port" in networking (端口) vs. shipping (港口) vs. software (移植).

## Example

User: "Translate this Rust documentation page into Chinese"

```bash
dokobot read --local 'https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html'
```

Then translate the returned content following the rules above — preserve code examples, translate explanatory text, keep `ownership`, `borrowing`, `lifetime` as English with parenthetical Chinese on first use.
