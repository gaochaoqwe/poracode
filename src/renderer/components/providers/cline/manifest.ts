import { msg } from "@lingui/core/macro";
import type { RendererProviderManifest } from "../providerManifest";

export default {
  kind: "cline",
  label: msg`Cline`,
  // First-class position — Cline ships as AgentEmployee's recommended default.
  order: 0,
} satisfies RendererProviderManifest;
