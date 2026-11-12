import "./styles.css";
import { Sound, buzz } from "./audio";
import {
  DT,
  Flight,
  MAX_ANGLE,
  MIN_ANGLE,
  ROOM,
  dailySeed,
  dateKey,
  hashSeed,
  makeWorld,
  prettyDate,
  previewArc,
  skyNumber,
  surfaceAt,
  type FlightResult,
  type Throw,
  type Tree,
  type WashLine,
  type World,
} from "./engine";
import { buildHowTo } from "./howto";
import { Renderer, type Aim, type Burst, type Frame, type PlanePose, type Shake } from "./render/renderer";
import { describe, drawCard, shareText, type ShareInfo } from "./share";
import { load, save, thin } from "./store";

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

const canvas = $<HTMLCanvasElement>("sky");
const ui = {
  skyLabel: $("sky-label"),
  mode: $<HTMLButtonElement>("mode"),
  mute: $<HTMLButtonElement>("mute"),
  intro: $("intro"),
  introSub: $("intro-sub"),
  hud: $("hud"),
  dist: $("dist"),
  hudNote: $("hud-note"),
  hint: $("hint"),
  hintText: $("hint-text"),
  card: $("card"),
  cardKicker: $("card-kicker"),
  cardDist: $("card-dist"),
  cardFlag: $("card-flag"),
  cardLine: $("card-line"),
  cardStats: $("card-stats"),
  cardRound: $("card-round"),
  next: $<HTMLButtonElement>("next"),
  share: $<HTMLButtonElement>("share"),
  howOpen: $<HTMLButtonElement>("how-open"),
  how: $("how"),
  howClose: $<HTMLButtonElement>("how-close"),
  shareSheet: $("share-sheet"),
  shareClose: $<HTMLButtonElement>("share-close"),
  shareImg: $<HTMLImageElement>("share-img"),
  shareText: $("share-text"),
  shareCopy: $<HTMLButtonElement>("share-copy"),
  shareSave: $<HTMLAnchorElement>("share-save"),
  shareNative: $<HTMLButtonElement>("share-native"),
  fade: $("fade"),
  toast: $("toast"),
};

type State = "ready" | "aim" | "flight" | "landing" | "review";
const THROWS = 3;

const saved = load();
const sound = new Sound();
sound.muted = saved.muted;
const renderer = new Renderer(canvas);

let mode: "daily" | "free" = "daily";
let skyKey = dateKey();
let world: World;
let state: State = "ready";
let intro = true;
let thrownThisRound = 0;
let roundBest = 0;
/** Best flight on this sky so far: drawn as the ghost, and what is shared. */
let ghost: { distance: number; path: Float32Array; line: string } | null = null;
let flight: Flight | null = null;
let hold = false;
let heldFor = 0;
let acc = 0;
let clock = 0;
let stateTime = 0;
let trail: number[] = [];
let bursts: Burst[] = [];
const shake: Shake = { ref: null, amount: 0 };
let aim: { thrown: Throw; view: Aim; angle: number } | null = null;
let drag: { id: number; x: number; y: number } | null = null;
let lastCreak = 0;
let launchOffset = { x: 0, y: 0, t: 0 };
let landing: { result: FlightResult; dur: number; x: number; y: number; th: number; dir: number; fall: number } | null = null;
let review: { result: FlightResult; ghost: Float32Array | null; shown: number; lastTick: number; flagged: boolean; isBest: string } | null = null;
let slideDust = 0;

const cam = { x: 0, y: ROOM.startY, ppm: 60 };
const pose: PlanePose = { x: ROOM.startX, y: ROOM.startY, th: 0.05, bank: 0, up: 1, squash: 1, visible: true };

function setState(next: State): void {
  state = next;
  stateTime = 0;
  document.body.dataset.state = next;
}

function basePpm(): number {
  return Math.sqrt(renderer.w * renderer.h) / 25.4;
}

