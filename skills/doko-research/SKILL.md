---
name: doko-research
description: >-
  Iterative web research with structured synthesis and source tracking. Conducts multi-round searches via local readpage, reads and cross-references sources, builds a structured research report with citations.
read_when:
  - User asks to research a topic in depth
  - Need to compare multiple sources and synthesize findings
  - Writing a report, analysis, or literature review on a topic
  - Investigating a question that requires evidence from multiple web pages
  - Fact-checking claims by cross-referencing multiple sources
emoji: "🔬"
homepage: https://dokobot.ai
compatibility: Requires @dokobot/cli (npm install -g @dokobot/cli), Chrome browser with Dokobot extension, and local bridge (dokobot install-bridge).
allowed-tools: dokobot_search dokobot_read
metadata:
  author: dokobot
  version: "1.2.0"
id: "173023701535686656"
---

# Deep Research — Iterative Web Research with Source Tracking

## loli-plugin runtime adapter

This Skill runs inside loli-plugin. Do not invoke Bash or raw `dokobot` commands. Use `dokobot_search` for each research query and `dokobot_read` for promising sources and continuation sessions. Treat the shell examples below as workflow illustrations only. Keep source URLs and cite the pages actually read.

Conduct thorough, multi-round web research on any topic. Unlike a single search, deep research iterates: search via readpage, read results, evaluate, refine the query, and repeat until the question is fully answered. Every claim links back to its source.

## When to use

Use this skill when a single search isn't enough — when the user needs:
- A comprehensive understanding of a topic from multiple angles
- Comparison of competing products, frameworks, or approaches
- Fact-checking with cross-referenced sources
- A structured report with citations

For a quick lookup, use the **Web Search** skill instead. Deep Research is for questions worth 5-15 minutes of investigation.

## Research workflow

### Phase 1: Scope

Before searching, define what you need to find out. Break the user's question into 2-5 sub-questions.

Example: "What's the best database for my project?" becomes:
1. What are the leading options in this category?
2. How do they compare on performance, cost, and ecosystem?
3. What do real users say about production experience?
4. What are the known limitations or failure modes?

### Phase 2: Search and read

For each sub-question, search by reading search engine pages, then read the results:

```bash
# Round 1: Broad search via Google readpage
dokobot read --local 'https://www.google.com/search?q=PostgreSQL+vs+MySQL+vs+SQLite+comparison+2025'

# Read the most promising results
dokobot read --local 'https://example.com/db-comparison'

# Round 2: Follow up on specifics found in round 1
dokobot read --local 'https://www.google.com/search?q=PostgreSQL+JSONB+performance+benchmarks'
dokobot read --local 'https://example.com/pg-benchmarks'

# Round 3: Check a different perspective (site-scoped search)
dokobot read --local 'https://www.google.com/search?q=PostgreSQL+production+issues+site%3Areddit.com'
dokobot read --local 'https://reddit.com/r/database/...'
```

**Key principles:**
- Read at least 3-5 sources per sub-question
- Prefer primary sources (official docs, benchmarks, papers) over summaries
- When sources disagree, note the conflict and search for a tiebreaker
- Stop when new sources repeat what you've already found
- Use search operators (`site:`, `"exact phrase"`, `-exclude`) for precision

### Phase 3: Synthesize

Organize findings into a structured report:

```markdown
## [Topic]

### Key Findings
- Finding 1 [source1][source2]
- Finding 2 [source3]

### Comparison (if applicable)
| Criterion | Option A | Option B |
|-----------|----------|----------|
| ...       | ...      | ...      |

### Risks / Limitations
- ...

### Recommendation
- ...

### Sources
1. [Title](url) — what was learned from this source
2. [Title](url) — what was learned from this source
```

## Guidelines

- **Always cite sources.** Every factual claim should link to where you found it. Use numbered references or inline links.
- **Distinguish fact from opinion.** Label benchmark data, official docs, and user anecdotes differently.
- **Note information freshness.** Flag when a source is outdated (e.g., a 2022 benchmark for a rapidly evolving tool).
- **Acknowledge gaps.** If you couldn't find reliable information on a sub-question, say so rather than guessing.
- **Always use `--local` mode** — free, fast, unlimited, uses your browser's locale and login state.
- **Limit scope.** Aim for 10-20 sources total. More isn't better if you're reading the same information repeatedly.
- **Iterate, don't shotgun.** Read results from round N before deciding what to search in round N+1. Each round should be informed by what you've already learned.
- **Switch search engines** if results are poor — try Bing, DuckDuckGo, or Baidu for different perspectives.

## Example

User: "Should we migrate from REST to GraphQL for our mobile app?"

Research plan:
1. Search for REST vs GraphQL tradeoffs in mobile contexts
2. Read case studies of companies that migrated (and some that chose not to)
3. Search for GraphQL performance overhead and caching challenges
4. Read about tooling maturity (Apollo, Relay, urql)
5. Search for developer experience comparisons

```bash
# Search via readpage
dokobot read --local 'https://www.google.com/search?q=REST+vs+GraphQL+mobile+app+tradeoffs+2025'
dokobot read --local 'https://...'

# Dig deeper on a subtopic
dokobot read --local 'https://www.google.com/search?q=GraphQL+migration+case+study+mobile'
dokobot read --local 'https://...'

# Check specific concerns
dokobot read --local 'https://www.google.com/search?q=GraphQL+caching+challenges+mobile+offline'
dokobot read --local 'https://...'
```

Deliver a structured report with a recommendation, tradeoffs, and all sources listed.
