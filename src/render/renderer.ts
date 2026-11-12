import {
  ROOM,
  Surf,
  airAt,
  lineY,
  makeRng,
  surfaceAt,
  terrainAt,
  windAt,
  type Air,
  type Building,
  type Tree,
  type WashLine,
  type World,
} from "../engine";
import { Backdrop, type View } from "./backdrop";
import { INK, ORANGE } from "./ink";
import { TONES, boatPath, buildScenery, type Prop, type Scenery } from "./scenery";

export interface PlanePose {
  x: number;
  y: number;
  th: number;
  /** -1 to 1: how far it is rolled towards or away from the viewer. */
  bank: number;
  /** 1 the right way up, -1 on its back. */
  up: number;
  /** 1 is whole; less is crumpled along its length. */
  squash: number;
  visible: boolean;
}

export interface Aim {
  /** Where the plane is being held, in world metres. */
  px: number;
  py: number;
  /** The first moments of the flight, x, y pairs. */
  arc: readonly number[];
  power: number;
}

export interface Burst {
  kind: "dust" | "splash" | "ticks";
  x: number;
  y: number;
  /** Seconds since it started. */
  age: number;
  dir: number;
}

export interface Shake {
  ref: Tree | WashLine | null;
  amount: number;
}

export interface Trace {
  path: Float32Array;
  /** How much of the line is drawn, 0 to 1. */
  progress: number;
  ghost: Float32Array | null;
  /** Distance of this flight and of the ghost, for the labels. */
  restX: number;
}

export interface Frame {
  view: View;
  plane: PlanePose;
  aim: Aim | null;
  /** Recent positions of the plane, x, y pairs, oldest first. */
  trail: readonly number[];
  trace: Trace | null;
  shake: Shake;
  bursts: readonly Burst[];
  /** The demonstration hand, in screen px, or null. */
  hand: { x: number; y: number; down: number; alpha: number } | null;
  /** 0 to 1: how strongly the thermal marks are drawn. */
  airMarks: number;
  dt: number;
}

interface Streak {
  x: number;
  y: number;
  life: number;
  span: number;
  len: number;
}

interface Leaf {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  life: number;
}

