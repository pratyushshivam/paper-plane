// Fly a grid of throws over a few skies and print how far each goes.
// Run with: npm run tune
import { dailySeed, glideRatio, makeWorld, simulate, trimSpeed, A_TRIM, A_HOLD } from "../src/engine";

console.log(`trim ${trimSpeed().toFixed(2)} m/s  L/D ${glideRatio().toFixed(2)}  held ${trimSpeed(A_TRIM + A_HOLD).toFixed(2)} m/s  L/D ${glideRatio(A_TRIM + A_HOLD).toFixed(2)}`);
const days = ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"];
const angles = [-20, -10, 0, 10, 20, 35, 50, 70];
const powers = [0.2, 0.4, 0.6, 0.8, 1];
for (const day of days) {
  const world = makeWorld(dailySeed(day));
  const z = world.zones;
  console.log(`\n${day}  wind ${world.wind.base.toFixed(1)}  town→${z.town[1].toFixed(0)} park→${z.park[1].toFixed(0)} river→${z.river[1].toFixed(0)}  thermals ${world.thermals.length} lines ${world.lines.length} tower ${world.buildings.some((b) => b.kind === "tower")}`);
  console.log("power  " + angles.map((a) => String(a).padStart(9)).join(""));
  for (const p of powers) {
    const row = angles.map((a) => {
      const r = simulate(world, { angle: (a * Math.PI) / 180, power: p });
      return `${r.distance.toFixed(0).padStart(4)}${r.landing.slice(0, 2)}${String(r.thermals)}`.padStart(9);
    });
    console.log(p.toFixed(1).padStart(5) + "  " + row.join(""));
  }
}

// A simple pilot: lift the nose in rising air and to float just above a surface.
import { Flight } from "../src/engine";
console.log("\npiloted best over a fine grid (angle, power):");
for (const day of [...days, "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]) {
  const world = makeWorld(dailySeed(day));
  let best = { d: 0, a: 0, p: 0, land: "" };
  let plain = 0;
  const all: number[] = [];
  for (let a = -25; a <= 30; a += 2.5) {
    for (let p = 0.3; p <= 1.001; p += 0.05) {
      const thrown = { angle: (a * Math.PI) / 180, power: p };
      const r0 = simulate(world, thrown);
      plain = Math.max(plain, r0.distance);
      all.push(r0.distance);
      const f = new Flight(world, thrown);
      while (!f.done) f.step(f.air.lift > 0.5 && f.speed > 4.6);
      const r = f.result();
      if (r.distance > best.d) best = { d: r.distance, a, p, land: r.landing };
    }
  }
  all.sort((x, y) => x - y);
  const q = (f: number): string => (all[Math.floor(all.length * f)] ?? 0).toFixed(0);
  console.log(`${day} wind ${world.wind.base.toFixed(1).padStart(4)}  hands-off best ${plain.toFixed(0).padStart(4)}  quartiles ${q(0.25)}/${q(0.5)}/${q(0.75)}  piloted best ${best.d.toFixed(0).padStart(4)} (${best.a}°, ${best.p.toFixed(2)}, ${best.land})`);
}
