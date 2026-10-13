import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTemplateRules, type TemplateRules } from "./rules";

/**
 * The recursive-dynamic fields are additive, so the shipped SRS/SDD rule files
 * must keep parsing unchanged. This guards the boundary the engine's
 * backward-compatibility relies on.
 */

const root = process.cwd();

function shippedRules(plugin: string): TemplateRules {
  const path = join(
    root,
    "resources",
    "plugins",
    plugin,
    "skills",
    plugin,
    "templates",
    "rules.json",
  );
  return parseTemplateRules(JSON.parse(readFileSync(path, "utf8")));
}

const baseRule = () => ({
  parent_title: "软件能力需求",
  summary_anchor: "摘要",
  end_before_title: "下一章",
  prototype_title_anchor: "3.10.1计算机硬件需求",
  prototype_body_anchor: "本条应描述",
  cleanup_anchors: [],
  cleanup_to_end: true,
});

const wrap = (rule: unknown): unknown => ({
  identityLineAnchors: {},
  identityRules: [],
  patternOverrides: {},
  coverRules: [],
  insertionParentScope: "placeholder",
  insertionParentRules: { "3.2": rule },
  headingSeparator: "chapter3",
  captionMode: "strict",
});

describe("rules schema backward compatibility", () => {
  it("parses both shipped rule files without the new fields", () => {
    expect(shippedRules("gjb438c-srs").insertionParentRules["3.2"]).toBeDefined();
    expect(shippedRules("gjb438c-sdd").insertionParentRules["5.3"]).toBeDefined();
  });

  it("accepts optional prototype_titles and prototype_tables", () => {
    const parsed = parseTemplateRules(
      wrap({
        ...baseRule(),
        prototype_titles: { "0": "5.X 单元", "1": "5.X.X 子节" },
        prototype_tables: { io: { locator_rows: [["列A", "列B"]], columns: ["A", "B"] } },
      }),
    );
    const rule = parsed.insertionParentRules["3.2"]!;
    expect(rule.prototype_titles).toEqual({ "0": "5.X 单元", "1": "5.X.X 子节" });
    expect(rule.prototype_tables?.io?.columns).toEqual(["A", "B"]);
  });

  it("rejects a non-numeric prototype_titles key", () => {
    expect(() =>
      parseTemplateRules(wrap({ ...baseRule(), prototype_titles: { depth: "x" } })),
    ).toThrow(/prototype_titles/u);
  });

  it("rejects a malformed prototype_tables entry", () => {
    expect(() =>
      parseTemplateRules(wrap({ ...baseRule(), prototype_tables: { io: { columns: ["A"] } } })),
    ).toThrow(/prototype_tables|locator_rows/u);
  });
});
