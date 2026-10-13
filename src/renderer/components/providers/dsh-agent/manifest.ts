import { msg } from "@lingui/core/macro";
import type { RendererProviderManifest } from "../providerManifest";

export default {
  kind: "dsh-agent",
  label: msg`dshAgent`,
  // First-class position right beside the gdsAgent offline ACP harness, since
  // dshAgent is the same "bring your own OpenAI-compatible endpoint" family.
  order: 16,
} satisfies RendererProviderManifest;
