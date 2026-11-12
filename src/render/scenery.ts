import { ROOM, Surf, makeRng, terrainAt, type Building, type Rng, type Tree, type World } from "../engine";
import { blob, box, ellipsePath, hatch, poly, rectPath, rules, stroke } from "./ink";

/**
 * Everything that stands still, drawn once per world into cached paths.
 * A prop is filled with a paper tone (so it hides what is behind it), then
 * inked in three weights: outline, detail, shading.
 */
export interface Prop {
  x0: number;
  x1: number;
  fill?: Path2D;
  tone?: string;
  /** A second fill, drawn over the first (the lit inside of the room). */
  fill2?: Path2D;
  tone2?: string;
  ink: Path2D;
  fine: Path2D;
  shade: Path2D;
  /** The engine object this was drawn from, when something needs to find it. */
  ref?: Tree | Building;
}

export const TONES = {
  wall: ["#f4f0e8", "#eeeadf", "#f1ece1", "#ebe6da"],
  room: "#ece6d8",
  leaf: "#eae6d9",
  ground: "#ebe6d9",
  street: "#e7e2d5",
  water: "#e3e6df",
  hill: "#ebe5d4",
} as const;

function prop(x0: number, x1: number): Prop {
  return { x0, x1, ink: new Path2D(), fine: new Path2D(), shade: new Path2D() };
}

function windowAt(p: Prop, r: Rng, x: number, y: number, w: number, h: number): void {
  box(p.fine, r, x, y, x + w, y + h, 0.02);
  const style = r.next();
  if (style < 0.22) {
    hatch(p.shade, r, x + 0.05, y + 0.05, x + w - 0.05, y + h - 0.05, 0.16, 1);
  } else if (style < 0.8) {
    stroke(p.fine, r, x + w / 2, y, x + w / 2, y + h, 0.012);
    if (h > 1.3) stroke(p.fine, r, x, y + h * 0.58, x + w, y + h * 0.58, 0.012);
  } else {
    // A blind half drawn.
    const drop = h * r.range(0.3, 0.6);
    rules(p.shade, r, x + 0.04, y + h - drop, x + w - 0.04, y + h, 0.11);
  }
  stroke(p.fine, r, x - 0.1, y - 0.06, x + w + 0.1, y - 0.06, 0.012);
  if (r.chance(0.16)) {
    // Shutters.
    box(p.fine, r, x - 0.42, y, x - 0.06, y + h, 0.015);
    box(p.fine, r, x + w + 0.06, y, x + w + 0.42, y + h, 0.015);
    rules(p.shade, r, x - 0.4, y, x - 0.08, y + h, 0.2);
    rules(p.shade, r, x + w + 0.08, y, x + w + 0.4, y + h, 0.2);
  } else if (r.chance(0.14)) {
    // A window box.
    blob(p.fine, r, x + w / 2, y + 0.08, w * 0.55, 0.2, 7, 0.07, 0, Math.PI);
  }
}

function facade(p: Prop, r: Rng, x0: number, x1: number, y0: number, y1: number, street: boolean): void {
  const w = x1 - x0;
  const cols = Math.max(1, Math.floor((w - 1) / 2.6));
  const pitch = w / cols;
  const ww = Math.min(1.25, pitch * 0.46);
  const firstFloor = street ? y0 + 3.5 : y0 + 0.9;
  for (let y = firstFloor; y + 2.3 < y1; y += 3.05) {
    for (let c = 0; c < cols; c++) {
      if (r.chance(0.06)) continue;
      windowAt(p, r, x0 + pitch * (c + 0.5) - ww / 2, y, ww, 1.65);
    }
    if (r.chance(0.3)) stroke(p.shade, r, x0, y - 0.55, x1, y - 0.55, 0.02);
  }
  if (!street || y1 - y0 < 4) return;
  // Street level: a door, and a shop front or two windows.
  const door = x0 + pitch * (r.int(0, cols - 1) + 0.5);
  poly(p.fine, r, [door - 0.55, y0, door - 0.55, y0 + 2.1, door + 0.55, y0 + 2.1, door + 0.55, y0], false, 0.02);
  blob(p.fine, r, door, y0 + 2.1, 0.55, 0.3, 4, 0.02, 0, Math.PI);
  stroke(p.fine, r, door + 0.3, y0 + 1.05, door + 0.36, y0 + 1.05, 0.005);
  for (let c = 0; c < cols; c++) {
    const cx = x0 + pitch * (c + 0.5);
    if (Math.abs(cx - door) < 0.2) continue;
    if (r.chance(0.45)) {
      const half = Math.min(1.1, pitch * 0.4);
      box(p.fine, r, cx - half, y0 + 0.55, cx + half, y0 + 2.2, 0.02);
      // Awning.
      poly(p.fine, r, [cx - half - 0.15, y0 + 2.65, cx + half + 0.15, y0 + 2.65, cx + half + 0.3, y0 + 2.25, cx - half - 0.3, y0 + 2.25], true, 0.02);
      for (let s = -half; s < half; s += 0.36) stroke(p.shade, r, cx + s, y0 + 2.65, cx + s - 0.06, y0 + 2.25, 0.01);
    } else {
      windowAt(p, r, cx - ww / 2, y0 + 0.95, ww, 1.4);
    }
  }
}

