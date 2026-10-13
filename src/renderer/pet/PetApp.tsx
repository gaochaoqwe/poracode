import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Button } from "@heroui/react";
import { Minimize2 } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PetNavigateMainTarget } from "@/shared/ipc/procedures/pet";
import { readBridge } from "@/renderer/bridge";
import { useAppHydration } from "@/renderer/hooks/useAppHydration";
import { PixelLoader } from "@/renderer/components/common";
import { PetAvatar } from "./PetAvatar";
import { PetConversationPanel } from "./PetConversationPanel";
import { PetDeliverPanel } from "./PetDeliverPanel";
import { advancePetBallDrag, beginPetBallDrag } from "./petBallDrag";
import { readPetCollapsedPreference, writePetCollapsedPreference } from "./petCollapsed";
import { PET_STYLE_IDS, readPetStylePreference, writePetStylePreference } from "./petStyles";

const NAV_TARGETS: readonly PetNavigateMainTarget[] = ["home", "tasks", "office"];

/**
 * After the ball restores the panel it is gone, but the panel now occupies the
 * ball's old spot — so the second click of a double click would be delivered to
 * whatever the panel shows there. A restore therefore drops clicks that land on
 * that spot for a moment; clicks anywhere else on the panel are untouched.
 */
const GHOST_CLICK_WINDOW_MS = 500;
const GHOST_CLICK_RADIUS_PX = 8;

/**
 * The floating pet window. It reuses the shared app store (hydrated read-only,
 * `runtimeOwner: false` like the quick-composer window) so the chief-steward
 * thread and task board stay visible, and asks main to reveal the full surfaces
 * through `petNavigateMain`.
 *
 * The panel can collapse into a resident floating ball: the renderer owns the
 * mode, main resizes the frameless window to the ball bounds, and the native
 * ball context menu (expand / hide) echoes its choice back here. The tray
 * "Show Chief Steward" item restores a hidden ball.
 *
 * The ball is dragged by this renderer (see `petBallDrag.ts`) instead of by the
 * OS: a CSS drag region counts as window chrome, so it swallowed the very click
 * that brings the panel back. Restoring therefore works with a click (or a
 * double click — the first one already restores), while a press that travels
 * past the drag slop moves the ball and never restores it.
 */
