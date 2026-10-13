import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  DEFAULT_WORKSPACE_ICONS,
  DEFAULT_WORKSPACE_NAMES,
  isLegacyDefaultWorkspaces,
  isPreviousDefaultWorkspaces,
  type Workspace,
} from "@/shared/contracts";
import {
  DEFAULT_SCENARIO_IDS_BY_CATEGORY,
  DEFAULT_WORKSPACE_CATEGORIES,
} from "@/renderer/scenarios/catalog";
import { useAppStore } from "./appStore";
import { useSharedSettings, whenSharedSettingsHydrated } from "./sharedSettingsStore";
import { workspaceScopeIds } from "./workspaceHierarchy";

const PERSIST_KEY = "agentemployee-active-workspace";

/** Key for projects picked while no workspace exists yet (fresh install). */
const NO_WORKSPACE_KEY = "";

/**
 * Digital-employee (岗位) seed personas for the built-in default workspaces, in
 * `DEFAULT_WORKSPACE_NAMES` order (通用任务 / 文档编写 / 软件编码 / 软件测试).
 * Only persona + capability tags are seeded; provider/model binding is left for
 * the user to choose in the workspace editor so we never assume an install has a
 * particular provider configured.
 */
const DEFAULT_WORKSPACE_PERSONAS: readonly { persona: string; capabilityTags: string[] }[] = [
  {
    persona:
      "我是「通用任务岗」岗位员工。我能接手各类日常任务：起草文档、整理表格、制作幻灯片、操控桌面应用，遇到不确定的目标会先向你澄清再动手。",
    capabilityTags: ["通用", "文档", "表格", "演示"],
  },
  {
    persona:
      "我是「文档编写岗」岗位员工。我擅长编写需求规格说明、设计文档、影响分析报告等软件工程文档，追求结构清晰、术语准确、可评审、可追溯。",
    capabilityTags: ["需求文档", "设计文档", "影响分析", "评审"],
  },
  {
    persona:
      "我是「软件编码岗」岗位员工。我负责项目脚手架搭建、代码编写与修改、缺陷修复、代码评审与重构、单元测试编写，遵循仓库规范并保持改动范围克制。",
    capabilityTags: ["编码", "重构", "缺陷修复", "代码评审", "单元测试"],
  },
  {
    persona:
      "我是「软件测试岗」岗位员工。我负责文档评审、静态分析、代码评审与测试用例生成，关注覆盖率、边界与可追溯性，为交付质量把关。",
    capabilityTags: ["文档评审", "静态分析", "代码评审", "测试用例"],
  },
];

interface WorkspaceUiState {
  /**
   * Which workspace this window is looking at. Deliberately *not* part of
   * `sharedSettings`, which is a single file shared by every window on the
   * device — switching in one window must not yank the others along with it.
   */
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (workspaceId: string | null) => void;
  /**
   * The project last deliberately picked while each workspace was active, keyed
   * by workspace id, so a new thread started with no explicit target resumes
   * that workspace's own work instead of whatever project happens to sit first
   * in the store. Entries for deleted workspaces/projects are left in place;
   * readers validate the id against the live project list, which is cheaper and
   * safer than pruning on every deletion path.
   */
  lastProjectIdByWorkspace: Record<string, string>;
  rememberProjectForWorkspace: (workspaceId: string | null, projectId: string) => void;
}

