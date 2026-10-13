import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PromptSegment } from "@/shared/contracts";
import type { WslBridgeClient } from "../wsl/bridge/client";
import { writeZip } from "../documentFill/zip";
import {
  materializeDocxAttachments,
  rewriteSegmentsForWorkspace,
  rewriteSegmentsForWsl,
  setWslAttachmentBridgeClient,
} from "./threadAttachments";

const dirs: string[] = [];

afterEach(() => {
  setWslAttachmentBridgeClient(undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

describe("rewriteSegmentsForWorkspace", () => {
  it("copies an out-of-workspace attachment into .agentemployee/attachments and rewrites the path", async () => {
    const project = tmp("lc-ws-project-");
    const outside = tmp("lc-ws-outside-");
    const src = join(outside, "shot.png");
    writeFileSync(src, "png-bytes");

    const segments = await rewriteSegmentsForWorkspace(
      [{ kind: "attachment", path: src, mimeType: "image/png" }],
      project,
    );

    const dest = join(project, ".agentemployee", "attachments", "shot.png");
    expect(segments[0]).toEqual({ kind: "attachment", path: dest, mimeType: "image/png" });
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf8")).toBe("png-bytes");
    // The copies self-ignore so they never show up in `git status`.
    expect(readFileSync(join(project, ".agentemployee", ".gitignore"), "utf8")).toContain("*");
  });

  it("leaves attachments already inside the workspace untouched", async () => {
    const project = tmp("lc-ws-project-");
    const inside = join(project, "assets");
    mkdirSync(inside, { recursive: true });
    const src = join(inside, "in.png");
    writeFileSync(src, "x");

    const segments = await rewriteSegmentsForWorkspace(
      [{ kind: "attachment", path: src, mimeType: "image/png" }],
      project,
    );

    expect(segments[0]).toEqual({ kind: "attachment", path: src, mimeType: "image/png" });
    expect(existsSync(join(project, ".agentemployee"))).toBe(false);
  });

  it("passes through text segments and relative paths", async () => {
    const project = tmp("lc-ws-project-");
    const segments = await rewriteSegmentsForWorkspace(
      [
        { kind: "text", content: "hi" },
        { kind: "attachment", path: "rel.png", mimeType: "image/png" },
      ],
      project,
    );
    expect(segments).toEqual([
      { kind: "text", content: "hi" },
      { kind: "attachment", path: "rel.png", mimeType: "image/png" },
    ]);
  });
});

describe("rewriteSegmentsForWsl", () => {
  it("preserves host PDF attachment paths when the structured adapter reads their bytes", async () => {
    setWslAttachmentBridgeClient({} as WslBridgeClient);
    const path = "C:\\Users\\test\\document.pdf";

    const segments = await rewriteSegmentsForWsl(
      [{ kind: "attachment", path, mimeType: "application/pdf" }],
      {
        kind: "wsl",
        distro: "Ubuntu",
        linuxPath: "/workspace",
        uncPath: "\\\\wsl.localhost\\Ubuntu\\workspace",
      },
      { preservePdfAttachments: true },
    );

    expect(segments).toEqual([{ kind: "attachment", path, mimeType: "application/pdf" }]);
  });
});

function makeDocx(text: string): Uint8Array {
  const xml =
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
  return writeZip([{ name: "word/document.xml", data: new TextEncoder().encode(xml) }], new Date(0));
}

describe("materializeDocxAttachments", () => {
  it("converts a docx into a git-ignored .md inside the project", async () => {
    const project = tmp("lc-docx-project-");
    const outside = tmp("lc-docx-outside-");
    const src = join(outside, "brief.docx");
    writeFileSync(src, makeDocx("hello world"));

    const segments = await materializeDocxAttachments([{ kind: "attachment", path: src }], {
      kind: "windows",
      path: project,
    });

    const segment = segments[0]!;
    expect(segment.kind).toBe("attachment");
    if (segment.kind !== "attachment") throw new Error("expected an attachment segment");
    expect(segment.mimeType).toBe("text/markdown");
    expect(segment.path.startsWith(join(project, ".agentemployee", "attachments"))).toBe(true);
    expect(segment.path.endsWith(".md")).toBe(true);
    expect(readFileSync(segment.path, "utf8")).toBe("hello world");
    expect(readFileSync(join(project, ".agentemployee", ".gitignore"), "utf8")).toBe("/attachments/\n");
  });

  it("passes non-docx attachments and docx mentions through untouched", async () => {
    const project = tmp("lc-docx-project-");
    const src = join(tmp("lc-docx-outside-"), "brief.docx");
    writeFileSync(src, makeDocx("x"));

    const input: PromptSegment[] = [
      { kind: "attachment", path: join(project, "shot.png"), mimeType: "image/png" },
      { kind: "file", path: src },
    ];
    const segments = await materializeDocxAttachments(input, {
      kind: "windows",
      path: project,
    });

    expect(segments).toEqual(input);
  });

  it("stages a WSL docx as a host temp .md for the existing copy step", async () => {
    const src = join(tmp("lc-docx-outside-"), "brief.docx");
    writeFileSync(src, makeDocx("wsl body"));

    const segments = await materializeDocxAttachments([{ kind: "attachment", path: src }], {
      kind: "wsl",
      distro: "Ubuntu",
      linuxPath: "/workspace",
      uncPath: "\\\\wsl.localhost\\Ubuntu\\workspace",
    });

    const segment = segments[0]!;
    if (segment.kind !== "attachment") throw new Error("expected an attachment segment");
    expect(segment.mimeType).toBe("text/markdown");
    expect(segment.path.endsWith(".md")).toBe(true);
    expect(readFileSync(segment.path, "utf8")).toBe("wsl body");
  });

  it("keeps the original segment when the docx cannot be converted", async () => {
    const project = tmp("lc-docx-project-");
    const src = join(tmp("lc-docx-outside-"), "broken.docx");
    writeFileSync(src, "not a zip");

    const segments = await materializeDocxAttachments([{ kind: "attachment", path: src }], {
      kind: "windows",
      path: project,
    });

    expect(segments).toEqual([{ kind: "attachment", path: src }]);
  });
});
