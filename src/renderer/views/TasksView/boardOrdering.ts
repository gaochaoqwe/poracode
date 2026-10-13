import {
  normalizeTaskCategory,
  taskColumn,
  type Task,
  type TaskColumn,
  type TaskDraft,
} from "@/shared/contracts";

/** `null` = the "all projects" board (no manual ordering). */
export type BoardProjectFilter = string | null;

/** Narrow the board to one project. Home tasks (`projectId: null`) stay under `null`. */
export function filterByProject(tasks: readonly Task[], filter: BoardProjectFilter): Task[] {
  return filter == null ? [...tasks] : tasks.filter((task) => task.projectId === filter);
}

/**
 * Order one lane. The Todo lane honours manual `sortOrder` only when the board
 * is scoped to a project — across projects the per-project ranks collide, so the
 * unfiltered board stays freshest-first like every other lane.
 */
export function orderLane(
  tasks: readonly Task[],
  column: TaskColumn,
  filter: BoardProjectFilter,
): Task[] {
  const lane = tasks.filter((task) => taskColumn(task.status) === column);
  if (column === "todo" && filter != null) {
    return lane.sort(
      (a, b) => a.sortOrder - b.sortOrder || Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
  }
  return lane.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export interface TaskCardDragData {
  type: "task-card";
  column: TaskColumn;
  taskId: string;
  projectId: string | null;
}

export interface DraftCardDragData {
  type: "task-draft-item";
  draftId: string;
  projectId: string | null;
}

export interface TaskColumnDropData {
  type: "task-column";
  column: TaskColumn;
}

/**
 * Decide what a dropped draft card means: a draft only ever reorders inside its
 * own lane (promotion is an explicit button, never a drag).
 */
export function resolveDraftDrop(params: {
  source?: { data?: unknown; initialIndex?: number; index?: number } | null;
}): { kind: "reorder"; fromIndex: number; toIndex: number } | { kind: "none" } {
  const source = params.source;
  const data = source?.data as Partial<DraftCardDragData> | undefined;
  if (data?.type !== "task-draft-item") return { kind: "none" };
  const fromIndex = source?.initialIndex;
  const toIndex = source?.index;
  if (fromIndex == null || toIndex == null || fromIndex === toIndex) return { kind: "none" };
  return { kind: "reorder", fromIndex, toIndex };
}

export type CardDropResolution =
  | { kind: "start"; taskId: string }
  | { kind: "reorder"; fromIndex: number; toIndex: number }
  | { kind: "none" };

/**
 * Decide what a dropped task card means. Pure so the drag behaviour is testable
 * without a real gesture. A drop on the in-progress column starts the task; a
 * drop onto another Todo card reorders within the lane.
 */
export function resolveCardDrop(params: {
  source?: { data?: unknown; initialIndex?: number; index?: number } | null;
  target?: { data?: unknown } | null;
}): CardDropResolution {
  const source = params.source;
  const sourceData = source?.data as Partial<TaskCardDragData> | undefined;
  if (!sourceData || sourceData.type !== "task-card" || sourceData.column !== "todo") {
    return { kind: "none" };
  }
  const targetData = params.target?.data as Partial<TaskColumnDropData> | undefined;
  if (targetData?.type === "task-column" && targetData.column === "inProgress") {
    return sourceData.taskId ? { kind: "start", taskId: sourceData.taskId } : { kind: "none" };
  }
  const fromIndex = source?.initialIndex;
  const toIndex = source?.index;
  if (fromIndex != null && toIndex != null && fromIndex !== toIndex) {
    return { kind: "reorder", fromIndex, toIndex };
  }
  return { kind: "none" };
}

/** Narrow the draft lane to one project (untagged drafts stay under `null`). */
export function filterDraftsByProject(
  drafts: readonly TaskDraft[],
  filter: BoardProjectFilter,
): TaskDraft[] {
  return filter == null ? [...drafts] : drafts.filter((draft) => draft.projectId === filter);
}

/**
 * Order the draft lane. Like the Todo lane, manual `sortOrder` only means
 * something inside one project; the unfiltered board stays freshest-first.
 */
export function orderDrafts(drafts: readonly TaskDraft[], filter: BoardProjectFilter): TaskDraft[] {
  if (filter != null) {
    return [...drafts].sort(
      (a, b) => a.sortOrder - b.sortOrder || Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
  }
  return [...drafts].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/** Apply a new draft order locally before the round-trip confirms it. */
export function applyOptimisticDraftReorder(
  drafts: readonly TaskDraft[],
  orderedIds: readonly string[],
): TaskDraft[] {
  const rank = new Map(orderedIds.map((id, index) => [id, index]));
  return drafts.map((draft) =>
    rank.has(draft.id) ? { ...draft, sortOrder: rank.get(draft.id)! } : draft,
  );
}

/** Move `items[from]` to `to`, returning a new array (drag index math). */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  const [item] = next.splice(from, 1);
  if (item === undefined) return [...items];
  next.splice(to, 0, item);
  return next;
}

/** Apply a new Todo order locally before the round-trip confirms it. */
export function applyOptimisticReorder(
  tasks: readonly Task[],
  orderedIds: readonly string[],
): Task[] {
  const rank = new Map(orderedIds.map((id, index) => [id, index]));
  return tasks.map((task) =>
    rank.has(task.id) ? { ...task, sortOrder: rank.get(task.id)! } : task,
  );
}

/** One project section inside a category. `projectId: null` is the Home scope. */
export interface TaskProjectGroup {
  projectId: string | null;
  tasks: Task[];
}

/** One category section inside a lane. `category: null` is the uncategorized tray. */
export interface TaskCategoryGroup {
  category: string | null;
  projects: TaskProjectGroup[];
  /** Every task under the category, across its projects. */
  count: number;
}

/** Home (no project) sorts after every named project. */
function compareProject(
  left: string | null,
  right: string | null,
  projectNames: ReadonlyMap<string, string>,
): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const leftName = projectNames.get(left) ?? left;
  const rightName = projectNames.get(right) ?? right;
  return leftName.localeCompare(rightName, undefined, { sensitivity: "base" });
}

/**
 * Split one lane's already-ordered tasks into category sections, each split
 * again by project, preserving the order within every leaf group. Every lane is
 * grouped — status alone no longer reads as a flat list.
 *
 * Named categories sort case-insensitively; the uncategorized tray is always
 * last. Inside a category, named projects sort by display name with Home last.
 */
export function groupLane(
  lane: readonly Task[],
  projectNames: ReadonlyMap<string, string>,
): TaskCategoryGroup[] {
  const buckets = new Map<string | null, Map<string | null, Task[]>>();
  for (const task of lane) {
    const category = normalizeTaskCategory(task.category ?? null);
    const projectId = task.projectId ?? null;
    let projects = buckets.get(category);
    if (!projects) {
      projects = new Map();
      buckets.set(category, projects);
    }
    const bucket = projects.get(projectId);
    if (bucket) bucket.push(task);
    else projects.set(projectId, [task]);
  }
  const named = [...buckets.entries()]
    .filter(([category]) => category !== null)
    .sort(([left], [right]) => left!.localeCompare(right!, undefined, { sensitivity: "base" }))
    .map(([category, projects]) => toGroup(category, projects, projectNames));
  const uncategorized = buckets.get(null);
  return uncategorized ? [...named, toGroup(null, uncategorized, projectNames)] : named;
}

function toGroup(
  category: string | null,
  projects: Map<string | null, Task[]>,
  projectNames: ReadonlyMap<string, string>,
): TaskCategoryGroup {
  const ordered = [...projects.entries()]
    .sort(([left], [right]) => compareProject(left, right, projectNames))
    .map(([projectId, tasks]) => ({ projectId, tasks }));
  return {
    category,
    projects: ordered,
    count: ordered.reduce((total, group) => total + group.tasks.length, 0),
  };
}