function maxPull(): number {
  return Math.max(96, Math.min(190, Math.min(renderer.w, renderer.h) * 0.26));
}

/** The view of the room before a throw. */
function readyCam(): { x: number; y: number; ppm: number } {
  const w = renderer.w;
  const h = renderer.h;
  const portrait = h > w * 1.1;
  // Leave sky above the roof for the title, and fit the whole room under it.
  const titleSpace = ui.intro.getBoundingClientRect().bottom + 48;
  const ppm = Math.max(18, Math.min(w / 12.2, (h - titleSpace - 14) / 6.7, h / 9));
  const y = ROOM.top - (h / 2 - titleSpace) / ppm;
  const x = portrait ? -0.1 : Math.max(-0.1, w / ppm / 2 - 10.4);
  return { x, y, ppm };
}

function newSky(nextMode: "daily" | "free"): void {
  mode = nextMode;
  skyKey = dateKey();
  const seed = mode === "daily" ? dailySeed(skyKey) : hashSeed(`free/${Date.now()}/${Math.random()}`);
  world = makeWorld(seed);
  renderer.setWorld(world);
  ghost = null;
  if (mode === "daily" && saved.day && saved.day.key === skyKey && saved.day.path.length >= 6) {
    ghost = { distance: saved.day.distance, path: Float32Array.from(saved.day.path), line: saved.day.landing };
  }
  thrownThisRound = 0;
  roundBest = 0;
  ui.skyLabel.textContent = mode === "daily" ? `Sky No. ${skyNumber(skyKey)} · ${prettyDate(skyKey)}` : "Free flight · a sky of its own";
  ui.mode.textContent = mode === "daily" ? "Free flight" : "Today’s sky";
  ui.introSub.textContent =
    mode === "daily" ? "Three throws. One sky a day, the same for everyone." : "Three throws into a sky nobody else has seen.";
  toReady(true);
}

function toReady(cut: boolean): void {
  flight = null;
  landing = null;
  review = null;
  aim = null;
  drag = null;
  hold = false;
  trail = [];
  bursts = [];
  shake.ref = null;
  shake.amount = 0;
  pose.x = ROOM.startX;
  pose.y = ROOM.startY;
  pose.th = 0.05;
  pose.bank = 0;
  pose.up = 1;
  pose.squash = 1;
  ui.card.hidden = true;
  ui.hint.hidden = true;
  if (cut) Object.assign(cam, readyCam());
  setState("ready");
  refreshHud();
}

function refreshHud(): void {
  document.body.dataset.intro = intro ? "1" : "0";
  if (state === "ready" || state === "aim") {
    ui.hud.hidden = intro;
    ui.dist.textContent = roundBest > 0 ? roundBest.toFixed(1) : "0.0";
    const best = ghost ? ` · best here ${ghost.distance.toFixed(1)} m` : "";
    ui.hudNote.textContent = `Throw ${thrownThisRound + 1} of ${THROWS}${best}`;
  } else if (state === "flight" || state === "landing") {
    ui.hud.hidden = false;
    ui.hudNote.textContent = `Throw ${thrownThisRound + 1} of ${THROWS}`;
  } else {
    ui.hud.hidden = true;
  }
}

/** Turn a drag (screen px, from where the press began) into a throw. */
function aimFrom(dx: number, dy: number): { thrown: Throw; view: Aim; angle: number } {
  const len = Math.hypot(dx, dy);
  const power = Math.min(1, len / maxPull());
  // The plane flies the opposite way to the pull.
  let angle = len < 3 ? 0.1 : Math.atan2(dy, -dx);
  if (angle > MAX_ANGLE) angle = MAX_ANGLE;
  if (angle < MIN_ANGLE) angle = MIN_ANGLE;
  if (-dx < 0) angle = dy >= 0 ? MAX_ANGLE : MIN_ANGLE;
  const thrown = { angle, power };
  const back = (power * maxPull()) / cam.ppm;
  const px = ROOM.startX - Math.cos(angle) * back;
  const py = ROOM.startY - Math.sin(angle) * back;
  const arc = power > 0.1 ? previewArc(world, thrown, 0.62, 6) : [];
  return { thrown, view: { px, py, arc, power }, angle };
}

