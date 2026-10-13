import { useEffect, useRef, type ReactNode } from "react";
import { Bot, ChevronDown, Image as ImageIcon, ListChecks, Terminal, X } from "lucide-react";
import { Tooltip } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ProjectLocation } from "@/shared/contracts";
import { pushEscapeHandler } from "@/renderer/components/layout/overlayEscapeStack";
import { floatingGlassSurfaceClass } from "@/renderer/components/layout/floatingGlass";
import { useAppStore } from "@/renderer/state/appStore";
import { useThreadGoalDockStore } from "@/renderer/state/threadGoalDockStore";
import { useThreadTodoDockStore } from "@/renderer/state/threadTodoDockStore";
import { useThreadDocksOverlayStore } from "@/renderer/state/threadDocksOverlayStore";
import { ActiveSubAgentTile } from "./ChatPane/parts/items/ActiveSubAgentTile";
import { ThreadBackgroundTasksDock } from "./ThreadBackgroundTasksDock";
import { ThreadGoalDock } from "./ThreadGoalDock";
import { ThreadImagesDock } from "./ThreadImagesDock";
import { ThreadTodoDock } from "./ThreadTodoDock";
import { ThreadDockHeaderSuppressed, ThreadDockIconButton } from "./ThreadDockUI";
import { useThreadGalleryImages } from "./useThreadGalleryImages";
import { selectThreadGoalDockItem } from "./threadGoalState";
import {
  useThreadDocksSummary,
  useVisibleThreadGoalDockState,
  useVisibleThreadTodoDockState,
} from "./useThreadDocksSummary";

/**
 * Floating top-right task panel. The thread's informational docks (goal, plan,
 * active agents, background tasks) plus the image gallery stack as compact
 * cards in one frosted-glass overlay, opened and closed by the header's
 * `ThreadDocksOverlayButton`. It closes on outside pointer-down and Escape,
 * matching the other floating surfaces in the app.
 */

/** A category group inside the floating task panel: a cc-haha-style section
 * header (icon + title + count or progress) over its flat dock rows. Each
 * category renders only when it has content, and every group but the first is
 * split off by a hairline. The docks inside are header-suppressed — this header
 * is the section title, so a dock's own header would only repeat it. */
function DocksGroup({
  icon: Icon,
  title,
  count,
  progress,
  actions,
  isFirst = false,
  children,
}: {
  icon: React.ElementType<{ className?: string }>;
  title: string;
  count?: number;
  progress?: { completed: number; total: number };
  actions?: ReactNode;
  isFirst?: boolean;
  children: ReactNode;
}) {
  const percent =
    progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  return (
    <section
      className={`flex flex-col ${isFirst ? "" : "border-t border-[color:var(--border)] pt-3"}`}
    >
      <div className="mb-1 flex items-center gap-2 px-2">
        <Icon className="size-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />
        <span className="truncate text-[12px] font-semibold text-[color:var(--muted)]">
          {title}
        </span>
        {progress ? (
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums text-[color:var(--muted)]">
            <span
              aria-hidden="true"
              className="h-1 w-[52px] overflow-hidden rounded-full bg-foreground/10"
            >
              <span
                className="block h-full rounded-full bg-success"
                style={{ width: `${percent}%` }}
              />
            </span>
            <span>
              {progress.completed}/{progress.total}
            </span>
          </span>
        ) : count !== undefined && count > 0 ? (
          <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-foreground/10 px-1 text-[10px] font-semibold tabular-nums text-foreground-muted">
            {count}
          </span>
        ) : null}
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      <ThreadDockHeaderSuppressed>
        <div className="space-y-1">{children}</div>
      </ThreadDockHeaderSuppressed>
    </section>
  );
}

/** Header button that toggles the floating task panel. */
export function ThreadDocksOverlayButton({ threadId }: { threadId: string }) {
  const { t } = useLingui();
  const open = useThreadDocksOverlayStore((s) => s.openThreadId === threadId);
  const toggle = useThreadDocksOverlayStore((s) => s.toggle);
  const goalDockState = useVisibleThreadGoalDockState(threadId);
  const todoDockState = useVisibleThreadTodoDockState(threadId);
  const summary = useThreadDocksSummary(threadId, goalDockState, todoDockState);
  // Live agent + background-task rows are the "something is happening" signal;
  // plan/goal presence is steady state, so only these count toward the badge.
  const activeCount = summary.agentCount + summary.backgroundTaskCount;
  return (
    <Tooltip delay={0}>
      <Tooltip.Trigger>
        <button
          type="button"
          data-thread-docks-trigger="true"
          aria-label={open ? t`Hide task panel` : t`Show task panel`}
          aria-pressed={open}
          className={`agentemployee-overlay-header__controls relative shrink-0 rounded p-1 transition-colors hover:bg-[var(--row-hover)] ${
            open ? "text-foreground" : "text-muted/60 hover:text-foreground"
          }`}
          onClick={(event) => {
            event.stopPropagation();
            toggle(threadId);
          }}
        >
          <ListChecks className="size-3.5" />
          {activeCount > 0 ? (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 text-[9px] font-semibold leading-none text-white tabular-nums"
            >
              {activeCount}
            </span>
          ) : null}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Content>
        <Trans>Task panel</Trans>
      </Tooltip.Content>
    </Tooltip>
  );
}

