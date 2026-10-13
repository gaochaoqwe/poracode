import { useState } from "react";
import { Button, Surface } from "@heroui/react";
import { Eye, EyeOff, Plus, Trash2, Users } from "lucide-react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { Team, TeamDispatchPolicy } from "@/shared/contracts";
import { Select } from "@/renderer/components/common";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";

const POLICY_OPTIONS: { id: TeamDispatchPolicy; label: string }[] = [
  { id: "round-robin", label: "Round-robin" },
  { id: "free-for-all", label: "Free-for-all" },
  { id: "manager-assigns", label: "Manager assigns" },
];

export function TeamsSection() {
  const { t } = useLingui();
  const teams = useSharedSettings((state) => state.teams);
  const [editing, setEditing] = useState<Team | "new" | null>(null);

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          <Trans>Teams</Trans>
        </h2>
        <Button
          size="sm"
          variant="secondary"
          onPress={() => setEditing("new")}
          aria-label={t`Add team`}
        >
          <Plus className="size-4" />
          <Trans>Add team</Trans>
        </Button>
      </div>
      <p className="mb-2 text-xs text-muted">
        <Trans>
          Teams group employee roles (岗位) into an orchestrated unit with a dispatch policy.
        </Trans>
      </p>

      {teams.length === 0 ? (
        <p className="text-sm text-muted">
          <Trans>No teams yet.</Trans>
        </p>
      ) : (
        <Surface variant="secondary" className="divide-y divide-[var(--hairline)] rounded-xl">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => setEditing(team)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-hover)]"
            >
              <Users className="size-4 shrink-0 text-muted" />
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="truncate text-sm font-medium text-foreground">{team.name}</p>
                <p className="truncate text-xs text-muted">
                  <Plural value={team.memberEmployeeIds.length} one="# member" other="# members" />
                  {team.managerEmployeeId ? " · manager" : ""} · {team.dispatchPolicy}
                </p>
              </div>
              <Trash2
                className="size-4 shrink-0 text-danger"
                role="button"
                aria-label={t`Delete team`}
                onClick={(event) => {
                  event.stopPropagation();
                  removeTeam(team.id);
                }}
              />
              {team.hiddenInNav ? (
                <EyeOff
                  className="size-4 shrink-0 text-muted"
                  role="button"
                  aria-label={t`Show team ${team.name} in navigation`}
                  onClick={(event) => {
                    event.stopPropagation();
                    useSharedSettings.getState().updateTeam(team.id, { hiddenInNav: false });
                  }}
                />
              ) : (
                <Eye
                  className="size-4 shrink-0 text-muted"
                  role="button"
                  aria-label={t`Hide team ${team.name} from navigation`}
                  onClick={(event) => {
                    event.stopPropagation();
                    useSharedSettings.getState().updateTeam(team.id, { hiddenInNav: true });
                  }}
                />
              )}
            </button>
          ))}
        </Surface>
      )}

      {editing ? (
        <TeamEditor team={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </section>
  );
}

function removeTeam(teamId: string): void {
  useSharedSettings.getState().removeTeam(teamId);
}

function TeamEditor(props: { team: Team | null; onClose: () => void }) {
  const { t } = useLingui();
  const { team, onClose } = props;
  const workspaces = useSharedSettings((state) => state.workspaces);
  const [name, setName] = useState(team?.name ?? "");
  const [members, setMembers] = useState<string[]>(team?.memberEmployeeIds ?? []);
  const [policy, setPolicy] = useState<TeamDispatchPolicy>(team?.dispatchPolicy ?? "round-robin");
  const [manager, setManager] = useState<string>(team?.managerEmployeeId ?? "");

  const toggleMember = (workspaceId: string) => {
    setMembers((current) =>
      current.includes(workspaceId)
        ? current.filter((id) => id !== workspaceId)
        : [...current, workspaceId],
    );
  };

  const managerOptions = workspaces
    .filter((workspace) => members.includes(workspace.id))
    .map((workspace) => ({ id: workspace.id, label: workspace.name }));
  const managerValue = members.includes(manager) ? manager : "";

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const nextManager = policy === "manager-assigns" ? manager || undefined : undefined;
    if (team) {
      useSharedSettings.getState().updateTeam(team.id, {
        name: trimmed,
        memberEmployeeIds: members,
        dispatchPolicy: policy,
        ...(nextManager ? { managerEmployeeId: nextManager } : {}),
      });
    } else {
      const created = useSharedSettings.getState().addTeam(trimmed, members);
      if (policy !== "round-robin" || nextManager) {
        useSharedSettings.getState().updateTeam(created.id, {
          ...(policy !== "round-robin" ? { dispatchPolicy: policy } : {}),
          ...(nextManager ? { managerEmployeeId: nextManager } : {}),
        });
      }
    }
    onClose();
  };

  return (
    <Surface variant="secondary" className="mt-3 rounded-xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          {team ? <Trans>Edit team</Trans> : <Trans>New team</Trans>}
        </h3>
        <Button size="sm" variant="ghost" onPress={onClose}>
          <Trans>Cancel</Trans>
        </Button>
      </div>

      <label htmlFor="team-name" className="mb-1 block text-xs font-medium text-muted">
        <Trans>Name</Trans>
      </label>
      <input
        id="team-name"
        className="w-full rounded-lg border border-[var(--hairline)] bg-transparent px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={t`Team name`}
      />

      <span className="mb-1 mt-3 block text-xs font-medium text-muted">
        <Trans>Members (employee roles)</Trans>
      </span>
      {workspaces.length === 0 ? (
        <p className="text-xs text-muted">
          <Trans>No employee roles yet.</Trans>
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {workspaces.map((workspace) => {
            const active = members.includes(workspace.id);
            return (
              <Button
                key={workspace.id}
                size="sm"
                variant={active ? "primary" : "outline"}
                onPress={() => toggleMember(workspace.id)}
                className="text-xs"
              >
                {workspace.name}
              </Button>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-3">
        <div className="min-w-[200px]">
          <span className="mb-1 block text-xs font-medium text-muted">
            <Trans>Dispatch policy</Trans>
          </span>
          <Select
            aria-label={t`Dispatch policy`}
            className="w-full"
            options={POLICY_OPTIONS}
            value={policy}
            onChange={(next) => setPolicy(next as TeamDispatchPolicy)}
          />
        </div>
        {policy === "manager-assigns" ? (
          <div className="min-w-[200px]">
            <span className="mb-1 block text-xs font-medium text-muted">
              <Trans>Manager role</Trans>
            </span>
            <Select
              aria-label={t`Manager role`}
              className="w-full"
              options={managerOptions}
              value={managerValue}
              onChange={setManager}
              placeholder={t`Select manager`}
            />
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="primary" onPress={save}>
          <Trans>Save team</Trans>
        </Button>
      </div>
    </Surface>
  );
}
