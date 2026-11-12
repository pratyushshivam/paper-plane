import type { Landing } from "./engine";

/**
 * All sound is made here from noise and sine waves: nothing is sampled.
 * The air rush follows the plane's speed, a soft chord follows rising air,
 * and paper rustles when it lands.
 */
export class Sound {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private rush: { gain: GainNode; band: BiquadFilterNode } | null = null;
  private lift: { gain: GainNode; a: OscillatorNode; b: OscillatorNode } | null = null;
  private flutter: { gain: GainNode } | null = null;

  /** Must be called from a tap or click: browsers only start sound then. */
  wake(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      const ctx = new Ctor();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 1;
      master.connect(ctx.destination);
      this.master = master;

      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;

      // Air rush: looped noise through a band that opens with speed.
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 500;
      band.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(band).connect(gain).connect(master);
      src.start();
      this.rush = { gain, band };

      // Stall flutter: the same noise, chopped.
      const chop = ctx.createGain();
      chop.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 17;
      const depth = ctx.createGain();
      depth.gain.value = 1;
      const fl = ctx.createGain();
      fl.gain.value = 0;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 900;
      lfo.connect(depth).connect(chop.gain);
      src.connect(lowpass).connect(chop).connect(fl).connect(master);
      lfo.start();
      this.flutter = { gain: fl };

      // Thermal: an open fifth, barely there.
      const lg = ctx.createGain();
      lg.gain.value = 0;
      const a = ctx.createOscillator();
      const b = ctx.createOscillator();
      a.type = "sine";
      b.type = "sine";
      a.frequency.value = 196;
      b.frequency.value = 294;
      const bg = ctx.createGain();
      bg.gain.value = 0.6;
      a.connect(lg);
      b.connect(bg).connect(lg);
      lg.connect(master);
      a.start();
      b.start();
      this.lift = { gain: lg, a, b };
    } catch {
      this.ctx = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.03);
  }

  /** Call every frame while flying; with flying false it fades to silence. */
  flight(flying: boolean, speed: number, lift: number, stall: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.rush || !this.lift || !this.flutter) return;
    const now = ctx.currentTime;
    const v = flying ? Math.min(1.6, speed / 9) : 0;
    this.rush.gain.gain.setTargetAtTime(0.085 * v * v, now, 0.08);
    this.rush.band.frequency.setTargetAtTime(280 + 900 * v, now, 0.1);
    const up = flying ? Math.max(0, Math.min(1, lift / 2.6)) : 0;
    this.lift.gain.gain.setTargetAtTime(0.05 * up, now, 0.25);
    this.lift.a.frequency.setTargetAtTime(196 * (1 + 0.12 * up), now, 0.3);
    this.lift.b.frequency.setTargetAtTime(294 * (1 + 0.12 * up), now, 0.3);
    this.flutter.gain.gain.setTargetAtTime(flying ? 0.09 * stall : 0, now, 0.06);
  }

  private burst(at: number, length: number, freq: number, type: BiquadFilterType, level: number, q = 0.8): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0008, at + length);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(at, Math.random() * 1.5, length + 0.05);
  }

  private tone(at: number, from: number, to: number, length: number, level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0008, at + length);
    osc.connect(gain).connect(this.master);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }

  /** The band letting go. */
  release(power: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.tone(now, 150 + 120 * power, 70, 0.16, 0.16);
    this.burst(now, 0.14 + 0.1 * power, 1400 + 1500 * power, "bandpass", 0.14 + 0.1 * power, 1.4);
  }

  /** The band creaking as it is pulled: one soft tick per step of pull. */
  creak(power: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.tone(ctx.currentTime, 240 + power * 260, 200 + power * 240, 0.035, 0.035);
  }

  private rustle(at: number, count: number, level: number, freq: number): void {
    let t = at;
    for (let i = 0; i < count; i++) {
      this.burst(t, 0.02 + Math.random() * 0.05, freq * (0.7 + Math.random() * 0.8), "highpass", level * (0.5 + Math.random() * 0.5));
      t += 0.025 + Math.random() * 0.07;
    }
  }

  land(kind: Landing, speed: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const hard = Math.min(1, speed / 9);
    if (kind === "splash") {
      this.burst(now, 0.5, 900, "lowpass", 0.25, 0.4);
      this.burst(now + 0.05, 0.7, 2600, "bandpass", 0.08, 0.6);
      this.tone(now, 240, 90, 0.2, 0.08);
    } else if (kind === "tree") {
      this.rustle(now, 14, 0.13, 2600);
    } else if (kind === "line") {
      this.tone(now, 330, 300, 0.5, 0.09);
      this.tone(now + 0.01, 496, 470, 0.35, 0.04);
      this.rustle(now, 4, 0.08, 2200);
    } else if (kind === "wall") {
      this.tone(now, 130, 60, 0.12, 0.2);
      this.rustle(now, 6, 0.16, 1900);
    } else if (kind === "flip") {
      this.tone(now, 110, 55, 0.1, 0.18 * hard + 0.05);
      this.rustle(now, 5, 0.14, 2000);
      this.rustle(now + 0.4, 4, 0.1, 2400);
    } else {
      this.rustle(now, 8, 0.06 + 0.07 * hard, 2300);
      this.burst(now, 0.35 + 0.3 * hard, 1700, "bandpass", 0.05 + 0.05 * hard, 0.5);
    }
  }

  /** A small tick while the distance counts up. */
  tick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.burst(ctx.currentTime, 0.012, 3200, "bandpass", 0.035, 3);
  }

  /** Two rising notes for a new best. */
  best(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.tone(now, 392, 392, 0.35, 0.07);
    this.tone(now + 0.13, 587, 587, 0.5, 0.07);
  }
}

/** A short buzz on phones that can. */
export function buzz(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
  } catch {
    // Not available: fine.
  }
}
