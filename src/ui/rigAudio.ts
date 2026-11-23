/**
 * The rig's sound, synthesized: no audio files. Starts only after the player's first gesture
 * (browsers require it) and can be muted. The thump of each blow tells the driller how well the
 * tools are striking: heavy and clean when square, dull when short, a slap when slack.
 */
export class RigAudio {
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private noise: AudioBuffer | undefined;
  private roarGain: GainNode | undefined;
  muted = false;

  start(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Prairie wind: filtered noise, slowly breathing.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.13;
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain).connect(g.gain);
    wind.connect(lp).connect(g).connect(this.master);
    wind.start();
    lfo.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  stop(): void {
    void this.ctx?.close();
    this.ctx = undefined;
    this.master = undefined;
    this.roarGain = undefined;
  }

  private burst(freq: number, type: BiquadFilterType, dur: number, gain: number, q = 0.7): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** One blow of the tools. `contact` 0–1: how squarely they struck bottom. */
  blow(contact: number, slack: boolean): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    g.gain.setValueAtTime(0.15 + contact * 0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
    this.burst(2400, "highpass", 0.04, 0.08 + contact * 0.12);
    if (slack) this.burst(900, "bandpass", 0.09, 0.22, 3);
  }

  /** The engine exhausting: a chuff of steam. */
  chuff(): void {
    this.burst(1400, "highpass", 0.22, 0.05);
  }

  /** The gusher's roar, rising and held. */
  roar(on: boolean): void {
    if (!this.ctx || !this.master || !this.noise) return;
    if (on && !this.roarGain) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 520;
      this.roarGain = this.ctx.createGain();
      this.roarGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      this.roarGain.gain.exponentialRampToValueAtTime(0.55, this.ctx.currentTime + 1.6);
      src.connect(f).connect(this.roarGain).connect(this.master);
      src.start();
    } else if (!on && this.roarGain) {
      this.roarGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4);
      this.roarGain = undefined;
    }
  }
}
