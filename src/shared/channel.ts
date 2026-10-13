export type AgentEmployeeChannel = "stable" | "nightly";

export const AGENTEMPLOYEE_CHANNELS: readonly AgentEmployeeChannel[] = ["stable", "nightly"];

declare const __AGENTEMPLOYEE_CHANNEL__: string | undefined;

export function normalizeChannel(value: unknown): AgentEmployeeChannel {
  return value === "nightly" ? "nightly" : "stable";
}

export function resolveAgentEmployeeChannel(): AgentEmployeeChannel {
  return normalizeChannel(typeof __AGENTEMPLOYEE_CHANNEL__ === "string" ? __AGENTEMPLOYEE_CHANNEL__ : "");
}

export function productNameFor(channel: AgentEmployeeChannel): string {
  return channel === "nightly" ? "AgentEmployee Nightly" : "AgentEmployee";
}

export function appIdFor(channel: AgentEmployeeChannel): string {
  // Keep the pre-rebrand install identity so AgentEmployee upgrades the existing
  // Lightcode app and retains OS-owned credentials, permissions, and metadata.
  return channel === "nightly" ? "com.lightcode.app.nightly" : "com.lightcode.app";
}

export function userDataDirNameFor(channel: AgentEmployeeChannel): string {
  return channel === "nightly" ? ".agentemployee-nightly" : ".agentemployee";
}

export function updaterChannelFor(channel: AgentEmployeeChannel): string | undefined {
  return channel === "nightly" ? "nightly" : undefined;
}

export function artifactPrefixFor(channel: AgentEmployeeChannel): string {
  return channel === "nightly" ? "AgentEmployee-Nightly" : "AgentEmployee";
}
