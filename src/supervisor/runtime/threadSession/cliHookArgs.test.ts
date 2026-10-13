import { describe, expect, it } from "vitest";
import type { AgentAdapter } from "../../agents/base";
import type { ProjectLocation, SessionRef, ThreadConfig } from "@/shared/contracts";
import { codexExtraArgsPosition } from "../../agents/codex/argv";
import { applyLaunchArgsConfigRewrite, mergeCliHookExtraArgs } from "./cliHookArgs";

const codexAdapter = { kind: "codex", extraArgsPosition: codexExtraArgsPosition } as AgentAdapter;
const genericAdapter = { kind: "gemini" } as AgentAdapter;

const NATIVE: ProjectLocation = { kind: "windows", path: "C:\\proj" };
const sessionRef = { id: "sess-1" } as unknown as SessionRef;

describe("mergeCliHookExtraArgs", () => {
  it("returns argv unchanged when there are no hook extras", () => {
    const args = ["codex", "--config", "x"];
    // Same reference — nothing to merge.
    expect(mergeCliHookExtraArgs(codexAdapter, args, [], "")).toBe(args);
  });

  it("appends extras for an adapter without extraArgsPosition (fallback path)", () => {
    expect(mergeCliHookExtraArgs(genericAdapter, ["gemini"], ["--flag"], "")).toEqual([
      "gemini",
      "--flag",
    ]);
  });

  it("appends extras for a codex launch (no trailing positionals)", () => {
    // Launch: args[0] !== "resume", no sessionRef, empty prompt -> insertAt = args.length.
    expect(mergeCliHookExtraArgs(codexAdapter, ["codex"], ["--enable", "hooks"], "")).toEqual([
      "codex",
      "--enable",
      "hooks",
    ]);
  });

  it("inserts codex resume extras before the session-id positional", () => {
    // resume argv is ["resume", "<sessionId>"]; sessionRef is present, no prompt.
    // The hook flags must land between "resume" and the id so Codex doesn't read
    // `--enable <feature>` as trailing user input.
    const out = mergeCliHookExtraArgs(
      codexAdapter,
      ["resume", "sess-1"],
      ["--enable", "hooks"],
      "",
      sessionRef,
    );
    expect(out).toEqual(["resume", "--enable", "hooks", "sess-1"]);
  });

  it("counts a non-empty prompt as an extra trailing positional for codex resume", () => {
    const out = mergeCliHookExtraArgs(
      codexAdapter,
      ["resume", "sess-1"],
      ["--enable", "hooks"],
      "do the thing",
      sessionRef,
    );
    // sessionRef + prompt = 2 trailing positionals -> insertAt = max(2 - 2, 1) = 1.
    expect(out).toEqual(["resume", "--enable", "hooks", "sess-1"]);
  });
});

describe("applyLaunchArgsConfigRewrite", () => {
  it("passes through unchanged for an adapter without a rewrite hook", async () => {
    const args = ["codex", "--settings", "/x"];
    const config = { effort: "ultracode" } as ThreadConfig;
    await expect(applyLaunchArgsConfigRewrite(codexAdapter, args, config, NATIVE)).resolves.toBe(
      args,
    );
  });
});
