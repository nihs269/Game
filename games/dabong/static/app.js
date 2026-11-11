(function () {
  const P = window.Platform;
  const $ = (s) => document.querySelector(s);
  const esc = P.esc;
  const ROOM = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (!ROOM) { location.href = '/'; return; }

  let S = null;          // trạng thái mới nhất từ máy chủ
  let conn = null;
  const ui = { lastSeq: null, tab: 'players', unread: 0, lastChatId: null, lanBase: null, sound: true };
  try { ui.sound = localStorage.getItem('dabong_sound') !== '0'; } catch (e) { /* bỏ qua */ }

  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
  };
  const LEVEL_NAMES = { easy: 'Dễ', normal: 'Vừa', hard: 'Khó' };

  // ---------------------------------------------------------------- tiện ích
  const bubbles = new window.ChatBubbles({ anchor: (pid) => anchorEl(pid) });
  const htmlCache = new Map();
  function setHTML(el, html) {
    if (!el || htmlCache.get(el) === html) return false;
    htmlCache.set(el, html);
    el.innerHTML = html;
    return true;
  }
  const player = (id) => (S && S.players.find((p) => p.id === id)) || null;
  const nm = (id) => { const p = player(id); return p ? p.name : '?'; };
  const who = (id) => (S && id === S.me.id ? 'Bạn' : esc(nm(id)));
  const send = (action, data) => conn && conn.send(action, data);
  const sendQuiet = (action, data) => conn && conn.sendRaw({ type: 'action', action, data });
  const fmtTime = (t) => new Date(t * 1000).toTimeString().slice(0, 5);
  const btn = (act, text, kind = '', extra = '') => `<button class="gh-btn ${kind}" data-act="${act}" ${extra}>${text}</button>`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sideColor = (pid) => (S && S.pair.includes(pid) ? S.colors[S.pair.indexOf(pid)] : null);
  let cast = null;
  function anchorEl(pid) {
    const a = cast && S && S.phase !== 'play' && cast.anchor(pid);
    if (a) return a;
    return document.querySelector(`#plist [data-pid="${CSS.escape(pid || '')}"] .ava`);
  }
  const rectOf = (el) => (el ? el.getBoundingClientRect() : null);

  // ---------------------------------------------------------------- âm thanh
  let actx = null;
  function beep(notes) {
    if (!ui.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      let t = actx.currentTime;
      notes.forEach(([freq, dur, type = 'sine', vol = 0.08, slide]) => {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(actx.destination);
        o.start(t); o.stop(t + dur);
        t += dur * 0.8;
      });
    } catch (e) { /* bỏ qua */ }
  }
  const SOUNDS = {
    kick: [[220, 0.06, 'square', 0.08, 90]],
    lob: [[300, 0.07, 'triangle', 0.07, 600]],
    swing: [[260, 0.08, 'sine', 0.025, 520]],
    bar: [[1200, 0.05, 'square', 0.05], [900, 0.25, 'triangle', 0.05, 850]],
    whistle: [[2200, 0.12, 'sine', 0.05], [2400, 0.25, 'sine', 0.05]],
    goal: [[523, 0.1, 'square', 0.06], [659, 0.1, 'square', 0.06], [784, 0.1, 'square', 0.06], [1047, 0.35, 'square', 0.06]],
    bad: [[440, 0.1, 'square', 0.05, 220], [330, 0.16, 'square', 0.05, 160]],
    win: [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]],
  };
  const play = (k) => beep(SOUNDS[k]);

  // ---------------------------------------------------------------- vật lý bóng (giống physics.step, không tính người)
  let W = null;
  function stepBall(b, dt) {
    let [x, y, vx, vy] = b;
    const R = W.R;
    vy -= W.G * dt;
    const k = 1 - W.AIR * dt;
    vx *= k; vy *= k;
    x += vx * dt; y += vy * dt;
    if (y - R <= 0) {
      y = R;
      if (vy < 0) { vy = -vy * W.REST; if (vy < 70) vy = 0; }
      vx *= Math.max(0, 1 - W.FRICTION * dt);
    }
    if (y + R > W.CEIL) { y = W.CEIL - R; vy = -Math.abs(vy) * W.REST_WALL; }
    if (x - R < 0) { x = R; vx = Math.abs(vx) * W.REST_WALL; } else if (x + R > W.W) { x = W.W - R; vx = -Math.abs(vx) * W.REST_WALL; }
    for (const [x0, x1] of [[0, W.GOAL_D], [W.W - W.GOAL_D, W.W]]) {
      const px = Math.min(Math.max(x, x0), x1);
      const dx = x - px; const dy = y - W.GOAL_H;
      const d2 = dx * dx + dy * dy;
      const rr = R + W.BAR;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-6;
        const nx = d2 > 1e-9 ? dx / d : 0; const ny = d2 > 1e-9 ? dy / d : 1;
        x = px + nx * rr; y = W.GOAL_H + ny * rr;
        const vn = vx * nx + vy * ny;
        if (vn < 0) { vx -= (1 + W.REST_BAR) * vn * nx; vy -= (1 + W.REST_BAR) * vn * ny; }
        if (ny > 0.9 && Math.abs(vx) < 40 && Math.abs(vy) < 80) vx += (x0 === 0 ? 1 : -1) * 160;
      }
    }
    b[0] = x; b[1] = y; b[2] = vx; b[3] = vy;
  }

  // ---------------------------------------------------------------- đồng hồ chung với máy chủ
  // serverNow() ≈ time.time() của máy chủ. Lấy mẫu từ mỗi gói tin; giữ mẫu lớn nhất gần đây (gói đến nhanh nhất).
  const clockSamples = [];
  let clockOff = null;
  function clockSample(serverTs) {
    clockSamples.push(serverTs - performance.now() / 1000);
    if (clockSamples.length > 120) clockSamples.shift();
    clockOff = Math.max(...clockSamples);
  }
  const serverNow = () => performance.now() / 1000 + (clockOff || 0);

  // ---------------------------------------------------------------- quả bóng
  // snap: gói tin mới nhất từ máy chủ; vẽ bóng bằng cách cho bóng bay tiếp từ gói đó tới hiện tại, sai lệch thì kéo dần về.
  let snap = null;            // { ts, b: [x, y, vx, vy], kn }
  const disp = { x: 600, y: 400, vx: 0, vy: 0, spin: 0, ok: false };
  let timeLeft = 0;
  function ballNow(now) {
    if (!snap) return null;
    const b = snap.b.slice();
    if (S.rstate === 'kickoff') return b;
    let t = clamp(now - snap.ts, 0, 0.15);
    while (t > 1e-4) { const d = Math.min(1 / 120, t); stepBall(b, d); t -= d; }
    return b;
  }

  // ---------------------------------------------------------------- người của mình
  const keys = { left: false, right: false };
  let me = null;   // { kn, x, y, vx, vy, face, kickAt, kind, lastSent, s }
  const onCourt = () => S && S.phase === 'play' && S.me.court;
  function resetMe() {
    const sp = S.spawn[S.me.id];
    me = { kn: S.kickNo, x: sp ? sp[0] : 300, y: 0, vx: 0, vy: 0, face: sp ? sp[1] : 1, kickAt: null, kind: '', lastSent: 0, s: 'idle' };
  }
  function jump() {
    if (!onCourt() || !me || me.y > 0 || S.rstate === 'kickoff') return;
    me.vy = W.JUMP;
  }
  function doKick(kind) {
    if (!onCourt() || !me || S.rstate !== 'play') return;
    const now = serverNow();
    if (me.kickAt !== null && now - me.kickAt < W.KICK) return;
    me.kickAt = now; me.kind = kind;
    play('swing');
    sendQuiet('boot', { kind });
  }
  function opponentPos(now) {
    const o = S.pair.find((p) => p !== S.me.id);
    return o ? remotePos(o, now) : null;
  }
  function stepMe(dt, now) {
    const run = S.rstate === 'kickoff' ? 0 : (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    me.vx = run * W.SPEED;
    let nx = clamp(me.x + me.vx * dt, W.PX_MIN, W.PX_MAX);
    // Không chạy xuyên qua đối thủ khi cả hai ở dưới đất.
    const op = opponentPos(now);
    if (op && me.y < 40 && op.y < 40 && Math.abs(nx - op.x) < W.BLOCK && Math.abs(nx - op.x) < Math.abs(me.x - op.x)) nx = me.x;
    me.x = nx;
    if (me.y > 0 || me.vy > 0) {
      me.vy -= W.PG * dt;
      me.y += me.vy * dt;
      if (me.y <= 0) { me.y = 0; me.vy = 0; }
    }
    if (me.kickAt !== null && now - me.kickAt > W.KICK) me.kickAt = null;
    me.s = me.kickAt !== null ? 'kick' : me.y > 0 ? 'jump' : run ? 'run' : 'idle';
    if (performance.now() - me.lastSent > 33) {
      me.lastSent = performance.now();
      sendQuiet('pos', {
        kn: me.kn, ts: now, x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, vx: Math.round(me.vx), vy: Math.round(me.vy),
        s: me.s, k: me.kickAt !== null ? me.kind : '', e: me.kickAt !== null ? Math.round((now - me.kickAt) * 1000) / 1000 : 0,
      });
    }
  }

  // ---------------------------------------------------------------- gói tin sân bóng (60 lần/giây)
  const remote = new Map();   // pid → [{t, x, y, s, k, e}]
  let pitchKn = null;
  function onPitch(m) {
    if (!S || m.g !== S.matchNo) return;
    clockSample(m.ts);
    if (pitchKn !== m.kn) { pitchKn = m.kn; remote.clear(); disp.ok = false; }
    snap = { ts: m.ts, b: m.b, kn: m.kn };
    timeLeft = m.tl;
    for (const [pid, v] of Object.entries(m.p)) {
      let buf = remote.get(pid);
      if (!buf) { buf = []; remote.set(pid, buf); }
      const [x, y, s, k, e, t] = v;
      if (buf.length && t <= buf[buf.length - 1].t) continue;
      buf.push({ t, x, y, s, k, e });
      if (buf.length > 40) buf.shift();
    }
  }
  function remotePos(pid, now) {
    const buf = remote.get(pid);
    if (!buf || !buf.length) {
      const sp = S.spawn && S.spawn[pid];
      return sp ? { x: sp[0], y: 0, s: 'idle', k: '', e: 0 } : null;
    }
    const rt = now - 0.05;
    let a = buf[0];
    if (rt <= a.t) return a;
    for (let i = 1; i < buf.length; i++) {
      const b = buf[i];
      if (rt <= b.t) {
        const f = (rt - a.t) / (b.t - a.t || 1);
        const e = a.k && b.k === a.k ? a.e + (b.e - a.e) * f : b.e;
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, s: f < 0.5 ? a.s : b.s, k: f < 0.5 ? a.k : b.k, e };
      }
      a = b;
    }
    const last = buf[buf.length - 1];
    return last.k ? { ...last, e: last.e + Math.min(0.3, rt - last.t) } : last;
  }

  // ---------------------------------------------------------------- vẽ
  const cv = $('#cv');
  const ctx = cv.getContext('2d');
  const VIEW_W = 1240;      // bề ngang thế giới hiển thị (sân 1200 + lề)
  const FLOOR = 70;         // phần cỏ dưới mặt sân (đơn vị thế giới)
  let view = { s: 1, dpr: 1, cssW: 0, cssH: 0, h: 600 };
  function resize() {
    const r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    const s = r.width / VIEW_W;
    view = { s, dpr, cssW: r.width, cssH: r.height, h: r.height / s };
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(cv);
  window.addEventListener('resize', resize);

  const FONT = '"Baloo 2", "Be Vietnam Pro", system-ui, sans-serif';
  if (document.fonts) document.fonts.load('800 20px "Baloo 2"').catch(() => {});
  const X = (x) => x + (VIEW_W - 1200) / 2;
  const Y = (y) => view.h - FLOOR - y;
  const rad = (a) => a * Math.PI / 180;

  function roundRect(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // Ảnh nhân vật (SVG của Avatar → ảnh) để vẽ lên canvas.
  const avaCache = new Map();
  function avatarImg(p) {
    const key = p.id + JSON.stringify(p.look || {});
    let img = avaCache.get(key);
    if (!img) {
      img = new Image();
      // ảnh bộ phận phải nhúng thẳng vào SVG thì mới vẽ được lên canvas
      window.Avatar.svgInline(p.look, { seed: p.id }).then((s) => {
        s = s.replace(/(<svg[^>]*>)/, '$1<style>.av-ec,.av-ew,.av-mo,.av-md,.av-tears,.av-shadow{display:none}</style>');
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
      });
      avaCache.set(key, img);
    }
    return img;
  }

  function drawStadium() {
    const H = view.h;
    const g = ctx.createLinearGradient(0, 0, 0, Y(0));
    g.addColorStop(0, '#0d1630'); g.addColorStop(0.6, '#1b2c55'); g.addColorStop(1, '#2b4377');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, H);
    // cột đèn sân vận động
    [[90, 40], [VIEW_W - 90, 40]].forEach(([lx, ly]) => {
      const lg = ctx.createRadialGradient(lx, ly, 4, lx, ly, 330);
      lg.addColorStop(0, 'rgba(255,250,220,.4)'); lg.addColorStop(1, 'rgba(255,250,220,0)');
      ctx.fillStyle = lg; ctx.fillRect(lx - 330, 0, 660, 380);
      ctx.fillStyle = '#fffbe6';
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { ctx.beginPath(); ctx.arc(lx - 16 + i * 16, ly - 6 + j * 12, 5, 0, 7); ctx.fill(); }
    });
    // khán đài
    const boardY = Y(0) - 40;
    const standY = boardY - 150;
    ctx.fillStyle = 'rgba(8,12,30,.5)';
    ctx.fillRect(0, standY, VIEW_W, 150);
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 44; i++) {
        const px = 12 + i * 28.5 + (row % 2) * 14;
        const py = standY + 18 + row * 34;
        const side = px < VIEW_W / 2 ? 0 : 1;
        ctx.fillStyle = (i + row) % 3 === 0 ? (S && S.colors ? S.colors[side] : '#888') + '66' : `hsla(${(i * 47 + row * 90) % 360},30%,60%,.25)`;
        ctx.beginPath(); ctx.arc(px, py, 7, 0, 7); ctx.fill();
        roundRect(px - 9, py + 7, 18, 16, 6); ctx.fill();
      }
    }
    // bảng quảng cáo
    ctx.fillStyle = '#123a7a'; ctx.fillRect(0, boardY, VIEW_W, 40);
    ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(0, boardY, VIEW_W, 3);
    ctx.font = `800 18px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    for (let i = 0; i < 4; i++) ctx.fillText('⚽ GAME HUB CUP', 160 + i * 310, boardY + 21);
    // cỏ: sọc đậm nhạt
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 ? '#2f9a4a' : '#36a853';
      ctx.fillRect(X(i * 100), Y(0), 100, FLOOR + 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.fillRect(0, Y(0) + FLOOR * 0.55, VIEW_W, FLOOR);
    // vạch giữa sân + vòng tròn giữa sân (nhìn nghiêng thành hình elip dẹt)
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(X(600), Y(0)); ctx.lineTo(X(600), Y(0) + FLOOR); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(X(600), Y(0) + 26, 110, 18, 0, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(0, Y(0), VIEW_W, 3);
  }

  function drawGoal(side, front) {
    const x0 = side === 0 ? 0 : W.W - W.GOAL_D;
    const x1 = x0 + W.GOAL_D;
    const mouth = side === 0 ? x1 : x0;
    const back = side === 0 ? x0 : x1;
    const top = Y(W.GOAL_H); const base = Y(0);
    if (!front) {
      // lưới phía sau
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fillRect(X(Math.min(x0, x1)), top, W.GOAL_D, base - top);
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
      for (let yy = top; yy <= base; yy += 14) { ctx.beginPath(); ctx.moveTo(X(x0), yy); ctx.lineTo(X(x1), yy); ctx.stroke(); }
      for (let xx = x0; xx <= x1; xx += 14) { ctx.beginPath(); ctx.moveTo(X(xx), top); ctx.lineTo(X(xx), base); ctx.stroke(); }
      ctx.strokeStyle = '#dfe6f2'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(X(back), base); ctx.lineTo(X(back), top); ctx.stroke();
      return;
    }
    // cột dọc phía trước + xà ngang
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 * W.BAR + 1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(X(back), top); ctx.lineTo(X(mouth), top); ctx.stroke();
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(X(mouth), base); ctx.lineTo(X(mouth), top); ctx.stroke();
    ctx.lineCap = 'butt';
  }

  function legAngle(st) {
    // góc chân sút (độ, so với phương thẳng đứng hướng xuống, dương = vung ra trước)
    if (st.k && st.e !== undefined && st.e <= W.KICK) {
      const u = clamp(st.e / W.KICK, 0, 1);
      return u < 0.25 ? -35 * (u / 0.25) : -35 + 130 * Math.min(1, (u - 0.25) / 0.35);
    }
    return 0;
  }
  function drawPlayer(p, st, face, color, isMe, now) {
    const x = X(st.x); const y = Y(st.y);
    const bob = st.s === 'run' ? Math.abs(Math.sin(now * 14)) * 4 : 0;
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    const sh = clamp(1 - st.y / 300, 0.4, 1);
    ctx.beginPath(); ctx.ellipse(x, Y(0) + 4, 34 * sh, 7 * sh, 0, 0, 7); ctx.fill();
    const img = avatarImg(p);
    const h = 132;
    if (img.complete && img.naturalWidth) {
      const w = h * (100 / 166);
      ctx.drawImage(img, x - w / 2, y - h - bob + 10, w, h);
    } else {
      ctx.fillStyle = color; roundRect(x - 18, y - 110, 36, 110, 16); ctx.fill();
    }
    // chân sút + giày màu đội
    const a = rad(legAngle(st));
    if (st.k) {
      const hx = x + face * 6; const hy = y - 40 - bob;
      const fx = hx + Math.sin(a) * 44 * face; const fy = hy + Math.cos(a) * 44;
      ctx.strokeStyle = '#f2c9a0'; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.fillStyle = color; ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(fx + face * 6, fy, 12, 7, a * face * -0.6, 0, 7); ctx.fill(); ctx.stroke();
    }
    // áo đấu: dải màu đội trên ngực
    ctx.fillStyle = color + 'cc';
    roundRect(x - 13, y - 49 - bob, 26, 7, 3); ctx.fill();
    ctx.font = `800 14px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const label = isMe ? 'Bạn' : p.name;
    const tw = ctx.measureText(label).width + 18;
    const ly = y - h - 20 - bob;
    ctx.fillStyle = 'rgba(12,16,34,.75)'; roundRect(x - tw / 2, ly - 11, tw, 22, 11); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillText(label, x, ly + 1);
  }

  // Quả bóng: trắng với các mảng ngũ giác đen, xoay theo quãng đường lăn.
  function drawBall(bx, by, spin) {
    const R = W.R;
    const x = X(bx); const y = Y(by);
    ctx.fillStyle = `rgba(0,0,0,${0.35 * clamp(1 - by / 600, 0.2, 1)})`;
    ctx.beginPath(); ctx.ellipse(x, Y(0) + 3, R * 0.9, 4, 0, 0, 7); ctx.fill();
    if (y < 14) {
      ctx.fillStyle = '#ffe66d'; ctx.strokeStyle = '#3b2a63'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x - 10, 24); ctx.lineTo(x + 10, 24); ctx.closePath(); ctx.stroke(); ctx.fill();
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 7);
    const g = ctx.createRadialGradient(-7, -8, 3, 0, 0, R);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#cfd6e2');
    ctx.fillStyle = g; ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.rotate(spin);
    ctx.fillStyle = '#1d2233';
    const patch = (px, py, r) => {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const t = -Math.PI / 2 + i * (Math.PI * 2 / 5);
        ctx[i ? 'lineTo' : 'moveTo'](px + Math.cos(t) * r, py + Math.sin(t) * r);
      }
      ctx.closePath(); ctx.fill();
    };
    patch(0, 0, 7.5);
    for (let i = 0; i < 5; i++) {
      const t = -Math.PI / 2 + i * (Math.PI * 2 / 5);
      patch(Math.cos(t) * 19, Math.sin(t) * 19, 6);
    }
    ctx.restore();
    ctx.strokeStyle = '#2a3046'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke();
    ctx.restore();
  }

  function hudText(text, x, y, size, align = 'center', color = '#fff') {
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, size / 4.5); ctx.strokeStyle = '#0c1430';
    ctx.strokeText(text, x, y + Math.max(2, size / 16));
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  const fx = { shake: 0, flash: 0 };
  const feed = [];
  function pushFeed(text, color) {
    feed.push({ text, color, at: performance.now() });
    if (feed.length > 20) feed.shift();
  }

  let lastFrame = performance.now();
  function frame() {
    requestAnimationFrame(frame);
    const wall = performance.now();
    const dt = Math.min(0.05, (wall - lastFrame) / 1000);
    lastFrame = wall;
    if (!S || S.phase !== 'play' || !W || $('#arena').hidden) return;
    if (!view.cssW) resize();
    if (!view.cssW) return;
    const now = serverNow();
    if (onCourt()) {
      if (!me || me.kn !== S.kickNo) resetMe();
      stepMe(dt, now);
    }
    ctx.setTransform(view.dpr * view.s, 0, 0, view.dpr * view.s, 0, 0);
    if (wall - fx.shake < 300) {
      const k = (1 - (wall - fx.shake) / 300) * 7;
      ctx.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    }
    drawStadium();
    drawGoal(0, false); drawGoal(1, false);
    // người chơi
    S.pair.forEach((pid, i) => {
      const p = player(pid) || { id: pid, name: '?', look: null };
      const face = i === 0 ? 1 : -1;
      let st;
      if (pid === S.me.id && me && onCourt()) {
        st = { x: me.x, y: me.y, s: me.s, k: me.kickAt !== null ? me.kind : '', e: me.kickAt !== null ? now - me.kickAt : 0 };
      } else {
        st = remotePos(pid, now);
      }
      if (st) drawPlayer(p, st, face, S.colors[i], pid === S.me.id, wall / 1000);
    });
    // bóng
    const b = ballNow(now);
    if (b) {
      if (!disp.ok || Math.hypot(b[0] - disp.x, b[1] - disp.y) > 140) { disp.x = b[0]; disp.y = b[1]; disp.ok = true; }
      const k = Math.min(1, dt * 22);
      const ox = disp.x;
      disp.x += (b[0] - disp.x) * k; disp.y += (b[1] - disp.y) * k;
      disp.spin += (disp.x - ox) / W.R;
      drawBall(disp.x, disp.y, disp.spin);
    }
    drawGoal(0, true); drawGoal(1, true);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    drawHud(now, wall);
  }
  requestAnimationFrame(frame);

  const fmtClock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  function drawHud(now, wall) {
    const w = view.cssW; const h = view.cssH;
    if (wall - fx.flash < 260) {
      ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - (wall - fx.flash) / 260)})`;
      ctx.fillRect(0, 0, w, h);
    }
    const [a, b] = S.pair;
    if (a && b) {
      const sa = (S.score || {})[a] || 0; const sb = (S.score || {})[b] || 0;
      const sz = w < 560 ? 15 : 18;
      const name = (pid) => { const t = pid === S.me.id ? 'Bạn' : nm(pid); return t.length > 12 ? t.slice(0, 11) + '…' : t; };
      hudText(name(a), w / 2 - 60, 26, sz, 'right', S.colors[0]);
      hudText(name(b), w / 2 + 60, 26, sz, 'left', S.colors[1]);
      hudText(`${sa} – ${sb}`, w / 2, 28, sz + 12);
      const tl = S.rstate === 'kickoff' && !snap ? S.timeLeft : timeLeft;
      hudText(S.golden ? '⚡ BÀN THẮNG VÀNG' : `⏱ ${fmtClock(Math.ceil(tl))}`, w / 2, 58, 14, 'center', S.golden || tl <= 10 ? '#ffe66d' : '#cfd8ff');
    }
    for (let k = feed.length - 1, shown = 0; k >= 0 && shown < 3; k--) {
      const f = feed[k];
      const age = (wall - f.at) / 1000;
      if (age > 3) continue;
      ctx.globalAlpha = clamp(3 - age, 0, 1);
      hudText(f.text, w - 12, h - 20 - shown * 22, 14, 'right', f.color || '#fff');
      ctx.globalAlpha = 1;
      shown++;
    }
    const mid = h * 0.34;
    if (S.rstate === 'kickoff') {
      const left = S.rUntil - now;
      const fresh = Object.values(S.score || {}).every((v) => !v);
      if (fresh && left > 1.3) hudText('VÀO TRẬN!', w / 2, mid, 46, 'center', '#ffe66d');
      else hudText(`${S.taker === S.me.id ? 'Bạn' : nm(S.taker)} giao bóng`, w / 2, mid, w < 560 ? 18 : 24, 'center', '#cfd8ff');
    } else if (S.rstate === 'goal') {
      hudText('VÀOOO! ⚽', w / 2, mid, w < 560 ? 40 : 60, 'center', '#ffe66d');
      hudText(`${S.scorer === S.me.id ? 'Bạn' : nm(S.scorer)} ghi bàn`, w / 2, mid + 46, w < 560 ? 16 : 20, 'center', sideColor(S.scorer) || '#fff');
    } else if (S.rstate === 'over' && S.winner) {
      hudText(`🏆 ${S.winner === S.me.id ? 'Bạn' : nm(S.winner)} thắng trận!`, w / 2, mid, w < 560 ? 26 : 38, 'center', '#ffe66d');
    }
    if (!S.me.court) hudText('👀 Đang xem — tới lượt bạn sẽ được vào sân', w / 2, h - 22, 14);
  }

  // ---------------------------------------------------------------- điều khiển
  const KEYMAP = {
    a: 'left', A: 'left', ArrowLeft: 'left', d: 'right', D: 'right', ArrowRight: 'right',
    w: 'jump', W: 'jump', ArrowUp: 'jump', ' ': 'jump',
    j: 'shoot', J: 'shoot', z: 'shoot', Z: 'shoot',
    k: 'lob', K: 'lob', x: 'lob', X: 'lob',
  };
  function press(act, down) {
    if (act === 'left' || act === 'right') { keys[act] = down; return; }
    if (!down) return;
    if (act === 'jump') jump();
    else doKick(act);
  }
  document.addEventListener('keydown', (e) => {
    if ((e.target.closest && e.target.closest('input, textarea, select')) || !S || S.phase !== 'play') return;
    const act = KEYMAP[e.key];
    if (!act) return;
    e.preventDefault();
    if (e.repeat && act !== 'left' && act !== 'right') return;
    press(act, true);
  });
  document.addEventListener('keyup', (e) => {
    const act = KEYMAP[e.key];
    if (act === 'left' || act === 'right') keys[act] = false;
  });
  window.addEventListener('blur', () => { keys.left = keys.right = false; });
  document.querySelectorAll('#pad [data-key]').forEach((b) => {
    const act = b.dataset.key;
    const on = (e) => { e.preventDefault(); b.classList.add('on'); press(act, true); };
    const off = (e) => { e.preventDefault(); b.classList.remove('on'); press(act, false); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('pointerleave', off);
  });
  const touchDevice = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  // ---------------------------------------------------------------- kết nối
  function connect() {
    conn = P.connect({
      room: ROOM,
      onState,
      onFx,
      onMessage,
      onStatus: (on) => $('#conn').classList.toggle('off', !on),
      onFatal: (m) => P.showFatal(m, { onRetryName: () => connect() }),
    });
  }

  function onMessage(m) {
    if (m.type === 'pitch') onPitch(m);
  }

  function onState(state) {
    S = state;
    if (!W && S.world) W = S.world;
    if (clockOff === null) clockSample(S.now);
    if (S.phase === 'play' && !snap) { snap = { ts: S.now, b: S.ball, kn: S.kickNo }; timeLeft = S.timeLeft; }
    const events = state.events || [];
    let fresh = [];
    if (ui.lastSeq === null) ui.lastSeq = events.length ? events[events.length - 1].seq : 0;
    else fresh = events.filter((e) => e.seq > ui.lastSeq);
    if (events.length) ui.lastSeq = Math.max(ui.lastSeq, events[events.length - 1].seq);
    render();
    fresh.forEach(playEvent);
  }

  const short = (id) => (S && id === S.me.id ? 'Bạn' : nm(id));

  function playEvent(e) {
    switch (e.type) {
      case 'kick':
        play(e.shot === 'lob' ? 'lob' : 'kick');
        break;
      case 'bar':
        play('bar');
        pushFeed('🥅 Trúng xà!', '#ffe66d');
        break;
      case 'play':
        play('whistle');
        break;
      case 'goal': {
        const mine = S.me.court && e.pid === S.me.id;
        const conceded = S.me.court && e.pid !== S.me.id;
        play(conceded ? 'bad' : 'goal');
        fx.flash = performance.now(); fx.shake = performance.now();
        pushFeed(`⚽ ${short(e.pid)} ghi bàn${e.golden ? ' — BÀN THẮNG VÀNG' : ''}!`, sideColor(e.pid) || '#fff');
        if (mine || !S.me.court) bubble(e.pid, '⚽', 'emoji');
        break;
      }
      case 'golden':
        play('whistle');
        pushFeed('⚡ Hoà — bàn thắng vàng!', '#ffe66d');
        break;
      case 'fulltime':
        play('whistle');
        break;
      case 'win':
        play('win');
        if (e.pid) { bubble(e.pid, '🏆', 'emoji'); if (cast) cast.react(e.pid, 'cheer'); }
        break;
      case 'forfeit':
        pushFeed(`📴 ${short(e.pid)} bỏ cuộc`, '#ffb3b3');
        break;
      default:
    }
  }

  // ---------------------------------------------------------------- hiệu ứng tương tác
  function bubble(pid, text, cls = '') {
    const r = rectOf(anchorEl(pid));
    if (!r) return;
    const el = document.createElement('div');
    el.className = 'bubble ' + cls;
    el.textContent = text;
    el.style.left = (r.left + r.width / 2) + 'px';
    el.style.top = (r.top + 2) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1900);
  }
  function fly(html, from, to, { dur = 550 } = {}) {
    if (!from || !to) return;
    const el = document.createElement('div');
    el.className = 'flyer';
    el.innerHTML = html;
    el.style.left = '0px'; el.style.top = '0px'; el.style.opacity = '0';
    document.body.appendChild(el);
    const w = el.offsetWidth; const h = el.offsetHeight;
    const anim = el.animate([
      { transform: `translate(${from.left + from.width / 2 - w / 2}px, ${from.top + from.height / 2 - h / 2}px) scale(.7)`, opacity: 1 },
      { transform: `translate(${to.left + to.width / 2 - w / 2}px, ${to.top + to.height / 2 - h / 2}px) scale(1)`, opacity: 1 },
    ], { duration: dur, easing: 'cubic-bezier(.3,.8,.3,1)', fill: 'forwards' });
    anim.onfinish = () => el.remove();
  }
  function onFx(m) {
    const emoji = FX_EMOJI[m.kind] || '✨';
    if (m.to && m.to !== m.from) {
      fly(`<span style="font-size:30px">${emoji}</span>`, rectOf(anchorEl(m.from)), rectOf(anchorEl(m.to)));
      setTimeout(() => bubble(m.to, emoji, 'emoji'), 520);
    } else {
      bubble(m.from, emoji, 'emoji');
    }
  }

  // ---------------------------------------------------------------- banner, nhân vật, danh sách
  function renderBanner() {
    const el = $('#banner');
    let big = '⚽';
    let title = '';
    let sub = '';
    let cls = 'gbanner';
    if (S.phase === 'lobby') {
      title = 'Phòng chờ';
      sub = `${S.players.length}/${S.maxPlayers} người · ${S.me.host ? 'bạn là chủ phòng — chỉnh luật rồi bấm Ra sân bên dưới (chơi một mình thì thêm bot)' : 'đang chờ chủ phòng bắt đầu…'}`;
    } else if (S.phase === 'end') {
      big = S.last && S.last.winner ? '🏆' : '🏁'; cls += ' win';
      title = S.last && S.last.winner ? `${who(S.last.winner)} thắng!` : S.last && !S.last.aborted ? 'Hoà!' : 'Trận đấu dừng';
      sub = `Trận ${S.matchNo} kết thúc — ${S.queue.length > 2 ? 'người thắng giữ sân, người tiếp theo vào đánh.' : 'đánh tiếp trận mới nào!'}`;
    } else {
      const [a, b] = S.pair;
      title = `Trận ${S.matchNo}: ${who(a)} ⚔️ ${who(b)}`;
      if (!S.me.court) sub = '👀 Bạn đang xem — người thắng giữ sân, tới lượt bạn sẽ được vào.';
      else sub = touchDevice ? 'Dùng các nút trên màn hình · nhảy lên để đánh đầu' : 'A/D chạy · W/Space nhảy (đánh đầu) · J sút căng · K lốp bóng';
      cls += S.me.court ? ' mine' : '';
    }
    el.className = cls;
    setHTML(el, `<div class="big">${big}</div><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div></div>`);
  }

  function renderCast() {
    if (!cast) cast = new window.Cast($('#cast'), { onClick: (pid, el) => openMenu(pid, el) });
    $('#cast').hidden = S.phase === 'play';
    if (S.phase === 'play') return;
    cast.update(S.players.map((p) => ({
      id: p.id, name: p.name, look: p.look, bot: p.bot, me: p.id === S.me.id, color: sideColor(p.id),
      turn: S.phase === 'end' && S.queue[0] === p.id, dim: !p.connected,
      sub: p.w || p.l ? `🏆 ${p.w} · ❌ ${p.l}` : (p.host ? '👑 chủ phòng' : ''),
      badge: S.phase === 'end' && S.last && S.last.winner === p.id ? '🏆' : '',
    })));
  }

  function renderPlayers() {
    const html = S.players.map((p) => {
      const tags = [p.bot ? '🤖' : '', p.host ? '👑' : '', p.streak >= 2 ? `🔥${p.streak}` : '', p.connected ? '' : '📴'].filter(Boolean).join(' ');
      let sub;
      if (S.phase === 'play' && p.court) sub = p.side === 0 ? '⬅️ Giữ khung thành trái' : '➡️ Giữ khung thành phải';
      else if (S.phase === 'play') sub = `⏳ Hàng chờ #${(S.queue.indexOf(p.id) - 1)}`;
      else sub = p.w || p.l ? `🏆 ${p.w} thắng · ❌ ${p.l} thua · ⚽ ${p.goals} bàn` : 'Sẵn sàng';
      const score = S.phase === 'play' && p.court ? `<div class="sc">${(S.score || {})[p.id] || 0}<small>bàn</small></div>` : '';
      return `<div class="pcard" style="--pc:${sideColor(p.id) || 'transparent'}" data-pid="${esc(p.id)}">
        <div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>
        <div class="pn"><b>${p.id === S.me.id ? 'Bạn' : esc(p.name)} ${tags}</b><span>${sub}</span></div>${score}</div>`;
    }).join('');
    setHTML($('#plist'), html);
  }

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const inviteLink = () => `${ui.lanBase || location.origin}/g/dabong/?room=${ROOM}`;
  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    return `<div class="panel"><h3><span class="grow">🤖 Người chơi ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Một mình? Thêm bot làm đối thủ — bot cũng chạy, đánh đầu, sút và lốp bóng!</p>
      <div class="btns-row">${btn('add-bot', '＋ 1 bot', 'small', n >= S.maxPlayers ? 'disabled' : '')}
        ${bots ? btn('remove-bots', '🗑 Xoá hết bot', 'small ghost') : ''}</div></div>`;
  }
  function settingsPanel() {
    const dis = S.me.host ? '' : 'disabled';
    const cfg = S.config;
    return `<div class="panel"><h3>⚙️ Luật chơi</h3><div class="settings">
      <div class="setting"><label>⏱ Thời gian trận</label><select data-cfg="time" ${dis}>
        ${S.timesOpt.map((v) => `<option value="${v}" ${v === cfg.time ? 'selected' : ''}>${v} giây</option>`).join('')}</select></div>
      <div class="setting"><label>🎯 Thắng sớm khi ghi đủ</label><select data-cfg="goals" ${dis}>
        ${S.goalsOpt.map((v) => `<option value="${v}" ${v === cfg.goals ? 'selected' : ''}>${v ? `${v} bàn` : 'Không — đá hết giờ'}</option>`).join('')}</select></div>
      <div class="setting"><label>🤖 Độ khó của bot</label><select data-cfg="bot_level" ${dis}>
        ${S.botLevels.map((v) => `<option value="${v}" ${v === cfg.bot_level ? 'selected' : ''}>${LEVEL_NAMES[v]}</option>`).join('')}</select></div>
    </div></div>`;
  }
  function keysPanel() {
    return `<div class="panel"><h3>🕹️ Điều khiển</h3><div class="keys">
      <span><kbd>A</kbd> <kbd>D</kbd> / <kbd>←</kbd> <kbd>→</kbd> <b>Chạy</b></span>
      <span><kbd>W</kbd> / <kbd>↑</kbd> / <kbd>Space</kbd> <b>Nhảy</b></span>
      <span><kbd>J</kbd> / <kbd>Z</kbd> <b>Sút căng</b> (thấp, mạnh)</span>
      <span><kbd>K</kbd> / <kbd>X</kbd> <b>Lốp bóng</b> (vồng qua đầu)</span>
      <span>Nhảy lên <b>đánh đầu</b> · bóng chạm người cũng bật ra</span>
    </div></div>`;
  }
  function queuePanel() {
    const list = S.queue.map((pid, i) => {
      const p = player(pid);
      if (!p) return '';
      return `<span class="q ${i < 2 ? 'court' : ''}"><span class="n">${i < 2 ? '⚽' : i - 1}</span>${pid === S.me.id ? 'Bạn' : esc(p.name)}${p.bot ? ' 🤖' : ''}</span>`;
    }).join('');
    return `<div class="panel"><h3>🏟️ Thứ tự ra sân</h3><p class="gh-muted" style="margin:0 0 10px;font-size:13px">2 người đầu ra sân đá. Người thắng giữ sân, người thua xuống cuối hàng.</p><div class="queue">${list}</div></div>`;
  }
  function renderPanel() {
    const el = $('#panel');
    if (S.phase === 'play') { setHTML(el, ''); return; }
    const host = S.me.host;
    let html;
    if (S.phase === 'end' && S.last) {
      const L = S.last;
      const rows = [L.a, L.b].map((pid) => {
        const p = player(pid) || { name: '?' };
        const goals = (L.goals || []).filter((g) => g.by === pid).map((g) => `⚽ ${g.golden ? 'vàng' : `${g.at}″`}`).join(' ');
        return `<div class="res-row ${pid === L.winner ? 'win' : ''}"><span class="rank">${pid === L.winner ? '🏆' : ''}</span>
          <span class="rname">${pid === S.me.id ? 'Bạn' : esc(p.name)}${p.bot ? ' 🤖' : ''}</span>
          <div class="rcards"><span class="gh-muted">${goals || '—'} · 🦶 ${(L.shots || {})[pid] || 0} cú sút</span></div>
          <span class="rpts">${(L.score || {})[pid] || 0}<small>bàn</small></span></div>`;
      }).join('');
      const head = L.winner ? `${esc(nm(L.winner))}${L.winner === S.me.id ? ' (bạn)' : ''} thắng!` : L.aborted ? 'Trận đấu bị dừng' : 'Hoà!';
      html = `<div class="panel"><div class="result-head"><div class="trophy">${L.winner ? '🏆' : '🏁'}</div><div>
          <h2>${head}</h2><p>Trận ${L.no} · ${(L.score || {})[L.a] || 0}–${(L.score || {})[L.b] || 0}.</p></div></div>
        <div class="results">${rows}</div>
        <div class="start-row" style="margin-top:14px">${host
          ? `${btn('lobby', '🏠 Về phòng chờ', 'ghost')}${btn('next', '⚽ Trận tiếp theo', 'primary', S.players.length < 2 ? 'disabled' : '')}`
          : '<span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu trận mới…</span>'}</div></div>${queuePanel()}${host ? botPanel() + settingsPanel() : ''}`;
    } else {
      const start = host
        ? `<div class="start-row"><div><span class="gh-muted">${S.players.length}/${S.maxPlayers} người${S.players.length < 2 ? ' — cần 2 người, thêm bot nhé!' : ' — sẵn sàng!'}</span></div>
           ${btn('start', '⚽ Ra sân', 'primary', S.players.length < 2 ? 'disabled' : '')}</div>`
        : '<div class="start-row"><span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu…</span></div>';
      html = `<div class="panel"><h3>📨 Mời bạn bè</h3><div class="invite"><div class="bigcode">${ROOM}</div><div class="link">${esc(inviteLink())}</div>
          ${btn('copy-link', '⧉ Sao chép link', 'small')} ${btn('edit-look', '👗 Đổi nhân vật', 'small')}</div></div>
        ${host ? botPanel() : ''}${settingsPanel()}${S.players.length > 2 ? queuePanel() : ''}${keysPanel()}<div class="panel">${start}</div>`;
    }
    setHTML(el, html);
  }

  function renderArena() {
    const arena = $('#arena');
    const show = S.phase === 'play';
    if (arena.hidden === show) { arena.hidden = !show; if (show) requestAnimationFrame(resize); }
    $('#pad').hidden = !(show && S.me.court && touchDevice);
  }

  // ---------------------------------------------------------------- biểu cảm & menu người chơi
  const SELF_FX = [['laugh', 'Cười'], ['angry', 'Tức'], ['cry', 'Khóc'], ['shock', 'Sốc'], ['think', 'Nghĩ'], ['clap', 'Vỗ tay'], ['dance', 'Nhảy']];
  const OTHER_FX = [['wave', 'Vẫy tay'], ['heart', 'Thả tim'], ['flower', 'Tặng hoa'], ['tomato', 'Ném cà chua'], ['highfive', 'Đập tay'], ['poke', 'Chọc']];
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function renderEmotes() {
    setHTML($('#emotes'), SELF_FX.map(([k, l]) => `<button class="emo" data-fx="${k}" data-self="1" title="${l}">${FX_EMOJI[k]}</button>`).join('')
      + btn('edit-look', '👗 Nhân vật', 'small')
      + (S && S.me.host && S.phase === 'play' ? btn('stop', '🛑 Dừng trận', 'small ghost') : '')
      + '<span class="hint">Nhấn vào người chơi khác để vẫy tay, ném cà chua…</span>');
  }
  function openMenu(id, anchor) {
    closeMenu();
    const p = player(id);
    if (!p) return;
    const mine = id === S.me.id;
    let html = `<div class="pmenu-head">${mine ? '🙋 Bạn' : esc(p.name)}${p.bot ? ' 🤖' : ''}</div>
      <div class="pmenu-grid">${(mine ? SELF_FX : OTHER_FX).map(([k, l]) => `<button data-fx="${k}"><span>${FX_EMOJI[k]}</span>${l}</button>`).join('')}</div>`;
    if (mine) html += btn('edit-look', '👗 Đổi nhân vật', 'small');
    if (!mine && S.me.host && !(S.phase === 'play' && p.court)) html += `<button class="gh-btn small danger" data-kick="${esc(id)}">${p.bot ? '🗑 Xoá bot' : '🚪 Mời ra khỏi phòng'}</button>`;
    menuEl = document.createElement('div');
    menuEl.className = 'pmenu';
    menuEl.innerHTML = html;
    document.body.appendChild(menuEl);
    const r = anchor.getBoundingClientRect();
    const mw = menuEl.offsetWidth;
    const x = Math.min(window.innerWidth - mw / 2 - 8, Math.max(mw / 2 + 8, r.left + r.width / 2));
    let y = r.top + 4;
    if (y - menuEl.offsetHeight < 8) y = menuEl.offsetHeight + 8;
    menuEl.style.left = x + 'px';
    menuEl.style.top = y + 'px';
    menuEl.dataset.target = mine ? '' : id;
  }
  function openLookEditor() {
    closeMenu();
    const body = document.createElement('div');
    let look = window.Avatar.get();
    window.Avatar.editor(body, { look, onChange: (l) => { look = l; } });
    const m = P.modal({
      title: '👗 Nhân vật của bạn', body,
      actions: [{ label: 'Huỷ', kind: 'ghost' },
        { label: '💾 Lưu', kind: 'primary', onClick: () => { window.Avatar.set(look); send('set_look', { look: window.Avatar.get() }); } }],
    });
    m.el.querySelector('.gh-modal').classList.add('wide');
  }

  // ---------------------------------------------------------------- thanh bên
  function renderChat() {
    bubbles.update(S.chat);
    const list = $('#chat-list');
    const msgs = S.chat;
    const lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const html = msgs.length ? msgs.map((m) => (m.channel === 'system'
      ? `<div class="msg system">${esc(m.text)}</div>`
      : `<div class="msg"><span class="who" style="color:hsl(${P.hue(m.name || '')},80%,72%)">${esc(m.name)}</span>${esc(m.text)}</div>`)).join('')
      : '<div class="empty-note">Chưa có tin nhắn nào. Chào mọi người đi! 👋</div>';
    if (setHTML(list, html)) {
      if (nearBottom || (msgs.length && msgs[msgs.length - 1].pid === S.me.id)) list.scrollTop = list.scrollHeight;
      if (ui.lastChatId !== null && lastId > ui.lastChatId && ui.tab !== 'chat') {
        ui.unread += msgs.filter((m) => m.id > ui.lastChatId && m.channel !== 'system').length;
      }
      ui.lastChatId = lastId;
    }
    const unread = $('#unread');
    unread.hidden = !ui.unread;
    unread.textContent = ui.unread;
  }
  function renderLog() {
    const html = S.log.length
      ? S.log.map((l) => `<div class="log-item ${esc(l.kind)}"><span class="lt">${fmtTime(l.t)}</span>${esc(l.text)}</div>`).join('')
      : '<div class="empty-note">Diễn biến trận đấu sẽ hiện ở đây.</div>';
    const list = $('#log-list');
    if (setHTML(list, html)) list.scrollTop = list.scrollHeight;
  }

  // ---------------------------------------------------------------- vẽ giao diện
  function render() {
    if (!S) return;
    $('#phase-pill').textContent = S.phase === 'lobby' ? '🏠 Phòng chờ' : S.phase === 'end' ? `🏁 Hết trận ${S.matchNo}` : `⚽ Trận ${S.matchNo}`;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `Đá Bóng ${ROOM}`;
    renderBanner();
    renderCast();
    renderArena();
    renderPlayers();
    renderPanel();
    renderEmotes();
    renderChat();
    renderLog();
  }

  // ---------------------------------------------------------------- sự kiện giao diện
  document.addEventListener('click', async (e) => {
    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled && actEl.dataset.act) {
      switch (actEl.dataset.act) {
        case 'start': send('start'); break;
        case 'next': send('next_match'); break;
        case 'lobby': send('lobby'); break;
        case 'stop':
          P.modal({
            title: 'Dừng trận?', body: '<p>Trận dừng ngay, không tính thắng thua.</p>',
            actions: [{ label: 'Đá tiếp', kind: 'ghost' }, { label: '🛑 Dừng', kind: 'danger', onClick: () => send('stop') }],
          });
          break;
        case 'edit-look': openLookEditor(); break;
        case 'add-bot': send('add_bot', { count: 1 }); break;
        case 'remove-bots': send('remove_bots'); break;
        case 'copy-link': if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good'); break;
        default:
      }
      return;
    }
    const kickEl = e.target.closest('[data-kick]');
    if (kickEl) {
      closeMenu();
      const id = kickEl.dataset.kick;
      if (player(id) && player(id).bot) { send('kick', { pid: id }); return; }
      P.modal({
        title: 'Mời ra khỏi phòng?', body: `<p>Bạn muốn mời <b>${esc(nm(id))}</b> ra khỏi phòng?</p>`,
        actions: [{ label: 'Huỷ', kind: 'ghost' }, { label: 'Mời ra', kind: 'danger', onClick: () => send('kick', { pid: id }) }],
      });
      return;
    }
    const fxEl = e.target.closest('[data-fx]');
    if (fxEl) {
      send('fx', { kind: fxEl.dataset.fx, target: fxEl.dataset.self ? null : (menuEl && menuEl.dataset.target) || null });
      closeMenu();
      return;
    }
    const pc = e.target.closest('.pcard');
    if (pc && pc.dataset.pid) { openMenu(pc.dataset.pid, pc); return; }
    if (menuEl && !e.target.closest('.pmenu')) closeMenu();
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-cfg]');
    if (!el) return;
    send('config', { [el.dataset.cfg]: el.value });
  });

  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (text && send('chat', { text })) input.value = '';
  });

  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    ui.tab = b.dataset.tab;
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab-body').forEach((x) => { x.hidden = x.dataset.body !== ui.tab; });
    if (ui.tab === 'chat') { ui.unread = 0; $('#unread').hidden = true; const l = $('#chat-list'); l.scrollTop = l.scrollHeight; }
    if (ui.tab === 'log') { const l = $('#log-list'); l.scrollTop = l.scrollHeight; }
  }));

  $('#btn-sound').addEventListener('click', () => {
    ui.sound = !ui.sound;
    try { localStorage.setItem('dabong_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) play('kick');
  });
  $('#btn-room').addEventListener('click', async () => { if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good'); });
  $('#btn-leave').addEventListener('click', () => {
    const doLeave = () => { if (conn) conn.leave(); setTimeout(() => { location.href = '/'; }, 150); };
    if (S && S.phase === 'play' && S.me.court) {
      P.modal({
        title: 'Rời trận đấu?',
        body: '<p>Bạn đang đá — rời phòng quá 10 giây là bị <b>xử thua</b>.</p>',
        actions: [{ label: 'Ở lại', kind: 'ghost' }, { label: 'Rời phòng', kind: 'danger', onClick: doLeave }],
      });
    } else doLeave();
  });

  fetch('/api/info').then((r) => r.json()).then((inf) => {
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    const lan = location.protocol === 'https:' ? inf.https : inf.urls;
    if (local && lan && lan.length) { ui.lanBase = lan[0]; render(); }
  }).catch(() => {});

  $('#room-code').textContent = ROOM;
  P.ensureName(() => connect());
})();
