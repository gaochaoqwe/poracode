import { randomBytes } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, copyFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  KNOWLEDGE_FORMAT_VERSION,
  type KnowledgeBaseMeta,
  type KnowledgeTreeEntry,
} from "@/shared/contracts";
import type { AgentEmployeePaths } from "@/shared/agentemployeePaths";
import { writeFileAtomic } from "@/shared/atomicFile";

/** Files the store manages itself; hidden from the browsable tree. */
const INTERNAL_FILES = new Set(["kb.json"]);

const MANIFEST_FILE = "kb.json";
const MAX_READ_BYTES = 2 * 1024 * 1024;
const BASE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

interface KnowledgeManifest {
  version: number;
  name: string;
  createdAt: number;
}

const SCAFFOLD_FILES: Record<string, string> = {
  "purpose.md": `# Purpose

Describe why this knowledge base exists: its goals, the key questions it should
answer, and the scope it covers. The agent reads this before every ingest and
query, so keep it current.

## Goals
-

## Key questions
-
`,
  "schema.md": `# Schema

Rules the agent follows when maintaining this wiki. The agent reads this before
every ingest, query, and lint pass.

## Page types

| type | directory |
| --- | --- |
| source | wiki/sources |
| entity | wiki/entities |
| concept | wiki/concepts |

## Conventions
- One page per entity or concept, \`[[Wikilink]]\` cross-references, YAML frontmatter.
- \`raw/sources/\` is immutable — never edit imported sources.
- Rebuild \`index.md\` on every ingest; append one line to \`log.md\`.
`,
  "index.md": `# Index

Catalog of every wiki page. Rebuilt by the agent on each ingest.
`,
  "log.md": `# Log

Append-only record of ingests, queries, and lint passes. Each entry starts with
\`## [YYYY-MM-DD] <operation> | <title>\` so it stays greppable.
`,
};

const SCAFFOLD_DIRS = ["raw/sources", "wiki/sources", "wiki/entities", "wiki/concepts"] as const;

/** The container directory; each child directory is one knowledge base. */
export function knowledgeBasesDir(paths: AgentEmployeePaths): string {
  return paths.knowledgeDir;
}

/** Reject any base id that isn't a single safe path segment. */
export function assertBaseId(baseId: string): void {
  if (!BASE_ID_PATTERN.test(baseId) || baseId === "." || baseId === "..") {
    throw new Error(`Invalid knowledge base id: ${JSON.stringify(baseId)}`);
  }
}

/** Absolute root directory of one knowledge base. */
export function baseRoot(paths: AgentEmployeePaths, baseId: string): string {
  assertBaseId(baseId);
  return join(paths.knowledgeDir, baseId);
}

/** All knowledge bases, sorted by display name. */
export async function listKnowledgeBases(paths: AgentEmployeePaths): Promise<KnowledgeBaseMeta[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(paths.knowledgeDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const bases: KnowledgeBaseMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!BASE_ID_PATTERN.test(entry.name) || entry.name === "." || entry.name === "..") continue;
    const root = join(paths.knowledgeDir, entry.name);
    let name = entry.name;
    try {
      const parsed = JSON.parse(await readFile(join(root, MANIFEST_FILE), "utf8")) as {
        name?: unknown;
      };
      if (typeof parsed.name === "string" && parsed.name.trim()) name = parsed.name.trim();
    } catch {
      // No manifest — fall back to the directory name.
    }
    bases.push({ id: entry.name, name });
  }
  bases.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return bases;
}

/** Create a new knowledge base and return its metadata. */
export async function createKnowledgeBase(
  paths: AgentEmployeePaths,
  name: string,
): Promise<KnowledgeBaseMeta> {
  await mkdir(paths.knowledgeDir, { recursive: true });
  const trimmed = name.trim() || "Knowledge Base";
  for (let attempt = 0; attempt < 20; attempt++) {
    const id = `${slugify(trimmed)}-${randomBytes(2).toString("hex")}`;
    const root = join(paths.knowledgeDir, id);
    if (await exists(root)) continue;
    await scaffold(root);
    await writeManifest(root, trimmed);
    return { id, name: trimmed };
  }
  throw new Error("Could not allocate a knowledge base id.");
}

/** Rename a knowledge base (id stays stable). */
export async function renameKnowledgeBase(
  paths: AgentEmployeePaths,
  baseId: string,
  name: string,
): Promise<void> {
  const root = baseRoot(paths, baseId);
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Knowledge base name is required.");
  await writeManifest(root, trimmed);
}

/** Delete a knowledge base and all of its files. */
export async function deleteKnowledgeBase(paths: AgentEmployeePaths, baseId: string): Promise<void> {
  await rm(baseRoot(paths, baseId), { recursive: true, force: true });
}

/**
 * Scaffold one knowledge base (idempotent). Missing directories and files are
 * recreated; an existing page is never overwritten.
 */
export async function ensureKnowledgeProject(
  paths: AgentEmployeePaths,
  baseId: string,
): Promise<string> {
  const root = baseRoot(paths, baseId);
  await scaffold(root);
  await readManifest(root, baseId);
  return root;
}

async function scaffold(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  for (const dir of SCAFFOLD_DIRS) {
    await mkdir(join(root, dir), { recursive: true });
  }
  for (const [file, content] of Object.entries(SCAFFOLD_FILES)) {
    const filePath = join(root, file);
    if (!(await exists(filePath))) writeFileAtomic(filePath, content);
  }
}

