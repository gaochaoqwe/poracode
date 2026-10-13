import { z } from "zod";

/**
 * Per-template rules for the strict filler. The two bundled GJB templates
 * (SRS/SDD) differ only in data — anchors, cover fields, dynamic-chapter scope,
 * heading separator, and caption mode — so those differences live in a
 * `rules.json` shipped beside each template instead of forking the engine.
 */

/**
 * A prototype table that lives inside a dynamic region and is cloned (then
 * filled) for each table block a dynamic item declares. Matched by its header
 * rows (`locator_rows`), like a top-level table fill.
 */
const tablePrototypeSchema = z
  .object({
    locator_rows: z.array(z.array(z.string().min(1)).min(1)).min(1),
    columns: z.array(z.string().min(1)).min(1),
  })
  .strict();

const insertionParentRuleSchema = z
  .object({
    parent_title: z.string().min(1),
    summary_anchor: z.string().min(1),
    end_before_title: z.string().min(1),
    prototype_title_anchor: z.string().min(1),
    prototype_body_anchor: z.string().min(1),
    /** Caption paragraph prototype (e.g. `表X-X <表标题>`) cloned before table blocks. */
    prototype_caption_anchor: z.string().min(1).optional(),
    cleanup_anchors: z.array(z.string().min(1)).default([]),
    cleanup_to_end: z.boolean().default(false),
    /**
     * Heading prototypes keyed by nesting depth ("0" = the item's own heading,
     * "1" = its direct children, …). Depth 0 falls back to
     * `prototype_title_anchor`; deeper depths without an entry are rejected.
     */
    prototype_titles: z.record(z.string().regex(/^\d+$/u), z.string().min(1)).optional(),
    /** Named prototype tables cloned for a dynamic item's table blocks. */
    prototype_tables: z.record(z.string().min(1), tablePrototypeSchema).optional(),
  })
  .strict();

const coverFieldRuleSchema = z
  .object({
    key: z.string().min(1),
    anchor: z.string().min(1),
    /** Dotted path into config.json, e.g. `project.name`. */
    field: z.string().min(1),
    prefix: z.string().default(""),
    suffix: z.string().default(""),
    expected: z.number().int().positive().default(1),
  })
  .strict();

export const templateRulesSchema = z
  .object({
    identityLineAnchors: z.record(z.string(), z.string()),
    identityRules: z.array(coverFieldRuleSchema),
    patternOverrides: z.record(z.string(), z.string()).default({}),
    coverRules: z.array(coverFieldRuleSchema),
    /** Dynamic chapters declared under a section's `placeholders` (SRS) or at the top level (SDD). */
    insertionParentScope: z.enum(["placeholder", "top"]),
    insertionParentRules: z.record(z.string(), insertionParentRuleSchema),
    /** `chapter3`: only "3.x" prototype headings get a separator space (SRS); `always` (SDD). */
    headingSeparator: z.enum(["chapter3", "always"]),
    /** `strict`: an explicit "N-X" caption chapter must match (SRS); `fallback`: "X" uses the current chapter (SDD). */
    captionMode: z.enum(["strict", "fallback"]),
  })
  .strict();

export type TemplateRules = z.infer<typeof templateRulesSchema>;
export type InsertionParentRule = z.infer<typeof insertionParentRuleSchema>;
export type CoverFieldRule = z.infer<typeof coverFieldRuleSchema>;
export type TablePrototype = z.infer<typeof tablePrototypeSchema>;

export function parseTemplateRules(value: unknown): TemplateRules {
  return templateRulesSchema.parse(value);
}
