import { ROOM, Surf, surfaceAt, type Building, type FlightResult, type World } from "./engine";
import { INK, ORANGE, PAPER } from "./render/ink";

/** One plain sentence for how a flight ended. */
export function describe(result: FlightResult, world: World): string {
  const z = world.zones;
  const x = result.restX;
  const inRoom = x < ROOM.out;
  const place = x < z.town[1] ? "town" : x < z.park[1] ? "park" : x < z.river[1] ? "river" : "hills";
  switch (result.landing) {
    case "tree":
      return place === "hills" ? "Wedged in a tree on the hill." : "Wedged in a tree in the park.";
    case "line":
      return "Caught on a washing line.";
    case "splash":
      return "Splashed down in the river.";
    case "wall": {
      if (inRoom) return x > ROOM.wall - 1.2 ? "Hit the wall by the window." : "Hit the ceiling.";
      const tower = world.buildings.find((b: Building) => b.kind === "tower" && x > b.x0 - 1.5 && x < b.x1 + 1);
      if (tower) return "Flew into the bell tower.";
      return place === "hills" ? "Flew into the side of a barn." : "Flew into a wall.";
    }
    case "flip":
      if (inRoom) return "Stalled and dropped to the floor.";
      if (result.on === Surf.Roof) return "Nosed in on a rooftop and flipped.";
      return place === "hills" ? "Nosed into the hillside and flipped." : "Nosed in and flipped.";
    default:
      if (inRoom) return "Never left the room.";
      if (result.on === Surf.Roof) {
        const inTower = world.buildings.some((b: Building) => b.kind === "tower" && x > b.x0 && x < b.x1);
        return inTower ? "Landed inside the bell tower." : "Skidded to a stop on a rooftop.";
      }
      if (result.on === Surf.Street) return "Touched down in the street.";
      if (place === "hills") return "Settled on the hillside.";
      if (place === "river") return "Stopped on the river bank.";
      return "Landed on the grass in the park.";
  }
}

const BARS = "▁▂▃▄▅▆▇█";

/** The height of the flight as a row of small bars. */
export function sketch(path: ArrayLike<number>, columns = 12): string {
  const n = Math.floor(path.length / 3);
  if (n < 2) return BARS[0] as string;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = path[i * 3 + 1] as number;
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  const x0 = path[0] as number;
  const x1 = path[(n - 1) * 3] as number;
  const span = Math.max(1e-6, x1 - x0);
  const range = Math.max(1, hi - lo);
  const sums = new Array<number>(columns).fill(0);
  const counts = new Array<number>(columns).fill(0);
  for (let i = 0; i < n; i++) {
    const c = Math.min(columns - 1, Math.max(0, Math.floor((((path[i * 3] as number) - x0) / span) * columns)));
    sums[c] = (sums[c] as number) + (path[i * 3 + 1] as number);
    counts[c] = (counts[c] as number) + 1;
  }
  let out = "";
  let last = 0;
  for (let c = 0; c < columns; c++) {
    const v = (counts[c] as number) > 0 ? ((sums[c] as number) / (counts[c] as number) - lo) / range : last;
    last = v;
    out += BARS[Math.min(7, Math.floor(v * 7.999))];
  }
  return out;
}

export interface ShareInfo {
  title: string;
  /** "Sky No. 4 · 16 Nov 2026" or "Free flight". */
  sky: string;
  distance: number;
  line: string;
  path: ArrayLike<number>;
  url: string;
}

export function shareText(info: ShareInfo): string {
  return `${info.title} · ${info.sky}\n${info.distance.toFixed(1)} m  ${sketch(info.path)}\n${info.line}\n${info.url}`;
}

