import { useEffect, useState, useRef } from "react";
import { FolderPlus, MessageSquareText } from "lucide-react";
import { Button } from "@heroui/react";
import { Trans } from "@lingui/react/macro";
import { isHomeProject } from "@/shared/homeScope";
import { loadHomeScopeLocation } from "@/renderer/actions/projectActions";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import {
  isWelcomeSeen,
  useWelcomeGateStore,
  WELCOME_SEEN_STORAGE_KEY,
} from "@/renderer/state/welcomeGateStore";
import { writeStoredBoolean } from "@/renderer/utils/localStorage";
import { AgentEmployeeMark } from "@/renderer/components/common/AgentEmployeeMark";
import { BrandWordmark } from "@/renderer/components/common/BrandWordmark";
import { CreateProjectMenu } from "@/renderer/views/MainView/parts/CreateProject/CreateProjectMenu";
import { WELCOME_BACKGROUND_CODE } from "./welcomeBackgroundCode";

// Orbit + reveal animations finish ~2.4s after the overlay mounts. After
// that the agent nodes have scaled to 0 and no longer need their center
// sampled, so the rAF loop driving `--comet-x/y` can stop.
const ORBIT_DURATION_MS = 2400;

// Three "agent" nodes evenly spaced around the ring spin inward and converge
// on the mark — many agents, one employee. Angles are the static starting
// offsets; the shared orbit keyframes supply the rotation and inward scale.
const WELCOME_ORBIT_NODES = [0, 120, 240] as const;

// `--comet-x/y` are the centers of a full-viewport background gradient
// (`.agentemployee-welcome-bg-glow`) AND a mask over the glyph-heavy code wall
// (`.agentemployee-welcome-code-wall`). Neither `background-position` nor
// `mask-image` is compositor-animatable, so each write re-rasterizes the
// viewport on the main thread. Writing them on every display refresh
// (~120fps on high-refresh panels) is what drops frames — the diffuse glow
// only needs a handful of updates per second. Gate the write to the shared
// ~20fps cadence (matches `thinkingAnimator.ts` TICK_MS) so the frame
// pipeline idles between ticks instead of stalling on per-frame repaints.
const COMET_LIGHT_TICK_MS = 50; // ~20fps

// The intro reveal fully settles ~3.2s after mount — the CTA buttons carry the
// latest reveal (2.4s delay + 0.8s duration). Until then we hold first-launch
// background work (agent detection) so its cold process spawns and re-render
// churn don't starve the animation's first paint and snap it to its final
// frame. A user who clicks a CTA sooner releases the gate immediately in
// `dismissWelcome`.
const WELCOME_SETTLE_MS = 3200;

