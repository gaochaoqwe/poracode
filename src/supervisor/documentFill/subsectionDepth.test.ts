import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fillDocument } from "./fill";
import { readZip } from "./zip";

const root = process.cwd();
const DIR = join(root, "resources", "plugins", "gjb438c-srs", "skills", "gjb438c-srs");
const TEMPLATE = "[10][SRS] 软件需求规格说明-438C-2021.docx";

function documentXml(bytes: Uint8Array): string {
  const entry = readZip(bytes).find((candidate) => candidate.name === "word/document.xml");
  if (!entry) throw new Error("no word/document.xml");
  return new TextDecoder().decode(entry.data);
}

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(DIR, "templates", name), "utf8")) as Record<string, unknown>;
}

/**
 * A capability that needs sub-capabilities is expressed as a four-part
 * subsection key ("3.2.1.1"). The engine keys `subsections` by section id and
 * sorts numerically, so depth is not limited to three parts -- this pins that
 * behavior, since the SRS skill tells the agent to use it.
 */
describe("dynamic subsections accept four-part ids", () => {
  it("emits a 3.2.1.1 heading when the project declares one", () => {
    const template = new Uint8Array(readFileSync(join(DIR, "documents", TEMPLATE)));
    const project = readJson("project.json") as {
      structure: Record<
        string,
        { placeholders: Array<{ id: string; subsections: Record<string, unknown> }> }
      >;
    };

    const placeholder = project.structure["3"]!.placeholders.find((p) => p.id === "3.2")!;
    placeholder.subsections["3.2.1.1"] = {
      name: "子能力示例",
      content: "a) 标识号：X\nb) 说明：示例",
    };

    const output = documentXml(
      fillDocument({
        template,
        rules: readJson("rules.json"),
        config: readJson("config.json"),
        project,
      }),
    );

    expect(output).toContain("3.2.1.1");
    expect(output).toContain("子能力示例");
  });
});
