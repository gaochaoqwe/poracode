import { Container, Graphics, Text } from "pixi.js";
import type { OfficePalette } from "./palette";
import { deskMotionForStatus, STATUS_COLORS, type MunderStatus } from "./status";
import type { ToolToken } from "./tools";
import { computeDeskSlots, type DeskSlot } from "./layout";
import { easeOutCubic, lerpPoint, type Point } from "./envelope";

export interface DeskModel {
  id: string;
  name: string;
  accent: number;
  status: MunderStatus;
  /** Team membership chip color, undefined when the role is not in a team. */
  teamColor?: number | undefined;
  /** Current station tool token (DESIGN §8.8), undefined when idle. */
  toolToken?: ToolToken | undefined;
  /** Region (level-1 container) stripe color drawn under the desk. */
  regionColor?: number | undefined;
  /** Rank pixel-dot row count (1-3), 0 when unranked. */
  rankDots?: number | undefined;
}

interface DeskNode {
  model: DeskModel;
  container: Container;
  body: Graphics;
  monitor: Graphics;
  frame: Graphics;
  overlay: Graphics;
  token: Graphics;
  avatar: Graphics;
  label: Text;
  slot: DeskSlot;
  prevStatus: MunderStatus;
  jitterUntilMs: number;
  walking: boolean;
  walkT: number;
  homeY: number;
  awayY: number;
}

interface FlyingEnvelope {
  g: Graphics;
  from: Point;
  to: Point;
  elapsedMs: number;
  durationMs: number;
}

const TILE_SIZE = 32;
const WALL_THICKNESS = 14;
const ENVELOPE_FLIGHT_MS = 900;
const JITTER_MS = 360;
const WALK_SPEED_PX_PER_SEC = 80;

/**
 * Owns the pixi scene per the munder App spec (DESIGN §3/§8/§9): grass-
 * checkerboard floor with a wood wall band, cream desks with accent monitors +
 * team chips + station tool tokens, status overlays above each avatar head,
 * avatars that walk out to the station while working, and desk-to-desk
 * envelopes. Framework-agnostic: the React shell pushes data in and gets desk
 * clicks out.
 */
export class OfficeFloor {
  private readonly root: Container;
  private readonly backdrop: Graphics;
  private readonly deskLayer: Container;
  private readonly envelopeLayer: Container;
  private readonly onDeskClick: (workspaceId: string) => void;

  private palette: OfficePalette;
  private width = 0;
  private height = 0;
  private desks: DeskNode[] = [];
  private envelopes: FlyingEnvelope[] = [];
  private clockMs = 0;

  constructor(opts: {
    stage: Container;
    palette: OfficePalette;
    onDeskClick: (workspaceId: string) => void;
  }) {
    this.root = opts.stage;
    this.palette = opts.palette;
    this.onDeskClick = opts.onDeskClick;
    this.backdrop = new Graphics();
    this.deskLayer = new Container();
    this.envelopeLayer = new Container();
    this.root.addChild(this.backdrop, this.deskLayer, this.envelopeLayer);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.paintBackdrop();
    this.relayoutDesks();
  }

  setPalette(palette: OfficePalette): void {
    this.palette = palette;
    this.paintBackdrop();
    this.relayoutDesks();
  }

  setDesks(models: DeskModel[]): void {
    for (const child of [...this.deskLayer.children]) child.destroy({ children: true });
    this.desks = models.map((model) => this.buildDeskNode(model));
    this.relayoutDesks();
  }

  /** Launch a desk-to-desk envelope (team handing off work). */
  flyEnvelope(fromId: string, toId: string): void {
    const from = this.deskCenter(fromId);
    const to = this.deskCenter(toId);
    if (!from || !to) return;
    const g = new Graphics();
    const ink = this.palette.ink;
    g.rect(-8, -6, 16, 12).fill(0xfffdf5).stroke({ width: 1.5, color: ink });
    g.poly([-8, -6, 0, 1, 8, -6]).stroke({ width: 1.5, color: ink });
    g.position.set(from.x, from.y);
    this.envelopeLayer.addChild(g);
    this.envelopes.push({ g, from, to, elapsedMs: 0, durationMs: ENVELOPE_FLIGHT_MS });
  }