function house(b: Building, world: World): Prop {
  const r = makeRng(b.seed);
  const p = prop(b.x0 - 0.5, b.x1 + 0.5);
  const base = b.kind === "barn" ? Math.min(terrainAt(world, b.x0), terrainAt(world, b.x1)) - 0.6 : -0.2;
  const mid = (b.x0 + b.x1) / 2;
  const top = b.h + b.ridge;
  p.fill = new Path2D();
  p.tone = r.pick(TONES.wall);
  p.fill.moveTo(b.x0, base);
  p.fill.lineTo(b.x0, b.h);
  if (b.roof === "gable") p.fill.lineTo(mid, top);
  p.fill.lineTo(b.x1, b.h);
  p.fill.lineTo(b.x1, base);
  p.fill.closePath();
  for (const c of b.chimneys) rectPath(p.fill, c.x0, b.h - 0.2, c.x1, c.top);

  stroke(p.ink, r, b.x0, base, b.x0, b.h + 0.05);
  stroke(p.ink, r, b.x1, base, b.x1, b.h + 0.05);
  if (b.roof === "gable") {
    stroke(p.ink, r, b.x0 - 0.35, b.h - 0.12, mid + 0.05, top);
    stroke(p.ink, r, mid - 0.05, top, b.x1 + 0.35, b.h - 0.12);
    stroke(p.fine, r, b.x0, b.h, b.x1, b.h, 0.02);
    // Tiles: level lines cut to the roof triangle.
    const half = (b.x1 - b.x0) / 2;
    for (let y = b.h + 0.3; y < top - 0.15; y += 0.34 * r.range(0.9, 1.1)) {
      const inset = ((y - b.h) / b.ridge) * half;
      let x = b.x0 + inset + r.range(0, 0.6);
      const end = b.x1 - inset;
      while (x < end) {
        const e = Math.min(end, x + r.range(0.6, 2.2));
        stroke(p.shade, r, x, y, e, y, 0.015);
        x = e + r.range(0.2, 0.7);
      }
    }
  } else {
    // A flat roof with a cornice and a low parapet.
    stroke(p.ink, r, b.x0 - 0.25, b.h, b.x1 + 0.25, b.h);
    stroke(p.fine, r, b.x0 - 0.2, b.h - 0.32, b.x1 + 0.2, b.h - 0.32, 0.02);
    hatch(p.shade, r, b.x0, b.h - 0.9, b.x1, b.h - 0.34, 0.2, 1);
    if (b.kind === "house" && r.chance(0.5)) {
      // An aerial.
      const ax = b.x0 + (b.x1 - b.x0) * r.range(0.25, 0.75);
      stroke(p.fine, r, ax, b.h, ax, b.h + 1.3, 0.01);
      stroke(p.fine, r, ax - 0.3, b.h + 1.1, ax + 0.3, b.h + 1.1, 0.01);
      stroke(p.fine, r, ax - 0.2, b.h + 0.85, ax + 0.2, b.h + 0.85, 0.01);
    }
  }
  for (const c of b.chimneys) {
    stroke(p.ink, r, c.x0, b.h + 0.02, c.x0, c.top, 0.02);
    stroke(p.ink, r, c.x1, b.h + 0.02, c.x1, c.top, 0.02);
    stroke(p.ink, r, c.x0 - 0.12, c.top, c.x1 + 0.12, c.top, 0.02);
    stroke(p.fine, r, c.x0 - 0.08, c.top - 0.2, c.x1 + 0.08, c.top - 0.2, 0.015);
    hatch(p.shade, r, (c.x0 + c.x1) / 2, b.h + 0.3, c.x1, c.top - 0.22, 0.14, 1);
  }
  // The shaded side.
  hatch(p.shade, r, b.x1 - Math.min(1.1, (b.x1 - b.x0) * 0.1), base + 0.2, b.x1, b.h - (b.roof === "flat" ? 0.9 : 0.1), 0.26, 1);

  if (b.kind === "barn") {
    const dw = Math.min(2.6, (b.x1 - b.x0) * 0.34);
    box(p.fine, r, mid - dw / 2, base + 0.6, mid + dw / 2, b.h - 0.4, 0.02);
    stroke(p.fine, r, mid - dw / 2, base + 0.6, mid + dw / 2, b.h - 0.4, 0.02);
    stroke(p.fine, r, mid + dw / 2, base + 0.6, mid - dw / 2, b.h - 0.4, 0.02);
    for (let x = b.x0 + 0.5; x < b.x1 - 0.2; x += 0.55) {
      if (Math.abs(x - mid) < dw / 2 + 0.1) continue;
      stroke(p.shade, r, x, base + 0.7, x, b.h - 0.1, 0.015);
    }
    box(p.fine, r, mid - 0.35, b.h + b.ridge * 0.3, mid + 0.35, b.h + b.ridge * 0.62, 0.015);
  } else {
    facade(p, r, b.x0 + 0.3, b.x1 - 0.3, 0, b.h - 0.6, true);
  }
  p.ref = b;
  return p;
}

