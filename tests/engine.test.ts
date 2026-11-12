import { describe, expect, it } from "vitest";
import {
  A_HOLD,
  A_STALL,
  A_TRIM,
  DT,
  Flight,
  dailySeed,
  dateKey,
  dragCoef,
  glideRatio,
  groundFactor,
  liftCoef,
  makeRng,
  makeWorld,
  previewArc,
  simulate,
  skyNumber,
  trimSpeed,
} from "../src/engine";
import { bareWorld, deg } from "./helpers";

const GOOD = { angle: deg(-5), power: 0.7 };

describe("determinism", () => {
  it("flies the same seed and throw the same way, to the millimetre", () => {
    const a = simulate(makeWorld(dailySeed("2026-11-15")), GOOD, [900, 1500, 2400, 2600]);
    const b = simulate(makeWorld(dailySeed("2026-11-15")), GOOD, [900, 1500, 2400, 2600]);
    expect(b.distance).toBe(a.distance);
    expect(b.landing).toBe(a.landing);
    expect(b.path.length).toBe(a.path.length);
    let worst = 0;
    for (let i = 0; i < a.path.length; i++) worst = Math.max(worst, Math.abs((a.path[i] ?? 0) - (b.path[i] ?? 0)));
    expect(worst).toBeLessThan(0.001);
    expect(worst).toBe(0);
  });

  it("gives a different flight for a different throw", () => {
    const world = bareWorld();
    const a = simulate(world, GOOD);
    const b = simulate(world, { angle: deg(-5), power: 0.75 });
    expect(b.distance).not.toBe(a.distance);
  });

  it("draws the same numbers from the same seed", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 100; i++) expect(b.next()).toBe(a.next());
  });
});

