# Schema routing rules

`schema.md` at the KB root is authoritative for how pages are typed and where they
live. When it is present, follow it; its custom page types and directories win over
the defaults below.

## Reading the routing table

`schema.md` lists page types in a Markdown table under a **Page types** heading:

```
## Page types

| type | directory |
| --- | --- |
| paper | wiki/papers |
| person | wiki/people |
```

For every generated page:

1. Pick the `type` whose meaning best matches the content.
2. Write the page into that type's `directory`.
3. Set the page's frontmatter `type` to exactly that type.

The directory in the `type` row and the frontmatter `type` must agree — a `person`
page belongs in the `person` directory, not in `wiki/entities/`.

## Defaults when the schema is silent

When `schema.md` defines no matching type, fall back to the built-in types:

| content | type | directory |
| --- | --- | --- |
| an ingested source's summary | `source` | `wiki/sources` |
| a named person, org, product, dataset, or tool | `entity` | `wiki/entities` |
| a theory, method, technique, or phenomenon | `concept` | `wiki/concepts` |

Do not force content into a schema type it doesn't genuinely match — never invent a
"goal", "habit", or "decision" page just because the schema lists that type. Use it
only when the source actually contains that kind of content.

## Safety

- Keep every page path inside the KB root and under `wiki/` (plus the root-level
  `index.md`/`log.md`/`purpose.md`/`schema.md`).
- No `..`, no absolute paths, no Windows-reserved characters in file names.
- Never write into `raw/` except when importing a new source.
