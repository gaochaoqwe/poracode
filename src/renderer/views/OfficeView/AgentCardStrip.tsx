import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import { PixelBadge, PixelPanel } from "./pixel";
import { TOKENS } from "./tokens";
import type { MunderStatus } from "./status";

const css = (hex: number): string => `#${hex.toString(16).padStart(6, "0")}`;

/**
 * §7.4 AgentCard (bottom strip): 200×80 pixel cards in a horizontal scroll.
 * Top row: 32×32 portrait + name + status badge. Mid row: current project +
 * current tool/action. Bottom row: 8-segment progress dots filled by real
 * context usage. Selected (active thread) card gets the accent middle border.
 */

export interface AgentCardData {
  workspaceId: string;
  name: string;
  agentKind?: string | undefined;
  accent: number;
  status: MunderStatus;
  projectName?: string | undefined;
  toolName?: string | undefined;
  usedTokens?: number | undefined;
  maxTokens?: number | undefined;
  active: boolean;
  /** Level-2 rank 1-3, shown as a pixel-dot row under the name. */
  rank?: 1 | 2 | 3 | undefined;
}

/** Fill count (0–8) for the segment dots from real context usage. */
export function contextProgressSegments(usage: {
  usedTokens?: number | undefined;
  maxTokens?: number | undefined;
}): number {
  if (!usage.maxTokens || !usage.usedTokens) return 0;
  const ratio = Math.min(1, Math.max(0, usage.usedTokens / usage.maxTokens));
  return Math.round(ratio * 8);
}

export function AgentCardStrip(props: {
  cards: AgentCardData[];
  onCardClick: (workspaceId: string) => void;
}) {
  return (
    <div
      className="flex shrink-0 gap-3 overflow-x-auto px-3 py-2"
      style={{ borderTop: `2px solid ${css(TOKENS.ink900)}`, backgroundColor: css(TOKENS.cream50) }}
    >
      {props.cards.map((card) => (
        <button
          key={card.workspaceId}
          type="button"
          aria-label={card.name}
          onClick={() => props.onCardClick(card.workspaceId)}
          style={{
            display: "block",
            padding: 0,
            border: "none",
            background: "none",
            cursor: "pointer",
          }}
        >
          <PixelPanel accent={card.active ? card.accent : undefined} style={{ width: 200 }}>
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex size-8 items-center justify-center"
                style={{
                  border: `2px solid ${css(TOKENS.ink900)}`,
                  backgroundColor: css(card.accent),
                }}
              >
                {card.agentKind ? <ProviderIcon kind={card.agentKind} className="size-4" /> : null}
              </span>
              <span
                style={{
                  fontSize: 14,
                  color: css(TOKENS.ink900),
                  fontFamily: "monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {card.name}
              </span>
              <PixelBadge status={card.status} />
            </div>
            {card.rank !== undefined ? (
              <div className="mt-1 flex gap-0.5" aria-hidden="true">
                {Array.from({ length: card.rank }, (_, i) => (
                  <span
                    key={i}
                    style={{ width: 6, height: 4, backgroundColor: css(TOKENS.ink900) }}
                  />
                ))}
              </div>
            ) : null}
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                color: css(TOKENS.ink500),
                fontFamily: "monospace",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {card.projectName ?? "—"}
            </div>
            <div
              style={{
                fontSize: 12,
                color: css(TOKENS.ink700),
                fontFamily: "monospace",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {card.toolName ?? "standby"}
            </div>
            <div className="mt-1.5 flex gap-0.5" aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => (
                <span
                  key={i}
                  style={{
                    width: 8,
                    height: 4,
                    backgroundColor:
                      i <
                      contextProgressSegments({
                        usedTokens: card.usedTokens,
                        maxTokens: card.maxTokens,
                      })
                        ? css(card.accent)
                        : css(TOKENS.cream200),
                    border: `1px solid ${css(TOKENS.ink700)}`,
                  }}
                />
              ))}
            </div>
          </PixelPanel>
        </button>
      ))}
    </div>
  );
}
