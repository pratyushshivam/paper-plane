import { makeRng, type Rng, type World } from "../engine";
import { blob } from "./ink";

/** What the drawing code needs to know about the view. All sizes in CSS px. */
export interface View {
  w: number;
  h: number;
  /** Camera centre in world metres, and pixels per metre. */
  cx: number;
  cy: number;
  ppm: number;
  /** Pixels per metre with no zoom applied. */
  base: number;
  t: number;
}

interface Layer {
  /** How much the layer moves with the camera: 0 is fixed, 1 is the play layer. */
  p: number;
  alpha: number;
  /** Outline points x, y in layer metres, x increasing. */
  pts: Float32Array;
  /** Small detail strokes x1, y1, x2, y2. */
  ticks: Float32Array;
  /** How much ink is mixed into the paper under the outline. */
  depth: number;
}

function noise(seed: number): (x: number) => number {
  const h = (i: number): number => {
    let n = Math.imul(i ^ seed, 0x45d9f3b);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  return (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const s = f * f * (3 - 2 * f);
    return h(i) + (h(i + 1) - h(i)) * s;
  };
}

function zoneAt(world: World, x: number): "town" | "park" | "river" | "hills" {
  const z = world.zones;
  if (x < z.town[1]) return "town";
  if (x < z.park[1]) return "park";
  if (x < z.river[1]) return "river";
  return "hills";
}

function mountains(world: World): Layer {
  const n1 = noise(world.seed ^ 11);
  const n2 = noise(world.seed ^ 12);
  const pts: number[] = [];
  const p = 0.05;
  for (let x = -80; x < world.length * p + 160; x += 0.5) {
    const ridge = 7 + 9 * Math.abs(n1(x / 17) - 0.5) * 2 + 3.5 * n2(x / 4.3) + 1.1 * n1(x / 1.1);
    pts.push(x, ridge);
  }
  const ticks: number[] = [];
  const r = makeRng(world.seed ^ 13);
  // A few strokes down the flanks.
  for (let i = 8; i < pts.length / 2 - 8; i += r.int(5, 12)) {
    const x = pts[i * 2] as number;
    const y = pts[i * 2 + 1] as number;
    const len = r.range(1, 3.2);
    ticks.push(x, y - 0.3, x + len * 0.5, y - 0.3 - len);
  }
  return { p, alpha: 0.26, pts: Float32Array.from(pts), ticks: Float32Array.from(ticks), depth: 0.022 };
}

function skyline(world: World, p: number, size: number, seedSalt: number, alpha: number, depth: number): Layer {
  const r: Rng = makeRng(world.seed ^ seedSalt);
  const n1 = noise(world.seed ^ (seedSalt + 1));
  const pts: number[] = [];
  const ticks: number[] = [];
  let x = -60;
  const end = world.length * p + 200;
  const ground = (lx: number): number => 1.2 + 1.3 * n1(lx / 13);
  pts.push(x, ground(x));
  while (x < end) {
    const zone = zoneAt(world, x / p);
    const g = ground(x);
    if (zone === "town") {
      const w = r.range(1.6, 4) * size;
      const h = g + r.range(2.2, 6.8) * size;
      const style = r.next();
      if (style < 0.3) {
        // Gable.
        pts.push(x, h - 1.2 * size, x + w / 2, h, x + w, h - 1.2 * size);
      } else if (style < 0.36) {
        // A spire.
        pts.push(x, h, x + w * 0.35, h, x + w / 2, h + 4.5 * size, x + w * 0.65, h, x + w, h);
      } else {
        pts.push(x, h, x + w, h);
        if (r.chance(0.5)) {
          const cx = x + w * r.range(0.2, 0.7);
          pts.splice(pts.length - 2, 0, cx, h, cx, h + 0.8 * size, cx + 0.35 * size, h + 0.8 * size, cx + 0.35 * size, h);
        }
      }
      // Windows as small ticks.
      for (let wy = g + 1.4 * size; wy < h - 1.6 * size; wy += 1.5 * size) {
        for (let wx = x + 0.5 * size; wx < x + w - 0.4 * size; wx += 0.9 * size) {
          if (r.chance(0.55)) ticks.push(wx, wy, wx, wy + 0.5 * size);
        }
      }
      x += w;
      const gap = r.chance(0.3) ? r.range(0.3, 1.2) * size : 0;
      if (gap > 0) {
        pts.push(x, ground(x), x + gap, ground(x + gap));
        x += gap;
      }
    } else if (zone === "park") {
      // Crowns of trees, side by side.
      const w = r.range(1.6, 3.4) * size;
      const h = r.range(2.4, 5) * size;
      const steps = 6;
      for (let i = 0; i <= steps; i++) {
        const a = Math.PI * (1 - i / steps);
        pts.push(x + w / 2 + (Math.cos(a) * w) / 2, g + 0.8 * size + Math.sin(a) * h * (0.85 + 0.3 * r.next()));
      }
      ticks.push(x + w / 2, g, x + w / 2, g + 0.9 * size);
      x += w * r.range(0.8, 1.5);
      pts.push(x, ground(x));
    } else if (zone === "river") {
      // The far bank: low and nearly level.
      const w = r.range(2, 5);
      x += w;
      pts.push(x, ground(x) * 0.5 + 0.2);
      if (r.chance(0.3)) ticks.push(x, 0.7, x + 0.1, 1.4 * size);
    } else {
      const d = x - (world.zones.river[1] * p);
      const rise = Math.min(1, Math.max(0, d / 30));
      x += 1;
      const y = g + rise * (3 + 6 * size * n1(x / 21 + 9) + 2 * n1(x / 5));
      pts.push(x, y);
      if (r.chance(0.12)) {
        // A lone tree on the ridge.
        ticks.push(x, y, x, y + 1.1 * size, x - 0.35 * size, y + 1.1 * size, x, y + 2 * size, x + 0.35 * size, y + 1.1 * size, x, y + 2 * size);
      }
    }
  }
  return { p, alpha, pts: Float32Array.from(pts), ticks: Float32Array.from(ticks), depth };
}

interface Cloud {
  x: number;
  y: number;
  p: number;
  scale: number;
  fill: Path2D;
  ink: Path2D;
}

function cloud(r: Rng): { fill: Path2D; ink: Path2D } {
  // Unit cloud: about 6 wide, flat underneath.
  const fill = new Path2D();
  const ink = new Path2D();
  const lumps = r.int(3, 5);
  let x = -3;
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < lumps; i++) {
    const w = 6 / lumps;
    const rad = w * r.range(0.55, 0.8);
    const lift = Math.sin(((i + 0.5) / lumps) * Math.PI) * r.range(0.5, 1.1);
    pts.push([x + w / 2, lift, rad]);
    x += w;
  }
  fill.moveTo(-3.2, 0);
  for (const [cx, cy, rad] of pts) fill.ellipse(cx, cy, rad, rad * 0.9, 0, Math.PI, 0, true);
  fill.lineTo(3.2, 0);
  fill.closePath();
  for (const [cx, cy, rad] of pts) blob(ink, r, cx, cy, rad, rad * 0.9, 5, 0.05, 0.25, Math.PI - 0.25);
  ink.moveTo(-3.1 + r.range(0, 0.6), 0);
  ink.lineTo(1.2 + r.range(0, 1.6), 0.02);
  ink.moveTo(-1.6, -0.35);
  ink.lineTo(0.8 + r.range(0, 1), -0.33);
  return { fill, ink };
}

