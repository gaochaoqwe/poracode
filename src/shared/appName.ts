import { type AgentEmployeeChannel, productNameFor } from "./channel";

export function getAppName(channel: AgentEmployeeChannel, isDev: boolean): string {
  const base = productNameFor(channel);
  return isDev ? `${base} (dev)` : base;
}