function launch(): void {
  if (!aim) return;
  const thrown = aim.thrown;
  flight = new Flight(world, thrown);
  launchOffset = { x: aim.view.px - ROOM.startX, y: aim.view.py - ROOM.startY, t: 0 };
  aim = null;
  drag = null;
  hold = false;
  heldFor = 0;
  acc = 0;
  trail = [];
  intro = false;
  if (!saved.thrown) {
    saved.thrown = true;
    save(saved);
  }
  sound.release(thrown.power);
  buzz(12);
  setState("flight");
  refreshHud();
}

function land(result: FlightResult): void {
  const f = flight as Flight;
  const dir = f.vx >= 0 ? 1 : -1;
  let dur = 0.7;
  let fall = 0;
  const speed = f.hitSpeed;
  if (result.landing === "flip") {
    dur = 1.0;
    bursts.push({ kind: "ticks", x: f.x, y: f.y, age: 0, dir });
    bursts.push({ kind: "dust", x: f.x, y: f.y, age: 0, dir });
  } else if (result.landing === "tree") {
    dur = 1.25;
    const tree = world.trees.find((t: Tree) => Math.abs(f.x - t.cx) <= t.rx && Math.abs(f.y - t.cy) <= t.ry) ?? null;
    shake.ref = tree;
    shake.amount = 1;
    renderer.shed(f.x, f.y, 12);
  } else if (result.landing === "line") {
    dur = 1.5;
    shake.ref = world.lines.find((l: WashLine) => f.x > l.x0 && f.x < l.x1) ?? null;
    shake.amount = 1;
  } else if (result.landing === "wall") {
    fall = Math.max(0, f.y - result.restY);
    dur = Math.min(1.7, Math.sqrt((2 * fall) / 7)) + 0.55;
    bursts.push({ kind: "ticks", x: f.x + dir * 0.3, y: f.y, age: 0, dir: -dir });
  } else if (result.landing === "splash") {
    dur = 1.5;
    bursts.push({ kind: "splash", x: f.x, y: world.water, age: 0, dir });
  }
  landing = { result, dur, x: f.x, y: f.y, th: f.th, dir, fall };
  sound.land(result.landing, speed);
  buzz(result.landing === "skid" ? 18 : [22, 40, 30]);
  setState("landing");
}

function enterReview(result: FlightResult): void {
  const line = describe(result, world);
  const before = ghost;
  thrownThisRound++;
  roundBest = Math.max(roundBest, result.distance);
  let isBest = "";
  const beatsHere = result.distance > (before?.distance ?? 0);
  if (result.distance > saved.best && result.distance > 0) {
    isBest = saved.best > 0 ? "Best ever" : "";
    saved.best = result.distance;
  }
  if (beatsHere && result.distance > 0) {
    if (!isBest && before) isBest = mode === "daily" ? "Best today" : "Best on this sky";
    ghost = { distance: result.distance, path: result.path, line };
    if (mode === "daily") saved.day = { key: skyKey, distance: result.distance, landing: line, path: thin(result.path) };
  }
  save(saved);

  const last = thrownThisRound >= THROWS;
  ui.cardKicker.textContent = `${mode === "daily" ? "Today’s sky" : "Free flight"} · throw ${thrownThisRound} of ${THROWS}`;
  ui.cardDist.textContent = "0.0";
  ui.cardFlag.textContent = isBest;
  ui.cardFlag.classList.remove("show");
  ui.cardLine.textContent = line;
  const lifts = result.thermals === 1 ? "1 thermal" : `${result.thermals} thermals`;
  ui.cardStats.textContent = `${result.time.toFixed(1)} s in the air · ${Math.max(0, result.maxHeight).toFixed(0)} m above the street at its highest · ${lifts}`;
  ui.cardRound.textContent = last
    ? `Best of three ${roundBest.toFixed(1)} m · best ever ${saved.best.toFixed(1)} m`
    : "";
  ui.next.textContent = last ? (mode === "daily" ? "Three more" : "New sky") : `Throw again · ${THROWS - thrownThisRound} left`;
  ui.share.hidden = !ghost;
  ui.card.hidden = false;
  ui.hint.hidden = true;
  review = { result, ghost: before && before.path !== result.path ? before.path : null, shown: 0, lastTick: 0, flagged: false, isBest };
  setState("review");
  refreshHud();
}

