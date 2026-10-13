import { useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { ListTodo, Loader2, Plus, SlidersHorizontal, StickyNote } from "lucide-react";
import { collectTaskCategories, type Task, type TaskDraft } from "@/shared/contracts";
import { isHomeProject } from "@/shared/homeScope";
import { readBridge } from "@/renderer/bridge";
import { ConfirmDialog, Select } from "@/renderer/components/common";
import {
  createTask,
  deleteTask,
  openTaskSession,
  reorderTasks,
  startTask,
  stopTask,
  updateTask,
} from "@/renderer/actions/taskActions";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useTaskDraftsStore } from "@/renderer/state/taskDraftsStore";
import { useTasksStore } from "@/renderer/state/tasksStore";
import { deleteTaskDraft } from "@/renderer/actions/taskDraftActions";
import { applyOptimisticReorder } from "./boardOrdering";
import { employeeBinding, partitionEmployees, type EmployeeBinding } from "./employeeBinding";
import { DraftEditorDialog } from "./parts/DraftEditorDialog";
import { TaskBoard } from "./parts/TaskBoard";
import { TaskDetailDialog } from "./parts/TaskDetailDialog";
import { TaskEditorDialog } from "./parts/TaskEditorDialog";
import { TaskProjectSettingsDialog } from "./parts/TaskProjectSettingsDialog";
import type { TaskCardHandlers } from "./parts/TaskCard";
import { newTaskDraft, taskDraftFromTask, taskDraftInput, type TaskDraftForm } from "./taskDraft";
import { useTaskDrafts } from "./useTaskDrafts";

/** The board refetches on this cadence so scheduled runs started by main show up. */
const POLL_INTERVAL_MS = 4_000;

/** Sentinel for the project filter's "no filter" option (Radix reserves ""). */
const ALL_PROJECTS = "__all__";

/**
 * The task board page. Hosted as a Workbench tab by default (`embedded`), which
 * drops its own title block — the workbench tab strip already names it. The
 * action row (drafts, project filter, new task) stays in both modes.
 */
