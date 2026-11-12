import { A_HOLD, A_STALL, A_TRIM, DT, dragCoef, glideRatio, liftCoef, trimSpeed } from "./engine";

const NS = "http://www.w3.org/2000/svg";
const INK = "#15140f";
const ORANGE = "#d4491a";

function el(parent: Element, name: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  parent.appendChild(node);
  return node;
}

function arrow(svg: Element, x1: number, y1: number, x2: number, y2: number, width = 1.6, color = INK): void {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const head = 9;
  el(svg, "line", { x1, y1, x2, y2, stroke: color, "stroke-width": width, "stroke-linecap": "round" });
  const p = (da: number): string => `${x2 - Math.cos(a + da) * head},${y2 - Math.sin(a + da) * head}`;
  el(svg, "polyline", { points: `${p(0.42)} ${x2},${y2} ${p(-0.42)}`, fill: "none", stroke: color, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round" });
}

/** The plane and the three forces on it. */
function forces(svg: Element): void {
  const cx = 300;
  const cy = 158;
  const path = (10 * Math.PI) / 180; // the plane is descending this steeply
  const attack = (13 * Math.PI) / 180; // drawn larger than life so it can be seen
  const dx = Math.cos(path);
  const dy = Math.sin(path);
  // The air, coming the other way.
  for (const off of [-78, -30, 54, 98]) {
    const ox = -dy * off;
    const oy = dx * off;
    const from = off > -40 && off < 60 ? 232 : 250;
    el(svg, "line", {
      x1: cx + ox + dx * from, y1: cy + oy + dy * from, x2: cx + ox - dx * 250, y2: cy + oy - dy * 250,
      stroke: INK, "stroke-width": 1, "stroke-dasharray": "2 7", opacity: 0.5,
    });
    arrow(svg, cx + ox - dx * 236, cy + oy - dy * 236, cx + ox - dx * 250, cy + oy - dy * 250, 1, "rgba(21,20,15,0.5)");
  }
  el(svg, "text", { x: 522, y: 262, "font-size": 13, opacity: 0.65, "text-anchor": "end" }, "air rushing past");

  // The plane, nose up from its path by the angle of attack.
  const a = path - attack;
  const ax = Math.cos(a);
  const ay = Math.sin(a);
  const pt = (along: number, up: number): string => `${cx + ax * along + ay * up},${cy + ay * along - ax * up}`;
  el(svg, "polygon", { points: `${pt(88, -3)} ${pt(-80, 5)} ${pt(-84, 30)}`, fill: "#e9764a", stroke: INK, "stroke-width": 1, "stroke-linejoin": "round" });
  el(svg, "polygon", { points: `${pt(88, -3)} ${pt(-80, 5)} ${pt(-80, -10)} ${pt(-58, -25)}`, fill: "#b03a12", stroke: INK, "stroke-width": 1, "stroke-linejoin": "round" });
  el(svg, "polygon", { points: `${pt(88, -3)} ${pt(-80, 5)} ${pt(-90, -3)}`, fill: ORANGE, stroke: INK, "stroke-width": 1, "stroke-linejoin": "round" });

  // The angle between the wing and the air.
  el(svg, "line", { x1: cx, y1: cy, x2: cx + ax * 186, y2: cy + ay * 186, stroke: INK, "stroke-width": 1, opacity: 0.55 });
  el(svg, "line", { x1: cx, y1: cy, x2: cx + dx * 186, y2: cy + dy * 186, stroke: INK, "stroke-width": 1, opacity: 0.55 });
  const r = 150;
  el(svg, "path", {
    d: `M ${cx + ax * r} ${cy + ay * r} A ${r} ${r} 0 0 1 ${cx + dx * r} ${cy + dy * r}`,
    fill: "none", stroke: INK, "stroke-width": 1,
  });
  el(svg, "text", { x: cx + 196, y: cy + 12, "font-size": 13 }, "angle of attack");

  arrow(svg, cx, cy, cx + dy * 112, cy - dx * 112, 1.8);
  el(svg, "text", { x: cx + dy * 112 + 12, y: cy - dx * 112 + 8, "font-size": 15, "font-weight": 600 }, "Lift");
  arrow(svg, cx - dx * 92, cy - dy * 92, cx - dx * 158, cy - dy * 158, 1.8);
  el(svg, "text", { x: cx - dx * 158 - 10, y: cy - dy * 158 - 10, "font-size": 15, "font-weight": 600, "text-anchor": "end" }, "Drag");
  arrow(svg, cx, cy, cx, cy + 104, 1.8);
  el(svg, "text", { x: cx + 12, y: cy + 104, "font-size": 15, "font-weight": 600 }, "Weight");
  el(svg, "circle", { cx, cy, r: 3, fill: INK });
}

/** Lift and drag against angle of attack, straight from the model. */
function stall(svg: Element): void {
  const x0 = 62;
  const x1 = 610;
  const y0 = 236;
  const y1 = 34;
  const maxDeg = 30;
  const maxC = 1.05;
  const X = (deg: number): number => x0 + ((x1 - x0) * deg) / maxDeg;
  const Y = (c: number): number => y0 - ((y0 - y1) * c) / maxC;
  el(svg, "line", { x1: x0, y1: y0, x2: x1, y2: y0, stroke: INK, "stroke-width": 1 });
  el(svg, "line", { x1: x0, y1: y0, x2: x0, y2: y1 - 8, stroke: INK, "stroke-width": 1 });
  for (let d = 0; d <= maxDeg; d += 5) {
    el(svg, "line", { x1: X(d), y1: y0, x2: X(d), y2: y0 + 5, stroke: INK, "stroke-width": 1 });
    el(svg, "text", { x: X(d), y: y0 + 20, "font-size": 12, "text-anchor": "middle", opacity: 0.7 }, `${d}°`);
  }
  el(svg, "text", { x: x1, y: y0 + 38, "font-size": 13, "text-anchor": "end", opacity: 0.7 }, "angle of attack");

  const stallDeg = (A_STALL * 180) / Math.PI;
  el(svg, "line", { x1: X(stallDeg), y1: y0, x2: X(stallDeg), y2: y1, stroke: INK, "stroke-width": 1, "stroke-dasharray": "2 5", opacity: 0.6 });
  el(svg, "text", { x: X(stallDeg) + 10, y: y1 + 6, "font-size": 13, "font-weight": 600 }, "the air lets go");

  const curve = (f: (a: number) => number): string => {
    let d = "";
    for (let deg = 0; deg <= maxDeg; deg += 0.25) d += `${deg === 0 ? "M" : "L"}${X(deg).toFixed(1)} ${Y(f((deg * Math.PI) / 180)).toFixed(1)}`;
    return d;
  };
  el(svg, "path", { d: curve((a) => dragCoef(a)), fill: "none", stroke: INK, "stroke-width": 1.2, "stroke-dasharray": "6 5", opacity: 0.7 });
  el(svg, "text", { x: X(27.5), y: Y(dragCoef((27.5 * Math.PI) / 180)) + 20, "font-size": 14, "text-anchor": "middle", opacity: 0.8 }, "drag");
  el(svg, "path", { d: curve(liftCoef), fill: "none", stroke: ORANGE, "stroke-width": 2.4, "stroke-linejoin": "round" });
  el(svg, "text", { x: X(24), y: Y(liftCoef((24 * Math.PI) / 180)) - 12, "font-size": 15, "font-weight": 600, fill: ORANGE }, "lift").setAttribute("style", `fill:${ORANGE}`);

  const mark = (alpha: number, label: string, dy: number): void => {
    const deg = (alpha * 180) / Math.PI;
    el(svg, "circle", { cx: X(deg), cy: Y(liftCoef(alpha)), r: 4.5, fill: "#f2eee5", stroke: INK, "stroke-width": 1.4 });
    el(svg, "text", { x: X(deg) - 10, y: Y(liftCoef(alpha)) + dy, "font-size": 13, "text-anchor": "end" }, label);
  };
  mark(A_TRIM, "gliding", -6);
  mark(A_TRIM + A_HOLD, "nose held up", -8);
}

export function buildHowTo(): void {
  const f = document.getElementById("fig-forces");
  const s = document.getElementById("fig-stall");
  if (f && !f.childNodes.length) forces(f);
  if (s && !s.childNodes.length) stall(s);
  const numbers = document.getElementById("how-numbers");
  if (numbers) {
    numbers.textContent =
      `This plane glides ${glideRatio().toFixed(1)} metres forward for every metre it sinks, at ${trimSpeed().toFixed(1)} m/s. ` +
      `With the nose held up it slows to ${trimSpeed(A_TRIM + A_HOLD).toFixed(1)} m/s. ` +
      `The flight is worked out ${Math.round(1 / DT)} times a second, and the same throw into the same sky always lands in the same place, to the millimetre.`;
  }
}
