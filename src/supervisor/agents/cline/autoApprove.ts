/**
 * Cline's blanket auto-approval switch.
 *
 * Cline exposes auto-approval over ACP only as a boolean session config option
 * (`{ type: "boolean", id: "auto_approve", name: "Auto-approve tools" }`). Its
 * permission options are a dead end: Cline's ACP handler maps `allow_always`
 * and `allow_once` to the same single-call approval and persists nothing, so
 * "Allow always" cannot stick through the permission channel. Declaring the
 * config option here lets the shared ACP runtime drive it instead — see
 * `autoApproveConfigOptionId` in `../acp/session.ts`.
 *
 * The id lives in the Cline folder so no shared file names a provider; the
 * shared side only reads it as a declared capability.
 */
export const CLINE_AUTO_APPROVE_CONFIG_OPTION_ID = "auto_approve";
