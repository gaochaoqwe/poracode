---
name: knowledge-base
description: Build and maintain a project's persistent knowledge base — a structured, interlinked markdown wiki compiled from raw source documents. Use when the user asks to ingest/add/import a source into the knowledge base, query/ask questions against it, or lint/health-check it. Commands: "ingest", "query", "lint". The knowledge base root is passed in the request as `--kb <absolute path>`.
---

# Knowledge Base

The knowledge base (KB) is a **persistent, compounding artifact**: a directory of
markdown pages that sits between the user and their raw sources. You compile it —
you read a source once, extract what matters, integrate it into the existing wiki,
and keep cross-references and summaries current. The user curates sources and asks
questions; you do all of the writing and bookkeeping.

The request names the operation and the KB root, e.g.:

```
/knowledge-base ingest --kb /home/me/.agentemployee/knowledge/proj-1a2b3c4d
/knowledge-base query --kb <root> --question "…"
/knowledge-base lint --kb <root>
```

## Reading the request

- **`--kb <absolute path>`** is the KB root. It is **outside the project** — write
  every KB file with its absolute path. Never create KB files inside the project.
- **`ingest`** — one or more source files are named (or already copied into
  `raw/sources/`). Process them.
- **`query`** — answer the user's question from the wiki.
- **`lint`** — health-check the wiki and report/fix issues.

If `--kb` is missing, stop and ask. Never guess a root.

## Layout

```
<kb root>/
  purpose.md      # why this KB exists; read before every operation
  schema.md       # page types + routing rules; read before every ingest
  index.md        # catalog of every page; you rebuild it on each ingest
  log.md          # append-only operation log
  raw/sources/    # immutable imported sources — read, never edit
  wiki/sources/   # one summary page per ingested source
  wiki/entities/  # people, orgs, products, datasets, tools
  wiki/concepts/  # theories, methods, techniques, phenomena
```

`schema.md` may define additional page types/directories. Follow it when present —
`references/schema-rules.md` explains the routing rules.

**Always read `purpose.md`, `schema.md`, and `index.md` before ingesting or querying.**
They are the KB's context and navigation.

## Operation: ingest

Ingest one source at a time. Work in **two passes** — analyze first, then write.

### Pass 1 — Analyze (think, do not write files yet)

Read the source in full and produce a structured analysis:

- **Key entities** — named people, organizations, products, datasets, tools; each with
  its role/significance and whether it already exists in the wiki (check `index.md`).
- **Key concepts** — theories, methods, techniques, phenomena; each with a one-line
  definition and why it matters here.
- **Main arguments & findings** — core claims, the evidence, how strong it is, and
  which named subject each claim is about. Do not transfer a claim from one entity to
  another just because they share keywords. Preserve exact structured data (SQL DDL,
  API signatures, config, tables) verbatim in fenced code blocks — do not paraphrase
  field names, types, or values.
- **Connections to existing wiki** — which pages this strengthens, extends, or challenges.
- **Contradictions & tensions** — conflicts with existing pages, or internal caveats.
- **Recommendations** — which pages to create vs. update; what to emphasize; open questions.

### Pass 2 — Write

Generate and write the files directly (use your normal file-writing tools with the
absolute KB root):

1. **Source summary** at `wiki/sources/<source-name>.md`.
2. **Entity pages** in `wiki/entities/` for key named things (or schema-defined dirs).
3. **Concept pages** in `wiki/concepts/` for key ideas (or schema-defined dirs).
4. **Update existing pages** the analysis says this source touches — revise summaries,
   add the cross-reference, note superseded or contradicted claims.
5. **Rebuild `index.md`** so it lists every page with a one-line summary, grouped by
   category.
6. **Append one line to `log.md`**: `## [YYYY-MM-DD] ingest | <Title>`.

### Frontmatter (strict)

Every page begins with a YAML frontmatter block. The **first line must be exactly `---`**,
ending with another `---` line; no code fence around it, no leading key.

```
---
type: entity
title: Example Entity
created: 2026-01-31
updated: 2026-01-31
tags: [example, demo]
related: [other-page-slug]
sources: [source-file-name.md]
---
```

- `type` — `source` | `entity` | `concept`, or a type defined by `schema.md`.
- `title` — quote it if it contains a colon.
- `created`/`updated` — `YYYY-MM-DD`, today's date.
- `tags`/`related` — bare strings/slugs in inline arrays. `related` holds **slugs only**
  (no `wiki/`, no `.md`, no `[[…]]`).
- `sources` — source filenames; every page from an ingest includes that source.
- Put `[[Wikilink]]` cross-references in the **body**, never in frontmatter.

## Operation: query

1. Read `index.md` to find candidate pages, then read those pages (and the source
   pages they cite).
2. Answer from the **wiki**, not from memory. Cite the pages you used with their paths.
3. If the wiki lacks the answer, say so plainly and suggest what source would fill the gap.
4. A worthwhile answer can be filed back as a new page — offer to add it if it belongs.

## Operation: lint

Check the wiki for health problems and report each with a page path and a suggested fix:

- **Orphan pages** — no inbound `[[wikilinks]]`.
- **Broken links** — a `[[link]]` whose target page doesn't exist.
- **Missing pages** — a concept/entity mentioned repeatedly but lacking its own page.
- **Stale/contradicted claims** — a newer source superseded an older statement.
- **Index drift** — pages not listed in `index.md`, or listed pages that are gone.
- **Gaps** — open questions worth searching for.

Fix what is unambiguous (add missing index entries, repair obvious broken links) and
list the rest for the user. Append `## [YYYY-MM-DD] lint | <summary>` to `log.md`.

## Hard rules

- `raw/sources/` is **immutable** — never edit or delete an imported source.
- Never write KB files inside the project tree; the KB root is external.
- Rebuild `index.md` and append `log.md` on **every** ingest — never skip bookkeeping.
- Preserve the source's language for generated pages unless the user asks otherwise.
