import { makeRng, type Rng } from "./rng";

/**
 * The world is a side-on strip, measured in metres. x runs to the right from
 * the launch point, y is height above the street. Everything the plane can
 * touch or feel is described here as plain data, built from one seed.
 */

export const Surf = { Floor: 0, Street: 1, Roof: 2, Grass: 3, Water: 4, Hill: 5 } as const;
export type SurfKind = (typeof Surf)[keyof typeof Surf];

/** The room the plane is thrown from, at the top of a tall house. */
export const ROOM = {
  /** Height of the room floor above the street. */
  floor: 24,
  /** Ceiling height above the street. */
  ceil: 28.8,
  /** Inside face of the back wall. */
  back: -5.5,
  /** Inside face of the window wall. */
  wall: 5.0,
  /** Outside face of the window wall. */
  out: 5.35,
  /** Bottom and top of the window opening, above the street. */
  sill: 24.3,
  lintel: 28.3,
  /** Outside edge of the house on the left, and the top of its roof slab. */
  left: -9.5,
  top: 29.4,
  /** Where the plane is held: distance is measured from here. */
  startX: 0,
  startY: 25.4,
} as const;

export interface Chimney {
  x0: number;
  x1: number;
  top: number;
}

export interface Building {
  x0: number;
  x1: number;
  /** Height of the eaves (or of the flat roof). */
  h: number;
  roof: "flat" | "gable";
  /** Extra height of the ridge above the eaves for a gable roof. */
  ridge: number;
  chimneys: Chimney[];
  /** A sun-warmed roof with a thermal above it. */
  warm: boolean;
  kind: "house" | "tower" | "barn";
  /** For a tower: the open belfry the plane can thread. */
  arch?: { y0: number; y1: number };
  /** Seed for the drawing details (windows, hatching). */
  seed: number;
}

