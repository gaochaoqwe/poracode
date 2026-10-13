import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readZip } from "./zip";
import { parseXml, serializeXml } from "./xml";

const templatePath = join(
  process.cwd(),
  "resources",
  "plugins",
  "gjb438c-srs",
  "skills",
  "gjb438c-srs",
  "documents",
  "[10][SRS] 软件需求规格说明-438C-2021.docx",
);

function readPart(name: string): string {
  const bytes = readFileSync(templatePath);
  const entry = readZip(new Uint8Array(bytes)).find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`missing ${name}`);
  return new TextDecoder("utf-8").decode(entry.data);
}

describe("xml round-trip", () => {
  for (const part of ["word/document.xml", "word/settings.xml", "[Content_Types].xml"]) {
    it(`reproduces ${part} byte-for-byte`, () => {
      const source = readPart(part);
      expect(serializeXml(parseXml(source))).toBe(source);
    });
  }
});
