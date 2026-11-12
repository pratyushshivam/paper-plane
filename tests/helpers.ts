import { ROOM, Surf, makeWorld, type World } from "../src/engine";

/** The room and its window, then nothing but flat street and still air. */
export function bareWorld(seed = 7): World {
  const world = makeWorld(seed);
  for (let i = 0; i < world.surface.length; i++) {
    const x = world.x0 + (i + 0.5) * world.res;
    world.slope[i] = 0;
    world.terrain[i] = 0;
    if (x > ROOM.out) {
      world.surface[i] = 0;
      world.kind[i] = Surf.Street;
    }
  }
  world.blocks = world.blocks.filter((b) => b.x1 <= ROOM.out + 0.01);
  world.buildings = [];
  world.lines = [];
  world.trees = [];
  world.thermals = [];
  world.wind = { base: 0, gust: 0, period: 6, phase: 0 };
  return world;
}

export const deg = (d: number): number => (d * Math.PI) / 180;
