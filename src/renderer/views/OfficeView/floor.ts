import { Application } from "pixi.js";
import type { OfficePalette } from "./palette";
import { OfficeFloor } from "./floorScene";

export interface OfficeFloorRuntime {
  app: Application;
  floor: OfficeFloor;
  resize: (width: number, height: number) => void;
  setPalette: (palette: OfficePalette) => void;
  destroy: () => void;
}

/**
 * Boot the pixi Application on the given canvas and wire its ticker to the
 * floor scene. The caller owns the canvas lifecycle and calls `destroy` on
 * unmount so the GL context and textures are released (no leak on view swap).
 */
export async function createOfficeFloorRuntime(opts: {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  palette: OfficePalette;
  onDeskClick: (workspaceId: string) => void;
}): Promise<OfficeFloorRuntime> {
  const app = new Application();
  await app.init({
    canvas: opts.canvas,
    width: opts.width,
    height: opts.height,
    antialias: false,
    background: opts.palette.floor,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
  });

  const floor = new OfficeFloor({
    stage: app.stage,
    palette: opts.palette,
    onDeskClick: opts.onDeskClick,
  });
  floor.resize(opts.width, opts.height);

  app.ticker.add(() => {
    floor.update(app.ticker.deltaMS);
  });

  return {
    app,
    floor,
    resize: (width, height) => {
      app.renderer.resize(width, height);
      floor.resize(width, height);
    },
    setPalette: (palette) => {
      floor.setPalette(palette);
    },
    destroy: () => {
      floor.destroy();
      app.destroy(true, { children: true });
    },
  };
}
