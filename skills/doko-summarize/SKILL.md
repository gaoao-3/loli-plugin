---
name: doko-summarize
description: >-
  Generate concise summaries of web pages with key points extraction. Reads any page via a real Chrome browser and produces structured summaries at adjustable detail levels.
read_when:
  - User asks to summarize a web page, article, or document
  - Need a quick overview of a long article before deciding to read in full
  - Summarizing multiple pages to compare their content
  - Extracting key points, takeaways, or action items from a page
  - Creating a reading digest from a list of URLs
emoji: "📋"
homepage: https://dokobot.ai
compatibility: Requires @dokobot/cli (npm install -g @dokobot/cli), Chrome browser with Dokobot extension, and local bridge (dokobot install-bridge).
allowed-tools: dokobot_read
metadata:
  author: dokobot
  version: "1.2.0"
id: "173023743399034880"
---

# Web Summarization — Structured Summaries with Key Points

## loli-plugin runtime adapter

This Skill runs inside loli-plugin. Do not invoke Bash or raw `dokobot` commands. Read each source with `dokobot_read`, continue with its `sessionId` when needed, and summarize only the content returned by the tool. The shell examples below are reference documentation only.

Read any web page and produce a clean, structured summary. Extracts the signal from the noise — skip the ads, navigation, footers, and boilerplate to deliver just the content that matters.

## How it works

```bash
# Read the page
dokobot read --local 'https://example.com/long-article'
```

Then summarize the returned content following the format guidelines below.

## Summary formats

Choose the format based on what the user needs:

### Brief (1-3 sentences)
For quick triage — is this page worth reading?

> **Summary:** This article compares React, Vue, and Svelte for building production SPAs in 2025, concluding that React still leads in ecosystem size while Svelte offers the best developer experience for smaller teams.

### Key Points (bullet list)
The default format. Captures all important information in scannable bullets.

```markdown
## Summary: [Page Title]

**Source:** [URL]

### Key Points
- Point 1
- Point 2
- Point 3

### Notable Details
- Detail that supports or qualifies the key points
```

### Detailed (structured sections)
For long-form content like technical docs, research papers, or in-depth articles.

```markdown
## Summary: [Page Title]

**Source:** [URL]
**Type:** [article / documentation / tutorial / news / paper / discussion]
**Length:** [short < 1000 words / medium / long > 5000 words]

### TL;DR
One-paragraph overview.

### Key Points
- ...

### Detailed Breakdown
#### [Section 1 heading from original]
- ...

#### [Section 2 heading from original]
- ...

### Quotes
> Notable direct quotes worth preserving (with context)

### Actionable Takeaways
- What the reader should do, try, or investigate based on this content
```

## Summarization guidelines

- **Preserve the author's conclusions.** Summarize what the page says, not what you think about it. Don't inject opinions or corrections into the summary.
- **Keep numbers and data.** Benchmarks, statistics, dates, version numbers — these are often the most valuable parts. "Performance improved" is less useful than "latency dropped from 120ms to 45ms."
- **Attribute claims.** If the page cites a source or attributes a claim, preserve that: "According to the 2024 Stack Overflow survey..." not just "most developers prefer..."
- **Flag content type.** A product landing page, a personal blog post, and a peer-reviewed paper deserve different levels of trust. Note what kind of source it is.
- **Handle bias.** If the page is clearly promotional or one-sided, note that briefly: "Note: this is published by [Company X] about their own product."

## Multi-page summaries

When summarizing multiple pages on the same topic:

```bash
dokobot read --local 'https://example.com/article-1'
dokobot read --local 'https://example.com/article-2'
dokobot read --local 'https://example.com/article-3'
```

Produce a combined digest:

```markdown
## Reading Digest: [Topic]

### [Article 1 Title](url)
- Key point 1
- Key point 2

### [Article 2 Title](url)
- Key point 1
- Key point 2

### Cross-cutting Themes
- What do these articles agree on?
- Where do they disagree?
```

## Long pages

For pages that require multiple reads:

```bash
dokobot read --local 'https://example.com/very-long-article'
# If canContinue is true:
dokobot read --local 'https://example.com/very-long-article' --session-id <SESSION_ID> --screens 5
```

Collect all content before summarizing. Summarizing partial content leads to incomplete or misleading summaries.

## What NOT to include

- Navigation menus, sidebars, footer links
- Cookie banners, subscription prompts, ad content
- "Related articles" or "You might also like" sections
- Boilerplate disclaimers (unless legally significant to the content)
- Author bios (unless relevant to credibility assessment)