function nextThrow(): void {
  if (state !== "review") return;
  ui.fade.classList.add("on");
  window.setTimeout(() => {
    if (thrownThisRound >= THROWS) {
      if (mode === "free") newSky("free");
      else {
        thrownThisRound = 0;
        roundBest = 0;
        toReady(true);
      }
    } else {
      toReady(true);
    }
    ui.fade.classList.remove("on");
  }, 230);
}

/** The camera target for the current state. */
function camTarget(): { x: number; y: number; ppm: number; rate: number; zoomRate: number } {
  const w = renderer.w;
  const h = renderer.h;
  const base = basePpm();
  if (state === "ready" || state === "aim") return { ...readyCam(), rate: 6, zoomRate: 6 };
  if (state === "flight" && flight) {
    const ground = surfaceAt(world, pose.x);
    const height = Math.max(0, pose.y - ground);
    // Still in the room: ease out from the room view rather than jumping.
    const leaving = Math.min(1, Math.max(0, (pose.x - 1) / 9));
    const ppmFly = base / (1 + Math.min(height, 60) / 36);
    const ready = readyCam();
    const ppm = ready.ppm + (ppmFly - ready.ppm) * leaving;
    const viewW = w / ppm;
    const viewH = h / ppm;
    const x = pose.x + viewW * 0.2 * leaving + (ready.x - ROOM.startX) * (1 - leaving);
    const look = Math.max(-3, Math.min(3, flight.vy * 0.3));
    const yFly = pose.y - Math.min(height, viewH * 0.36) * 0.55 + look;
    const y = ready.y + (yFly - ready.y) * leaving;
    return { x, y, ppm, rate: 5, zoomRate: 1.8 };
  }
  if (state === "landing" && landing) {
    return { x: pose.x, y: pose.y + 1.2, ppm: base * 1.3, rate: 3.2, zoomRate: 1.6 };
  }
  if (review) {
    const r = review.result;
    let x1 = Math.max(r.restX, 6);
    let hi = r.maxHeight;
    let lo = Math.min(0, r.restY);
    if (review.ghost) {
      const g = review.ghost;
      const n = Math.floor(g.length / 3);
      x1 = Math.max(x1, g[(n - 1) * 3] as number);
      for (let i = 0; i < n; i += 4) hi = Math.max(hi, g[i * 3 + 1] as number);
    }
    for (let x = 0; x < x1; x += 4) lo = Math.min(lo, surfaceAt(world, x));
    const x0 = ROOM.back - 1;
    hi = Math.max(hi, ROOM.top) + 3;
    x1 += Math.max(5, x1 * 0.05);
    const cardH = ui.card.hidden ? 0 : ui.card.getBoundingClientRect().height;
    // The ground sits a little above the card, with room under it for the ruler.
    const topPad = 84;
    const groundY = h - cardH - 62;
    const availH = Math.max(100, groundY - topPad);
    const ppm = Math.min(base * 1.6, (w * 0.9) / (x1 - x0), availH / (hi - lo));
    // A long, low flight leaves spare height: lift the picture towards the middle of it.
    const spare = Math.max(0, availH - (hi - lo) * ppm);
    const gy = groundY - spare * 0.38;
    return { x: (x0 + x1) / 2, y: lo + (gy - h / 2) / ppm, ppm, rate: 2.6, zoomRate: 2.6 };
  }
  return { ...readyCam(), rate: 6, zoomRate: 6 };
}