function tower(b: Building): Prop {
  const r = makeRng(b.seed);
  const p = prop(b.x0 - 0.6, b.x1 + 0.6);
  const arch = b.arch as { y0: number; y1: number };
  const mid = (b.x0 + b.x1) / 2;
  p.fill = new Path2D();
  p.tone = TONES.wall[1];
  rectPath(p.fill, b.x0, -0.2, b.x1, arch.y0);
  rectPath(p.fill, b.x0, arch.y1, b.x1, b.h);
  rectPath(p.fill, b.x0, arch.y0, b.x0 + 0.3, arch.y1);
  rectPath(p.fill, b.x1 - 0.3, arch.y0, b.x1, arch.y1);
  // Shaft.
  stroke(p.ink, r, b.x0, -0.2, b.x0, arch.y0);
  stroke(p.ink, r, b.x1, -0.2, b.x1, arch.y0);
  stroke(p.ink, r, b.x0 - 0.3, arch.y0, b.x1 + 0.3, arch.y0);
  stroke(p.fine, r, b.x0 - 0.2, arch.y0 - 0.3, b.x1 + 0.2, arch.y0 - 0.3, 0.02);
  hatch(p.shade, r, b.x1 - 0.8, 0.2, b.x1, arch.y0 - 0.4, 0.24, 1);
  // Corner posts of the open belfry, and its top.
  for (const x of [b.x0, b.x1 - 0.3]) box(p.ink, r, x, arch.y0, x + 0.3, arch.y1, 0.015);
  box(p.ink, r, b.x0 - 0.2, arch.y1, b.x1 + 0.2, b.h, 0.03);
  stroke(p.fine, r, b.x0 - 0.2, b.h - 0.35, b.x1 + 0.2, b.h - 0.35, 0.02);
  hatch(p.shade, r, b.x0, arch.y1 + 0.1, b.x1, b.h - 0.4, 0.2, 1);
  // The bell, tucked up under the top.
  const by = arch.y1;
  stroke(p.fine, r, mid, by, mid, by - 0.2, 0.005);
  poly(p.fine, r, [mid - 0.2, by - 0.2, mid + 0.2, by - 0.2, mid + 0.34, by - 0.75, mid - 0.34, by - 0.75], true, 0.012);
  // A vane on top.
  stroke(p.fine, r, mid, b.h, mid, b.h + 1.1, 0.008);
  poly(p.fine, r, [mid, b.h + 1.05, mid + 0.5, b.h + 0.9, mid, b.h + 0.75], false, 0.008);
  // Clock and slits.
  const cy = arch.y0 - 2.6;
  blob(p.ink, r, mid, cy, 1.05, 1.05, 14, 0.015);
  blob(p.fine, r, mid, cy, 0.88, 0.88, 12, 0.01);
  stroke(p.fine, r, mid, cy, mid, cy + 0.62, 0.006);
  stroke(p.fine, r, mid, cy, mid + 0.4, cy - 0.18, 0.006);
  for (let y = 3.2; y < cy - 2.6; y += 3.4) {
    box(p.fine, r, mid - 0.22, y, mid + 0.22, y + 1.3, 0.012);
    hatch(p.shade, r, mid - 0.2, y + 0.03, mid + 0.2, y + 1.27, 0.12, 1);
  }
  poly(p.fine, r, [mid - 0.6, -0.2, mid - 0.6, 1.9, mid + 0.6, 1.9, mid + 0.6, -0.2], false, 0.02);
  blob(p.fine, r, mid, 1.9, 0.6, 0.45, 5, 0.02, 0, Math.PI);
  p.ref = b;
  return p;
}

