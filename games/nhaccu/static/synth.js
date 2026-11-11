/* Tổng hợp âm thanh 3 nhạc cụ bằng WebAudio — không cần tải file âm thanh nào.
 * Synth.start(inst, midi, {vol}) trả về một “giọng” có .stop() để nhả nốt. */
(function () {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function audio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 4;
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(comp); comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  const freq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function osc(type, f, dest, gain = 1) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = f;
    if (gain === 1) { o.connect(dest); return o; }
    const g = ctx.createGain();
    g.gain.value = gain;
    o.connect(g); g.connect(dest);
    return o;
  }

  function vibrato(oscs, f, rate, depth, delay) {
    const lfo = ctx.createOscillator();
    const g = ctx.createGain();
    lfo.frequency.value = rate;
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0, t + delay);
    g.gain.linearRampToValueAtTime(f * depth, t + delay + 0.4);
    lfo.connect(g);
    oscs.forEach((o) => g.connect(o.frequency));
    return lfo;
  }

  function noise(dest, gain) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf; n.loop = true;
    const g = ctx.createGain();
    g.gain.value = gain;
    n.connect(g); g.connect(dest);
    return n;
  }

  function finish(nodes, env, release) {
    let done = false;
    return {
      stop() {
        if (done) return;
        done = true;
        const t = ctx.currentTime;
        env.gain.cancelScheduledValues(t);
        env.gain.setValueAtTime(Math.max(env.gain.value, 0.0001), t);
        env.gain.exponentialRampToValueAtTime(0.0001, t + release);
        nodes.forEach((n) => { try { n.stop(t + release + 0.05); } catch (e) { /* đã dừng */ } });
      },
    };
  }

  // Piano: tiếng gõ có hoạ âm, tắt dần; nhả phím thì chặn tiếng (giảm chấn).
  function piano(m, vol) {
    const f = freq(m);
    const t = ctx.currentTime;
    const env = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 0.5;
    lp.frequency.setValueAtTime(Math.min(16000, f * 9), t);
    lp.frequency.exponentialRampToValueAtTime(Math.min(12000, f * 2.5), t + 1.2);
    lp.connect(env); env.connect(master);
    const decay = Math.max(1.2, 3.2 - (m - 48) * 0.04);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    env.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.35);
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const nodes = [osc('triangle', f, lp), osc('sine', f * 2, lp, 0.35), osc('sine', f * 3, lp, 0.12), osc('sine', f * 1.003, lp, 0.4)];
    nodes.forEach((o) => { o.start(t); o.stop(t + decay + 0.1); });
    return finish(nodes, env, 0.22);
  }

  // Sáo trúc: âm gần sine, có tiếng hơi gió và rung hơi sau khi giữ nốt.
  function flute(m, vol) {
    const f = freq(m);
    const t = ctx.currentTime;
    const env = ctx.createGain();
    env.connect(master);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol, t + 0.07);
    env.gain.exponentialRampToValueAtTime(vol * 0.78, t + 0.25);
    const o1 = osc('sine', f, env);
    const o2 = osc('triangle', f, env, 0.16);
    const o3 = osc('sine', f * 2, env, 0.08);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = Math.min(9000, f * 2.2); bp.Q.value = 0.9;
    bp.connect(env);
    const n = noise(bp, 0.22);
    const lfo = vibrato([o1, o2, o3], f, 5.2, 0.007, 0.25);
    const nodes = [o1, o2, o3, n, lfo];
    nodes.forEach((x) => x.start(t));
    return finish(nodes, env, 0.12);
  }

  // Violin: sóng răng cưa lệch nhẹ qua bộ lọc thân đàn, rung tay khi kéo dài.
  function violin(m, vol) {
    const f = freq(m);
    const t = ctx.currentTime;
    const env = ctx.createGain();
    const body = ctx.createBiquadFilter();
    body.type = 'peaking'; body.frequency.value = 2800; body.Q.value = 1.2; body.gain.value = 5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = Math.min(9000, 2600 + f * 3); lp.Q.value = 0.7;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 180;
    lp.connect(body); body.connect(hp); hp.connect(env); env.connect(master);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol * 0.55, t + 0.09);
    env.gain.linearRampToValueAtTime(vol * 0.5, t + 0.3);
    const o1 = osc('sawtooth', f, lp, 0.5);
    const o2 = osc('sawtooth', f, lp, 0.5);
    o2.detune.value = 6; o1.detune.value = -4;
    const n = noise(lp, 0.035);
    const lfo = vibrato([o1, o2], f, 5.6, 0.009, 0.3);
    const nodes = [o1, o2, n, lfo];
    nodes.forEach((x) => x.start(t));
    return finish(nodes, env, 0.18);
  }

  const MAKERS = { piano, sao: flute, violin };

  window.Synth = {
    unlock() { try { audio(); } catch (e) { /* bỏ qua */ } },
    start(inst, midi, { vol = 0.32 } = {}) {
      try {
        audio();
        return (MAKERS[inst] || piano)(midi, vol);
      } catch (e) {
        return { stop() {} };
      }
    },
    // Phát một nốt có độ dài cố định (nghe mẫu, đoán nốt).
    play(inst, midi, dur, { vol = 0.32, at = 0 } = {}) {
      const go = () => { const v = this.start(inst, midi, { vol }); setTimeout(() => v.stop(), dur * 1000); };
      if (at > 0) setTimeout(go, at * 1000); else go();
    },
    // Tiếng “tích” của máy đếm nhịp.
    tick(high = false) {
      try {
        audio();
        const t = ctx.currentTime;
        const g = ctx.createGain();
        g.connect(master);
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
        const o = osc('square', high ? 1760 : 1100, g);
        o.start(t); o.stop(t + 0.07);
      } catch (e) { /* bỏ qua */ }
    },
    // Tiếng “rè” khi thổi sáo sai thế bấm.
    hiss() {
      try {
        audio();
        const t = ctx.currentTime;
        const g = ctx.createGain();
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 0.6;
        bp.connect(g); g.connect(master);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
        const n = noise(bp, 1);
        n.start(t);
        return finish([n], g, 0.1);
      } catch (e) { return { stop() {} }; }
    },
  };
})();