export function PetApp() {
  const { t } = useLingui();
  const { initialLoading } = useAppHydration({ runtimeOwner: false });
  const [styleId, setStyleId] = useState(readPetStylePreference);
  const [collapsed, setCollapsed] = useState(readPetCollapsedPreference);
  const [activeTab, setActiveTab] = useState<"chat" | "deliver">("chat");

  // A reload while collapsed must re-sync main's window bounds (main restarts
  // recreate the window at panel size).
  useEffect(() => {
    if (collapsed) {
      void readBridge().petSetCollapsed({ collapsed: true });
    }
    // The persisted mode is the mount-time source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyCollapsed = (next: boolean) => {
    setCollapsed(next);
    writePetCollapsedPreference(next);
    void readBridge().petSetCollapsed({ collapsed: next });
  };

  // The ball paints nothing but its disc, so the document shell must drop the
  // app background too — otherwise the opaque html/body of the shared
  // index.html fill the 64px window and the ball reads as a dark square.
  useEffect(() => {
    const root = document.documentElement;
    if (collapsed) root.dataset.petBall = "on";
    else delete root.dataset.petBall;
    return () => {
      delete root.dataset.petBall;
    };
  }, [collapsed]);

  // Ball drag bookkeeping. The press is resolved on mouseup so a drag never
  // restores the panel; a click that reaches the button with no press behind it
  // is a keyboard activation (Enter/Space).
  const ballDragCleanupRef = useRef<(() => void) | null>(null);
  const ballPressHandledRef = useRef(false);
  const ballGhostClickRef = useRef<{ x: number; y: number; expiresAt: number } | null>(null);

  useEffect(() => {
    return () => ballDragCleanupRef.current?.();
  }, []);

  // Swallow the click a double click would otherwise replay on the restored
  // panel (the ball's spot becomes the panel's bottom-right corner, which is
  // where its submit button sits).
  useEffect(() => {
    const swallowGhostClick = (event: MouseEvent) => {
      const guard = ballGhostClickRef.current;
      if (!guard) return;
      if (Date.now() >= guard.expiresAt) {
        ballGhostClickRef.current = null;
        return;
      }
      if (Math.hypot(event.screenX - guard.x, event.screenY - guard.y) > GHOST_CLICK_RADIUS_PX) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("mousedown", swallowGhostClick, true);
    document.addEventListener("click", swallowGhostClick, true);
    return () => {
      document.removeEventListener("mousedown", swallowGhostClick, true);
      document.removeEventListener("click", swallowGhostClick, true);
    };
  }, []);

  const handleBallMouseDown = (event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    ballDragCleanupRef.current?.();
    ballPressHandledRef.current = false;
    let drag = beginPetBallDrag(event.screenX, event.screenY);

    // Listeners live on the document: the ball window is only 64px, and the
    // pointer must keep being tracked while the window is still catching up.
    const onMouseMove = (moveEvent: MouseEvent) => {
      const step = advancePetBallDrag(drag, moveEvent.screenX, moveEvent.screenY);
      drag = step.drag;
      if (step.move) void readBridge().petMoveBall(step.move);
    };
    const onMouseUp = () => {
      teardown();
      ballPressHandledRef.current = true;
      if (drag.moved) return;
      ballGhostClickRef.current = {
        x: drag.originX,
        y: drag.originY,
        expiresAt: Date.now() + GHOST_CLICK_WINDOW_MS,
      };
      applyCollapsed(false);
    };
    function teardown() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      ballDragCleanupRef.current = null;
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    ballDragCleanupRef.current = teardown;
  };

  const handleBallClick = () => {
    const handledByPress = ballPressHandledRef.current;
    ballPressHandledRef.current = false;
    // Keyboard activation never produces a trailing click, so it needs no guard.
    if (!handledByPress) applyCollapsed(false);
  };

  // The native ball menu runs in main; its choice comes back over the event
  // channel so the renderer state and the window bounds stay in lockstep.
  useEffect(
    () =>
      readBridge().onPetBallMenuAction(({ action }) => {
        if (action === "expand") {
          setCollapsed(false);
          writePetCollapsedPreference(false);
        }
      }),
    [],
  );

  const switchStyle = (next: (typeof PET_STYLE_IDS)[number]) => {
    setStyleId(next);
    writePetStylePreference(next);
  };

  const navigate = (target: PetNavigateMainTarget) => {
    void readBridge().petNavigateMain({ target });
  };

  if (collapsed) {
    return (
      <div className="pet-window pet-window-collapsed">
        <button
          type="button"
          className="pet-ball"
          aria-label={t`Expand panel`}
          title={t`Expand panel`}
          onMouseDown={handleBallMouseDown}
          onClick={handleBallClick}
          onContextMenu={(event) => {
            event.preventDefault();
            void readBridge().petShowBallMenu({
              expandLabel: t`Expand panel`,
              hideLabel: t`Hide floating ball`,
            });
          }}
        >
          <span className="pet-ball-avatar">
            <PetAvatar styleId={styleId} size={48} />
          </span>
        </button>
      </div>
    );
  }
  return (
    <div className="pet-window">
      <header className="pet-header">
        <button
          type="button"
          className="pet-avatar-button"
          aria-label={t`Chief steward`}
          onClick={() => navigate("home")}
        >
          <PetAvatar styleId={styleId} size={40} />
        </button>
        <div className="pet-style-switcher" role="group" aria-label={t`Pet style`}>
          {PET_STYLE_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={`pet-style-option${id === styleId ? " pet-style-option-active" : ""}`}
              aria-pressed={id === styleId}
              onClick={() => switchStyle(id)}
            >
              <PetAvatar styleId={id} size={18} />
            </button>
          ))}
        </div>
        <nav className="pet-nav" aria-label={t`Navigate`}>
          {NAV_TARGETS.map((target) => (
            <Button key={target} size="sm" variant="secondary" onPress={() => navigate(target)}>
              {target === "home" ? <Trans>Home</Trans> : null}
              {target === "tasks" ? <Trans>Tasks</Trans> : null}
              {target === "office" ? <Trans>Workbench</Trans> : null}
            </Button>
          ))}
        </nav>
        <button
          type="button"
          className="pet-collapse-button"
          aria-label={t`Collapse into floating ball`}
          title={t`Collapse into floating ball`}
          onClick={() => applyCollapsed(true)}
        >
          <Minimize2 className="size-4" />
        </button>
      </header>

      {initialLoading ? (
        <div className="pet-body pet-body-loading">
          <PixelLoader size="sm" />
        </div>
      ) : (
        <div className="pet-body">
          <div className="pet-tabs" role="tablist" aria-label={t`Pet panels`}>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "chat"}
              className={`pet-tab${activeTab === "chat" ? " pet-tab-active" : ""}`}
              onClick={() => setActiveTab("chat")}
            >
              <Trans>Chat</Trans>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "deliver"}
              className={`pet-tab${activeTab === "deliver" ? " pet-tab-active" : ""}`}
              onClick={() => setActiveTab("deliver")}
            >
              <Trans>Deliver task</Trans>
            </button>
          </div>
          {activeTab === "chat" ? <PetConversationPanel /> : <PetDeliverPanel />}
        </div>
      )}
    </div>
  );
}