function home(): Prop {
  const r = makeRng(90210);
  const R = ROOM;
  const p = prop(R.left - 0.6, R.out + 1.4);
  p.fill = new Path2D();
  p.tone = TONES.wall[0];
  rectPath(p.fill, R.left, -0.2, R.back, R.top);
  rectPath(p.fill, R.back, -0.2, R.out, R.floor);
  rectPath(p.fill, R.back, R.ceil, R.out, R.top);
  rectPath(p.fill, R.wall, R.floor, R.out, R.sill);
  rectPath(p.fill, R.wall, R.lintel, R.out, R.ceil);
  p.fill2 = new Path2D();
  p.tone2 = TONES.room;
  rectPath(p.fill2, R.back, R.floor, R.wall, R.ceil);

  // Outside.
  stroke(p.ink, r, R.left, -0.2, R.left, R.top);
  stroke(p.ink, r, R.out, -0.2, R.out, R.sill);
  stroke(p.ink, r, R.out, R.lintel, R.out, R.top);
  stroke(p.ink, r, R.left - 0.3, R.top, R.out + 0.3, R.top);
  stroke(p.fine, r, R.left - 0.25, R.top - 0.3, R.out + 0.25, R.top - 0.3, 0.02);
  // Roof rail and a chimney, well back from the edge.
  for (let x = R.left + 0.4; x < R.out - 0.2; x += 0.9) stroke(p.fine, r, x, R.top, x, R.top + 0.55, 0.008);
  stroke(p.fine, r, R.left + 0.3, R.top + 0.55, R.out - 0.2, R.top + 0.55, 0.015);
  box(p.ink, r, 2.2, R.top, 3.1, R.top + 1.5, 0.02);
  stroke(p.ink, r, 2.05, R.top + 1.5, 3.25, R.top + 1.5, 0.02);
  hatch(p.shade, r, 2.65, R.top + 0.1, 3.1, R.top + 1.4, 0.14, 1);
  // The floors below and the wall beside the room.
  facade(p, r, R.left + 0.4, R.out - 0.4, 0, R.floor - 0.9, true);
  facade(p, r, R.left + 0.3, R.back - 0.5, R.floor - 0.4, R.top - 0.5, false);
  hatch(p.shade, r, R.out - 1, 0.2, R.out, R.floor - 0.5, 0.26, 1);

  // The room, cut open. Walls, floor and ceiling in section: heavy line, hatched.
  box(p.ink, r, R.back, R.floor, R.wall, R.ceil, 0.02);
  stroke(p.ink, r, R.back, R.floor - 0.02, R.wall, R.floor - 0.02, 0.015);
  hatch(p.shade, r, R.back - 0.35, R.floor - 0.35, R.out, R.floor, 0.13, -1);
  hatch(p.shade, r, R.back - 0.35, R.ceil, R.out, R.ceil + 0.35, 0.13, -1);
  hatch(p.shade, r, R.back - 0.35, R.floor, R.back, R.ceil, 0.13, -1);
  hatch(p.shade, r, R.wall, R.floor, R.out, R.sill, 0.13, -1);
  hatch(p.shade, r, R.wall, R.lintel, R.out, R.ceil, 0.13, -1);
  box(p.ink, r, R.wall, R.floor, R.out, R.sill, 0.012);
  box(p.ink, r, R.wall, R.lintel, R.out, R.ceil, 0.012);
  // Window ledge outside, and the frame swung open.
  poly(p.ink, r, [R.out, R.sill, R.out + 0.42, R.sill, R.out + 0.42, R.sill - 0.14, R.out, R.sill - 0.14], false, 0.012);
  poly(p.fine, r, [R.out + 0.04, R.sill + 0.1, R.out + 1.05, R.sill + 0.5, R.out + 1.05, R.lintel + 0.28, R.out + 0.04, R.lintel - 0.06], true, 0.015);
  stroke(p.fine, r, R.out + 0.04, (R.sill + R.lintel) / 2 + 0.03, R.out + 1.05, (R.sill + R.lintel) / 2 + 0.4, 0.012);
  stroke(p.fine, r, R.out + 0.55, R.sill + 0.3, R.out + 0.55, R.lintel + 0.1, 0.012);

  const f = R.floor;
  // Skirting and boards.
  stroke(p.fine, r, R.back, f + 0.16, R.wall, f + 0.16, 0.012);
  // Bookshelf on the far wall.
  const sx = R.back + 0.5;
  box(p.fine, r, sx, f + 0.16, sx + 1.9, f + 2.9, 0.02);
  for (let y = f + 0.7; y < f + 2.8; y += 0.55) {
    stroke(p.fine, r, sx, y, sx + 1.9, y, 0.012);
    let bx = sx + 0.08;
    while (bx < sx + 1.75) {
      const bw = r.range(0.07, 0.16);
      if (r.chance(0.85)) {
        const bh = r.range(0.3, 0.46);
        box(p.shade, r, bx, y + 0.01, bx + bw, y + bh, 0.006);
      }
      bx += bw + 0.02;
    }
  }
  // Two frames and a tall far window with a view of nothing much.
  box(p.fine, r, -2.75, f + 2.2, -1.75, f + 3.0, 0.015);
  box(p.shade, r, -2.65, f + 2.3, -1.85, f + 2.9, 0.01);
  poly(p.shade, r, [-2.6, f + 2.4, -2.3, f + 2.7, -2.1, f + 2.5, -1.9, f + 2.75], false, 0.01);
  box(p.fine, r, -3.0, f + 3.35, -2.3, f + 3.95, 0.015);
  blob(p.shade, r, -2.65, f + 3.62, 0.2, 0.16, 6, 0.02);
  // The table the launcher stands on, a chair, a stack of paper.
  const ty = f + 0.95;
  poly(p.ink, r, [-1.25, ty, 0.85, ty, 0.85, ty - 0.09, -1.25, ty - 0.09], true, 0.012);
  stroke(p.fine, r, -1.1, ty - 0.09, -1.02, f, 0.012);
  stroke(p.fine, r, -1.0, ty - 0.09, -0.92, f, 0.012);
  stroke(p.fine, r, 0.62, ty - 0.09, 0.7, f, 0.012);
  stroke(p.fine, r, 0.72, ty - 0.09, 0.8, f, 0.012);
  stroke(p.shade, r, -0.98, f + 0.3, 0.68, f + 0.3, 0.012);
  for (let i = 0; i < 5; i++) stroke(p.fine, r, -1.1 + r.range(-0.02, 0.02), ty + 0.03 + i * 0.028, -0.5 + r.range(-0.03, 0.03), ty + 0.03 + i * 0.028, 0.004);
  // Chair.
  poly(p.fine, r, [-2.3, f, -2.26, f + 1.45], false, 0.01);
  poly(p.fine, r, [-2.28, f + 0.62, -1.6, f + 0.62, -1.58, f], false, 0.01);
  stroke(p.fine, r, -2.3, f + 1.4, -2.18, f + 1.4, 0.006);
  // The launcher: a wooden fork on a block.
  box(p.ink, r, -0.14, ty, 0.3, ty + 0.1, 0.008);
  // A plant by the window.
  const px = 4.15;
  poly(p.fine, r, [px - 0.28, f + 0.5, px - 0.2, f, px + 0.2, f, px + 0.28, f + 0.5], true, 0.012);
  for (let i = 0; i < 7; i++) {
    const a = 0.5 + (i / 6) * 2.1;
    const len = r.range(0.7, 1.35);
    const ex = px + Math.cos(a) * len * 0.75;
    const ey = f + 0.5 + Math.sin(a) * len;
    const leaf = new Path2D();
    leaf.moveTo(px, f + 0.5);
    leaf.quadraticCurveTo(px + (ex - px) * 0.3 - 0.12, f + 0.5 + (ey - f - 0.5) * 0.7, ex, ey);
    leaf.quadraticCurveTo(px + (ex - px) * 0.6 + 0.12, f + 0.5 + (ey - f - 0.5) * 0.5, px, f + 0.5);
    p.fine.addPath(leaf);
  }
  // A rug, a cat asleep on it.
  stroke(p.fine, r, 1.5, f + 0.035, 3.7, f + 0.035, 0.006);
  for (let x = 1.5; x <= 3.7; x += 0.11) stroke(p.shade, r, x, f + 0.03, x + 0.02, f - 0.0, 0.004);
  const cat = new Path2D();
  cat.moveTo(2.2, f + 0.05);
  cat.bezierCurveTo(2.1, f + 0.5, 2.75, f + 0.56, 2.95, f + 0.3);
  cat.lineTo(3.0, f + 0.46);
  cat.lineTo(3.08, f + 0.33);
  cat.lineTo(3.17, f + 0.44);
  cat.bezierCurveTo(3.3, f + 0.2, 3.2, f + 0.05, 3.05, f + 0.05);
  cat.moveTo(2.2, f + 0.05);
  cat.bezierCurveTo(1.9, f + 0.02, 1.9, f + 0.26, 2.12, f + 0.2);
  p.ink.addPath(cat);
  stroke(p.fine, r, 2.98, f + 0.2, 3.06, f + 0.19, 0.003);
  // Earlier attempts, on the floor.
  for (const [x, a] of [[0.95, 0.5], [3.95, -0.2], [-3.3, 2.6]] as const) {
    const c = Math.cos(a) * 0.36;
    const s = Math.abs(Math.sin(a)) * 0.12;
    poly(p.fine, r, [x - c, f + 0.03 + s * 2, x + c, f + 0.03, x - c * 0.6, f + 0.2 + s], true, 0.006);
  }
  // A lamp hanging from the ceiling.
  stroke(p.fine, r, 2.3, R.ceil, 2.3, R.ceil - 0.75, 0.004);
  poly(p.ink, r, [2.12, R.ceil - 0.75, 2.48, R.ceil - 0.75, 2.72, R.ceil - 1.12, 1.88, R.ceil - 1.12], true, 0.01);
  return p;
}

