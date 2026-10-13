import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crc32, readZip, writeZip } from "./zip";

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

const FIXED_MTIME = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

describe("zip", () => {
  it("computes the reference CRC-32 for known input", () => {
    // Standard test vector: CRC-32("123456789") = 0xCBF43926.
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("round-trips every entry of a real .docx template byte-for-byte", () => {
    const original = readFileSync(templatePath);
    const entries = readZip(new Uint8Array(original));

    const names = entries.map((entry) => entry.name);
    expect(names).toContain("word/document.xml");
    expect(names).toContain("word/settings.xml");
    expect(names).toContain("[Content_Types].xml");

    const rewritten = writeZip(entries, FIXED_MTIME);
    const reread = readZip(rewritten);

    expect(reread.map((entry) => entry.name)).toEqual(names);
    for (let i = 0; i < entries.length; i += 1) {
      expect(reread[i]!.data).toEqual(entries[i]!.data);
    }
  });

  it("is deterministic for a fixed mtime", () => {
    const original = readFileSync(templatePath);
    const entries = readZip(new Uint8Array(original));
    const first = writeZip(entries, FIXED_MTIME);
    const second = writeZip(entries, FIXED_MTIME);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });
});