/** Draw the result as a 1200 by 630 card: the flight over the land it crossed. */
export function drawCard(canvas: HTMLCanvasElement, world: World, info: ShareInfo, ghost: ArrayLike<number> | null = null): void {
  const W = 1200;
  const H = 630;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const font = (weight: number, size: number): string => `${weight} ${size}px Geist, system-ui, sans-serif`;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);
  const m = 64;

  ctx.fillStyle = INK;
  ctx.textBaseline = "alphabetic";
  ctx.font = font(600, 30);
  ctx.fillText(info.title, m, 92);
  ctx.font = font(400, 22);
  ctx.textAlign = "right";
  ctx.globalAlpha = 0.7;
  ctx.fillText(info.sky, W - m, 92);
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
  ctx.fillRect(m, 118, W - 2 * m, 1);

  // The flight, over a cut through the land.
  const n = Math.floor(info.path.length / 3);
  let hi = ROOM.top + 2;
  let endX = 10;
  for (let i = 0; i < n; i++) {
    hi = Math.max(hi, info.path[i * 3 + 1] as number);
    endX = Math.max(endX, info.path[i * 3] as number);
  }
  if (ghost) {
    const gn = Math.floor(ghost.length / 3);
    for (let i = 0; i < gn; i++) endX = Math.max(endX, ghost[i * 3] as number);
  }
  const x0 = ROOM.left - 2;
  const x1 = endX + Math.max(8, endX * 0.06);
  let lo = 0;
  for (let x = x0; x <= x1; x += 1) lo = Math.min(lo, surfaceAt(world, x));
  lo -= 1.5;
  const top = 150;
  const bottom = 420;
  const scale = Math.min((W - 2 * m) / (x1 - x0), (bottom - top) / (hi + 3 - lo));
  const px = (x: number): number => m + (x - x0) * scale;
  const py = (y: number): number => bottom - (y - lo) * scale;

  ctx.beginPath();
  ctx.moveTo(px(x0), bottom + 1);
  const step = Math.max(0.25, 1 / scale);
  for (let x = x0; x <= x1; x += step) {
    // The room is open air inside the house.
    const inRoom = x > ROOM.back && x < ROOM.wall;
    ctx.lineTo(px(x), py(inRoom ? ROOM.floor : surfaceAt(world, x)));
  }
  ctx.lineTo(px(x1), bottom + 1);
  ctx.closePath();
  ctx.fillStyle = "#e6e0d2";
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.stroke();
  // The roof over the room.
  ctx.fillStyle = "#e6e0d2";
  ctx.fillRect(px(ROOM.back), py(ROOM.top), (ROOM.out - ROOM.back) * scale, (ROOM.top - ROOM.ceil) * scale);
  ctx.strokeRect(px(ROOM.back), py(ROOM.top), (ROOM.out - ROOM.back) * scale, (ROOM.top - ROOM.ceil) * scale);
  // Water.
  const [ra, rb] = world.zones.river;
  if (ra < x1) {
    ctx.fillStyle = "#d9ddd4";
    const b = Math.min(rb, x1);
    ctx.fillRect(px(ra + 2.5), py(world.water), (b - ra - 5) * scale, Math.max(2, (world.water - lo) * scale));
  }
  // Rising and sinking air.
  ctx.lineWidth = 1.2;
  for (const th of world.thermals) {
    if (th.x > x1 || th.x < x0) continue;
    ctx.globalAlpha = 0.3;
    ctx.setLineDash(th.w > 0 ? [3, 6] : [1.5, 6]);
    for (const off of [-0.5, 0, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(px(th.x + off * th.r), py(th.base + 1));
      ctx.lineTo(px(th.x + off * th.r), Math.max(top, py(Math.min(th.top, th.base + (th.w > 0 ? 26 : 10)))));
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  const trace = (path: ArrayLike<number>): void => {
    const count = Math.floor(path.length / 3);
    ctx.beginPath();
    ctx.moveTo(px(path[0] as number), py(path[1] as number));
    for (let i = 1; i < count; i++) ctx.lineTo(px(path[i * 3] as number), py(path[i * 3 + 1] as number));
  };
  if (ghost) {
    trace(ghost);
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  trace(info.path);
  ctx.strokeStyle = ORANGE;
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.fillStyle = ORANGE;
  ctx.beginPath();
  ctx.arc(px(info.path[0] as number), py(info.path[1] as number), 6, 0, 6.2832);
  ctx.fill();
  // A small plane where it stopped.
  const ex = px(info.path[(n - 1) * 3] as number);
  const ey = py(info.path[(n - 1) * 3 + 1] as number);
  ctx.beginPath();
  ctx.moveTo(ex + 16, ey - 4);
  ctx.lineTo(ex - 14, ey - 13);
  ctx.lineTo(ex - 9, ey - 5);
  ctx.lineTo(ex - 14, ey + 1);
  ctx.closePath();
  ctx.fill();

  // Ruler.
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 1;
  const ry = bottom + 22;
  const stepM = [10, 25, 50, 100, 250, 500].find((s) => endX / s <= 9) ?? 500;
  ctx.beginPath();
  ctx.moveTo(px(0), ry);
  ctx.lineTo(px(endX), ry);
  ctx.font = font(500, 14);
  ctx.textAlign = "center";
  ctx.globalAlpha = 0.65;
  for (let d = 0; d <= endX; d += stepM) {
    ctx.moveTo(px(d), ry - 5);
    ctx.lineTo(px(d), ry + 5);
    if (d > 0 && px(endX) - px(d) > 30) ctx.fillText(String(d), px(d), ry + 22);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // The number.
  ctx.textAlign = "left";
  ctx.font = font(600, 104);
  const big = info.distance.toFixed(1);
  ctx.fillText(big, m - 4, H - 62);
  const bw = ctx.measureText(big).width;
  ctx.font = font(500, 40);
  ctx.fillText("m", m + bw + 8, H - 62);
  ctx.textAlign = "right";
  ctx.font = font(400, 24);
  ctx.fillText(info.line, W - m, H - 98);
  ctx.globalAlpha = 0.6;
  ctx.font = font(400, 20);
  ctx.fillText(info.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), W - m, H - 64);
  ctx.globalAlpha = 1;
}
