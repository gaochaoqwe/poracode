import { useEffect, useState } from "react";
import { Button, Modal } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { MessagesSquare, Trash2, UserRound } from "lucide-react";
import type { Project, Task, TaskRun, Workspace } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { ConfirmDialog } from "@/renderer/components/common";
import { performWorktreeRemoval } from "@/renderer/actions/worktreeActions";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { employeeBinding } from "../employeeBinding";

interface TaskDetailDialogProps {
  task: Task | null;
  onOpenChange: (open: boolean) => void;
  onOpenSession: () => void;
}

function formatDateTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function TaskDetailDialog(props: TaskDetailDialogProps) {
  const { t, i18n } = useLingui();
  const { task } = props;
  const projects = useAppStore((state) => state.projects);
  const threads = useAppStore((state) => state.threads);
  const workspaces = useSharedSettings((state) => state.workspaces);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const taskId = task?.id ?? null;
  const running = task?.status === "in_progress";
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    const load = () =>
      void readBridge()
        .getTaskRuns({ id: taskId })
        .then((next) => {
          if (!cancelled) setRuns(next);
        })
        .catch(() => undefined);
    load();
    // Only poll while a run is live; otherwise the history is settled.
    if (!running)
      return () => {
        cancelled = true;
      };
    const timer = window.setInterval(load, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [taskId, running]);

  const project: Project | undefined = task?.projectId
    ? projects.find((candidate) => candidate.id === task.projectId)
    : undefined;
  const employee: Workspace | undefined = task?.employeeId
    ? workspaces.find((candidate) => candidate.id === task.employeeId)
    : undefined;
  const binding = employeeBinding(employee);
  // A task without an employee falls back to its stored provider, so the
  // detail view still shows what would run it.
  const agentLabel = binding
    ? `${binding.agentKind} · ${binding.model}`
    : task?.agentKind
      ? task.config.model
        ? `${task.agentKind} · ${task.config.model}`
        : task.agentKind
      : null;

  async function removeWorktree() {
    if (!project || !task?.worktreePath) return;
    await performWorktreeRemoval(project, task.worktreePath, task.worktreeBranch ?? undefined);
    setConfirmRemove(false);
  }

  return (
    <>
      <Modal.Backdrop isOpen={task !== null} onOpenChange={props.onOpenChange}>
        <Modal.Container size="md">
          <Modal.Dialog className="sm:max-w-[600px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{task?.title ?? ""}</Modal.Heading>
            </Modal.Header>
            {task ? (
              <Modal.Body className="gap-6">
                <section className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">
                    <Trans>Assignee</Trans>
                  </h3>
                  <div className="flex min-w-0 items-center gap-2">
                    <UserRound className="size-4 shrink-0 text-muted" aria-hidden="true" />
                    <span className="min-w-0 truncate text-sm">
                      {employee?.name ?? t`Unassigned`}
                    </span>
                    {agentLabel ? (
                      <span className="min-w-0 truncate text-xs text-muted">{agentLabel}</span>
                    ) : null}
                  </div>
                </section>

                <section className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">
                    <Trans>Instructions</Trans>
                  </h3>
                  <p className="whitespace-pre-wrap text-sm text-muted">{task.prompt}</p>
                </section>

                <section className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">
                    <Trans>Worktree</Trans>
                  </h3>
                  {task.worktreePath ? (
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-mono text-xs text-muted">
                        {task.worktreePath}
                      </span>
                      <Button size="sm" variant="ghost" onPress={() => setConfirmRemove(true)}>
                        <Trash2 className="size-3.5" aria-hidden="true" />
                        {t`Remove worktree`}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted">
                      <Trans>This task runs directly in the project directory.</Trans>
                    </p>
                  )}
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    <Trans>Run history</Trans>
                  </h3>
                  {runs.length === 0 ? (
                    <p className="text-sm text-muted">
                      <Trans>This task has not run yet.</Trans>
                    </p>
                  ) : (
                    <ul className="divide-y divide-[var(--hairline)]">
                      {runs.map((run) => {
                        const thread = threads.find((entry) => entry.id === run.threadId);
                        return (
                          <li key={run.id} className="flex items-center gap-3 py-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm">{thread?.title ?? run.threadId}</p>
                              <p className="text-xs text-muted">
                                {formatDateTime(run.startedAt, i18n.locale)} · {run.status}
                              </p>
                            </div>
                            {thread ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                isIconOnly
                                aria-label={t`Open session`}
                                onPress={props.onOpenSession}
                              >
                                <MessagesSquare className="size-4" aria-hidden="true" />
                              </Button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </Modal.Body>
            ) : null}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      <ConfirmDialog
        isOpen={confirmRemove}
        title={t`Remove worktree`}
        body={t`Delete this task's worktree and branch? Uncommitted work in it will be lost.`}
        confirmLabel={t`Remove`}
        confirmVariant="danger"
        onConfirm={() => void removeWorktree()}
        onClose={() => setConfirmRemove(false)}
      />
    </>
  );
}