/** A solid with air under it: a ceiling, a lintel, the top of a belfry. */
export interface Block {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface WashLine {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  sag: number;
  seed: number;
}

export interface Tree {
  /** Trunk position and ground height there. */
  x: number;
  base: number;
  /** Canopy ellipse. */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  kind: "round" | "pine" | "poplar";
  seed: number;
}

/** A column of rising (w > 0) or sinking (w < 0) air. */
export interface Thermal {
  x: number;
  /** Radius at which the strength has fallen to 1/e. */
  r: number;
  /** Peak vertical speed, m/s. */
  w: number;
  base: number;
  top: number;
}

export interface Wind {
  /** Mean wind along x at roof height, m/s. Positive is a tailwind. */
  base: number;
  /** Gust strength as a fraction of the mean. */
  gust: number;
  /** Gust period in seconds and its phase. */
  period: number;
  phase: number;
}

export interface Zones {
  town: [number, number];
  park: [number, number];
  river: [number, number];
  hills: [number, number];
}

export interface World {
  seed: number;
  /** Left edge of the height maps and their resolution in metres. */
  x0: number;
  res: number;
  length: number;
  /** Top of whatever is solid at each column: ground, roof, water. */
  surface: Float32Array;
  /** The natural ground under everything. */
  terrain: Float32Array;
  /** Slope of the natural ground, for ridge lift. */
  slope: Float32Array;
  kind: Uint8Array;
  blocks: Block[];
  buildings: Building[];
  lines: WashLine[];
  trees: Tree[];
  thermals: Thermal[];
  wind: Wind;
  zones: Zones;
  /** Water level of the river. */
  water: number;
}

const X0 = -14;
const RES = 0.25;
const LENGTH = 2600;

export function cellOf(world: World, x: number): number {
  const i = Math.floor((x - world.x0) / world.res);
  return i < 0 ? 0 : i >= world.surface.length ? world.surface.length - 1 : i;
}

/** Height of the solid surface under x. */
export function surfaceAt(world: World, x: number): number {
  return world.surface[cellOf(world, x)] as number;
}

/** Natural ground height at x, smoothly interpolated. */
export function terrainAt(world: World, x: number): number {
  const f = (x - world.x0) / world.res;
  const n = world.terrain.length;
  if (f <= 0) return world.terrain[0] as number;
  if (f >= n - 1) return world.terrain[n - 1] as number;
  const i = Math.floor(f);
  const a = world.terrain[i] as number;
  const b = world.terrain[i + 1] as number;
  return a + (b - a) * (f - i);
}

export function kindAt(world: World, x: number): SurfKind {
  return world.kind[cellOf(world, x)] as SurfKind;
}

/** Height of a washing line at x (only meaningful between its ends). */
export function lineY(line: WashLine, x: number): number {
  const t = (x - line.x0) / (line.x1 - line.x0);
  return line.y0 + (line.y1 - line.y0) * t - line.sag * 4 * t * (1 - t);
}

function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Build the whole world for a seed. Pure: same seed, same world. */
export function makeWorld(seed: number): World {
  const rng = makeRng(seed);
  const n = Math.ceil((LENGTH - X0) / RES);
  const surface = new Float32Array(n);
  const terrain = new Float32Array(n);
  const slope = new Float32Array(n);
  const kind = new Uint8Array(n);
  const world: World = {
    seed,
    x0: X0,
    res: RES,
    length: LENGTH,
    surface,
    terrain,
    slope,
    kind,
    blocks: [],
    buildings: [],
    lines: [],
    trees: [],
    thermals: [],
    wind: {
      base: rng.range(-1.1, 2.8),
      gust: rng.range(0.2, 0.42),
      period: rng.range(5, 9),
      phase: rng.range(0, Math.PI * 2),
    },
    zones: { town: [0, 0], park: [0, 0], river: [0, 0], hills: [0, 0] },
    water: -1.4,
  };

  const townEnd = rng.range(150, 185);
  const parkEnd = townEnd + rng.range(95, 135);
  const riverEnd = parkEnd + rng.range(48, 72);
  world.zones = {
    town: [ROOM.out, townEnd],
    park: [townEnd, parkEnd],
    river: [parkEnd, riverEnd],
    hills: [riverEnd, LENGTH],
  };

  layTerrain(world, rng);
  buildHome(world);
  buildTown(world, rng);
  plantPark(world, rng);
  coolRiver(world, rng);
  settleHills(world, rng);
  return world;
}

/** Fill a span of the surface map with a height given by a function of x. */
function raise(world: World, x0: number, x1: number, h: (x: number) => number, k: SurfKind): void {
  const i0 = Math.max(0, Math.ceil((x0 - world.x0) / world.res - 0.5));
  const i1 = Math.min(world.surface.length - 1, Math.floor((x1 - world.x0) / world.res - 0.5));
  for (let i = i0; i <= i1; i++) {
    const x = world.x0 + (i + 0.5) * world.res;
    const y = h(x);
    if (y > (world.surface[i] as number)) {
      world.surface[i] = y;
      world.kind[i] = k;
    }
  }
}

function layTerrain(world: World, rng: Rng): void {
  const { park, river, hills } = world.zones;
  const p1 = rng.range(0, 6.28);
  const p2 = rng.range(0, 6.28);
  const a1 = rng.range(9, 12);
  const l1 = rng.range(150, 210);
  const a2 = rng.range(3.5, 5.5);
  const l2 = rng.range(58, 88);
  const h1 = rng.range(0, 6.28);
  const h2 = rng.range(0, 6.28);
  const bed = world.water - 1.6;
  const n = world.terrain.length;
  for (let i = 0; i < n; i++) {
    const x = world.x0 + (i + 0.5) * world.res;
    let y = 0;
    let k: SurfKind = Surf.Street;
    if (x >= park[0] && x < park[1]) {
      const edge = smooth((x - park[0]) / 12) * smooth((park[1] - x) / 10);
      y = edge * (0.9 + 0.7 * Math.sin(x / 19 + p1) + 0.35 * Math.sin(x / 7.3 + p2));
      k = Surf.Grass;
    } else if (x >= river[0] && x < river[1]) {
      const bank = smooth((x - river[0]) / 5) * smooth((river[1] - x) / 5);
      y = bed * bank;
      k = Surf.Water;
    } else if (x >= hills[0]) {
      const d = x - hills[0];
      const env = smooth(d / 70) * (0.55 + (Math.min(d, 900) / 900) * 0.6);
      const big = a1 * (0.5 - 0.5 * Math.cos((d * 6.2832) / l1 + h1 * 0.15));
      const small = a2 * (0.5 - 0.5 * Math.cos((d * 6.2832) / l2 + h2));
      y = env * (big + small) + 0.4 * smooth(d / 8);
      k = Surf.Hill;
    }
    world.terrain[i] = y;
    world.kind[i] = k;
    world.surface[i] = k === Surf.Water ? Math.max(y, world.water) : y;
    if (k === Surf.Water && y > world.water) world.kind[i] = Surf.Grass;
  }
  for (let i = 0; i < n; i++) {
    const a = world.terrain[Math.max(0, i - 4)] as number;
    const b = world.terrain[Math.min(n - 1, i + 4)] as number;
    world.slope[i] = (b - a) / (8 * world.res);
  }
}

function buildHome(world: World): void {
  // The house the room is in: solid except for the room and its window.
  raise(world, ROOM.left, ROOM.back, () => ROOM.top, Surf.Roof);
  raise(world, ROOM.back, ROOM.wall, () => ROOM.floor, Surf.Floor);
  raise(world, ROOM.wall, ROOM.out, () => ROOM.sill, Surf.Floor);
  world.blocks.push({ x0: ROOM.back, x1: ROOM.out, y0: ROOM.ceil, y1: ROOM.top });
  world.blocks.push({ x0: ROOM.wall, x1: ROOM.out, y0: ROOM.lintel, y1: ROOM.ceil });
}

function buildTown(world: World, rng: Rng): void {
  const end = world.zones.town[1];
  let x = ROOM.out + rng.range(7, 10);
  let prev: Building | null = null;
  const towerAt = rng.chance(0.55) ? rng.range(0.5, 0.72) * end : -1;
  let towerDone = false;
  while (x < end - 12) {
    let b: Building;
    if (!towerDone && towerAt > 0 && x >= towerAt) {
      towerDone = true;
      const w = rng.range(5.2, 6.2);
      const top = rng.range(20, 24);
      b = {
        x0: x,
        x1: x + w,
        h: top,
        roof: "flat",
        ridge: 0,
        chimneys: [],
        warm: false,
        kind: "tower",
        arch: { y0: top - 7.2, y1: top - 2.6 },
        seed: rng.int(1, 1e9),
      };
      const arch = b.arch as { y0: number; y1: number };
      raise(world, b.x0, b.x1, () => arch.y0, Surf.Roof);
      world.blocks.push({ x0: b.x0, x1: b.x1, y0: arch.y1, y1: top });
    } else {
      const w = Math.min(rng.range(9, 17), end - 3 - x);
      const fade = 1 - 0.35 * (x / end);
      const h = rng.range(7.5, 19) * fade;
      const gable = rng.chance(0.42);
      b = {
        x0: x,
        x1: x + w,
        h,
        roof: gable ? "gable" : "flat",
        ridge: gable ? rng.range(1.8, 3.2) : 0,
        chimneys: [],
        warm: false,
        kind: "house",
        seed: rng.int(1, 1e9),
      };
      const mid = (b.x0 + b.x1) / 2;
      const half = w / 2;
      raise(world, b.x0, b.x1, (px) => h + b.ridge * (1 - Math.abs(px - mid) / half), Surf.Roof);
      const chimneys = rng.int(0, 2);
      for (let c = 0; c < chimneys; c++) {
        const cx = b.x0 + w * (c === 0 ? rng.range(0.14, 0.34) : rng.range(0.66, 0.86));
        const base = h + b.ridge * (1 - Math.abs(cx - mid) / half);
        const ch: Chimney = { x0: cx - 0.4, x1: cx + 0.4, top: base + rng.range(1.2, 2.1) };
        b.chimneys.push(ch);
        raise(world, ch.x0, ch.x1, () => ch.top, Surf.Roof);
      }
      if (rng.chance(0.46)) {
        b.warm = true;
        world.thermals.push({
          x: mid + rng.range(-1.5, 1.5),
          r: Math.max(4.2, w * rng.range(0.38, 0.5)),
          w: rng.range(1.9, 3.3),
          base: h + b.ridge,
          top: h + rng.range(34, 48),
        });
      }
    }
    world.buildings.push(b);

    // A washing line across the gap from the roof before, when the roofs are close in height.
    if (prev && prev.kind === "house" && b.kind === "house" && Math.abs(prev.h - b.h) < 4.5 && rng.chance(0.5)) {
      const ya = prev.h + (prev.roof === "gable" ? 0.3 : 1.7);
      const yb = b.h + (b.roof === "gable" ? 0.3 : 1.7);
      world.lines.push({
        x0: prev.x1 - (prev.roof === "gable" ? 0.2 : 1.2),
        y0: ya,
        x1: b.x0 + (b.roof === "gable" ? 0.2 : 1.2),
        y1: yb,
        sag: rng.range(0.35, 0.7),
        seed: rng.int(1, 1e9),
      });
    }
    prev = b;
    x = b.x1 + rng.range(3.2, 8);
  }
}

function plantPark(world: World, rng: Rng): void {
  const [a, b] = world.zones.park;
  let x = a + rng.range(7, 12);
  const clearing = a + (b - a) * rng.range(0.4, 0.62);
  while (x < b - 6) {
    if (Math.abs(x - clearing) < 13) {
      x += rng.range(5, 8);
      continue;
    }
    const base = terrainAt(world, x);
    const k = rng.pick(["round", "round", "poplar", "pine"] as const);
    const tall = k === "poplar" ? rng.range(10, 13.5) : k === "pine" ? rng.range(8, 12) : rng.range(6.5, 10.5);
    const rx = k === "poplar" ? rng.range(1.3, 1.7) : k === "pine" ? rng.range(1.9, 2.5) : rng.range(2.6, 3.9);
    const ry = k === "round" ? rx * rng.range(0.85, 1.05) : tall * 0.36;
    world.trees.push({ x, base, cx: x + rng.range(-0.3, 0.3), cy: base + tall - ry, rx, ry, kind: k, seed: rng.int(1, 1e9) });
    x += rng.range(15, 29);
  }
  // Warm air over the open grass.
  world.thermals.push({ x: clearing, r: rng.range(6.5, 8.5), w: rng.range(2.2, 3.2), base: 1, top: rng.range(38, 50) });
}

function coolRiver(world: World, rng: Rng): void {
  const [a, b] = world.zones.river;
  const mid = (a + b) / 2;
  // Cold water: the air above it sinks.
  world.thermals.push({ x: mid, r: (b - a) * 0.42, w: -rng.range(0.9, 1.5), base: world.water, top: 22 });
}

function settleHills(world: World, rng: Rng): void {
  const [a, b] = world.zones.hills;
  let x = a + rng.range(18, 30);
  while (x < b - 40) {
    const base = terrainAt(world, x);
    const roll = rng.next();
    if (roll < 0.42) {
      // Sun on a slope or a field: a thermal.
      world.thermals.push({ x, r: rng.range(6.5, 10), w: rng.range(2.3, 3.6), base: base + 0.5, top: base + rng.range(36, 52) });
    } else if (roll < 0.74) {
      const k = rng.pick(["pine", "pine", "round"] as const);
      const tall = k === "pine" ? rng.range(7, 11) : rng.range(6, 9);
      const rx = k === "pine" ? rng.range(1.8, 2.4) : rng.range(2.4, 3.4);
      const ry = k === "round" ? rx * 0.95 : tall * 0.36;
      world.trees.push({ x, base, cx: x, cy: base + tall - ry, rx, ry, kind: k, seed: rng.int(1, 1e9) });
    } else if (roll < 0.86) {
      const w = rng.range(7, 10);
      const h = base + rng.range(3.4, 4.6);
      const barn: Building = {
        x0: x,
        x1: x + w,
        h,
        roof: "gable",
        ridge: rng.range(1.8, 2.6),
        chimneys: [],
        warm: false,
        kind: "barn",
        seed: rng.int(1, 1e9),
      };
      const mid = x + w / 2;
      raise(world, barn.x0, barn.x1, (px) => h + barn.ridge * (1 - Math.abs(px - mid) / (w / 2)), Surf.Roof);
      world.buildings.push(barn);
    }
    x += rng.range(34, 62);
  }
}
