// 程序化音频：水下底噪、呼吸、心跳、气泡、快门等 —— 全部 WebAudio 合成，零素材。
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.master = null;
    this._breathT = 0;
    this._heartT = 0;
  }
  _ensure() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext;
    this.ctx = new C();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.on ? 0.8 : 0;
    this.master.connect(this.ctx.destination);
    this._ambient();
  }
  toggle(v) {
    this.on = v ?? !this.on;
    this._ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.master.gain.setTargetAtTime(this.on ? 0.8 : 0, this.ctx.currentTime, 0.3);
    return this.on;
  }
  _noiseBuf(sec = 2) {
    const sr = this.ctx.sampleRate, buf = this.ctx.createBuffer(1, sr * sec, sr);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    return buf;
  }
  _ambient() {
    // 低频底噪 = 过滤棕噪声循环
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf(4); src.loop = true;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const g = this.ctx.createGain(); g.gain.value = 0.16;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.11;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 60;
    lfo.connect(lfoG); lfoG.connect(lp.frequency);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(); lfo.start();
    // 远处偶发水滴声
    const drip = () => {
      if (!this.ctx) return;
      const o = this.ctx.createOscillator(), og = this.ctx.createGain();
      o.frequency.setValueAtTime(900 + Math.random() * 600, this.ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.08);
      og.gain.setValueAtTime(0.05, this.ctx.currentTime);
      og.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.3);
      o.connect(og); og.connect(this.master); o.start(); o.stop(this.ctx.currentTime + 0.35);
      setTimeout(drip, 3000 + Math.random() * 9000);
    };
    setTimeout(drip, 4000);
  }
  // 呼吸：4s 一个循环，吸气+呼气两段噪声
  update(dt, player, inWater = true) {
    if (!this.ctx || !this.on || !inWater) return;
    this._breathT -= dt;
    if (this._breathT <= 0) {
      this._breathT = 3.6 + Math.random() * 0.8 - (player?.panic || 0) * 1.4;
      this._breath();
    }
    if (player && player.panic > 0.55) {
      this._heartT -= dt;
      if (this._heartT <= 0) { this._heartT = 60 / player.heart; this._thump(); }
    }
  }
  _breath() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf(1.6);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(); src.stop(t + 1.6);
  }
  _thump() {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime;
    o.frequency.value = 55;
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g); g.connect(this.master); o.start(); o.stop(t + 0.2);
  }
  _blip(freq, dur = 0.08, vol = 0.12, type = 'sine') {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime;
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(); o.stop(t + dur + 0.02);
  }
  shutter() { this._blip(2400, 0.05, 0.15, 'square'); this._blip(1200, 0.12, 0.1, 'square'); }
  pickup() { this._blip(520, 0.1); this._blip(780, 0.15, 0.1); }
  ok() { this._blip(660, 0.09); }
  warn() { this._blip(330, 0.25, 0.16, 'sawtooth'); }
  hiss() { // 自由流
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuf(1);
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400;
    const g = this.ctx.createGain(); const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.14, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    src.connect(hp); hp.connect(g); g.connect(this.master); src.start(); src.stop(t + 1.3);
  }
  clunk() { this._blip(120, 0.15, 0.2, 'triangle'); }
  silt() {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuf(0.8);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const g = this.ctx.createGain(); const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    src.connect(lp); lp.connect(g); g.connect(this.master); src.start(); src.stop(t + 0.8);
  }
  bubble() { this._blip(300 + Math.random() * 300, 0.06, 0.05); }
}
