import { z } from "zod";
import { definePayloadProcedure } from "../core";

/**
 * Offline Cline install from a user-picked local `cline.exe`.
 *
 * Kept as a dedicated procedure (not a generic agent installer) because the
 * package shape, PE checks, and marker layout are Cline-specific. Channel
 * resolves to `agentemployee:install-cline-offline`.
 */
export const installClineOfflinePayloadSchema = z.object({
  agentKind: z.literal("cline"),
  sourcePath: z.string().min(1),
});

export type InstallClineOfflinePayload = z.infer<typeof installClineOfflinePayloadSchema>;

export interface InstallClineOfflineIpcResult {
  readonly ok: boolean;
  readonly installDir?: string;
  readonly version?: string;
  readonly reason?: string;
}

export const clineProcedures = {
  installClineOffline: definePayloadProcedure<
    InstallClineOfflinePayload,
    InstallClineOfflineIpcResult,
    "main-local"
  >("installClineOffline", "main-local", installClineOfflinePayloadSchema),
} as const;
