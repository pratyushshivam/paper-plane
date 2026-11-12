/**
 * The glider: a flat wing with a little weight in the nose.
 *
 * Everything is per unit mass, so there is no mass in here: only how hard the
 * air pushes for a given speed and angle. The numbers are chosen so the plane
 * trims at about 6.5 m/s and glides about 7.5 metres forward for every metre
 * it sinks. A real sheet of A4 manages nearer 4 to 1; this one is a very well
 * folded plane.
 */

export const G = 9.81;

/** Lift and drag strength: half the air density times wing area over mass. */
export const K_AERO = 0.61;
/** Lift slope before the stall, per radian. */
export const CL_SLOPE = 4.0;
/** Angle of attack where the flow starts to let go, radians (13 degrees). */
export const A_STALL = 0.227;
/** Drag with no lift at all. */
export const CD_ZERO = 0.028;
/** Drag that comes with making lift. */
export const K_INDUCED = 0.16;
/** A stalled wing is a flat plate: these shape its lift and drag. */
export const CL_PLATE = 0.8;
export const CD_PLATE = 1.7;

/** Angle of attack the plane settles at on its own (5.5 degrees). */
export const A_TRIM = 0.096;
/** Extra angle of attack while the nose is held up. */
export const A_HOLD = 0.075;
/** Pitch stiffness and pitch damping. */
export const K_PITCH = 3.75;
export const K_DAMP = 1.9;
/** Span that sets how close to the ground the cushion of air is felt. */
export const GROUND_SPAN = 4;

export function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= 2 * Math.PI;
  while (r < -Math.PI) r += 2 * Math.PI;
  return r;
}

/** How stalled the wing is at an angle of attack: 0 flying, 1 fully let go. */
export function stallBlend(alpha: number): number {
  const a = Math.abs(alpha);
  const t = (a - (A_STALL - 0.035)) / 0.14;
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Lift coefficient at an angle of attack, through the stall and beyond. */
export function liftCoef(alpha: number): number {
  const s = stallBlend(alpha);
  return (1 - s) * CL_SLOPE * alpha + s * CL_PLATE * Math.sin(2 * alpha);
}

/**
 * Drag coefficient at an angle of attack. `ground` is 1 in free air and falls
 * towards 0 just above a surface, where the drag of making lift fades.
 */
export function dragCoef(alpha: number, ground = 1): number {
  const s = stallBlend(alpha);
  const cl = CL_SLOPE * alpha;
  const sin = Math.sin(alpha);
  return CD_ZERO + (1 - s) * K_INDUCED * cl * cl * ground + s * CD_PLATE * sin * sin;
}

/** Ground effect factor for a height above the surface. */
export function groundFactor(height: number): number {
  if (height > GROUND_SPAN) return 1;
  const r = (16 * Math.max(height, 0)) / GROUND_SPAN;
  const r2 = r * r;
  return r2 / (1 + r2);
}

/** Speed the plane settles to in a steady glide at an angle of attack. */
export function trimSpeed(alpha = A_TRIM): number {
  return Math.sqrt(G / (K_AERO * liftCoef(alpha)));
}

/** Metres forward per metre down in a steady glide at an angle of attack. */
export function glideRatio(alpha = A_TRIM): number {
  return liftCoef(alpha) / dragCoef(alpha);
}
