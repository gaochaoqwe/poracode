---
name: requirement-quality-review
description: Run an automatic quality check over structured requirement items and report ambiguity, duplication, conflict, unverifiability, missing metrics, and inconsistent terminology. Use when the user asks to review/check requirement quality, find ambiguous or conflicting requirements, detect duplicate or unverifiable items, or audit a requirements document for metrics and terminology. Item by item first, then across items. Reports issues with source, type, severity, and a suggested direction — never a final verdict, and never rewrites user-confirmed content.
---

# Requirement Quality Review

Check structured requirement items against a **fixed** catalog of problems and report
an issue list. This skill **does not decide** whether a requirement is good or bad — it
points at problems and suggests a direction, and the user confirms, revises, or rejects
each one.

## 1. Inputs

Gather these before checking. If a required input is missing, **stop and ask** — do not
invent requirement content.

- **Structured requirement items** (required): the requirement document, with item ids
  where present. This is what you check.
- **Terminology rules** (optional): a glossary or naming rules. If absent, read the
  project's `.agentemployee/terminology.md`, then fall back to `references/default-terminology-rules.md`.
- **Template rules** (optional): the required section/field shape. If absent, read the
  project's `.agentemployee/templates/requirements.md` if present.
- **Project scope** (optional): which part of the system is in scope, so you do not flag
  out-of-scope omissions.

## 2. The fixed check catalog

Check **only** these types. The authoritative list with ids and scopes is
`references/check-catalog.json`; do not invent new types.

Item-level checks — look at each item on its own:

- `ambiguity` — subjective or multi-meaning wording (“fast”, “as needed”, “user-friendly”).
- `incompleteness` — the item omits a needed part (actor, trigger, condition, result).
- `unverifiable` — no objective way to test whether the item is satisfied.
- `missing-metric` — a quantified target, threshold, or unit is absent.
- `missing-source` — the item does not cite where it came from (no source reference).

Cross-item checks — compare items against each other:

- `duplication` — the same or near-same requirement stated more than once.
- `conflict` — two items that cannot both hold.
- `metric-value-conflict` — the same metric carries different values in different items.
- `term-inconsistency` — one concept under several names, or one term with several meanings.
- `interface-field-inconsistency` — an interface field defined differently across items.

Severity is `high`, `medium`, or `low`, judged by impact if the issue ships unresolved
(`high` = blocks acceptance or causes contradictory behavior).

## 3. Method — item by item, then across items

1. **Item pass.** Walk every requirement item and run the item-level checks. Record the
   item's `source` (file, section, anchor, and `itemId` when present).
2. **Cross pass.** Compare items pairwise for the cross-item checks. Name the related
   items in `relatedItemIds` and locate the issue on the item that should change.
3. Do **not** merge distinct problems into one issue, and do **not** report the same
   problem twice — each issue has one type and one locator.

Keep locators **stable**: reuse the same `itemId`/section/anchor when you re-check, so a
re-run maps to the same issue instead of creating a new one.

## 4. Output

Reply in two parts.

**Part 1 — a readable Markdown report**, grouped by severity (high first), each entry
showing: source location, type, related items, severity, and the suggested direction.

**Part 2 — a machine-readable issue list as the LAST fenced ```json block in the reply**,
matching `references/issue-schema.json`:

```json
{
  "kind": "requirement-quality-report",
  "version": 1,
  "scope": { "documents": ["docs/srs.md"] },
  "issues": [
    {
      "id": "Q-1",
      "source": { "file": "docs/srs.md", "section": "3.7.3", "itemId": "REQ-AGENT-QA-001" },
      "type": "ambiguity",
      "scope": "item",
      "severity": "high",
      "relatedItemIds": [],
      "summary": "“尽快” has no measurable bound.",
      "suggestion": "Replace with a concrete time target."
    }
  ]
}
```

Emit the JSON block **only when it is complete** — no trailing commentary after it.

## 5. Constraints

- **Never give a final verdict.** Report problems and suggest a direction; the decision
  is the user's.
- **Never rewrite or overwrite content the user has already confirmed.** Only point at
  issues; applying a fix is the user's action.
- **Always cite the source.** An issue without a locator is not usable.
- If the requirement set is clean, emit an empty `issues` array — do not manufacture
  issues to look thorough.
