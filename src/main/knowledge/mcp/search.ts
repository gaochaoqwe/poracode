import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface KnowledgeSearchHit {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

/** Bounds keep a huge knowledge base from turning one search into a stall. */
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOKEN_BODY_HITS = 6;
const SNIPPET_CHARS = 200;

/**
 * Keyword search over the wiki markdown pages. No embeddings: title/frontmatter
 * matches outrank body hits, and a full-phrase match adds a bonus. Ranking is
 * deliberately simple and deterministic — good enough to point the agent at the
 * right page to `kb_read`.
 */
export async function searchKnowledge(
  root: string,
  query: string,
  limit: number,
): Promise<KnowledgeSearchHit[]> {
  const tokens = [...new Set(query.toLowerCase().split(/\s+/u).filter(Boolean))];
  if (tokens.length === 0) return [];
  const phrase = tokens.join(" ");

  const files = await collectMarkdownFiles(join(root, "wiki"));
  const hits: KnowledgeSearchHit[] = [];
  for (const file of files) {
    let content: string;
    try {
      const buffer = await readFile(file);
      if (buffer.byteLength > MAX_FILE_BYTES) continue;
      content = buffer.toString("utf8");
    } catch {
      continue;
    }
    const body = content.toLowerCase();
    const title = extractTitle(content, file);
    const titleLower = title.toLowerCase();

    let score = 0;
    if (titleLower.includes(phrase)) score += 8;
    else if (body.includes(phrase)) score += 3;
    for (const token of tokens) {
      if (titleLower.includes(token)) score += 3;
      score += Math.min(countOccurrences(body, token), MAX_TOKEN_BODY_HITS);
    }
    if (score === 0) continue;

    hits.push({ path: file, title, snippet: buildSnippet(content, tokens), score });
  }

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return hits.slice(0, limit);
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0 && out.length < MAX_FILES) {
    const current = stack.pop();
    if (!current) break;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) break;
      if (entry.isDirectory()) stack.push(join(current, entry.name));
      else if (entry.isFile() && entry.name.endsWith(".md")) out.push(join(current, entry.name));
    }
  }
  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function extractTitle(content: string, file: string): string {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/u)?.[1];
  const titleLine = frontmatter?.match(/^title:\s*(.+)$/mu)?.[1];
  if (titleLine) return titleLine.trim().replace(/^["']|["']$/gu, "");
  const heading = content.match(/^#\s+(.+)$/mu)?.[1];
  if (heading) return heading.trim();
  const base = file.replace(/\\/gu, "/").split("/").pop() ?? file;
  return base.replace(/\.md$/u, "");
}

function buildSnippet(content: string, tokens: readonly string[]): string {
  const lines = content.split("\n").filter((line) => line.trim() && line.trim() !== "---");
  const match = lines.find((line) => tokens.some((token) => line.toLowerCase().includes(token)));
  const text = (match ?? lines[0] ?? "").replace(/^#{1,6}\s*/u, "").trim();
  return text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS)}…` : text;
}
