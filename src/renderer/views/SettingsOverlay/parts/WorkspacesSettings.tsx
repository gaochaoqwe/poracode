import { useState } from "react";
import { Button, Surface, Tooltip } from "@heroui/react";
import { ChevronRight, Copy, Layers, Pencil, Plus, Trash2, UserCog, UserPlus } from "lucide-react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { Workspace } from "@/shared/contracts";
import { isHomeProject } from "@/shared/homeScope";
import {
  createEmployeeUnderPost,
  createWorkspace,
  deleteWorkspace,
  duplicateWorkspace,
  renameWorkspace,
  workspaceDeletionFallback,
} from "@/renderer/actions/workspaceActions";
import { ConfirmDialog } from "@/renderer/components/common/ConfirmDialog";
import { OptionMenu } from "@/renderer/components/common/OptionMenu";
import { Select } from "@/renderer/components/common";
import { WorkspaceIcon } from "@/renderer/components/workspace/WorkspaceIcon";
import { WorkspaceNameDialog } from "@/renderer/components/workspace/WorkspaceNameDialog";
import {
  WORKSPACE_UNFILED_KEY,
  workspaceMenuKey,
} from "@/renderer/components/workspace/workspaceMenuKeys";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useActiveWorkspaceId } from "@/renderer/state/workspaceStore";
import {
  primaryWorkspaces,
  secondaryEmployees,
  type SecondaryRankGroup,
} from "@/renderer/state/workspaceHierarchy";
import { SettingRow, SettingsPage } from "./SettingsForm";
import { WorkspaceEmployeeEditor } from "./WorkspaceEmployeeEditor";
import { EmployeeTemplatesSection } from "./EmployeeTemplatesSection";
import { TeamsSection } from "./TeamsSection";

type NameDialogState =
  | { mode: "create" }
  | { mode: "rename"; workspace: Workspace }
  | { mode: "duplicate"; workspace: Workspace }
  | { mode: "createEmployee"; parent: Workspace };