export function TasksView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLingui();
  const tasks = useTasksStore((state) => state.tasks);
  const loading = useTasksStore((state) => state.loading);
  const projects = useAppStore((state) => state.projects);
  const workspaces = useSharedSettings((state) => state.workspaces);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskDraftForm | null>(null);
  // Set while the task editor was opened from a draft, so a successful save
  // also retires the source draft.
  const [promoteDraftId, setPromoteDraftId] = useState<string | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);

  // Employees own the provider/model binding, so the editor offers employees
  // rather than raw agents. "Runnable" ones can take a task now; "blocked" ones
  // are shown disabled so the user learns the employee needs an agent first.
  const employeeOptions = partitionEmployees(workspaces);
  const employeeBindings: ReadonlyMap<string, EmployeeBinding> = new Map(
    employeeOptions.runnable.flatMap((employee) => {
      const binding = employeeBinding(employee);
      return binding ? [[employee.id, binding] as const] : [];
    }),
  );
  const employeeNames = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
  const drafts = useTaskDrafts({ projectFilter, onPromoteDraft: openTaskFromDraft });
  // Free-text categories harvested from everything on the board, offered back as
  // suggestions in the editors — this is what makes categories "custom" without
  // a separate management screen.
  const knownCategories = collectTaskCategories([...tasks, ...drafts.drafts]);

  useEffect(() => {
    const refreshAll = () => {
      void useTasksStore.getState().refresh();
      void useTaskDraftsStore.getState().refresh();
    };
    refreshAll();
    // Immediate refresh when one of OUR threads changes state; the interval
    // below is the safety net for runs main started on its own (scheduled).
    let timer: number | null = null;
    const schedule = () => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        refreshAll();
      }, 250);
    };
    const unsubscribe = readBridge().onSupervisorEvent((event) => {
      if (event.type !== "thread-state") return;
      const tracked = useTasksStore
        .getState()
        .tasks.some((task) => task.threadId === event.threadId);
      if (tracked) schedule();
    });
    const interval = window.setInterval(refreshAll, POLL_INTERVAL_MS);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  // The detail dialog renders the LIVE row so status flips update in place.
  const detailTask = tasks.find((task) => task.id === detailTaskId) ?? null;
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));

  /** Runs a mutation, surfacing any failure; true when it actually landed. */
  async function act(fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      await fn();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
      await useTasksStore.getState().refresh();
    }
  }

  function handlersFor(task: Task): TaskCardHandlers {
    return {
      onStart: () => void act(() => startTask(task.id)),
      onStop: () => void act(() => stopTask(task.id)),
      onEdit: () => setDraft(taskDraftFromTask(task)),
      onDelete: () => setDeleteTarget(task),
      onOpenSession: () => {
        if (!openTaskSession(task)) {
          setError(t`That run's conversation is no longer available.`);
        }
      },
    };
  }

  async function saveDraft(): Promise<void> {
    if (!draft) return;
    // An existing task keeps its stored binding as a fallback, so re-saving an
    // old task whose employee was deleted doesn't wipe its provider.
    const current = draft.id ? tasks.find((task) => task.id === draft.id) : undefined;
    const fallback =
      current?.agentKind && current.config.model
        ? {
            agentKind: current.agentKind,
            model: current.config.model,
            ...(current.config.effort !== undefined ? { effort: current.config.effort } : {}),
            ...(current.config.fast !== undefined ? { fast: current.config.fast } : {}),
          }
        : undefined;
    const input = taskDraftInput(draft, employeeBindings, fallback);
    const promoteId = promoteDraftId;
    const isNewTask = !draft.id;
    const ok = await act(async () => {
      if (draft.id) await updateTask(draft.id, input);
      else await createTask(input);
    });
    setDraft(null);
    setPromoteDraftId(null);
    // A promoted draft is dropped only once its task actually landed; a failed
    // create leaves the idea on the board.
    if (ok && isNewTask && promoteId) {
      void deleteTaskDraft(promoteId).finally(() => {
        void useTaskDraftsStore.getState().refresh();
      });
    }
  }

  // Optimistic: the lane reorders immediately, then main's dense order (or the
  // rejection, when the board changed mid-drag) is reconciled.
  async function reorderTodo(orderedIds: string[]): Promise<void> {
    const projectId = projectFilter;
    if (projectId == null) return;
    useTasksStore
      .getState()
      .setTasks(applyOptimisticReorder(useTasksStore.getState().tasks, orderedIds));
    try {
      useTasksStore.getState().setTasks(await reorderTasks(projectId, orderedIds));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await useTasksStore.getState().refresh();
    }
  }

  /** A base task-editor form seeded from one project's saved defaults. */
  function seedTaskDraftForm(projectId: string | null, employeeId?: string): TaskDraftForm {
    const project = projectId
      ? projects.find((candidate) => candidate.id === projectId)
      : undefined;
    const settings = project?.taskSettings;
    // Prefer the saved default employee when it can still run, then an explicit
    // request, then the only runnable employee (so the common single-employee
    // setup never makes the user pick).
    const savedEmployeeId =
      settings?.employeeId && employeeBindings.has(settings.employeeId)
        ? settings.employeeId
        : undefined;
    const fallbackEmployeeId =
      employeeId && employeeBindings.has(employeeId)
        ? employeeId
        : (savedEmployeeId ??
          (employeeOptions.runnable.length === 1 ? employeeOptions.runnable[0]!.id : ""));
    return newTaskDraft({
      projectId,
      ...(settings ? { settings } : {}),
      employeeId: fallbackEmployeeId,
    });
  }

  /** Open the New-task editor, seeded from the filtered project's defaults. */
  function openNewTask(): void {
    setPromoteDraftId(null);
    setDraft(seedTaskDraftForm(projectFilter));
  }

  /** Promote a draft: open the task editor with its idea carried over. */
  function openTaskFromDraft(draftEntry: TaskDraft): void {
    const base = seedTaskDraftForm(
      draftEntry.projectId ?? null,
      draftEntry.employeeId ?? undefined,
    );
    setPromoteDraftId(draftEntry.id);
    setDraft({
      ...base,
      title: draftEntry.title,
      prompt: draftEntry.note ?? "",
      category: draftEntry.category ?? "",
    });
  }

  const hasAnyTask = tasks.length > 0;
  const settingsProject =
    settingsProjectId != null
      ? (projects.find((project) => project.id === settingsProjectId) ?? null)
      : null;
  const projectFilterOptions = [
    { id: ALL_PROJECTS, label: t`All projects` },
    ...projects
      .filter((project) => !isHomeProject(project) && !project.remoteServerId)
      .map((project) => ({ id: project.id, label: project.name })),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-6 pb-2 pt-4">
        <div className="min-w-0 flex-1">
          {embedded ? null : (
            <>
              <h1 className="text-lg font-semibold text-foreground">
                <Trans>Tasks</Trans>
              </h1>
              <p className="text-xs text-muted">
                <Trans>
                  Dispatch agents to work on their own, in isolation, and watch them on the board.
                </Trans>
              </p>
            </>
          )}
        </div>
        {hasAnyTask ? (
          <>
            <Button
              size="sm"
              variant={drafts.showDrafts ? "secondary" : "ghost"}
              aria-pressed={drafts.showDrafts}
              aria-label={t`Show drafts`}
              onPress={() => drafts.setShowDrafts(!drafts.showDrafts)}
            >
              <StickyNote className="size-4" aria-hidden="true" />
              {t`Drafts`}
            </Button>
            {drafts.showDrafts ? (
              <Button
                size="sm"
                variant="ghost"
                isIconOnly
                aria-label={t`New draft`}
                onPress={drafts.openNew}
              >
                <Plus className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
            <Select
              aria-label={t`Filter by project`}
              className="w-[220px]"
              options={projectFilterOptions}
              value={projectFilter ?? ALL_PROJECTS}
              onChange={(value) => setProjectFilter(value === ALL_PROJECTS ? null : value)}
            />
          </>
        ) : null}
        {projectFilter != null ? (
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            aria-label={t`Task defaults`}
            onPress={() => setSettingsProjectId(projectFilter)}
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
        <Button size="sm" variant="primary" onPress={openNewTask}>
          <Plus className="size-4" aria-hidden="true" />
          {t`New task`}
        </Button>
      </div>

      {error || drafts.error ? (
        <p className="whitespace-pre-wrap px-6 pb-2 text-sm text-danger">{error || drafts.error}</p>
      ) : null}

      {loading && !hasAnyTask ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted" aria-label={t`Loading tasks`} />
        </div>
      ) : !hasAnyTask ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <ListTodo className="size-10 text-muted/40" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              <Trans>No tasks yet</Trans>
            </p>
            <p className="max-w-sm text-xs text-muted">
              <Trans>
                Create a task to hand work to an agent that runs it on its own, optionally in a
                separate git worktree.
              </Trans>
            </p>
          </div>
          <Button size="sm" variant="primary" onPress={openNewTask}>
            <Plus className="size-3.5" aria-hidden="true" />
            {t`New task`}
          </Button>
        </div>
      ) : (
        <TaskBoard
          tasks={tasks}
          drafts={drafts.drafts}
          showDrafts={drafts.showDrafts}
          projectNames={projectNames}
          employeeNames={employeeNames}
          projectFilter={projectFilter}
          reorderEnabled={projectFilter != null}
          handlersFor={handlersFor}
          draftHandlersFor={drafts.handlersFor}
          onStartTask={(id) => void act(() => startTask(id))}
          onReorderTodo={(orderedIds) => void reorderTodo(orderedIds)}
          onReorderDrafts={(orderedIds) => void drafts.reorder(orderedIds)}
        />
      )}

      <TaskEditorDialog
        busy={busy}
        draft={draft}
        knownCategories={knownCategories}
        employees={employeeOptions.runnable}
        blockedEmployees={employeeOptions.blocked}
        employeeBindings={employeeBindings}
        onChange={setDraft}
        onClose={() => setDraft(null)}
        onSave={() => void saveDraft()}
      />
      <TaskDetailDialog
        task={detailTask}
        onOpenChange={(open) => {
          if (!open) setDetailTaskId(null);
        }}
        onOpenSession={() => {
          if (detailTask && openTaskSession(detailTask)) setDetailTaskId(null);
        }}
      />
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={t`Delete task`}
        body={t`Delete this task? Its worktree and branch are kept.`}
        confirmLabel={t`Delete`}
        confirmVariant="danger"
        onConfirm={() => {
          const id = deleteTarget?.id;
          setDeleteTarget(null);
          if (id) void act(() => deleteTask(id));
        }}
        onClose={() => setDeleteTarget(null)}
      />
      {settingsProject ? (
        <TaskProjectSettingsDialog
          key={settingsProject.id}
          project={settingsProject}
          employees={employeeOptions.runnable}
          blockedEmployees={employeeOptions.blocked}
          employeeBindings={employeeBindings}
          onClose={() => setSettingsProjectId(null)}
        />
      ) : null}
      <DraftEditorDialog
        mode={drafts.editor}
        busy={drafts.busy}
        knownCategories={knownCategories}
        employees={employeeOptions.runnable}
        onClose={drafts.closeEditor}
        onSubmit={(input) => void drafts.saveEditor(input)}
      />
      <ConfirmDialog
        isOpen={drafts.deleteTarget !== null}
        title={t`Delete draft`}
        body={t`Delete this idea? This can't be undone.`}
        confirmLabel={t`Delete`}
        confirmVariant="danger"
        onConfirm={drafts.confirmDelete}
        onClose={drafts.closeDelete}
      />
    </div>
  );
}
