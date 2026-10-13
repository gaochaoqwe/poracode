import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  watch,
  writeFileSync,
  type Dirent,
  type FSWatcher,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";

/**
 * Task inbox watcher: the user drops files (OA exports, mxt captures, ad-hoc
 * notes) into a fixed directory and main turns each arrival into a task message
 * broadcast to every renderer window (pet + main).
 *
 * Delivery is idempotent: processed files are fingerprinted (absolute path +
 * size + mtimeMs) so a restart — or a watcher re-scan — never re-delivers the
 * same file. Re-dropping the same name with new content changes size/mtime and
 * is treated as a new item.
 */

export interface TaskInboxItem {
  fileName: string;
  /** Text-class file contents (utf8, truncated); omitted for binary blobs. */
  text?: string;
  /** Absolute path inside the inbox directory. */
  path: string;
}

/** Fingerprint store: same path with unchanged size+mtime is "already delivered". */
export interface TaskInboxProcessedStore {
  has(path: string, size: number, mtimeMs: number): boolean;
  mark(path: string, size: number, mtimeMs: number): void;
}

const TEXT_INBOX_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".json"]);
const MAX_INBOX_TEXT_BYTES = 256 * 1024;
const WATCHER_RESCAN_DEBOUNCE_MS = 200;

export function createInMemoryTaskInboxStore(): TaskInboxProcessedStore {
  const records = new Map<string, { size: number; mtimeMs: number }>();
  return {
    has(path, size, mtimeMs) {
      const record = records.get(path);
      return Boolean(record && record.size === size && record.mtimeMs === mtimeMs);
    },
    mark(path, size, mtimeMs) {
      records.set(path, { size, mtimeMs });
    },
  };
}

/**
 * JSON-backed store under userData, so "already delivered" survives restarts.
 * Loads lazily at construction and writes through on every mark (the file is
 * tiny; failed writes only cost a redelivery, never a crash).
 */
export function createJsonTaskInboxStore(filePath: string): TaskInboxProcessedStore {
  const records = new Map<string, { size: number; mtimeMs: number }>();
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<
      string,
      { size: number; mtimeMs: number }
    >;
    for (const [path, record] of Object.entries(raw)) {
      if (typeof record?.size === "number" && typeof record?.mtimeMs === "number") {
        records.set(path, { size: record.size, mtimeMs: record.mtimeMs });
      }
    }
  } catch {
    // Missing/corrupt store means "nothing processed yet" — re-deliver.
  }
  const persist = (): void => {
    try {
      const snapshot: Record<string, { size: number; mtimeMs: number }> = {};
      for (const [path, record] of records) snapshot[path] = record;
      mkdirSync(dirname(filePath), { recursive: true });
      // Synchronous write keeps the store consistent against a killed app;
      // the file is a few hundred bytes at most.
      writeFileSync(filePath, `${JSON.stringify(snapshot)}\n`, "utf8");
    } catch (error) {
      console.warn("[task-inbox] failed to persist processed-file store:", error);
    }
  };
  return {
    has(path, size, mtimeMs) {
      const record = records.get(path);
      return Boolean(record && record.size === size && record.mtimeMs === mtimeMs);
    },
    mark(path, size, mtimeMs) {
      records.set(path, { size, mtimeMs });
      persist();
    },
  };
}

function readTextIfTextual(path: string): string | undefined {
  if (!TEXT_INBOX_EXTENSIONS.has(extname(path).toLowerCase())) return undefined;
  try {
    const buffer = readFileSync(path);
    const body = buffer.subarray(0, MAX_INBOX_TEXT_BYTES);
    const text = body.toString("utf8");
    return buffer.length > MAX_INBOX_TEXT_BYTES ? `${text}\n…[truncated]` : text;
  } catch {
    return undefined;
  }
}

/**
 * Scan the inbox directory once and return items not yet delivered. Marks each
 * returned item as processed, so a second call returns [] until files change.
 * Missing directory is created (recursive); creation failure yields no items.
 */
export function readInboxItems(dirPath: string, store: TaskInboxProcessedStore): TaskInboxItem[] {
  try {
    mkdirSync(dirPath, { recursive: true });
  } catch (error) {
    console.error("[task-inbox] cannot create inbox directory:", error);
    return [];
  }
  let entries: Dirent[];
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch (error) {
    console.error("[task-inbox] cannot read inbox directory:", error);
    return [];
  }
  const items: TaskInboxItem[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() || entry.name.startsWith(".")) continue;
    const path = join(dirPath, entry.name);
    let size = 0;
    let mtimeMs = 0;
    try {
      const stat = statSync(path);
      size = stat.size;
      mtimeMs = stat.mtimeMs;
    } catch {
      continue; // File vanished between readdir and stat.
    }
    if (store.has(path, size, mtimeMs)) continue;
    const item: TaskInboxItem = { fileName: basename(path), path };
    const text = readTextIfTextual(path);
    if (text !== undefined) item.text = text;
    store.mark(path, size, mtimeMs);
    items.push(item);
  }
  return items;
}

export interface TaskInboxWatcher {
  stop(): void;
}

/**
 * Start watching `dirPath` for new/changed files and forward every unprocessed
 * item to `onItem`. fs.watch on Windows uses ReadDirectoryChangesW natively, so
 * no polling fallback is needed for a single-level directory. A trailing
 * debounce collapses the rename+change burst a copy operation emits.
 */
export function startTaskInboxWatcher(
  dirPath: string,
  onItem: (item: TaskInboxItem) => void,
  store: TaskInboxProcessedStore,
): TaskInboxWatcher {
  let stopped = false;
  let watcher: FSWatcher | null = null;

  const scanOnce = (): void => {
    if (stopped) return;
    for (const item of readInboxItems(dirPath, store)) {
      try {
        onItem(item);
      } catch (error) {
        console.error("[task-inbox] item handler failed:", error);
      }
    }
  };

  try {
    mkdirSync(dirPath, { recursive: true });
  } catch (error) {
    console.error("[task-inbox] cannot create inbox directory:", error);
    return { stop() {} };
  }

  scanOnce();

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    watcher = watch(dirPath, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        scanOnce();
      }, WATCHER_RESCAN_DEBOUNCE_MS);
    });
    watcher.on("error", (error) => {
      console.error("[task-inbox] watch failed:", error);
    });
  } catch (error) {
    console.error("[task-inbox] cannot watch inbox directory:", error);
  }

  return {
    stop() {
      stopped = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher?.close();
      watcher = null;
    },
  };
}