/** The demonstration: a hand pulls the plane back and lets go, until the first real throw. */
function demo(t: number): { dx: number; dy: number; down: number; alpha: number } | null {
  const T = 4.2;
  const k = t % T;
  const pull = maxPull() * 0.72;
  const ease = (a: number): number => (a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a));
  if (k < 0.5) return { dx: 0, dy: 0, down: 0, alpha: ease(k / 0.4) };
  if (k < 0.85) return { dx: 0, dy: 0, down: ease((k - 0.5) / 0.3), alpha: 1 };
  if (k < 2.0) {
    const p = ease((k - 0.85) / 1.1);
    return { dx: -pull * p, dy: pull * 0.2 * p, down: 1, alpha: 1 };
  }
  if (k < 2.7) {
    const wob = Math.sin((k - 2.0) * 4.5) * 0.09;
    return { dx: -pull, dy: pull * (0.2 + wob), down: 1, alpha: 1 };
  }
  if (k < 3.2) return { dx: -pull, dy: pull * 0.2, down: 0, alpha: 1 - ease((k - 2.7) / 0.45) };
  return null;
}

function update(dt: number): void {
  clock += dt;
  stateTime += dt;
  for (const b of bursts) b.age += dt;
  if (bursts.length > 12) bursts = bursts.filter((b) => b.age < 2);
  shake.amount *= Math.exp(-dt * 2.6);

  let hand: Frame["hand"] = null;
  let frameAim: Aim | null = null;

  if (state === "ready") {
    pose.x = ROOM.startX;
    pose.y = ROOM.startY;
    pose.th = 0.05;
    pose.bank = Math.sin(clock * 1.3) * 0.05;
    if (!saved.thrown && stateTime > 0.9) {
      const d = demo(stateTime - 0.9);
      if (d) {
        const shown = aimFrom(d.dx, d.dy);
        if (d.down > 0.5 && d.alpha > 0.99) {
          frameAim = shown.view;
          pose.x = shown.view.px;
          pose.y = shown.view.py;
          pose.th = shown.angle;
        }
        hand = {
          x: renderer.sx(view(), pose.x - 0.3),
          y: renderer.sy(view(), pose.y - 0.05),
          down: d.down,
          alpha: d.alpha,
        };
      }
    }
  } else if (state === "aim" && aim) {
    frameAim = aim.view;
    pose.x = aim.view.px;
    pose.y = aim.view.py;
    pose.th = aim.angle;
    pose.bank = 0;
  } else if (state === "flight" && flight) {
    const f = flight;
    acc += dt;
    while (acc >= DT && !f.done) {
      f.step(hold);
      acc -= DT;
      if (f.phase === "slide") {
        slideDust += DT;
        if (slideDust > 0.09) {
          slideDust = 0;
          bursts.push({ kind: "dust", x: f.x, y: f.y, age: 0, dir: f.vx >= 0 ? 1 : -1 });
        }
      }
    }
    const a = f.done ? 1 : acc / DT;
    launchOffset.t += dt;
    const ease = Math.exp(-launchOffset.t * 26);
    pose.x = f.px + (f.x - f.px) * a + launchOffset.x * ease;
    pose.y = f.py + (f.y - f.py) * a + launchOffset.y * ease;
    pose.th = f.pth + (f.th - f.pth) * a;
    const quick = Math.min(1, f.speed / 7);
    pose.bank =
      Math.max(-1, Math.min(1, f.om * 0.45)) * 0.7 +
      Math.sin(clock * 8.3) * 0.07 * quick +
      Math.sin(clock * 27) * 0.3 * f.stall +
      (f.air.lift > 0.4 ? Math.sin(clock * 3.1) * 0.22 : 0);
    trail.push(pose.x, pose.y);
    if (trail.length > 150) trail.splice(0, trail.length - 150);
    ui.dist.textContent = Math.max(0, f.x - ROOM.startX).toFixed(1);
    sound.flight(f.phase === "air", f.speed, f.air.lift, f.stall);

    // Teach the one control once, outside, with time to try it.
    if (f.x > ROOM.out + 4 && f.phase === "air") {
      if (hold) heldFor += dt;
      if (!saved.held) {
        ui.hint.hidden = false;
        if (heldFor > 0.5) {
          saved.held = true;
          save(saved);
          ui.hint.hidden = true;
        }
      }
    }
    if (f.done) {
      sound.flight(false, 0, 0, 0);
      land(f.result());
    }
  } else if (state === "landing" && landing) {
    const l = landing;
    const t = stateTime;
    const kind = l.result.landing;
    pose.squash = 1;
    pose.up = 1;
    pose.bank = 0;
    pose.x = l.x;
    pose.y = l.y;
    pose.th = l.th;
    if (kind === "flip") {
      const k = Math.min(1, t / 0.5);
      const e = k * k * (3 - 2 * k);
      // Over the nose and onto its back.
      pose.th = l.th + (-Math.PI * l.dir - l.th) * e;
      pose.x = l.x + l.dir * 0.55 * e;
      pose.y = l.y + Math.sin(k * Math.PI) * 0.5 + 0.06;
      if (k >= 1) pose.th = Math.PI + Math.sin(t * 9) * 0.05 * Math.exp(-(t - 0.5) * 6);
    } else if (kind === "tree") {
      pose.th = l.th + Math.sin(t * 17) * 0.3 * Math.exp(-t * 3.5);
      pose.x = l.x + Math.min(0.5, t * 2.5) * l.dir * 0.4;
      pose.squash = 0.86;
    } else if (kind === "line") {
      const droop = Math.min(1, t / 0.35);
      const swing = Math.sin(t * 6.5) * 0.4 * Math.exp(-t * 1.8);
      pose.th = l.th + (-1.25 - l.th) * droop + swing;
      pose.y = l.y - droop * 0.28;
    } else if (kind === "wall") {
      const T = Math.max(0.05, l.dur - 0.55);
      const k = Math.min(1, t / T);
      pose.squash = 0.72;
      pose.y = l.y - l.fall * k * k;
      pose.x = l.x - l.dir * 0.5 * Math.min(1, t * 3) + Math.sin(t * 8) * 0.18 * (1 - k);
      pose.th = k < 1 ? l.th - l.dir * t * 5.2 : 0.05 * l.dir;
      if (k >= 1 && t - T < dt * 1.5 && l.fall > 0.5) {
        bursts.push({ kind: "dust", x: pose.x, y: pose.y, age: 0, dir: l.dir });
        sound.land("skid", 2);
      }
    } else if (kind === "splash") {
      pose.y = world.water + 0.04 + Math.sin(t * 3.4) * 0.05 * Math.exp(-t * 0.8);
      pose.th = 0.1 + Math.sin(t * 2.2) * 0.05;
    } else {
      // A skid has already slid to rest; it just settles.
      pose.th = l.th * Math.exp(-t * 8);
    }
    if (t >= l.dur) enterReview(l.result);
  } else if (state === "review" && review) {
    const r = review;
    const dur = Math.min(1.5, 0.55 + r.result.distance / 320);
    const k = Math.min(1, stateTime / dur);
    const e = 1 - (1 - k) ** 3;
    r.shown = r.result.distance * e;
    ui.cardDist.textContent = r.shown.toFixed(1);
    if (k < 1 && stateTime - r.lastTick > 0.055) {
      r.lastTick = stateTime;
      sound.tick();
    }
    if (k >= 1 && !r.flagged) {
      r.flagged = true;
      if (r.isBest) {
        ui.cardFlag.classList.add("show");
        sound.best();
      }
    }
    if (landing && landing.result.landing === "splash") {
      pose.y = world.water + 0.04 + Math.sin(clock * 2.1) * 0.03;
    }
  }

  // Camera.
  const target = camTarget();
  const kp = 1 - Math.exp(-dt * target.rate);
  const kz = 1 - Math.exp(-dt * target.zoomRate);
  cam.x += (target.x - cam.x) * kp;
  cam.y += (target.y - cam.y) * kp;
  cam.ppm *= Math.pow(target.ppm / cam.ppm, kz);

  const v = view();
  renderer.draw({
    view: v,
    plane: pose,
    aim: frameAim,
    trail: state === "flight" || state === "landing" ? trail : [],
    trace: review
      ? { path: review.result.path, progress: Math.min(1, stateTime / 1.1), ghost: review.ghost, restX: review.result.restX }
      : null,
    shake,
    bursts,
    hand,
    airMarks: state === "review" ? 0.7 : 1,
    dt,
  });
}