  /** Advance avatar walk + status overlays + envelopes each frame. */
  update(dtMs: number): void {
    this.clockMs += dtMs;
    const dtSec = dtMs / 1000;
    for (const node of this.desks) {
      const motion = deskMotionForStatus(node.model.status);
      // Working: monitor brightness breathes (§8.6 in-use station).
      node.monitor.alpha =
        motion === "working" ? 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(this.clockMs / 320)) : 1;
      // Awaiting: coral border breathing (needs_approval / blocked).
      node.frame.alpha =
        motion === "awaiting" ? 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(this.clockMs / 260)) : 0;
      // Error: one-shot short jitter when the status flips to looping/error.
      if (motion === "error" && node.prevStatus !== "looping") {
        node.jitterUntilMs = this.clockMs + JITTER_MS;
      }
      node.container.x = this.clockMs < node.jitterUntilMs ? (Math.random() - 0.5) * 3 : 0;

      // Walk: entering working sends the avatar out to the station; leaving it
      // walks home. MVP lerp at 80px/s + 1px bob (DESIGN §8.7).
      if (node.model.status === "working" && node.prevStatus !== "working") node.walking = true;
      if (node.walking) {
        const travel = Math.max(1, Math.abs(node.awayY - node.homeY));
        node.walkT = Math.min(1, node.walkT + (WALK_SPEED_PX_PER_SEC * dtSec) / travel);
        const bob = node.walkT > 0 && node.walkT < 1 ? Math.sin(this.clockMs / 125) * 1 : 0;
        node.avatar.y = node.homeY + (node.awayY - node.homeY) * easeOutCubic(node.walkT) + bob;
        if (node.walkT >= 1 && node.model.status !== "working") node.walkT = 0;
        if (node.walkT >= 1 && node.model.status !== "working") node.walking = false;
      }
      node.prevStatus = node.model.status;
    }
    const done: FlyingEnvelope[] = [];
    for (const envelope of this.envelopes) {
      envelope.elapsedMs += dtMs;
      const pos = lerpPoint(
        envelope.from,
        envelope.to,
        easeOutCubic(envelope.elapsedMs / envelope.durationMs),
      );
      envelope.g.position.set(pos.x, pos.y);
      if (envelope.elapsedMs >= envelope.durationMs) done.push(envelope);
    }
    for (const envelope of this.envelopes) {
      if (done.includes(envelope)) {
        this.envelopeLayer.removeChild(envelope.g);
        envelope.g.destroy();
        this.envelopes.splice(this.envelopes.indexOf(envelope), 1);
      }
    }
  }

  destroy(): void {
    this.backdrop.destroy();
    this.deskLayer.destroy({ children: true });
    this.envelopeLayer.destroy({ children: true });
    this.root.removeChildren();
  }

  private buildDeskNode(model: DeskModel): DeskNode {
    const container = new Container();
    container.eventMode = "static";
    container.cursor = "pointer";
    container.on("pointerdown", () => this.onDeskClick(model.id));

    const body = new Graphics();
    const monitor = new Graphics();
    const frame = new Graphics();
    frame.alpha = 0;
    const overlay = new Graphics();
    const token = new Graphics();
    const avatar = new Graphics();
    const label = new Text({
      text: model.name,
      style: { fill: this.palette.ink, fontSize: 11, fontFamily: "monospace" },
    });
    label.anchor.set(0.5, 0);
    container.addChild(body, monitor, frame, overlay, token, avatar, label);
    return {
      model,
      container,
      body,
      monitor,
      frame,
      overlay,
      token,
      avatar,
      label,
      slot: { x: 0, y: 0, size: 0 },
      prevStatus: "idle",
      jitterUntilMs: 0,
      walking: false,
      walkT: 0,
      homeY: 0,
      awayY: 0,
    };
  }

  private paintBackdrop(): void {
    const { width, height, palette } = this;
    const g = this.backdrop;
    g.clear();
    g.rect(0, 0, width, height).fill(palette.wall);
    if (palette.wallBar !== undefined) g.rect(0, 0, width, 10).fill(palette.wallBar);
    const fx = WALL_THICKNESS;
    const fy = WALL_THICKNESS;
    const fw = Math.max(0, width - WALL_THICKNESS * 2);
    const fh = Math.max(0, height - WALL_THICKNESS * 2);
    g.rect(fx, fy, fw, fh).fill(palette.floor);
    // Grass checkerboard (§3.5): alternating light/dark 32px tiles.
    for (let ty = 0; ty * TILE_SIZE < fh; ty += 1) {
      for (let tx = 0; tx * TILE_SIZE < fw; tx += 1) {
        if ((tx + ty) % 2 === 1) {
          g.rect(fx + tx * TILE_SIZE, fy + ty * TILE_SIZE, TILE_SIZE, TILE_SIZE).fill(
            palette.tileDark,
          );
        }
      }
    }
    g.rect(fx, fy, fw, fh).stroke({ width: 3, color: palette.ink });
  }

  private relayoutDesks(): void {
    const { width, height } = this;
    const slots = computeDeskSlots(this.desks.length, width, height);
    for (let i = 0; i < this.desks.length; i += 1) {
      const node = this.desks[i]!;
      node.slot = slots[i]! ?? node.slot;
      this.paintDeskNode(node);
    }
  }

  private paintDeskNode(node: DeskNode): void {
    const model = node.model;
    const { palette } = this;
    const { x, y, size } = node.slot;
    const deskW = Math.floor(size * 0.5);
    const deskH = Math.floor(size * 0.34);
    const cx = x + size / 2;
    const deskX = Math.floor(cx - deskW / 2);
    const deskY = y + Math.floor(size * 0.24);

    node.body.clear();
    // Hard offset shadow (§6.4), then desk top.
    node.body
      .rect(deskX + palette.shadowOffset, deskY + palette.shadowOffset, deskW, deskH)
      .fill(palette.deskShadow);
    node.body
      .rect(deskX, deskY, deskW, deskH)
      .fill(palette.desk)
      .stroke({ width: palette.borderWidth, color: palette.ink });
    // Team chip: small square at the desk's top-right corner.
    if (model.teamColor !== undefined) {
      node.body
        .rect(deskX + deskW - 10, deskY - 10, 10, 10)
        .fill(model.teamColor)
        .stroke({ width: 1.5, color: palette.ink });
    }

    const monitorW = Math.floor(deskW * 0.44);
    const monitorH = Math.floor(deskH * 0.4);
    node.monitor.clear();
    node.monitor
      .rect(deskX + Math.floor(deskW * 0.14), deskY + Math.floor(deskH * 0.2), monitorW, monitorH)
      .fill(model.accent)
      .stroke({ width: 1.5, color: palette.ink });

    node.frame.clear();
    node.frame
      .rect(deskX - 3, deskY - 3, deskW + 6, deskH + 6)
      .stroke({ width: 2, color: 0xff6b6b });

    node.token.clear();
    this.paintToolToken(
      node.token,
      model.toolToken,
      deskX + deskW - 14,
      deskY + deskH + 4,
      palette.ink,
    );

    // Region stripe: 4px bar along the desk bottom edge (level-1 container).
    if (model.regionColor !== undefined) {
      node.body.rect(deskX, deskY + deskH - 4, deskW, 4).fill(model.regionColor);
    }
    // Rank dots: 1-3 tiny squares under the name label.
    const dots = model.rankDots ?? 0;
    for (let i = 0; i < dots; i += 1) {
      node.body.rect(cx - (dots * 6) / 2 + i * 6, deskY + deskH + 42, 4, 4).fill(palette.ink);
    }

    const avatarX = Math.floor(cx - 5);
    const avatarY0 = deskY + deskH + 10;
    node.homeY = avatarY0;
    node.awayY = avatarY0 + 22;
    node.avatar.clear();
    node.avatar
      .rect(avatarX, avatarY0 + 4, 10, 10)
      .fill(model.accent)
      .stroke({ width: 1.5, color: palette.ink });
    node.avatar
      .rect(avatarX + 2, avatarY0, 6, 6)
      .fill(0xffdcb8)
      .stroke({ width: 1.5, color: palette.ink });

    node.overlay.clear();
    this.paintStatusOverlay(node.overlay, model.status, avatarX + 5, avatarY0 - 8, this.clockMs);

    node.label.style.fill = palette.ink;
    node.label.position.set(cx, deskY + deskH + 30);
  }

  private paintToolToken(
    g: Graphics,
    token: ToolToken | undefined,
    px: number,
    py: number,
    ink: number,
  ): void {
    if (token === undefined) return;
    switch (token) {
      case "paper":
        g.rect(px, py, 6, 8).fill(0xfffdf5).stroke({ width: 1, color: ink });
        break;
      case "terminal":
        g.rect(px, py, 6, 6).fill(ink);
        break;
      case "globe":
        g.circle(px + 3, py + 3, 3)
          .fill(0x4ecdc4)
          .stroke({ width: 1, color: ink });
        break;
      case "magnifier":
        g.circle(px + 3, py + 3, 3).fill(ink);
        g.circle(px + 3, py + 3, 1.5).fill(0xfffdf5);
        break;
      case "diamond":
        g.poly([px + 3, py, px + 6, py + 3, px + 3, py + 6, px, py + 3])
          .fill(0xb197fc)
          .stroke({ width: 1, color: ink });
        break;
      case "checklist":
        g.rect(px, py, 6, 8).fill(0xfffdf5).stroke({ width: 1, color: ink });
        g.rect(px + 1, py + 1, 1.5, 1.5).fill(ink);
        g.rect(px + 1, py + 4, 1.5, 1.5).fill(ink);
        break;
    }
  }

  private paintStatusOverlay(
    g: Graphics,
    status: MunderStatus,
    cx: number,
    cy: number,
    clock: number,
  ): void {
    const color = STATUS_COLORS[status];
    if (status === "thinking") {
      // 3 dots cycling (§8.6).
      for (let i = 0; i < 3; i += 1) {
        const on = Math.floor(clock / 250) % 3 === i;
        g.circle(cx - 5 + i * 5, cy, 1.5).fill(on ? color : 0x1a1320);
      }
    } else if (status === "blocked") {
      // Pulsing "!" (§8.6), 2-frame blink.
      if (Math.floor(clock / 400) % 2 === 0) {
        g.rect(cx - 1.5, cy - 6, 3, 5).fill(color);
        g.rect(cx - 1, cy + 1, 2, 2).fill(color);
      }
    } else if (status === "success") {
      // Sparkle star burst, 2-frame flash.
      if (Math.floor(clock / 300) % 2 === 0) {
        g.rect(cx - 4, cy - 1, 8, 2).fill(color);
        g.rect(cx - 1, cy - 4, 2, 8).fill(color);
      }
    } else if (status === "working" || status === "waiting" || status === "looping") {
      g.circle(cx, cy, 2).fill(color);
    }
  }

  private deskCenter(id: string): Point | undefined {
    const node = this.desks.find((desk) => desk.model.id === id);
    if (!node) return undefined;
    const { x, y, size } = node.slot;
    return { x: x + size / 2, y: y + size * 0.5 };
  }
}
