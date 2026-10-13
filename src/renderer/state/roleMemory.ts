import { msg } from "@lingui/core/macro";
import { i18n } from "@/renderer/i18n/i18n";
import type { Workspace } from "@/shared/contracts";

/**
 * P1-04 岗位级记忆注入。
 *
 * A role (岗位) is an employee whose identity — persona, responsibilities, and
 * capability tags — is persisted on the workspace entity. That is the role's
 * long-lived memory. This module folds it into a compact context block injected
 * as the leading section of a task the role picks up (see
 * `scenarioActions.applyScenario`), so the agent that runs the task "remembers"
 * which employee it is and what it is responsible for.
 *
 * Isolation is by construction: only the active role's block is injected, and it
 * is only injected into that role's own task drafts — another role's threads
 * never see it.
 */
export function buildRoleContextBlock(
  workspace: Pick<Workspace, "persona" | "responsibilities" | "capabilityTags">,
): string {
  const lines: string[] = [];
  if (workspace.persona && workspace.persona.trim().length > 0) {
    lines.push(`${i18n._(msg`Role`)}: ${workspace.persona.trim()}`);
  }
  if (workspace.responsibilities && workspace.responsibilities.length > 0) {
    lines.push(
      `${i18n._(msg`Responsibilities`)}:\n${workspace.responsibilities.join("\n")}`,
    );
  }
  if (workspace.capabilityTags && workspace.capabilityTags.length > 0) {
    lines.push(
      `${i18n._(msg`Capabilities`)}: ${workspace.capabilityTags.join(", ")}`,
    );
  }
  return lines.join("\n\n");
}
