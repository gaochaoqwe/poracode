import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";
import type { PromptSegment, ProjectLocation } from "@/shared/contracts";
import { isDocxPath, isPdfPath } from "@/shared/promptContent";
import { docxToMarkdown } from "../documentFill/docxToMarkdown";
import type { WslBridgeClient, WslLocation } from "../wsl/bridge/client";

const wslAttachmentDirCache = new Map<string, { home: string; linuxDir: string }>();
let wslAttachmentBridgeClient: WslBridgeClient | undefined;

export function setWslAttachmentBridgeClient(client: WslBridgeClient | undefined): void {
  wslAttachmentBridgeClient = client;
}

function attachmentLocation(
  distro: string,
  linuxDir: string,
): Extract<ProjectLocation, { kind: "wsl" }> {
  return {
    kind: "wsl",
    distro,
    linuxPath: linuxDir,
    uncPath: `\\\\wsl.localhost\\${distro}\\`,
  };
}

async function resolveWslAttachmentDirs(
  client: WslBridgeClient,
  distro: string,
): Promise<{ home: string; linuxDir: string }> {
  const cached = wslAttachmentDirCache.get(distro);
  if (cached) {
    return cached;
  }

  const rootLocation: WslLocation = {
    kind: "wsl",
    distro,
    linuxPath: "/",
    uncPath: `\\\\wsl.localhost\\${distro}\\`,
  };
  const { home } = await client.home(rootLocation);
  const linuxDir = `${home}/.agentemployee/attachments`;
  const location = attachmentLocation(distro, linuxDir);
  await client.mkdir(location, linuxDir, { recursive: true });

  const entry = { home, linuxDir };
  wslAttachmentDirCache.set(distro, entry);
  return entry;
}

function isImageAttachmentSegment(segment: PromptSegment): boolean {
  if (segment.kind !== "attachment") {
    return false;
  }
  return (
    segment.mimeType?.startsWith("image/") === true ||
    /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(segment.path)
  );
}

/** A segment that carries a filesystem path eligible for copy/rewrite. */
function isRewritableFileSegment(
  segment: PromptSegment,
): segment is Extract<PromptSegment, { kind: "attachment" | "file" }> {
  return (segment.kind === "attachment" || segment.kind === "file") && Boolean(segment.path);
}

const AGENTEMPLOYEE_DIR = ".agentemployee";
const AGENTEMPLOYEE_ATTACHMENTS_SUBDIR = "attachments";
/** Narrow ignore so converted docs never show in `git status` without hiding other `.agentemployee` files. */
const AGENTEMPLOYEE_IGNORE_CONTENT = "/attachments/\n";

function isDocxAttachmentSegment(
  segment: PromptSegment,
): segment is Extract<PromptSegment, { kind: "attachment" }> {
  return segment.kind === "attachment" && isDocxPath(segment.path);
}

/**
 * Convert `.docx` attachment segments into Markdown the agent can read with
 * ordinary file tools (it cannot unzip OOXML itself), rewriting each segment to
 * the produced `.md`.
 *
 * The Markdown lands in `<projectDir>/.agentemployee/attachments` for a native
 * project — inside the working directory and git-ignored — or, for WSL, in a
 * host temp file that the caller's existing WSL copy step stages into the
 * distro's attachment dir. Returns the input array unchanged when nothing needs
 * converting; a failed conversion keeps the original `.docx` segment.
 */
export async function materializeDocxAttachments(
  segments: PromptSegment[],
  location: ProjectLocation,
): Promise<PromptSegment[]> {
  if (!segments.some(isDocxAttachmentSegment)) return segments;

  const rewritten: PromptSegment[] = [];
  for (const segment of segments) {
    if (!isDocxAttachmentSegment(segment)) {
      rewritten.push(segment);
      continue;
    }
    try {
      const bytes = await readFile(segment.path);
      const markdown = docxToMarkdown(bytes);
      const fileName = `${docxMarkdownBaseName(segment.path, bytes)}.md`;
      const mdPath =
        location.kind === "wsl"
          ? await writeStagedDocxMarkdown(fileName, markdown)
          : await writeProjectDocxMarkdown(location.path, fileName, markdown);
      rewritten.push({ kind: "attachment", path: mdPath, mimeType: "text/markdown" });
    } catch (error) {
      console.warn(`[docx-attach] failed to convert ${segment.path}:`, error);
      rewritten.push(segment);
    }
  }
  return rewritten;
}