async function readManifest(root: string, fallbackName: string): Promise<KnowledgeManifest> {
  const manifestPath = join(root, MANIFEST_FILE);
  let parsed: { version?: unknown; name?: unknown; createdAt?: unknown } | null = null;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    parsed = null;
  }
  const name =
    typeof parsed?.name === "string" && parsed.name.trim() ? parsed.name.trim() : fallbackName;
  const valid =
    parsed !== null && parsed.version === KNOWLEDGE_FORMAT_VERSION && parsed.name === name;
  if (valid) return parsed as unknown as KnowledgeManifest;
  const fresh: KnowledgeManifest = {
    version: KNOWLEDGE_FORMAT_VERSION,
    name,
    createdAt: typeof parsed?.createdAt === "number" ? parsed.createdAt : Date.now(),
  };
  writeFileAtomic(manifestPath, JSON.stringify(fresh, null, 2));
  return fresh;
}

async function writeManifest(root: string, name: string): Promise<void> {
  await mkdir(root, { recursive: true });
  const manifest: KnowledgeManifest = {
    version: KNOWLEDGE_FORMAT_VERSION,
    name,
    createdAt: Date.now(),
  };
  writeFileAtomic(join(root, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 32);
  return slug || "kb";
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Resolve a relative path against the root, rejecting escapes and absolutes. */
function resolveWithinRoot(root: string, relativePath: string): string {
  const target = resolve(root, relativePath);
  const rel = relative(root, target);
  if (rel === "") return target;
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Knowledge path escapes the knowledge base root.");
  }
  return target;
}

export async function listKnowledgeTree(
  root: string,
  directoryPath: string,
): Promise<{ directoryPath: string; entries: KnowledgeTreeEntry[] }> {
  const dir = resolveWithinRoot(root, directoryPath);
  const entries = await readdir(dir, { withFileTypes: true });
  const mapped: KnowledgeTreeEntry[] = [];
  for (const entry of entries) {
    if (directoryPath === "" && INTERNAL_FILES.has(entry.name)) continue;
    const rel = directoryPath === "" ? entry.name : `${directoryPath}/${entry.name}`;
    if (entry.isDirectory()) {
      mapped.push({
        path: rel,
        name: entry.name,
        type: "directory",
        hasChildren: await directoryHasChildren(join(dir, entry.name)),
      });
    } else if (entry.isFile()) {
      mapped.push({ path: rel, name: entry.name, type: "file" });
    }
  }
  mapped.sort(compareTreeEntries);
  return { directoryPath, entries: mapped };
}

async function directoryHasChildren(dir: string): Promise<boolean> {
  try {
    const children = await readdir(dir);
    return children.length > 0;
  } catch {
    return false;
  }
}

/** Directories first, then natural (case-insensitive, numeric-aware) name order. */
function compareTreeEntries(left: KnowledgeTreeEntry, right: KnowledgeTreeEntry): number {
  if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
}

export async function readKnowledgeFile(root: string, relativePath: string) {
  const filePath = resolveWithinRoot(root, relativePath);
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return { path: relativePath, status: "missing" as const, modifiedAtMs: 0 };
    if (info.size > MAX_READ_BYTES) {
      return { path: relativePath, status: "too_large" as const, modifiedAtMs: info.mtimeMs };
    }
    const content = await readFile(filePath, "utf8");
    return { path: relativePath, status: "ready" as const, modifiedAtMs: info.mtimeMs, content };
  } catch {
    return { path: relativePath, status: "missing" as const, modifiedAtMs: 0 };
  }
}

export async function writeKnowledgeFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = resolveWithinRoot(root, relativePath);
  writeFileAtomic(filePath, content);
}

/** Copy host files into `raw/sources/`, de-duplicating name collisions. */
export async function importKnowledgeSources(
  root: string,
  absolutePaths: readonly string[],
): Promise<string[]> {
  const targetDir = join(root, "raw", "sources");
  await mkdir(targetDir, { recursive: true });
  const existing = new Set(await readdir(targetDir).catch(() => [] as string[]));
  const importedPaths: string[] = [];
  for (const sourcePath of absolutePaths) {
    const originalName = sanitizeSourceFileName(basename(sourcePath));
    const name = uniqueName(originalName, existing);
    existing.add(name);
    await copyFile(sourcePath, join(targetDir, name));
    importedPaths.push(`raw/sources/${name}`);
  }
  return importedPaths;
}

function sanitizeSourceFileName(name: string): string {
  const cleaned = Array.from(name.replace(/[<>:"/\\|?*]/g, "-"))
    .map((character) => (character.charCodeAt(0) < 32 ? "-" : character))
    .join("")
    .replace(/[. ]+$/g, "")
    .slice(0, 160);
  return cleaned || "source";
}

function uniqueName(name: string, existing: ReadonlySet<string>): string {
  if (!existing.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let suffix = 2;
  let candidate = `${stem} (${suffix})${extension}`;
  while (existing.has(candidate)) {
    suffix += 1;
    candidate = `${stem} (${suffix})${extension}`;
  }
  return candidate;
}

/** Delete a file or directory (recursively) inside a knowledge base. */
export async function deleteKnowledgeEntry(root: string, relativePath: string): Promise<void> {
  if (!relativePath.trim()) throw new Error("Refusing to delete the knowledge base root.");
  const target = resolveWithinRoot(root, relativePath);
  await rm(target, { recursive: true, force: true });
}
