import { z } from "zod";
import { projectLocationSchema } from "./common";

/**
 * Where a resolved document template was found, from most to least specific.
 * The resolver walks `project → global → builtin` and keeps the first readable,
 * valid file, so a project can override a global template without touching it.
 */
export const DOCUMENT_TEMPLATE_LEVELS = ["project", "global", "builtin"] as const;
export const documentTemplateLevelSchema = z.enum(DOCUMENT_TEMPLATE_LEVELS);
export type DocumentTemplateLevel = z.infer<typeof documentTemplateLevelSchema>;

/**
 * Template ids are also used as file names (`<id>.md`), so they are restricted
 * to a safe slug — this prevents a crafted id from escaping the templates
 * directory.
 */
export const DOCUMENT_TEMPLATE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const documentTemplateIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(DOCUMENT_TEMPLATE_ID_PATTERN);

export const resolveDocumentTemplatePayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  templateId: documentTemplateIdSchema,
});
export type ResolveDocumentTemplatePayload = z.infer<typeof resolveDocumentTemplatePayloadSchema>;

/**
 * A template the renderer and the agent can act on: the frontmatter fields the
 * app needs (`resultFile`, `todoMarker`) plus the raw body the agent follows.
 * Sections/field lists live in `content` — the app does not need to parse them.
 */
export interface ResolvedDocumentTemplate {
  templateId: string;
  level: DocumentTemplateLevel;
  /** Absolute path the template was read from. */
  path: string;
  /** Raw file body, inlined into the scenario prompt for the agent. */
  content: string;
  title: string;
  /** Project-relative output path, e.g. `docs/design.md`. */
  resultFile: string;
  /** Marker the agent writes in place of unknown content, e.g. `待补充`. */
  todoMarker: string;
}
