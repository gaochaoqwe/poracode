import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { ScenarioCard } from "@/renderer/components/scenarios/ScenarioCard";
import type { ScenarioView } from "@/renderer/scenarios/catalog";

/**
 * The welcome panel's scenario cards: one row of three, with arrow buttons for
 * whatever does not fit. A single row keeps the panel a fixed height whatever
 * the category carries — Software coding alone has eight scenarios — instead of
 * growing the draft and pushing the composer around.
 */
export function WelcomeScenarioRail(props: {
  scenarios: readonly ScenarioView[];
  onStart: (scenario: ScenarioView) => void;
}) {
  const { t } = useLingui();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const scenarioCount = props.scenarios.length;

  // Re-armed per scenario list: switching category reuses the same viewport, so
  // its scroll position and overflow both start over.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const syncEdges = () => {
      // A row that fits end to end has no edges to reach.
      const overflowing = scenarioCount > 3 && viewport.scrollWidth > viewport.clientWidth + 1;
      setAtStart(!overflowing || viewport.scrollLeft <= 1);
      setAtEnd(
        !overflowing || viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 1,
      );
    };
    syncEdges();
    viewport.addEventListener("scroll", syncEdges, { passive: true });
    const observer = new ResizeObserver(syncEdges);
    observer.observe(viewport);
    return () => {
      viewport.removeEventListener("scroll", syncEdges);
      observer.disconnect();
    };
  }, [scenarioCount]);

  const scrollByPage = (direction: -1 | 1) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // Instant, not `behavior: "smooth"`: the app window reports smooth scrolling
    // as a no-op (verified in the packaged renderer), which would leave the
    // arrows doing nothing at all.
    viewport.scrollBy({ left: direction * Math.max(180, viewport.clientWidth * 0.4) });
  };

  const scrollable = scenarioCount > 3;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {scrollable ? (
        <RailArrow
          direction="start"
          label={t`Previous scenarios`}
          disabled={atStart}
          onClick={() => scrollByPage(-1)}
        />
      ) : null}
      <div ref={viewportRef} className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto">
        {props.scenarios.map((scenario) => (
          <div key={scenario.id} className="w-[calc((100%-1rem)/3)] shrink-0">
            <ScenarioCard scenario={scenario} compact onStart={() => props.onStart(scenario)} />
          </div>
        ))}
      </div>
      {scrollable ? (
        <RailArrow
          direction="end"
          label={t`Next scenarios`}
          disabled={atEnd}
          onClick={() => scrollByPage(1)}
        />
      ) : null}
    </div>
  );
}

function RailArrow(props: {
  direction: "start" | "end";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = props.direction === "start" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border/40 text-muted transition-colors enabled:hover:border-border enabled:hover:bg-[var(--row-hover)] enabled:hover:text-foreground disabled:opacity-30"
    >
      <Icon aria-hidden className="size-3.5" />
    </button>
  );
}
