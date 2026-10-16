/**
 * 程序化音效（WebAudio 合成，零音频素材）。
 * 全部用振荡器 + 噪声缓冲现场合成，符合「不依赖外部资源」的约束。
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.6);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  resume() {
    this.ensure();
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    if (this.master) this.master.gain.value = v ? 0.5 : 0;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain = 0.22,
    slideTo?: number,
    delay = 0,
  ) {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.enabled) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  private burst(dur: number, gain: number, cutoff: number, delay = 0, sweepTo?: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise || !this.enabled) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(cutoff, t0);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(80, sweepTo), t0 + dur);
    filter.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  click() {
    this.tone(720, 0.07, "square", 0.1);
  }

  hover() {
    this.tone(1180, 0.04, "sine", 0.05);
  }

  /** 骰子在桌面上滚动 */
  roll() {
    for (let i = 0; i < 7; i++) {
      this.burst(0.05, 0.16, 900 + Math.random() * 1400, i * 0.075, 400);
    }
    this.tone(180, 0.5, "triangle", 0.08, 90);
  }

  /** 骰子落定 */
  settle() {
    this.burst(0.09, 0.22, 420, 0, 160);
    this.tone(300, 0.16, "square", 0.1, 160);
  }

  /** 棋子跳一格 */
  hop(i: number) {
    const base = 430 + (i % 6) * 42;
    this.tone(base, 0.11, "triangle", 0.13, base * 1.5);
    this.burst(0.05, 0.07, 1500, 0, 700);
  }

  /** 落地 */
  land() {
    this.tone(150, 0.22, "sine", 0.2, 70);
    this.burst(0.12, 0.1, 300, 0, 120);
  }

  good() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.24, "triangle", 0.14, undefined, i * 0.075));
  }

  bad() {
    this.tone(240, 0.14, "sawtooth", 0.14, 190);
    this.tone(180, 0.26, "sawtooth", 0.13, 90, 0.1);
  }

  freeze() {
    this.tone(1400, 0.3, "sine", 0.1, 320);
    this.burst(0.28, 0.12, 2600, 0, 600);
  }

  whoosh() {
    this.burst(0.34, 0.16, 200, 0, 1600);
  }

  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => this.tone(f, 0.4, "triangle", 0.16, undefined, i * 0.11));
    notes.forEach((f, i) => this.tone(f * 0.5, 0.5, "sine", 0.1, undefined, i * 0.11));
  }
}

export const sfx = new Sfx();