export function WelcomeOverlay() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cometRef = useRef<HTMLSpanElement>(null);
  const mouseRafRef = useRef<number | null>(null);
  const mousePosRef = useRef<{ x: number; y: number } | null>(null);
  const containerRectRef = useRef<DOMRect | null>(null);

  const homeScopeEnabled = useSharedSettings((state) => state.homeScopeEnabled);
  const setHomeScopeEnabled = useSharedSettings((state) => state.setHomeScopeEnabled);
  const openDraft = useAppStore((state) => state.openDraft);

  // `welcomeSeen` is resolved synchronously from localStorage (or the dev-only
  // manual-test bypass) so the overlay's open state is known on the very first
  // render — no async settings gate, so the main UI never paints uncovered
  // behind the overlay on first launch.
  const [welcomeSeen, setWelcomeSeen] = useState(isWelcomeSeen);
  const open = !welcomeSeen;
  const [mounted, setMounted] = useState(open);
  // Initialize `visible` to `open` so the overlay is fully opaque on first
  // paint — the inner reveal/orbit animations are driven by CSS keyframes,
  // not by toggling `visible`, so we don't need a RAF flip on entry.
  const [visible, setVisible] = useState(open);

  // `open` derives from `welcomeSeen` and only ever flips true → false via
  // dismissWelcome. Drive the exit fade during render instead of an effect so
  // the transition starts on the same frame the CTA commits (and the entry
  // path needs no effect at all — the initial states already match `open`).
  // `mounted` stays until the fade's transitionend releases it below.
  if (open) {
    if (!mounted || !visible) {
      setMounted(true);
      setVisible(true);
    }
  } else if (visible) {
    setVisible(false);
  }

  // First launch only: defer heavy background work until the intro animation
  // has settled, then release the gate so MainView can start agent detection.
  useEffect(() => {
    if (!open) return;
    const releaseTimer = window.setTimeout(() => {
      useWelcomeGateStore.getState().releaseBackgroundWork();
    }, WELCOME_SETTLE_MS);
    return () => clearTimeout(releaseTimer);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    // Honor reduced motion: the agent nodes are hidden by CSS in this mode, so
    // leave the glow parked at its off-screen default rather than sampling it.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const container = containerRef.current;
    const comet = cometRef.current;
    if (!container || !comet) return;
    // `fixed inset-0` => the container's box origin is stable for the orbit's
    // lifetime, so sample it once (as the mousemove handler already caches its
    // rect) instead of forcing a synchronous layout read every frame.
    const containerRect = container.getBoundingClientRect();
    let rafId = 0;
    let stopped = false;
    // NEGATIVE_INFINITY so the first frame writes immediately — no one-frame
    // gap where the glow sits at its off-screen default.
    let lastWriteAt = Number.NEGATIVE_INFINITY;
    const updateCometLight = (now: number) => {
      if (stopped) return;
      // Throttle the expensive (non-compositable) write to ~20fps; skipped
      // frames cost only a timestamp compare + reschedule.
      if (now - lastWriteAt >= COMET_LIGHT_TICK_MS) {
        lastWriteAt = now;
        const cometRect = comet.getBoundingClientRect();
        const cx = cometRect.left + cometRect.width / 2 - containerRect.left;
        const cy = cometRect.top + cometRect.height / 2 - containerRect.top;
        container.style.setProperty("--comet-x", `${cx}px`);
        container.style.setProperty("--comet-y", `${cy}px`);
      }
      rafId = requestAnimationFrame(updateCometLight);
    };
    rafId = requestAnimationFrame(updateCometLight);
    const stopTimer = window.setTimeout(() => {
      stopped = true;
      cancelAnimationFrame(rafId);
    }, ORBIT_DURATION_MS);
    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      clearTimeout(stopTimer);
    };
  }, [mounted]);

  function handleTransitionEnd(e: React.TransitionEvent) {
    if (e.target === e.currentTarget && !visible) {
      setMounted(false);
    }
  }

  function dismissWelcome() {
    writeStoredBoolean(WELCOME_SEEN_STORAGE_KEY, true);
    setWelcomeSeen(true);
    // The user is moving on — let deferred startup work (agent detection) run
    // now rather than waiting out the settle timer.
    useWelcomeGateStore.getState().releaseBackgroundWork();
  }

  function handleAskQuestion() {
    if (!homeScopeEnabled) {
      setHomeScopeEnabled(true);
    }
    dismissWelcome();

    const existingHomeProject = useAppStore.getState().projects.find(isHomeProject);
    if (existingHomeProject) {
      openDraft(existingHomeProject.id);
      return;
    }

    void loadHomeScopeLocation()
      .then((location) => {
        const project = useAppStore.getState().ensureHomeProject(location);
        openDraft(project.id);
      })
      .catch(() => {
        useAppStore.getState().openHome();
      });
  }

  if (!mounted) return null;

  return (
    <div
      ref={containerRef}
      className={`agentemployee-welcome-page fixed inset-0 z-50 flex flex-col bg-background transition-opacity ${
        visible ? "opacity-100 duration-150" : "opacity-0 duration-500"
      }`}
      onTransitionEnd={handleTransitionEnd}
      onMouseMove={(e) => {
        mousePosRef.current = { x: e.clientX, y: e.clientY };
        if (mouseRafRef.current !== null) return;
        mouseRafRef.current = requestAnimationFrame(() => {
          mouseRafRef.current = null;
          const container = containerRef.current;
          const pos = mousePosRef.current;
          if (!container || !pos) return;
          // Cache rect across frames; only the document scroll or resize
          // invalidates it, and either re-fires mousemove afterward.
          if (!containerRectRef.current) {
            containerRectRef.current = container.getBoundingClientRect();
          }
          const rect = containerRectRef.current;
          container.style.setProperty("--mouse-x", `${pos.x - rect.left}px`);
          container.style.setProperty("--mouse-y", `${pos.y - rect.top}px`);
        });
      }}
      onMouseLeave={() => {
        containerRectRef.current = null;
        if (mouseRafRef.current !== null) {
          cancelAnimationFrame(mouseRafRef.current);
          mouseRafRef.current = null;
        }
      }}
    >
      <div className="agentemployee-welcome-bg-glow absolute inset-0 z-0 pointer-events-none" />
      <pre
        className="agentemployee-welcome-code-wall absolute inset-0 z-0 overflow-hidden pointer-events-none opacity-50 p-8 m-0"
        aria-hidden="true"
      >
        {WELCOME_BACKGROUND_CODE}
      </pre>

      <div
        className="agentemployee-overlay-header relative z-10 flex shrink-0 items-center px-2"
        style={{ height: "env(titlebar-area-height, 32px)" }}
      />

      <div className="relative z-10 flex flex-1 items-center justify-center px-6">
        <div className="agentemployee-welcome-stage flex w-full max-w-[680px] flex-col items-center gap-8 text-center">
          <div className="agentemployee-welcome-icon-wrap relative flex size-24 items-center justify-center">
            <span className="agentemployee-welcome-light absolute inset-[-18px] rounded-full" />
            <span className="agentemployee-welcome-splash absolute inset-[-26px] rounded-full" />
            <span className="agentemployee-welcome-orbit absolute inset-[-12px] rounded-full">
              {WELCOME_ORBIT_NODES.map((angle, index) => (
                <span
                  key={angle}
                  className="absolute inset-0"
                  style={{ transform: `rotate(${angle}deg)` }}
                >
                  <span
                    {...(index === 0 ? { ref: cometRef } : {})}
                    className="agentemployee-welcome-node absolute left-1/2 top-0 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  />
                </span>
              ))}
            </span>
            <span className="agentemployee-welcome-ring absolute inset-[5px] rounded-[1.85rem]" />
            <span className="agentemployee-welcome-reveal agentemployee-welcome-icon-glass absolute inset-2 rounded-[1.65rem]" />
            <AgentEmployeeMark className="agentemployee-welcome-reveal relative size-20" />
          </div>

          <div
            className={`agentemployee-welcome-reveal agentemployee-welcome-reveal-1 flex flex-col items-center gap-3 transition-all duration-700 ${
              visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
            }`}
          >
            <h1 className="flex items-baseline gap-3 overflow-visible pr-[0.22em] pb-[0.2em] text-[clamp(3.25rem,8vw,6.25rem)] leading-[1.28] font-semibold tracking-normal">
              <BrandWordmark className="inline-block pr-[0.04em] pb-[0.12em]" />
            </h1>
            <p className="text-sm text-muted">
              <Trans>Where do you want to begin?</Trans>
            </p>
          </div>

          <div
            className={`agentemployee-welcome-reveal agentemployee-welcome-reveal-2 grid w-full max-w-[460px] grid-cols-1 gap-3 transition-all delay-150 duration-700 sm:grid-cols-2 ${
              visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
            }`}
          >
            <Button
              fullWidth
              size="lg"
              variant="tertiary"
              className="agentemployee-welcome-button h-12 justify-center gap-2 !text-white"
              onPress={handleAskQuestion}
            >
              <MessageSquareText className="size-4" />
              <Trans>Ask Question</Trans>
              <span className="rounded-full bg-white/12 px-1.5 py-0.5 text-[10px] leading-none text-white/90">
                <Trans>Home</Trans>
              </span>
            </Button>
            <CreateProjectMenu onSelect={dismissWelcome}>
              <Button
                fullWidth
                size="lg"
                variant="tertiary"
                className="agentemployee-welcome-button h-12 justify-center gap-2 !text-white"
              >
                <FolderPlus className="size-4" />
                <Trans>Add Project</Trans>
              </Button>
            </CreateProjectMenu>
          </div>
        </div>
      </div>
    </div>
  );
}