function view(): Frame["view"] {
  return { w: renderer.w, h: renderer.h, cx: cam.x, cy: cam.y, ppm: cam.ppm, base: basePpm(), t: clock };
}

// --- input ---------------------------------------------------------------

canvas.addEventListener("pointerdown", (e) => {
  sound.wake();
  if (state === "ready") {
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    aim = aimFrom(0, 0);
    lastCreak = 0;
    if (intro) {
      intro = false;
    }
    setState("aim");
    refreshHud();
  } else if (state === "flight") {
    hold = true;
  }
  e.preventDefault();
});

canvas.addEventListener("pointermove", (e) => {
  if (state !== "aim" || !drag || e.pointerId !== drag.id) return;
  aim = aimFrom(e.clientX - drag.x, e.clientY - drag.y);
  const stepped = Math.floor(aim.thrown.power * 12);
  if (stepped !== lastCreak) {
    lastCreak = stepped;
    sound.creak(aim.thrown.power);
  }
});

function release(e: PointerEvent): void {
  if (state === "aim" && drag && e.pointerId === drag.id) {
    if (aim && aim.thrown.power >= 0.14 && e.type !== "pointercancel") launch();
    else {
      aim = null;
      drag = null;
      setState("ready");
      refreshHud();
    }
  } else if (state === "flight") {
    hold = false;
  }
}
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const sheetOpen = !ui.how.hidden || !ui.shareSheet.hidden;
  if (e.key === "Escape") {
    ui.how.hidden = true;
    ui.shareSheet.hidden = true;
    return;
  }
  if (sheetOpen) return;
  if (e.key === " " || e.key === "ArrowUp") {
    if (state === "flight") {
      sound.wake();
      hold = true;
      e.preventDefault();
    }
  } else if (e.key === "Enter" && state === "review" && document.activeElement === document.body) {
    nextThrow();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.key === " " || e.key === "ArrowUp") hold = false;
});
window.addEventListener("blur", () => {
  hold = false;
});

