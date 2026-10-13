import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { searchKnowledge } from "./search";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agentemployee-kb-search-"));
  mkdirSync(join(root, "wiki", "entities"), { recursive: true });
  writeFileSync(
    join(root, "wiki", "alpha.md"),
    "---\ntitle: Quantum Widget\n---\nAll about the widget.",
  );
  writeFileSync(
    join(root, "wiki", "entities", "beta.md"),
    "---\ntitle: Other Page\n---\nMentions quantum once in the body.",
  );
  writeFileSync(join(root, "wiki", "gamma.md"), "# Unrelated\n\ntotally different topic.");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("searchKnowledge", () => {
  it("ranks a title/frontmatter match above a body mention", async () => {
    const hits = await searchKnowledge(root, "quantum", 10);
    expect(hits.length).toBe(2);
    expect(hits[0]?.path.endsWith("alpha.md")).toBe(true);
    expect(hits[0]?.title).toBe("Quantum Widget");
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0);
  });

  it("returns nothing for an unmatched query", async () => {
    expect(await searchKnowledge(root, "zzzznope", 10)).toEqual([]);
  });

  it("respects the limit", async () => {
    mkdirSync(join(root, "wiki", "more"), { recursive: true });
    writeFileSync(join(root, "wiki", "more", "delta.md"), "# Delta\n\nquantum again.");
    const hits = await searchKnowledge(root, "quantum", 1);
    expect(hits).toHaveLength(1);
  });

  it("ignores an empty query", async () => {
    expect(await searchKnowledge(root, "   ", 10)).toEqual([]);
  });
});
