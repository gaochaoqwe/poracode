import { BrowserWindow, screen, type Rectangle, type RenderProcessGoneDetails } from "electron";
import type { AgentEmployeeChannel } from "@/shared/channel";
import type { RendererProcessGoneIntent } from "@/main/diagnostics/processGone";
import { installSessionPermissions } from "../browser/permissions";
import { showAndFocusWindow } from "./showAndFocusWindow";
import {
  buildRendererAdditionalArguments,
  installAppNavigationGuards,
  installRendererReloadGuard,
  noteRendererWindowClose,
} from "./windowHardening";
import { rectOverlapsWorkArea } from "./windowGeometry";

const PET_LOG_LABEL = "pet";

export const PET_WINDOW_WIDTH = 400;
export const PET_WINDOW_HEIGHT = 560;
/** Edge length of the collapsed floating-ball mode. */
export const PET_BALL_SIZE = 64;

/**
 * How long to wait for the renderer's first paint before showing the window
 * regardless. `ready-to-show` is the normal path; this only covers a renderer
 * that never reports one, which would leave the pet permanently hidden.
 */
const PET_READY_FALLBACK_MS = 4_000;
/** Gap between load retries while the dev server / renderer is unavailable. */
const PET_LOAD_RETRY_MS = 1_500;
/** Bounded load-retry budget so a permanently dead URL can't spin forever. */
const PET_LOAD_MAX_ATTEMPTS = 30;
/**
 * Retry gap once the crash guard has spent its budget. Must exceed the guard's
 * 5s window so the next attempt starts with a fresh budget.
 */
const PET_RENDERER_RETRY_MS = 6_000;
/** `net::ERR_ABORTED`: a superseded navigation, not a failure. */
const PET_LOAD_ABORTED_CODE = -3;

/**
 * Where the user last dropped the collapsed ball, or `null` while it still sits
 * at the default corner. Module-scoped because it is a per-process UI memory:
 * the ball's position is not worth a settings round-trip, and losing it on
 * restart simply re-anchors to the bottom-right gap.
 */
let savedBallPosition: { x: number; y: number } | null = null;

export function rememberPetBallPosition(x: number, y: number): void {
  savedBallPosition = { x, y };
}

/** Test seam / tray-restore hook. */
export function resetPetBallPosition(): void {
  savedBallPosition = null;
}

export interface CreatePetWindowOptions {
  title: string;
  isDev: boolean;
  channel: AgentEmployeeChannel;
  preloadPath: string;
  rendererHtmlPath: string;
  appVersion: string;
  posthogEnableDev: boolean;
  posthogEnabled: boolean;
  posthogHost: string;
  posthogKey: string;
  sentryEnabled: boolean;
  browserUserAgent: string;
  onClosed(): void;
  onRendererProcessGone?: (
    details: RenderProcessGoneDetails,
    intent: RendererProcessGoneIntent | undefined,
  ) => void;
  devServerUrl?: string;
}

export function resolvePetBounds(workArea: Rectangle): Rectangle {
  const width = Math.min(PET_WINDOW_WIDTH, workArea.width);
  const height = Math.min(PET_WINDOW_HEIGHT, workArea.height);
  const rightGap = 24;
  const bottomGap = 56;
  return {
    x: Math.max(workArea.x, workArea.x + workArea.width - rightGap - width),
    y: Math.max(workArea.y, workArea.y + workArea.height - bottomGap - height),
    width,
    height,
  };
}

/** Bottom-right anchor for the collapsed floating ball, aligned with the panel gaps. */
export function resolvePetBallBounds(workArea: Rectangle): Rectangle {
  const size = Math.min(PET_BALL_SIZE, workArea.width, workArea.height);
  const rightGap = 24;
  const bottomGap = 56;
  return {
    x: Math.max(workArea.x, workArea.x + workArea.width - rightGap - size),
    y: Math.max(workArea.y, workArea.y + workArea.height - bottomGap - size),
    width: size,
    height: size,
  };
}

