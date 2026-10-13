import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const window = {
    webContents: {
      session: {},
      setUserAgent: vi.fn<(value: string) => void>(),
      setWindowOpenHandler: vi.fn<(handler: (...args: unknown[]) => unknown) => void>(),
      on: vi.fn<(...args: unknown[]) => void>(),
    },
    setVisibleOnAllWorkspaces: vi.fn<(visible: boolean, options: unknown) => void>(),
    once: vi.fn<(...args: unknown[]) => void>(),
    on: vi.fn<(...args: unknown[]) => void>(),
    loadURL: vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined),
    loadFile: vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined),
    isDestroyed: vi.fn<() => boolean>().mockReturnValue(false),
    getBounds: vi
      .fn<() => { x: number; y: number; width: number; height: number }>()
      .mockReturnValue({ x: 2990, y: 788, width: 400, height: 560 }),
    setBounds: vi.fn<(bounds: unknown, animate: boolean) => void>(),
    isMinimized: vi.fn<() => boolean>().mockReturnValue(false),
    isVisible: vi.fn<() => boolean>().mockReturnValue(false),
    show: vi.fn<() => void>(),
    focus: vi.fn<() => void>(),
  };
  return {
    BrowserWindow: vi.fn<(options: unknown) => typeof window>(function BrowserWindowMock(
      _options: unknown,
    ) {
      return window;
    }),
    screen: {
      getCursorScreenPoint: vi.fn<() => { x: number; y: number }>(() => ({ x: 100, y: 100 })),
      getDisplayNearestPoint: vi.fn<
        () => { workArea: { x: number; y: number; width: number; height: number } }
      >(() => ({ workArea: { x: 0, y: 0, width: 3440, height: 1400 } })),
      getAllDisplays: vi.fn<
        () => Array<{ workArea: { x: number; y: number; width: number; height: number } }>
      >(() => [{ workArea: { x: 0, y: 0, width: 3440, height: 1400 } }]),
    },
    window,
  };
});

vi.mock("electron", () => ({
  BrowserWindow: electronMock.BrowserWindow,
  screen: electronMock.screen,
}));
vi.mock("../browser/permissions", () => ({
  installSessionPermissions: vi.fn<(session: unknown) => void>(),
}));

import {
  clampPetBallPosition,
  createPetWindow,
  isPetBoundsVisible,
  movePetBallBy,
  PET_BALL_SIZE,
  PET_WINDOW_HEIGHT,
  PET_WINDOW_WIDTH,
  rememberPetBallPosition,
  resetPetBallPosition,
  resolveCurrentPetBallBounds,
  resolvePetBallBounds,
  resolvePetBounds,
  setPetWindowCollapsed,
  showPetWindow,
} from "./createPetWindow";

const baseOptions = {
  title: "AgentEmployee",
  isDev: false,
  channel: "stable" as const,
  preloadPath: "preload.cjs",
  rendererHtmlPath: "index.html",
  appVersion: "1.0.0",
  posthogEnableDev: false,
  posthogEnabled: false,
  posthogHost: "",
  posthogKey: "",
  sentryEnabled: false,
  browserUserAgent: "AgentEmployee",
  onClosed: vi.fn<() => void>(),
};

