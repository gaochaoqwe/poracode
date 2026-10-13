import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fillDocument } from "./fill";
import { readZip } from "./zip";
import { parseXml, type XmlElement } from "./xml";
import { paragraphText } from "./document";

const root = process.cwd();

interface Case {
  id: string;
  pluginDir: string;
  template: string;
  golden: string;
}

// The SDD template was rebuilt to use recursive dynamic sections and
// prototype-table cloning, which the original Python reference engine cannot
// produce — so the SDD paragraph golden no longer has a reference to compare
// against. SRS keeps its golden (it exercises the shared engine unchanged).
const CASES: Case[] = [
  {
    id: "srs",
    pluginDir: join(root, "resources", "plugins", "gjb438c-srs", "skills", "gjb438c-srs"),
    template: "[10][SRS] 软件需求规格说明-438C-2021.docx",
    golden: join(root, "tmp", "golden", "srs.docx"),
  },
];

/** Every paragraph text in document order: body paragraphs then table-cell paragraphs. */
function allParagraphTexts(docxBytes: Uint8Array): string[] {
  const documentEntry = readZip(docxBytes).find((entry) => entry.name === "word/document.xml");
  if (!documentEntry) throw new Error("no word/document.xml");
  const nodes = parseXml(new TextDecoder().decode(documentEntry.data));
  const documentRoot = nodes.find((node): node is XmlElement => node.kind === "element")!;

  const out: string[] = [];
  const walk = (element: XmlElement): void => {
    for (const child of element.children) {
      if (child.kind !== "element") continue;
      if (child.name === "w:p") out.push(paragraphText(child));
      else walk(child);
    }
  };
  walk(documentRoot);
  return out.map((text) => text.trim());
}

function readPluginJson(dir: string, name: string): unknown {
  return JSON.parse(readFileSync(join(dir, "templates", name), "utf8"));
}

describe("document fill golden (skips without a Python reference)", () => {
  for (const testCase of CASES) {
    it.skipIf(!existsSync(testCase.golden))(`matches the reference engine: ${testCase.id}`, () => {
      const template = new Uint8Array(
        readFileSync(join(testCase.pluginDir, "documents", testCase.template)),
      );
      const output = fillDocument({
        template,
        rules: readPluginJson(testCase.pluginDir, "rules.json"),
        config: readPluginJson(testCase.pluginDir, "config.json"),
        project: readPluginJson(testCase.pluginDir, "project.json"),
      });

      const expected = allParagraphTexts(new Uint8Array(readFileSync(testCase.golden)));
      const actual = allParagraphTexts(output);
      expect(actual).toEqual(expected);
    });
  }
});
