import mascotBuild from "@/renderer/assets/agent-mascots/agent-mascot-build.png";
import mascotCheck from "@/renderer/assets/agent-mascots/agent-mascot-check.png";
import mascotCode from "@/renderer/assets/agent-mascots/agent-mascot-code.png";
import mascotData from "@/renderer/assets/agent-mascots/agent-mascot-data.png";
import mascotDesign from "@/renderer/assets/agent-mascots/agent-mascot-design.png";
import mascotDocs from "@/renderer/assets/agent-mascots/agent-mascot-docs.png";
import mascotFix from "@/renderer/assets/agent-mascots/agent-mascot-fix.png";
import mascotPlan from "@/renderer/assets/agent-mascots/agent-mascot-plan.png";
import mascotRelease from "@/renderer/assets/agent-mascots/agent-mascot-release.png";
import mascotSearch from "@/renderer/assets/agent-mascots/agent-mascot-search.png";
import mascotShield from "@/renderer/assets/agent-mascots/agent-mascot-shield.png";
import mascotTerminal from "@/renderer/assets/agent-mascots/agent-mascot-terminal.png";

/** A subagent's display state, normalized to the four tones the mascot draws. */
export type AgentMascotStatus =
  | "running"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "idle"
  | "stopped"
  | "error"
  | "pending";

export const AGENT_MASCOT_VARIANTS = [
  "code",
  "check",
  "plan",
  "shield",
  "docs",
  "terminal",
  "search",
  "release",
  "build",
  "fix",
  "design",
  "data",
] as const;

export type AgentMascotVariant = (typeof AGENT_MASCOT_VARIANTS)[number];

const MASCOT_IMAGE_BY_VARIANT: Record<AgentMascotVariant, string> = {
  build: mascotBuild,
  check: mascotCheck,
  code: mascotCode,
  data: mascotData,
  design: mascotDesign,
  docs: mascotDocs,
  fix: mascotFix,
  plan: mascotPlan,
  release: mascotRelease,
  search: mascotSearch,
  shield: mascotShield,
  terminal: mascotTerminal,
};

/** Stable, order-independent hash so a subagent keeps the same mascot across mounts. */
export function stableAgentMascotHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function resolveMascotTone(status: AgentMascotStatus): "accent" | "success" | "danger" | "muted" {
  if (status === "failed" || status === "error" || status === "stopped" || status === "cancelled") {
    return "danger";
  }
  if (status === "completed" || status === "idle") return "success";
  if (status === "running" || status === "in_progress") return "accent";
  return "muted";
}

function ringClassName(tone: "accent" | "success" | "danger" | "muted"): string {
  if (tone === "danger") {
    return "border-[color:color-mix(in_srgb,var(--danger)_42%,transparent)]";
  }
  if (tone === "success") {
    return "border-[color:color-mix(in_srgb,var(--success)_34%,transparent)]";
  }
  if (tone === "muted") {
    return "border-[color:color-mix(in_srgb,var(--muted)_24%,transparent)]";
  }
  // Running is information, not brand: read blue as "in progress".
  return "border-[color:color-mix(in_srgb,var(--accent)_42%,transparent)]";
}

/**
 * The agent mascot used for subagent / workflow / background rows. Mirrors the
 * cc-haha desktop's `AgentMascot`: a per-agent mascot glyph chosen stably from
 * the seed, framed by a tone ring that reflects the row's state, with a spinning
 * progress ring while running. Logo assets are copied from cc-haha's desktop.
 */
export function AgentMascot({ seed, status }: { seed: string; status: AgentMascotStatus }) {
  const normalizedSeed = seed.trim() || "agent";
  const variant =
    AGENT_MASCOT_VARIANTS[stableAgentMascotHash(normalizedSeed) % AGENT_MASCOT_VARIANTS.length] ??
    "code";
  const tone = resolveMascotTone(status);
  const isActive = status === "running" || status === "in_progress";
  const imageSrc = MASCOT_IMAGE_BY_VARIANT[variant];

  return (
    <span
      data-testid="agent-mascot"
      data-agent-mascot-variant={variant}
      data-agent-mascot-state={status}
      className={`relative inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border bg-[var(--content-background)] ${ringClassName(tone)}`}
      aria-hidden="true"
    >
      {isActive ? (
        <span
          data-testid="agent-mascot-motion-ring"
          className="absolute -inset-0.5 rounded-[10px] border border-transparent border-t-[color:var(--accent)] opacity-80 motion-safe:animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : null}
      <img
        src={imageSrc}
        alt=""
        draggable={false}
        className="relative h-[34px] w-[34px] max-w-none select-none object-contain"
      />
    </span>
  );
}