describe("pet window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPetBallPosition();
    electronMock.window.getBounds.mockReturnValue({ x: 2990, y: 788, width: 400, height: 560 });
    electronMock.window.isDestroyed.mockReturnValue(false);
    electronMock.window.isVisible.mockReturnValue(false);
  });

  it("anchors the pet to the bottom-right of the work area at the fixed avatar size", () => {
    expect(PET_WINDOW_WIDTH).toBe(400);
    expect(PET_WINDOW_HEIGHT).toBe(560);
    expect(resolvePetBounds({ x: 0, y: 0, width: 3440, height: 1400 })).toEqual({
      x: 3440 - 24 - 400,
      y: 1400 - 56 - 560,
      width: 400,
      height: 560,
    });
  });

  it("collapses to a small bottom-right ball and expands back to the panel", () => {
    expect(PET_BALL_SIZE).toBe(64);
    expect(resolvePetBallBounds({ x: 0, y: 0, width: 3440, height: 1400 })).toEqual({
      x: 3440 - 24 - 64,
      y: 1400 - 56 - 64,
      width: 64,
      height: 64,
    });

    setPetWindowCollapsed(electronMock.window as never, true);
    expect(electronMock.window.setBounds).toHaveBeenLastCalledWith(
      resolvePetBallBounds({ x: 0, y: 0, width: 3440, height: 1400 }),
      false,
    );

    setPetWindowCollapsed(electronMock.window as never, false);
    expect(electronMock.window.setBounds).toHaveBeenLastCalledWith(
      resolvePetBounds({ x: 0, y: 0, width: 3440, height: 1400 }),
      false,
    );
  });

  it("keeps a user-dragged position and only recenters an offscreen window", () => {
    showPetWindow(electronMock.window as never);
    expect(electronMock.window.setBounds).not.toHaveBeenCalled();

    electronMock.window.getBounds.mockReturnValue({ x: 5000, y: 5000, width: 400, height: 560 });
    showPetWindow(electronMock.window as never);
    expect(electronMock.window.setBounds).toHaveBeenCalledWith(
      resolvePetBounds({ x: 0, y: 0, width: 3440, height: 1400 }),
      false,
    );
  });

  it("requires at least a 50px visible grip on one display", () => {
    const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];
    expect(isPetBoundsVisible({ x: 1870, y: 520, width: 400, height: 560 }, displays)).toBe(true);
    expect(isPetBoundsVisible({ x: 1871, y: 520, width: 400, height: 560 }, displays)).toBe(false);
  });

  it("returns the ball to the position the user dragged it to", () => {
    const workArea = { x: 0, y: 0, width: 3440, height: 1400 };
    // Default corner until the user moves it.
    expect(resolveCurrentPetBallBounds(workArea)).toEqual(resolvePetBallBounds(workArea));

    rememberPetBallPosition(700, 300);
    expect(resolveCurrentPetBallBounds(workArea)).toEqual({
      x: 700,
      y: 300,
      width: 64,
      height: 64,
    });

    setPetWindowCollapsed(electronMock.window as never, true);
    expect(electronMock.window.setBounds).toHaveBeenLastCalledWith(
      { x: 700, y: 300, width: 64, height: 64 },
      false,
    );
  });

  it("clamps a dragged ball so it can never hide offscreen", () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
    expect(clampPetBallPosition({ x: -200, y: -50 }, workArea)).toEqual({
      x: 0,
      y: 0,
      width: 64,
      height: 64,
    });
    expect(clampPetBallPosition({ x: 9999, y: 9999 }, workArea)).toEqual({
      x: 1920 - 64,
      y: 1080 - 64,
      width: 64,
      height: 64,
    });
    // A negative-origin work area (a display left of / above the primary one).
    const leftWorkArea = { x: -1920, y: -300, width: 1920, height: 1080 };
    expect(clampPetBallPosition({ x: -5000, y: -5000 }, leftWorkArea)).toEqual({
      x: -1920,
      y: -300,
      width: 64,
      height: 64,
    });
  });

  it("nudges a dragged ball by the pointer delta and keeps it on screen", () => {
    electronMock.window.getBounds.mockReturnValue({ x: 300, y: 400, width: 64, height: 64 });
    movePetBallBy(electronMock.window as never, 12, -8);
    expect(electronMock.window.setBounds).toHaveBeenLastCalledWith(
      { x: 312, y: 392, width: 64, height: 64 },
      false,
    );

    // The drop is remembered, so collapsing again returns to the same spot.
    setPetWindowCollapsed(electronMock.window as never, true);
    expect(electronMock.window.setBounds).toHaveBeenLastCalledWith(
      { x: 312, y: 392, width: 64, height: 64 },
      false,
    );

    // Dragging past the edge leaves the ball a visible grip instead of hiding it.
    electronMock.window.getBounds.mockReturnValue({ x: 3400, y: 1350, width: 64, height: 64 });
    movePetBallBy(electronMock.window as never, 500, 500);
    expect(electronMock.window.setBounds).toHaveBeenLastCalledWith(
      { x: 3440 - 64, y: 1400 - 64, width: 64, height: 64 },
      false,
    );
  });

  it("ignores a ball nudge once the window is gone", () => {
    electronMock.window.isDestroyed.mockReturnValue(true);
    movePetBallBy(electronMock.window as never, 10, 10);
    expect(electronMock.window.setBounds).not.toHaveBeenCalled();
  });

  it("remembers a user drag through the window's moved event", () => {
    createPetWindow(baseOptions);
    const movedHandler = electronMock.window.on.mock.calls.find(
      ([event]) => event === "moved",
    )?.[1] as (() => void) | undefined;
    expect(movedHandler).toBeTypeOf("function");

    electronMock.window.getBounds.mockReturnValue({ x: 812, y: 344, width: 64, height: 64 });
    movedHandler?.();

    setPetWindowCollapsed(electronMock.window as never, true);
    expect(electronMock.window.setBounds).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: 812, y: 344, width: 64, height: 64 }),
      false,
    );
  });

  it("creates a frameless transparent always-on-top pet that skips the taskbar", () => {
    createPetWindow(baseOptions);

    expect(electronMock.BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
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
        width: 400,
        height: 560,
      }),
    );

    const options = electronMock.BrowserWindow.mock.calls[0]?.[0] as {
      webPreferences: { additionalArguments: string[] };
    };
    expect(options.webPreferences.additionalArguments).toContain("--lc-window-kind=pet");
    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
  });

  // The pet is a resident, fully transparent window: anything that fails to
  // render is invisible rather than obviously broken, so every failure mode has
  // to recover by itself (otherwise the user is left with no ball, no panel, and
  // no way to bring either back).
  describe("self-healing", () => {
    /** The mock never validates the Electron-shaped arguments we replay here. */
    type Listener = (...args: unknown[]) => void;

    function webContentsListener(event: string): Listener | undefined {
      const calls = electronMock.window.webContents.on.mock.calls;
      const call = calls.find(([name]) => name === event);
      return call?.[1] as Listener | undefined;
    }

    function readyToShowHandler(): Listener | undefined {
      const calls = electronMock.window.once.mock.calls;
      const call = calls.find(([name]) => name === "ready-to-show");
      return call?.[1] as Listener | undefined;
    }

    it("retries a failed main-frame load instead of leaving a blank ball", () => {
      vi.useFakeTimers();
      try {
        createPetWindow(baseOptions);
        electronMock.window.loadFile.mockClear();

        webContentsListener("did-fail-load")?.(
          null,
          -105,
          "ERR_NAME_NOT_RESOLVED",
          "http://x/",
          true,
        );
        expect(electronMock.window.loadFile).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1_500);
        expect(electronMock.window.loadFile).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("ignores aborted navigations and sub-frame load failures", () => {
      vi.useFakeTimers();
      try {
        createPetWindow(baseOptions);
        electronMock.window.loadFile.mockClear();
        const failed = webContentsListener("did-fail-load");

        // -3 = ERR_ABORTED: the navigation was simply superseded.
        failed?.(null, -3, "ERR_ABORTED", "http://x/", true);
        // A sub-frame failure never affects the ball.
        failed?.(null, -105, "ERR_NAME_NOT_RESOLVED", "http://x/frame.html", false);

        vi.advanceTimersByTime(10_000);
        expect(electronMock.window.loadFile).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("stops retrying once the load-retry budget is spent", () => {
      vi.useFakeTimers();
      try {
        createPetWindow(baseOptions);
        const failed = webContentsListener("did-fail-load");
        for (let attempt = 0; attempt < 31; attempt += 1) {
          failed?.(null, -105, "ERR_NAME_NOT_RESOLVED", "http://x/", true);
          vi.advanceTimersByTime(1_500);
        }
        // The initial load plus the capped number of retries (never one per failure).
        expect(electronMock.window.loadFile).toHaveBeenCalledTimes(31);
      } finally {
        vi.useRealTimers();
      }
    });

    it("shows the window even when the renderer never reports a first paint", () => {
      vi.useFakeTimers();
      try {
        createPetWindow(baseOptions);
        expect(electronMock.window.show).not.toHaveBeenCalled();

        vi.advanceTimersByTime(4_000);
        expect(electronMock.window.show).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("prefers ready-to-show and skips the fallback once the renderer paints", () => {
      vi.useFakeTimers();
      try {
        createPetWindow(baseOptions);
        readyToShowHandler()?.();
        expect(electronMock.window.show).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(4_000);
        expect(electronMock.window.show).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps retrying after the crash guard gives up on a crash loop", () => {
      vi.useFakeTimers();
      try {
        createPetWindow(baseOptions);
        const gone = webContentsListener("render-process-gone");
        expect(gone).toBeTypeOf("function");

        // Four crashes in a row exhausts the guard's budget (it reloads 3 times).
        for (let crash = 0; crash < 4; crash += 1) {
          gone?.(undefined, { reason: "crashed", exitCode: 1 });
        }
        electronMock.window.loadFile.mockClear();

        // The guard stays quiet, but the ball schedules its own retry past the
        // guard's 5s window so the next attempt starts with a fresh budget.
        vi.advanceTimersByTime(5_000);
        expect(electronMock.window.loadFile).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1_000);
        expect(electronMock.window.loadFile).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
