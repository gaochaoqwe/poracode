import type { CSSProperties, ReactNode } from "react";
import { TOKENS } from "./tokens";
import { STATUS_COLORS, statusBadgeLabel, type MunderStatus } from "./status";

/**
 * Pixel DOM primitives per DESIGN.md §6/§7: SNES three-layer panel borders
 * (nested inset box-shadows, zero radius), 3D-press buttons, status badges.
 * Fonts: Press Start 2P / Pixelify Sans / VT323 are not vendored in this repo,
 * so every text element degrades to a monospace stack (noted per DESIGN §4).
 */

const css = (hex: number): string => `#${hex.toString(16).padStart(6, "0")}`;
const rgba = (hex: number, alpha: number): string => {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/** §6.1: outer ink-900 2px + middle cream-200 2px + inner ink-700 1px. */
export function PixelPanel(props: {
  children: ReactNode;
  accent?: number | undefined;
  title?: string | undefined;
  style?: CSSProperties | undefined;
}) {
  const middle = props.accent ?? TOKENS.cream200;
  return (
    <div
      style={{
        backgroundColor: css(TOKENS.cream100),
        boxShadow: `inset 0 0 0 2px ${css(TOKENS.ink900)}, inset 0 0 0 4px ${css(middle)}, inset 0 0 0 5px ${css(TOKENS.ink700)}`,
        padding: 12,
        borderRadius: 0,
        fontFamily: "monospace",
        ...props.style,
      }}
    >
      {props.title ? (
        <div
          style={{
            fontSize: 12,
            color: css(TOKENS.ink900),
            marginBottom: 8,
            textTransform: "lowercase",
          }}
        >
          {props.title}
        </div>
      ) : null}
      {props.children}
    </div>
  );
}

/** §7.2: chunky pressable — bright top, dark bottom, 2px translate on :active. */
export function PixelButton(props: {
  children: ReactNode;
  onClick?: (() => void) | undefined;
  variant?: "primary" | "secondary" | "destructive" | undefined;
}) {
  const variant = props.variant ?? "secondary";
  const fill =
    variant === "primary"
      ? TOKENS.ink900
      : variant === "destructive"
        ? STATUS_COLORS.blocked
        : TOKENS.cream100;
  const text = variant === "primary" || variant === "destructive" ? TOKENS.cream50 : TOKENS.ink900;
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        backgroundColor: css(fill),
        color: css(text),
        border: `2px solid ${css(TOKENS.ink900)}`,
        boxShadow: `0 3px 0 ${css(TOKENS.ink900)}`,
        borderRadius: 0,
        padding: "4px 10px",
        fontSize: 12,
        fontFamily: "monospace",
        cursor: "pointer",
      }}
    >
      {props.children}
    </button>
  );
}

/** §7.3: 8px status dot + lowercase label, status color at 20% over cream. */
export function PixelBadge(props: { status: MunderStatus; label?: string | undefined }) {
  const color = STATUS_COLORS[props.status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        backgroundColor: rgba(color, 0.2),
        border: `1px solid ${css(TOKENS.ink700)}`,
        padding: "2px 6px",
        borderRadius: 0,
        fontSize: 12,
        fontFamily: "monospace",
        color: css(TOKENS.ink900),
      }}
    >
      <span aria-hidden="true" style={{ width: 8, height: 8, backgroundColor: css(color) }} />
      {props.label ?? statusBadgeLabel(props.status)}
    </span>
  );
}
