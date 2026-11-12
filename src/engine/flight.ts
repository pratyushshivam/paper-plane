import { airAt, type Air } from "./air";
import {
  A_HOLD,
  A_TRIM,
  G,
  K_AERO,
  K_DAMP,
  K_PITCH,
  dragCoef,
  groundFactor,
  liftCoef,
  stallBlend,
  wrapAngle,
} from "./glider";
import { ROOM, Surf, kindAt, lineY, surfaceAt, type SurfKind, type World } from "./world";

/** The fixed time step of the simulation: 240 steps a second. */
export const DT = 1 / 240;
/** One path sample is kept every this many steps (60 a second). */
export const SAMPLE_EVERY = 4;

export const MIN_SPEED = 4.5;
export const MAX_SPEED = 11.5;
export const MIN_ANGLE = -0.6;
export const MAX_ANGLE = 1.45;

/** A throw: the direction it leaves the hand, and how hard, 0 to 1. */
export interface Throw {
  angle: number;
  power: number;
}

export type Landing = "skid" | "flip" | "tree" | "line" | "wall" | "splash";

export interface FlightResult {
  /** Metres from the hand to where the plane came to rest. Never negative. */
  distance: number;
  landing: Landing;
  /** What it came down on. */
  on: SurfKind;
  restX: number;
  restY: number;
  time: number;
  maxHeight: number;
  topSpeed: number;
  /** How many columns of rising air it flew through. */
  thermals: number;
  /** x, y, pitch triples, 60 a second, from the hand to rest. */
  path: Float32Array;
}

export function launchSpeed(power: number): number {
  const p = power < 0 ? 0 : power > 1 ? 1 : power;
  return MIN_SPEED + (MAX_SPEED - MIN_SPEED) * p;
}

export function clampAngle(angle: number): number {
  return angle < MIN_ANGLE ? MIN_ANGLE : angle > MAX_ANGLE ? MAX_ANGLE : angle;
}

/**
 * One flight, stepped at a fixed rate. Deterministic: the same world, throw
 * and sequence of `hold` inputs always give the same flight.
 */
export class Flight {
  readonly world: World;
  t = 0;
  steps = 0;
  x: number = ROOM.startX;
  y: number = ROOM.startY;
  vx: number;
  vy: number;
  /** Pitch: where the nose points, radians above the horizon. */
  th: number;
  /** Pitch rate. */
  om = 0;
  /** How far the nose-up input has come in, 0 to 1. */
  elev = 0;
  /** Position one step ago, for drawing between steps. */
  px: number = ROOM.startX;
  py: number = ROOM.startY;
  pth: number;

  phase: "air" | "slide" | "done" = "air";
  landing: Landing | null = null;
  on: SurfKind = Surf.Floor;
  /** Where it first touched something. */
  hitX = 0;
  hitY = 0;
  hitSpeed = 0;

  /** Read-outs of the last step, for drawing and sound. */
  alpha = 0;
  speed: number;
  stall = 0;
  air: Air = { u: 0, w: 0, lift: 0 };
  height = 0;

  maxHeight: number = ROOM.startY;
  topSpeed = 0;
  thermals = 0;
  private inLift = false;
  private samples: number[] = [];

  constructor(world: World, thrown: Throw, record = true) {
    this.world = world;
    const angle = clampAngle(thrown.angle);
    const v = launchSpeed(thrown.power);
    this.vx = v * Math.cos(angle);
    this.vy = v * Math.sin(angle);
    this.th = angle;
    this.pth = angle;
    this.speed = v;
    this.topSpeed = v;
    this.recording = record;
    if (record) this.samples.push(this.x, this.y, this.th);
  }

  private recording: boolean;

  get done(): boolean {
    return this.phase === "done";
  }

  /** Mechanical energy per unit mass, for the tests. */
  energy(): number {
    return 0.5 * (this.vx * this.vx + this.vy * this.vy) + G * this.y;
  }