/** The floating glass panel body: the thread's informational docks stacked as cards. */
export function ThreadDocksOverlayPanel({
  threadId,
  projectLocation,
}: {
  threadId: string;
  projectLocation?: ProjectLocation;
}) {
  const { t } = useLingui();
  const open = useThreadDocksOverlayStore((s) => s.openThreadId === threadId);
  const close = useThreadDocksOverlayStore((s) => s.close);
  const goalDockState = useVisibleThreadGoalDockState(threadId);
  const goalDockItem = useAppStore((s) => selectThreadGoalDockItem(s, threadId));
  const todoDockState = useVisibleThreadTodoDockState(threadId);
  const todoDockCollapsed = useThreadTodoDockStore(
    (s) => s.byThreadId[threadId]?.collapsed ?? s.defaultCollapsed,
  );
  const summary = useThreadDocksSummary(threadId, goalDockState, todoDockState);
  const gallery = useThreadGalleryImages(threadId);
  const panelRef = useRef<HTMLDivElement>(null);

  // Whether this thread's plan group (goal / plan dock) has content to show.
  const hasPlanGroup = Boolean(goalDockState || todoDockState);
  // Track the previous plan presence so we only auto-open on the empty→content
  // transition (or when the panel mounts with a plan already present), never
  // re-open a panel the user explicitly closed.
  const prevHasPlanRef = useRef(false);
  useEffect(() => {
    if (hasPlanGroup && !prevHasPlanRef.current) {
      useThreadDocksOverlayStore.getState().open(threadId);
    }
    prevHasPlanRef.current = hasPlanGroup;
  }, [hasPlanGroup, threadId]);

  useEffect(() => {
    if (!open) return;
    const removeEscape = pushEscapeHandler(close);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (panelRef.current?.contains(target)) return;
      if (target?.closest("[data-thread-docks-trigger]")) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      removeEscape();
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, close]);

  if (!open) return null;

  const hasAgentsGroup = summary.agentCount > 0;
  const hasBackgroundGroup = summary.backgroundTaskCount > 0;
  const hasImagesGroup = gallery.length > 0;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t`Task panel`}
      data-testid="thread-docks-overlay"
      className={`absolute right-2 top-12 z-40 flex max-h-[min(600px,calc(100%-64px))] w-[340px] max-w-[calc(100%-16px)] flex-col overflow-hidden rounded-2xl ${floatingGlassSurfaceClass}`}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 pl-4 pr-3">
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-foreground">
          <Trans>Task panel</Trans>
        </h2>
        <button
          type="button"
          aria-label={t`Close task panel`}
          className="agentemployee-overlay-header__controls shrink-0 rounded p-1 text-muted/60 transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
          onClick={close}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 pt-0.5 [scrollbar-gutter:stable]">
        {hasPlanGroup ? (
          <DocksGroup
            icon={ListChecks}
            title={t`Plan`}
            isFirst
            {...(todoDockState
              ? {
                  progress: {
                    completed: todoDockState.steps.filter((step) => step.status === "completed")
                      .length,
                    total: todoDockState.steps.length,
                  },
                }
              : { count: goalDockState ? 1 : 0 })}
            actions={
              todoDockState ? (
                <>
                  <ThreadDockIconButton
                    label={todoDockCollapsed ? t`Expand todo dock` : t`Collapse todo dock`}
                    tooltip={todoDockCollapsed ? t`Expand` : t`Collapse`}
                    onPress={() =>
                      useThreadTodoDockStore.getState().setCollapsed(threadId, !todoDockCollapsed)
                    }
                  >
                    <ChevronDown
                      className={`size-3.5 transition-transform ${todoDockCollapsed ? "-rotate-90" : "rotate-0"}`}
                    />
                  </ThreadDockIconButton>
                  <ThreadDockIconButton
                    label={t`Close plan`}
                    danger
                    onPress={() =>
                      useThreadTodoDockStore.getState().retire(threadId, todoDockState.sourceItemId)
                    }
                  >
                    <X className="size-3.5" />
                  </ThreadDockIconButton>
                </>
              ) : null
            }
          >
            {goalDockState ? (
              <ThreadGoalDock
                threadId={threadId}
                state={goalDockState}
                placement="overlay"
                onDismiss={() => {
                  if (goalDockItem)
                    useThreadGoalDockStore.getState().dismiss(threadId, goalDockItem);
                }}
              />
            ) : null}
            {todoDockState ? (
              <ThreadTodoDock
                collapsed={todoDockCollapsed}
                placement="overlay"
                state={todoDockState}
                onCollapsedChange={(collapsed) =>
                  useThreadTodoDockStore.getState().setCollapsed(threadId, collapsed)
                }
                onRetire={() =>
                  useThreadTodoDockStore.getState().retire(threadId, todoDockState.sourceItemId)
                }
              />
            ) : null}
          </DocksGroup>
        ) : null}
        {hasAgentsGroup ? (
          <DocksGroup
            icon={Bot}
            title={t`Agents`}
            count={summary.agentCount}
            isFirst={!hasPlanGroup}
          >
            <ActiveSubAgentTile
              threadId={threadId}
              placement="overlay"
              {...(projectLocation ? { projectLocation } : {})}
            />
          </DocksGroup>
        ) : null}
        {hasBackgroundGroup ? (
          <DocksGroup
            icon={Terminal}
            title={t`Background tasks`}
            count={summary.backgroundTaskCount}
            isFirst={!hasPlanGroup && !hasAgentsGroup}
          >
            <ThreadBackgroundTasksDock threadId={threadId} placement="overlay" />
          </DocksGroup>
        ) : null}
        {hasImagesGroup ? (
          <DocksGroup
            icon={ImageIcon}
            title={t`Images`}
            count={gallery.length}
            isFirst={!hasPlanGroup && !hasAgentsGroup && !hasBackgroundGroup}
          >
            <ThreadImagesDock gallery={gallery} placement="overlay" />
          </DocksGroup>
        ) : null}
      </div>
    </div>
  );
}
