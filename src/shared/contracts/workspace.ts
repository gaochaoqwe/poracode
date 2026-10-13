import { z } from "zod";
import { isHomeProjectId } from "../homeScope";
import { scenarioCategorySchema, type ScenarioCategory } from "./scenario";
import { agentKindSchema } from "./common";
import { agentInstanceIdSchema } from "./agentInstance";
import { threadConfigBaseSchema } from "./config";

/**
 * A user-defined grouping of projects (e.g. "Work", "Side Hustle"). Exactly one
 * workspace is active at a time; the sidebar, schedules, and pull-request views
 * only surface projects belonging to it.
 *
 * Distinct from the account/stats "profile" (`./profile.ts`) and from GdsAgent
 * auth profiles (`./agentInstance.ts`) — those describe *who* is running the
 * agent, a workspace describes *which projects* are in view.
 */
export const WORKSPACE_ICON_IDS = [
  "briefcase",
  "rocket",
  "palette",
  "code",
  "building",
  "graduation",
  "heart",
  "sprout",
  "globe",
  "lightbulb",
  "music",
  "gamepad",
] as const;

export const workspaceIconIdSchema = z.enum(WORKSPACE_ICON_IDS);
export type WorkspaceIconId = z.infer<typeof workspaceIconIdSchema>;

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  icon: WorkspaceIconId;
  /**
   * The task domain this workspace represents (docs / code / test / general).
   * Drives which scenario assistants a workspace surfaces by default. Optional
   * and tolerant: a workspace saved before this field existed, or carrying an
   * unknown value, simply has no domain rather than failing validation.
   */
  category?: ScenarioCategory | undefined;
  /** Scenario ids surfaced by default when this workspace is active. */
  defaultScenarioIds?: string[] | undefined;

  /**
   * Digital-employee (岗位) fields. A workspace is one employee role that
   * aggregates a set of capabilities; a scenario/thread is a single task instance
   * that role carries out. All fields are optional and tolerant so older settings
   * files (saved before these fields existed) parse cleanly and simply have no
   * persona/binding rather than failing validation.
   */
  /** The employee's persona / system-role framing ("I am the document writer..."). */
  persona?: string | undefined;
  /** A human-readable list of responsibilities this employee owns. */
  responsibilities?: string[] | undefined;
  /** Ids of /skills this employee masters (job-level capability set). */
  skillIds?: string[] | undefined;
  /** Free-form capability tags surfaced in the employee UI (e.g. "需求文档"). */
  capabilityTags?: string[] | undefined;
  /**
   * Structured capability ids this employee is configured with (see
   * `src/shared/orgCapabilities.ts` registry). The orgflow view renders each
   * configured capability as implemented (system has it) or not (visual hollow /
   * dashed style). Tolerant: absent means "no capability list configured".
   */
  capabilityIds?: string[] | undefined;
  /** Default provider kind this employee is bound to (overridable in composer). */
  agentKind?: string | undefined;
  /** Default agent-instance (auth profile) id this employee runs as. */
  agentInstanceId?: string | undefined;
  /** Default thread config merged into launchConfig when a thread is spawned. */
  defaultThreadConfig?: z.infer<typeof threadConfigBaseSchema> | undefined;
  /**
   * Two-tier role hierarchy (岗位两级体系): a workspace is either a primary
   * category container (no rank / no parent — the four 一级岗位 nav buckets) or
   * a secondary employee with a management rank 1/2/3 and a parent primary id.
   */
  roleRank?: 1 | 2 | 3 | undefined;
  /** Id of the primary (一级) container workspace this secondary employee hangs under. */
  parentWorkspaceId?: string | undefined;
  /**
   * Team entity id this employee belongs to (org-tree "团队" layer: a primary
   * workspace groups teams, teams group employees). Tolerant: absent means the
   * employee is not assigned to a team yet.
   */
  teamId?: string | undefined;
  /** Hide this employee from the org-tree navigation / office / orgflow views. */
  hiddenInNav?: boolean | undefined;
  /** Job-level permission switches mapped to threadConfig's same-named toggles. */
  permissions?:
    | {
        allowComputerUse?: boolean | undefined;
        requireApproval?: boolean | undefined;
        /** Authorized local directory scope for the employee (a Workspace = a role). */
        workspacePaths?: string[] | undefined;
      }
    | undefined;
}

const workspaceInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().min(1),
  icon: workspaceIconIdSchema.optional(),
  // `.catch` matters: the whole workspaces array is parsed in one `safeParse`,
  // so a single malformed value would otherwise reject the list and blank every
  // workspace. A bad domain/dangling id degrades to absent instead.
  category: scenarioCategorySchema.optional().catch(undefined),
  defaultScenarioIds: z.array(z.string()).optional().catch(undefined),
  // Digital-employee fields. All optional + `.catch(undefined)` so older settings
  // (without these keys) and unknown provider values degrade to absent, never
  // reject the whole workspaces list.
  persona: z.string().optional().catch(undefined),
  responsibilities: z.array(z.string()).optional().catch(undefined),
  skillIds: z.array(z.string()).optional().catch(undefined),
  capabilityTags: z.array(z.string()).optional().catch(undefined),
  capabilityIds: z.array(z.string().min(1)).optional().catch(undefined),
  agentKind: agentKindSchema.optional().catch(undefined),
  agentInstanceId: agentInstanceIdSchema.optional().catch(undefined),
  defaultThreadConfig: threadConfigBaseSchema.optional().catch(undefined),
  roleRank: z.coerce
    .number()
    .int()
    .min(1)
    .max(3)
    .transform((n) => n as 1 | 2 | 3)
    .optional()
    .catch(undefined),
  parentWorkspaceId: z.string().min(1).optional().catch(undefined),
  teamId: z.string().min(1).optional().catch(undefined),
  hiddenInNav: z.boolean().optional().catch(undefined),
  permissions: z
    .object({
      allowComputerUse: z.boolean().optional(),
      requireApproval: z.boolean().optional(),
      // Authorized local directory scope for the employee (a Workspace = a role).
      // Empty/absent means no explicit scope is declared (the employee keeps the
      // default spawn location). The supervisor enforces the scope at dispatch
      // time; this is modeling only, never a provider branch.
      workspacePaths: z.array(z.string().min(1)).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});

function firstAvailableWorkspaceIcon(used: ReadonlySet<WorkspaceIconId>): WorkspaceIconId {
  return WORKSPACE_ICON_IDS.find((icon) => !used.has(icon)) ?? WORKSPACE_ICON_IDS[0];
}

function normalizeWorkspaceIcons(
  workspaces: readonly z.output<typeof workspaceInputSchema>[],
): Workspace[] {
  const used = new Set<WorkspaceIconId>();
  return workspaces.map((workspace) => {
    const icon =
      workspace.icon && !used.has(workspace.icon)
        ? workspace.icon
        : firstAvailableWorkspaceIcon(used);
    used.add(icon);
    return { ...workspace, icon };
  });
}

export const workspaceSchema = workspaceInputSchema.transform(
  (workspace): Workspace => normalizeWorkspaceIcons([workspace])[0]!,
);

export const workspaceListSchema = z.array(workspaceInputSchema).transform(normalizeWorkspaceIcons);

/** Names seeded on first run; the first entry starts active and adopts every existing project. */
export const DEFAULT_WORKSPACE_NAMES = [
  "通用任务岗",
  "文档编写岗",
  "软件编码岗",
  "软件测试岗",
] as const;
export const DEFAULT_WORKSPACE_ICONS = [
  "briefcase",
  "palette",
  "code",
  "sprout",
] as const satisfies readonly WorkspaceIconId[];

/**
 * The default set shipped before {@link DEFAULT_WORKSPACE_NAMES} was renamed to
 * the "岗位" (role) naming. Kept only so `bootstrapWorkspaces` can recognize an
 * install that never touched its seeded workspaces and migrate it to the
 * current role names without changing ids/projects.
 */
export const PREVIOUS_DEFAULT_WORKSPACE_NAMES = [
  "通用任务",
  "文档编写",
  "软件编码",
  "软件测试",
] as const;

/**
 * True only when `workspaces` is exactly the untouched pre-rename default seed:
 * the same count and names, in order (icons are ignored so a re-icon doesn't
 * count as a customization). Any user edit (rename, add, delete) makes it
 * false, so a customized setup is never overwritten.
 */
export function isPreviousDefaultWorkspaces(workspaces: readonly { name: string }[]): boolean {
  return (
    workspaces.length === PREVIOUS_DEFAULT_WORKSPACE_NAMES.length &&
    workspaces.every(
      (workspace, index) => workspace.name === PREVIOUS_DEFAULT_WORKSPACE_NAMES[index],
    )
  );
}

/**
 * The default set shipped before {@link DEFAULT_WORKSPACE_NAMES} was renamed. Kept
 * only so `bootstrapWorkspaces` can recognize an install that never touched its
 * seeded workspaces and migrate it to the current defaults.
 */
