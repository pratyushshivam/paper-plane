// How far can a careful pilot get? A greedy look-ahead: every 0.3 s, try
// holding and not holding, fly each choice to the end, keep the better one.
// Run with: npx tsx scripts/pilot.ts [days]
import { Flight, dailySeed, makeWorld, simulate, type Throw, type World } from "../src/engine";

function clone(f: Flight): Flight {
  const c = Object.assign(Object.create(Object.getPrototypeOf(f)), f) as Flight;
  c.air = { ...f.air };
  (c as unknown as { samples: number[] }).samples = [];
  return c;
}

function rollout(f: Flight, first: boolean, steps: number): number {
  const c = clone(f);
  for (let i = 0; i < steps && !c.done; i++) c.step(first);
  while (!c.done) c.step(c.air.lift > 0.5 && c.speed > 4.6);
  return c.x;
}

export function pilot(world: World, thrown: Throw): { distance: number; landing: string; held: number } {
  const f = new Flight(world, thrown);
  const chunk = 72;
  let held = 0;
  while (!f.done) {
    const hold = rollout(f, true, chunk) > rollout(f, false, chunk) + 0.05;
    for (let i = 0; i < chunk && !f.done; i++) {
      f.step(hold);
      if (hold) held++;
    }
  }
  const r = f.result();
  return { distance: r.distance, landing: r.landing, held: held / 240 };
}

const count = Number(process.argv[2] ?? 12);
const start = Date.UTC(2026, 10, 13);
for (let d = 0; d < count; d++) {
  const day = new Date(start + d * 86400000).toISOString().slice(0, 10);
  const world = makeWorld(dailySeed(day));
  let plain = 0;
  let best = { distance: 0, landing: "", held: 0, a: 0, p: 0 };
  for (const a of [-12, -6, 0, 8]) {
    for (const p of [0.45, 0.7, 0.95]) {
      const thrown = { angle: (a * Math.PI) / 180, power: p };
      plain = Math.max(plain, simulate(world, thrown).distance);
      const r = pilot(world, thrown);
      if (r.distance > best.distance) best = { ...r, a, p };
    }
  }
  console.log(`${day} wind ${world.wind.base.toFixed(1).padStart(4)}  hands-off ${plain.toFixed(0).padStart(4)}  piloted ${best.distance.toFixed(0).padStart(4)} ${best.landing.padEnd(6)} held ${best.held.toFixed(0)}s  (${best.a}°, ${best.p})`);
}
