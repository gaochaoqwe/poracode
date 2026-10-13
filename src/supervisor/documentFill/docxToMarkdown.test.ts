import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { docxToMarkdown } from "./docxToMarkdown";
import { writeZip, type ZipEntry } from "./zip";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const FIXED_MTIME = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

/** Build a minimal `.docx` with the given `w:body` inner XML and extra parts. */
function makeDocx(bodyInner: string, extraParts: Record<string, string> = {}): Uint8Array {
  const parts: Record<string, string> = {
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}"><w:body>${bodyInner}</w:body></w:document>`,
    ...extraParts,
  };
  const entries: ZipEntry[] = Object.entries(parts).map(([name, content]) => ({
    name,
    data: new TextEncoder().encode(content),
  }));
  return writeZip(entries, FIXED_MTIME);
}

const STYLES_XML = `<?xml version="1.0"?><w:styles xmlns:w="${W_NS}"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`;

const NUMBERING_XML = `<?xml version="1.0"?><w:numbering xmlns:w="${W_NS}">
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

describe("docxToMarkdown", () => {
  it("renders headings, paragraphs, lists and tables", () => {
    const body = [
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>`,
      `<w:p><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:r><w:t>Sub</w:t></w:r></w:p>`,
      `<w:p><w:r><w:t>Plain text</w:t></w:r></w:p>`,
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Item A</w:t></w:r></w:p>`,
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>Step one</w:t></w:r></w:p>`,
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>Step two</w:t></w:r></w:p>`,
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>H1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>H2</w:t></w:r></w:p></w:tc></w:tr>` +
        `<w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
    ].join("");

    const markdown = docxToMarkdown(
      makeDocx(body, { "word/styles.xml": STYLES_XML, "word/numbering.xml": NUMBERING_XML }),
    );

    expect(markdown).toBe(
      [
        "# Title",
        "## Sub",
        "Plain text",
        "- Item A",
        "1. Step one",
        "2. Step two",
        "| H1 | H2 |\n| --- | --- |\n| a | b |",
      ].join("\n\n"),
    );
  });

  it("keeps hyperlink text, tabs, breaks and decoded entities", () => {
    const body = `<w:p><w:r><w:t>a</w:t></w:r><w:hyperlink r:id="rId1"><w:r><w:t>link</w:t></w:r></w:hyperlink><w:r><w:tab/><w:t>b&amp;c</w:t></w:r><w:br/><w:t>next</w:t></w:r></w:p>`;
    const markdown = docxToMarkdown(makeDocx(body));
    expect(markdown).toBe("alink b&c\nnext");
  });

  it("escapes pipes and joins cell paragraphs in tables", () => {
    const body = `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A|B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const markdown = docxToMarkdown(makeDocx(body));
    expect(markdown).toBe("| A\\|B |\n| --- |");
  });

  it("throws on a non-docx input", () => {
    expect(() => docxToMarkdown(new Uint8Array([1, 2, 3, 4]))).toThrow(/not a zip archive/);
  });

  it("converts the real SRS template without throwing", () => {
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
    const markdown = docxToMarkdown(new Uint8Array(readFileSync(templatePath)));
    expect(markdown.length).toBeGreaterThan(0);
    expect(markdown).not.toContain("<w:");
  });
});
