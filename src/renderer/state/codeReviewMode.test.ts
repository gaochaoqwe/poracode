import { describe, expect, it } from "vitest";
import {
  asReviewMode,
  resolveReviewMode,
  REVIEW_MODE_MODULE_TITLE,
  REVIEW_MODE_OVERVIEW_TITLE,
  REVIEW_MODE_TREE_TITLE,
} from "./codeReviewMode";

/**
 * 「当前审查模式」取场景里选定的 output mode，与起草区的模式选择器同源同解析
 * （`resolveScenarioOutputMode`）。这里只测纯函数，不碰 store。
 */
describe("codeReviewMode resolveReviewMode", () => {
  it("takes the stored output mode when it is one of the three review modes", () => {
    for (const mode of ["function", "chain", "feature"] as const) {
      expect(
        resolveReviewMode({
          scenarioId: "code-review",
          storedOutputMode: mode,
          codeSelections: undefined,
        }),
      ).toBe(mode);
    }
  });

  it("falls back to the scenario-recommended mode when nothing is stored", () => {
    // 代码审查场景不声明 code 输入 → 推荐模式是列表里第一个 false 的，即函数审查。
    expect(
      resolveReviewMode({
        scenarioId: "code-review",
        storedOutputMode: undefined,
        codeSelections: undefined,
      }),
    ).toBe("function");
  });

  it("ignores a stored id the scenario no longer declares", () => {
    expect(
      resolveReviewMode({
        scenarioId: "code-review",
        storedOutputMode: "removed-mode",
        codeSelections: undefined,
      }),
    ).toBe("function");
  });

  it("returns null for a non code-review scenario (regression has its own mode)", () => {
    expect(
      resolveReviewMode({
        scenarioId: "code-review-regression",
        storedOutputMode: undefined,
        codeSelections: undefined,
      }),
    ).toBeNull();
  });

  it("returns null when no scenario is active", () => {
    expect(
      resolveReviewMode({ scenarioId: undefined, storedOutputMode: "chain", codeSelections: undefined }),
    ).toBeNull();
  });
});

describe("codeReviewMode asReviewMode", () => {
  it("accepts exactly the three review modes", () => {
    expect(asReviewMode("chain")).toBe("chain");
    expect(asReviewMode("regression")).toBeNull();
    expect(asReviewMode("")).toBeNull();
    expect(asReviewMode(undefined)).toBeNull();
  });
});

describe("codeReviewMode labels", () => {
  it("only chain/feature get the extra 功能模块列表 column", () => {
    expect(REVIEW_MODE_MODULE_TITLE.function).toBe("");
    expect(REVIEW_MODE_MODULE_TITLE.chain).toBe("功能模块列表");
    expect(REVIEW_MODE_MODULE_TITLE.feature).toBe("功能列表");
  });

  it("renames the tree and overview blocks per mode", () => {
    expect(REVIEW_MODE_TREE_TITLE.chain).toBe("代码目录树");
    expect(REVIEW_MODE_TREE_TITLE.feature).toBe("目录结构树");
    expect(REVIEW_MODE_OVERVIEW_TITLE.function).toBe("函数功能概述");
    expect(REVIEW_MODE_OVERVIEW_TITLE.chain).toBe("链路功能概述");
    expect(REVIEW_MODE_OVERVIEW_TITLE.feature).toBe("功能概述");
  });
});
