import { create } from "zustand";
import type { FlowStepOwner, ProjectFlowKind } from "./projectFlows";

/**
 * 项目流程图的人工配置 —— 逐项目、逐节点 / 逐连线改写「执行方」，
 * 以及手动指定项目套用哪套流程模板。两者都持久化在 localStorage，
 * 与 `codeReviewStore` 的 `codeViewOpen` 用同一套容错写法。
 *
 * `overrides[projectId][stepId]` = 该步骤的生效执行方；缺省回落到模板默认。
 */

/** projectId → { stepId: owner }。 */
export type ProjectFlowOverrides = Record<string, Record<string, FlowStepOwner>>;
/** projectId → 手动指定的流程类型。 */
export type ProjectFlowKindOverrides = Record<string, ProjectFlowKind>;

const OVERRIDES_KEY = "agentemployee-project-flow-overrides";
const KINDS_KEY = "agentemployee-project-flow-kinds";

function loadJson<T extends object>(key: string): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {} as T;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as T;
  } catch {
    /* ignore */
  }
  return {} as T;
}

function saveJson(key: string, value: object): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export interface ProjectFlowSlice {
  overrides: ProjectFlowOverrides;
  kinds: ProjectFlowKindOverrides;
  /** 设置某个节点 / 连线的执行方；传 undefined 语义由 resetStepOwner 承担。 */
  setStepOwner: (projectId: string, stepId: string, owner: FlowStepOwner) => void;
  /** 手动指定项目套用的流程模板（覆盖推断结果）。 */
  setProjectFlowKind: (projectId: string, kind: ProjectFlowKind) => void;
  /** 清空该项目的全部人工配置，回到模板默认。 */
  resetProjectFlow: (projectId: string) => void;
}

export const useProjectFlowStore = create<ProjectFlowSlice>()((set) => ({
  overrides: loadJson<ProjectFlowOverrides>(OVERRIDES_KEY),
  kinds: loadJson<ProjectFlowKindOverrides>(KINDS_KEY),
  setStepOwner: (projectId, stepId, owner) =>
    set((state) => {
      const current = state.overrides[projectId] ?? {};
      if (current[stepId] === owner) return {};
      const next: ProjectFlowOverrides = {
        ...state.overrides,
        [projectId]: { ...current, [stepId]: owner },
      };
      saveJson(OVERRIDES_KEY, next);
      return { overrides: next };
    }),
  setProjectFlowKind: (projectId, kind) =>
    set((state) => {
      if (state.kinds[projectId] === kind) return {};
      const next: ProjectFlowKindOverrides = { ...state.kinds, [projectId]: kind };
      saveJson(KINDS_KEY, next);
      return { kinds: next };
    }),
  resetProjectFlow: (projectId) =>
    set((state) => {
      const hasOverrides = projectId in state.overrides;
      const hasKind = projectId in state.kinds;
      if (!hasOverrides && !hasKind) return {};
      const nextOverrides: ProjectFlowOverrides = { ...state.overrides };
      delete nextOverrides[projectId];
      const nextKinds: ProjectFlowKindOverrides = { ...state.kinds };
      delete nextKinds[projectId];
      saveJson(OVERRIDES_KEY, nextOverrides);
      saveJson(KINDS_KEY, nextKinds);
      return { overrides: nextOverrides, kinds: nextKinds };
    }),
}));