  /** Advance one fixed step. `hold` raises the nose a little. */
  step(hold = false): void {
    if (this.phase === "done") return;
    this.px = this.x;
    this.py = this.y;
    this.pth = this.th;
    if (this.phase === "slide") this.slideStep();
    else this.airStep(hold);
    this.t += DT;
    this.steps++;
    if (this.recording && (this.steps % SAMPLE_EVERY === 0 || this.done)) {
      this.samples.push(this.x, this.y, this.th);
    }
  }

  private airStep(hold: boolean): void {
    const world = this.world;
    const air = airAt(world, this.x, this.y, this.t, this.air);

    // Velocity through the air, not over the ground: that is what the wing feels.
    const rx = this.vx - air.u;
    const ry = this.vy - air.w;
    const v2 = rx * rx + ry * ry;
    const v = Math.sqrt(v2) || 1e-6;
    const alpha = wrapAngle(this.th - Math.atan2(ry, rx));

    const height = this.y - surfaceAt(world, this.x);
    const cl = liftCoef(alpha);
    const cd = dragCoef(alpha, groundFactor(height));
    const q = K_AERO * v;
    // Drag pulls back along the airflow; lift pushes at right angles to it.
    const ax = q * (-cd * rx - cl * ry);
    const ay = q * (-cd * ry + cl * rx) - G;

    // The nose-up input moves the angle the plane wants to fly at.
    const target = hold ? 1 : 0;
    this.elev += Math.max(-DT * 4.5, Math.min(DT * 4.5, target - this.elev));
    const trim = A_TRIM + A_HOLD * this.elev;
    // The weight in the nose turns the plane back towards its trim angle.
    const turn = -K_PITCH * v2 * Math.sin(alpha - trim) - K_DAMP * v * this.om;

    this.vx += ax * DT;
    this.vy += ay * DT;
    this.om += turn * DT;
    this.x += this.vx * DT;
    this.y += this.vy * DT;
    this.th = wrapAngle(this.th + this.om * DT);

    this.alpha = alpha;
    this.speed = Math.hypot(this.vx, this.vy);
    this.stall = stallBlend(alpha);
    this.height = height;
    if (this.y > this.maxHeight) this.maxHeight = this.y;
    if (this.speed > this.topSpeed) this.topSpeed = this.speed;
    const lifting = air.lift > 0.6;
    if (lifting && !this.inLift) this.thermals++;
    this.inLift = lifting;

    this.collide();
    if (this.t > 300) this.rest("skid", kindAt(world, this.x));
  }

  private collide(): void {
    const world = this.world;
    const x = this.x;
    const y = this.y;

    if (x <= world.x0 + 1 || x >= world.length - 2) {
      this.touch("wall", kindAt(world, this.px), this.px, y);
      return;
    }

    for (const b of world.blocks) {
      if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) {
        if (this.py >= b.y1 - 0.02) {
          this.y = b.y1;
          this.touchDown(Surf.Roof, 0);
        } else {
          this.touch("wall", kindAt(world, this.px), this.px, this.py);
        }
        return;
      }
    }

    for (const line of world.lines) {
      if (x > line.x0 && x < line.x1) {
        const ly = lineY(line, x);
        if (y < ly + 0.12 && y > ly - 1.0) {
          this.touch("line", Surf.Roof, x, y);
          return;
        }
      }
    }

    for (const tree of world.trees) {
      const dx = (x - tree.cx) / tree.rx;
      if (dx > 1 || dx < -1) continue;
      const dy = (y - tree.cy) / tree.ry;
      if (dx * dx + dy * dy < 0.8) {
        this.touch("tree", Surf.Grass, x, y);
        return;
      }
    }

