---
name: knowledge-search
description: Answer questions from the user's knowledge base. Use when the user asks about their notes, documents, or knowledge base, or wants a synthesized answer grounded in it. Search with kb_search, read pages with kb_read, and cite the page paths you used.
---

# Knowledge Search

The knowledge base is a machine-wide markdown wiki the user maintains at
`~/.agentemployee/knowledge`. This skill uses the `knowledge` MCP tools:

- **`kb_search`** — keyword-search the wiki pages; returns ranked `path` + `snippet`.
- **`kb_read`** — read a page by its path relative to the KB root.
- **`kb_list`** — list the directory tree.

## How to answer

1. **Search first.** Call `kb_search` with the user's key terms. If results are
   thin, try synonyms or a shorter query.
2. **Browse the catalog** when search misses: `kb_read` `index.md` to see every
   page by category, then read the relevant ones.
3. **Read the pages** — `kb_read` each promising hit (and the source pages they
   cite) before answering.
4. **Answer from the wiki, not from memory.** Cite the page paths you used. If
   the knowledge base doesn't cover the question, say so plainly and suggest what
   source would fill the gap.

## Hard rules

- Tools are **read-only** — never try to write to the knowledge base.
- Do not answer from general knowledge when the user asked about *their*
  knowledge base; ground the answer in the pages or say the KB lacks it.
- Prefer a few precise pages over reading everything.
