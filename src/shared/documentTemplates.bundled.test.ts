import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDocumentTemplate } from "./documentTemplates";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const templatesDir = join(repoRoot, "resources", "templates");

/**
 * Every bundled template is read by `DocumentTemplateService` at runtime and
 * must parse; a malformed file silently falls through to no template. This
 * guards the shipped `resources/templates/*.md` (see
 * `scripts/build-desktop-artifact.mjs` extraResources).
 */
describe("bundled document templates", () => {
  const files = readdirSync(templatesDir).filter((name) => name.endsWith(".md"));

  it("ships the templates the document scenarios resolve", () => {
    expect(files).toContain("design.md");
    expect(files).toContain("requirements-review.md");
  });

  it("parses every bundled template with relative resultFile and a todoMarker", () => {
    for (const file of files) {
      const templateId = file.replace(/\.md$/, "");
      const content = readFileSync(join(templatesDir, file), "utf8");
      const parsed = parseDocumentTemplate(templateId, content);
      expect(parsed, `${file} must have frontmatter`).not.toBeNull();
      expect(parsed!.title.trim().length, `${file} title`).toBeGreaterThan(0);
      expect(parsed!.resultFile, `${file} resultFile`).toMatch(/^docs\//u);
      expect(parsed!.resultFile.startsWith("/"), `${file} resultFile is relative`).toBe(false);
      expect(parsed!.todoMarker.trim().length, `${file} todoMarker`).toBeGreaterThan(0);
      expect(parsed!.content.trim().length, `${file} body`).toBeGreaterThan(0);
    }
  });
});
