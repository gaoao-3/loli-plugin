---
name: doko-research
description: >-
  进行多轮网页检索、交叉验证、来源追踪和带引用的结构化综合。
  用户要求“深入研究、调查、事实核查、多来源对比、文献综述、研究报告”，或 asks for deep research, an investigation, fact-checking, literature review, or a source-backed comparison or report 时使用。
allowed-tools: dokobot_search dokobot_read
metadata:
  author: dokobot
  version: "1.2.0"
  homepage: https://dokobot.ai
  id: "173023701535686656"
  emoji: "🔬"
  compatibility: Requires the loli-plugin Dokobot search and read integration.
---

# Deep Research

## Workflow

1. Restate the research objective and split it into a small set of answerable sub-questions.
2. Search each sub-question with `dokobot_search`, starting broad and refining from evidence already found.
3. Read the most relevant sources with `dokobot_read`; continue the same `sessionId` when a source is incomplete.
4. Track each source URL, publication date, source type, and the claims it supports.
5. Cross-check important or disputed claims against independent sources and seek a primary source when available.
6. Stop when new sources mostly repeat established findings or when remaining gaps cannot be resolved reliably.
7. Synthesize the evidence into a structured answer with citations, conflicts, limitations, and a calibrated conclusion.

## Source discipline

- Prefer official documentation, original datasets, research papers, direct statements, and other primary sources.
- Distinguish measured facts, vendor claims, expert interpretation, and user anecdotes.
- Flag stale evidence when the topic changes quickly.
- Report source disagreement explicitly; do not silently choose the most convenient claim.
- Acknowledge unanswered sub-questions instead of guessing.
- Let evidentiary importance determine source count; do not collect repetitive sources to meet a quota.

## Output structure

Use the sections that fit the request:

```markdown
## Key findings
- Finding with citation

## Comparison or analysis
- Evidence, tradeoffs, and disagreements

## Risks and limitations
- Missing or uncertain evidence

## Conclusion
- Calibrated answer or recommendation

## Sources
1. [Title](URL) — relevance
```

## Guardrails

- Use only `dokobot_search` and `dokobot_read`; never invoke raw CLI or shell commands.
- Do not cite search snippets as if the underlying page was read.
- Do not present unsupported synthesis as sourced fact.
- If a tool is unavailable, permission is denied, or evidence remains insufficient, state the limitation instead of simulating research.
