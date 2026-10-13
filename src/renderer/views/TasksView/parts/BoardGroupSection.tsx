import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface BoardGroupSectionProps {
  /** Already localized by the caller. */
  label: string;
  count: number;
  /** `category` is the lane's top split; `project` nests one level under it. */
  variant: "category" | "project";
  children: ReactNode;
}

const HEADING_CLASS: Record<BoardGroupSectionProps["variant"], string> = {
  category: "text-[11px] font-semibold uppercase tracking-wide",
  project: "text-[11px] font-medium normal-case",
};

const WRAPPER_CLASS: Record<BoardGroupSectionProps["variant"], string> = {
  category: "flex min-w-0 flex-col gap-2",
  // A hairline on the left reads as "belongs to the heading above".
  project: "flex min-w-0 flex-col gap-2 border-l border-[var(--hairline)] pl-2.5",
};

/**
 * One collapsible heading over a group of cards, used at both board levels: the
 * category split inside a lane, and the project split inside a category. Every
 * group starts expanded so the board reads at a glance.
 */
export function BoardGroupSection(props: BoardGroupSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className={WRAPPER_CLASS[props.variant]}>
      <button
        type="button"
        aria-expanded={!collapsed}
        className={`flex min-w-0 items-center gap-1.5 rounded-md px-0.5 text-left text-muted hover:text-foreground ${HEADING_CLASS[props.variant]}`}
        onClick={() => setCollapsed((value) => !value)}
      >
        <ChevronDown
          className={`size-3.5 shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`}
          aria-hidden="true"
        />
        <span className="min-w-0 truncate">{props.label}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{props.count}</span>
      </button>
      {collapsed ? null : <div className="flex min-w-0 flex-col gap-3">{props.children}</div>}
    </section>
  );
}
