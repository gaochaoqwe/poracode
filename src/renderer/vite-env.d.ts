/// <reference types="vite/client" />

import type { AgentEmployeeBridge } from "@/shared/ipc";

declare global {
  interface Window {
    agentemployee: AgentEmployeeBridge;
  }
}
