import { hashSeed } from "./rng";

/** The first daily sky. Sky No. 1 is this date. */
const FIRST_DAY = Date.UTC(2026, 10, 13);
const DAY_MS = 86_400_000;

/** The local calendar date as YYYY-MM-DD: the key everyone shares for a day. */
export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The seed of the sky for a date key. Stable for ever for a given date. */
export function dailySeed(key: string): number {
  return hashSeed(`paper-plane/sky/${key}`);
}

/** Which daily sky this is, counting from the first one. */
export function skyNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  const t = Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1);
  return Math.round((t - FIRST_DAY) / DAY_MS) + 1;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "13 Nov 2026" from a date key. */
export function prettyDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${d ?? 1} ${MONTHS[(m ?? 1) - 1] ?? "Jan"} ${y ?? 2026}`;
}