/**
 * The ball bounds the app should use right now: the user's dragged position when
 * there is one, clamped so the ball always keeps a visible grip, otherwise the
 * default bottom-right anchor.
 */
export function resolveCurrentPetBallBounds(workArea: Rectangle): Rectangle {
  const fallback = resolvePetBallBounds(workArea);
  if (!savedBallPosition) return fallback;
  return clampPetBallPosition(savedBallPosition, workArea);
}

/**
 * Keep a dragged ball inside the work area. A drag can end partly offscreen
 * (fast flick, display change), and a fully hidden ball has no way back, so the
 * position is clamped to leave the whole ball on-screen.
 */
export function clampPetBallPosition(
  position: { x: number; y: number },
  workArea: Rectangle,
): Rectangle {
  const size = Math.min(PET_BALL_SIZE, workArea.width, workArea.height);
  return {
    x: Math.min(Math.max(position.x, workArea.x), workArea.x + workArea.width - size),
    y: Math.min(Math.max(position.y, workArea.y), workArea.y + workArea.height - size),
    width: size,
    height: size,
  };
}

/**
 * Switch the pet window between the full panel and the floating ball. The ball
 * returns to where the user last dragged it (falling back to the panel's
 * bottom-right anchor), so collapsing never teleports it away from under the
 * cursor.
 */
export function setPetWindowCollapsed(window: BrowserWindow, collapsed: boolean): void {
  if (window.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = collapsed
    ? resolveCurrentPetBallBounds(display.workArea)
    : resolvePetBounds(display.workArea);
  window.setBounds(bounds, false);
}

/**
 * Nudge the collapsed ball by a pointer delta. The renderer drives the drag (see
 * `renderer/pet/petBallDrag.ts`) because a CSS drag region would swallow the very
 * click that restores the panel, and only main knows where the window currently
 * sits. The move is clamped so the ball always keeps a visible grip, and the
 * landing spot is remembered so collapsing again returns there.
 */
export function movePetBallBy(window: BrowserWindow, dx: number, dy: number): void {
  if (window.isDestroyed()) return;
  const bounds = window.getBounds();
  const workArea = screen.getDisplayNearestPoint({
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  }).workArea;
  const next = clampPetBallPosition({ x: bounds.x + dx, y: bounds.y + dy }, workArea);
  window.setBounds({ ...next, width: bounds.width, height: bounds.height }, false);
  rememberPetBallPosition(next.x, next.y);
}

export function positionPetWindow(window: BrowserWindow): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  window.setBounds(resolvePetBounds(display.workArea), false);
}

export function isPetBoundsVisible(bounds: Rectangle, workAreas: readonly Rectangle[]): boolean {
  return workAreas.some((workArea) => rectOverlapsWorkArea(bounds, workArea));
}

export function showPetWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  if (
    !isPetBoundsVisible(
      window.getBounds(),
      screen.getAllDisplays().map((display) => display.workArea),
    )
  ) {
    positionPetWindow(window);
  }
  showAndFocusWindow(window);
}