function tree(t: Tree): Prop {
  const r = makeRng(t.seed);
  const p = prop(t.cx - t.rx - 0.8, t.cx + t.rx + 0.8);
  p.fill = new Path2D();
  p.tone = TONES.leaf;
  p.ref = t;
  const foot = t.base - 0.2;
  if (t.kind === "pine") {
    const top = t.cy + t.ry;
    const bot = t.cy - t.ry;
    stroke(p.ink, r, t.x - 0.16, foot, t.x - 0.1, bot + 0.3, 0.02);
    stroke(p.ink, r, t.x + 0.16, foot, t.x + 0.1, bot + 0.3, 0.02);
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const y1 = bot + ((top - bot) * i) / tiers;
      const y2 = bot + ((top - bot) * (i + 1.5)) / tiers;
      const w = t.rx * (1 - i / (tiers + 0.6));
      const tipY = Math.min(top, y2);
      p.fill.moveTo(t.cx - w, y1);
      p.fill.lineTo(t.cx, tipY);
      p.fill.lineTo(t.cx + w, y1);
      p.fill.closePath();
      poly(p.ink, r, [t.cx - w * 0.3, y1 + 0.1, t.cx - w, y1, t.cx - 0.05, tipY], false, 0.04);
      poly(p.ink, r, [t.cx + 0.05, tipY, t.cx + w, y1, t.cx + w * 0.3, y1 + 0.1], false, 0.04);
      for (let k = 0; k < 4; k++) {
        const hx = t.cx + w * r.range(0.1, 0.75);
        const hy = y1 + (tipY - y1) * r.range(0.05, 0.3);
        stroke(p.shade, r, hx, hy, hx - 0.25, hy + 0.5, 0.02);
      }
    }
    return p;
  }
  const trunkTop = t.cy - t.ry * (t.kind === "poplar" ? 0.9 : 0.55);
  stroke(p.ink, r, t.x - 0.22, foot, t.x - 0.13, trunkTop, 0.025);
  stroke(p.ink, r, t.x + 0.22, foot, t.x + 0.13, trunkTop, 0.025);
  ellipsePath(p.fill, t.cx, t.cy, t.rx * 0.97, t.ry * 0.97);
  if (t.kind === "poplar") {
    blob(p.ink, r, t.cx, t.cy, t.rx, t.ry, 16, 0.2);
    for (let i = 0; i < 7; i++) {
      const x = t.cx + t.rx * r.range(-0.5, 0.75);
      const y = t.cy + t.ry * r.range(-0.7, 0.5);
      blob(p.shade, r, x, y, t.rx * 0.3, t.ry * 0.13, 3, 0.1, -0.4, 1.9);
    }
    return p;
  }
  blob(p.ink, r, t.cx, t.cy, t.rx, t.ry, 13, 0.3);
  // Clumps inside the crown, and shading on the side away from the sun.
  for (let i = 0; i < 6; i++) {
    const a = r.range(0, 6.28);
    const d = r.range(0.15, 0.6);
    blob(p.fine, r, t.cx + Math.cos(a) * t.rx * d, t.cy + Math.sin(a) * t.ry * d, t.rx * 0.32, t.ry * 0.26, 4, 0.14, r.range(-0.3, 0.4), r.range(2.2, 3.4));
  }
  for (let i = 0; i < 9; i++) {
    const a = r.range(-1.3, 0.2);
    const d = r.range(0.5, 0.86);
    const x = t.cx + Math.cos(a) * t.rx * d;
    const y = t.cy + Math.sin(a) * t.ry * d;
    stroke(p.shade, r, x, y, x - 0.3, y + 0.42, 0.02);
  }
  // A branch or two showing under the crown.
  stroke(p.fine, r, t.x - 0.05, trunkTop - 0.2, t.cx - t.rx * 0.4, t.cy - t.ry * 0.25, 0.03);
  stroke(p.fine, r, t.x + 0.05, trunkTop - 0.4, t.cx + t.rx * 0.35, t.cy - t.ry * 0.15, 0.03);
  return p;
}

