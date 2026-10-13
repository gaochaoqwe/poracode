# Default terminology rules

Fallback rules for the `term-inconsistency` check when the project has no glossary.
A project glossary (or `.agentemployee/terminology.md`) overrides this file.

- A concept must be named by **one** term throughout the requirement set. Flag synonyms
  used for the same concept (e.g. “user” vs “operator” vs “end user”) as
  `term-inconsistency`.
- A term must carry **one** meaning. Flag the same term used for different concepts
  (e.g. “account” meaning both a login and a billing entity).
- Field, entity, and interface names must match exactly across items — differing case,
  separator style (`user_id` vs `userId`), or abbreviation counts as inconsistent.
- Units and metric names must be written the same way everywhere; flag mixed synonyms
  (e.g. “latency” vs “response time”) only when they denote the same measurable quantity.
- Report each inconsistency once, located on the item that should change, and list the
  other occurrences in `relatedItemIds`.