const CLOTHES: Path2D[] = (() => {
  const shirt = new Path2D("M-0.3 0 L-0.3 -0.12 L-0.52 -0.3 L-0.42 -0.44 L-0.28 -0.34 L-0.28 -0.78 L0.28 -0.78 L0.28 -0.34 L0.42 -0.44 L0.52 -0.3 L0.3 -0.12 L0.3 0 Q0 -0.12 -0.3 0 Z");
  const sheet = new Path2D("M-0.5 0 L-0.5 -0.86 Q-0.25 -0.94 0 -0.86 Q0.25 -0.78 0.5 -0.88 L0.5 0 Z");
  const sock = new Path2D("M-0.09 0 L-0.09 -0.4 Q-0.1 -0.56 0.12 -0.56 L0.22 -0.56 Q0.3 -0.46 0.18 -0.4 L0.09 -0.38 L0.09 0 Z");
  const trousers = new Path2D("M-0.26 0 L-0.3 -0.86 L-0.08 -0.86 L0 -0.3 L0.08 -0.86 L0.3 -0.86 L0.26 0 Z");
  const towel = new Path2D("M-0.22 0 L-0.22 -0.6 L0.22 -0.6 L0.22 0 Z");
  return [shirt, sheet, sock, trousers, towel, sock];
})();
const CLOTHES_W = [1.15, 1.1, 0.5, 0.75, 0.6, 0.5];

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private world!: World;
  private scenery!: Scenery;
  private backdrop!: Backdrop;
  private grain: CanvasPattern | null = null;
  private streaks: Streak[] = [];
  private leaves: Leaf[] = [];
  private air: Air = { u: 0, w: 0, lift: 0 };
  private boat = boatPath();
  private boatX = 0;
  dpr = 1;
  w = 0;
  h = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("no 2d canvas");
    this.ctx = ctx;
    this.makeGrain();
  }

  setWorld(world: World): void {
    this.world = world;
    this.scenery = buildScenery(world);
    this.backdrop = new Backdrop(world);
    this.streaks = [];
    this.leaves = [];
    const r = makeRng(world.seed ^ 404);
    const [a, b] = world.zones.river;
    this.boatX = a + (b - a) * r.range(0.3, 0.7);
  }

  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    // Sharp on dense screens, but never more pixels than a phone GPU likes.
    let dpr = Math.min(window.devicePixelRatio || 1, 3);
    const budget = 3_400_000;
    if (w * h * dpr * dpr > budget) dpr = Math.sqrt(budget / (w * h));
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  private makeGrain(): void {
    const c = document.createElement("canvas");
    c.width = c.height = 192;
    const g = c.getContext("2d");
    if (!g) return;
    const img = g.createImageData(192, 192);
    let s = 1234567;
    for (let i = 0; i < img.data.length; i += 4) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const n = s / 4294967296;
      const dark = n < 0.5;
      img.data[i] = dark ? 21 : 255;
      img.data[i + 1] = dark ? 20 : 252;
      img.data[i + 2] = dark ? 15 : 244;
      img.data[i + 3] = Math.floor(Math.abs(n - 0.5) * 2 * 14);
    }
    g.putImageData(img, 0, 0);
    this.grain = this.ctx.createPattern(c, "repeat");
  }

  /** World metres to screen px. */
  sx(v: View, x: number): number {
    return v.w / 2 + (x - v.cx) * v.ppm;
  }
  sy(v: View, y: number): number {
    return v.h / 2 - (y - v.cy) * v.ppm;
  }

  draw(f: Frame): void {
    const ctx = this.ctx;
    const v = f.view;
    const d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    this.backdrop.draw(ctx, v);

    // From here on, draw in world metres with y up.
    ctx.setTransform(v.ppm * d, 0, 0, -v.ppm * d, (v.w / 2 - v.cx * v.ppm) * d, (v.h / 2 + v.cy * v.ppm) * d);
    const left = v.cx - v.w / 2 / v.ppm;
    const right = v.cx + v.w / 2 / v.ppm;
    const bottom = v.cy - v.h / 2 / v.ppm;
    const top = v.cy + v.h / 2 / v.ppm;
    const px = 1 / v.ppm;
    const weight = 1.05 + 0.5 * Math.min(1.6, v.ppm / 40);
    const lod = v.ppm < 4.5 ? 0 : v.ppm < 11 ? 1 : 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    this.drawGround(ctx, v, left, right, bottom, px, weight, lod);
    this.drawProps(ctx, left, right, px, weight, lod, f.shake, v.t);
    if (lod > 0) {
      this.drawLines(ctx, left, right, px, weight, f.shake, v.t);
      this.drawBoat(ctx, left, right, px, weight, v.t);
      this.drawRoomLife(ctx, left, right, px, weight, f, v.t);
      this.drawSmoke(ctx, left, right, px, v.t);
    }
    if (lod > 0 && f.airMarks > 0) this.drawThermals(ctx, left, right, bottom, top, px, v.t, f.airMarks);
    if (lod > 1) this.drawWind(ctx, f.dt, left, right, bottom, top, px, v.t);

    if (f.trace) this.drawTrace(ctx, f.trace, px);
    if (f.plane.visible) {
      this.drawShadow(ctx, f.plane, v);
      this.drawTrail(ctx, f.trail, px);
      if (f.aim) this.drawAim(ctx, f.aim, px);
      this.drawPlane(ctx, f.plane, v);
    }
    this.drawBursts(ctx, f.bursts, px);

    // Back to screen space.
    ctx.setTransform(d, 0, 0, d, 0, 0);
    if (f.trace) this.drawRuler(ctx, v, f.trace);
    if (f.hand) this.drawHand(ctx, f.hand);
    if (this.grain) {
      ctx.fillStyle = this.grain;
      ctx.fillRect(0, 0, v.w, v.h);
    }
  }

  private drawGround(
    ctx: CanvasRenderingContext2D,
    v: View,
    left: number,
    right: number,
    bottom: number,
    px: number,
    weight: number,
    lod: number,
  ): void {
    const world = this.world;
    const z = world.zones;
    const step = Math.max(world.res, 2.5 * px);
    const spans: Array<[number, number, string]> = [
      [world.x0, z.town[1], TONES.street],
      [z.town[1], z.river[0], TONES.ground],
      [z.river[0], z.river[1], TONES.ground],
      [z.river[1], world.length, TONES.hill],
    ];
    const floor = Math.min(bottom, world.water - 4) - 2;
    // Water first; the river bed is filled over the bottom of it.
    if (right > z.river[0] && left < z.river[1]) {
      ctx.fillStyle = TONES.water;
      ctx.fillRect(z.river[0], floor, z.river[1] - z.river[0], world.water - floor);
    }
    for (const [a, b, tone] of spans) {
      const x0 = Math.max(a, left - step);
      const x1 = Math.min(b, right + step);
      if (x1 <= x0) continue;
      ctx.beginPath();
      ctx.moveTo(x0, floor);
      for (let x = x0; x < x1; x += step) ctx.lineTo(x, terrainAt(world, x));
      ctx.lineTo(x1, terrainAt(world, x1));
      ctx.lineTo(x1, floor);
      ctx.closePath();
      ctx.fillStyle = tone;
      ctx.fill();
    }
    // The ground line itself.
    ctx.beginPath();
    let pen = false;
    for (let x = Math.max(world.x0, left - step); x <= right + step; x += step) {
      const y = terrainAt(world, x);
      if (y < world.water - 0.02) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      pen = true;
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = weight * px;
    ctx.stroke();

    if (right > z.river[0] && left < z.river[1]) {
      // The water: a level line and broken ripples that slide along it.
      const a = Math.max(z.river[0] + 2.6, left);
      const b = Math.min(z.river[1] - 2.6, right);
      ctx.beginPath();
      ctx.moveTo(a, world.water);
      ctx.lineTo(b, world.water);
      ctx.lineWidth = weight * px;
      ctx.stroke();
      if (lod > 0) {
        ctx.beginPath();
        const r = makeRng(99);
        for (let row = 1; row <= 5; row++) {
          const y = world.water - row * 0.32;
          const slide = v.t * (0.5 + row * 0.14) * (row % 2 ? 1 : -1);
          for (let x = z.river[0] + 3 + r.range(0, 4); x < z.river[1] - 4; x += r.range(2.5, 7)) {
            const len = r.range(0.7, 2.4);
            const wx = x + Math.sin(slide + x) * 0.8;
            if (wx < a || wx + len > b) continue;
            ctx.moveTo(wx, y);
            ctx.quadraticCurveTo(wx + len / 2, y + 0.07, wx + len, y);
          }
        }
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 0.8 * px;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  private firstProp(list: Prop[], x: number): number {
    let a = 0;
    let b = list.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if ((list[m] as Prop).x0 < x) a = m + 1;
      else b = m;
    }
    return a;
  }

  private drawProps(
    ctx: CanvasRenderingContext2D,
    left: number,
    right: number,
    px: number,
    weight: number,
    lod: number,
    shake: Shake,
    t: number,
  ): void {
    const props = this.scenery.props;
    const start = this.firstProp(props, left - this.scenery.maxWidth);
    for (let i = start; i < props.length; i++) {
      const p = props[i] as Prop;
      if (p.x0 > right) break;
      if (p.x1 < left) continue;
      const shaking = shake.ref !== null && p.ref === shake.ref && shake.amount > 0.002;
      if (shaking) {
        ctx.save();
        const tr = p.ref as Tree;
        ctx.translate(tr.x, tr.base);
        ctx.rotate(Math.sin(t * 22) * 0.02 * shake.amount);
        ctx.translate(-tr.x, -tr.base);
      }
      if (p.fill) {
        ctx.fillStyle = p.tone ?? TONES.wall[0];
        ctx.fill(p.fill);
      }
      if (p.fill2) {
        ctx.fillStyle = p.tone2 ?? TONES.room;
        ctx.fill(p.fill2);
      }
      ctx.strokeStyle = INK;
      if (lod > 1) {
        ctx.globalAlpha = 0.36;
        ctx.lineWidth = 0.7 * px;
        ctx.stroke(p.shade);
      }
      if (lod > 0) {
        ctx.globalAlpha = lod > 1 ? 0.72 : 0.4;
        ctx.lineWidth = 0.9 * px;
        ctx.stroke(p.fine);
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = weight * px;
      ctx.stroke(p.ink);
      if (shaking) ctx.restore();
    }
    if (lod > 1) {
      const detail = this.scenery.detail;
      const s = this.firstProp(detail, left - 41);
      for (let i = s; i < detail.length; i++) {
        const p = detail[i] as Prop;
        if (p.x0 > right) break;
        ctx.globalAlpha = 0.36;
        ctx.lineWidth = 0.7 * px;
        ctx.stroke(p.shade);
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 0.9 * px;
        ctx.stroke(p.fine);
        ctx.globalAlpha = 1;
        ctx.lineWidth = weight * px;
        ctx.stroke(p.ink);
      }
    }
  }

  private drawLines(
    ctx: CanvasRenderingContext2D,
    left: number,
    right: number,
    px: number,
    weight: number,
    shake: Shake,
    t: number,
  ): void {
    const world = this.world;
    for (const line of world.lines) {
      if (line.x1 < left - 2 || line.x0 > right + 2) continue;
      const hit = shake.ref === line ? shake.amount : 0;
      const wind = windAt(world, (line.x0 + line.x1) / 2, line.y0, t);
      const mx = (line.x0 + line.x1) / 2;
      const jig = hit * Math.sin(t * 26) * 0.12;
      const my = (line.y0 + line.y1) / 2 - line.sag * 2 + jig;
      ctx.strokeStyle = INK;
      ctx.lineWidth = weight * px;
      // Poles.
      ctx.beginPath();
      for (const [x, y] of [[line.x0, line.y0], [line.x1, line.y1]] as const) {
        const foot = surfaceAt(world, x);
        if (y - foot > 0.6) {
          ctx.moveTo(x, foot);
          ctx.lineTo(x, y + 0.12);
        }
      }
      ctx.stroke();
      ctx.lineWidth = 0.9 * px;
      ctx.beginPath();
      ctx.moveTo(line.x0, line.y0);
      ctx.quadraticCurveTo(mx, my, line.x1, line.y1);
      ctx.stroke();
      // The washing.
      const r = makeRng(line.seed);
      let x = line.x0 + r.range(0.5, 0.9);
      let i = 0;
      while (x < line.x1 - 0.6) {
        const kind = r.int(0, CLOTHES.length - 1);
        const cw = CLOTHES_W[kind] as number;
        if (x + cw / 2 > line.x1 - 0.3) break;
        const cx = x + cw / 2;
        const y = lineY(line, cx) + jig * 4 * ((cx - line.x0) / (line.x1 - line.x0)) * (1 - (cx - line.x0) / (line.x1 - line.x0));
        const swing = wind * 0.09 + Math.sin(t * 1.9 + i * 1.7) * (0.04 + Math.abs(wind) * 0.035) + hit * Math.sin(t * 17 + i) * 0.3;
        ctx.save();
        ctx.translate(cx, y);
        ctx.rotate(swing);
        ctx.fillStyle = "#f8f5ee";
        const path = CLOTHES[kind] as Path2D;
        ctx.fill(path);
        ctx.lineWidth = 0.9 * px;
        ctx.stroke(path);
        ctx.restore();
        x += cw + r.range(0.12, 0.5);
        i++;
      }
    }
  }

  private drawBoat(ctx: CanvasRenderingContext2D, left: number, right: number, px: number, weight: number, t: number): void {
    const x = this.boatX;
    if (x < left - 3 || x > right + 3) return;
    ctx.save();
    ctx.translate(x, this.world.water - 0.2 + Math.sin(t * 1.3) * 0.05);
    ctx.rotate(Math.sin(t * 0.9) * 0.025);
    ctx.fillStyle = TONES.wall[0];
    ctx.fill(this.boat.fill);
    ctx.strokeStyle = INK;
    ctx.lineWidth = weight * px;
    ctx.stroke(this.boat.ink);
    ctx.restore();
  }

  /** The launcher and its band, and the curtains in the window. */
  private drawRoomLife(ctx: CanvasRenderingContext2D, left: number, right: number, px: number, weight: number, f: Frame, t: number): void {
    if (right < ROOM.back || left > ROOM.out + 3) return;
    const R = ROOM;
    ctx.strokeStyle = INK;
    // Curtains: two edges and a fold, blown out through the opening.
    const breeze = 0.5 + 0.5 * Math.sin(t * 0.7) + windAt(this.world, R.out + 8, R.startY, t) * 0.2;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      for (let i = 0; i <= 14; i++) {
        const s = i / 14;
        const sway = Math.sin(t * 1.6 - s * 3.2 + k * 0.9) * 0.12 * s;
        const x = R.wall - 0.12 + k * 0.1 + s * s * (0.5 + 0.55 * breeze) * (0.6 + k * 0.25) + sway;
        const y = R.lintel - 0.02 - s * (2.75 - k * 0.12);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.globalAlpha = k === 1 ? 0.45 : 0.85;
      ctx.lineWidth = (k === 1 ? 0.8 : 1.1) * px;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Curtain rail.
    ctx.beginPath();
    ctx.moveTo(R.wall - 0.5, R.lintel + 0.04);
    ctx.lineTo(R.wall - 0.02, R.lintel + 0.04);
    ctx.lineWidth = weight * px;
    ctx.stroke();

    // The fork.
    const ty = R.floor + 1.05;
    const tipY = R.startY + 0.04;
    ctx.beginPath();
    ctx.moveTo(0.08, ty);
    ctx.lineTo(0.08, R.startY - 0.2);
    ctx.moveTo(0.08, R.startY - 0.2);
    ctx.quadraticCurveTo(-0.08, R.startY - 0.12, -0.08, tipY);
    ctx.moveTo(0.08, R.startY - 0.2);
    ctx.quadraticCurveTo(0.24, R.startY - 0.12, 0.22, tipY);
    ctx.lineWidth = weight * 1.5 * px;
    ctx.stroke();
    // The band.
    ctx.beginPath();
    if (f.aim) {
      const tail = 0.38;
      const a = f.plane.th;
      const bx = f.aim.px - Math.cos(a) * tail;
      const by = f.aim.py - Math.sin(a) * tail;
      ctx.moveTo(-0.08, tipY);
      ctx.lineTo(bx, by);
      ctx.lineTo(0.22, tipY);
    } else {
      ctx.moveTo(-0.08, tipY);
      ctx.quadraticCurveTo(0.06, tipY - 0.13, 0.22, tipY);
    }
    ctx.lineWidth = 0.9 * px;
    ctx.stroke();
  }

  private drawSmoke(ctx: CanvasRenderingContext2D, left: number, right: number, px: number, t: number): void {
    const world = this.world;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.8 * px;
    for (const b of world.buildings) {
      if (b.x1 < left - 8 || b.x0 > right + 8 || b.chimneys.length === 0) continue;
      const c = b.chimneys[0] as Building["chimneys"][number];
      const cx = (c.x0 + c.x1) / 2;
      const wind = windAt(world, cx, c.top + 2, t);
      for (let i = 0; i < 5; i++) {
        const age = (t * 0.22 + i / 5 + (b.seed % 100) / 100) % 1;
        const x = cx + wind * age * 4.2 + Math.sin(age * 9 + i * 2) * 0.18;
        const y = c.top + 0.25 + age * 4.4;
        const rad = 0.16 + age * 0.55;
        ctx.globalAlpha = (1 - age) * 0.5 * Math.min(1, age * 6);
        ctx.beginPath();
        ctx.arc(x, y, rad, 0.4 + i, 5.4 + i);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Rising air as slow climbing dashes; sinking air as falling ones. */
  private drawThermals(
    ctx: CanvasRenderingContext2D,
    left: number,
    right: number,
    bottom: number,
    top: number,
    px: number,
    t: number,
    strength: number,
  ): void {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1 * px;
    for (const th of this.world.thermals) {
      if (th.x + th.r * 1.5 < left || th.x - th.r * 1.5 > right) continue;
      const up = th.w > 0;
      const strands = up ? 5 : 7;
      const y0 = Math.max(th.base + 0.6, bottom);
      const y1 = Math.min(up ? th.base + 30 : th.base + 13, top + 2);
      if (y1 <= y0) continue;
      const speed = th.w * 0.9;
      ctx.setLineDash(up ? [0.55, 1.25] : [0.3, 1.5]);
      ctx.lineDashOffset = -t * speed;
      const power = Math.min(1, Math.abs(th.w) / 3.2);
      for (let band = 0; band < 3; band++) {
        const a = y0 + ((y1 - y0) * band) / 3;
        const b = y0 + ((y1 - y0) * (band + 1)) / 3;
        ctx.beginPath();
        for (let k = 0; k < strands; k++) {
          const off = (k / (strands - 1) - 0.5) * th.r * (up ? 1.5 : 2);
          const edge = 1 - Math.abs(k / (strands - 1) - 0.5) * 1.1;
          if (band === 2 && edge < 0.6) continue;
          for (let y = a; y <= b + 0.01; y += 0.6) {
            const lean = up ? Math.sin(y * 0.5 - t * 1.4 + k * 1.9) * 0.3 + (y - th.base) * 0.012 * this.world.wind.base : 0;
            if (y === a) ctx.moveTo(th.x + off + lean, y);
            else ctx.lineTo(th.x + off + lean, y);
          }
        }
        ctx.globalAlpha = strength * (up ? 0.2 + 0.26 * power : 0.2) * (1 - band * 0.3);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /** Wind you can see: thin streaks that ride the air, and a few leaves. */
  private drawWind(
    ctx: CanvasRenderingContext2D,
    dt: number,
    left: number,
    right: number,
    bottom: number,
    top: number,
    px: number,
    t: number,
  ): void {
    const world = this.world;
    const outsideLeft = Math.max(left, ROOM.out + 1);
    if (right <= outsideLeft) return;
    const strong = Math.min(1, Math.abs(world.wind.base) / 2.2);
    const want = Math.round(10 + 26 * strong);
    while (this.streaks.length < want) {
      this.streaks.push({
        x: outsideLeft + Math.random() * (right - outsideLeft),
        y: bottom + Math.random() * (top - bottom),
        life: Math.random(),
        span: 1.6 + Math.random() * 2.4,
        len: 0.5 + Math.random() * 0.9,
      });
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.9 * px;
    for (let band = 0; band < 3; band++) {
      ctx.beginPath();
      for (const s of this.streaks) {
        const phase = s.life / s.span;
        const fade = Math.sin(Math.min(1, phase) * Math.PI);
        if (Math.floor(fade * 2.999) !== band) continue;
        const air = airAt(world, s.x, s.y, t, this.air);
        const len = s.len * (0.35 + Math.hypot(air.u, air.w) * 0.55);
        const curl = Math.sin(s.life * 3 + s.x) * 0.12;
        ctx.moveTo(s.x, s.y);
        ctx.quadraticCurveTo(s.x - air.u * len * 0.5, s.y - air.w * len * 0.5 + curl, s.x - air.u * len - 0.2, s.y - air.w * len);
      }
      ctx.globalAlpha = 0.1 + band * 0.11;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const s = this.streaks[i] as Streak;
      const air = airAt(world, s.x, s.y, t, this.air);
      s.x += air.u * dt;
      s.y += air.w * dt;
      s.life += dt;
      const gone = s.life > s.span || s.x < left - 6 || s.x > right + 6 || s.y < surfaceAt(world, s.x) + 0.3;
      if (gone) {
        s.x = outsideLeft + Math.random() * (right - outsideLeft);
        s.y = bottom + Math.random() * (top - bottom);
        s.life = 0;
        if (this.streaks.length > want) this.streaks.splice(i, 1);
      }
    }

    // Leaves.
    const wantLeaves = Math.round(3 + 7 * strong);
    while (this.leaves.length < wantLeaves) {
      const fromLeft = world.wind.base >= 0;
      this.leaves.push({
        x: fromLeft ? outsideLeft + Math.random() * (right - outsideLeft) * 0.7 : right - Math.random() * (right - outsideLeft) * 0.7,
        y: bottom + (0.3 + Math.random() * 0.7) * (top - bottom),
        vx: 0,
        vy: 0,
        rot: Math.random() * 6,
        spin: (Math.random() - 0.5) * 7,
        life: 0,
      });
    }
    ctx.fillStyle = INK;
    for (let i = this.leaves.length - 1; i >= 0; i--) {
      const l = this.leaves[i] as Leaf;
      const air = airAt(world, l.x, l.y, t, this.air);
      l.vx += (air.u - l.vx) * Math.min(1, dt * 2.5);
      l.vy += (air.w - 0.55 + Math.sin(l.life * 3.1 + l.rot) * 0.5 - l.vy) * Math.min(1, dt * 2.5);
      l.x += l.vx * dt;
      l.y += l.vy * dt;
      l.rot += l.spin * dt;
      l.life += dt;
      const s = Math.max(0.09, 4.5 * px);
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.rot);
      ctx.globalAlpha = 0.55 * Math.min(1, l.life * 2);
      ctx.beginPath();
      ctx.moveTo(-s, 0);
      ctx.quadraticCurveTo(0, s * 0.75 * Math.cos(l.life * 4), s, 0);
      ctx.quadraticCurveTo(0, -s * 0.5, -s, 0);
      ctx.fill();
      ctx.restore();
      if (l.x < left - 4 || l.x > right + 4 || l.y < surfaceAt(world, l.x) || l.life > 14) this.leaves.splice(i, 1);
    }
    ctx.globalAlpha = 1;
  }

  /** Add leaves shaken out of a tree. */
  shed(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.leaves.push({
        x: x + (Math.random() - 0.5) * 3,
        y: y + (Math.random() - 0.5) * 2.5,
        vx: (Math.random() - 0.3) * 3,
        vy: Math.random() * 2,
        rot: Math.random() * 6,
        spin: (Math.random() - 0.5) * 12,
        life: 0.4,
      });
    }
  }

  private drawShadow(ctx: CanvasRenderingContext2D, p: PlanePose, v: View): void {
    const world = this.world;
    // The sun is ahead and sinking: the shadow falls a little behind.
    const ground = surfaceAt(world, p.x);
    const h = p.y - ground;
    if (h > 45 || h < -0.5) return;
    const sx = p.x - Math.max(0, h) * 0.22;
    const sy = surfaceAt(world, sx);
    if (Math.abs(sy - ground) > 2.5 && h > 1) return;
    const size = this.planeSize(v);
    const spread = 1 + Math.max(0, h) / 9;
    const strength = 0.2 / (1 + Math.max(0, h) / 5);
    ctx.fillStyle = INK;
    for (let i = 0; i < 3; i++) {
      const k = 1 - i * 0.26;
      ctx.globalAlpha = strength * 0.5;
      ctx.beginPath();
      ctx.ellipse(sx, sy + 0.02, size * 0.5 * spread * k * Math.max(0.25, Math.abs(Math.cos(p.th))), size * 0.06 * spread * k + 0.01, 0, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawTrail(ctx: CanvasRenderingContext2D, trail: readonly number[], px: number): void {
    const n = trail.length / 2;
    if (n < 3) return;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1 * px;
    const bands = 6;
    for (let b = 0; b < bands; b++) {
      const i0 = Math.floor((n * b) / bands);
      const i1 = Math.min(n - 1, Math.floor((n * (b + 1)) / bands));
      if (i1 <= i0) continue;
      ctx.beginPath();
      ctx.moveTo(trail[i0 * 2] as number, trail[i0 * 2 + 1] as number);
      for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(trail[i * 2] as number, trail[i * 2 + 1] as number);
      ctx.globalAlpha = 0.04 + 0.3 * ((b + 1) / bands) ** 1.6;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawAim(ctx: CanvasRenderingContext2D, aim: Aim, px: number): void {
    const n = aim.arc.length / 2;
    ctx.fillStyle = INK;
    for (let i = 1; i < n; i++) {
      const k = i / n;
      ctx.globalAlpha = 0.6 * (1 - k) ** 1.2 + 0.05;
      ctx.beginPath();
      ctx.arc(aim.arc[i * 2] as number, aim.arc[i * 2 + 1] as number, (2.1 - k * 1.1) * px, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  planeSize(v: View): number {
    // Never smaller than 38 px on screen, however far the camera pulls back.
    return Math.max(1.1, 38 / v.ppm);
  }

  private drawPlane(ctx: CanvasRenderingContext2D, p: PlanePose, v: View): void {
    const s = this.planeSize(v);
    const b = p.bank;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.th);
    ctx.scale(s * p.squash, s * p.up);
    const far = 0.15 + 0.1 * b;
    const near = 0.05 - 0.1 * b;
    ctx.lineWidth = 0.9 / (v.ppm * s);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(21, 20, 15, 0.7)";
    // Far wing.
    ctx.beginPath();
    ctx.moveTo(0.52, -0.02);
    ctx.lineTo(-0.47, 0.035);
    ctx.lineTo(-0.5, 0.035 + far);
    ctx.closePath();
    ctx.fillStyle = "#e9764a";
    ctx.fill();
    ctx.stroke();
    // The fold underneath.
    ctx.beginPath();
    ctx.moveTo(0.52, -0.02);
    ctx.lineTo(-0.47, 0.035);
    ctx.lineTo(-0.47, -0.06);
    ctx.lineTo(-0.34, -0.15);
    ctx.closePath();
    ctx.fillStyle = "#b03a12";
    ctx.fill();
    ctx.stroke();
    // Near wing.
    ctx.beginPath();
    ctx.moveTo(0.52, -0.02);
    ctx.lineTo(-0.47, 0.035);
    ctx.lineTo(-0.53, 0.035 - near);
    ctx.closePath();
    ctx.fillStyle = ORANGE;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawBursts(ctx: CanvasRenderingContext2D, bursts: readonly Burst[], px: number): void {
    ctx.strokeStyle = INK;
    for (const b of bursts) {
      const a = b.age;
      if (b.kind === "dust") {
        if (a > 0.9) continue;
        ctx.lineWidth = 0.9 * px;
        ctx.globalAlpha = (1 - a / 0.9) * 0.6;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const x = b.x - b.dir * (0.2 + i * 0.32 + a * (0.7 + i * 0.3));
          const y = b.y + 0.1 + a * (0.3 + i * 0.16);
          const r = 0.1 + a * 0.3 + i * 0.03;
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, 4.4 + i);
        }
        ctx.stroke();
      } else if (b.kind === "ticks") {
        if (a > 0.45) continue;
        ctx.lineWidth = 1.1 * px;
        ctx.globalAlpha = 1 - a / 0.45;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const ang = 0.4 + i * 0.6 + (b.dir < 0 ? 0 : 0.25);
          const r0 = 0.3 + a * 1.6;
          const r1 = r0 + 0.3;
          ctx.moveTo(b.x + Math.cos(ang) * r0 * b.dir, b.y + Math.sin(ang) * r0);
          ctx.lineTo(b.x + Math.cos(ang) * r1 * b.dir, b.y + Math.sin(ang) * r1);
        }
        ctx.stroke();
      } else {
        if (a > 1.6) continue;
        ctx.lineWidth = 0.9 * px;
        for (let i = 0; i < 3; i++) {
          const age = a - i * 0.22;
          if (age <= 0) continue;
          ctx.globalAlpha = Math.max(0, 1 - age / 1.2) * 0.7;
          ctx.beginPath();
          ctx.ellipse(b.x, b.y, 0.3 + age * 2.2, 0.05 + age * 0.22, 0, 0, 6.2832);
          ctx.stroke();
        }
        // Drops.
        ctx.globalAlpha = Math.max(0, 1 - a / 0.8);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const vx = (i - 2.5) * 0.75;
          const vy = 3.2 + (i % 3) * 0.9;
          const x = b.x + vx * a;
          const y = b.y + vy * a - 6.5 * a * a;
          if (y < b.y) continue;
          ctx.moveTo(x, y);
          ctx.lineTo(x - vx * 0.05, y - (vy - 13 * a) * 0.05);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private tracePath(ctx: CanvasRenderingContext2D, path: Float32Array, upTo: number): void {
    const n = Math.floor(path.length / 3);
    const last = Math.max(1, Math.floor((n - 1) * upTo));
    ctx.beginPath();
    ctx.moveTo(path[0] as number, path[1] as number);
    for (let i = 1; i <= last; i++) ctx.lineTo(path[i * 3] as number, path[i * 3 + 1] as number);
  }

  private drawTrace(ctx: CanvasRenderingContext2D, tr: Trace, px: number): void {
    if (tr.ghost) {
      this.tracePath(ctx, tr.ghost, 1);
      ctx.strokeStyle = INK;
      ctx.globalAlpha = 0.5 * Math.min(1, tr.progress * 3);
      ctx.lineWidth = 1 * px;
      ctx.setLineDash([4 * px, 4 * px]);
      ctx.stroke();
      ctx.setLineDash([]);
      const n = Math.floor(tr.ghost.length / 3);
      const gx = tr.ghost[(n - 1) * 3] as number;
      const gy = tr.ghost[(n - 1) * 3 + 1] as number;
      ctx.beginPath();
      ctx.arc(gx, gy, 3 * px, 0, 6.2832);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    this.tracePath(ctx, tr.path, tr.progress);
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 1.7 * px;
    ctx.stroke();
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.arc(tr.path[0] as number, tr.path[1] as number, 2.6 * px, 0, 6.2832);
    ctx.fill();
  }

  /** A measuring line under the flight, in metres. */
  private drawRuler(ctx: CanvasRenderingContext2D, v: View, tr: Trace): void {
    const span = v.w / v.ppm;
    const steps = [5, 10, 25, 50, 100, 250, 500];
    let step = 500;
    for (const s of steps) {
      if (span / s <= 9) {
        step = s;
        break;
      }
    }
    let lowest = Infinity;
    const n = Math.floor(tr.path.length / 3);
    for (let i = 0; i < n; i += 8) lowest = Math.min(lowest, surfaceAt(this.world, tr.path[i * 3] as number));
    const y = Math.min(v.h - 18, this.sy(v, Math.min(lowest, 0)) + 26);
    const a = this.sx(v, ROOM.startX);
    const end = Math.max(tr.restX, 1);
    const b = this.sx(v, end);
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.globalAlpha = 0.6 * Math.min(1, tr.progress * 2);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a, y + 0.5);
    ctx.lineTo(b, y + 0.5);
    ctx.font = "500 10px Geist, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let m = 0; m <= end; m += step) {
      const x = Math.round(this.sx(v, m)) + 0.5;
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x, y + 4);
      if (m > 0 && this.sx(v, end) - x > 26) ctx.fillText(String(m), x, y + 7);
    }
    ctx.moveTo(Math.round(b) + 0.5, y - 6);
    ctx.lineTo(Math.round(b) + 0.5, y + 6);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawHand(ctx: CanvasRenderingContext2D, hand: { x: number; y: number; down: number; alpha: number }): void {
    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.globalAlpha = hand.alpha;
    // The touch: a ring that closes when the finger is down.
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 15 - hand.down * 5, 0, 6.2832);
    ctx.stroke();
    ctx.fillStyle = `rgba(21, 20, 15, ${0.1 + 0.16 * hand.down})`;
    ctx.fill();
    // A pointing hand, drawn in outline, fingertip on the ring's centre.
    ctx.translate(-1, 3);
    ctx.scale(1.25, 1.25);
    ctx.beginPath();
    ctx.moveTo(-4, 14);
    ctx.lineTo(-4, -2);
    ctx.quadraticCurveTo(-4, -6.5, 0, -6.5);
    ctx.quadraticCurveTo(4, -6.5, 4, -2);
    ctx.lineTo(4, 9);
    ctx.quadraticCurveTo(8, 7, 9.5, 10);
    ctx.quadraticCurveTo(13.5, 8.5, 15, 12);
    ctx.quadraticCurveTo(19, 11, 20, 15.5);
    ctx.lineTo(20, 26);
    ctx.quadraticCurveTo(20, 36, 12, 38);
    ctx.lineTo(4, 38);
    ctx.quadraticCurveTo(-1, 37, -4, 31);
    ctx.lineTo(-11, 20);
    ctx.quadraticCurveTo(-13, 15.5, -9, 15);
    ctx.quadraticCurveTo(-6.5, 14.8, -4, 18);
    ctx.closePath();
    ctx.fillStyle = "#f8f5ee";
    ctx.fill();
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.restore();
  }

  /** What the plane would land on, for words on the end card. */
  kindAt(x: number): number {
    const i = Math.floor((x - this.world.x0) / this.world.res);
    return this.world.kind[i] ?? Surf.Street;
  }
}
