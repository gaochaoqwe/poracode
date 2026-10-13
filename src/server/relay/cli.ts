import { installShutdown, reportFatalStartupError } from "../cliRuntime";
import { RelayServer } from "./relayServer";

/**
 * Standalone, self-hostable AgentEmployee relay (docs/REMOTE_ARCHITECTURE.md, Phase
 * 5). Run it on a public host; AgentEmployee servers behind NAT dial it and devices
 * reach them at `<publicBaseUrl>/s/<serverId>/`.
 *
 *   AGENTEMPLOYEE_RELAY_HOST            bind host (default 0.0.0.0)
 *   AGENTEMPLOYEE_RELAY_PORT            bind port (default 38990)
 *   AGENTEMPLOYEE_RELAY_PUBLIC_BASE_URL public base advertised to hosts/devices
 */
async function main(): Promise<void> {
  const port = Number(process.env.AGENTEMPLOYEE_RELAY_PORT?.trim() || "38990");
  const relay = new RelayServer({
    host: process.env.AGENTEMPLOYEE_RELAY_HOST?.trim() || "0.0.0.0",
    port: Number.isSafeInteger(port) ? port : 38990,
    ...(process.env.AGENTEMPLOYEE_RELAY_PUBLIC_BASE_URL?.trim()
      ? { publicBaseUrl: process.env.AGENTEMPLOYEE_RELAY_PUBLIC_BASE_URL.trim() }
      : {}),
  });
  const info = await relay.start();
  console.log("[agentemployee-relay] listening on port %d", info.port);
  console.log("[agentemployee-relay] public base:   %s", info.url);
  console.log("[agentemployee-relay] host control:  %s/host", info.url.replace(/^http/, "ws"));

  installShutdown("[agentemployee-relay]", () => relay.dispose());
}

main().catch((error) => reportFatalStartupError("[agentemployee-relay]", error));
