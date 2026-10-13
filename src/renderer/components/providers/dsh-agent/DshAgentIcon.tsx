import { createProviderIcon } from "../common/createProviderIcon";

// dshAgent brand mark — a bold "D" letterform inside a rounded square, evoking
// DeepSeek Harness's blue whale glyph under its own CSS prefix.
const DSH_AGENT_PATH =
  "M4 2.5A2.5 2.5 0 0 1 6.5 0h3A2.5 2.5 0 0 1 12 2.5v3A2.5 2.5 0 0 1 9.5 8h-1.9a.4.4 0 0 0-.4.4V12H4V2.5Z" +
  "M5.5 4v2.8h3.1a1 1 0 0 0 1-1 1 1 0 0 0-1-1H5.5Z" +
  "M4.5 13h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1Z";

export const DshAgentIcon = createProviderIcon({
  cssPrefix: "agentemployee-dsh-agent-icon",
  path: DSH_AGENT_PATH,
  viewBox: "0 0 16 16",
  brand: { light: "#2563EB", dark: "#60A5FA" },
});
