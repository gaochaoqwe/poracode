import { z } from "zod";
import { projectLocationSchema } from "./common";

/**
 * Fill a fixed OOXML template (GJB 438C SRS/SDD) and write the result into the
 * project. Runs in the supervisor so path handling is location-aware (native
 * Windows/POSIX vs WSL). The template and its rule file are read from the host
 * (bundled plugin resources); config/project/output are project-relative.
 */
export const fillDocumentTemplatePayloadSchema = z.object({
  projectLocation: projectLocationSchema,
  /** Host absolute path to the source `.docx` template. */
  templatePath: z.string().min(1),
  /** Host absolute path to the template's `rules.json`. */
  rulesPath: z.string().min(1),
  /** Project-relative path to the filled `config.json`. */
  configPath: z.string().min(1),
  /** Project-relative path to the filled `project.json`. */
  projectPath: z.string().min(1),
  /** Project-relative output path for the generated `.docx`. */
  outputPath: z.string().min(1),
});
export type FillDocumentTemplatePayload = z.infer<typeof fillDocumentTemplatePayloadSchema>;

export interface FillDocumentTemplateResult {
  outputPath: string;
}
