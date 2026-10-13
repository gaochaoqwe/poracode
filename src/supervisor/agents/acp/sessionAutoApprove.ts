/**
 * Mapping between a thread's approval posture and an adapter-declared boolean
 * ACP config option that is the agent's blanket auto-approval switch.
 *
 * Provider-agnostic: the option id is declared by the adapter (see
 * `autoApproveConfigOptionId` in `session.ts`); these helpers only translate
 * AgentEmployee's approval vocabulary (see `unrestrictedPermissions.ts`).
 */
import type { ThreadConfig } from "@/shared/contracts";
import { isFullBypassApprovalPolicy } from "@/shared/agents/unrestrictedPermissions";

/**
 * The approval-policy id a thread holds while its blanket auto-approval switch
 * is on. A full-bypass id, so `isFullBypassApprovalPolicy` stays true.
 */
const AUTO_APPROVE_POLICY = "never";

/**
 * The approval-policy id a thread falls back to when the agent turns its
 * blanket auto-approval switch off.
 */
const SUPERVISED_POLICY = "default";

/**
 * Whether a thread config wants the agent's blanket auto-approval switch on.
 * Plan mode is excluded: it is a read-only review posture, and the existing
 * synthetic auto-approve path excludes it too.
 */
export function resolveAutoApproveTarget(config: ThreadConfig): boolean {
  return config.mode !== "plan" && isFullBypassApprovalPolicy(config.approvalPolicy);
}

/**
 * Fold an agent-reported boolean switch value back into the thread config.
 *
 * Returns `undefined` when the config already agrees (no change to emit).
 * Enabling always asserts the thread's full-bypass posture (that is what the
 * switch *means*); disabling only rewrites a full-bypass posture back to the
 * supervised default, so an unrelated policy such as `act` is never clobbered.
 */
export function applyAutoApproveToConfig(
  config: ThreadConfig,
  enabled: boolean,
): ThreadConfig | undefined {
  if (enabled) {
    if (config.mode === "plan" || isFullBypassApprovalPolicy(config.approvalPolicy)) {
      return undefined;
    }
    return { ...config, approvalPolicy: AUTO_APPROVE_POLICY };
  }
  if (isFullBypassApprovalPolicy(config.approvalPolicy)) {
    return { ...config, approvalPolicy: SUPERVISED_POLICY };
  }
  return undefined;
}