// --- buttons ---------------------------------------------------------------

function toast(text: string): void {
  ui.toast.textContent = text;
  ui.toast.classList.add("show");
  window.setTimeout(() => ui.toast.classList.remove("show"), 1700);
}

ui.next.addEventListener("click", () => {
  sound.wake();
  nextThrow();
});

ui.mode.addEventListener("click", () => {
  if (state === "flight" || state === "landing" || state === "aim") return;
  sound.wake();
  ui.fade.classList.add("on");
  window.setTimeout(() => {
    newSky(mode === "daily" ? "free" : "daily");
    ui.fade.classList.remove("on");
  }, 230);
});

function showMute(): void {
  ui.mute.setAttribute("aria-pressed", String(saved.muted));
  ui.mute.setAttribute("aria-label", saved.muted ? "Sound is off. Turn it on" : "Sound is on. Turn it off");
}
ui.mute.addEventListener("click", () => {
  saved.muted = !saved.muted;
  save(saved);
  sound.wake();
  sound.setMuted(saved.muted);
  showMute();
});

ui.howOpen.addEventListener("click", () => {
  buildHowTo();
  ui.how.hidden = false;
  ui.how.scrollTop = 0;
});
ui.howClose.addEventListener("click", () => {
  ui.how.hidden = true;
});