function hex(c: number): string {
  return Math.round(c).toString(16).padStart(2, "0");
}

function mix(a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

type RGB = readonly [number, number, number];
const SKIES: ReadonlyArray<{ top: RGB; low: RGB }> = [
  { top: [238, 234, 224], low: [246, 242, 234] }, // town: plain paper
  { top: [236, 235, 224], low: [246, 243, 233] }, // park
  { top: [230, 234, 228], low: [243, 242, 235] }, // river: cooler
  { top: [241, 229, 211], low: [249, 240, 224] }, // hills: late light
];
const INK_RGB: RGB = [21, 20, 15];

export class Backdrop {
  private layers: Layer[];
  private clouds: Cloud[] = [];
  private world: World;
  private birds: Array<{ x: number; y: number; phase: number }> = [];
  /** Sky colours of the last frame, for anything that wants to match them. */
  low: [number, number, number] = [246, 242, 234];

  constructor(world: World) {
    this.world = world;
    this.layers = [mountains(world), skyline(world, 0.2, 0.55, 21, 0.34, 0.04), skyline(world, 0.45, 1, 31, 0.5, 0.062)];
    const r = makeRng(world.seed ^ 77);
    for (let i = 0; i < 16; i++) {
      const c = cloud(r);
      this.clouds.push({ x: r.range(0, 1), y: r.range(30, 84), p: r.range(0.1, 0.34), scale: r.range(0.8, 1.9), ...c });
    }
    this.clouds.sort((a, b) => a.p - b.p);
    for (let i = 0; i < 6; i++) this.birds.push({ x: r.range(-4, 4), y: r.range(-1.2, 1.2), phase: r.range(0, 6) });
  }

  private skyAt(x: number): { top: [number, number, number]; low: [number, number, number] } {
    const z = this.world.zones;
    const marks = [z.town[1], z.park[1], z.river[1]];
    let i = 0;
    let t = 0;
    for (let k = 0; k < marks.length; k++) {
      const m = marks[k] as number;
      if (x > m - 30) {
        i = k;
        t = Math.min(1, (x - (m - 30)) / 60);
      }
    }
    const a = SKIES[i] as { top: RGB; low: RGB };
    const b = SKIES[Math.min(SKIES.length - 1, i + 1)] as { top: RGB; low: RGB };
    const s = t * t * (3 - 2 * t);
    return { top: mix(a.top, b.top, s), low: mix(a.low, b.low, s) };
  }

  draw(ctx: CanvasRenderingContext2D, v: View): void {
    const { w, h } = v;
    const sky = this.skyAt(v.cx);
    this.low = sky.low;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `#${hex(sky.top[0])}${hex(sky.top[1])}${hex(sky.top[2])}`);
    g.addColorStop(0.75, `#${hex(sky.low[0])}${hex(sky.low[1])}${hex(sky.low[2])}`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const zoom = v.ppm / v.base;
    const far = Math.max(0, v.cx);

    // The sun: a ring that sinks as the flight goes on.
    const sunX = w * 0.78 - far * 0.12;
    const sunY = h * 0.17 + Math.min(far, 900) * 0.16 + (v.cy - 25) * 1.2;
    const sunR = Math.min(w, h) * 0.055;
    ctx.fillStyle = "rgba(252, 248, 238, 0.9)";
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, 6.2832);
    ctx.fill();
    ctx.strokeStyle = "rgba(21, 20, 15, 0.42)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = "rgba(21, 20, 15, 0.14)";
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 1.5, 0, 6.2832);
    ctx.stroke();

    this.drawBirds(ctx, v, zoom);

    let cloudAt = 0;
    for (const layer of this.layers) {
      // Clouds that sit behind this layer.
      while (cloudAt < this.clouds.length && (this.clouds[cloudAt] as Cloud).p < layer.p) {
        this.drawCloud(ctx, v, this.clouds[cloudAt] as Cloud, zoom);
        cloudAt++;
      }
      this.drawLayer(ctx, v, layer, zoom, sky.low);
    }
    while (cloudAt < this.clouds.length) {
      this.drawCloud(ctx, v, this.clouds[cloudAt] as Cloud, zoom);
      cloudAt++;
    }
  }

  private drawLayer(ctx: CanvasRenderingContext2D, v: View, layer: Layer, zoom: number, low: RGB): void {
    const { w, h } = v;
    const s = v.base * (0.3 + 0.6 * layer.p) * Math.pow(zoom, 0.3 + 0.7 * layer.p);
    const baseY = h * 0.56 + v.cy * v.ppm * layer.p;
    if (baseY - 30 * s > h) return;
    const camX = v.cx * layer.p;
    const lo = camX - w / 2 / s - 8;
    const hi = camX + w / 2 / s + 8;
    const pts = layer.pts;
    const n = pts.length / 2;
    // Find the first point at or after `lo`.
    let a = 0;
    let b = n - 1;
    while (a < b) {
      const m = (a + b) >> 1;
      if ((pts[m * 2] as number) < lo) a = m + 1;
      else b = m;
    }
    const start = Math.max(0, a - 1);
    ctx.beginPath();
    let lastX = 0;
    let first = true;
    for (let i = start; i < n; i++) {
      const lx = pts[i * 2] as number;
      const x = w / 2 + (lx - camX) * s;
      const y = baseY - (pts[i * 2 + 1] as number) * s;
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else ctx.lineTo(x, y);
      lastX = x;
      if (lx > hi) break;
    }
    const tone = mix(low, INK_RGB, layer.depth);
    ctx.strokeStyle = `rgba(21, 20, 15, ${layer.alpha})`;
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.lineTo(lastX, h + 2);
    ctx.lineTo(w / 2 + ((pts[start * 2] as number) - camX) * s, h + 2);
    ctx.closePath();
    ctx.fillStyle = `rgb(${tone[0] | 0}, ${tone[1] | 0}, ${tone[2] | 0})`;
    ctx.fill();

    // Detail strokes.
    const ticks = layer.ticks;
    ctx.beginPath();
    const tn = ticks.length / 4;
    let ta = 0;
    let tb = tn - 1;
    while (ta < tb) {
      const m = (ta + tb) >> 1;
      if ((ticks[m * 4] as number) < lo) ta = m + 1;
      else tb = m;
    }
    for (let i = ta; i < tn; i++) {
      const x1 = ticks[i * 4] as number;
      if (x1 > hi + 6) break;
      ctx.moveTo(w / 2 + (x1 - camX) * s, baseY - (ticks[i * 4 + 1] as number) * s);
      ctx.lineTo(w / 2 + ((ticks[i * 4 + 2] as number) - camX) * s, baseY - (ticks[i * 4 + 3] as number) * s);
    }
    ctx.strokeStyle = `rgba(21, 20, 15, ${layer.alpha * 0.6})`;
    ctx.stroke();
  }

  private drawCloud(ctx: CanvasRenderingContext2D, v: View, c: Cloud, zoom: number): void {
    const { w, h } = v;
    const s = v.base * (0.3 + 0.6 * c.p) * Math.pow(zoom, 0.3 + 0.7 * c.p) * c.scale * 1.15;
    // Clouds drift with the wind and wrap around a strip wider than the screen.
    const span = w + 14 * s;
    const drift = (this.world.wind.base * 0.5 + 0.25) * v.t * v.base * c.p * 0.6;
    let x = c.x * span + drift - v.cx * c.p * v.base * 0.9;
    x = ((x % span) + span) % span - 7 * s;
    const y = h * 0.5 - (c.y - v.cy) * v.ppm * c.p * 0.8 - h * 0.08;
    if (y < -3 * s || y > h + 2 * s) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, -s);
    ctx.fillStyle = "rgba(251, 248, 241, 0.92)";
    ctx.fill(c.fill);
    ctx.lineWidth = 1 / s;
    ctx.strokeStyle = `rgba(21, 20, 15, ${0.2 + c.p * 0.75})`;
    ctx.stroke(c.ink);
    ctx.restore();
  }

  private drawBirds(ctx: CanvasRenderingContext2D, v: View, zoom: number): void {
    const { w, h } = v;
    const s = 9 * Math.pow(zoom, 0.2);
    const span = w * 2.4;
    let fx = w * 0.3 + v.t * 9 - v.cx * 2.2;
    fx = ((fx % span) + span) % span - w * 0.6;
    const fy = h * 0.24 + Math.sin(v.t * 0.3) * 12 + (v.cy - 25) * 2;
    ctx.beginPath();
    for (const b of this.birds) {
      const x = fx + b.x * s * 2.4;
      const y = fy + b.y * s * 2;
      const flap = Math.sin(v.t * 5.5 + b.phase) * 0.45;
      ctx.moveTo(x - s * 0.55, y - s * (0.12 + flap * 0.4));
      ctx.quadraticCurveTo(x - s * 0.25, y - s * 0.3, x, y);
      ctx.quadraticCurveTo(x + s * 0.25, y - s * 0.3, x + s * 0.55, y - s * (0.12 + flap * 0.4));
    }
    ctx.strokeStyle = "rgba(21, 20, 15, 0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
