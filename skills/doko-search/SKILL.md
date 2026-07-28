---
name: doko-search
description: >-
  Free web search using dokobot read in local mode — read search engine result pages through your real Chrome browser. No API key, no cost, no rate limits. Works with Google, Bing, DuckDuckGo, Baidu, platform search pages, and other search engines.
read_when:
  - User asks to search the web for information
  - Need to find recent news, articles, or documentation
  - Looking up facts, prices, comparisons, or reviews
  - Researching a topic that requires multiple search queries
  - Finding URLs or references for further reading
emoji: "🔍"
homepage: https://dokobot.ai
compatibility: Requires @dokobot/cli (npm install -g @dokobot/cli), Chrome browser with Dokobot extension, and local bridge (dokobot install-bridge).
allowed-tools: dokobot_search dokobot_read
metadata:
  author: dokobot
  version: "1.2.1"
id: "173023680392200192"
---

# Web Search — Free Local Search via ReadPage

## loli-plugin runtime adapter

This installation runs inside loli-plugin, not a host shell. Do **not** invoke Bash or type raw `dokobot` commands.

- Use `dokobot_search` for every search-engine query. It already constructs the URL and calls Dokobot local mode through the connected Chrome Bridge.
- Use `dokobot_read` to open a selected result or a platform-specific URL. Pass `screens` and `sessionId` when continuation is needed.
- Treat the shell examples below as workflow documentation only; translate them to `dokobot_search` / `dokobot_read` calls.
- Keep source URLs in the final answer and clearly identify search-engine fallbacks.

Search the web by reading search engine result pages directly through your local Chrome browser with `dokobot read --local`. No search API needed. No cost. No rate limits. Results come from the same search engine page you'd see in your browser.

## How it works

Construct a search engine URL with your query, then read the page with `dokobot read --local`. The browser renders the full page (including JavaScript), and dokobot extracts the search results as structured text.

```bash
dokobot read --local 'https://www.google.com/search?q=your+query+here'
```

## Supported search engines

| Engine | URL pattern |
|--------|------------|
| Google | `https://www.google.com/search?q=your+query` |
| Bing | `https://www.bing.com/search?q=your+query` |
| DuckDuckGo | `https://duckduckgo.com/?q=your+query` |
| X / Twitter | `https://x.com/search?q=your+query&src=typed_query` |
| Baidu | `https://www.baidu.com/s?wd=your+query` |
| Yandex | `https://yandex.com/search/?text=your+query` |
| Sogou | `https://www.sogou.com/web?query=your+query` |

Use whichever engine suits the query. Google is the default choice for most searches. For platform-specific requests, use the platform URL first. For Chinese content, Baidu or Sogou may return better results.

## Query construction

URL-encode the query when building the URL. Replace spaces with `+` or `%20`.

```bash
# Simple query
dokobot read --local 'https://www.google.com/search?q=rust+web+frameworks+2025'

# Exact phrase
dokobot read --local 'https://www.google.com/search?q=%22exact+phrase%22'

# Site-scoped search
dokobot read --local 'https://www.google.com/search?q=site%3Agithub.com+dokobot'

# Exclude terms
dokobot read --local 'https://www.google.com/search?q=python+web+framework+-django'

# Recent results (Google tbs param: past year)
dokobot read --local 'https://www.google.com/search?q=llm+benchmarks&tbs=qdr:y'
```

## Search workflow

A typical search-then-read workflow:

```bash
# Step 1: Search
dokobot read --local 'https://www.google.com/search?q=best+rust+web+frameworks+2025'

# Step 2: Pick the most relevant URL from results and read it
dokobot read --local 'https://example.com/rust-frameworks-comparison'

# Step 3: Refine and search again if needed
dokobot read --local 'https://www.google.com/search?q=actix-web+vs+axum+performance'
```

## Dynamic or platform search pages

For result pages that render lazily or require login state, such as X/Twitter, Reddit, YouTube, LinkedIn, Instagram, and other feed-style pages, use a continuation-first workflow:

```bash
dokobot read --local '<search-url>' --screens 5 --timeout 90
dokobot read --local '<search-url>' --session-id <SESSION_ID> --screens 5 --timeout 90
```

- If the first result is sparse or mostly empty but prints `Session: <id>`, continue that same session before switching sources.
- If a platform-specific search was requested, try the platform URL first. Use a search-engine fallback like `site:x.com query` only after the platform read fails or exposes no useful text.
- In the final answer, say whether the results came directly from the requested platform or from a fallback search engine.

## Multi-language search

Search in the target language for best results. The browser's locale and login state affect what the search engine returns.

```bash
# Chinese search
dokobot read --local 'https://www.baidu.com/s?wd=Rust+Web框架+对比+2025'

# Japanese search
dokobot read --local 'https://www.google.co.jp/search?q=Rust+Webフレームワーク+比較'
```

## Tips

- **Always use `--local`** — free, fast, unlimited, and uses your browser's logged-in sessions and locale
- **Google is the default** for most queries, but switch engines when appropriate
- **Read the results page first**, then read individual URLs — don't guess URLs
- **Refine queries** iteratively based on what you find
- **Use search operators** (site:, "exact phrase", -exclude) for precision
- **Continue dynamic pages first** — when output includes `Session: <id>`, use `--session-id` with more `--screens` before falling back
- **Space out requests** if a search engine shows CAPTCHAs

## Limitations

- Results depend on your browser's locale, region, and login state
- CAPTCHAs may appear after many rapid searches from the same engine — switch engines or wait
- Some search engines and platform pages load results dynamically — dokobot handles JavaScript rendering, but infinite-scroll results may require `--screens` and `--session-id`
- Platform pages can return a blank extraction when the browser is logged out, rate limited, blocked, or the feed has not rendered yet
