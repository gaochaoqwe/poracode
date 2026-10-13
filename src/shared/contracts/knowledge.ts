import { z } from "zod";
import type { ProjectLocation } from "./common";

/**
 * On-disk knowledge-base format version. Bump when the layout under the
 * knowledge root (`kb.json` fields, scaffolded directories, page conventions)
 * changes shape. Version 2 introduced multiple knowledge bases under the root
 * (one subdirectory per base). A mismatch re-scaffolds missing structure and
 * rewrites the manifest; markdown pages are never deleted.
 * See `.agents/docs/versioning.md`.
 */
export const KNOWLEDGE_FORMAT_VERSION = 2;

/**
 * The knowledge container lives in the app data directory
 * (`~/.agentemployee/knowledge/`). Each direct child directory is one knowledge
 * base; multiple bases are independent instances with the same internal layout.
 */
export const knowledgeRootDirName = "knowledge";

/** One knowledge base (a named, independent instance). */
export interface KnowledgeBaseMeta {
  /** Stable directory id (does not change on rename). */
  id: string;
  /** User-facing name. */
  name: string;
}

export interface KnowledgeTreeEntry {
  /** Path relative to the knowledge base root; `/`-separated. */
  path: string;
  name: string;
  type: "file" | "directory";
  hasChildren?: boolean;
}

/** Every per-base file/树 operation carries the base it acts on. */
const knowledgeBaseRefShape = { baseId: z.string().min(1) };

export const knowledgeListTreePayloadSchema = z.object({
  ...knowledgeBaseRefShape,
  /** Directory to list, relative to the base root; empty lists the root. */
  directoryPath: z.string().default(""),
});
export type KnowledgeListTreePayload = z.infer<typeof knowledgeListTreePayloadSchema>;

export interface KnowledgeListTreeResult {
  directoryPath: string;
  entries: KnowledgeTreeEntry[];
}

export const knowledgeReadFilePayloadSchema = z.object({
  ...knowledgeBaseRefShape,
  /** File path relative to the base root. */
  path: z.string().min(1),
});
export type KnowledgeReadFilePayload = z.infer<typeof knowledgeReadFilePayloadSchema>;

export type KnowledgeFileReadStatus = "ready" | "missing" | "too_large";

export interface KnowledgeReadFileResult {
  path: string;
  status: KnowledgeFileReadStatus;
  modifiedAtMs: number;
  content?: string;
}

export const knowledgeWriteFilePayloadSchema = z.object({
  ...knowledgeBaseRefShape,
  /** File path relative to the base root. */
  path: z.string().min(1),
  content: z.string(),
});
export type KnowledgeWriteFilePayload = z.infer<typeof knowledgeWriteFilePayloadSchema>;

export const knowledgeImportSourcesPayloadSchema = z.object({
  ...knowledgeBaseRefShape,
  /** Absolute host paths of files to copy into `raw/sources/`. */
  absolutePaths: z.array(z.string().min(1)).min(1),
});
export type KnowledgeImportSourcesPayload = z.infer<typeof knowledgeImportSourcesPayloadSchema>;

export interface KnowledgeImportSourcesResult {
  /** Paths (relative to the base root) of the copied source files. */
  importedPaths: string[];
}

export const knowledgeDeleteEntryPayloadSchema = z.object({
  ...knowledgeBaseRefShape,
  /** File or directory path relative to the base root. */
  path: z.string().min(1),
});
export type KnowledgeDeleteEntryPayload = z.infer<typeof knowledgeDeleteEntryPayloadSchema>;

/** Payload for the procedures that take no arguments. */
export const knowledgeListBasesPayloadSchema = z.object({});
export type KnowledgeListBasesPayload = z.infer<typeof knowledgeListBasesPayloadSchema>;

export interface KnowledgeListBasesResult {
  bases: KnowledgeBaseMeta[];
}

export const knowledgeCreateBasePayloadSchema = z.object({
  name: z.string().min(1),
});
export type KnowledgeCreateBasePayload = z.infer<typeof knowledgeCreateBasePayloadSchema>;

export const knowledgeRenameBasePayloadSchema = z.object({
  baseId: z.string().min(1),
  name: z.string().min(1),
});
export type KnowledgeRenameBasePayload = z.infer<typeof knowledgeRenameBasePayloadSchema>;

export const knowledgeDeleteBasePayloadSchema = z.object({
  baseId: z.string().min(1),
});
export type KnowledgeDeleteBasePayload = z.infer<typeof knowledgeDeleteBasePayloadSchema>;

export const knowledgeRootLocationPayloadSchema = z.object({
  ...knowledgeBaseRefShape,
});
export type KnowledgeRootLocationPayload = z.infer<typeof knowledgeRootLocationPayloadSchema>;

/**
 * The knowledge base root exposed as a {@link ProjectLocation} so the built-in
 * file panel and file editor can browse/preview it through the normal project
 * file IPC. The renderer supplies its own localized label.
 */
export interface KnowledgeRootLocationResult {
  location: ProjectLocation;
}
