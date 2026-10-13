// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { resolveThreadUsageProviderId } from "./ThreadUsageIndicator";

describe("resolveThreadUsageProviderId", () => {
  it("matches a plain provider by its agentKind", () => {
    expect(resolveThreadUsageProviderId({ agentKind: "gdsAgent" }, ["gdsAgent", "codex"])).toBe(
      "gdsAgent",
    );
  });

  it("prefers a <base>:<instance> composite when the plain kind is absent", () => {
    expect(
      resolveThreadUsageProviderId({ agentKind: "gdsAgent", agentInstanceId: "work" }, [
        "gdsAgent:work",
        "codex",
      ]),
    ).toBe("gdsAgent:work");
  });

  it("matches an instance-scoped agentKind directly", () => {
    expect(resolveThreadUsageProviderId({ agentKind: "gdsAgent:work" }, ["gdsAgent:work"])).toBe(
      "gdsAgent:work",
    );
  });

  it("falls back to any snapshot sharing the base provider", () => {
    expect(resolveThreadUsageProviderId({ agentKind: "codex" }, ["codex:acct1"])).toBe(
      "codex:acct1",
    );
  });

  it("returns the raw kind when nothing matches (ring still renders empty)", () => {
    expect(resolveThreadUsageProviderId({ agentKind: "gemini" }, ["gdsAgent"])).toBe("gemini");
  });
});
