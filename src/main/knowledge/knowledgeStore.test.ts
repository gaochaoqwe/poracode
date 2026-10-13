import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KNOWLEDGE_FORMAT_VERSION } from "@/shared/contracts";
import type { AgentEmployeePaths } from "@/shared/agentemployeePaths";
import {
  assertBaseId,
  baseRoot,
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeEntry,
  ensureKnowledgeProject,
  importKnowledgeSources,
  listKnowledgeBases,
  listKnowledgeTree,
  readKnowledgeFile,
  renameKnowledgeBase,
  writeKnowledgeFile,
} from "./knowledgeStore";

let baseDir: string;
let paths: AgentEmployeePaths;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "agentemployee-kb-"));
  paths = { knowledgeDir: join(baseDir, "knowledge") } as AgentEmployeePaths;
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("base ids", () => {
  it("rejects unsafe ids", () => {
    expect(() => assertBaseId("../x")).toThrow(/Invalid knowledge base id/);
    expect(() => assertBaseId("..")).toThrow(/Invalid knowledge base id/);
    expect(() => assertBaseId("a/b")).toThrow(/Invalid knowledge base id/);
    expect(() => baseRoot(paths, "..")).toThrow(/Invalid knowledge base id/);
  });
});

describe("knowledge base lifecycle", () => {
  it("creates, lists, renames, and deletes bases", async () => {
    const radar = await createKnowledgeBase(paths, "Radar");
    const rocket = await createKnowledgeBase(paths, "Rocket");
    expect(radar.id).not.toBe(rocket.id);

    let bases = await listKnowledgeBases(paths);
    expect(bases.map((b) => b.name)).toEqual(["Radar", "Rocket"]);
    expect(existsSync(join(paths.knowledgeDir, radar.id, "wiki", "entities"))).toBe(true);

    await renameKnowledgeBase(paths, radar.id, "Radar Systems");
    bases = await listKnowledgeBases(paths);
    expect(bases.find((b) => b.id === radar.id)?.name).toBe("Radar Systems");

    await deleteKnowledgeBase(paths, rocket.id);
    bases = await listKnowledgeBases(paths);
    expect(bases.map((b) => b.id)).toEqual([radar.id]);
  });
});

describe("ensureKnowledgeProject", () => {
  it("scaffolds a base and keeps its name on a version bump", async () => {
    const base = await createKnowledgeBase(paths, "Radar");
    const root = await ensureKnowledgeProject(paths, base.id);
    for (const file of ["purpose.md", "schema.md", "index.md", "log.md", "kb.json"]) {
      expect(existsSync(join(root, file))).toBe(true);
    }

    writeFileSync(
      join(root, "kb.json"),
      JSON.stringify({ version: 999, name: "Radar", createdAt: 1 }),
    );
    writeFileSync(join(root, "wiki", "entities", "keep.md"), "# Keep");
    await ensureKnowledgeProject(paths, base.id);

    const manifest = JSON.parse(readFileSync(join(root, "kb.json"), "utf8"));
    expect(manifest.version).toBe(KNOWLEDGE_FORMAT_VERSION);
    expect(manifest.name).toBe("Radar");
    expect(existsSync(join(root, "wiki", "entities", "keep.md"))).toBe(true);
  });
});

describe("listKnowledgeTree", () => {
  it("lists directories before files and hides the manifest", async () => {
    const base = await createKnowledgeBase(paths, "Radar");
    const root = await ensureKnowledgeProject(paths, base.id);
    const tree = await listKnowledgeTree(root, "");
    const names = tree.entries.map((entry) => entry.name);
    expect(names).not.toContain("kb.json");
    expect(names).toContain("wiki");
    const lastDirIndex = tree.entries.map((e) => e.type).lastIndexOf("directory");
    const firstFileIndex = tree.entries.findIndex((entry) => entry.type === "file");
    expect(lastDirIndex).toBeLessThan(firstFileIndex);
  });
});

describe("read/writeKnowledgeFile", () => {
  it("round-trips a file, reports missing, and rejects traversal", async () => {
    const base = await createKnowledgeBase(paths, "Radar");
    const root = await ensureKnowledgeProject(paths, base.id);
    await writeKnowledgeFile(root, "purpose.md", "# Custom");
    expect((await readKnowledgeFile(root, "purpose.md")).content).toBe("# Custom");
    expect((await readKnowledgeFile(root, "wiki/nope.md")).status).toBe("missing");
    await expect(writeKnowledgeFile(root, "../escape.md", "x")).rejects.toThrow(
      /escapes the knowledge base root/,
    );
  });
});

describe("importKnowledgeSources", () => {
  it("copies sources and de-duplicates name collisions", async () => {
    const base = await createKnowledgeBase(paths, "Radar");
    const root = await ensureKnowledgeProject(paths, base.id);
    const dirA = join(baseDir, "a");
    const dirB = join(baseDir, "b");
    mkdirSync(dirA);
    mkdirSync(dirB);
    writeFileSync(join(dirA, "notes.md"), "A");
    writeFileSync(join(dirB, "notes.md"), "B");

    const imported = await importKnowledgeSources(root, [
      join(dirA, "notes.md"),
      join(dirB, "notes.md"),
    ]);
    expect(imported).toEqual(["raw/sources/notes.md", "raw/sources/notes (2).md"]);
  });
});

describe("deleteKnowledgeEntry", () => {
  it("refuses to escape the root", async () => {
    const base = await createKnowledgeBase(paths, "Radar");
    const root = await ensureKnowledgeProject(paths, base.id);
    await expect(deleteKnowledgeEntry(root, "../escape")).rejects.toThrow(
      /escapes the knowledge base root/,
    );
  });
});