/** Small things on the ground, baked into one prop per stretch of world. */
function groundDetail(world: World, x0: number, x1: number, r: Rng): Prop {
  const p = prop(x0, x1);
  const { park, river, hills, town } = world.zones;
  let x = x0 + r.range(0, 1.5);
  while (x < x1) {
    const y = terrainAt(world, x);
    const i = Math.floor((x - world.x0) / world.res);
    const k = world.kind[i];
    const solid = world.surface[i] as number;
    if (solid > y + 0.3 && k !== Surf.Water) {
      x += 1;
      continue;
    }
    if (x > town[0] && x < town[1]) {
      // Kerb and the odd paving line.
      if (r.chance(0.5)) stroke(p.shade, r, x, -0.12, x + r.range(0.4, 1.2), -0.12, 0.004);
      x += r.range(0.8, 2);
    } else if (x >= park[0] && x < park[1]) {
      const roll = r.next();
      if (roll < 0.75) {
        // Grass.
        for (let b = 0; b < 3; b++) stroke(p.fine, r, x + b * 0.07, y, x + b * 0.07 + r.range(-0.09, 0.09), y + r.range(0.14, 0.32), 0.006);
      } else if (roll < 0.86) {
        // A flower.
        stroke(p.fine, r, x, y, x + 0.03, y + 0.36, 0.005);
        blob(p.fine, r, x + 0.03, y + 0.42, 0.07, 0.07, 5, 0.02);
      } else if (roll < 0.9) {
        // A bench.
        poly(p.ink, r, [x, y + 0.45, x + 1.5, y + 0.45], false, 0.008);
        poly(p.fine, r, [x + 0.1, y, x + 0.12, y + 0.95, x + 1.38, y + 0.95, x + 1.4, y], false, 0.008);
        stroke(p.fine, r, x + 0.12, y + 0.72, x + 1.38, y + 0.72, 0.006);
        x += 1.6;
      } else if (roll < 0.94) {
        // A lamp post.
        stroke(p.ink, r, x, y, x, y + 3.6, 0.008);
        poly(p.fine, r, [x - 0.2, y + 3.6, x + 0.2, y + 3.6, x + 0.13, y + 4.0, x - 0.13, y + 4.0], true, 0.008);
      } else {
        // A bush.
        blob(p.ink, r, x + 0.5, y + 0.1, r.range(0.6, 0.95), r.range(0.5, 0.75), 7, 0.14, -0.1, Math.PI + 0.1);
        x += 1.2;
      }
      x += r.range(0.5, 1.5);
    } else if (x >= river[0] - 2 && x < river[1] + 2) {
      // Reeds on the banks.
      const edge = Math.min(Math.abs(x - river[0]), Math.abs(x - river[1]));
      if (edge < 5.5 && r.chance(0.8)) {
        const foot = Math.max(y, world.water - 0.1);
        const h = r.range(0.7, 1.7);
        const lean = r.range(-0.2, 0.25);
        stroke(p.fine, r, x, foot, x + lean, foot + h, 0.008);
        if (r.chance(0.5)) blob(p.ink, r, x + lean, foot + h, 0.045, 0.16, 4, 0.01);
      }
      x += r.range(0.18, 0.5);
    } else if (x >= hills[0]) {
      const roll = r.next();
      if (roll < 0.7) {
        for (let b = 0; b < 3; b++) stroke(p.fine, r, x + b * 0.08, y, x + b * 0.08 + r.range(-0.1, 0.1), y + r.range(0.14, 0.34), 0.006);
      } else if (roll < 0.8) {
        // A stretch of fence.
        const n = r.int(4, 8);
        let lastX = x;
        let lastY = y;
        for (let i = 0; i < n; i++) {
          const fx = x + i * 1.5;
          const fy = terrainAt(world, fx);
          stroke(p.fine, r, fx, fy - 0.05, fx, fy + 0.85, 0.008);
          if (i > 0) {
            stroke(p.fine, r, lastX, lastY + 0.7, fx, fy + 0.7, 0.012);
            stroke(p.fine, r, lastX, lastY + 0.38, fx, fy + 0.38, 0.012);
          }
          lastX = fx;
          lastY = fy;
        }
        x = lastX;
      } else if (roll < 0.86) {
        // A sheep.
        const sy = y + 0.55;
        blob(p.ink, r, x, sy, 0.55, 0.36, 9, 0.06);
        blob(p.ink, r, x + 0.62, sy + 0.12, 0.17, 0.2, 5, 0.01);
        for (const lx of [-0.3, -0.15, 0.22, 0.36]) stroke(p.fine, r, x + lx, sy - 0.3, x + lx, y, 0.004);
        x += 1.4;
      } else if (roll < 0.9) {
        // A rock.
        poly(p.ink, r, [x, y, x + 0.25, y + 0.4, x + 0.8, y + 0.48, x + 1.1, y], false, 0.03);
        stroke(p.shade, r, x + 0.5, y + 0.1, x + 0.85, y + 0.38, 0.01);
        x += 1.2;
      } else {
        stroke(p.fine, r, x, y, x + 0.03, y + 0.36, 0.005);
        blob(p.fine, r, x + 0.03, y + 0.42, 0.07, 0.07, 5, 0.02);
      }
      x += r.range(0.6, 2.2);
    } else {
      x += 1;
    }
  }
  return p;
}