export const LEGACY_DEFAULT_WORKSPACE_NAMES = ["Work", "Side Hustle"] as const;
export const LEGACY_DEFAULT_WORKSPACE_ICONS = ["briefcase", "rocket"] as const;

/**
 * True only when `workspaces` is exactly the untouched legacy seed: the same
 * count, names, and icons, in order. Any user edit (rename, add, delete,
 * re-icon) makes it false, so a customized setup is never overwritten.
 */
export function isLegacyDefaultWorkspaces(
  workspaces: readonly { name: string; icon: WorkspaceIconId }[],
): boolean {
  return (
    workspaces.length === LEGACY_DEFAULT_WORKSPACE_NAMES.length &&
    workspaces.every(
      (workspace, index) =>
        workspace.name === LEGACY_DEFAULT_WORKSPACE_NAMES[index] &&
        workspace.icon === LEGACY_DEFAULT_WORKSPACE_ICONS[index],
    )
  );
}

/** Pick a distinct identity for a newly-created workspace whenever the palette has room. */
export function nextWorkspaceIconId(workspaces: readonly Workspace[]): WorkspaceIconId {
  return firstAvailableWorkspaceIcon(new Set(workspaces.map((workspace) => workspace.icon)));
}

/**
 * The single membership rule every workspace-scoped surface goes through — the
 * sidebar, the schedules view, and the pull-request view must agree on what "in
 * this workspace" means, or a project's threads and its PRs disagree about
 * whether it exists.
 *
 * A project whose `workspaceId` is absent or points at a workspace that no
 * longer exists stays visible rather than vanishing — losing track of a project
 * is far worse than showing it in the wrong group, and the Workspaces settings
 * section lets the user file it deliberately. Home is synthetic and never filed,
 * so it belongs to every workspace by the same rule — but its *threads* are
 * workspace-scoped individually via the companion rule
 * {@link isThreadInWorkspace}, which the same surfaces must also apply.
 */
/**
 * Shared core of the unfiled rule: an absent tag, or one naming a workspace
 * that no longer exists, stays visible rather than vanishing — losing track of
 * the item is far worse than showing it in the wrong group.
 *
 * `scopeWorkspaceIds`, when given, replaces the plain "is it the active
 * workspace" test with "does the selection cover this workspace". The switcher
 * passes the active 岗位 plus, for a primary (一级) container, every employee
 * hanging under it, so selecting a post shows its posts' work rather than
 * nothing at all. Callers that omit it keep the exact-id rule.
 */
function isUnfiledOrActiveWorkspace(
  assigned: string | undefined,
  activeWorkspaceId: string | null,
  knownWorkspaceIds: ReadonlySet<string>,
  scopeWorkspaceIds?: ReadonlySet<string>,
): boolean {
  if (!assigned || !knownWorkspaceIds.has(assigned)) return true;
  if (scopeWorkspaceIds) return scopeWorkspaceIds.has(assigned);
  return assigned === activeWorkspaceId;
}

export function isProjectInWorkspace(
  project: { id?: string; workspaceId?: string | undefined },
  activeWorkspaceId: string | null,
  knownWorkspaceIds: ReadonlySet<string>,
  scopeWorkspaceIds?: ReadonlySet<string>,
): boolean {
  if (isHomeProjectId(project.id)) return true;
  return isUnfiledOrActiveWorkspace(
    project.workspaceId,
    activeWorkspaceId,
    knownWorkspaceIds,
    scopeWorkspaceIds,
  );
}

/**
 * Companion to {@link isProjectInWorkspace} for individual threads. Threads in
 * real projects always pass — their project decides workspace membership. Home
 * threads carry their own `workspaceId` (the workspace active when they were
 * created) so projectless chats stay local to that workspace instead of
 * cluttering every sidebar. An absent or dangling tag keeps the thread visible
 * everywhere, mirroring the unfiled-project rule above.
 */
export function isThreadInWorkspace(
  thread: { projectId: string; workspaceId?: string | undefined },
  activeWorkspaceId: string | null,
  knownWorkspaceIds: ReadonlySet<string>,
  scopeWorkspaceIds?: ReadonlySet<string>,
): boolean {
  if (!isHomeProjectId(thread.projectId)) return true;
  return isUnfiledOrActiveWorkspace(
    thread.workspaceId,
    activeWorkspaceId,
    knownWorkspaceIds,
    scopeWorkspaceIds,
  );
}
