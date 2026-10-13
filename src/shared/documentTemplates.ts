import type { ProjectLocation } from "./contracts/common";
import type { DocumentTemplateLevel, ResolvedDocumentTemplate } from "./contracts/documentTemplate";
import { DOCUMENT_TEMPLATE_ID_PATTERN } from "./contracts/documentTemplate";

/** Per-project override folder (sibling of `.agentemployee/worktrees`). */
export const PROJECT_TEMPLATES_DIR_SEGMENTS = [".agentemployee", "templates"] as const;

export interface DocumentTemplateCandidate {
  level: DocumentTemplateLevel;
  /** Absolute path in the project location's own path style (POSIX for WSL/posix). */
  path: string;
}

/** Join `base` with `parts` using `sep`, trimming any trailing separators on `base`. */
function joinSegments(base: string, parts: readonly string[], sep: "/" | "\\"): string {
  return [base.replace(/[\\/]+$/, ""), ...parts].join(sep);
}

/**
 * Ordered search list for a template id: project override → global → built-in.
 * Pure and renderer-safe (no `node:path` / `node:fs`); the supervisor decides
 * which of these actually exists, mirroring `resolveWorktreePlacement`
 * (`src/shared/worktree.ts`).
 *
 * Returns an empty list for an unsafe id, so a crafted id can never point the
 * reader at a path outside the templates directories.
 */
export function documentTemplateCandidates(input: {
  templateId: string;
  location: ProjectLocation;
  /** `<~/.agentemployee>/templates` (see `resolveAgentEmployeePaths`). */
  globalTemplatesDir: string;
  /** Bundled templates root, absent in settings-only contexts. */
  bundledTemplatesDir?: string | undefined;
}): DocumentTemplateCandidate[] {
  const { templateId, location, globalTemplatesDir, bundledTemplatesDir } = input;
  if (!DOCUMENT_TEMPLATE_ID_PATTERN.test(templateId)) return [];

  const sep: "/" | "\\" = location.kind === "windows" ? "\\" : "/";
  const projectRoot = location.kind === "wsl" ? location.linuxPath : location.path;
  const fileName = `${templateId}.md`;

  const candidates: DocumentTemplateCandidate[] = [
    {
      level: "project",
      path: joinSegments(projectRoot, [...PROJECT_TEMPLATES_DIR_SEGMENTS, fileName], sep),
    },
    { level: "global", path: joinSegments(globalTemplatesDir, [fileName], sep) },
  ];
  if (bundledTemplatesDir) {
    candidates.push({
      level: "builtin",
      path: joinSegments(bundledTemplatesDir, [fileName], sep),
    });
  }
  return candidates;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * Read a `key: value` line from the template frontmatter, or `undefined`.
 * The template frontmatter is a flat key/value block parsed by hand — no YAML
 * dependency (mirrors `parseSkillMetadata` in the supervisor's SkillsService).
 */
function readFrontmatterValue(frontmatter: string, key: string): string | undefined {
  const pattern = new RegExp(`^${key}\\s*:\\s*(.*)$`, "mu");
  const match = frontmatter.match(pattern);
  if (!match) return undefined;
  const value = unquote(match[1] ?? "");
  return value.length > 0 ? value : undefined;
}

/**
 * Parse a template file. The body is everything after the closing `---` of the
 * frontmatter and is handed to the agent verbatim; only `title`, `resultFile`,
 * and `todoMarker` are lifted out for the app. Returns `null` when there is no
 * frontmatter block, so a malformed override falls through to the next level.
 */
export function parseDocumentTemplate(
  templateId: string,
  content: string,
): Pick<ResolvedDocumentTemplate, "title" | "resultFile" | "todoMarker" | "content"> | null {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---")) return null;

  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return null;
  const frontmatter = normalized.slice(3, end);
  const body = normalized.slice(normalized.indexOf("\n", end + 1) + 1).trim();

  return {
    title: readFrontmatterValue(frontmatter, "title") ?? templateId,
    resultFile: readFrontmatterValue(frontmatter, "resultFile") ?? `docs/${templateId}.md`,
    todoMarker: readFrontmatterValue(frontmatter, "todoMarker") ?? "TBD",
    content: body,
  };
}
