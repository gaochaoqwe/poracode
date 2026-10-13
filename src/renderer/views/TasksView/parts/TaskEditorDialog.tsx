import { useEffect, useState, type ReactNode } from "react";
import { Button, Input, Label, Modal, TextArea, TextField } from "@heroui/react";
import { FolderGit2, FolderOpen, House, UserRound } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { Project, ProjectLocation, Workspace } from "@/shared/contracts";
import { Select } from "@/renderer/components/common";
import { useProjectIconNode } from "@/renderer/components/common/ProjectIcon";
import { ProjectLocationIcon } from "@/renderer/components/common/ProjectRemoteServer";
import { useAppStore } from "@/renderer/state/appStore";
import { readBridge } from "@/renderer/bridge";
import { HOME_PROJECT_ID, isHomeProject } from "@/shared/homeScope";
import { type EmployeeBinding } from "../employeeBinding";
import {
  type RepeatMode,
  type TaskDraftForm,
  taskDraftIsValid,
  weekdayShortNames,
} from "../taskDraft";

const CONTROL_WIDTH = "w-[280px] max-w-[60%] shrink-0";

/** Links the category input to its suggestion list (a native `<datalist>`). */
const CATEGORY_SUGGESTIONS_ID = "task-category-suggestions";

interface TaskEditorDialogProps {
  busy: boolean;
  draft: TaskDraftForm | null;
  /** Distinct categories already in use, offered as free-text suggestions. */
  knownCategories: string[];
  /** Every employee that can take a task (provider + model already resolved). */
  employees: Workspace[];
  /** Employees that still lack a provider/model, shown disabled with a hint. */
  blockedEmployees: Workspace[];
  /** Resolved binding per employee id, for validation and the summary line. */
  employeeBindings: ReadonlyMap<string, EmployeeBinding>;
  onChange: (draft: TaskDraftForm) => void;
  onClose: () => void;
  onSave: () => void;
}

function projectLocationLabel(location: ProjectLocation): string {
  return location.kind === "wsl" ? `${location.distro}: ${location.linuxPath}` : location.path;
}

function TaskProjectIcon(props: { project: Project }) {
  const customIcon = useProjectIconNode(props.project, "size-4 text-muted");
  return customIcon ?? <ProjectLocationIcon location={props.project.location} />;
}

function EditorSection(props: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-sm font-semibold text-foreground">{props.title}</h3>
      <div className="divide-y divide-[var(--hairline)]">{props.children}</div>
    </section>
  );
}

function FieldRow(props: { label: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{props.label}</p>
        {props.description ? <p className="text-xs text-muted">{props.description}</p> : null}
      </div>
      <div className="flex shrink-0 justify-end">{props.children}</div>
    </div>
  );
}

