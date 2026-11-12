import { ROOM, cellOf, surfaceAt, type World } from "./world";

/** Air velocity at a point and time, in m/s. */
export interface Air {
  u: number;
  w: number;
  /** The part of w that comes from thermals alone (for sound and drawing). */
  lift: number;
}

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Horizontal wind at a place and time: a mean, a height gradient and slow gusts. */
export function windAt(world: World, x: number, y: number, t: number): number {
  const wind = world.wind;
  // No wind inside the room; it builds over the first few metres outside.
  const outside = smooth((x - ROOM.out) / 6);
  if (outside === 0) return 0;
  const h = y - surfaceAt(world, x);
  // Slower near the ground, faster aloft.
  const shear = 0.45 + 0.55 * smooth(h / 22) + 0.15 * smooth((y - 30) / 40);
  const k = 6.2832 / wind.period;
  const gust =
    1 +
    wind.gust * Math.sin(k * t + wind.phase + x / 46) +
    wind.gust * 0.5 * Math.sin(k * 2.3 * t + wind.phase * 1.7 - x / 17);
  return wind.base * shear * gust * outside;
}

/**
 * The whole air field: wind, thermals and sinks, lift where wind meets a
 * rising slope and sink in its lee.
 */
export function airAt(world: World, x: number, y: number, t: number, out: Air): Air {
  const u = windAt(world, x, y, t);
  let lift = 0;
  const thermals = world.thermals;
  for (let i = 0; i < thermals.length; i++) {
    const th = thermals[i]!;
    const dx = (x - th.x) / th.r;
    if (dx > 2.6 || dx < -2.6) continue;
    if (y < th.base || y > th.top) continue;
    const core = Math.exp(-dx * dx);
    const rise = smooth((y - th.base) / 3.5);
    const fade = smooth((th.top - y) / 12);
    lift += th.w * core * rise * fade;
  }
  // Ridge lift: wind pushed up a slope carries the plane with it.
  let ridge = 0;
  if (u !== 0) {
    const i = cellOf(world, x);
    const h = y - (world.terrain[i] as number);
    if (h < 45) ridge = u * (world.slope[i] as number) * Math.exp(-Math.max(h, 0) / 14);
  }
  out.u = u;
  out.w = lift + ridge;
  out.lift = lift;
  return out;
}
