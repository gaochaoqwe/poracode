import { describe, expect, it } from "vitest";
import type { ProjectLocation } from "./contracts";
import { documentTemplateCandidates, parseDocumentTemplate } from "./documentTemplates";

const windowsLocation: ProjectLocation = { kind: "windows", path: "C:\\repos\\app" };
const posixLocation: ProjectLocation = { kind: "posix", path: "/home/u/app" };
const wslLocation: ProjectLocation = {
  kind: "wsl",
  distro: "Ubuntu",
  linuxPath: "/home/u/app",
  uncPath: "\\\\wsl$\\Ubuntu\\home\\u\\app",
};

describe("documentTemplateCandidates", () => {
  it("orders project → global → builtin", () => {
    const candidates = documentTemplateCandidates({
      templateId: "design",
      location: posixLocation,
      globalTemplatesDir: "/home/u/.agentemployee/templates",
      bundledTemplatesDir: "/opt/agentemployee/resources/templates",
    });
    expect(candidates.map((c) => c.level)).toEqual(["project", "global", "builtin"]);
    expect(candidates.map((c) => c.path)).toEqual([
      "/home/u/app/.agentemployee/templates/design.md",
      "/home/u/.agentemployee/templates/design.md",
      "/opt/agentemployee/resources/templates/design.md",
    ]);
  });

  it("uses backslashes and the project path for Windows projects", () => {
    const candidates = documentTemplateCandidates({
      templateId: "design",
      location: windowsLocation,
      globalTemplatesDir: "C:\\Users\\u\\.agentemployee\\templates",
    });
    expect(candidates.map((c) => c.path)).toEqual([
      "C:\\repos\\app\\.agentemployee\\templates\\design.md",
      "C:\\Users\\u\\.agentemployee\\templates\\design.md",
    ]);
  });

  it("uses the Linux path for WSL projects", () => {
    const [project] = documentTemplateCandidates({
      templateId: "design",
      location: wslLocation,
      globalTemplatesDir: "/home/u/.agentemployee/templates",
    });
    expect(project?.path).toBe("/home/u/app/.agentemployee/templates/design.md");
  });

  it("omits the builtin candidate when no bundled dir is given", () => {
    const candidates = documentTemplateCandidates({
      templateId: "design",
      location: posixLocation,
      globalTemplatesDir: "/g",
    });
    expect(candidates.map((c) => c.level)).toEqual(["project", "global"]);
  });

  it("rejects ids that could escape the templates directory", () => {
    for (const templateId of ["../secret", "a/b", "Design", ".hidden", ""]) {
      expect(
        documentTemplateCandidates({
          templateId,
          location: posixLocation,
          globalTemplatesDir: "/g",
        }),
      ).toEqual([]);
    }
  });
});

describe("parseDocumentTemplate", () => {
  it("reads title, resultFile, and todoMarker and returns the body", () => {
    const parsed = parseDocumentTemplate(
      "design",
      [
        "---",
        "id: design",
        "title: Software Design Description",
        'resultFile: docs/design.md',
        'todoMarker: "待补充"',
        "---",
        "",
        "# Heading",
        "Body text",
      ].join("\n"),
    );
    expect(parsed).toEqual({
      title: "Software Design Description",
      resultFile: "docs/design.md",
      todoMarker: "待补充",
      content: "# Heading\nBody text",
    });
  });

  it("falls back to defaults for missing frontmatter fields", () => {
    const parsed = parseDocumentTemplate("design", "---\nid: design\n---\nBody");
    expect(parsed).toEqual({
      title: "design",
      resultFile: "docs/design.md",
      todoMarker: "TBD",
      content: "Body",
    });
  });

  it("returns null without a frontmatter block", () => {
    expect(parseDocumentTemplate("design", "# Just markdown")).toBeNull();
    expect(parseDocumentTemplate("design", "")).toBeNull();
    expect(parseDocumentTemplate("design", "---\nunterminated")).toBeNull();
  });

  it("tolerates CRLF and a BOM", () => {
    const parsed = parseDocumentTemplate(
      "design",
      "\uFEFF---\r\ntitle: T\r\nresultFile: docs/x.md\r\n---\r\nBody\r\n",
    );
    expect(parsed?.title).toBe("T");
    expect(parsed?.resultFile).toBe("docs/x.md");
    expect(parsed?.content).toBe("Body");
  });
});
