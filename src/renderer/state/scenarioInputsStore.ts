import { create } from "zustand";

/**
 * In-project source directory chosen for a scenario's `code` input, plus the
 * subset of its immediate subdirectories the user marked as third-party/library
 * code (no requirements/design written for them).
 */
export interface ScenarioCodeSelection {
  dir: string;
  excludedDirs?: string[];
}

interface ScenarioInputsState {
  /** projectId → inputId → selection. Session-only. */
  byProject: Record<string, Record<string, ScenarioCodeSelection | undefined>>;
  /**
   * projectId → chosen output-mode id (see `ScenarioOutputMode`). Absent until
   * the user picks one; the scenario's recommended mode is used meanwhile.
   */
  outputModeByProject: Record<string, string | undefined>;
  setCodeSelection(
    projectId: string,
    inputId: string,
    selection: ScenarioCodeSelection | undefined,
  ): void;
  setOutputMode(projectId: string, modeId: string | undefined): void;
  clearProject(projectId: string): void;
}

export const useScenarioInputsStore = create<ScenarioInputsState>((set) => ({
  byProject: {},
  outputModeByProject: {},
  setCodeSelection: (projectId, inputId, selection) =>
    set((state) => {
      const current = { ...(state.byProject[projectId] ?? {}) };
      if (selection) current[inputId] = selection;
      else delete current[inputId];
      return { byProject: { ...state.byProject, [projectId]: current } };
    }),
  setOutputMode: (projectId, modeId) =>
    set((state) => {
      const next = { ...state.outputModeByProject };
      if (modeId) next[projectId] = modeId;
      else delete next[projectId];
      return { outputModeByProject: next };
    }),
  clearProject: (projectId) =>
    set((state) => {
      const hasSelection = projectId in state.byProject;
      const hasMode = projectId in state.outputModeByProject;
      if (!hasSelection && !hasMode) return state;
      const byProject = { ...state.byProject };
      delete byProject[projectId];
      const outputModeByProject = { ...state.outputModeByProject };
      delete outputModeByProject[projectId];
      return { byProject, outputModeByProject };
    }),
}));

/** Narrow selector for one project's `code` selection of one input. */
export function useScenarioCodeSelection(
  projectId: string,
  inputId: string,
): ScenarioCodeSelection | undefined {
  return useScenarioInputsStore((state) => state.byProject[projectId]?.[inputId]);
}