export function WorkspacesSettings() {
  const { t } = useLingui();
  const workspaces = useSharedSettings((state) => state.workspaces);
  const activeWorkspaceId = useActiveWorkspaceId();
  const defaultWorkspaceId = useSharedSettings((state) => state.defaultWorkspaceId);
  const setDefaultWorkspaceId = useSharedSettings((state) => state.setDefaultWorkspaceId);
  const allProjects = useAppStore((state) => state.projects);
  // Home is synthetic and belongs to every workspace, so it isn't assignable.
  const projects = allProjects.filter((project) => !isHomeProject(project));

  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [deleting, setDeleting] = useState<Workspace | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Workspace | null>(null);
  const [expandedPrimaries, setExpandedPrimaries] = useState<ReadonlySet<string>>(new Set());

  function togglePrimary(primaryId: string) {
    setExpandedPrimaries((prev) => {
      const next = new Set(prev);
      if (next.has(primaryId)) next.delete(primaryId);
      else next.add(primaryId);
      return next;
    });
  }

  // 岗位→员工 两级视图：一级岗位作为可折叠分组，其下缩进列出二级员工。
  const primaries = primaryWorkspaces(workspaces);
  const primariesById = new Map(workspaces.map((w) => [w.id, w] as const));
  // 未挂到任何一级岗位下的二级员工（父容器被删 / 旧数据）单独归入「未分组」。
  const secondariesByPrimary = new Map<string, SecondaryRankGroup[]>();
  const unassigned: Workspace[] = [];
  for (const workspace of workspaces) {
    if (workspace.roleRank === undefined) continue;
    const parent = workspace.parentWorkspaceId;
    if (parent && primariesById.has(parent)) {
      secondariesByPrimary.set(parent, secondaryEmployees(workspaces, parent));
    } else {
      unassigned.push(workspace);
    }
  }

  // One grouped pass instead of a filter per row.
  const projectCounts = new Map<string, number>();
  for (const project of projects) {
    if (project.workspaceId) {
      projectCounts.set(project.workspaceId, (projectCounts.get(project.workspaceId) ?? 0) + 1);
    }
  }
  const deleteFallback = deleting ? workspaceDeletionFallback(deleting.id) : undefined;
  const isLastWorkspace = workspaces.length <= 1;

  // A dangling default (workspace removed elsewhere) displays as the first
  // workspace, matching how `resolveActiveWorkspaceId` falls back.
  const defaultWorkspaceOptions = workspaces.map((workspace) => ({
    id: workspace.id,
    label: workspace.name,
  }));
  const defaultWorkspaceValue =
    defaultWorkspaceId && workspaces.some((workspace) => workspace.id === defaultWorkspaceId)
      ? defaultWorkspaceId
      : (workspaces[0]?.id ?? "");

  const workspaceOptions = [
    ...workspaces.map((workspace) => ({
      id: workspaceMenuKey(workspace.id),
      label: workspace.name,
      icon: <WorkspaceIcon icon={workspace.icon} className="size-4 shrink-0 text-muted" />,
    })),
    {
      id: WORKSPACE_UNFILED_KEY,
      label: t`All workspaces`,
      icon: <Layers className="size-4 shrink-0 text-muted" />,
    },
  ];

  return (
    <SettingsPage
      title={t`Workspaces`}
      description={
        <Trans>
          Post (岗位) containers hold the employees (员工) who do that work. Expand a post to see its
          team members; projects appear beside each entry.
        </Trans>
      }
      bodyClassName=""
      actions={
        <Button size="sm" variant="secondary" onPress={() => setNameDialog({ mode: "create" })}>
          <Plus className="size-4" />
          <Trans>Add workspace</Trans>
        </Button>
      }
    >
      <Surface variant="secondary" className="divide-y divide-[var(--hairline)] rounded-xl">
        {primaries.map((primary) => {
          const isOpen = expandedPrimaries.has(primary.id);
          const rankGroups = secondariesByPrimary.get(primary.id) ?? [];
          const employeeCount = rankGroups.reduce((sum, g) => sum + g.employees.length, 0);
          return (
            <div key={primary.id} className="flex flex-col">
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => togglePrimary(primary.id)}
                  className="flex shrink-0 items-center rounded outline-none hover:bg-[var(--row-hover)] focus-visible:focus-ring"
                >
                  <ChevronRight
                    className={`size-4 text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}
                  />
                </button>
                <WorkspaceIcon icon={primary.icon} className="size-4 shrink-0 text-muted" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-sm font-medium text-foreground">
                    {primary.name}
                    {primary.id === activeWorkspaceId ? (
                      <span className="ms-2 text-xs font-normal text-muted">
                        <Trans>Active</Trans>
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted">
                    <Plural
                      value={employeeCount}
                      one="# employee"
                      other="# employees"
                    />
                    {" · "}
                    <Plural
                      value={projectCounts.get(primary.id) ?? 0}
                      one="# project"
                      other="# projects"
                    />
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Tooltip delay={150}>
                    <Tooltip.Trigger>
                      <Button
                        variant="ghost"
                        size="sm"
                        isIconOnly
                        aria-label={t`Rename workspace`}
                        onPress={() => setNameDialog({ mode: "rename", workspace: primary })}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      <Trans>Rename workspace</Trans>
                    </Tooltip.Content>
                  </Tooltip>
                  <Tooltip delay={150}>
                    <Tooltip.Trigger>
                      <Button
                        variant="ghost"
                        size="sm"
                        isIconOnly
                        aria-label={t`Copy workspace`}
                        onPress={() => setNameDialog({ mode: "duplicate", workspace: primary })}
                      >
                        <Copy className="size-4" />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      <Trans>Copy workspace</Trans>
                    </Tooltip.Content>
                  </Tooltip>
                  <Tooltip delay={150}>
                    <Tooltip.Trigger>
                      <Button
                        variant="ghost"
                        size="sm"
                        isIconOnly
                        aria-label={t`Delete workspace`}
                        isDisabled={isLastWorkspace}
                        onPress={() => setDeleting(primary)}
                      >
                        <Trash2 className="size-4 text-danger" />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      {isLastWorkspace ? (
                        <Trans>Keep at least one workspace</Trans>
                      ) : (
                        <Trans>Delete workspace</Trans>
                      )}
                    </Tooltip.Content>
                  </Tooltip>
                </div>
              </div>
              {isOpen ? (
                <div className="flex flex-col">
                  <button
                    type="button"
                    className="flex items-center gap-2 border-t border-[var(--hairline)] px-4 py-2 text-xs text-muted hover:text-foreground"
                    style={{ paddingLeft: "2.5rem" }}
                    onClick={() => setNameDialog({ mode: "createEmployee", parent: primary })}
                  >
                    <UserPlus className="size-4" />
                    <Trans>Add employee</Trans>
                  </button>
                  {rankGroups.length === 0 ? (
                    <p className="px-10 pb-2 text-xs text-muted">
                      <Trans>No employees under this post</Trans>
                    </p>
                  ) : (
                    rankGroups.map((group) => (
                      <div key={group.rank} className="flex flex-col">
                        {group.employees.map((employee) => (
                          <div
                            key={employee.id}
                            className="flex items-center gap-3 border-t border-[var(--hairline)] px-4 py-2.5"
                            style={{ paddingLeft: "2.5rem" }}
                          >
                            <WorkspaceIcon
                              icon={employee.icon}
                              className="size-4 shrink-0 text-muted/70"
                            />
                            <div className="flex min-w-0 flex-1 flex-col">
                              <p className="truncate text-sm text-foreground">
                                {employee.name}
                                {employee.id === activeWorkspaceId ? (
                                  <span className="ms-2 text-xs font-normal text-muted">
                                    <Trans>Active</Trans>
                                  </span>
                                ) : null}
                              </p>
                              <p className="truncate text-xs text-muted">
                                {employee.persona ?? ""}
                                {projectCounts.get(employee.id) !== undefined ? (
                                  <>
                                    {employee.persona ? " · " : ""}
                                    <Plural
                                      value={projectCounts.get(employee.id) ?? 0}
                                      one="# project"
                                      other="# projects"
                                    />
                                  </>
                                ) : null}
                              </p>
                            </div>
                            <div className="flex shrink-0 gap-1">
                              <Tooltip delay={150}>
                                <Tooltip.Trigger>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    isIconOnly
                                    aria-label={t`Edit employee`}
                                    onPress={() => setEditingEmployee(employee)}
                                  >
                                    <UserCog className="size-4" />
                                  </Button>
                                </Tooltip.Trigger>
                                <Tooltip.Content>
                                  <Trans>Edit employee</Trans>
                                </Tooltip.Content>
                              </Tooltip>
                              <Tooltip delay={150}>
                                <Tooltip.Trigger>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    isIconOnly
                                    aria-label={t`Rename workspace`}
                                    onPress={() => setNameDialog({ mode: "rename", workspace: employee })}
                                  >
                                    <Pencil className="size-4" />
                                  </Button>
                                </Tooltip.Trigger>
                                <Tooltip.Content>
                                  <Trans>Rename workspace</Trans>
                                </Tooltip.Content>
                              </Tooltip>
                              <Tooltip delay={150}>
                                <Tooltip.Trigger>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    isIconOnly
                                    aria-label={t`Copy workspace`}
                                    onPress={() => setNameDialog({ mode: "duplicate", workspace: employee })}
                                  >
                                    <Copy className="size-4" />
                                  </Button>
                                </Tooltip.Trigger>
                                <Tooltip.Content>
                                  <Trans>Copy workspace</Trans>
                                </Tooltip.Content>
                              </Tooltip>
                              <Tooltip delay={150}>
                                <Tooltip.Trigger>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    isIconOnly
                                    aria-label={t`Delete workspace`}
                                    isDisabled={isLastWorkspace}
                                    onPress={() => setDeleting(employee)}
                                  >
                                    <Trash2 className="size-4 text-danger" />
                                  </Button>
                                </Tooltip.Trigger>
                                <Tooltip.Content>
                                  {isLastWorkspace ? (
                                    <Trans>Keep at least one workspace</Trans>
                                  ) : (
                                    <Trans>Delete workspace</Trans>
                                  )}
                                </Tooltip.Content>
                              </Tooltip>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
        {unassigned.length > 0 ? (
          <div className="flex items-center gap-3 px-4 py-3">
            <WorkspaceIcon icon="briefcase" className="size-4 shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                <Trans>Unassigned employees</Trans>
              </p>
            </div>
          </div>
        ) : null}
        {unassigned.map((employee) => (
          <div key={employee.id} className="flex items-center gap-3 px-4 py-3" style={{ paddingLeft: "2.5rem" }}>
            <WorkspaceIcon icon={employee.icon} className="size-4 shrink-0 text-muted/70" />
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="truncate text-sm text-foreground">
                {employee.name}
                {employee.id === activeWorkspaceId ? (
                  <span className="ms-2 text-xs font-normal text-muted">
                    <Trans>Active</Trans>
                  </span>
                ) : null}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Tooltip delay={150}>
                <Tooltip.Trigger>
                  <Button
                    variant="ghost"
                    size="sm"
                    isIconOnly
                    aria-label={t`Edit employee`}
                    onPress={() => setEditingEmployee(employee)}
                  >
                    <UserCog className="size-4" />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <Trans>Edit employee</Trans>
                </Tooltip.Content>
              </Tooltip>
            </div>
          </div>
        ))}
      </Surface>

      <div className="mt-6">
        <SettingRow
          title={t`Default workspace`}
          description={
            <Trans>The workspace a window opens with when it has none remembered yet.</Trans>
          }
        >
          <Select
            aria-label={t`Default workspace`}
            className="w-[200px] shrink-0"
            options={defaultWorkspaceOptions}
            value={defaultWorkspaceValue}
            onChange={setDefaultWorkspaceId}
          />
        </SettingRow>
      </div>

      <EmployeeTemplatesSection />

      <TeamsSection />

      <h2 className="mb-2 mt-6 text-sm font-semibold text-foreground">
        <Trans>Projects</Trans>
      </h2>
      {projects.length === 0 ? (
        <p className="text-sm text-muted">
          <Trans>No projects yet.</Trans>
        </p>
      ) : (
        <Surface variant="secondary" className="divide-y divide-[var(--hairline)] rounded-xl">
          {projects.map((project) => (
            <div key={project.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{project.name}</p>
              </div>
              <OptionMenu
                value={
                  project.workspaceId
                    ? workspaceMenuKey(project.workspaceId)
                    : WORKSPACE_UNFILED_KEY
                }
                options={workspaceOptions}
                placeholder={t`Workspace`}
                onChange={(next) => {
                  const workspaceId =
                    next === WORKSPACE_UNFILED_KEY
                      ? undefined
                      : workspaces.find((w) => workspaceMenuKey(w.id) === next)?.id;
                  useAppStore.getState().setProjectWorkspace(project.id, workspaceId);
                }}
              />
            </div>
          ))}
        </Surface>
      )}

      <WorkspaceNameDialog
        isOpen={nameDialog !== null}
        mode={nameDialog?.mode === "createEmployee" ? "create" : (nameDialog?.mode ?? "create")}
        {...(nameDialog?.mode === "rename" ? { initialName: nameDialog.workspace.name } : {})}
        onSubmit={(name) => {
          if (nameDialog?.mode === "rename") renameWorkspace(nameDialog.workspace.id, name);
          else if (nameDialog?.mode === "duplicate")
            duplicateWorkspace(nameDialog.workspace.id, name);
          else if (nameDialog?.mode === "createEmployee") {
            const employee = createEmployeeUnderPost(name, nameDialog.parent.id);
            if (employee) setEditingEmployee(employee);
          } else createWorkspace(name);
        }}
        onClose={() => setNameDialog(null)}
      />
      <ConfirmDialog
        isOpen={deleting !== null}
        title={t`Delete workspace?`}
        body={
          deleting && deleteFallback ? (
            <Trans>
              Projects in {deleting.name} move to {deleteFallback.name}. No project is deleted.
            </Trans>
          ) : null
        }
        confirmLabel={t`Delete`}
        onConfirm={() => {
          if (deleting) deleteWorkspace(deleting.id);
          setDeleting(null);
        }}
        onClose={() => setDeleting(null)}
      />
      {editingEmployee ? (
        <WorkspaceEmployeeEditor
          isOpen
          workspace={editingEmployee}
          onClose={() => setEditingEmployee(null)}
        />
      ) : null}
    </SettingsPage>
  );
}