export function createPetWindow(options: CreatePetWindowOptions): BrowserWindow {
  const bounds = resolvePetBounds(
    screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,
  );
  const window = new BrowserWindow({
    title: `${options.title} Pet`,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    ...bounds,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: buildRendererAdditionalArguments({
        appVersion: options.appVersion,
        isDev: options.isDev,
        windowKind: "pet",
        channel: options.channel,
        posthogEnableDev: options.posthogEnableDev,
        posthogEnabled: options.posthogEnabled,
        posthogHost: options.posthogHost,
        posthogKey: options.posthogKey,
        sentryEnabled: options.sentryEnabled,
      }),
    },
  });
  installSessionPermissions(window.webContents.session);
  window.webContents.setUserAgent(options.browserUserAgent);
  if (process.platform === "darwin") {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  // The renderer drags the ball with `petMoveBall`, which already remembers each
  // landing spot; this catches any move the OS reports on its own (a display
  // change, a programmatic re-anchor) so a later collapse still returns to where
  // the ball actually sits.
  window.on("moved", () => {
    if (window.isDestroyed()) return;
    const moved = window.getBounds();
    rememberPetBallPosition(moved.x, moved.y);
  });

  installAppNavigationGuards(window, {
    isDev: options.isDev,
    label: PET_LOG_LABEL,
    ...(options.devServerUrl ? { devServerUrl: options.devServerUrl } : {}),
  });

  // The pet is a resident, fully transparent window: whatever fails to render is
  // invisible rather than broken-looking, and there is no second surface to fall
  // back on. So every failure mode below recovers by itself instead of leaving a
  // blank ball nobody can bring back.
  let loadAttempts = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelRetry = () => {
    if (retryTimer === null) return;
    clearTimeout(retryTimer);
    retryTimer = null;
  };
  const loadRenderer = () => {
    cancelRetry();
    if (window.isDestroyed()) return;
    if (options.isDev) {
      void window.loadURL(options.devServerUrl as string);
    } else {
      void window.loadFile(options.rendererHtmlPath);
    }
  };
  const retryLater = (delayMs: number) => {
    if (window.isDestroyed() || retryTimer !== null) return;
    retryTimer = setTimeout(loadRenderer, delayMs);
  };

  // A failed main-frame load leaves the window empty *and* spawns no renderer at
  // all, so the crash guard below never sees it — the usual cause is the dev
  // server not answering yet. Retry with a bounded budget.
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === PET_LOAD_ABORTED_CODE) return;
      loadAttempts += 1;
      if (loadAttempts > PET_LOAD_MAX_ATTEMPTS) {
        console.error(
          `[agentemployee] ${PET_LOG_LABEL} load failed ${loadAttempts} times (${errorCode} ${errorDescription} ${validatedURL}); giving up`,
        );
        return;
      }
      console.error(
        `[agentemployee] ${PET_LOG_LABEL} load failed (${errorCode} ${errorDescription} ${validatedURL}); retry ${loadAttempts}/${PET_LOAD_MAX_ATTEMPTS}`,
      );
      retryLater(PET_LOAD_RETRY_MS);
    },
  );
  window.webContents.on("did-finish-load", () => {
    loadAttempts = 0;
  });

  // `ready-to-show` waits for the renderer to report a first paint. The ball is
  // the only opaque pixel of an otherwise transparent window, so a missing ready
  // signal must not be allowed to keep the pet hidden forever.
  let shown = false;
  window.once("ready-to-show", () => {
    shown = true;
    showPetWindow(window);
  });
  const readyFallbackTimer = setTimeout(() => {
    if (shown || window.isDestroyed()) return;
    console.warn(
      `[agentemployee] ${PET_LOG_LABEL} never reported ready-to-show; showing it anyway`,
    );
    showPetWindow(window);
  }, PET_READY_FALLBACK_MS);

  loadRenderer();

  installRendererReloadGuard(window, {
    loadRenderer,
    label: PET_LOG_LABEL,
    // The guard stops reloading after a burst of crashes (so a loop can't peg the
    // CPU). A resident ball waits past its 5s window — which resets the guard's
    // budget — and tries again, forever, rather than staying permanently blank.
    onReloadsExhausted: () => {
      console.error(`[agentemployee] ${PET_LOG_LABEL} renderer kept crashing; retrying shortly`);
      retryLater(PET_RENDERER_RETRY_MS);
    },
    ...(options.onRendererProcessGone
      ? { onRendererProcessGone: options.onRendererProcessGone }
      : {}),
  });

  window.on("close", (event) => noteRendererWindowClose(window, event));
  window.on("closed", () => {
    cancelRetry();
    clearTimeout(readyFallbackTimer);
  });
  window.on("closed", options.onClosed);
  return window;
}