function shareInfo(): ShareInfo | null {
  if (!ghost) return null;
  return {
    title: "Paper Plane",
    sky: mode === "daily" ? `Sky No. ${skyNumber(skyKey)} · ${prettyDate(skyKey)}` : "Free flight",
    distance: ghost.distance,
    line: ghost.line,
    path: ghost.path,
    url: location.href.split(/[?#]/)[0] ?? location.href,
  };
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

let cardBlob: Blob | null = null;
let cardUrl = "";

ui.share.addEventListener("click", () => {
  const info = shareInfo();
  if (!info) return;
  const text = shareText(info);
  ui.shareText.textContent = text;
  void copy(text).then((ok) => toast(ok ? "Result copied" : "Copy it from the box below"));
  const c = document.createElement("canvas");
  const paint = (): void => {
    drawCard(c, world, info);
    c.toBlob((blob) => {
      if (!blob) return;
      cardBlob = blob;
      if (cardUrl) URL.revokeObjectURL(cardUrl);
      cardUrl = URL.createObjectURL(blob);
      ui.shareImg.src = cardUrl;
      ui.shareSave.href = cardUrl;
      const file = new File([blob], "paper-plane.png", { type: "image/png" });
      ui.shareNative.hidden = !(typeof navigator.canShare === "function" && navigator.canShare({ files: [file] }));
    }, "image/png");
  };
  // The card uses the page's typeface: wait for it, but never for long.
  void Promise.race([document.fonts.load("600 104px Geist"), new Promise((r) => setTimeout(r, 400))]).then(paint, paint);
  ui.shareSave.download = `paper-plane-${mode === "daily" ? skyKey : "free"}.png`;
  ui.shareSheet.hidden = false;
  ui.shareSheet.scrollTop = 0;
});
ui.shareClose.addEventListener("click", () => {
  ui.shareSheet.hidden = true;
});
ui.shareCopy.addEventListener("click", () => {
  void copy(ui.shareText.textContent ?? "").then((ok) => toast(ok ? "Result copied" : "Select the text to copy it"));
});
ui.shareNative.addEventListener("click", () => {
  const info = shareInfo();
  if (!info || !cardBlob) return;
  const file = new File([cardBlob], "paper-plane.png", { type: "image/png" });
  void navigator.share({ files: [file], text: shareText(info) }).catch(() => undefined);
});

// --- start -------------------------------------------------------------------

function resize(): void {
  renderer.resize();
  if (state === "ready" || state === "aim") Object.assign(cam, readyCam());
}
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", resize);

renderer.resize();
showMute();
newSky("daily");

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  // A new day while the page was open: move to its sky between rounds.
  if (mode === "daily" && state === "ready" && thrownThisRound === 0 && dateKey() !== skyKey) newSky("daily");
  update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hold = false;
    sound.flight(false, 0, 0, 0);
  } else {
    last = performance.now();
  }
});

if (import.meta.env.DEV) {
  // A handle for driving the game from the console while developing.
  (window as unknown as { pp: unknown }).pp = {
    get state() {
      return state;
    },
    get flight() {
      return flight;
    },
    get world() {
      return world;
    },
    cam,
    throw(angleDeg: number, power: number) {
      if (state !== "ready") return;
      aim = aimFrom(-Math.cos((angleDeg * Math.PI) / 180) * power * maxPull(), Math.sin((angleDeg * Math.PI) / 180) * power * maxPull());
      launch();
    },
    hold(on: boolean) {
      hold = on;
    },
    next: nextThrow,
    sky(key: string) {
      skyKey = key;
      world = makeWorld(dailySeed(key));
      renderer.setWorld(world);
      ghost = null;
      toReady(true);
    },
  };
}
