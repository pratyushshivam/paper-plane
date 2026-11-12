import type { Rng } from "../engine";

/**
 * Pen strokes. Every line in the world goes through these so that nothing is
 * perfectly straight: ends overshoot a little and long lines bow, the way a
 * line drawn quickly with a pen does. All in world metres.
 */

export const PAPER = "#f2eee5";
export const INK = "#15140f";
export const ORANGE = "#d4491a";

/** A wobbly straight stroke from a to b. */
export function stroke(p: Path2D, r: Rng, x1: number, y1: number, x2: number, y2: number, wob = 0.035): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const nx = -dy / len;
  const ny = dx / len;
  const parts = Math.max(1, Math.round(len / 5));
  const j = (): number => (r.next() - 0.5) * 2 * wob;
  let ax = x1 + j() * 0.6;
  let ay = y1 + j() * 0.6;
  p.moveTo(ax, ay);
  for (let i = 1; i <= parts; i++) {
    const t = i / parts;
    const bx = x1 + dx * t + (i === parts ? j() * 0.6 : j());
    const by = y1 + dy * t + (i === parts ? j() * 0.6 : j());
    const bow = j() * Math.min(1.6, 0.6 + len / parts / 4);
    p.quadraticCurveTo((ax + bx) / 2 + nx * bow, (ay + by) / 2 + ny * bow, bx, by);
    ax = bx;
    ay = by;
  }
}

/** A closed or open run of strokes through points [x, y, x, y, ...]. */
export function poly(p: Path2D, r: Rng, pts: readonly number[], close = false, wob = 0.035): void {
  const n = pts.length / 2;
  for (let i = 0; i + 1 < n; i++) {
    stroke(p, r, pts[i * 2] as number, pts[i * 2 + 1] as number, pts[i * 2 + 2] as number, pts[i * 2 + 3] as number, wob);
  }
  if (close && n > 2) {
    stroke(p, r, pts[n * 2 - 2] as number, pts[n * 2 - 1] as number, pts[0] as number, pts[1] as number, wob);
  }
}

/** A hand-drawn box: four strokes that do not quite meet. */
export function box(p: Path2D, r: Rng, x0: number, y0: number, x1: number, y1: number, wob = 0.03): void {
  poly(p, r, [x0, y0, x1, y0, x1, y1, x0, y1], true, wob);
}

/** A clean (not wobbly) rectangle, for fills. */
export function rectPath(p: Path2D, x0: number, y0: number, x1: number, y1: number): void {
  p.moveTo(x0, y0);
  p.lineTo(x1, y0);
  p.lineTo(x1, y1);
  p.lineTo(x0, y1);
  p.closePath();
}

/** Diagonal hatching inside a box. `lean` is +1 for / and -1 for \. */
export function hatch(
  p: Path2D,
  r: Rng,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  gap = 0.28,
  lean = 1,
): void {
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  for (let c = -h + gap * r.range(0.3, 1); c < w; c += gap * r.range(0.8, 1.25)) {
    // The line x = x0 + c + t, y = y0 + t, cut to the box.
    const t0 = Math.max(0, -c);
    const t1 = Math.min(h, w - c);
    if (t1 - t0 < 0.06) continue;
    const ax = c + t0;
    const bx = c + t1;
    const xa = lean > 0 ? x0 + ax : x1 - ax;
    const xb = lean > 0 ? x0 + bx : x1 - bx;
    stroke(p, r, xa, y0 + t0, xb, y0 + t1, 0.02);
  }
}

/** Level lines inside a box: roof tiles, boards, water. */
export function rules(p: Path2D, r: Rng, x0: number, y0: number, x1: number, y1: number, gap: number, broken = 0): void {
  for (let y = y0 + gap * r.range(0.5, 1); y < y1; y += gap * r.range(0.85, 1.15)) {
    if (broken > 0) {
      let x = x0 + r.range(0, broken);
      while (x < x1) {
        const e = Math.min(x1, x + r.range(broken * 0.6, broken * 1.8));
        stroke(p, r, x, y, e, y, 0.015);
        x = e + r.range(broken * 0.4, broken * 1.2);
      }
    } else {
      stroke(p, r, x0, y, x1, y, 0.02);
    }
  }
}

/** A loose, lumpy outline around an ellipse: foliage, a cloud, a bush. */
export function blob(
  p: Path2D,
  r: Rng,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  lumps = 9,
  depth = 0.16,
  from = 0,
  to = Math.PI * 2,
): void {
  const n = Math.max(3, lumps);
  const pts: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    const k = 1 + (r.next() - 0.5) * 0.12;
    pts.push(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k);
  }
  p.moveTo(pts[0] as number, pts[1] as number);
  for (let i = 1; i <= n; i++) {
    const ax = pts[i * 2 - 2] as number;
    const ay = pts[i * 2 - 1] as number;
    const bx = pts[i * 2] as number;
    const by = pts[i * 2 + 1] as number;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    // Push the middle of each lump outwards from the centre.
    const ox = mx - cx;
    const oy = my - cy;
    const ol = Math.hypot(ox / rx, oy / ry) || 1;
    const push = depth * (0.7 + r.next() * 0.6);
    p.quadraticCurveTo(mx + (ox / ol) * push * 1.9, my + (oy / ol) * push * 1.9, bx, by);
  }
}

/** A smooth ellipse path, for fills. */
export function ellipsePath(p: Path2D, cx: number, cy: number, rx: number, ry: number): void {
  p.moveTo(cx + rx, cy);
  p.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
}
