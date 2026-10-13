import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import type { ProjectLocation } from "@/shared/contracts";
import type { ReviewIssueStates, ReviewIssueStatus } from "@/shared/ipc";
import { resolveProjectFsPath } from "@/main/attachments/localFiles";

/**
 * Project-local review state database (`<project>/reviews/review_state.db`).
 * Owned by the main process (the renderer cannot open an N-API native module),
 * opened on demand per project and cached by resolved path.
 *
 * Schema is versioned at the meta table: bump {@link REVIEW_SCHEMA_VERSION} on a
 * breaking change and migrate here.
 */
export const REVIEW_SCHEMA_VERSION = 1;

const REVIEW_DB_FILENAME = "review_state.db";
const REVIEW_DIR = "reviews";

interface ReviewMetaRow {
  key: string;
  value: string;
}

interface IssueStateRow {
  issue_id: string;
  status: string;
}

const openDbs = new Map<string, DatabaseType>();

function resolveReviewDbPath(projectLocation: ProjectLocation): string {
  const projectRoot = resolveProjectFsPath({ projectLocation });
  return join(projectRoot, REVIEW_DIR, REVIEW_DB_FILENAME);
}

/** Get (and cache) the review-state database for a project, creating it if absent. */
function getReviewDb(projectLocation: ProjectLocation): DatabaseType {
  const dbPath = resolveReviewDbPath(projectLocation);
  const cached = openDbs.get(dbPath);
  if (cached) return cached;

  mkdirSync(join(dbPath, ".."), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS issue_state (
      task_id   TEXT NOT NULL,
      issue_id  TEXT NOT NULL,
      status    TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (task_id, issue_id)
    );
  `);
  const meta = db.prepare("SELECT key, value FROM review_meta WHERE key = 'schema_version'");
  const row = meta.get() as ReviewMetaRow | undefined;
  if (!row) {
    db.prepare("INSERT INTO review_meta (key, value) VALUES ('schema_version', ?)").run(
      String(REVIEW_SCHEMA_VERSION),
    );
  }
  openDbs.set(dbPath, db);
  return db;
}

export function reviewGetIssueStates(
  projectLocation: ProjectLocation,
  taskId: string,
): ReviewIssueStates {
  const db = getReviewDb(projectLocation);
  const rows = db
    .prepare("SELECT issue_id, status FROM issue_state WHERE task_id = ?")
    .all(taskId) as IssueStateRow[];
  const states: ReviewIssueStates = {};
  for (const row of rows) {
    states[row.issue_id] = row.status as ReviewIssueStatus;
  }
  return states;
}

export function reviewSetIssueState(
  projectLocation: ProjectLocation,
  taskId: string,
  issueId: string,
  status: ReviewIssueStatus,
): void {
  const db = getReviewDb(projectLocation);
  db.prepare(
    `INSERT INTO issue_state (task_id, issue_id, status, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(task_id, issue_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
  ).run(taskId, issueId, status, Date.now());
}

export function reviewClearIssueStates(projectLocation: ProjectLocation, taskId: string): void {
  const db = getReviewDb(projectLocation);
  db.prepare("DELETE FROM issue_state WHERE task_id = ?").run(taskId);
}

/**
 * Clear a project's persisted code-review records: closes the project-local
 * review_state.db and removes the whole `<project>/reviews/` directory
 * (report JSONs + the sqlite). The project itself is untouched — a later
 * review run simply re-creates the directory. Reversible-by-rerun.
 */
export function reviewClearProject(projectLocation: ProjectLocation): void {
  const dbPath = resolveReviewDbPath(projectLocation);
  const cached = openDbs.get(dbPath);
  if (cached) {
    try {
      cached.close();
    } catch {
      // Already closed / busy — ignore, the delete below still proceeds.
    }
    openDbs.delete(dbPath);
  }
  const projectRoot = resolveProjectFsPath({ projectLocation });
  const reviewsDir = join(projectRoot, REVIEW_DIR);
  if (existsSync(reviewsDir)) {
    rmSync(reviewsDir, { recursive: true, force: true });
  }
}

/**
 * Name of the project-level custom MCP server that exposes the C/C++ code index
 * to a review agent. It is written into the project's `.mcp.json` (auto-discovered
 * by `ExternalMcpDiscoveryService`) so the code-review scenario works out of the
 * box without the user manually adding a server.
 */
export const CODE_REVIEW_MCP_SERVER_NAME = "code-review-index";

function resolveCodeReviewServerPath(): string {
  // Poracode's bundled `resources/plugins` directory (dev vs packaged).
  const resourcesDir = app.isPackaged
    ? process.resourcesPath
    : // dist\main → project root (2 levels up) → resources
      join(__dirname, "..", "..", "resources");
  return join(resourcesDir, "plugins", "code-review", "mcp", "server.mjs");
}

/**
 * Ensure the project carries a `.mcp.json` declaring the code-review-index
 * stdio server. Idempotent: does not touch the file when the server is already
 * declared, and refuses to overwrite an existing unreadable / non-standard file
 * (so the user's own MCP config is never clobbered).
 */
export function ensureCodeReviewMcp(projectLocation: ProjectLocation): void {
  const projectRoot = resolveProjectFsPath({ projectLocation });
  const mcpPath = join(projectRoot, ".mcp.json");

  let mcpServers: Record<string, unknown> = {};
  let preserveRest = false;
  if (existsSync(mcpPath)) {
    try {
      const parsed = JSON.parse(readFileSync(mcpPath, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && (parsed as { mcpServers?: unknown }).mcpServers) {
        const group = (parsed as { mcpServers: unknown }).mcpServers;
        if (group && typeof group === "object" && !Array.isArray(group)) {
          mcpServers = group as Record<string, unknown>;
          preserveRest = true;
        }
      }
    } catch {
      // Unreadable / malformed existing file: leave it untouched.
      return;
    }
  }

  const correctPath = resolveCodeReviewServerPath();
  const declared = mcpServers[CODE_REVIEW_MCP_SERVER_NAME];
  if (declared && typeof declared === "object") {
    const ex = declared as { command?: unknown; args?: unknown; env?: unknown };
    const arg0 = Array.isArray(ex.args) ? ex.args[0] : undefined;
    // 已声明且指向真实存在的 server 文件 → 视为用户自定义/已正确，不动。
    if (typeof arg0 === "string" && existsSync(arg0)) return;
    // 指向不存在的文件（旧的错误路径）→ 用正确路径修正该条目，保留 command/env。
    mcpServers[CODE_REVIEW_MCP_SERVER_NAME] = {
      command: typeof ex.command === "string" ? ex.command : "node",
      args: [correctPath],
      env: ex.env && typeof ex.env === "object" ? ex.env : {},
    };
  } else {
    mcpServers[CODE_REVIEW_MCP_SERVER_NAME] = {
      command: "node",
      args: [correctPath],
      env: {},
    };
  }
  writeFileSync(
    mcpPath,
    JSON.stringify(preserveRest ? { mcpServers } : { mcpServers }, null, 2),
    "utf8",
  );
}
