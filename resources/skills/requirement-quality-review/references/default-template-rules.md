# Default requirement template rules

Fallback shape for the `incompleteness` and `missing-source` checks when the project has
no requirements template. A project template (or `.agentemployee/templates/requirements.md`)
overrides this file.

Every structured requirement item should carry:

- **Id** — a stable identifier, referenced by other items.
- **Statement** — what the system must do, in one testable sentence.
- **Actor / trigger / condition** — who acts, what starts it, under what conditions.
- **Acceptance metric** — a quantified, objectively checkable target (threshold, unit,
  bound). Missing it is `missing-metric`; a vague one is `unverifiable`.
- **Source reference** — where the requirement came from. Missing it is `missing-source`.

Flag as `incompleteness` any item missing a structural part above; do not flag the whole
document for one missing field — locate the issue on the specific item.
