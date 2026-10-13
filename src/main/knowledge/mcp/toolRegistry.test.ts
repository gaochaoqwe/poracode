import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentEmployeePaths } from "@/shared/agentemployeePaths";
import { dispatchTool, isKnownToolName, type KnowledgeToolContext } from "./toolRegistry";

let baseDir: string;
let ctx: KnowledgeToolContext;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "agentemployee-kb-tools-"));
  const paths = { knowledgeDir: join(baseDir, "knowledge") } as AgentEmployeePaths;
  ctx = { requireAgentEmployeePaths: () => paths, baseId: "kb-test" };
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("knowledge tool registry", () => {
  it("recognizes only its own tools", () => {
    expect(isKnownToolName("kb_search")).toBe(true);
    expect(isKnownToolName("kb_read")).toBe(true);
    expect(isKnownToolName("kb_list")).toBe(true);
    expect(isKnownToolName("read_project_file")).toBe(false);
  });

  it("kb_list scaffolds and lists the root", async () => {
    const result = (await dispatchTool("kb_list", {}, ctx)) as { entries: { name: string }[] };
    expect(result.entries.map((entry) => entry.name)).toContain("wiki");
  });

  it("kb_read returns page content and reports missing paths", async () => {
    const ready = (await dispatchTool("kb_read", { path: "index.md" }, ctx)) as { status: string };
    expect(ready.status).toBe("ready");
    const missing = (await dispatchTool("kb_read", { path: "wiki/nope.md" }, ctx)) as {
      status: string;
    };
    expect(missing.status).toBe("missing");
    // Traversal paths are rejected by the store's containment guard.
    await expect(dispatchTool("kb_read", { path: "../escape.md" }, ctx)).rejects.toThrow(
      /escapes the knowledge base root/,
    );
  });

  it("kb_search requires a query", async () => {
    await expect(dispatchTool("kb_search", {}, ctx)).rejects.toThrow(/query is required/);
  });

  it("rejects unknown tools", async () => {
    await expect(dispatchTool("nope", {}, ctx)).rejects.toThrow(/Unknown tool/);
  });
});
