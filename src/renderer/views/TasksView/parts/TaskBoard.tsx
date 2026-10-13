import { DragDropProvider, type DragEndEvent } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { useLingui } from "@lingui/react/macro";
import { GripVertical } from "lucide-react";
import type { Task, TaskColumn as TaskColumnId, TaskDraft } from "@/shared/contracts";
import {
  filterByProject,
  filterDraftsByProject,
  groupLane,
  moveItem,
  orderDrafts,
  orderLane,
  resolveCardDrop,
  resolveDraftDrop,
  type BoardProjectFilter,
} from "../boardOrdering";
import { BoardGroupSection } from "./BoardGroupSection";
import { DraftCard, type DraftCardHandlers } from "./DraftCard";
import { TaskCard, type TaskCardHandlers } from "./TaskCard";
import { TaskColumn } from "./TaskColumn";

const COLUMN_IDS: readonly TaskColumnId[] = ["todo", "inProgress", "attention", "done"];

interface TaskBoardProps {
  tasks: Task[];
  drafts: TaskDraft[];
  /** The draft lane is opt-in (off by default), so it isn't in COLUMN_IDS. */
  showDrafts: boolean;
  projectNames: Map<string, string>;
  /** Employee id → display name, so cards can show their assignee. */
  employeeNames: Map<string, string>;
  projectFilter: BoardProjectFilter;
  /** Manual reordering is offered only when the board is scoped to a project. */
  reorderEnabled: boolean;
  handlersFor: (task: Task) => TaskCardHandlers;
  draftHandlersFor: (draft: TaskDraft) => DraftCardHandlers;
  onStartTask: (taskId: string) => void;
  onReorderTodo: (orderedIds: string[]) => void;
  onReorderDrafts: (orderedIds: string[]) => void;
}

/**
 * The lanes. Grouping, ordering and drag interpretation come from the shared
 * pure helpers in `boardOrdering`, so nothing here re-derives them.
 */
