import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyTableFills, relaxRowHeight } from "./apply";
import { DocPart } from "./document";
import type { BuildPlan } from "./plan";
import { readZip } from "./zip";
import { attrValue, firstChild, parseXml, type XmlElement } from "./xml";

const root = process.cwd();
const PLUGIN_DIR = join(root, "resources", "plugins", "gjb438c-srs", "skills", "gjb438c-srs");
const TEMPLATE = "[10][SRS] 软件需求规格说明-438C-2021.docx";

function parseRow(inner: string): XmlElement {
  const nodes = parseXml(`<w:tr xmlns:w="urn:test">${inner}</w:tr>`);
  return nodes.find((node): node is XmlElement => node.kind === "element")!;
}

function trHeightOf(row: XmlElement): XmlElement | undefined {
  const trPr = firstChild(row, "w:trPr");
  return trPr ? firstChild(trPr, "w:trHeight") : undefined;
}

describe("relaxRowHeight", () => {
  it("flips an exact-height row to atLeast so filled cell text is not clipped", () => {
    const row = parseRow('<w:trPr><w:trHeight w:hRule="exact" w:val="567"/></w:trPr>');
    relaxRowHeight(row);
    const trHeight = trHeightOf(row)!;
    expect(attrValue(trHeight, "w:hRule")).toBe("atLeast");
    // The template's height is preserved as the floor of "atLeast".
    expect(attrValue(trHeight, "w:val")).toBe("567");
  });

  it("leaves rows that are not exact-height untouched", () => {
    const row = parseRow('<w:trPr><w:trHeight w:hRule="atLeast" w:val="567"/></w:trPr>');
    relaxRowHeight(row);
    expect(attrValue(trHeightOf(row)!, "w:hRule")).toBe("atLeast");
  });

  it("no-ops without a trHeight", () => {
    const row = parseRow('<w:trPr><w:jc w:val="center"/></w:trPr>');
    expect(() => relaxRowHeight(row)).not.toThrow();
    expect(trHeightOf(row)).toBeUndefined();
  });

  it("matches the shipped template nesting (w:trPr > w:trHeight)", () => {
    const bytes = new Uint8Array(readFileSync(join(PLUGIN_DIR, "documents", TEMPLATE)));
    const entry = readZip(bytes).find((candidate) => candidate.name === "word/document.xml")!;
    const rootNode = parseXml(new TextDecoder().decode(entry.data)).find(
      (node): node is XmlElement => node.kind === "element",
    )!;

    const exactRows: XmlElement[] = [];
    const walk = (element: XmlElement): void => {
      if (
        element.name === "w:tr" &&
        attrValue(trHeightOf(element) ?? element, "w:hRule") === "exact"
      ) {
        exactRows.push(element);
      }
      for (const child of element.children) {
        if (child.kind === "element") walk(child);
      }
    };
    walk(rootNode);

    // If the template ever moves trHeight out of trPr, relaxRowHeight would stop
    // finding it — fail loudly here instead of silently clipping filled cells.
    expect(exactRows.length).toBeGreaterThan(0);
    for (const row of exactRows) {
      expect(trHeightOf(row)).toBeDefined();
    }
  });

  it("relaxes exactly the data rows a table fill writes into", () => {
    const part = DocPart.parse(
      [
        '<w:document xmlns:w="urn:test"><w:body><w:tbl>',
        "<w:tr><w:tc><w:p><w:r><w:t>H1</w:t></w:r></w:p></w:tc>",
        "<w:tc><w:p><w:r><w:t>H2</w:t></w:r></w:p></w:tc></w:tr>",
        '<w:tr><w:trPr><w:trHeight w:hRule="exact" w:val="567"/></w:trPr>',
        "<w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>",
        "<w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr>",
        "</w:tbl></w:body></w:document>",
      ].join(""),
    );
    const plan: BuildPlan = {
      exact: [],
      paragraphs: [],
      dynamics: [],
      tables: [
        {
          key: "t",
          locatorRows: [["H1", "H2"]],
          columns: ["A", "B"],
          rows: [["长文本一", "长文本二"]],
          dataStartRow: 1,
          preserveTailRows: 0,
        },
      ],
    };

    expect(part.serialize()).toContain('w:hRule="exact"');
    applyTableFills(part, plan);
    const out = part.serialize();
    expect(out).toContain("长文本一");
    expect(out).toContain('w:hRule="atLeast"');
    expect(out).not.toContain('w:hRule="exact"');
  });
});