export function TaskEditorDialog(props: TaskEditorDialogProps) {
  const { t, i18n } = useLingui();
  const projects = useAppStore((state) => state.projects);
  const draft = props.draft;
  const { onChange } = props;
  const [repoProbe, setRepoProbe] = useState<{ projectId: string; isRepo: boolean } | null>(null);

  // A worktree needs a git repo, so the option is only offered for a git
  // project (Home scope has none). Probed once per selected project; the
  // result carries its project id so a stale probe can't answer for a new one.
  const projectId = draft?.projectId ?? null;
  useEffect(() => {
    if (!projectId) return;
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) return;
    let cancelled = false;
    void readBridge()
      .getGitStatus({ projectLocation: project.location })
      .then((status) => {
        if (!cancelled) setRepoProbe({ projectId, isRepo: status.isRepo });
      })
      .catch(() => {
        if (!cancelled) setRepoProbe({ projectId, isRepo: false });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, projects]);

  const canWorktree = projectId != null && repoProbe?.projectId === projectId && repoProbe.isRepo;
  // Never leave the form on an isolation it can't run in.
  useEffect(() => {
    if (draft && draft.isolation === "worktree" && !canWorktree) {
      onChange({ ...draft, isolation: "project" });
    }
  }, [canWorktree, draft, onChange]);

  const projectOptions = [
    {
      id: HOME_PROJECT_ID,
      label: t`Home`,
      icon: <House className="size-4 shrink-0 text-muted" />,
    },
    ...projects
      .filter((project) => !isHomeProject(project) && !project.remoteServerId)
      .map((project) => ({
        id: project.id,
        label: project.name,
        icon: <TaskProjectIcon project={project} />,
        detail: projectLocationLabel(project.location),
      })),
  ];
  const missingProjectId =
    draft?.projectId != null && !projectOptions.some((option) => option.id === draft.projectId)
      ? draft.projectId
      : null;
  const projectSelectOptions = missingProjectId
    ? [...projectOptions, { id: missingProjectId, label: t`Unavailable project` }]
    : projectOptions;

  // The employee owns the provider + model, so this is the first decision the
  // editor asks for. Employees with no provider are listed but disabled, and a
  // dangling id (the employee was deleted after the task was created) is kept
  // visible so editing an old task doesn't silently re-point it.
  const employeeOptions = [
    ...props.employees.map((employee) => {
      const binding = props.employeeBindings.get(employee.id);
      return {
        id: employee.id,
        label: employee.name,
        icon: <UserRound className="size-4 shrink-0 text-muted" />,
        ...(binding ? { detail: `${binding.agentKind} · ${binding.model}` } : {}),
      };
    }),
    ...props.blockedEmployees.map((employee) => ({
      id: employee.id,
      label: employee.name,
      icon: <UserRound className="size-4 shrink-0 text-muted/50" />,
      detail: t`No agent configured`,
      isDisabled: true,
    })),
  ];
  const missingEmployeeId =
    draft && draft.employeeId && !employeeOptions.some((option) => option.id === draft.employeeId)
      ? draft.employeeId
      : null;
  const employeeSelectOptions = missingEmployeeId
    ? [...employeeOptions, { id: missingEmployeeId, label: t`Unavailable employee` }]
    : employeeOptions;
  const selectedBinding = draft ? props.employeeBindings.get(draft.employeeId) : undefined;

  const weekdayNames = weekdayShortNames(i18n.locale);
  const timeFormatter = new Intl.DateTimeFormat(i18n.locale, {
    hour: "numeric",
    minute: "2-digit",
  });
  const timeOptions = Array.from({ length: 96 }, (_, index) => {
    const hour = Math.floor(index / 4);
    const minute = (index % 4) * 15;
    const id = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    return { id, label: timeFormatter.format(new Date(2026, 0, 1, hour, minute)) };
  });
  const hourlyOptions = [0, 15, 30, 45].map((minute) => ({
    id: `00:${String(minute).padStart(2, "0")}`,
    label: minute === 0 ? t`On the hour` : t`${minute} minutes past the hour`,
  }));

  function set(next: Partial<TaskDraftForm>) {
    if (draft) props.onChange({ ...draft, ...next });
  }

  return (
    <Modal.Backdrop
      isOpen={draft !== null}
      onOpenChange={(open) => !open && !props.busy && props.onClose()}
    >
      <Modal.Container size="md">
        <Modal.Dialog className="sm:max-w-[600px]">
          <Modal.CloseTrigger isDisabled={props.busy} />
          <Modal.Header>
            <Modal.Heading>{draft?.id ? t`Edit task` : t`New task`}</Modal.Heading>
          </Modal.Header>
          {draft ? (
            <>
              <Modal.Body className="gap-6">
                <FieldRow
                  label={<Trans>Assignee</Trans>}
                  description={
                    selectedBinding ? (
                      <Trans>
                        Runs as {selectedBinding.agentKind} · {selectedBinding.model}
                      </Trans>
                    ) : (
                      <Trans>The employee that runs this task, and the agent it uses.</Trans>
                    )
                  }
                >
                  <Select
                    aria-label={t`Assignee`}
                    className={CONTROL_WIDTH}
                    options={employeeSelectOptions}
                    value={draft.employeeId}
                    placeholder={t`Pick an employee`}
                    onChange={(employeeId) => set({ employeeId })}
                  />
                </FieldRow>

                <TextField value={draft.title} onChange={(title) => set({ title })}>
                  <Label>
                    <Trans>Task title</Trans>
                  </Label>
                  <Input placeholder={t`Refactor the auth module`} />
                </TextField>

                <FieldRow
                  label={<Trans>Category</Trans>}
                  description={
                    <Trans>Group tasks on the board. Leave empty for uncategorized.</Trans>
                  }
                >
                  <Input
                    aria-label={t`Category`}
                    className={CONTROL_WIDTH}
                    value={draft.category}
                    placeholder={t`e.g. Billing`}
                    list={CATEGORY_SUGGESTIONS_ID}
                    maxLength={40}
                    onChange={(event) => set({ category: event.target.value })}
                  />
                  <datalist id={CATEGORY_SUGGESTIONS_ID}>
                    {props.knownCategories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </datalist>
                </FieldRow>

                <TextField value={draft.prompt} onChange={(prompt) => set({ prompt })}>
                  <Label>
                    <Trans>Instructions</Trans>
                  </Label>
                  <TextArea rows={4} placeholder={t`Describe what the agent should do`} />
                </TextField>

                <FieldRow
                  label={<Trans>Project</Trans>}
                  description={<Trans>Where the run's conversation is created.</Trans>}
                >
                  <Select
                    aria-label={t`Project`}
                    className={CONTROL_WIDTH}
                    options={projectSelectOptions}
                    value={draft.projectId ?? HOME_PROJECT_ID}
                    onChange={(value) =>
                      set({
                        projectId: value === HOME_PROJECT_ID ? null : value,
                        ...(value === HOME_PROJECT_ID ? { isolation: "project" } : {}),
                      })
                    }
                  />
                </FieldRow>

                <FieldRow
                  label={<Trans>Run in</Trans>}
                  description={
                    canWorktree
                      ? t`An isolated git worktree keeps the run off your working copy.`
                      : t`Only a git project can run in an isolated worktree.`
                  }
                >
                  <Select
                    aria-label={t`Run in`}
                    className={CONTROL_WIDTH}
                    options={[
                      {
                        id: "worktree",
                        label: t`Isolated worktree`,
                        icon: <FolderGit2 className="size-4 shrink-0 text-muted" />,
                        isDisabled: !canWorktree,
                      },
                      {
                        id: "project",
                        label: t`Project directory`,
                        icon: <FolderOpen className="size-4 shrink-0 text-muted" />,
                      },
                    ]}
                    value={draft.isolation}
                    onChange={(value) => set({ isolation: value as TaskDraftForm["isolation"] })}
                  />
                </FieldRow>

                <EditorSection title={<Trans>Schedule</Trans>}>
                  <FieldRow
                    label={<Trans>Repeat</Trans>}
                    description={<Trans>Leave off to run this task only by hand.</Trans>}
                  >
                    <Select
                      aria-label={t`Repeat`}
                      className={CONTROL_WIDTH}
                      options={[
                        { id: "none", label: t`Manual only` },
                        { id: "hourly", label: t`Hourly` },
                        { id: "daily", label: t`Daily` },
                        { id: "weekdays", label: t`Weekdays` },
                        { id: "weekly", label: t`Weekly` },
                        { id: "custom", label: t`Custom` },
                        { id: "once", label: t`One time` },
                      ]}
                      value={draft.repeatMode}
                      onChange={(repeatMode) => set({ repeatMode: repeatMode as RepeatMode })}
                    />
                  </FieldRow>
                  {draft.repeatMode === "weekly" || draft.repeatMode === "custom" ? (
                    <FieldRow label={<Trans>On</Trans>}>
                      <div className="flex flex-wrap justify-end gap-1">
                        {weekdayNames.map((label, day) => {
                          const selected = draft.days.includes(day);
                          return (
                            <Button
                              key={day}
                              size="sm"
                              className="min-w-11"
                              variant={selected ? "secondary" : "tertiary"}
                              aria-pressed={selected}
                              onPress={() => {
                                const days =
                                  draft.repeatMode === "weekly"
                                    ? [day]
                                    : selected
                                      ? draft.days.filter((value) => value !== day)
                                      : [...draft.days, day].sort((left, right) => left - right);
                                set({ days });
                              }}
                            >
                              {label}
                            </Button>
                          );
                        })}
                      </div>
                    </FieldRow>
                  ) : null}
                  {draft.repeatMode === "none" ? null : draft.repeatMode === "once" ? (
                    <FieldRow label={<Trans>Run at</Trans>}>
                      <TextField
                        aria-label={t`Run at`}
                        className={CONTROL_WIDTH}
                        type="datetime-local"
                        value={draft.runAt}
                        onChange={(runAt) => set({ runAt })}
                      >
                        <Input />
                      </TextField>
                    </FieldRow>
                  ) : (
                    <FieldRow
                      label={
                        draft.repeatMode === "hourly" ? <Trans>At</Trans> : <Trans>Time</Trans>
                      }
                    >
                      <Select
                        aria-label={draft.repeatMode === "hourly" ? t`Minute` : t`Time`}
                        className={CONTROL_WIDTH}
                        options={draft.repeatMode === "hourly" ? hourlyOptions : timeOptions}
                        value={draft.time}
                        onChange={(time) => set({ time })}
                      />
                    </FieldRow>
                  )}
                </EditorSection>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" isDisabled={props.busy} onPress={props.onClose}>
                  <Trans>Cancel</Trans>
                </Button>
                <Button
                  variant="tertiary"
                  className="text-foreground"
                  isPending={props.busy}
                  isDisabled={!taskDraftIsValid(draft, props.employeeBindings)}
                  onPress={props.onSave}
                >
                  {draft.id ? <Trans>Save changes</Trans> : <Trans>Create task</Trans>}
                </Button>
              </Modal.Footer>
            </>
          ) : null}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
