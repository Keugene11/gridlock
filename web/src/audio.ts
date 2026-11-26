/** All sound is synthesized with WebAudio: engine, tires, siren, horn, impacts, city bed. */
export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  eng!: { o1: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode };
  tire!: { g: GainNode };
  siren!: { o: OscillatorNode; lfo: OscillatorNode; g: GainNode };
  city!: GainNode;
  noise!: AudioBuffer;

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const c = (this.ctx = new AudioContext());
    this.master = c.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(c.destination);
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    // engine
    const o1 = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o1.type = "sawtooth"; o2.type = "square";
    f.type = "lowpass"; f.frequency.value = 600; f.Q.value = 2;
    g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
    o1.start(); o2.start();
    this.eng = { o1, o2, f, g };
    // tires: band-passed noise
    const tn = c.createBufferSource(); tn.loop = true;
    const white = c.createBuffer(1, len, c.sampleRate), wd = white.getChannelData(0);
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
    tn.buffer = white;
    const tb = c.createBiquadFilter(); tb.type = "bandpass"; tb.frequency.value = 1400; tb.Q.value = 3;
    const tg = c.createGain(); tg.gain.value = 0;
    tn.connect(tb); tb.connect(tg); tg.connect(this.master); tn.start();
    this.tire = { g: tg };
    // siren
    const so = c.createOscillator(); so.type = "sawtooth";
    const lfo = c.createOscillator(); lfo.frequency.value = 0.35;
    const lg = c.createGain(); lg.gain.value = 420;
    lfo.connect(lg); lg.connect(so.frequency); so.frequency.value = 1000;
    const sf = c.createBiquadFilter(); sf.type = "lowpass"; sf.frequency.value = 2200;
    const sg = c.createGain(); sg.gain.value = 0;
    so.connect(sf); sf.connect(sg); sg.connect(this.master); so.start(); lfo.start();
    this.siren = { o: so, lfo, g: sg };
    // city bed: brown noise
    const cn = c.createBufferSource(); cn.buffer = this.noise; cn.loop = true;
    const cf = c.createBiquadFilter(); cf.type = "lowpass"; cf.frequency.value = 500;
    this.city = c.createGain(); this.city.gain.value = 0.12;
    cn.connect(cf); cf.connect(this.city); this.city.connect(this.master); cn.start();
  }

  update(o: { driving: boolean; rpm: number; throttle: number; slip: number; sirenDist: number; muted: boolean }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(o.muted ? 0 : 0.55, t, 0.05);
    const f = 38 + o.rpm * 120;
    this.eng.o1.frequency.setTargetAtTime(f, t, 0.05);
    this.eng.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.eng.f.frequency.setTargetAtTime(300 + o.rpm * 900 + o.throttle * 600, t, 0.05);
    this.eng.g.gain.setTargetAtTime(o.driving ? 0.05 + o.throttle * 0.07 : 0, t, 0.08);
    this.tire.g.gain.setTargetAtTime(o.driving ? Math.min(0.12, Math.max(0, o.slip - 2.5) * 0.02) : 0, t, 0.05);
    const sv = o.sirenDist < 400 ? Math.min(0.09, 0.09 * (1 - o.sirenDist / 400) ** 1.5 + 0.004) : 0;
    this.siren.g.gain.setTargetAtTime(sv, t, 0.2);
  }

  horn(dist = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain();
    const v = 0.12 / (1 + dist / 25);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.02); g.gain.setValueAtTime(v, t + 0.35); g.gain.linearRampToValueAtTime(0, t + 0.45);
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1800;
    for (const fr of [370 + Math.random() * 60, 466 + Math.random() * 60]) {
      const o = c.createOscillator(); o.type = "square"; o.frequency.value = fr; o.connect(f); o.start(t); o.stop(t + 0.5);
    }
    f.connect(g); g.connect(this.master);
  }

  thud(strength: number) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 260 + strength * 30;
    const g = c.createGain();
    const v = Math.min(0.9, 0.12 + strength * 0.04);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + 0.6);
  }

  chime() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    [659, 880, 1318].forEach((fr, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.value = fr;
      g.gain.setValueAtTime(0, t + i * 0.09); g.gain.linearRampToValueAtTime(0.09, t + i * 0.09 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.5);
      o.connect(g); g.connect(this.master); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.6);
    });
  }
}
