import { describe, expect, it } from "vitest";
import type { ProjectLocation, ReadAbsoluteFileResult } from "@/shared/contracts";
import { DocumentTemplateService } from "./documentTemplates";

const location: ProjectLocation = { kind: "posix", path: "/repo/app" };

function ready(content: string): ReadAbsoluteFileResult {
  return { status: "ready", modifiedAtMs: 1, content };
}

function serviceWith(files: Record<string, ReadAbsoluteFileResult | Error>) {
  return new DocumentTemplateService({
    globalTemplatesDir: "/home/u/.agentemployee/templates",
    bundledTemplatesDir: "/opt/app/resources/templates",
    readAbsoluteFile: async ({ absolutePath }) => {
      const entry = files[absolutePath];
      if (!entry) return { status: "missing" };
      if (entry instanceof Error) throw entry;
      return entry;
    },
  });
}

const projectPath = "/repo/app/.agentemployee/templates/design.md";
const globalPath = "/home/u/.agentemployee/templates/design.md";
const builtinPath = "/opt/app/resources/templates/design.md";

describe("DocumentTemplateService", () => {
  it("prefers the project override over global and built-in", async () => {
    const service = serviceWith({
      [projectPath]: ready("---\ntitle: Project\nresultFile: docs/p.md\n---\nProject body"),
      [globalPath]: ready("---\ntitle: Global\n---\nGlobal body"),
      [builtinPath]: ready("---\ntitle: Builtin\n---\nBuiltin body"),
    });
    const resolved = await service.resolve({ projectLocation: location, templateId: "design" });
    expect(resolved).toMatchObject({
      level: "project",
      title: "Project",
      resultFile: "docs/p.md",
      content: "Project body",
    });
  });

  it("falls back to global, then to the bundled default", async () => {
    const globalOnly = serviceWith({ [globalPath]: ready("---\ntitle: Global\n---\nG") });
    expect(await globalOnly.resolve({ projectLocation: location, templateId: "design" })).toMatchObject(
      { level: "global", title: "Global" },
    );

    const builtinOnly = serviceWith({ [builtinPath]: ready("---\ntitle: Builtin\n---\nB") });
    expect(
      await builtinOnly.resolve({ projectLocation: location, templateId: "design" }),
    ).toMatchObject({ level: "builtin", title: "Builtin" });
  });

  it("falls through a malformed project override instead of failing", async () => {
    const service = serviceWith({
      [projectPath]: ready("# no frontmatter here"),
      [builtinPath]: ready("---\ntitle: Builtin\n---\nB"),
    });
    expect(await service.resolve({ projectLocation: location, templateId: "design" })).toMatchObject({
      level: "builtin",
      title: "Builtin",
    });
  });

  it("falls through when a candidate read throws", async () => {
    const service = serviceWith({
      [projectPath]: new Error("EACCES"),
      [builtinPath]: ready("---\ntitle: Builtin\n---\nB"),
    });
    expect(await service.resolve({ projectLocation: location, templateId: "design" })).toMatchObject({
      level: "builtin",
    });
  });

  it("returns null when no candidate is readable", async () => {
    const service = serviceWith({});
    expect(await service.resolve({ projectLocation: location, templateId: "design" })).toBeNull();
  });
});
