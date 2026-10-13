import { z } from "zod";
import { definePayloadProcedure } from "../core";

/**
 * Offline gdsAgent install from a user-picked local `gdsAgent.exe`.
 *
 * Kept as a dedicated procedure (not a generic agent installer) because the
 * package shape, PE checks, backend-mode version probe, and marker layout are
 * gdsAgent (gdsAgent)-specific. Channel resolves to
 * `agentemployee:install-gds-agent-offline`.
 */
export const installGdsAgentOfflinePayloadSchema = z.object({
  agentKind: z.literal("gds-agent"),
  sourcePath: z.string().min(1),
});

export type InstallGdsAgentOfflinePayload = z.infer<
  typeof installGdsAgentOfflinePayloadSchema
>;

export interface InstallGdsAgentOfflineIpcResult {
  readonly ok: boolean;
  readonly installDir?: string;
  readonly version?: string;
  readonly reason?: string;
}

export const gdsAgentProcedures = {
  installGdsAgentOffline: definePayloadProcedure<
    InstallGdsAgentOfflinePayload,
    InstallGdsAgentOfflineIpcResult,
    "main-local"
  >("installGdsAgentOffline", "main-local", installGdsAgentOfflinePayloadSchema),
} as const;