/** A rowing boat, drawn at the origin; placed and bobbed by the renderer. */
export function boatPath(): { fill: Path2D; ink: Path2D } {
  const r = makeRng(5150);
  const fill = new Path2D();
  fill.moveTo(-1.9, 0.42);
  fill.lineTo(2.1, 0.42);
  fill.quadraticCurveTo(1.7, -0.22, 1.2, -0.25);
  fill.lineTo(-1.3, -0.25);
  fill.quadraticCurveTo(-1.75, -0.2, -1.9, 0.42);
  const ink = new Path2D();
  stroke(ink, r, -1.95, 0.42, 2.15, 0.42, 0.01);
  ink.moveTo(2.1, 0.42);
  ink.quadraticCurveTo(1.7, -0.22, 1.2, -0.25);
  ink.lineTo(-1.3, -0.25);
  ink.quadraticCurveTo(-1.75, -0.2, -1.9, 0.42);
  stroke(ink, r, -1.75, 0.18, 1.85, 0.18, 0.01);
  stroke(ink, r, -0.4, 0.42, -0.4, 0.2, 0.004);
  stroke(ink, r, 0.5, 0.42, 0.5, 0.2, 0.004);
  // An oar, shipped.
  stroke(ink, r, -0.9, 0.5, 1.6, 0.86, 0.01);
  return { fill, ink };
}

export interface Scenery {
  /** Sorted by x0. */
  props: Prop[];
  detail: Prop[];
  maxWidth: number;
}

export function buildScenery(world: World): Scenery {
  const props: Prop[] = [home()];
  for (const b of world.buildings) props.push(b.kind === "tower" ? tower(b) : house(b, world));
  for (const t of world.trees) props.push(tree(t));
  props.sort((a, b) => a.x0 - b.x0);
  const detail: Prop[] = [];
  const r = makeRng(world.seed ^ 0x5bd1e995);
  const span = 40;
  for (let x = ROOM.out; x < world.length; x += span) detail.push(groundDetail(world, x, x + span, r));
  let maxWidth = 0;
  for (const p of props) maxWidth = Math.max(maxWidth, p.x1 - p.x0);
  return { props, detail, maxWidth };
}