describe("the daily sky", () => {
  it("has a seed that never changes for a date", () => {
    expect(dailySeed("2026-11-13")).toBe(dailySeed("2026-11-13"));
    expect(dailySeed("2026-11-13")).toBe(SEED_2026_11_13);
    expect(dailySeed("2026-11-14")).not.toBe(dailySeed("2026-11-13"));
  });

  it("builds the same world twice from one seed", () => {
    const a = makeWorld(dailySeed("2027-01-01"));
    const b = makeWorld(dailySeed("2027-01-01"));
    expect(b.thermals).toEqual(a.thermals);
    expect(b.buildings).toEqual(a.buildings);
    expect(b.trees).toEqual(a.trees);
    expect(b.wind).toEqual(a.wind);
    expect(Array.from(b.surface.slice(0, 4000))).toEqual(Array.from(a.surface.slice(0, 4000)));
  });

  it("builds different worlds on different days", () => {
    const a = makeWorld(dailySeed("2027-01-01"));
    const b = makeWorld(dailySeed("2027-01-02"));
    expect(b.wind.base).not.toBe(a.wind.base);
    expect(b.zones.town[1]).not.toBe(a.zones.town[1]);
  });

  it("numbers the skies from the first day and keys them by local date", () => {
    expect(skyNumber("2026-11-13")).toBe(1);
    expect(skyNumber("2026-12-13")).toBe(31);
    expect(dateKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("always leaves a way out of the window and a place to land", () => {
    for (let day = 1; day <= 28; day++) {
      const world = makeWorld(dailySeed(`2027-02-${String(day).padStart(2, "0")}`));
      const r = simulate(world, GOOD);
      expect(r.distance).toBeGreaterThan(20);
      expect(Number.isFinite(r.restY)).toBe(true);
    }
  });
});

describe("the glider", () => {
  it("never gains energy in still air", () => {
    const throws = [GOOD, { angle: deg(25), power: 1 }, { angle: deg(60), power: 0.5 }, { angle: deg(-20), power: 1 }];
    for (const thrown of throws) {
      const f = new Flight(bareWorld(), thrown);
      let last = f.energy();
      while (!f.done) {
        f.step(f.steps % 700 > 400);
        if (f.phase !== "air") break;
        const e = f.energy();
        expect(e).toBeLessThanOrEqual(last + 1e-9);
        last = e;
      }
    }
  });

  it("trims near 6.5 m/s and glides between 7 and 8 to 1", () => {
    expect(trimSpeed()).toBeGreaterThan(6);
    expect(trimSpeed()).toBeLessThan(7);
    expect(glideRatio()).toBeGreaterThan(7);
    expect(glideRatio()).toBeLessThan(8);
  });

  it("settles into the steady glide the coefficients predict", () => {
    const f = new Flight(bareWorld(), { angle: deg(-5), power: 0.45 });
    const seen: number[] = [];
    while (!f.done && f.t < 9) {
      f.step();
      if (f.t > 7) seen.push(f.speed);
    }
    const mean = seen.reduce((a, b) => a + b, 0) / seen.length;
    expect(Math.abs(mean - trimSpeed())).toBeLessThan(0.35);
  });

  it("loses lift past the stall angle", () => {
    expect(liftCoef(A_STALL + 0.12)).toBeLessThan(liftCoef(A_STALL - 0.03));
    expect(dragCoef(A_STALL + 0.12)).toBeGreaterThan(3 * dragCoef(A_TRIM));
  });

  it("stalls a throw that is too steep, which then falls short of a good one", () => {
    const world = bareWorld();
    const steep = new Flight(world, { angle: deg(62), power: 0.55 });
    let stalled = false;
    while (!steep.done) {
      steep.step();
      if (steep.stall > 0.9) stalled = true;
    }
    expect(stalled).toBe(true);
    expect(steep.result().distance).toBeLessThan(simulate(world, GOOD).distance * 0.25);
  });

  it("swoops: a hard throw rises and falls in a phugoid before it settles", () => {
    const f = new Flight(bareWorld(), { angle: deg(-8), power: 1 });
    const ys: number[] = [];
    while (!f.done) {
      f.step();
      if (f.steps % 24 === 0) ys.push(f.y);
    }
    let crests = 0;
    for (let i = 1; i < ys.length - 1; i++) {
      if ((ys[i] as number) > (ys[i - 1] as number) && (ys[i] as number) >= (ys[i + 1] as number)) crests++;
    }
    expect(crests).toBeGreaterThanOrEqual(2);
  });

  it("flies slower with the nose held up", () => {
    expect(trimSpeed(A_TRIM + A_HOLD)).toBeLessThan(trimSpeed() - 1);
    const f = new Flight(bareWorld(), GOOD);
    while (!f.done && f.t < 8) f.step(f.t > 3);
    expect(f.speed).toBeLessThan(trimSpeed() - 0.8);
  });

  it("feels a cushion of air just above the ground", () => {
    expect(groundFactor(10)).toBe(1);
    expect(groundFactor(0.2)).toBeLessThan(0.5);
    expect(dragCoef(A_TRIM, groundFactor(0.2))).toBeLessThan(dragCoef(A_TRIM));
  });
});

describe("the air", () => {
  it("goes further through a thermal", () => {
    const still = bareWorld();
    const warm = bareWorld();
    warm.thermals.push({ x: 60, r: 7, w: 3, base: 0, top: 60 });
    const a = simulate(still, GOOD);
    const b = simulate(warm, GOOD);
    expect(b.thermals).toBe(1);
    expect(b.distance).toBeGreaterThan(a.distance + 10);
  });

  it("falls short through sinking air", () => {
    const still = bareWorld();
    const cold = bareWorld();
    cold.thermals.push({ x: 70, r: 20, w: -1.4, base: -2, top: 30 });
    expect(simulate(cold, GOOD).distance).toBeLessThan(simulate(still, GOOD).distance - 5);
  });

  it("is carried by a tailwind and held back by a headwind", () => {
    const still = bareWorld();
    const tail = bareWorld();
    tail.wind.base = 2.5;
    const head = bareWorld();
    head.wind.base = -2.5;
    const s = simulate(still, GOOD).distance;
    expect(simulate(tail, GOOD).distance).toBeGreaterThan(s + 15);
    expect(simulate(head, GOOD).distance).toBeLessThan(s - 15);
  });
});

describe("landings", () => {
  it("skids when it comes in flat and flips when it comes in steep", () => {
    const world = bareWorld();
    expect(simulate(world, GOOD).landing).toBe("skid");
    expect(simulate(world, { angle: deg(70), power: 0.3 }).landing).toBe("flip");
  });

  it("stops against the wall above the window", () => {
    const r = simulate(bareWorld(), { angle: deg(50), power: 1 });
    expect(r.landing).toBe("wall");
    expect(r.distance).toBeLessThan(6);
  });

  it("wedges in a tree and catches on a washing line", () => {
    const a = bareWorld();
    a.trees.push({ x: 80, base: 0, cx: 80, cy: 14, rx: 4, ry: 14, kind: "round", seed: 1 });
    expect(simulate(a, GOOD).landing).toBe("tree");
    const b = bareWorld();
    for (let y = 30; y > 8; y -= 0.9) b.lines.push({ x0: 40, y0: y, x1: 44, y1: y, sag: 0.5, seed: 1 });
    expect(simulate(b, GOOD).landing).toBe("line");
  });

  it("measures distance from the hand, never below zero", () => {
    const r = simulate(bareWorld(), { angle: deg(80), power: 0.9 });
    expect(r.distance).toBeGreaterThanOrEqual(0);
    const good = simulate(bareWorld(), GOOD);
    expect(good.distance).toBeCloseTo(good.restX, 1);
  });
});

describe("the aiming arc", () => {
  it("shows the first moments of the real flight", () => {
    const world = bareWorld();
    const arc = previewArc(world, GOOD, 0.5, 8);
    const f = new Flight(world, GOOD);
    for (let i = 0; i < 8; i++) f.step();
    expect(arc[2]).toBe(f.x);
    expect(arc[3]).toBe(f.y);
    expect(arc.length).toBe(2 + 2 * Math.round(0.5 / DT / 8));
  });
});

/** Written down once, so a change to the hash or the key is caught. */
const SEED_2026_11_13 = 116603827;
