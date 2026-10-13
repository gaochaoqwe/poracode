import type { PaneLayout } from "../paneLayout";

/**
 * Tabs hosted by the unified Workbench surface. The task board and the office
 * floor used to be two separate top-level views — and the project board used to
 * be a right-hand dock on the code-review side — they now live behind one
 * "Workbench" module whose active `tab` selects the surface. `tasks` stays
 * first so the board is the default landing tab.
 */
export const WORKBENCH_TABS = ["tasks", "projects", "office", "flow", "approvals"] as const;
export type WorkbenchTab = (typeof WORKBENCH_TABS)[number];

export type AppView =
  | { kind: "home" }
  | { kind: "pullRequests" }
  | { kind: "workbench"; tab: WorkbenchTab }
  | { kind: "draft"; projectId: string }
  | { kind: "experiment"; experimentId: string; projectId: string }
  | {
      kind: "thread";
      panes: [string, ...string[]];
      rowLayout?: number[];
      paneLayout?: PaneLayout;
      activeGroupId?: string;
    };

function isWorkbenchTab(value: unknown): value is WorkbenchTab {
  return WORKBENCH_TABS.includes(value as WorkbenchTab);
}

/**
 * Upgrade a persisted view to the current shape.
 *
 * `tasks` and `office` used to be separate view kinds; they were folded into a
 * single `workbench` kind whose `tab` selects the surface. Rows persisted
 * before that merge still carry the old kinds, so map them (and clamp an
 * unknown tab) here instead of bumping the storage version — an unhandled
 * legacy kind would otherwise fall through to Home.
 */
export function normalizeAppView(value: unknown): AppView {
  if (!value || typeof value !== "object") return { kind: "home" };
  const { kind, tab } = value as { kind?: unknown; tab?: unknown };
  if (kind === "tasks") return { kind: "workbench", tab: "tasks" };
  if (kind === "office") return { kind: "workbench", tab: "office" };
  if (kind === "workbench") {
    return { kind: "workbench", tab: isWorkbenchTab(tab) ? tab : "tasks" };
  }
  // Every other kind is already current; per-kind fields are validated where
  // they are consumed.
  return value as AppView;
}
