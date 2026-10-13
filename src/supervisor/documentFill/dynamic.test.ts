import { describe, expect, it } from "vitest";
import { DocPart } from "./document";
import { applyDynamicSections } from "./dynamic";
import type { BuildPlan, DynamicRule } from "./plan";

/**
 * Dynamic chapters clone a prototype block (per-depth headings, a body
 * paragraph, and named tables) once per declared sub-section, recursively.
 * This pins that behavior: nested rendering order, per-depth heading styles,
 * table cloning + filling, and prototype-region cleanup.
 */

const NO_TOC = { nameOf: () => undefined };

function paragraph(styleId: string, text: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function table(): string {
  return [
    "<w:tbl>",
    "<w:tr><w:tc><w:p><w:r><w:t>列A</w:t></w:r></w:p></w:tc>",
    "<w:tc><w:p><w:r><w:t>列B</w:t></w:r></w:p></w:tc></w:tr>",
    '<w:tr><w:trPr><w:trHeight w:hRule="exact" w:val="567"/></w:trPr>',
    "<w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc>",
    "<w:tc><w:p><w:r><w:t>y</w:t></w:r></w:p></w:tc></w:tr>",
    "</w:tbl>",
  ].join("");
}

function buildPart(): DocPart {
  return DocPart.parse(
    [
      '<w:document xmlns:w="urn:test"><w:body>',
      paragraph("P", "动态章"),
      paragraph("P", "摘要锚点文字"),
      paragraph("L0", "12.0 顶层原型"),
      paragraph("L1", "12.1 子级原型"),
      paragraph("B", "原型正文"),
      paragraph("CAP", "表9-X 示例表"),
      table(),
      paragraph("P", "12 结束"),
      "</w:body></w:document>",
    ].join(""),
  );
}

const RULE: DynamicRule = {
  parentId: "5",
  parentTitle: "动态章",
  scope: "top",
  summaryAnchor: "摘要锚点文字",
  endBeforeTitle: "12 结束",
  prototypeTitleAnchor: "12.0 顶层原型",
  prototypeBodyAnchor: "原型正文",
  prototypeCaptionAnchor: "表9-X 示例表",
  cleanupAnchors: [],
  cleanupToEnd: true,
  prototypeTitles: { 0: "12.0 顶层原型", 1: "12.1 子级原型" },
  prototypeTables: { pt: { locator_rows: [["列A", "列B"]], columns: ["A", "B"] } },
  items: [
    {
      sectionId: "5.1",
      title: "任务",
      body: "段落A",
      blocks: [{ kind: "para", text: "段落A" }],
      children: [
        {
          sectionId: "5.1.1",
          title: "T1",
          body: "",
          blocks: [{ kind: "para", text: "子段落" }],
          children: [],
        },
        {
          sectionId: "5.1.2",
          title: "T2",
          body: "",
          blocks: [
            {
              kind: "table",
              prototype: "pt",
              caption: "表9-1 示例表标题",
              rows: [["a", "b"]],
              dataStartRow: 1,
              preserveTailRows: 0,
            },
          ],
          children: [],
        },
      ],
    },
  ],
  summaryText: "摘要锚点文字",
};

function planWith(rule: DynamicRule): BuildPlan {
  return { exact: [], paragraphs: [], dynamics: [rule], tables: [] };
}

describe("dynamic sections", () => {
  it("renders recursive sub-sections, depth styles, and cloned tables", () => {
    const part = buildPart();
    applyDynamicSections(part, planWith(RULE), NO_TOC, "always");
    const xml = part.serialize();

    // Headings carry the depth prototype's style and the item's id + title.
    expect(xml).toContain("5.1 任务");
    expect(xml).toContain("5.1.1 T1");
    expect(xml).toContain("5.1.2 T2");
    expect(xml).toContain('w:pStyle w:val="L0"');
    expect(xml).toContain('w:pStyle w:val="L1"');

    // Body blocks and the cloned, filled table (header kept, row written).
    expect(xml).toContain("段落A");
    expect(xml).toContain("子段落");
    // A table block's caption is cloned from the caption prototype.
    expect(xml).toContain("表9-1 示例表标题");
    expect(xml).toContain("列A");
    expect(xml).toContain(">a<");
    expect(xml).toContain(">b<");
    // The cloned row inherits the prototype's exact height, relaxed to atLeast.
    expect(xml).toContain('w:hRule="atLeast"');
    expect(xml).not.toContain('w:hRule="exact"');

    // Prototypes are removed; exactly one (cloned) table remains.
    expect(xml).not.toContain("12.0 顶层原型");
    expect(xml).not.toContain("12.1 子级原型");
    expect(xml).not.toContain("原型正文");
    expect(xml).not.toContain("表9-X 示例表");
    expect(xml.match(/<w:tbl>/gu)?.length).toBe(1);
  });

  it("falls back to the shallowest prototype when a deeper depth is undeclared", () => {
    const part = buildPart();
    const rule: DynamicRule = { ...RULE, prototypeTitles: { 0: "12.0 顶层原型" } };
    applyDynamicSections(part, planWith(rule), NO_TOC, "always");
    const xml = part.serialize();
    expect(xml).toContain("5.1.1 T1");
    // No depth-1 prototype declared -> every heading keeps the depth-0 style.
    expect(xml).not.toContain('w:pStyle w:val="L1"');
  });

  it("derives the heading level from the section number, not tree nesting", () => {
    const part = buildPart();
    const task = RULE.items[0]!; // 5.1
    const t1 = task.children[0]!; // 5.1.1
    const t2 = task.children[1]!; // 5.1.2
    const rule: DynamicRule = {
      ...RULE,
      // 5.1.2 nested UNDER 5.1.1 in the tree but numbered as its sibling.
      items: [{ ...task, children: [{ ...t1, children: [t2] }] }],
    };
    applyDynamicSections(part, planWith(rule), NO_TOC, "always");
    const xml = part.serialize();
    // Both ids have three segments, so both render with the depth-1 (L1) prototype.
    const l1 = xml.match(/w:pStyle w:val="L1"/gu)?.length ?? 0;
    expect(l1).toBeGreaterThanOrEqual(2);
  });

  it("throws when a table block names an unknown prototype", () => {
    const part = buildPart();
    const item = RULE.items[0]!;
    const child = item.children[1]!;
    const rule: DynamicRule = {
      ...RULE,
      items: [
        {
          ...item,
          children: [
            child,
            {
              ...child,
              sectionId: "5.1.3",
              title: "T3",
              blocks: [
                {
                  kind: "table",
                  prototype: "missing",
                  rows: [],
                  dataStartRow: 1,
                  preserveTailRows: 0,
                },
              ],
            },
          ],
        },
      ],
    };
    expect(() => applyDynamicSections(part, planWith(rule), NO_TOC, "always")).toThrow(
      /未定义的表原型/u,
    );
  });
});