export function TaskBoard(props: TaskBoardProps) {
  const { t } = useLingui();
  const visible = filterByProject(props.tasks, props.projectFilter);
  const groups: Record<TaskColumnId, Task[]> = {
    todo: orderLane(visible, "todo", props.projectFilter),
    inProgress: orderLane(visible, "inProgress", props.projectFilter),
    attention: orderLane(visible, "attention", props.projectFilter),
    done: orderLane(visible, "done", props.projectFilter),
  };
  const drafts = orderDrafts(
    filterDraftsByProject(props.drafts, props.projectFilter),
    props.projectFilter,
  );
  const projectNameFor = (task: Task) =>
    task.projectId ? (props.projectNames.get(task.projectId) ?? null) : null;
  const employeeNameFor = (task: Task) =>
    task.employeeId ? (props.employeeNames.get(task.employeeId) ?? null) : null;
  const projectLabelFor = (projectId: string | null) =>
    projectId ? (props.projectNames.get(projectId) ?? t`Unavailable project`) : t`Home`;

  function renderTask(task: Task, columnId: TaskColumnId) {
    // The drag index is the task's position within its lane, so reordering
    // stays lane-wide even inside a group.
    const index = groups[columnId].indexOf(task);
    return columnId === "todo" ? (
      <SortableTodoCard
        key={task.id}
        task={task}
        projectName={projectNameFor(task)}
        employeeName={employeeNameFor(task)}
        index={index}
        enabled={props.reorderEnabled}
        {...props.handlersFor(task)}
      />
    ) : (
      <TaskCard
        key={task.id}
        task={task}
        projectName={projectNameFor(task)}
        employeeName={employeeNameFor(task)}
        {...props.handlersFor(task)}
      />
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    if (event.canceled) return;
    // Draft cards only ever reorder within their own lane.
    const draftResolution = resolveDraftDrop({ source: event.operation.source });
    if (draftResolution.kind === "reorder") {
      const ordered = moveItem(drafts, draftResolution.fromIndex, draftResolution.toIndex);
      props.onReorderDrafts(ordered.map((draft) => draft.id));
      return;
    }
    const resolution = resolveCardDrop({
      source: event.operation.source,
      target: event.operation.target,
    });
    if (resolution.kind === "start") {
      props.onStartTask(resolution.taskId);
      return;
    }
    if (resolution.kind === "reorder") {
      const ordered = moveItem(groups.todo, resolution.fromIndex, resolution.toIndex);
      props.onReorderTodo(ordered.map((task) => task.id));
    }
  }

  const labels: Record<TaskColumnId, string> = {
    todo: t`Todo`,
    inProgress: t`In progress`,
    attention: t`Needs you`,
    done: t`Done`,
  };
  const emptyLabels: Record<TaskColumnId, string> = {
    todo: t`No tasks waiting`,
    inProgress: t`Nothing running`,
    attention: t`Nothing needs you right now`,
    done: t`Nothing finished yet`,
  };
  const columnCount = COLUMN_IDS.length + (props.showDrafts ? 1 : 0);
  // `minmax(0,1fr)` — not a bare `1fr` — so a lane can shrink below its
  // content's intrinsic width. Grid tracks default to a `min-content` floor,
  // and the card's text plus `min-w-[18rem]` would then hold every lane at
  // 288px, overflowing the board as soon as the window is narrower than
  // columns × 288px. With the 0 floor the lanes shrink instead, and the cards
  // wrap their text inside them.
  const gridClass =
    columnCount >= 5
      ? "grid-cols-[repeat(5,minmax(0,1fr))]"
      : columnCount === 4
        ? "grid-cols-[repeat(4,minmax(0,1fr))]"
        : "grid-cols-[repeat(3,minmax(0,1fr))]";

  return (
    <div className="min-h-0 flex-1 overflow-x-auto px-4 pb-4 pt-2">
      <DragDropProvider onDragEnd={handleDragEnd}>
        <div className={`grid h-full items-start gap-4 ${gridClass}`}>
          {props.showDrafts ? (
            <TaskColumn
              columnId="draft"
              label={t`Drafts`}
              count={drafts.length}
              emptyLabel={t`No ideas parked`}
            >
              {drafts.map((draft, index) => (
                <SortableDraftCard
                  key={draft.id}
                  draft={draft}
                  employeeName={
                    draft.employeeId ? (props.employeeNames.get(draft.employeeId) ?? null) : null
                  }
                  index={index}
                  enabled={props.reorderEnabled}
                  {...props.draftHandlersFor(draft)}
                />
              ))}
            </TaskColumn>
          ) : null}
          {COLUMN_IDS.map((id) => {
            const sections = groupLane(groups[id], props.projectNames);
            return (
              <TaskColumn
                key={id}
                columnId={id}
                label={labels[id]}
                count={groups[id].length}
                emptyLabel={emptyLabels[id]}
                dropEnabled={id === "inProgress" && props.reorderEnabled}
              >
                {sections.map((section) => (
                  <BoardGroupSection
                    key={section.category ?? "__uncategorized__"}
                    variant="category"
                    label={section.category ?? t`Uncategorized`}
                    count={section.count}
                  >
                    {section.projects.map((project) => (
                      <BoardGroupSection
                        key={project.projectId ?? "__home__"}
                        variant="project"
                        label={projectLabelFor(project.projectId)}
                        count={project.tasks.length}
                      >
                        {project.tasks.map((task) => renderTask(task, id))}
                      </BoardGroupSection>
                    ))}
                  </BoardGroupSection>
                ))}
              </TaskColumn>
            );
          })}
        </div>
      </DragDropProvider>
    </div>
  );
}

interface SortableDraftCardProps extends DraftCardHandlers {
  draft: TaskDraft;
  employeeName: string | null;
  index: number;
  enabled: boolean;
}

/** A draft wrapped in a sortable node, mirroring {@link SortableTodoCard}. */
function SortableDraftCard(props: SortableDraftCardProps) {
  const { t } = useLingui();
  const { ref, handleRef, isDragging } = useSortable({
    id: `task-draft:${props.draft.id}`,
    index: props.index,
    type: "task-draft-item",
    accept: ["task-draft-item"],
    group: "task-draft",
    data: {
      type: "task-draft-item",
      draftId: props.draft.id,
      projectId: props.draft.projectId ?? null,
    },
    disabled: !props.enabled,
  });
  return (
    <div ref={ref} className={isDragging ? "opacity-40" : undefined}>
      <DraftCard
        draft={props.draft}
        employeeName={props.employeeName}
        {...(props.enabled
          ? {
              leading: (
                <button
                  ref={handleRef}
                  type="button"
                  aria-label={t`Reorder draft`}
                  className="-ml-1 mt-0.5 flex h-5 w-4 shrink-0 cursor-grab items-center justify-center text-muted/40 hover:text-muted active:cursor-grabbing"
                >
                  <GripVertical className="size-3.5" aria-hidden="true" />
                </button>
              ),
            }
          : {})}
        onPromote={props.onPromote}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
      />
    </div>
  );
}

interface SortableTodoCardProps extends TaskCardHandlers {
  task: Task;
  projectName: string | null;
  employeeName: string | null;
  index: number;
  enabled: boolean;
}

/**
 * A todo card wrapped in a sortable node. Kept as its own component so
 * `useSortable` (a hook) is never called conditionally — the other lanes render
 * a plain `TaskCard`.
 */
function SortableTodoCard(props: SortableTodoCardProps) {
  const { t } = useLingui();
  const { ref, handleRef, isDragging } = useSortable({
    id: `task-card:${props.task.id}`,
    index: props.index,
    type: "task-card",
    accept: ["task-card"],
    group: "task-todo",
    data: {
      type: "task-card",
      column: "todo",
      taskId: props.task.id,
      projectId: props.task.projectId ?? null,
    },
    disabled: !props.enabled,
  });
  return (
    <div ref={ref} className={isDragging ? "opacity-40" : undefined}>
      <TaskCard
        task={props.task}
        projectName={props.projectName}
        employeeName={props.employeeName}
        {...(props.enabled
          ? {
              leading: (
                <button
                  ref={handleRef}
                  type="button"
                  aria-label={t`Reorder task`}
                  className="-ml-1 mt-0.5 flex h-5 w-4 shrink-0 cursor-grab items-center justify-center text-muted/40 hover:text-muted active:cursor-grabbing"
                >
                  <GripVertical className="size-3.5" aria-hidden="true" />
                </button>
              ),
            }
          : {})}
        onStart={props.onStart}
        onStop={props.onStop}
        onOpenSession={props.onOpenSession}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
      />
    </div>
  );
}