/** `<name>-<sha1(bytes)[0:8]>`, so re-sending the same bytes reuses one output file. */
function docxMarkdownBaseName(path: string, bytes: Uint8Array): string {
  const base = basename(path).replace(/\.docx$/i, "");
  const hash = createHash("sha1").update(bytes).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

async function writeProjectDocxMarkdown(
  projectDir: string,
  fileName: string,
  markdown: string,
): Promise<string> {
  const attachmentsDir = join(projectDir, AGENTEMPLOYEE_DIR, AGENTEMPLOYEE_ATTACHMENTS_SUBDIR);
  await mkdir(attachmentsDir, { recursive: true });
  const gitignorePath = join(projectDir, AGENTEMPLOYEE_DIR, ".gitignore");
  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, AGENTEMPLOYEE_IGNORE_CONTENT);
  }
  const dest = join(attachmentsDir, fileName);
  await writeFile(dest, markdown, "utf8");
  return dest;
}

/** Host temp file whose Windows path the WSL copy step will stage into the distro. */
async function writeStagedDocxMarkdown(fileName: string, markdown: string): Promise<string> {
  const dir = join(tmpdir(), "agentemployee-docx");
  await mkdir(dir, { recursive: true });
  const dest = join(dir, fileName);
  await writeFile(dest, markdown, "utf8");
  return dest;
}

export async function rewriteSegmentsForWsl(
  segments: PromptSegment[],
  location: ProjectLocation,
  options?: { preserveImageAttachments?: boolean; preservePdfAttachments?: boolean },
): Promise<PromptSegment[]> {
  // `.docx` attachments become Markdown the agent can read, for any location.
  const prepared = await materializeDocxAttachments(segments, location);
  if (location.kind !== "wsl") {
    return prepared;
  }

  const client = wslAttachmentBridgeClient;
  if (!client) return prepared;

  let dirs: { home: string; linuxDir: string } | undefined;
  const rewritten: PromptSegment[] = [];
  for (const segment of prepared) {
    if (!isRewritableFileSegment(segment)) {
      rewritten.push(segment);
      continue;
    }
    if (options?.preserveImageAttachments && isImageAttachmentSegment(segment)) {
      rewritten.push(segment);
      continue;
    }
    if (
      options?.preservePdfAttachments &&
      segment.kind === "attachment" &&
      isPdfPath(segment.path, segment.mimeType)
    ) {
      rewritten.push(segment);
      continue;
    }
    if (!/^[A-Za-z]:[\\/]/.test(segment.path)) {
      rewritten.push(segment);
      continue;
    }

    dirs ??= await resolveWslAttachmentDirs(client, location.distro);
    const fileName = basename(segment.path);
    const linuxPath = `${dirs.linuxDir}/${fileName}`;
    const bridgeLocation = attachmentLocation(location.distro, dirs.linuxDir);
    try {
      const content = await readFile(segment.path);
      await client.rm(bridgeLocation, linuxPath, { force: true });
      await client.writeNewFile(bridgeLocation, linuxPath, content);
    } catch (error) {
      console.warn(`[wsl-attach] failed to copy ${segment.path} -> ${linuxPath}:`, error);
      rewritten.push(segment);
      continue;
    }
    rewritten.push({ ...segment, path: linuxPath });
  }
  return rewritten;
}

const WORKSPACE_ATTACHMENT_DIR = ".agentemployee";
const WORKSPACE_ATTACHMENT_SUBDIR = "attachments";

function isInsideDir(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Copies any attachment/file segment that lives outside `projectDir` into
 * `<projectDir>/.agentemployee/attachments` and rewrites its path there. Some agents
 * (e.g. Command Code) sandbox file reads to their working directory, so a
 * picker screenshot in `~/.agentemployee/attachments` is otherwise unreadable. The
 * copied files self-ignore via a `.agentemployee/.gitignore` so they never show up
 * in `git status`. Paths already inside the workspace are left untouched.
 */
export async function rewriteSegmentsForWorkspace(
  segments: PromptSegment[],
  projectDir: string,
): Promise<PromptSegment[]> {
  const attachmentsDir = join(projectDir, WORKSPACE_ATTACHMENT_DIR, WORKSPACE_ATTACHMENT_SUBDIR);
  let prepared = false;
  const rewritten: PromptSegment[] = [];
  for (const segment of segments) {
    if (!isRewritableFileSegment(segment)) {
      rewritten.push(segment);
      continue;
    }
    if (!isAbsolute(segment.path) || isInsideDir(segment.path, projectDir)) {
      rewritten.push(segment);
      continue;
    }
    try {
      if (!prepared) {
        await mkdir(attachmentsDir, { recursive: true });
        const gitignorePath = join(projectDir, WORKSPACE_ATTACHMENT_DIR, ".gitignore");
        if (!existsSync(gitignorePath)) {
          await writeFile(gitignorePath, "*\n");
        }
        prepared = true;
      }
      const dest = join(attachmentsDir, basename(segment.path));
      await copyFile(segment.path, dest);
      rewritten.push({ ...segment, path: dest });
    } catch (error) {
      console.warn(
        `[workspace-attach] failed to copy ${segment.path} -> ${attachmentsDir}:`,
        error,
      );
      rewritten.push(segment);
    }
  }
  return rewritten;
}
