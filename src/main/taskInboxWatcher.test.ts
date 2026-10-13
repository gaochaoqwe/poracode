import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInMemoryTaskInboxStore,
  createJsonTaskInboxStore,
  readInboxItems,
  startTaskInboxWatcher,
  type TaskInboxItem,
} from "./taskInboxWatcher";

const tempDirs: string[] = [];

function makeTempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `agentemployee-task-inbox-${label}-`));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.useRealTimers();
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("readInboxItems", () => {
  it("extracts text from text-class files and leaves binary blobs metadata-only", () => {
    const dir = makeTempDir("scan");
    writeFileSync(join(dir, "todo.txt"), "Buy milk\nShip pet window");
    writeFileSync(join(dir, "notes.md"), "# Standup");
    writeFileSync(join(dir, "data.json"), '{"task": "x"}');
    writeFileSync(join(dir, "export.bin"), Buffer.from([1, 2, 3, 4]));

    const items = readInboxItems(dir, createInMemoryTaskInboxStore());
    const byName = new Map(items.map((item) => [item.fileName, item]));

    expect(byName.get("todo.txt")?.text).toBe("Buy milk\nShip pet window");
    expect(byName.get("notes.md")?.text).toBe("# Standup");
    expect(byName.get("data.json")?.text).toBe('{"task": "x"}');
    expect(byName.get("export.bin")?.text).toBeUndefined();
    expect(byName.get("export.bin")?.path).toBe(join(dir, "export.bin"));
    expect(items).toHaveLength(4);
  });

  it("skips hidden files and subdirectories", () => {
    const dir = makeTempDir("hidden");
    writeFileSync(join(dir, ".DS_Store"), "x");
    writeFileSync(join(dir, ".hidden.txt"), "secret");
    mkdirSync(join(dir, "a-folder"));
    writeFileSync(join(dir, "visible.txt"), "hi");

    const items = readInboxItems(dir, createInMemoryTaskInboxStore());
    expect(items.map((item) => item.fileName)).toEqual(["visible.txt"]);
  });

  it("is idempotent: a second scan returns nothing until content changes", () => {
    const dir = makeTempDir("dedup");
    writeFileSync(join(dir, "todo.txt"), "first");
    const store = createInMemoryTaskInboxStore();

    expect(readInboxItems(dir, store)).toHaveLength(1);
    expect(readInboxItems(dir, store)).toHaveLength(0);

    writeFileSync(join(dir, "todo.txt"), "second - updated");
    expect(readInboxItems(dir, store)).toHaveLength(1);
  });

  it("creates a missing directory instead of crashing", () => {
    const parent = makeTempDir("mkdir");
    const missing = join(parent, "inbox");
    expect(readInboxItems(missing, createInMemoryTaskInboxStore())).toEqual([]);
    writeFileSync(join(missing, "later.txt"), "hello");
    expect(readInboxItems(missing, createInMemoryTaskInboxStore())).toHaveLength(1);
  });
});

describe("json processed store", () => {
  it("remembers delivered fingerprints across store instances (restart-safe)", () => {
    const dir = makeTempDir("json");
    const storePath = join(dir, "processed.json");
    const store = createJsonTaskInboxStore(storePath);
    store.mark(join(dir, "a.txt"), 12, 1000);

    const reopened = createJsonTaskInboxStore(storePath);
    expect(reopened.has(join(dir, "a.txt"), 12, 1000)).toBe(true);
    expect(reopened.has(join(dir, "a.txt"), 13, 1000)).toBe(false);
  });

  it("treats a corrupt store as empty", () => {
    const dir = makeTempDir("corrupt");
    const storePath = join(dir, "processed.json");
    writeFileSync(storePath, "{not json");
    const store = createJsonTaskInboxStore(storePath);
    expect(store.has(join(dir, "a.txt"), 1, 1)).toBe(false);
  });
});

describe("startTaskInboxWatcher", () => {
  it("delivers pre-existing unprocessed items on start, then fires for new drops", async () => {
    const dir = makeTempDir("watch");
    writeFileSync(join(dir, "pending.txt"), "already waiting");
    const onItem = vi.fn<(item: TaskInboxItem) => void>();
    const store = createInMemoryTaskInboxStore();

    const watcher = startTaskInboxWatcher(dir, onItem, store);
    expect(onItem).toHaveBeenCalledTimes(1);
    expect(onItem.mock.calls[0]?.[0].text).toBe("already waiting");

    writeFileSync(join(dir, "dropped.txt"), "fresh drop");
    await vi.waitFor(
      () => {
        expect(onItem).toHaveBeenCalledTimes(2);
      },
      { timeout: 2000 },
    );
    expect(onItem.mock.calls[1]?.[0].fileName).toBe("dropped.txt");

    watcher.stop();
    writeFileSync(join(dir, "after-stop.txt"), "too late");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(onItem).toHaveBeenCalledTimes(2);
  });

  it("returns a no-op watcher when the directory cannot be created", () => {
    const onItem = vi.fn<(item: TaskInboxItem) => void>();
    const watcher = startTaskInboxWatcher(
      join("\0bad-dir", "x"),
      onItem,
      createInMemoryTaskInboxStore(),
    );
    expect(typeof watcher.stop).toBe("function");
    watcher.stop();
    expect(onItem).not.toHaveBeenCalled();
  });
});
