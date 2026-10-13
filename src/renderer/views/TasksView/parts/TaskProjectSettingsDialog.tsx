import { useEffect, useState } from "react";
import { Button, Modal } from "@heroui/react";
import { FolderGit2, FolderOpen, UserRound } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { Project, TaskIsolation, Workspace } from "@/shared/contracts";
import { Select } from "@/renderer/components/common";
import { readBridge } from "@/renderer/bridge";
import { updateProjectTaskSettings } from "@/renderer/actions/projectActions";
import { type EmployeeBinding } from "../employeeBinding";

const CONTROL_WIDTH = "w-[280px] max-w-[60%] shrink-0";

interface TaskProjectSettingsDialogProps {
  project: Project;
  /** Employees that can take a task (provider + model already resolved). */
  employees: Workspace[];
  /** Employees that still lack a provider/model, shown disabled with a hint. */
  blockedEmployees: Workspace[];
  /** Resolved binding per employee id, for the summary line. */
  employeeBindings: ReadonlyMap<string, EmployeeBinding>;
  onClose: () => void;
}

/**
 * Defaults a new task in this project starts from. Mounted per project (the
 * caller keys it by id), so its local state seeds once from the saved settings.
 */
export function TaskProjectSettingsDialog(props: TaskProjectSettingsDialogProps) {
  const { t } = useLingui();
  const { project, employees, blockedEmployees, employeeBindings } = props;
  const settings = project.taskSettings;
  // Prefer the saved default employee when it can still run; a single runnable
  // employee is preselected so the common case needs no picking.
  const seedEmployeeId =
    settings?.employeeId && employeeBindings.has(settings.employeeId)
      ? settings.employeeId
      : employees.length === 1
        ? employees[0]!.id
        : "";
  const [employeeId, setEmployeeId] = useState(seedEmployeeId);
  const [isolation, setIsolation] = useState<TaskIsolation>(settings?.isolation ?? "project");

  // A worktree needs a git repo; probe once so a non-repo project can't save an
  // unrunnable default.
  const [isRepo, setIsRepo] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void readBridge()
      .getGitStatus({ projectLocation: project.location })
      .then((status) => {
        if (!cancelled) setIsRepo(status.isRepo);
      })
      .catch(() => {
        if (!cancelled) setIsRepo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.location]);
  // Derived, not stored: a project that isn't a git repo can only run in place,
  // so a stale "worktree" selection never survives to be saved.
  const effectiveIsolation: TaskIsolation = isRepo ? isolation : "project";

  function save() {
    const binding = employeeBindings.get(employeeId);
    updateProjectTaskSettings(project.id, {
      ...(employeeId ? { employeeId } : {}),
      ...(binding
        ? {
            agentKind: binding.agentKind,
            config: {
              model: binding.model,
              ...(binding.effort ? { effort: binding.effort } : {}),
              ...(binding.fast ? { fast: true } : {}),
            },
          }
        : {}),
      isolation: effectiveIsolation,
    });
    props.onClose();
  }

  function reset() {
    updateProjectTaskSettings(project.id, undefined);
    props.onClose();
  }

  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && props.onClose()}>
      <Modal.Container size="md">
        <Modal.Dialog className="sm:max-w-[600px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t`Task defaults`}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="gap-6">
            <p className="text-xs text-muted">
              <Trans>
                New tasks in {project.name} start from these defaults. Any single task can still
                override them.
              </Trans>
            </p>

            <section className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">
                <Trans>Default assignee</Trans>
              </h3>
              <div className="flex items-center justify-between gap-4 py-1.5">
                <p className="text-xs text-muted">
                  {(() => {
                    const binding = employeeBindings.get(employeeId);
                    return binding ? (
                      <Trans>
                        Runs as {binding.agentKind} · {binding.model}
                      </Trans>
                    ) : (
                      <Trans>The employee new tasks in this project are handed to.</Trans>
                    );
                  })()}
                </p>
                <Select
                  aria-label={t`Default assignee`}
                  className={CONTROL_WIDTH}
                  options={[
                    { id: "", label: t`No default` },
                    ...employees.map((employee) => ({
                      id: employee.id,
                      label: employee.name,
                      icon: <UserRound className="size-4 shrink-0 text-muted" />,
                    })),
                    ...blockedEmployees.map((employee) => ({
                      id: employee.id,
                      label: employee.name,
                      icon: <UserRound className="size-4 shrink-0 text-muted/50" />,
                      detail: t`No agent configured`,
                      isDisabled: true,
                    })),
                  ]}
                  value={employeeId}
                  placeholder={t`No default`}
                  onChange={setEmployeeId}
                />
              </div>
            </section>

            <section className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">
                <Trans>Run in</Trans>
              </h3>
              <div className="flex items-center justify-between gap-4 py-1.5">
                <p className="text-xs text-muted">
                  {isRepo ? (
                    <Trans>An isolated git worktree keeps the run off your working copy.</Trans>
                  ) : (
                    <Trans>Only a git project can run in an isolated worktree.</Trans>
                  )}
                </p>
                <Select
                  aria-label={t`Run in`}
                  className="w-[280px] max-w-[60%] shrink-0"
                  options={[
                    {
                      id: "worktree",
                      label: t`Isolated worktree`,
                      icon: <FolderGit2 className="size-4 shrink-0 text-muted" />,
                      isDisabled: !isRepo,
                    },
                    {
                      id: "project",
                      label: t`Project directory`,
                      icon: <FolderOpen className="size-4 shrink-0 text-muted" />,
                    },
                  ]}
                  value={effectiveIsolation}
                  onChange={(value) => setIsolation(value as TaskIsolation)}
                />
              </div>
            </section>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={reset}>
              <Trans>Reset to defaults</Trans>
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" onPress={props.onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button variant="tertiary" className="text-foreground" onPress={save}>
              <Trans>Save</Trans>
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
