(function () {
  const P = window.Platform;
  const $ = (s) => document.querySelector(s);
  const esc = P.esc;
  const ROOM = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (!ROOM) { location.href = '/'; return; }

  let S = null;          // trạng thái mới nhất từ máy chủ
  let conn = null;
  const ui = { lastSeq: null, tab: 'players', unread: 0, lastChatId: null, lanBase: null, sound: true };
  try { ui.sound = localStorage.getItem('caulong_sound') !== '0'; } catch (e) { /* bỏ qua */ }

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
  const sideOf = (pid) => (S && S.teams ? S.teams.findIndex((t) => t.includes(pid)) : -1);
  const sideColor = (pid) => { const i = sideOf(pid); return i >= 0 ? S.colors[i] : null; };
  // Tên đội (chữ thường, để vẽ lên canvas); đánh đôi thì cắt bớt tên cho vừa bảng điểm.
  const teamName = (side, max = 0) => (S.teams[side] || []).map((id) => {
    const t = id === S.me.id ? 'Bạn' : nm(id);
    return max && t.length > max ? t.slice(0, max - 1) + '…' : t;
  }).join(' & ');
  const teamWho = (team) => team.map((id) => who(id)).join(' & ');
  const courtSize = () => 2 * ((S && S.config.mode) || 1);
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
    hit: [[1400, 0.035, 'square', 0.05, 500]],
    smash: [[1800, 0.05, 'sawtooth', 0.08, 300], [300, 0.08, 'square', 0.04, 120]],
    soft: [[900, 0.04, 'triangle', 0.05, 600]],
    whoosh: [[300, 0.12, 'sine', 0.025, 900]],
    land: [[160, 0.08, 'triangle', 0.06, 90]],
    whistle: [[2200, 0.12, 'sine', 0.05], [2400, 0.2, 'sine', 0.05]],
    good: [[660, 0.08], [990, 0.16]],
    bad: [[440, 0.1, 'square', 0.05, 220], [330, 0.16, 'square', 0.05, 160]],
    win: [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]],
  };
  const play = (k) => beep(SOUNDS[k]);

  // ---------------------------------------------------------------- vật lý (giống hệt physics.py)
  let W = null;
  let SHOTS = null;
  function trajectory(x, y, vx, vy) {
    const g = W.G; const k = W.K; const dt = W.DT; const nx = W.NET_X; const nh = W.NET_H;
    const pts = [[x, y]];
    let net = false;
    const steps = Math.floor(W.MAX_T / dt);
    for (let i = 0; i < steps; i++) {
      const v = Math.sqrt(vx * vx + vy * vy);
      vx = vx - k * v * vx * dt;
      vy = vy - (g + k * v * vy) * dt;
      const px = x;
      x = x + vx * dt;
      y = y + vy * dt;
      if (!net && (px - nx) * (x - nx) <= 0 && px !== x && y < nh) {
        net = true;
        const back = px < nx ? -1 : 1;
        x = nx + back * 3;
        vx = back * Math.abs(vx) * 0.08;
        vy = Math.min(vy, 0) * 0.3;
      }
      if (y <= 0) { pts.push([x, 0]); break; }
      pts.push([x, y]);
    }
    return { pts, net };
  }
  function posAt(pts, since) {
    if (since <= 0) return pts[0];
    const f = since / W.DT;
    const i = Math.floor(f);
    if (i >= pts.length - 1) return pts[pts.length - 1];
    const a = pts[i]; const b = pts[i + 1]; const u = f - i;
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  }
  function shotKind(kind, cy) {
    if (kind === 'smash') return cy >= W.SMASH_Y ? 'smash' : cy >= W.LOW_Y ? 'drive' : 'lift';
    if (kind === 'clear') return cy >= W.LOW_Y ? 'clear' : 'lift';
    return 'drop';
  }
  const rad = (a) => a * Math.PI / 180;
  function land(cx, cy, vx, vy) { const t = trajectory(cx, cy, vx, vy); return [t.pts[t.pts.length - 1][0], t.net]; }
  function solve(kind, side, cx, cy, aim) {
    const s = SHOTS[kind];
    const d = side === 0 ? 1 : -1;
    const nx = W.NET_X;
    const half = nx - W.LINE_L;
    const target = clamp(s.depth + s.aim * aim, 0.06, 0.98) * half;
    const over = ([lx, net]) => (net ? -1 : (lx - nx) * d);
    let best = null;
    if (s.ang !== undefined) {
      const [loS, hiS] = s.spd;
      for (let k = 0; k < 17; k++) {
        const a = rad(s.ang + 4 * Math.floor((k + 1) / 2) * (k % 2 ? 1 : -1));
        const ca = Math.cos(a); const sa = Math.sin(a);
        if (over(land(cx, cy, d * hiS * ca, hiS * sa)) <= 0) continue;
        let lo = loS; let hi = hiS;
        for (let j = 0; j < 14; j++) {
          const mid = (lo + hi) / 2;
          if (over(land(cx, cy, d * mid * ca, mid * sa)) < target) lo = mid; else hi = mid;
        }
        const err = Math.abs(over(land(cx, cy, d * hi * ca, hi * sa)) - target);
        if (!best || err < best[0]) best = [err, d * hi * ca, hi * sa];
        if (err <= W.TOL) break;
      }
    } else {
      for (let i = 0; i <= 40; i++) {
        const a = rad(s.a0 + (s.a1 - s.a0) * i / 40);
        const vx = d * s.spd * Math.cos(a); const vy = s.spd * Math.sin(a);
        const o = over(land(cx, cy, vx, vy));
        if (o <= 0) continue;
        const err = Math.abs(o - target);
        if (!best || err < best[0] - 0.5) best = [err, vx, vy];
      }
    }
    if (!best || (best[0] > 3 * W.TOL && kind !== 'lift')) return solve('lift', side, cx, cy, aim);
    return [best[1], best[2]];
  }
  const reachCenter = (x, y, face) => [x + face * W.REACH_X, y + W.REACH_Y];

  // ---------------------------------------------------------------- đồng hồ chung với máy chủ
  // serverNow() ≈ time.time() của máy chủ. Lấy mẫu từ mỗi gói tin; giữ mẫu lớn nhất gần đây (gói đến nhanh nhất).
  const clockSamples = [];
  let clockOff = null;
  function clockSample(serverTs) {
    const s = serverTs - performance.now() / 1000;
    clockSamples.push(s);
    if (clockSamples.length > 90) clockSamples.shift();
    clockOff = Math.max(...clockSamples);
  }
  const serverNow = () => performance.now() / 1000 + (clockOff || 0);

  // ---------------------------------------------------------------- cầu đang bay
  let shot = null;        // đường bay máy chủ đã xác nhận: { n, t0, pts, net, by, kind, pt }
  let pred = null;        // đường bay mình đoán trước sau khi mình vừa đánh (chờ máy chủ xác nhận)
  function makeShot(s) {
    const tr = trajectory(s.x, s.y, s.vx, s.vy);
    return { ...s, pts: tr.pts, net: tr.net, landT: s.t0 + (tr.pts.length - 1) * W.DT };
  }
  function setShot(s, fromMsg) {
    if (!s) { shot = null; pred = null; return; }
    if (shot && shot.n === s.n && shot.pt === s.pt) return;
    shot = makeShot(s);
    if (pred && pred.n <= shot.n) pred = null;
    if (fromMsg) {
      const big = s.kind === 'smash';
      if (s.by !== (S && S.me.id)) play(big ? 'smash' : s.kind === 'drop' || s.kind === 'serve_short' ? 'soft' : 'hit');
      fx.hits.push({ x: s.x, y: s.y, at: performance.now(), big });
      if (big) { fx.shake = performance.now(); pushFeed(`💥 ${short(s.by)} đập cầu!`, sideColor(s.by) || '#fff'); }
    }
  }
  function curShot() {
    if (pred && (!shot || pred.n > shot.n)) {
      if (serverNow() - pred.t0 < 0.45) return pred;
      pred = null;   // máy chủ không nhận cú đánh (đánh trượt / tới muộn)
    }
    return shot;
  }

  // ---------------------------------------------------------------- người của mình
  const keys = { left: false, right: false };
  let me = null;   // { pt, x, y, vy, face, swingAt, kind, hitN, lastSent }
  const onCourt = () => S && S.phase === 'play' && S.me.court;
  function mySide() { return S.me.side; }
  function bounds(side) {
    const m = W.MARGIN; const pw = W.PW;
    return side === 0 ? [pw, W.NET_X - m - pw] : [W.NET_X + m + pw, W.W - pw];
  }
  function resetMe() {
    const sp = S.spawn[S.me.id];
    me = { pt: S.ptNo, x: sp ? sp[0] : 300, y: 0, vy: 0, face: sp ? sp[1] : 1, swingAt: null, kind: '', hitN: 0, lastSent: 0, s: 'idle', vx: 0 };
  }
  function aimDir() {
    const fwd = me.face > 0 ? keys.right : keys.left;
    const back = me.face > 0 ? keys.left : keys.right;
    return fwd && !back ? 1 : back && !fwd ? -1 : 0;
  }
  function jump() {
    if (!onCourt() || !me || me.y > 0) return;
    me.vy = W.JUMP;
  }
  function swing(kind) {
    if (!onCourt() || !me) return;
    const now = serverNow();
    if (me.swingAt !== null && now - me.swingAt < W.SWING) return;
    me.swingAt = now; me.kind = kind;
    play('whoosh');
    if (S.rstate === 'serve' && S.server === S.me.id && now >= S.rAt - 0.05) {
      sendQuiet('serve', { kind, aim: aimDir() });
    }
  }
  function stepMe(dt) {
    const run = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    me.vx = run * W.SPEED;
    const [lo, hi] = bounds(mySide());
    me.x = clamp(me.x + me.vx * dt, lo, hi);
    if (me.y > 0 || me.vy > 0) {
      me.vy -= W.PG * dt;
      me.y += me.vy * dt;
      if (me.y <= 0) { me.y = 0; me.vy = 0; }
    }
    const now = serverNow();
    if (me.swingAt !== null && now - me.swingAt > W.SWING) me.swingAt = null;
    me.s = me.swingAt !== null ? 'swing' : me.y > 0 ? 'jump' : run ? 'run' : 'idle';
    // Vợt chạm cầu?
    const sh = curShot();
    if (me.swingAt !== null && S.rstate === 'rally' && sh && sh.side !== mySide() && me.hitN !== sh.n) {
      const e = now - me.swingAt;
      if (e >= W.HIT_FROM && e <= W.HIT_TO && now < sh.landT) {
        const [sx, sy] = posAt(sh.pts, now - sh.t0);
        const mine = mySide() === 0 ? sx <= W.NET_X + 12 : sx >= W.NET_X - 12;
        const [cx, cy] = reachCenter(me.x, me.y, me.face);
        if (mine && (sx - cx) ** 2 + (sy - cy) ** 2 <= W.REACH_R ** 2) {
          const aim = aimDir();
          me.hitN = sh.n;
          sendQuiet('hit', { n: sh.n, t: now, x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, kind: me.kind, aim });
          const real = shotKind(me.kind, sy);
          const rx = Math.round(sx * 1000) / 1000; const ry = Math.round(sy * 1000) / 1000;
          const [vx, vy] = solve(real, mySide(), rx, ry, aim);
          pred = makeShot({ n: sh.n + 1, x: rx, y: ry, vx, vy, t0: now, by: S.me.id, side: mySide(), kind: real, pt: sh.pt });
          play(real === 'smash' ? 'smash' : real === 'drop' ? 'soft' : 'hit');
          fx.hits.push({ x: sx, y: sy, at: performance.now(), big: real === 'smash' });
          if (real === 'smash') fx.shake = performance.now();
        }
      }
    }
    if (performance.now() - me.lastSent > 33) {
      me.lastSent = performance.now();
      sendQuiet('pos', {
        pt: me.pt, ts: now, x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10, s: me.s,
        k: me.swingAt !== null ? me.kind : '', e: me.swingAt !== null ? Math.round((now - me.swingAt) * 1000) / 1000 : 0,
      });
    }
  }

  // ---------------------------------------------------------------- người khác (nội suy)
  const remote = new Map();   // pid → [{t, x, y, s, k, e}]
  let courtPt = null;
  function onCourtMsg(m) {
    if (!S || m.g !== S.matchNo) return;
    clockSample(m.ts);
    if (courtPt !== m.pt) { courtPt = m.pt; remote.clear(); }
    for (const [pid, v] of Object.entries(m.p)) {
      let buf = remote.get(pid);
      if (!buf) { buf = []; remote.set(pid, buf); }
      const [x, y, s, k, e, t] = v;
      if (buf.length && t <= buf[buf.length - 1].t) continue;
      buf.push({ t, x, y, s, k, e });
      if (buf.length > 30) buf.shift();
    }
  }
  function remotePos(pid, now) {
    const buf = remote.get(pid);
    if (!buf || !buf.length) {
      const sp = S.spawn && S.spawn[pid];
      return sp ? { x: sp[0], y: 0, s: 'idle', k: '', e: 0 } : null;
    }
    const rt = now - 0.08;
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
  const VIEW_W = 1300;      // bề ngang thế giới hiển thị (sân 1200 + lề)
  const FLOOR = 74;         // phần sàn dưới mặt sân (đơn vị thế giới)
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
  // Toạ độ màn hình (đơn vị thế giới, gốc trên-trái) từ toạ độ sân.
  const X = (x) => x + (VIEW_W - 1200) / 2;
  const Y = (y) => view.h - FLOOR - y;

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
    let it = avaCache.get(key);
    if (!it) {
      const img = new Image();
      // ảnh bộ phận phải nhúng thẳng vào SVG thì mới vẽ được lên canvas
      window.Avatar.svgInline(p.look, { seed: p.id }).then((s) => {
        s = s.replace(/(<svg[^>]*>)/, '$1<style>.av-ec,.av-ew,.av-mo,.av-md,.av-tears,.av-shadow{display:none}</style>');
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
      });
      it = { img };
      avaCache.set(key, it);
    }
    return it.img;
  }

  function drawHall() {
    const H = view.h;
    const g = ctx.createLinearGradient(0, 0, 0, Y(0));
    g.addColorStop(0, '#1d2b4f'); g.addColorStop(0.55, '#2f4878'); g.addColorStop(1, '#4b6aa1');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, H);
    // đèn trần
    for (let i = 0; i < 5; i++) {
      const lx = 130 + i * 260;
      const lg = ctx.createRadialGradient(lx, -20, 5, lx, -20, 260);
      lg.addColorStop(0, 'rgba(255,248,220,.35)'); lg.addColorStop(1, 'rgba(255,248,220,0)');
      ctx.fillStyle = lg; ctx.fillRect(lx - 260, 0, 520, 280);
      ctx.fillStyle = '#fff8dc'; roundRect(lx - 34, 0, 68, 8, 4); ctx.fill();
    }
    // khán đài (mờ phía xa) + bảng quảng cáo sát mép sân
    const boardY = Y(0) - 46;
    const standY = boardY - 120;
    ctx.fillStyle = 'rgba(10,16,36,.4)';
    ctx.fillRect(0, standY, VIEW_W, 120);
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 44; i++) {
        const px = 14 + i * 29.5 + (row % 2) * 14;
        const py = standY + 22 + row * 36;
        ctx.fillStyle = `hsla(${(i * 47 + row * 90) % 360},40%,60%,.28)`;
        ctx.beginPath(); ctx.arc(px, py, 7, 0, 7); ctx.fill();
        roundRect(px - 9, py + 7, 18, 18, 6); ctx.fill();
      }
    }
    ctx.fillStyle = '#17633f'; ctx.fillRect(0, boardY, VIEW_W, 46);
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(0, boardY, VIEW_W, 3);
    ctx.font = `800 20px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    for (let i = 0; i < 4; i++) ctx.fillText('🏸 GAME HUB OPEN', 165 + i * 325, boardY + 24);
    // sàn sân
    ctx.fillStyle = '#2e8b57';
    ctx.fillRect(0, Y(0), VIEW_W, FLOOR + 2);
    ctx.fillStyle = '#1f6e44';
    ctx.fillRect(0, Y(0) + FLOOR * 0.55, VIEW_W, FLOOR);
    // vạch sân (nhìn nghiêng: vạch kẻ thành dải mỏng trên mặt sân)
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillRect(X(W.LINE_L) - 3, Y(0), 6, 26);
    ctx.fillRect(X(W.LINE_R) - 3, Y(0), 6, 26);
    ctx.fillRect(X(W.LINE_L), Y(0) + 2, W.LINE_R - W.LINE_L, 3);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    [W.NET_X - 170, W.NET_X + 170].forEach((lx) => ctx.fillRect(X(lx) - 2, Y(0), 4, 20));
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.font = `800 13px ${FONT}`;
    ctx.fillText('NGOÀI', X(W.LINE_L / 2), Y(0) + 40);
    ctx.fillText('NGOÀI', X((W.LINE_R + W.W) / 2), Y(0) + 40);
  }

  function drawNet() {
    const x = X(W.NET_X);
    const top = Y(W.NET_H);
    const base = Y(0);
    // cột lưới
    ctx.fillStyle = '#d9dde8'; ctx.strokeStyle = '#6b7286'; ctx.lineWidth = 2;
    roundRect(x - 5, top - 8, 10, base - top + 10, 4); ctx.fill(); ctx.stroke();
    // mắt lưới
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = 'rgba(30,30,40,.85)'; ctx.lineWidth = 1;
    for (let yy = top + 6; yy < base; yy += 9) { ctx.beginPath(); ctx.moveTo(x - 9, yy); ctx.lineTo(x + 9, yy); ctx.stroke(); }
    for (let xx = -9; xx <= 9; xx += 6) { ctx.beginPath(); ctx.moveTo(x + xx, top + 4); ctx.lineTo(x + xx, base); ctx.stroke(); }
    ctx.restore();
    // băng trắng mép trên
    ctx.fillStyle = '#ffffff';
    roundRect(x - 11, top - 2, 22, 8, 3); ctx.fill();
  }

  // Người chơi: ảnh nhân vật + cánh tay cầm vợt (vẽ bằng canvas) xoay theo cú vung.
  function racketAngle(st, face) {
    // góc tính trong hệ toạ độ “nhìn từ phía người chơi hướng sang phải” (face = 1); 90° = giơ thẳng lên.
    if (st.k && st.e !== undefined && st.e <= W.SWING) {
      const u = clamp(st.e / W.SWING, 0, 1);
      const ease = 1 - (1 - u) * (1 - u);
      if (st.k === 'drop') return 150 - ease * 110;            // đẩy nhẹ
      if (st.k === 'smash') return 200 - ease * 250;           // vụt mạnh từ sau đầu xuống trước
      return 185 - ease * 160;                                 // phông cầu
    }
    if (st.s === 'jump') return 120;
    return 65;
  }
  function drawPlayer(p, st, face, color, isMe, now) {
    const x = X(st.x); const y = Y(st.y);
    const bob = st.s === 'run' ? Math.abs(Math.sin(now * 14)) * 4 : 0;
    // bóng dưới chân
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    const sh = clamp(1 - st.y / 300, 0.4, 1);
    ctx.beginPath(); ctx.ellipse(x, Y(0) + 4, 34 * sh, 7 * sh, 0, 0, 7); ctx.fill();
    // vợt phía sau người khi vung ra sau
    const ang = rad(racketAngle(st, face));
    const shoulder = [x + face * 14, y - 92 - bob];
    const behind = Math.cos(ang) < 0;
    if (behind) drawRacket(shoulder, ang, face, color);
    const img = avatarImg(p);
    const h = 132;
    if (img.complete && img.naturalWidth) {
      const w = h * (100 / 166);
      ctx.save();
      if (st.s === 'jump') { ctx.translate(x, y - h / 2); ctx.rotate(face * -0.08); ctx.translate(-x, -(y - h / 2)); }
      ctx.drawImage(img, x - w / 2, y - h - bob + 10, w, h);
      ctx.restore();
    } else {
      ctx.fillStyle = color; roundRect(x - 18, y - 110, 36, 110, 16); ctx.fill();
    }
    if (!behind) drawRacket(shoulder, ang, face, color);
    // tên + vạch màu đội
    ctx.font = `800 14px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const label = isMe ? 'Bạn' : p.name;
    const tw = ctx.measureText(label).width + 18;
    const ly = y - h - 20 - bob;
    ctx.fillStyle = 'rgba(12,16,34,.75)'; roundRect(x - tw / 2, ly - 11, tw, 22, 11); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillText(label, x, ly + 1);
  }
  function drawRacket([sx, sy], ang, face, color) {
    const dx = Math.cos(ang) * face; const dy = -Math.sin(ang);
    const hx = sx + dx * 34; const hy = sy + dy * 34;            // bàn tay
    const tx = sx + dx * 66; const ty = sy + dy * 66;            // đầu vợt
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#f2c9a0'; ctx.lineWidth = 7;              // cánh tay
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 3;                 // cán vợt
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.save();
    ctx.translate(sx + dx * 84, sy + dy * 84);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.strokeStyle = color; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.ellipse(0, 0, 20, 14, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 0.8;
    for (let k = -12; k <= 12; k += 6) { ctx.beginPath(); ctx.moveTo(k, -12); ctx.lineTo(k, 12); ctx.stroke(); }
    for (let k = -8; k <= 8; k += 5) { ctx.beginPath(); ctx.moveTo(-18, k); ctx.lineTo(18, k); ctx.stroke(); }
    ctx.restore();
  }

  // Quả cầu: đầu bần tròn đi trước, chùm lông xoè phía sau ngược hướng bay.
  function drawShuttle(sx, sy, vx, vy, smash) {
    const x = X(sx); const y = Y(sy);
    // bóng trên sàn
    ctx.fillStyle = `rgba(0,0,0,${0.35 * clamp(1 - sy / 600, 0.2, 1)})`;
    ctx.beginPath(); ctx.ellipse(x, Y(0) + 3, 9, 3, 0, 0, 7); ctx.fill();
    if (y < 14) {
      // cầu bay quá cao: mũi tên chỉ vị trí ở mép trên
      ctx.fillStyle = '#ffe66d'; ctx.strokeStyle = '#3b2a63'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x - 10, 24); ctx.lineTo(x + 10, 24); ctx.closePath(); ctx.stroke(); ctx.fill();
      return;
    }
    const a = Math.atan2(-vy, vx);   // hướng bay trên màn hình
    if (smash) {
      ctx.strokeStyle = 'rgba(255,120,80,.55)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(a) * 70, y - Math.sin(a) * 70); ctx.stroke();
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    // chùm lông
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#9aa3b8'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-3, -5); ctx.lineTo(-22, -11); ctx.quadraticCurveTo(-25, 0, -22, 11); ctx.lineTo(-3, 5); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#c4cad8'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-4, -2); ctx.lineTo(-22, -5); ctx.moveTo(-4, 2); ctx.lineTo(-22, 5); ctx.stroke();
    ctx.fillStyle = '#ff5a5f'; ctx.fillRect(-9, -6, 3, 12);
    // đầu bần
    ctx.fillStyle = '#fff4dc'; ctx.strokeStyle = '#b8a27a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function hudText(text, x, y, size, align = 'center', color = '#fff') {
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, size / 4.5); ctx.strokeStyle = '#162040';
    ctx.strokeText(text, x, y + Math.max(2, size / 16));
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  const fx = { shake: 0, hits: [] };
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
      if (!me || me.pt !== S.ptNo) resetMe();
      stepMe(dt);
    }
    ctx.setTransform(view.dpr * view.s, 0, 0, view.dpr * view.s, 0, 0);
    if (wall - fx.shake < 260) {
      const k = (1 - (wall - fx.shake) / 260) * 6;
      ctx.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    }
    drawHall();
    // điểm cầu rơi của điểm vừa xong
    if (S.land !== null && S.land !== undefined && (S.rstate === 'point' || S.rstate === 'game' || S.rstate === 'over')) {
      const out = S.land < W.LINE_L || S.land > W.LINE_R;
      const lx = X(S.land);
      ctx.strokeStyle = out ? '#ff5a5f' : '#ffe66d'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(lx, Y(0) + 4, 22, 7, 0, 0, 7); ctx.stroke();
      hudText(out ? 'NGOÀI' : 'TRONG', lx, Y(0) - 26, 18, 'center', out ? '#ff8a8a' : '#ffe66d');
    }
    drawNet();
    // người chơi
    S.pair.forEach((pid) => {
      const p = player(pid) || { id: pid, name: '?', look: null };
      const i = sideOf(pid);
      const face = i === 0 ? 1 : -1;
      const color = S.colors[i];
      let st;
      if (pid === S.me.id && me && onCourt()) {
        st = { x: me.x, y: me.y, s: me.s, k: me.swingAt !== null ? me.kind : '', e: me.swingAt !== null ? now - me.swingAt : 0 };
      } else {
        st = remotePos(pid, now);
      }
      if (!st) return;
      drawPlayer(p, st, face, color, pid === S.me.id, wall / 1000);
      p._st = st;
    });
    // cầu
    const sh = curShot();
    let held = null;
    if (S.rstate === 'serve' && S.server) {
      const i = sideOf(S.server);
      const st = S.server === S.me.id && me && onCourt() ? me : (player(S.server) || {})._st;
      if (st && i >= 0) held = [st.x + (i === 0 ? 1 : -1) * 30, W.SERVE_Y + Math.sin(wall / 300) * 3];
    }
    if (held) {
      drawShuttle(held[0], held[1], 0, -1, false);
    } else if (sh && (S.rstate === 'rally' || S.rstate === 'point' || S.rstate === 'game' || S.rstate === 'over')) {
      const t = now - sh.t0;
      const [sx, sy] = posAt(sh.pts, t);
      const [px, py] = posAt(sh.pts, t - 0.02);
      const resting = t >= (sh.pts.length - 1) * W.DT;
      const key = `${sh.pt}:${sh.n}`;
      if (resting && ui.landPlayed !== key) { ui.landPlayed = key; play('land'); }
      drawShuttle(sx, sy, resting ? 1 : sx - px, resting ? 0 : sy - py, sh.kind === 'smash' && !resting);
    }
    // tia sáng chỗ vợt chạm cầu
    for (let k = fx.hits.length - 1; k >= 0; k--) {
      const h = fx.hits[k];
      const age = (wall - h.at) / 1000;
      if (age > 0.3) { fx.hits.splice(k, 1); continue; }
      const r = (h.big ? 18 : 10) + age * (h.big ? 160 : 90);
      ctx.strokeStyle = `rgba(255,255,255,${1 - age / 0.3})`; ctx.lineWidth = h.big ? 5 : 3;
      ctx.beginPath(); ctx.arc(X(h.x), Y(h.y), r, 0, 7); ctx.stroke();
    }
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    drawHud(now, wall);
  }
  requestAnimationFrame(frame);

  function drawHud(now, wall) {
    const w = view.cssW; const h = view.cssH;
    // bảng điểm
    if (S.pair.length) {
      const [sa, sb] = S.score;
      const [ga, gb] = S.gamesWon;
      const sz = w < 560 ? 15 : 18;
      const max = S.teams[0].length > 1 ? (w < 560 ? 5 : 8) : 12;
      const serveA = S.teams[0].includes(S.server) ? '🏸 ' : ''; const serveB = S.teams[1].includes(S.server) ? ' 🏸' : '';
      hudText(`${serveA}${teamName(0, max)}`, w / 2 - 60, 26, sz, 'right', S.colors[0]);
      hudText(`${teamName(1, max)}${serveB}`, w / 2 + 60, 26, sz, 'left', S.colors[1]);
      hudText(`${sa} – ${sb}`, w / 2, 28, sz + 12);
      if (S.config.games > 1) hudText(`Ván ${S.setNo} · ${ga}–${gb}`, w / 2, 56, 13, 'center', '#cfd8ff');
    }
    // thông báo
    for (let k = feed.length - 1, shown = 0; k >= 0 && shown < 3; k--) {
      const f = feed[k];
      const age = (wall - f.at) / 1000;
      if (age > 3) continue;
      ctx.globalAlpha = clamp(3 - age, 0, 1);
      hudText(f.text, w - 12, h - 20 - shown * 22, 14, 'right', f.color || '#fff');
      ctx.globalAlpha = 1;
      shown++;
    }
    const mid = h * 0.36;
    if (S.rstate === 'serve') {
      const fresh = S.score.every((v) => !v);
      if (now < S.rAt) {
        if (fresh) hudText(S.setNo > 1 ? `VÁN ${S.setNo}` : 'VÀO TRẬN!', w / 2, mid, 46, 'center', '#ffe66d');
      } else if (S.server === S.me.id && onCourt()) {
        hudText('Bạn giao cầu: J = giao cao · L = giao ngắn', w / 2, mid, w < 560 ? 15 : 20);
        hudText(`Tự giao sau ${Math.max(0, Math.ceil(S.rUntil - now))}s`, w / 2, mid + 30, 13, 'center', '#cfd8ff');
      } else {
        hudText(`${S.server === S.me.id ? 'Bạn' : nm(S.server)} giao cầu…`, w / 2, mid, 18, 'center', '#cfd8ff');
      }
    } else if (S.rstate === 'point' || S.rstate === 'game' || S.rstate === 'over') {
      const pw = S.pointWinner;
      const reason = (S.reasons || {})[S.pointReason] || '';
      if (S.rstate === 'over' && S.winner !== null) {
        hudText(`🏆 ${teamName(S.winner)} thắng trận!`, w / 2, mid, w < 560 ? 26 : 38, 'center', '#ffe66d');
      } else if (S.rstate === 'game') {
        hudText(`🏁 ${teamName(pw)} thắng ván ${S.setNo}!`, w / 2, mid, w < 560 ? 24 : 34, 'center', '#ffe66d');
      } else if (pw !== null) {
        hudText(`Điểm cho ${teamName(pw).replace(/^Bạn/, 'bạn')}`, w / 2, mid, w < 560 ? 20 : 28, 'center', S.colors[pw]);
      }
      if (reason) hudText(reason + (S.rally > 1 ? ` · ${S.rally} chạm` : ''), w / 2, mid + 34, 15, 'center', '#cfd8ff');
    }
    if (!S.me.court) hudText('👀 Đang xem — tới lượt bạn sẽ được vào sân', w / 2, h - 22, 14);
  }

  // ---------------------------------------------------------------- điều khiển
  const KEYMAP = {
    a: 'left', A: 'left', ArrowLeft: 'left', d: 'right', D: 'right', ArrowRight: 'right',
    w: 'jump', W: 'jump', ArrowUp: 'jump', ' ': 'jump',
    j: 'clear', J: 'clear', z: 'clear', Z: 'clear',
    k: 'smash', K: 'smash', x: 'smash', X: 'smash',
    l: 'drop', L: 'drop', c: 'drop', C: 'drop',
  };
  function press(act, down) {
    if (act === 'left' || act === 'right') { keys[act] = down; return; }
    if (!down) return;
    if (act === 'jump') jump();
    else swing(act);
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
    if (m.type === 'court') onCourtMsg(m);
    else if (m.type === 'shot' && S && W && m.g === S.matchNo) setShot(m.shot, true);
  }

  function onState(state) {
    S = state;
    if (!W && S.world) { W = S.world; SHOTS = S.shots; }
    if (clockOff === null) clockSample(S.now);
    if (S.phase === 'play' && W) {
      if (S.shot) setShot(S.shot, false); else if (S.rstate === 'serve') setShot(null);
    }
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
      case 'point':
        play(!S.me.court ? 'whistle' : e.side === S.me.side ? 'good' : 'bad');
        break;
      case 'setwin':
        play('whistle');
        (S.teams[e.side] || []).forEach((pid) => bubble(pid, '🏁', 'emoji'));
        break;
      case 'win':
        play('win');
        if (e.side !== null && e.side !== undefined) {
          (S.teams[e.side] || []).forEach((pid) => { bubble(pid, '🏆', 'emoji'); if (cast) cast.react(pid, 'cheer'); });
        }
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
    let big = '🏸';
    let title = '';
    let sub = '';
    let cls = 'gbanner';
    if (S.phase === 'lobby') {
      title = 'Phòng chờ';
      sub = `${S.players.length}/${S.maxPlayers} người · ${S.me.host ? 'bạn là chủ phòng — chỉnh luật rồi bấm Vào sân bên dưới (chơi một mình thì thêm bot)' : 'đang chờ chủ phòng bắt đầu…'}`;
    } else if (S.phase === 'end') {
      const won = S.last && S.last.winner !== null;
      big = won ? '🏆' : '🏁'; cls += ' win';
      title = won ? `${teamWho(S.last.teams[S.last.winner])} thắng!` : 'Trận đấu dừng';
      sub = `Trận ${S.matchNo} kết thúc — ${S.queue.length > courtSize() ? 'người thắng giữ sân, người tiếp theo vào đánh.' : 'đánh tiếp trận mới nào!'}`;
    } else {
      title = `Trận ${S.matchNo}: ${teamWho(S.teams[0])} ⚔️ ${teamWho(S.teams[1])}`;
      if (!S.me.court) sub = '👀 Bạn đang xem — người thắng giữ sân, tới lượt bạn sẽ được vào.';
      else sub = touchDevice ? 'Dùng các nút trên màn hình · giữ nút tiến khi đánh để cầu đi sâu' : 'A/D chạy · W/Space nhảy · J phông · K đập · L bỏ nhỏ';
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
      badge: S.phase === 'end' && S.last && S.last.winner !== null && S.last.teams[S.last.winner].includes(p.id) ? '🏆' : '',
    })));
  }

  function renderPlayers() {
    const html = S.players.map((p) => {
      const tags = [p.bot ? '🤖' : '', p.host ? '👑' : '', p.streak >= 2 ? `🔥${p.streak}` : '', p.connected ? '' : '📴'].filter(Boolean).join(' ');
      let sub;
      if (S.phase === 'play' && p.court) sub = `${p.side === 0 ? '⬅️ Sân trái' : '➡️ Sân phải'}${S.server === p.id ? ' · 🏸 giao cầu' : ''}`;
      else if (S.phase === 'play') sub = `⏳ Hàng chờ #${(S.queue.indexOf(p.id) - S.pair.length + 1)}`;
      else sub = p.w || p.l ? `🏆 ${p.w} thắng · ❌ ${p.l} thua · 💥 ${p.smash} cú đập` : 'Sẵn sàng';
      const score = S.phase === 'play' && p.court ? `<div class="sc">${S.score[p.side]}<small>${S.config.games > 1 ? `${S.gamesWon[p.side]} ván` : 'điểm'}</small></div>` : '';
      return `<div class="pcard" style="--pc:${sideColor(p.id) || 'transparent'}" data-pid="${esc(p.id)}">
        <div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>
        <div class="pn"><b>${p.id === S.me.id ? 'Bạn' : esc(p.name)} ${tags}</b><span>${sub}</span></div>${score}</div>`;
    }).join('');
    setHTML($('#plist'), html);
  }

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const inviteLink = () => `${ui.lanBase || location.origin}/g/caulong/?room=${ROOM}`;
  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    return `<div class="panel"><h3><span class="grow">🤖 Người chơi ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Một mình? Thêm bot làm đối thủ — bot cũng chạy, nhảy đập cầu và bỏ nhỏ!</p>
      <div class="btns-row">${btn('add-bot', '＋ 1 bot', 'small', n >= S.maxPlayers ? 'disabled' : '')}
        ${bots ? btn('remove-bots', '🗑 Xoá hết bot', 'small ghost') : ''}</div></div>`;
  }
  function settingsPanel() {
    const dis = S.me.host ? '' : 'disabled';
    const cfg = S.config;
    return `<div class="panel"><h3>⚙️ Luật chơi</h3><div class="settings">
      <div class="setting"><label>👥 Kiểu đánh</label><select data-cfg="mode" ${dis}>
        ${S.modesOpt.map((v) => `<option value="${v}" ${v === cfg.mode ? 'selected' : ''}>${v === 1 ? 'Đánh đơn (1 chọi 1)' : 'Đánh đôi (2 chọi 2)'}</option>`).join('')}</select></div>
      <div class="setting"><label>🎯 Điểm mỗi ván</label><select data-cfg="points" ${dis}>
        ${S.pointsOpt.map((v) => `<option value="${v}" ${v === cfg.points ? 'selected' : ''}>${v} điểm</option>`).join('')}</select></div>
      <div class="setting"><label>🏁 Số ván</label><select data-cfg="games" ${dis}>
        ${S.gamesOpt.map((v) => `<option value="${v}" ${v === cfg.games ? 'selected' : ''}>${v === 1 ? '1 ván' : `Thắng ${Math.floor(v / 2) + 1}/${v} ván`}</option>`).join('')}</select></div>
      <div class="setting"><label>🤖 Độ khó của bot</label><select data-cfg="bot_level" ${dis}>
        ${S.botLevels.map((v) => `<option value="${v}" ${v === cfg.bot_level ? 'selected' : ''}>${LEVEL_NAMES[v]}</option>`).join('')}</select></div>
    </div></div>`;
  }
  function keysPanel() {
    return `<div class="panel"><h3>🕹️ Điều khiển</h3><div class="keys">
      <span><kbd>A</kbd> <kbd>D</kbd> / <kbd>←</kbd> <kbd>→</kbd> <b>Chạy</b></span>
      <span><kbd>W</kbd> / <kbd>↑</kbd> / <kbd>Space</kbd> <b>Nhảy</b></span>
      <span><kbd>J</kbd> / <kbd>Z</kbd> <b>Phông cầu</b> (cao, sâu)</span>
      <span><kbd>K</kbd> / <kbd>X</kbd> <b>Đập cầu</b> (nhảy lên đập)</span>
      <span><kbd>L</kbd> / <kbd>C</kbd> <b>Bỏ nhỏ</b> (sát lưới)</span>
      <span>Giữ <b>tiến</b> khi đánh: cầu sâu hơn · giữ <b>lùi</b>: ngắn hơn</span>
    </div></div>`;
  }
  function queuePanel() {
    const n = courtSize();
    const list = S.queue.map((pid, i) => {
      const p = player(pid);
      if (!p) return '';
      return `<span class="q ${i < n ? 'court' : ''}"><span class="n">${i < n ? '🏸' : i - n + 1}</span>${pid === S.me.id ? 'Bạn' : esc(p.name)}${p.bot ? ' 🤖' : ''}</span>`;
    }).join('');
    const note = n > 2
      ? '4 người đầu vào đánh đôi: 2 người đầu một đội, 2 người sau một đội. Đội thắng giữ sân, đội thua xuống cuối hàng.'
      : '2 người đầu vào đánh. Người thắng giữ sân, người thua xuống cuối hàng.';
    return `<div class="panel"><h3>🏟️ Thứ tự vào sân</h3><p class="gh-muted" style="margin:0 0 10px;font-size:13px">${note}</p><div class="queue">${list}</div></div>`;
  }
  function renderPanel() {
    const el = $('#panel');
    if (S.phase === 'play') { setHTML(el, ''); return; }
    const host = S.me.host;
    const need = courtSize();
    let html;
    if (S.phase === 'end' && S.last) {
      const L = S.last;
      const won = L.winner !== null;
      const rows = [0, 1].map((side) => {
        const team = L.teams[side];
        const names = team.map((pid) => { const p = player(pid) || { name: '?' }; return `${pid === S.me.id ? 'Bạn' : esc(p.name)}${p.bot ? ' 🤖' : ''}`; }).join(' & ');
        const smashes = team.reduce((s, pid) => s + ((L.smashes || {})[pid] || 0), 0);
        const sets = (L.sets || []).map(([x, y]) => (side === 0 ? `${x}–${y}` : `${y}–${x}`)).join(' · ');
        return `<div class="res-row ${side === L.winner ? 'win' : ''}"><span class="rank">${side === L.winner ? '🏆' : ''}</span>
          <span class="rname${team.length > 1 ? ' team' : ''}">${names}</span>
          <div class="rcards"><span class="gh-muted">💥 ${smashes} cú đập</span></div>
          <span class="rpts">${sets || '—'}<small>${L.games[side]} ván thắng</small></span></div>`;
      }).join('');
      const head = won ? `${L.teams[L.winner].map((pid) => `${esc(nm(pid))}${pid === S.me.id ? ' (bạn)' : ''}`).join(' & ')} thắng!` : 'Trận đấu bị dừng';
      html = `<div class="panel"><div class="result-head"><div class="trophy">${won ? '🏆' : '🏁'}</div><div>
          <h2>${head}</h2><p>Trận ${L.no} · pha cầu dài nhất ${L.longest} chạm.</p></div></div>
        <div class="results">${rows}</div>
        <div class="start-row" style="margin-top:14px">${host
          ? `${btn('lobby', '🏠 Về phòng chờ', 'ghost')}${btn('next', '🏸 Trận tiếp theo', 'primary', S.players.length < need ? 'disabled' : '')}`
          : '<span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu trận mới…</span>'}</div></div>${queuePanel()}${host ? botPanel() + settingsPanel() : ''}`;
    } else {
      const start = host
        ? `<div class="start-row"><div><span class="gh-muted">${S.players.length}/${S.maxPlayers} người${S.players.length < need ? ` — cần ${need} người, thêm bot nhé!` : ' — sẵn sàng!'}</span></div>
           ${btn('start', '🏸 Vào sân', 'primary', S.players.length < need ? 'disabled' : '')}</div>`
        : '<div class="start-row"><span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu…</span></div>';
      html = `<div class="panel"><h3>📨 Mời bạn bè</h3><div class="invite"><div class="bigcode">${ROOM}</div><div class="link">${esc(inviteLink())}</div>
          ${btn('copy-link', '⧉ Sao chép link', 'small')} ${btn('edit-look', '👗 Đổi nhân vật', 'small')}</div></div>
        ${host ? botPanel() : ''}${settingsPanel()}${S.players.length > need ? queuePanel() : ''}${keysPanel()}<div class="panel">${start}</div>`;
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
    $('#phase-pill').textContent = S.phase === 'lobby' ? '🏠 Phòng chờ' : S.phase === 'end' ? `🏁 Hết trận ${S.matchNo}` : `🏸 Trận ${S.matchNo}`;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `Cầu Lông ${ROOM}`;
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
            actions: [{ label: 'Đánh tiếp', kind: 'ghost' }, { label: '🛑 Dừng', kind: 'danger', onClick: () => send('stop') }],
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
    try { localStorage.setItem('caulong_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) play('hit');
  });
  $('#btn-room').addEventListener('click', async () => { if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good'); });
  $('#btn-leave').addEventListener('click', () => {
    const doLeave = () => { if (conn) conn.leave(); setTimeout(() => { location.href = '/'; }, 150); };
    if (S && S.phase === 'play' && S.me.court) {
      P.modal({
        title: 'Rời trận đấu?',
        body: '<p>Bạn đang đánh — rời phòng quá 10 giây là bị <b>xử thua</b>.</p>',
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
