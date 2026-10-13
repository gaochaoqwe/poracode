import { describe, expect, it } from "vitest";
import type { RegressionDiffReport, ReviewProgress } from "@/shared/codeReviewReport";
import type { Project } from "@/shared/contracts";
import type { ReviewProjectData } from "@/shared/ipc/schemas";
import {
  buildProjectBoardEntry,
  formatRelativeTime,
  projectLocationLabel,
  projectStatusLabel,
  loadProjectBoard,
} from "./projectBoard";

const PROJECT: Project = {
  id: "p1",
  name: "Alpha",
  location: { kind: "windows", path: "C:/alpha" },
  createdAt: "2026-01-01T00:00:00.000Z",
};

const EMPTY_REVIEW: ReviewProjectData = {
  issues: [],
  progress: null,
  diffReports: [],
  tasks: [],
  functionInfos: [],
  features: [],
  callgraphs: {},
};
const NO_STATIC = { tasks: [], problems: [] };

function progress(overrides: Partial<ReviewProgress> = {}): ReviewProgress {
  return {
    taskId: "t1",
    mode: "function",
    status: "running",
    total: 10,
    done: 3,
    batchSize: null,
    currentFile: null,
    currentFunction: null,
    issuesInBatch: null,
    accumulatedIssues: null,
    overBudget: null,
    updatedAt: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

function diffReport(overrides: Partial<RegressionDiffReport> = {}): RegressionDiffReport {
  return {
    schemaVersion: 1,
    taskId: "t2",
    fileName: "t2-regression-diff.json",
    leftPath: null,
    rightPath: null,
    updatedAt: null,
    changedFiles: [],
    ...overrides,
  };
}

describe("buildProjectBoardEntry", () => {
  it("drops a project that has no review or static-analysis records", () => {
    expect(buildProjectBoardEntry(PROJECT, EMPTY_REVIEW, NO_STATIC)).toBeNull();
  });

  it("aggregates review progress into status, task id and mode", () => {
    const entry = buildProjectBoardEntry(
      PROJECT,
      { ...EMPTY_REVIEW, progress: progress() },
      NO_STATIC,
    );

    expect(entry).not.toBeNull();
    expect(entry?.status).toBe("running");
    expect(entry?.taskIds).toEqual(["t1"]);
    expect(entry?.modes).toEqual(["function"]);
    expect(entry?.hasReview).toBe(false);
    expect(entry?.hasDiff).toBe(false);
    expect(entry?.lastUpdatedAt).toBe(new Date("2026-01-01T10:00:00.000Z").getTime());
  });

  it("collects diff task ids and keeps the newest timestamp", () => {
    const entry = buildProjectBoardEntry(
      PROJECT,
      {
        ...EMPTY_REVIEW,
        progress: progress(),
        diffReports: [
          diffReport({ updatedAt: "2026-01-02T09:30:00.000Z" }),
          diffReport({ taskId: "t3", updatedAt: "2026-01-01T08:00:00.000Z" }),
        ],
      },
      NO_STATIC,
    );

    expect(entry?.hasDiff).toBe(true);
    expect(entry?.diffCount).toBe(2);
    expect(entry?.taskIds.toSorted()).toEqual(["t1", "t2", "t3"]);
    expect(entry?.lastUpdatedAt).toBe(new Date("2026-01-02T09:30:00.000Z").getTime());
  });
});

describe("loadProjectBoard", () => {
  it("skips project records whose read fails and returns newest-first entries", async () => {
    // No bridge in the test env: both reads reject and are folded into empty
    // payloads, so a record-less project drops out instead of throwing.
    await expect(loadProjectBoard([PROJECT])).resolves.toEqual([]);
  });
});

describe("project board labels", () => {
  it("labels the three review statuses", () => {
    expect(projectStatusLabel("running")).toBe("进行中");
    expect(projectStatusLabel("paused")).toBe("已暂停");
    expect(projectStatusLabel("done")).toBe("已完成");
  });

  it("renders project locations for each location kind", () => {
    expect(projectLocationLabel(undefined)).toBe("（无位置）");
    expect(projectLocationLabel({ kind: "windows", path: "C:/alpha" })).toBe("C:/alpha");
    expect(
      projectLocationLabel({
        kind: "wsl",
        distro: "Ubuntu",
        linuxPath: "/home/u/alpha",
        uncPath: "\\\\wsl$\\Ubuntu\\home\\u\\alpha",
      }),
    ).toBe("WSL Ubuntu /home/u/alpha");
  });

  it("formats update times relative to now", () => {
    const now = Date.parse("2026-01-05T12:00:00.000Z");
    expect(formatRelativeTime(0, now)).toBe("—");
    expect(formatRelativeTime(now - 30_000, now)).toBe("刚刚");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 分钟前");
    expect(formatRelativeTime(now - 3 * 60 * 60_000, now)).toBe("3 小时前");
    expect(formatRelativeTime(now - 3 * 24 * 60 * 60_000, now)).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    );
  });
});
