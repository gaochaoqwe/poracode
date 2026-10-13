/**
 * Application-settings sections. Scenarios, Skills, and Connectors (plugins +
 * MCP servers) are NOT here — they live on the standalone Capabilities page
 * (see `views/CapabilitiesOverlay`).
 */
export type SettingsSection =
  | "profile"
  | "workspaces"
  | "general"
  | "audio"
  | "appearance"
  | "terminal"
  | "threads"
  | "git"
  | "worktrees"
  | "notifications"
  | "ai"
  | "acpRegistry"
  | "agentsGeneral"
  | "remoteAccess"
  | "remoteServers"
  | "search"
  | "shortcuts"
  | "agents"
  | "browser"
  | "usage"
  | "archived"
  | "changelog"
  | "about"
  | "dev"
  | `agents:${string}`;
