import type {
  ReadAbsoluteFilePayload,
  ReadAbsoluteFileResult,
  ResolveDocumentTemplatePayload,
  ResolvedDocumentTemplate,
} from "@/shared/contracts";
import { documentTemplateCandidates, parseDocumentTemplate } from "@/shared/documentTemplates";

/** Reads a file at an absolute path through the project location's file system. */
export type AbsoluteFileReader = (
  payload: ReadAbsoluteFilePayload,
) => Promise<ReadAbsoluteFileResult>;

/**
 * Resolves a document template by walking `project → global → built-in` and
 * returning the first readable, valid file. A malformed or unreadable override
 * falls through to the next level rather than failing the scenario, so a broken
 * project template never blocks document generation.
 */
export class DocumentTemplateService {
  constructor(
    private readonly deps: {
      globalTemplatesDir: string;
      bundledTemplatesDir?: string | undefined;
      readAbsoluteFile: AbsoluteFileReader;
    },
  ) {}

  async resolve(
    payload: ResolveDocumentTemplatePayload,
  ): Promise<ResolvedDocumentTemplate | null> {
    const candidates = documentTemplateCandidates({
      templateId: payload.templateId,
      location: payload.projectLocation,
      globalTemplatesDir: this.deps.globalTemplatesDir,
      bundledTemplatesDir: this.deps.bundledTemplatesDir,
    });

    for (const candidate of candidates) {
      let read: ReadAbsoluteFileResult;
      try {
        read = await this.deps.readAbsoluteFile({
          projectLocation: payload.projectLocation,
          absolutePath: candidate.path,
        });
      } catch (error) {
        console.warn(`[doc-templates] failed to read ${candidate.path}:`, error);
        continue;
      }
      if (read.status !== "ready" || typeof read.content !== "string") continue;

      const parsed = parseDocumentTemplate(payload.templateId, read.content);
      if (!parsed) {
        console.warn(`[doc-templates] ${candidate.path} has no valid frontmatter; skipping`);
        continue;
      }
      return {
        templateId: payload.templateId,
        level: candidate.level,
        path: candidate.path,
        ...parsed,
      };
    }
    return null;
  }
}
