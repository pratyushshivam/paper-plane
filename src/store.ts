/**
 * What is remembered between visits, all in this browser's localStorage.
 * Every read and write is guarded: private windows and blocked storage
 * must never break the game.
 */

const KEY = "paper-plane/v1";

export interface DayBest {
  key: string;
  distance: number;
  landing: string;
  /** x, y, pitch triples, thinned to keep the record small. */
  path: number[];
}

export interface Saved {
  /** Best distance ever, on any sky. */
  best: number;
  /** Best throw on the latest daily sky played. */
  day: DayBest | null;
  muted: boolean;
  /** Has thrown at least once, so the demonstration is not needed. */
  thrown: boolean;
  /** Has used the nose-up hold at least once. */
  held: boolean;
}

const EMPTY: Saved = { best: 0, day: null, muted: false, thrown: false, held: false };

export function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const data = JSON.parse(raw) as Partial<Saved>;
    return {
      best: typeof data.best === "number" && Number.isFinite(data.best) ? data.best : 0,
      day: data.day && typeof data.day.key === "string" && Array.isArray(data.day.path) ? data.day : null,
      muted: data.muted === true,
      thrown: data.thrown === true,
      held: data.held === true,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function save(state: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Nothing to do: the game carries on without remembering.
  }
}

/** Keep every `every`-th sample of a path, rounded, plus the last one. */
export function thin(path: Float32Array, every = 6): number[] {
  const n = Math.floor(path.length / 3);
  const out: number[] = [];
  const round = (v: number): number => Math.round(v * 100) / 100;
  for (let i = 0; i < n; i += every) out.push(round(path[i * 3] as number), round(path[i * 3 + 1] as number), round(path[i * 3 + 2] as number));
  if ((n - 1) % every !== 0) {
    out.push(round(path[(n - 1) * 3] as number), round(path[(n - 1) * 3 + 1] as number), round(path[(n - 1) * 3 + 2] as number));
  }
  return out;
}