export const useWorkspaceStore = create<WorkspaceUiState>()(
  persist(
    (set) => ({
      activeWorkspaceId: null,
      setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId }),
      lastProjectIdByWorkspace: {},
      rememberProjectForWorkspace: (workspaceId, projectId) =>
        set((state) => ({
          lastProjectIdByWorkspace: {
            ...state.lastProjectIdByWorkspace,
            [workspaceId ?? NO_WORKSPACE_KEY]: projectId,
          },
        })),
    }),
    {
      name: PERSIST_KEY,
      // Still version 1: `lastProjectIdByWorkspace` is purely additive, and
      // persist's shallow merge leaves the `{}` default in place for payloads
      // written before it existed. A v1 payload stays valid, so bumping would
      // only throw away the user's active workspace for no gain.
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/** Record a deliberate project pick as the active workspace's default target. */
export function rememberWorkspaceProject(projectId: string): void {
  useWorkspaceStore.getState().rememberProjectForWorkspace(getActiveWorkspaceId(), projectId);
}

/** The project a fresh draft should prefer for the active workspace, if any. */
export function getLastWorkspaceProjectId(): string | undefined {
  const byWorkspace = useWorkspaceStore.getState().lastProjectIdByWorkspace ?? {};
  return byWorkspace[getActiveWorkspaceId() ?? NO_WORKSPACE_KEY];
}

/**
 * The workspace actually in effect: the stored id when it still resolves,
 * otherwise the user's default workspace, otherwise the first workspace. A
 * stale id (workspace deleted on another device) — or a dangling default — must
 * not blank the sidebar.
 */
export function resolveActiveWorkspaceId(
  workspaces: readonly { id: string }[],
  storedId: string | null,
  defaultId: string | null = null,
): string | null {
  if (workspaces.length === 0) return null;
  if (storedId && workspaces.some((workspace) => workspace.id === storedId)) return storedId;
  if (defaultId && workspaces.some((workspace) => workspace.id === defaultId)) return defaultId;
  return workspaces[0]!.id;
}

export function useActiveWorkspaceId(): string | null {
  const workspaces = useSharedSettings((state) => state.workspaces);
  const defaultWorkspaceId = useSharedSettings((state) => state.defaultWorkspaceId);
  const storedId = useWorkspaceStore((state) => state.activeWorkspaceId);
  return resolveActiveWorkspaceId(workspaces, storedId, defaultWorkspaceId);
}

export function getActiveWorkspaceId(): string | null {
  return resolveActiveWorkspaceId(
    // `?? []` guards partially-stubbed stores in tests; production settings
    // always carry the key via `defaultSharedSettings`.
    useSharedSettings.getState().workspaces ?? [],
    useWorkspaceStore.getState().activeWorkspaceId,
    useSharedSettings.getState().defaultWorkspaceId ?? null,
  );
}

export function getKnownWorkspaceIds(): ReadonlySet<string> {
  return new Set((useSharedSettings.getState().workspaces ?? []).map((workspace) => workspace.id));
}

/**
 * Ids the *active* workspace selection covers for membership tests — the
 * workspace itself, plus every employee under it when a primary (一级) 岗位
 * container is active (see {@link workspaceScopeIds}). Non-React twin of the
 * selector used by the sidebar, so actions and views can never drift.
 */
export function getActiveWorkspaceScopeIds(): ReadonlySet<string> {
  return workspaceScopeIds(
    // `?? []` guards partially-stubbed stores in tests (see `getActiveWorkspaceId`).
    useSharedSettings.getState().workspaces ?? [],
    getActiveWorkspaceId(),
  );
}

/**
 * Seed the default workspaces on first run and file every pre-existing project
 * into the first one, so an install that predates workspaces opens showing
 * exactly what it showed before. An install still carrying the retired default
 * names is migrated to the current defaults instead.
 *
 * Idempotent: does nothing once any workspace exists (beyond the one-time
 * legacy-default migration and stale-active repair).
 */
export async function bootstrapWorkspaces(): Promise<void> {
  await whenSharedSettingsHydrated();
  const settings = useSharedSettings.getState();
  const existing = settings.workspaces ?? [];
  if (existing.length > 0) {
    // An install that never touched its seeded workspaces still carries the
    // retired default names; bring it onto the current defaults so the rename
    // is actually visible. A customized list is left exactly as it is.
    if (isLegacyDefaultWorkspaces(existing)) {
      migrateLegacyDefaultWorkspaces(existing, settings);
      return;
    }
    // An install seeded under the pre-rename names (通用任务 / 文档编写 / …)
    // still carries them; migrate those untouched default sets to the "岗位"
    // naming in place (same ids/projects) so the rename is visible.
    if (isPreviousDefaultWorkspaces(existing)) {
      const migrated = migrateDefaultWorkspaceNames(existing);
      if (migrated) settings.setWorkspaces(migrated);
    }
    // An install seeded before workspaces carried a domain / default scenario
    // list keeps them undefined, so every workspace surfaces the whole catalog.
    // Fill them in for an untouched default set (by name), leaving a
    // customized one — and any field the user has set — alone.
    if (isUntouchedDefaultWorkspaces(existing)) {
      const backfilled = backfillDefaultWorkspaceScenarios(existing);
      if (backfilled) settings.setWorkspaces(backfilled);
    }
    // Already seeded. Still make sure this window points somewhere real.
    const resolved = resolveActiveWorkspaceId(
      existing,
      useWorkspaceStore.getState().activeWorkspaceId,
      settings.defaultWorkspaceId,
    );
    if (resolved !== useWorkspaceStore.getState().activeWorkspaceId) {
      useWorkspaceStore.getState().setActiveWorkspaceId(resolved);
    }
    return;
  }

  // Seed in a single write: every `addWorkspace` call would serialize the whole
  // settings object to localStorage and fire its own IPC write.
  const seeded = buildDefaultWorkspaces();
  settings.setWorkspaces(seeded);

  const primary = seeded[0]!;
  useAppStore.getState().refileProjects(undefined, primary.id);
  // No stored id on a fresh seed, so the user's default workspace wins here.
  useWorkspaceStore
    .getState()
    .setActiveWorkspaceId(resolveActiveWorkspaceId(seeded, null, settings.defaultWorkspaceId));
}

/**
 * True when the set of workspace names is exactly the current default names —
 * i.e. the user never renamed one. Order-independent so a reordered default set
 * still counts. Mirrors {@link isLegacyDefaultWorkspaces}, but for the *current*
 * seed names rather than the retired ones.
 */
function isUntouchedDefaultWorkspaces(workspaces: readonly Workspace[]): boolean {
  if (workspaces.length !== DEFAULT_WORKSPACE_NAMES.length) return false;
  const names = new Set(workspaces.map((workspace) => workspace.name));
  return (
    names.size === DEFAULT_WORKSPACE_NAMES.length &&
    DEFAULT_WORKSPACE_NAMES.every((name) => names.has(name))
  );
}

/**
 * Give the seeded default workspaces the domain, default scenarios, and employee
 * (岗位) persona that were added after this install was first seeded. The
 * category is resolved by name, so a reordered set still maps correctly. Each
 * field is filled only when the workspace is missing it, so a workspace the user
 * has re-scoped (its own domain, scenario list, or persona) is left alone.
 * Returns null when nothing needs writing.
 */
function backfillDefaultWorkspaceScenarios(workspaces: readonly Workspace[]): Workspace[] | null {
  let changed = false;
  const next = workspaces.map((workspace) => {
    const index = DEFAULT_WORKSPACE_NAMES.indexOf(
      workspace.name as (typeof DEFAULT_WORKSPACE_NAMES)[number],
    );
    if (index === -1) return workspace;
    const category = DEFAULT_WORKSPACE_CATEGORIES[index] ?? "general";
    const currentDefaultIds = DEFAULT_SCENARIO_IDS_BY_CATEGORY[category];
    const seededPersona = DEFAULT_WORKSPACE_PERSONAS[index];
    const needsDomain =
      workspace.category === undefined && workspace.defaultScenarioIds === undefined;
    // A default-named workspace that still sits on its default category but was
    // seeded before a scenario was added to that category's default list gets
    // the newly-introduced ids appended. Additive only — never removes a choice
    // the user made, and never touches a workspace the user re-scoped (a changed
    // category or a fully custom list).
    const existingIds = workspace.defaultScenarioIds;
    const needsNewDefaultIds =
      existingIds !== undefined &&
      workspace.category === category &&
      currentDefaultIds.some((id) => !existingIds.includes(id));
    const needsPersona = workspace.persona === undefined && seededPersona !== undefined;
    if (!needsDomain && !needsNewDefaultIds && !needsPersona) return workspace;
    changed = true;
    return {
      ...workspace,
      ...(needsDomain
        ? {
            category,
            // Omit when empty so the workspace keeps showing every scenario.
            ...(currentDefaultIds.length > 0 ? { defaultScenarioIds: [...currentDefaultIds] } : {}),
          }
        : {}),
      ...(needsNewDefaultIds
        ? {
            defaultScenarioIds: [
              ...existingIds,
              ...currentDefaultIds.filter((id) => !existingIds.includes(id)),
            ],
          }
        : {}),
      ...(needsPersona
        ? {
            persona: seededPersona!.persona,
            capabilityTags: [...seededPersona!.capabilityTags],
          }
        : {}),
    };
  });
  return changed ? next : null;
}

/** Build one fresh instance of the current default workspaces. */
function buildDefaultWorkspaces(): Workspace[] {
  const createdAt = new Date().toISOString();
  return DEFAULT_WORKSPACE_NAMES.map((name, index) => {
    const category = DEFAULT_WORKSPACE_CATEGORIES[index] ?? "general";
    const defaultScenarioIds = DEFAULT_SCENARIO_IDS_BY_CATEGORY[category];
    const seededPersona = DEFAULT_WORKSPACE_PERSONAS[index];
    return {
      id: crypto.randomUUID(),
      name,
      createdAt,
      icon: DEFAULT_WORKSPACE_ICONS[index]!,
      category,
      // Omit when empty so the workspace falls back to showing every scenario
      // (an explicit empty array would mean "show none").
      ...(defaultScenarioIds.length > 0 ? { defaultScenarioIds: [...defaultScenarioIds] } : {}),
      ...(seededPersona
        ? {
            persona: seededPersona.persona,
            capabilityTags: [...seededPersona.capabilityTags],
          }
        : {}),
    };
  });
}

/**
 * Replace an untouched legacy default set (Work / Side Hustle) with the current
 * defaults. Projects and the per-workspace "last project" memory follow the old
 * workspace at the same index into its replacement, so work does not silently
 * fall out of view; the extra new workspaces start empty.
 */
function migrateLegacyDefaultWorkspaces(
  existing: readonly Workspace[],
  settings: ReturnType<typeof useSharedSettings.getState>,
): void {
  const previousActiveId = resolveActiveWorkspaceId(
    existing,
    useWorkspaceStore.getState().activeWorkspaceId,
    settings.defaultWorkspaceId,
  );
  const seeded = buildDefaultWorkspaces();
  settings.setWorkspaces(seeded);

  const targetIdByOldId = new Map<string, string>();
  existing.forEach((workspace, index) => {
    const target = seeded[Math.min(index, seeded.length - 1)]!;
    targetIdByOldId.set(workspace.id, target.id);
    useAppStore.getState().refileProjects(workspace.id, target.id);
  });

  const { lastProjectIdByWorkspace } = useWorkspaceStore.getState();
  const remappedLastProject: Record<string, string> = {};
  for (const [workspaceId, projectId] of Object.entries(lastProjectIdByWorkspace ?? {})) {
    remappedLastProject[targetIdByOldId.get(workspaceId) ?? workspaceId] = projectId;
  }

  const activeIndex = existing.findIndex((workspace) => workspace.id === previousActiveId);
  useWorkspaceStore.setState({
    activeWorkspaceId: seeded[Math.max(0, activeIndex)]!.id,
    lastProjectIdByWorkspace: remappedLastProject,
  });
}

/**
 * Rename an untouched pre-rename default set (通用任务 / 文档编写 / …) to the
 * current "岗位" names (通用任务岗 / 文档编写岗 / …) *in place* — ids, icons,
 * projects and per-workspace memory are all preserved, only the display name
 * (and any persona text that still uses the old name) is updated. Returns null
 * when nothing needs writing.
 */
function migrateDefaultWorkspaceNames(workspaces: readonly Workspace[]): Workspace[] | null {
  let changed = false;
  const next = workspaces.map((workspace, index) => {
    const newName = DEFAULT_WORKSPACE_NAMES[index];
    const oldName = workspace.name;
    if (!newName || oldName === newName) return workspace;
    // Refresh the seeded persona text (which embeds the role name) only when it
    // still matches the old default; a user-edited persona is left alone.
    const seededPersona = DEFAULT_WORKSPACE_PERSONAS[index];
    const persona =
      workspace.persona !== undefined &&
      workspace.persona.includes(`「${oldName}」`) &&
      seededPersona !== undefined
        ? seededPersona.persona
        : workspace.persona;
    changed = true;
    return { ...workspace, name: newName, ...(persona !== undefined ? { persona } : {}) };
  });
  return changed ? next : null;
}