    const s = surfaceAt(world, x);
    if (y <= s) {
      const kind = kindAt(world, x);
      if (this.py >= s - 0.02 || s - y < 0.3) {
        this.y = s;
        if (kind === Surf.Water) {
          this.touch("splash", Surf.Water, x, s);
          return;
        }
        const run = this.vx >= 0 ? 0.5 : -0.5;
        const ahead = surfaceAt(world, x + run);
        const rise = Math.max(-0.5, Math.min(0.5, ahead - s));
        this.touchDown(kind, Math.atan2(rise, 0.5));
      } else {
        // Flew into the side of something.
        this.touch("wall", kindAt(world, this.px), this.px, this.py);
      }
    }
  }

  /** Came down onto a surface: skid along it, or dig the nose in and flip. */
  private touchDown(kind: SurfKind, uphill: number): void {
    const speed = Math.hypot(this.vx, this.vy);
    const descent = Math.atan2(-this.vy, Math.abs(this.vx)) + uphill;
    this.hitX = this.x;
    this.hitY = this.y;
    this.hitSpeed = speed;
    this.on = kind;
    if (descent > 0.72 || this.th < -0.95 || Math.abs(this.th) > 1.9) {
      this.landing = "flip";
      this.phase = "done";
      return;
    }
    this.landing = "skid";
    this.phase = "slide";
    this.vy = 0;
    this.om = 0;
  }

  private slideStep(): void {
    const world = this.world;
    const dir = this.vx >= 0 ? 1 : -1;
    const v = Math.abs(this.vx) - 8.5 * DT;
    if (v <= 0.15) {
      this.phase = "done";
      return;
    }
    const nx = this.x + dir * v * DT;
    const here = surfaceAt(world, this.x);
    const next = surfaceAt(world, nx);
    let blocked = Math.abs(next - here) > 0.3;
    for (const b of world.blocks) {
      if (nx > b.x0 && nx < b.x1 && this.y + 0.1 > b.y0 && this.y < b.y1) blocked = true;
    }
    if (blocked) {
      // An edge or a wall: stop there.
      this.phase = "done";
      return;
    }
    this.vx = dir * v;
    this.x = nx;
    this.y = Math.max(next, this.y - 2 * DT);
    if (this.y < next) this.y = next;
    // The nose settles flat along the surface.
    this.th += (0 - this.th) * Math.min(1, DT * 14);
    this.speed = v;
  }

  private touch(landing: Landing, on: SurfKind, x: number, y: number): void {
    this.hitSpeed = Math.hypot(this.vx, this.vy);
    this.x = x;
    this.y = y;
    this.hitX = x;
    this.hitY = y;
    this.rest(landing, on);
  }

  private rest(landing: Landing, on: SurfKind): void {
    this.landing = landing;
    this.on = on;
    this.phase = "done";
  }

  /** The finished flight. Only valid once `done`. */
  result(): FlightResult {
    const world = this.world;
    const landing = this.landing ?? "skid";
    // A plane that hit a wall drops to whatever is below it.
    const restY = landing === "wall" ? Math.min(this.y, surfaceAt(world, this.x)) : this.y;
    return {
      distance: Math.max(0, Math.round((this.x - ROOM.startX) * 10) / 10),
      landing,
      on: this.on,
      restX: this.x,
      restY,
      time: this.t,
      maxHeight: this.maxHeight,
      topSpeed: this.topSpeed,
      thermals: this.thermals,
      path: Float32Array.from(this.samples),
    };
  }
}

/**
 * Fly a throw to the end with no drawing. `holds` lists the steps at which the
 * nose-up input flips, starting from released.
 */
export function simulate(world: World, thrown: Throw, holds: readonly number[] = []): FlightResult {
  const f = new Flight(world, thrown);
  let hold = false;
  let next = 0;
  while (!f.done) {
    while (next < holds.length && (holds[next] as number) <= f.steps) {
      hold = !hold;
      next++;
    }
    f.step(hold);
  }
  return f.result();
}

/** The first moments of a throw, as x, y pairs: the aiming arc. */
export function previewArc(world: World, thrown: Throw, seconds = 0.6, every = 8): number[] {
  const f = new Flight(world, thrown, false);
  const pts: number[] = [f.x, f.y];
  const n = Math.round(seconds / DT);
  for (let i = 1; i <= n && !f.done; i++) {
    f.step(false);
    if (i % every === 0 || f.done) pts.push(f.x, f.y);
  }
  return pts;
}
