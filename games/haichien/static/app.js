(function () {
  const P = window.Platform;
  const $ = (s) => document.querySelector(s);
  const esc = P.esc;
  const ROOM = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (!ROOM) { location.href = '/'; return; }

  let S = null;          // trạng thái mới nhất từ máy chủ
  let conn = null;
  let clockOffset = 0;
  const ui = {
    lastSeq: null, tab: 'players', unread: 0, lastChatId: null, lanBase: null, sound: true,
    place: {}, sel: null, rot: 0, hover: null, placeGame: null, sinking: new Set(),
    pending: new Set(), pendingSunk: new Set(), firing: false, wasMine: false,
  };
  try { ui.sound = localStorage.getItem('haichien_sound') !== '0'; } catch (e) { /* bỏ qua */ }
  // Đồ hoạ nhẹ: tắt các hiệu ứng chạy liên tục, giảm hạt khi nổ — cho máy yếu / điện thoại.
  try {
    const saved = localStorage.getItem('haichien_lite');
    ui.lite = saved === null ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : saved === '1';
  } catch (e) { ui.lite = false; }
  document.body.classList.toggle('lite', ui.lite);
  (() => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><filter id='c' x='0' y='0' width='100%' height='100%'>
      <feTurbulence type='turbulence' baseFrequency='0.02 0.026' numOctaves='1' seed='7' stitchTiles='stitch'/>
      <feColorMatrix values='0 0 0 0 0.85  0 0 0 0 0.97  0 0 0 0 1  -30 0 0 0 2.4'/></filter><rect width='256' height='256' filter='url(#c)'/></svg>`;
    document.documentElement.style.setProperty('--caustic', `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`);
  })();

  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
  };
  const LEVEL_NAMES = { easy: 'Dễ', normal: 'Vừa', hard: 'Khó' };
  const ROWS = 'ABCDEFGHIJKLMN';

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
  const fmtTime = (t) => new Date(t * 1000).toTimeString().slice(0, 5);
  const btn = (act, text, kind = '', extra = '') => `<button class="gh-btn ${kind}" data-act="${act}" ${extra}>${text}</button>`;
  const N = () => (S && S.n) || 10;
  let cast = null;
  function anchorEl(pid) {
    const a = cast && cast.anchor(pid);
    if (a) return a;
    return document.querySelector(`#plist [data-pid="${CSS.escape(pid || '')}"] .ava`);
  }
  const rectOf = (el) => (el ? el.getBoundingClientRect() : null);
  // Bảng bên trái / phải: người chơi thấy mình bên trái, đối thủ bên phải; người xem thấy theo thứ tự.
  const sides = () => {
    if (!S || !S.order.length) return [null, null];
    if (S.me.playing) return [S.me.id, S.order.find((p) => p !== S.me.id)];
    return [S.order[0], S.order[1]];
  };
  const seaOf = (owner) => (sides()[0] === owner ? $('#sea-me') : $('#sea-foe'));

  // ---------------------------------------------------------------- âm thanh
  let actx = null;
  function ctxA() {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function beep(notes) {
    if (!ui.sound) return;
    try {
      const a = ctxA();
      let t = a.currentTime;
      notes.forEach(([freq, dur, type = 'sine', vol = 0.08]) => {
        const o = a.createOscillator();
        const g = a.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(a.destination);
        o.start(t); o.stop(t + dur);
        t += dur * 0.8;
      });
    } catch (e) { /* bỏ qua */ }
  }
  // Tiếng nổ / té nước: nhiễu trắng qua bộ lọc.
  function noise(dur, freq, vol, type = 'lowpass') {
    if (!ui.sound) return;
    try {
      const a = ctxA();
      const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
      const src = a.createBufferSource();
      src.buffer = buf;
      const f = a.createBiquadFilter();
      f.type = type; f.frequency.value = freq;
      const g = a.createGain();
      g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(a.destination);
      src.start();
    } catch (e) { /* bỏ qua */ }
  }
  const SOUND = {
    launch: () => beep([[700, 0.25, 'sawtooth', 0.025], [300, 0.3, 'sawtooth', 0.02]]),
    boom: () => { noise(0.7, 600, 0.55); beep([[90, 0.35, 'sine', 0.12]]); },
    sunk: () => { noise(1.2, 400, 0.7); beep([[70, 0.6, 'sine', 0.14], [55, 0.6, 'sine', 0.1]]); },
    splash: () => noise(0.45, 2500, 0.25, 'highpass'),
    turn: () => beep([[660, 0.12], [880, 0.18]]),
    place: () => beep([[440, 0.06, 'triangle', 0.06]]),
    ready: () => beep([[523, 0.1], [784, 0.16]]),
    win: () => beep([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]]),
    lose: () => beep([[392, 0.2, 'triangle'], [330, 0.2, 'triangle'], [262, 0.4, 'triangle']]),
  };

  // ---------------------------------------------------------------- kết nối
  function connect() {
    conn = P.connect({
      room: ROOM,
      onState,
      onFx,
      onStatus: (on) => $('#conn').classList.toggle('off', !on),
      onFatal: (m) => P.showFatal(m, { onRetryName: () => connect() }),
    });
  }

  function onState(state) {
    const first = S === null;
    S = state;
    clockOffset = state.now - Date.now() / 1000;
    const events = state.events || [];
    let fresh = [];
    if (ui.lastSeq === null) ui.lastSeq = events.length ? events[events.length - 1].seq : 0;
    else fresh = events.filter((e) => e.seq > ui.lastSeq);
    if (events.length) ui.lastSeq = Math.max(ui.lastSeq, events[events.length - 1].seq);
    // Phát bắn mới: giấu dấu trúng/trượt (và tàu vừa chìm) tới khi quả đạn bay tới nơi.
    fresh.filter((e) => e.type === 'shot').forEach((e) => {
      const owner = S.order.find((p) => p !== e.pid);
      ui.pending.add(`${owner}:${e.x}:${e.y}`);
      if (e.sunk) ui.pendingSunk.add(`${owner}:${e.sunk.id}`);
    });
    if (S.phase === 'play' && S.stage === 'place' && ui.placeGame !== S.gameNo) {
      ui.placeGame = S.gameNo; ui.place = {}; ui.sel = S.fleet[0].id; ui.rot = 0;
    }
    ui.firing = false;
    const mine = S.phase === 'play' && S.stage === 'battle' && S.turn === S.me.id;
    if (mine && !ui.wasMine && !first) setTimeout(() => SOUND.turn(), 700);
    ui.wasMine = mine;
    render();
    fresh.forEach(playEvent);
  }

  // ---------------------------------------------------------------- hình khối tàu
  // Xoay các ô rot × 90° theo chiều kim đồng hồ rồi dời về góc (0, 0) — giống fleet.py.
  function rotateCells(cells, rot) {
    let out = cells.map(([x, y]) => [x, y]);
    for (let i = 0; i < ((rot % 4) + 4) % 4; i++) out = out.map(([x, y]) => [-y, x]);
    const mx = Math.min(...out.map((c) => c[0]));
    const my = Math.min(...out.map((c) => c[1]));
    return out.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  const fleetOf = (sid) => S.fleet.find((f) => f.id === sid);
  const effRot = (f, r) => (f.rots.includes(r) ? r : f.rots.includes(r % 2) ? r % 2 : f.rots[0]);
  function cellsAt(f, p) { return rotateCells(f.cells, effRot(f, p.rot || 0)).map(([dx, dy]) => [p.x + dx, p.y + dy]); }

  // ---------------------------------------------------------------- vẽ tàu (SVG)
  const TONES = {
    steel: { hi: '#c3ced9', mid: '#7f8d9c', lo: '#3c4855', deck: '#9aa6b2', deck2: '#8794a1', edge: '#26303b' },
    enemy: { hi: '#c9a39a', mid: '#8a5d55', lo: '#4a2c28', deck: '#a07a70', deck2: '#8e6a61', edge: '#2e1a17' },
  };
  function turret(cx, cy, r, ang, t) {
    return `<g transform="rotate(${ang} ${cx} ${cy})"><rect x="${cx}" y="${cy - r * 0.22}" width="${r * 2.3}" height="${r * 0.44}" rx="${r * 0.2}" fill="${t.lo}"/>
      <rect x="${cx}" y="${cy - r * 0.62}" width="${r * 2.1}" height="${r * 0.3}" rx="${r * 0.14}" fill="${t.lo}" opacity=".85"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${t.mid}" stroke="${t.edge}" stroke-width="2.5"/><circle cx="${cx - r * 0.25}" cy="${cy - r * 0.25}" r="${r * 0.45}" fill="${t.hi}" opacity=".7"/></g>`;
  }
  // Tàu thẳng: nằm ngang, mũi bên phải. Có vệt sóng đuôi, bọt mũi tàu, sàn ván, chi tiết theo loại.
  function shipSVG(type, len, tone = 'steel') {
    const t = TONES[tone];
    const W = len * 100;
    const id = `s${type}${len}${tone}`;   // cố định → HTML không đổi giữa các lần vẽ (không dựng lại SVG)
    const sub = type === 'S3';
    const top = sub ? 26 : 15;
    const bot = 100 - top;
    const hull = `M10 50 Q10 ${top + 2} ${sub ? 60 : 44} ${top} L${W - 78} ${top} Q${W - 14} ${top + 6} ${W - 2} 50 Q${W - 14} ${bot - 6} ${W - 78} ${bot} L${sub ? 60 : 44} ${bot} Q10 ${bot - 2} 10 50Z`;
    const deckPath = `M24 50 Q24 ${top + 12} ${sub ? 66 : 52} ${top + 10} L${W - 84} ${top + 10} Q${W - 30} ${top + 15} ${W - 20} 50 Q${W - 30} ${bot - 15} ${W - 84} ${bot - 10} L${sub ? 66 : 52} ${bot - 10} Q24 ${bot - 12} 24 50Z`;
    let deck = '';
    if (type === 'I5') {
      deck = `<path d="${deckPath}" fill="#4b5663"/>
        <path d="M44 50 H${W - 90}" stroke="#f2f4f6" stroke-width="3" stroke-dasharray="18 12"/>
        <path d="M44 ${top + 16} L${W * 0.45} 50" stroke="#f5c542" stroke-width="2.5" opacity=".75"/>
        <rect x="${W * 0.6}" y="${top - 6}" width="70" height="24" rx="5" fill="${t.mid}" stroke="${t.edge}" stroke-width="2"/>
        <rect x="${W * 0.6 + 8}" y="${top}" width="30" height="10" rx="2" fill="#8fd7ff"/><circle cx="${W * 0.6 + 56}" cy="${top + 6}" r="6" fill="${t.hi}"/>
        <path d="M70 70 l22 -8 l22 8 l-22 5z M${W * 0.36} 70 l22 -8 l22 8 l-22 5z M${W * 0.36} 34 l22 -8 l22 8 l-22 5z" fill="#d6dde4" opacity=".9"/>`;
    } else if (type === 'I4') {
      deck = `<path d="${deckPath}" fill="url(#d${id})"/>
        <rect x="${W * 0.38}" y="32" width="${W * 0.22}" height="36" rx="8" fill="${t.hi}" stroke="${t.edge}" stroke-width="2"/>
        <rect x="${W * 0.43}" y="39" width="${W * 0.11}" height="22" rx="5" fill="${t.mid}"/><circle cx="${W * 0.485}" cy="50" r="5" fill="#8fd7ff"/>
        ${turret(W * 0.2, 50, 15, 180, t)}${turret(W * 0.72, 50, 14, 0, t)}${turret(W * 0.86, 50, 12, 0, t)}`;
    } else if (type === 'I3') {
      deck = `<path d="${deckPath}" fill="url(#d${id})"/>
        <rect x="${W * 0.36}" y="33" width="${W * 0.27}" height="34" rx="9" fill="${t.hi}" stroke="${t.edge}" stroke-width="2"/>
        <path d="M${W * 0.5} 33 V14" stroke="${t.edge}" stroke-width="3"/><path d="M${W * 0.44} 20 H${W * 0.56}" stroke="${t.edge}" stroke-width="2.5"/>
        <circle cx="${W * 0.5}" cy="14" r="4" fill="#ff5d5d"/>${turret(W * 0.2, 50, 13, 180, t)}${turret(W * 0.8, 50, 13, 0, t)}`;
    } else if (type === 'S3') {
      deck = `<path d="M40 50 H${W - 40}" stroke="${t.hi}" stroke-width="2" stroke-dasharray="7 9" opacity=".7"/>
        <rect x="${W * 0.42}" y="35" width="${W * 0.16}" height="30" rx="14" fill="${t.mid}" stroke="${t.edge}" stroke-width="2.5"/>
        <path d="M${W * 0.5} 35 V16 h12" stroke="${t.edge}" stroke-width="3" fill="none"/><circle cx="${W * 0.5 + 12}" cy="16" r="3" fill="#8fd7ff"/>
        <path d="M${W * 0.47} 28 h${W * 0.06} M${W * 0.47} 72 h${W * 0.06}" stroke="${t.edge}" stroke-width="5" stroke-linecap="round"/>`;
    } else {
      deck = `<path d="${deckPath}" fill="url(#d${id})"/>
        <rect x="${W * 0.34}" y="34" width="${W * 0.26}" height="32" rx="9" fill="${t.hi}" stroke="${t.edge}" stroke-width="2"/>
        <circle cx="${W * 0.47}" cy="50" r="5" fill="#8fd7ff"/>${turret(W * 0.78, 50, 11, 0, t)}`;
    }
    const planks = type === 'I5' || sub ? '' : Array.from({ length: Math.floor(W / 26) }, (_, i) => `<path d="M${30 + i * 26} ${top + 12} V${bot - 12}" stroke="rgba(0,0,0,.12)" stroke-width="1.2"/>`).join('');
    return `<svg viewBox="0 0 ${W} 100" preserveAspectRatio="none"><defs>
      <linearGradient id="h${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${t.hi}"/><stop offset=".5" stop-color="${t.mid}"/><stop offset="1" stop-color="${t.lo}"/></linearGradient>
      <linearGradient id="d${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${t.deck}"/><stop offset="1" stop-color="${t.deck2}"/></linearGradient></defs>
      <g class="foam"><path d="M8 38 Q-18 30 -46 20 M8 62 Q-18 70 -46 80" stroke="rgba(235,250,255,.7)" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M${W - 6} 40 Q${W + 8} 50 ${W - 6} 60" stroke="rgba(240,252,255,.9)" stroke-width="6" fill="none" stroke-linecap="round"/></g>
      <g class="bob"><path d="${hull}" fill="url(#h${id})" stroke="${t.edge}" stroke-width="3.5"/>
      <path d="${hull}" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="1.5" transform="translate(0 -2)"/>
      ${planks}${deck}</g></svg>`;
  }
  // Tàu đa hình (pháo đài nổi, tàu chữ L/T/Z…): ghép các ô thành một khối liền, sàn thép, tháp pháo / bãi trực thăng / container.
  function shapeSVG(type, cells, tone = 'steel') {
    const t = TONES[tone];
    const w = Math.max(...cells.map((c) => c[0])) + 1;
    const h = Math.max(...cells.map((c) => c[1])) + 1;
    const id = `p${type}${tone}${cells.map((c) => c.join('')).join('')}`;
    const has = new Set(cells.map(([x, y]) => `${x},${y}`));
    const blocks = (pad, r, fill, extra = '') => {
      let out = '';
      cells.forEach(([x, y]) => {
        out += `<rect x="${x * 100 + pad}" y="${y * 100 + pad}" width="${100 - 2 * pad}" height="${100 - 2 * pad}" rx="${r}" fill="${fill}" ${extra}/>`;
        if (has.has(`${x + 1},${y}`)) out += `<rect x="${x * 100 + 50}" y="${y * 100 + pad}" width="100" height="${100 - 2 * pad}" fill="${fill}" ${extra}/>`;
        if (has.has(`${x},${y + 1}`)) out += `<rect x="${x * 100 + pad}" y="${y * 100 + 50}" width="${100 - 2 * pad}" height="100" fill="${fill}" ${extra}/>`;
        if (has.has(`${x + 1},${y}`) && has.has(`${x},${y + 1}`) && has.has(`${x + 1},${y + 1}`)) out += `<rect x="${x * 100 + 50}" y="${y * 100 + 50}" width="100" height="100" fill="${fill}" ${extra}/>`;
      });
      return out;
    };
    const center = (list) => [list.reduce((a, c) => a + c[0], 0) / list.length * 100 + 50, list.reduce((a, c) => a + c[1], 0) / list.length * 100 + 50];
    let feat = '';
    const sq = cells.find(([x, y]) => has.has(`${x + 1},${y}`) && has.has(`${x},${y + 1}`) && has.has(`${x + 1},${y + 1}`));
    if (sq && (type === 'O4' || type === 'P5')) {
      const cx = sq[0] * 100 + 100; const cy = sq[1] * 100 + 100;
      feat += `<circle cx="${cx}" cy="${cy}" r="54" fill="#3d4753" stroke="#f5c542" stroke-width="5"/><text x="${cx}" y="${cy + 19}" font-size="54" font-weight="900" text-anchor="middle" fill="#f2f4f6" font-family="Arial">H</text>`;
      const rest = cells.filter(([x, y]) => !(x >= sq[0] && x <= sq[0] + 1 && y >= sq[1] && y <= sq[1] + 1));
      rest.forEach(([x, y]) => { feat += `<circle cx="${x * 100 + 50}" cy="${y * 100 + 50}" r="24" fill="#e8edf2" stroke="${t.edge}" stroke-width="3"/><path d="M${x * 100 + 34} ${y * 100 + 50} H${x * 100 + 66}" stroke="${t.mid}" stroke-width="3"/>`; });
      if (type === 'O4') [[sq[0], sq[1]], [sq[0] + 1, sq[1] + 1]].forEach(([x, y]) => { feat += turret(x * 100 + 30, y * 100 + 30, 12, 225, t); });
    } else if (type === 'T4') {
      const [cx, cy] = center(cells);
      feat += `<rect x="${cx - 40}" y="${cy - 40}" width="80" height="80" rx="12" fill="${t.hi}" stroke="${t.edge}" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="12" fill="#8fd7ff"/>`;
      cells.forEach(([x, y]) => { if (Math.abs(x * 100 + 50 - cx) + Math.abs(y * 100 + 50 - cy) > 60) feat += turret(x * 100 + 50, y * 100 + 50, 16, Math.atan2(y * 100 + 50 - cy, x * 100 + 50 - cx) * 57.3, t); });
    } else if (type === 'Z4') {
      const colors = ['#e2574c', '#f5b843', '#3d9be0', '#46b07a'];
      cells.forEach(([x, y], i) => { for (let k = 0; k < 3; k++) feat += `<rect x="${x * 100 + 22}" y="${y * 100 + 20 + k * 22}" width="56" height="17" rx="2" fill="${colors[(i + k) % 4]}" stroke="rgba(0,0,0,.35)" stroke-width="1.5"/>`; });
    } else if (type === 'L4' || type === 'L3') {
      const corner = cells.find(([x, y]) => (has.has(`${x + 1},${y}`) || has.has(`${x - 1},${y}`)) && (has.has(`${x},${y + 1}`) || has.has(`${x},${y - 1}`)));
      cells.forEach(([x, y]) => {
        if (corner && x === corner[0] && y === corner[1]) feat += `<rect x="${x * 100 + 22}" y="${y * 100 + 22}" width="56" height="56" rx="10" fill="${t.hi}" stroke="${t.edge}" stroke-width="3"/><path d="M${x * 100 + 50} ${y * 100 + 50} l34 -30" stroke="#f5c542" stroke-width="5" stroke-linecap="round"/><circle cx="${x * 100 + 50}" cy="${y * 100 + 50}" r="8" fill="${t.edge}"/>`;
        else feat += `<path d="M${x * 100 + 26} ${y * 100 + 32} h48 M${x * 100 + 26} ${y * 100 + 50} h48 M${x * 100 + 26} ${y * 100 + 68} h48" stroke="rgba(0,0,0,.25)" stroke-width="4" stroke-linecap="round"/>`;
      });
    }
    return `<svg viewBox="0 0 ${w * 100} ${h * 100}" preserveAspectRatio="none"><defs>
      <linearGradient id="h${id}" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${t.hi}"/><stop offset=".55" stop-color="${t.mid}"/><stop offset="1" stop-color="${t.lo}"/></linearGradient>
      <pattern id="p${id}" width="25" height="25" patternUnits="userSpaceOnUse"><rect width="25" height="25" fill="${t.deck}"/><path d="M0 0 H25 M0 0 V25" stroke="rgba(0,0,0,.14)" stroke-width="2"/><circle cx="3" cy="3" r="1.4" fill="rgba(0,0,0,.25)"/></pattern></defs>
      <g class="foam">${blocks(-2, 22, 'none', 'stroke="rgba(235,250,255,.55)" stroke-width="5"')}</g>
      <g class="bob">${blocks(5, 20, t.edge)}${blocks(8, 17, `url(#h${id})`)}${blocks(18, 10, `url(#p${id})`)}${feat}</g></svg>`;
  }
  // Phần tử tàu đặt lên lưới theo các ô thực của nó.
  function shipEl(s, cls = '') {
    const n = N();
    const f = fleetOf(s.id) || s;
    const cells = s.cells || cellsAt(f, s);
    const xs = cells.map((c) => c[0]); const ys = cells.map((c) => c[1]);
    const x0 = Math.min(...xs); const y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0 + 1; const h = Math.max(...ys) - y0 + 1;
    const tone = cls.includes('enemy') ? 'enemy' : 'steel';
    if (f.kind === 'line') {
      const vert = h > w;
      const len = Math.max(w, h);
      return `<div class="ship ${vert ? 'v' : ''} ${cls}" data-ship="${s.id}" style="left:${(x0 / n) * 100}%;top:${(y0 / n) * 100}%;width:${(len / n) * 100}%;height:${100 / n}%">${shipSVG(f.type, len, tone)}</div>`;
    }
    const rel = cells.map(([x, y]) => [x - x0, y - y0]);
    return `<div class="ship ${cls}" data-ship="${s.id}" style="left:${(x0 / n) * 100}%;top:${(y0 / n) * 100}%;width:${(w / n) * 100}%;height:${(h / n) * 100}%">${shapeSVG(f.type, rel, tone)}</div>`;
  }
  // Hình tàu nhỏ (bến tàu, xem trước hạm đội).
  function miniShip(f, unit = 13) {
    const cells = f.kind === 'line' ? f.cells : f.cells;
    const w = Math.max(...cells.map((c) => c[0])) + 1;
    const h = Math.max(...cells.map((c) => c[1])) + 1;
    const svg = f.kind === 'line' ? shipSVG(f.type, w) : shapeSVG(f.type, cells);
    return `<span class="mini-ship" style="width:${w * unit * (f.kind === 'line' ? 2 : 1)}px;height:${h * unit * (f.kind === 'line' ? 2 : 1)}px">${svg}</span>`;
  }

  // ---------------------------------------------------------------- vùng biển
  function ensureSea(el) {
    const n = N();
    if (el.dataset.n === String(n)) return;
    el.dataset.n = n;
    htmlCache.delete(el.querySelector('.ships'));
    htmlCache.delete(el.querySelector('.marks'));
    el.style.setProperty('--n', n);
    el.innerHTML = `<div class="water"><div class="caustic"></div><div class="caustic b"></div><div class="swell"></div><div class="glint"></div></div><div class="gridlines"></div>
      <div class="labels-x">${Array.from({ length: n }, (_, i) => `<span>${i + 1}</span>`).join('')}</div>
      <div class="labels-y">${Array.from({ length: n }, (_, i) => `<span>${ROWS[i]}</span>`).join('')}</div>
      <div class="ships"></div>
      <div class="marks"></div>
      <div class="cells">${Array.from({ length: n * n }, (_, k) => `<div class="cell" data-x="${k % n}" data-y="${Math.floor(k / n)}"></div>`).join('')}</div>`;
  }
  function placeError(place, sid, cand) {
    const n = N();
    const cs = cellsAt(fleetOf(sid), cand);
    if (cs.some(([x, y]) => x < 0 || y < 0 || x >= n || y >= n)) return true;
    const taken = new Map();
    Object.entries(place).forEach(([id, p]) => { if (id !== sid) cellsAt(fleetOf(id), p).forEach(([x, y]) => taken.set(`${x},${y}`, id)); });
    if (cs.some(([x, y]) => taken.has(`${x},${y}`))) return true;
    if (S.config.no_touch) {
      for (const [x, y] of cs) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (taken.has(`${x + dx},${y + dy}`)) return true;
    }
    return false;
  }

  function renderSea(owner, role) {
    const el = seaOf(owner);
    ensureSea(el);
    const board = S.boards[owner];
    const placing = S.phase === 'play' && S.stage === 'place';
    const editing = placing && owner === S.me.id && !S.me.ready;
    let ships = '';
    if (editing) {
      ships = Object.entries(ui.place).map(([sid, p]) => shipEl({ id: sid, ...p })).join('');
      if (ui.sel && ui.hover) {
        const cand = { x: ui.hover[0], y: ui.hover[1], rot: ui.rot };
        ships += shipEl({ id: ui.sel, ...cand, cells: cellsAt(fleetOf(ui.sel), cand) }, `preview ${placeError(ui.place, ui.sel, cand) ? 'bad' : ''}`);
      }
    } else if (board) {
      ships = board.ships.filter((s) => !ui.pendingSunk.has(`${owner}:${s.id}`))
        .map((s) => shipEl(s, `${s.sunk ? 'sunk' : ''} ${owner !== S.me.id ? 'enemy' : ''} ${ui.sinking.has(`${owner}:${s.id}`) ? 'sinking' : ''}`)).join('');
    }
    setHTML(el.querySelector('.ships'), ships);
    const n = N();
    const last = S.last;
    const shotSet = new Set();
    const sunkCells = new Set();
    if (board) board.ships.filter((s) => s.sunk).forEach((s) => s.cells.forEach(([x, y]) => sunkCells.add(`${x},${y}`)));
    const marks = board && !placing ? board.shots.filter((s) => !ui.pending.has(`${owner}:${s.x}:${s.y}`)).map((s) => {
      shotSet.add(`${s.x},${s.y}`);
      const st = `left:${(s.x / n) * 100}%;top:${(s.y / n) * 100}%;width:${100 / n}%;height:${100 / n}%`;
      const isLast = last && last.x === s.x && last.y === s.y && S.order.find((p) => p !== last.pid) === owner;
      if (s.r === 'miss') return `<div class="mark miss ${isLast ? 'last' : ''}" style="${st}"><i class="rip"></i><i class="rip b"></i><i class="buoy"></i></div>`;
      const onShip = board.ships.some((sh) => sh.cells.some(([x, y]) => x === s.x && y === s.y));
      const ember = sunkCells.has(`${s.x},${s.y}`);
      return `<div class="mark hit ${onShip ? '' : 'water'} ${ember ? 'ember' : ''} ${isLast ? 'last' : ''}" style="${st}"><i class="scorch"></i><i class="smoke"></i><i class="smoke b"></i><i class="flame c"></i><i class="flame b"></i><i class="flame"></i></div>`;
    }).join('') : '';
    setHTML(el.querySelector('.marks'), marks);
    el.querySelectorAll('.cell').forEach((c) => c.classList.toggle('shot', shotSet.has(`${c.dataset.x},${c.dataset.y}`)));
    const target = S.phase === 'play' && S.stage === 'battle' && role === 'foe' && S.turn === S.me.id && !ui.firing;
    el.classList.toggle('target', target);
    el.classList.toggle('placing', editing);
  }

  function headHTML(owner, role) {
    const p = player(owner);
    if (!p) return '';
    const board = S.boards[owner];
    const acc = p.shots ? Math.round((100 * p.hits) / p.shots) : 0;
    const label = S.me.playing ? (role === 'me' ? 'Hạm đội của bạn' : 'Vùng biển địch') : 'Hạm đội';
    let flag = '';
    if (S.phase === 'play' && S.stage === 'battle' && S.turn === owner) flag = `<span class="turnflag">🎯 ${owner === S.me.id ? 'LƯỢT BẠN' : 'ĐANG BẮN'}</span>`;
    if (S.phase === 'play' && S.stage === 'place') flag = p.ready ? '<span class="turnflag calm" style="background:#3ecf8e">✅ Sẵn sàng</span>' : '<span class="turnflag calm wait">⏳ đang xếp tàu…</span>';
    if (S.phase === 'end' && S.winner === owner) flag = '<span class="turnflag calm">🏆 THẮNG</span>';
    return `<div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>
      <div class="t"><b>${who(owner)}${p.bot ? ' 🤖' : ''}</b><small>${label}</small></div>${flag}
      <div class="stat">🚢 <b>${board ? board.afloat : S.fleet.length}</b>/${S.fleet.length} tàu<br>🎯 ${p.shots} phát · ${acc}%</div>`;
  }
  function fleetHTML(owner) {
    const board = S.boards[owner];
    const sunk = new Set(board ? board.sunk.filter((sid) => !ui.pendingSunk.has(`${owner}:${sid}`)) : []);
    return S.fleet.map((f) => `<span class="fchip ${sunk.has(f.id) ? 'sunk' : ''}"><span class="pips">${'<i></i>'.repeat(f.size)}</span>${esc(f.name)}</span>`).join('');
  }

  function renderWar() {
    const war = $('#war');
    war.hidden = S.phase === 'lobby' || !S.order.length;
    if (war.hidden) return;
    const [left, right] = sides();
    const pairs = [[left, 'me', '#side-me', '#head-me', '#fleet-me'], [right, 'foe', '#side-foe', '#head-foe', '#fleet-foe']];
    pairs.forEach(([owner, role, side, head, fleet]) => {
      const sideEl = $(side);
      const p = player(owner);
      sideEl.classList.toggle('foe', role === 'foe');
      sideEl.style.setProperty('--pc', (p && p.color) || '#888');
      sideEl.classList.toggle('active', S.phase === 'play' && S.stage === 'battle' && S.turn && S.turn !== owner);
      setHTML($(head), headHTML(owner, role));
      setHTML($(fleet), fleetHTML(owner));
      renderSea(owner, S.me.playing ? role : 'view');
    });
  }

  function renderDock() {
    const el = $('#dock');
    const placing = S.phase === 'play' && S.stage === 'place' && S.me.playing;
    if (!placing) { setHTML(el, ''); return; }
    if (S.me.ready) {
      setHTML(el, `<div class="dhead"><h3>✅ Hạm đội đã sẵn sàng!</h3>${btn('unready', '✏️ Sửa lại', 'ghost small')}</div>
        <div class="hint">Đang chờ đối thủ xếp tàu… Hết giờ, ai chưa xong sẽ được xếp ngẫu nhiên.</div>`);
      return;
    }
    const placed = Object.keys(ui.place).length;
    const list = S.fleet.map((f) => `<button class="dship ${ui.sel === f.id ? 'sel' : ''} ${ui.place[f.id] ? 'placed' : ''}" data-pick="${f.id}">
      <span class="sv">${miniShip(f, 13)}</span><small>${esc(f.name)} · ${f.size} ô</small></button>`).join('');
    setHTML(el, `<div class="dhead"><h3>🚢 Xếp hạm đội (${placed}/${S.fleet.length})</h3>
        ${btn('rotate', `🔄 Xoay ${['→', '↓', '←', '↑'][ui.rot]}`, 'small')}${btn('random', '🎲 Xếp ngẫu nhiên', 'small')}${btn('clear', '🧹 Xoá hết', 'small ghost')}
        ${btn('ready', '⚓ Sẵn sàng', 'gold', placed < S.fleet.length ? 'disabled' : '')}</div>
      <div class="ships-list">${list}</div>
      <div class="hint">Chọn tàu rồi bấm lên <b>Hạm đội của bạn</b> để đặt · bấm vào tàu đã đặt để nhấc lên · phím <b>R</b> để xoay 90°${S.config.no_touch ? ' · <b>không được đặt các tàu sát nhau</b>' : ''}.</div>`);
  }

  // ---------------------------------------------------------------- hiệu ứng bắn
  function cellRect(owner, x, y) {
    const c = seaOf(owner).querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
    return rectOf(c);
  }
  // Tạo một hạt hiệu ứng tại (x, y) cửa sổ, chạy keyframes rồi tự xoá.
  function particle(x, y, cls, frames, opts) {
    const box = document.createElement('div');
    box.className = 'flash';
    box.style.left = `${x}px`; box.style.top = `${y}px`;
    const i = document.createElement('i');
    i.className = cls;
    box.appendChild(i);
    document.body.appendChild(box);
    const a = i.animate(frames, { fill: 'forwards', ...opts });
    a.onfinish = () => box.remove();
    setTimeout(() => box.remove(), (opts.duration || 600) + (opts.delay || 0) + 200);
  }
  const C = 'translate(-50%, -50%)';
  function explode(r, big = false) {
    if (!r) return;
    const x = r.left + r.width / 2; const y = r.top + r.height / 2;
    const k = Math.max(0.6, r.width / 42) * (big ? 1.5 : 1);
    particle(x, y, 'fl', [{ transform: `${C} scale(.2)`, opacity: 1 }, { transform: `${C} scale(${1.6 * k})`, opacity: 0 }], { duration: 260, easing: 'ease-out' });
    particle(x, y, 'fb', [{ transform: `${C} scale(.3)`, opacity: 1 }, { transform: `${C} scale(${2.4 * k})`, opacity: 0.9, offset: 0.35 }, { transform: `${C} scale(${2.9 * k})`, opacity: 0 }], { duration: 700, easing: 'ease-out' });
    particle(x, y, 'sw', [{ transform: `${C} scale(1)`, opacity: 0.9 }, { transform: `${C} scale(${5 * k})`, opacity: 0 }], { duration: 520, easing: 'ease-out' });
    const many = ui.lite ? 0.4 : 1;
    for (let i = 0; i < Math.round((big ? 14 : 9) * many); i++) {
      const a = Math.random() * Math.PI * 2;
      const d = (30 + Math.random() * 40) * k;
      const dx = Math.cos(a) * d; const dy = Math.sin(a) * d * 0.7 - 30 * k;
      particle(x, y, 'db', [
        { transform: `${C} translate(0,0) rotate(0)`, opacity: 1 },
        { transform: `${C} translate(${dx * 0.7}px, ${dy}px) rotate(${200 + Math.random() * 300}deg)`, opacity: 1, offset: 0.5 },
        { transform: `${C} translate(${dx}px, ${dy + 40 * k}px) rotate(${400 + Math.random() * 300}deg)`, opacity: 0 },
      ], { duration: 750, easing: 'ease-out' });
    }
    for (let i = 0; i < Math.round(10 * many); i++) {
      const a = Math.random() * Math.PI * 2; const d = (24 + Math.random() * 30) * k;
      particle(x, y, 'sp', [{ transform: `${C} translate(0,0)`, opacity: 1 }, { transform: `${C} translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) scale(.3)`, opacity: 0 }], { duration: 420, easing: 'ease-out' });
    }
    for (let i = 0; i < (ui.lite ? 1 : 3); i++) {
      particle(x + (Math.random() - 0.5) * 16 * k, y, 'sm', [{ transform: `${C} scale(.6)`, opacity: 0 }, { transform: `${C} translateY(${-10 * k}px) scale(1.4)`, opacity: 0.8, offset: 0.25 }, { transform: `${C} translateY(${-60 * k}px) scale(${3 * k})`, opacity: 0 }], { duration: 1500, delay: 150 + i * 120, easing: 'ease-out' });
    }
  }
  function splash(r) {
    if (!r) return;
    const x = r.left + r.width / 2; const y = r.top + r.height / 2;
    const k = Math.max(0.6, r.width / 42);
    particle(x, y + 10 * k, 'plume', [
      { transform: `translate(-50%, -100%) scale(${0.4 * k}, 0)`, opacity: 0.95 },
      { transform: `translate(-50%, -100%) scale(${1.05 * k}, ${1.5 * k})`, opacity: 0.95, offset: 0.35 },
      { transform: `translate(-50%, -100%) scale(${1.1 * k}, ${0.2 * k})`, opacity: 0 },
    ], { duration: 950, easing: 'ease-out' });
    for (let i = 0; i < (ui.lite ? 5 : 12); i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const d = (24 + Math.random() * 34) * k;
      const dx = Math.cos(a) * d; const up = Math.sin(a) * d - 20 * k;
      particle(x, y, 'drop', [
        { transform: `${C} translate(0,0) scale(1)`, opacity: 1 },
        { transform: `${C} translate(${dx * 0.6}px, ${up}px) scale(1)`, opacity: 1, offset: 0.45 },
        { transform: `${C} translate(${dx}px, ${12 * k}px) scale(.4)`, opacity: 0 },
      ], { duration: 800 + Math.random() * 200, easing: 'ease-out' });
    }
    for (let i = 0; i < 3; i++) {
      particle(x, y, 'rg', [{ transform: `${C} scale(.4) scaleY(.6)`, opacity: 0.9 }, { transform: `${C} scale(${3.6 * k}) scaleY(.6)`, opacity: 0 }], { duration: 1100, delay: i * 180, easing: 'ease-out' });
    }
  }
  function bubbleUp(cells, owner) {
    cells.forEach(([cx, cy]) => {
      const r = cellRect(owner, cx, cy);
      if (!r) return;
      for (let i = 0; i < 4; i++) {
        const x = r.left + r.width * (0.2 + Math.random() * 0.6); const y = r.top + r.height * (0.4 + Math.random() * 0.5);
        particle(x, y, 'bub', [{ transform: `${C} scale(.4)`, opacity: 0 }, { transform: `${C} translateY(-6px) scale(1)`, opacity: 1, offset: 0.3 }, { transform: `${C} translateY(-26px) scale(1.2)`, opacity: 0 }], { duration: 1200, delay: Math.random() * 1400, easing: 'ease-out' });
      }
    });
  }
  const MISSILE = `<svg viewBox="0 0 40 14"><path d="M6 7 L11 2.5 H29 Q37 3.5 40 7 Q37 10.5 29 11.5 H11Z" fill="#e3e8ee" stroke="#56606b" stroke-width="1"/>
    <path d="M30 3 Q37 4 40 7 Q37 10 30 11Z" fill="#c0392b"/><path d="M12 2.5 L7 -2 L15 2.5Z M12 11.5 L7 16 L15 11.5Z" fill="#7f8c99"/>
    <rect x="17" y="4.5" width="9" height="5" rx="1" fill="#c9d1da"/><ellipse cx="3" cy="7" rx="5" ry="3" fill="#ffb347"/><ellipse cx="2" cy="7" rx="3" ry="1.8" fill="#fff4c2"/></svg>`;
  function animateShot(e) {
    const owner = S.order.find((p) => p !== e.pid);
    const to = cellRect(owner, e.x, e.y);
    const fr = rectOf(seaOf(e.pid));
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      ui.pending.delete(`${owner}:${e.x}:${e.y}`);
      if (e.sunk) { ui.pendingSunk.delete(`${owner}:${e.sunk.id}`); ui.sinking.add(`${owner}:${e.sunk.id}`); setTimeout(() => ui.sinking.delete(`${owner}:${e.sunk.id}`), 2000); }
      render();
      const r = cellRect(owner, e.x, e.y);
      if (e.result === 'miss') { splash(r); SOUND.splash(); return; }
      explode(r, e.result === 'sunk');
      if (e.result === 'hit') { SOUND.boom(); return; }
      SOUND.sunk();
      const side = seaOf(owner).closest('.side-board');
      side.classList.remove('shake'); void side.offsetWidth; side.classList.add('shake');
      if (e.sunk) {
        e.sunk.cells.forEach(([x, y], i) => setTimeout(() => explode(cellRect(owner, x, y)), 120 + 110 * i));
        setTimeout(() => bubbleUp(e.sunk.cells, owner), 500);
      }
    };
    if (!to || !fr) { done(); return; }
    SOUND.launch();
    const sx = fr.left + fr.width / 2; const sy = fr.top + fr.height * 0.55;
    const tx = to.left + to.width / 2; const ty = to.top + to.height / 2;
    const lift = Math.max(110, Math.abs(tx - sx) * 0.4);
    const pos = (t) => [sx + (tx - sx) * t, sy + (ty - sy) * t - lift * 4 * t * (1 - t)];
    const m = document.createElement('div');
    m.className = 'missile';
    m.innerHTML = MISSILE;
    document.body.appendChild(m);
    particle(sx, sy, 'fl', [{ transform: `${C} scale(.2)`, opacity: 0.9 }, { transform: `${C} scale(1)`, opacity: 0 }], { duration: 300 });
    const dur = 720;
    const start = performance.now();
    let lastPuff = 0;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e2 = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
      const [x, y] = pos(e2);
      const [x2, y2] = pos(Math.min(1, e2 + 0.02));
      const ang = Math.atan2(y2 - y, x2 - x) * 57.3;
      m.style.transform = `translate(${x}px, ${y}px) rotate(${ang}deg) scale(${1 + 0.35 * Math.sin(Math.PI * t)})`;
      if (now - lastPuff > (ui.lite ? 60 : 30)) {
        lastPuff = now;
        const tail = [x - Math.cos(ang / 57.3) * 18, y - Math.sin(ang / 57.3) * 18];
        const p = document.createElement('div');
        p.className = 'puff';
        p.style.left = `${tail[0]}px`; p.style.top = `${tail[1]}px`;
        document.body.appendChild(p);
        p.animate([{ transform: 'scale(.6)', opacity: 0.85 }, { transform: `scale(${2.4 + Math.random()})`, opacity: 0 }], { duration: 650, easing: 'ease-out', fill: 'forwards' }).onfinish = () => p.remove();
      }
      if (t < 1) requestAnimationFrame(step);
      else { m.remove(); done(); }
    };
    requestAnimationFrame(step);
    setTimeout(() => { if (!finished) { m.remove(); done(); } }, dur + 400);
  }

  function playEvent(e) {
    switch (e.type) {
      case 'shot': animateShot(e); break;
      case 'ready': SOUND.ready(); if (e.pid) bubble(e.pid, '⚓', 'emoji'); break;
      case 'battle': SOUND.turn(); break;
      case 'win':
        setTimeout(() => {
          if (S.me.playing) (e.pid === S.me.id ? SOUND.win : SOUND.lose)();
          else SOUND.win();
          if (e.pid) { bubble(e.pid, '🏆', 'emoji'); if (cast) cast.react(e.pid, 'cheer'); }
        }, 900);
        break;
      default:
    }
  }

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

  // ---------------------------------------------------------------- tương tác bảng
  function placeRandom() {
    const n = N();
    const order = S.fleet.slice().sort((p, q) => q.size - p.size);
    for (let tries = 0; tries < 600; tries++) {
      const place = {};
      let ok = true;
      for (const f of order) {
        let done = false;
        for (let k = 0; k < 250 && !done; k++) {
          const rot = f.rots[Math.floor(Math.random() * f.rots.length)];
          const shape = rotateCells(f.cells, rot);
          const w = Math.max(...shape.map((c) => c[0])) + 1; const h = Math.max(...shape.map((c) => c[1])) + 1;
          const cand = { x: Math.floor(Math.random() * (n - w + 1)), y: Math.floor(Math.random() * (n - h + 1)), rot };
          if (!placeError(place, f.id, cand)) { place[f.id] = cand; done = true; }
        }
        if (!done) { ok = false; break; }
      }
      if (ok) { ui.place = place; ui.sel = null; return; }
    }
  }
  function nextUnplaced() { const f = S.fleet.find((s) => !ui.place[s.id]); return f ? f.id : null; }

  document.addEventListener('pointerover', (e) => {
    if (!S || !(S.phase === 'play' && S.stage === 'place' && !S.me.ready && S.me.playing)) return;
    const c = e.target.closest('#sea-me .cell');
    const h = c ? [Number(c.dataset.x), Number(c.dataset.y)] : null;
    if (JSON.stringify(h) !== JSON.stringify(ui.hover)) { ui.hover = h; renderWar(); }
  });
  document.addEventListener('pointerout', (e) => {
    if (!ui.hover || !e.target.closest('#sea-me')) return;
    if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('#sea-me')) return;
    ui.hover = null;
    if (S) renderWar();
  });

  document.addEventListener('click', async (e) => {
    if (!S) return;
    // Xếp tàu
    if (S.phase === 'play' && S.stage === 'place' && S.me.playing && !S.me.ready) {
      const pick = e.target.closest('[data-pick]');
      if (pick) { ui.sel = pick.dataset.pick; if (ui.place[ui.sel]) { ui.rot = ui.place[ui.sel].rot; delete ui.place[ui.sel]; } render(); return; }
      const cell = e.target.closest('#sea-me .cell');
      // Bấm vào ô có tàu đã đặt → nhấc tàu đó lên (lớp ô nằm trên lớp tàu nên kiểm tra theo toạ độ).
      const onShip = cell && Object.keys(ui.place).find((sid) => cellsAt(fleetOf(sid), ui.place[sid])
        .some(([x, y]) => x === Number(cell.dataset.x) && y === Number(cell.dataset.y)));
      if (onShip) {
        ui.rot = ui.place[onShip].rot; delete ui.place[onShip]; ui.sel = onShip; SOUND.place(); render(); return;
      }
      if (cell && ui.sel) {
        const cand = { x: Number(cell.dataset.x), y: Number(cell.dataset.y), rot: effRot(fleetOf(ui.sel), ui.rot) };
        if (placeError(ui.place, ui.sel, cand)) { P.toast('Không đặt được ở đây.', 'error', 1500); return; }
        ui.place[ui.sel] = cand;
        SOUND.place();
        ui.sel = nextUnplaced();
        render();
        return;
      }
    }
    // Bắn
    const tgt = e.target.closest('#sea-foe.target .cell:not(.shot)');
    if (tgt && S.me.playing) { ui.firing = true; renderWar(); send('fire', { x: Number(tgt.dataset.x), y: Number(tgt.dataset.y) }); return; }

    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled && actEl.dataset.act) {
      switch (actEl.dataset.act) {
        case 'rotate': ui.rot = (ui.rot + 1) % 4; render(); break;
        case 'random': placeRandom(); SOUND.place(); render(); break;
        case 'clear': ui.place = {}; ui.sel = S.fleet[0].id; render(); break;
        case 'ready': send('place', { ships: ui.place }); break;
        case 'unready': ui.place = {}; (S.boards[S.me.id].ships || []).forEach((s) => { ui.place[s.id] = { x: s.x, y: s.y, rot: s.rot }; }); ui.sel = null; send('unready'); break;
        case 'start': send('start'); break;
        case 'next': send('next_round'); break;
        case 'lobby': send('lobby'); break;
        case 'stop':
          P.modal({
            title: 'Kết thúc ván?', body: '<p>Ván dừng ngay và lật hết các tàu.</p>',
            actions: [{ label: 'Chơi tiếp', kind: 'ghost' }, { label: '🛑 Kết thúc', kind: 'danger', onClick: () => send('stop') }],
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

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || !S) return;
    if ((e.key === 'r' || e.key === 'R') && S.phase === 'play' && S.stage === 'place' && !S.me.ready) { ui.rot = (ui.rot + 1) % 4; render(); }
  });

  // ---------------------------------------------------------------- banner, nhân vật, danh sách
  function renderBanner() {
    const el = $('#banner');
    let big = '⚓';
    let title = '';
    let sub = '';
    let cls = 'gbanner';
    if (S.phase === 'lobby') {
      title = 'Phòng chờ';
      sub = `${S.players.length}/2 người · ${S.me.host ? (S.players.length < 2 ? 'mời một người bạn hoặc thêm bot để đấu với máy' : 'bấm Bắt đầu bên dưới') : 'đang chờ chủ phòng bắt đầu…'}`;
    } else if (S.phase === 'end') {
      big = '🏆'; cls += ' win';
      title = S.winner ? `${who(S.winner)} thắng!` : 'Ván dừng';
      sub = esc(S.winReason || '');
    } else if (S.stage === 'place') {
      big = '🚢'; title = S.me.playing ? (S.me.ready ? 'Đang chờ đối thủ xếp tàu…' : 'Xếp hạm đội của bạn!') : 'Hai bên đang xếp hạm đội…';
      sub = 'Giấu tàu thật khéo — đối thủ không nhìn thấy hạm đội của bạn.';
      if (S.me.playing && !S.me.ready) cls += ' mine';
    } else {
      const mine = S.turn === S.me.id;
      big = mine ? '🎯' : '🌊';
      title = mine ? 'Lượt của bạn — khai hoả!' : `${who(S.turn)} đang ngắm bắn…`;
      sub = `${mine ? 'Chọn một ô trên vùng biển địch.' : 'Chờ đối thủ bắn.'} ${S.config.chain ? 'Trúng được bắn tiếp, trượt thì đổi lượt.' : 'Mỗi lượt bắn một phát.'}`;
      if (mine) cls += ' mine';
    }
    if (S.phase === 'play' && !S.me.playing) sub = `👀 Bạn đang xem trận này. · ${sub}`;
    el.className = cls;
    setHTML(el, `<div class="big">${big}</div><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div></div>`);
  }

  function renderCast() {
    if (!cast) cast = new window.Cast($('#cast'), { onClick: (pid, el) => openMenu(pid, el) });
    cast.update(S.players.map((p) => ({
      id: p.id, name: p.name, look: p.look, bot: p.bot, me: p.id === S.me.id, color: p.color,
      turn: S.phase === 'play' && S.turn === p.id,
      dim: !p.connected,
      sub: p.playing ? `🏆 ${p.wins}` : (S.phase === 'lobby' ? (p.host ? '👑 chủ phòng' : '') : '👀 đang xem'),
      badge: S.phase === 'end' && S.winner === p.id ? '🏆' : (S.stage === 'place' && p.ready ? '✅' : ''),
    })));
  }

  function renderPlayers() {
    const html = S.players.map((p) => {
      const tags = [p.bot ? '🤖' : '', p.host ? '👑' : '', p.connected ? '' : '📴'].filter(Boolean).join(' ');
      const acc = p.shots ? Math.round((100 * p.hits) / p.shots) : 0;
      const sub = p.playing ? `🎯 ${p.shots} phát · chính xác ${acc}%${p.best > 1 ? ` · chuỗi ${p.best}` : ''}` : (S.phase === 'lobby' ? 'Sẵn sàng' : '👀 Đang xem');
      return `<div class="pcard ${S.turn === p.id ? 'turn' : ''}" style="--pc:${p.color || 'transparent'}" data-pid="${esc(p.id)}">
        <div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>
        <div class="pn"><b>${p.id === S.me.id ? 'Bạn' : esc(p.name)} ${tags}</b><span>${sub}</span></div>
        <div class="sc">${p.wins}<small>ván thắng</small></div></div>`;
    }).join('');
    setHTML($('#plist'), html);
  }

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const inviteLink = () => `${ui.lanBase || location.origin}/g/haichien/?room=${ROOM}`;
  function botPanel() {
    const bots = S.players.filter((p) => p.bot).length;
    return `<div class="panel"><h3><span class="grow">🤖 Đấu với máy</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Không có bạn? Thêm bot làm đối thủ — bot khó dùng bản đồ xác suất để săn tàu.</p>
      <div class="btns-row">${btn('add-bot', '＋ Thêm bot', 'small primary', S.players.length >= 2 ? 'disabled' : '')}
        ${bots ? btn('remove-bots', '🗑 Xoá bot', 'small ghost') : ''}</div></div>`;
  }
  function settingsPanel() {
    const dis = S.me.host ? '' : 'disabled';
    const cfg = S.config;
    const sel = (key, label, opts) => `<div class="setting"><label>${label}</label><select data-cfg="${key}" ${dis}>
      ${opts.map(([v, t]) => `<option value="${v}" ${String(v) === String(cfg[key]) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    const custom = cfg.mode === 'custom';
    const preview = S.preview.map((f) => `<span class="fp">${miniShip(f, 9)}${esc(f.name)}</span>`).join('');
    const total = S.preview.reduce((a, f) => a + f.size, 0);
    return `<div class="panel"><h3>⚙️ Luật chơi</h3><div class="settings">
      ${sel('mode', '🗺️ Chế độ', [['classic', 'Cổ điển (10×10, 5 tàu thẳng)'], ['custom', 'Tuỳ chỉnh']])}
      ${custom ? sel('size', '📐 Cỡ bản đồ', S.choices.size.map((v) => [v, `${v} × ${v}`])) : ''}
      ${custom ? sel('style', '🚢 Hình dạng tàu', [['line', 'Tàu thẳng'], ['shape', 'Đa hình (vuông, chữ L, T, Z…)']]) : ''}
      ${sel('turn_time', '⏱ Thời gian mỗi lượt bắn', S.choices.turn_time.map((v) => [v, `${v} giây`]))}
      ${sel('place_time', '🚢 Thời gian xếp tàu', S.choices.place_time.map((v) => [v, `${v} giây`]))}
      ${sel('bot_level', '🤖 Độ khó của bot', [['easy', LEVEL_NAMES.easy], ['normal', LEVEL_NAMES.normal], ['hard', LEVEL_NAMES.hard]])}
      <label class="switch"><input type="checkbox" data-cfg="chain" ${cfg.chain ? 'checked' : ''} ${dis}>
        <span>Trúng được bắn tiếp<small>Bắn trúng thì giữ lượt, trượt mới đổi lượt</small></span></label>
      <label class="switch"><input type="checkbox" data-cfg="no_touch" ${cfg.no_touch ? 'checked' : ''} ${dis}>
        <span>Không đặt tàu sát nhau<small>Các tàu phải cách nhau ít nhất 1 ô (kể cả chéo)</small></span></label>
    </div><p class="gh-muted" style="margin:12px 0 0;font-size:13px">⚓ Hạm đội (${S.previewN}×${S.previewN} · ${S.preview.length} tàu · ${total} ô):</p>
    <div class="fleet-preview">${preview}</div></div>`;
  }
  function renderPanel() {
    const el = $('#panel');
    if (S.phase === 'play') { setHTML(el, ''); return; }
    const host = S.me.host;
    let html;
    if (S.phase === 'end') {
      const rows = S.order.map((pid) => {
        const p = player(pid);
        if (!p) return '';
        const acc = p.shots ? Math.round((100 * p.hits) / p.shots) : 0;
        return `<div class="res-row ${pid === S.winner ? 'win' : ''}"><span class="rank">${pid === S.winner ? '🏆' : '⚓'}</span>
          <span class="rname">${esc(p.name)}${p.bot ? ' 🤖' : ''}</span>
          <div class="rcards"><span class="gh-muted">🎯 ${p.shots} phát · ${p.hits} trúng · chính xác ${acc}% · chuỗi dài nhất ${p.best} · còn ${S.boards[pid].afloat} tàu</span></div>
          <span class="rpts">${p.wins}<small>ván thắng</small></span></div>`;
      }).join('');
      html = `<div class="panel"><div class="result-head"><div class="trophy">🏆</div><div>
          <h2>${S.winner ? `${esc(nm(S.winner))}${S.winner === S.me.id ? ' (bạn)' : ''} thắng!` : 'Ván dừng'}</h2><p>${esc(S.winReason || '')} — các tàu chưa chìm đã được lật lên ở trên.</p></div></div>
        <div class="results">${rows}</div>
        <div class="start-row" style="margin-top:14px">${host
          ? `${btn('lobby', '🏠 Về phòng chờ', 'ghost')}${btn('next', '▶ Ván mới (đổi người bắn trước)', 'primary', S.startError ? 'disabled' : '')}`
          : '<span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu ván mới…</span>'}</div></div>${host ? botPanel() + settingsPanel() : ''}`;
    } else {
      const start = host
        ? `<div class="start-row"><div>${S.startError ? `<span class="warn">⚠️ ${esc(S.startError)}</span>` : '<span class="gh-muted">2/2 người — sẵn sàng ra khơi!</span>'}</div>
           ${btn('start', '⚓ Bắt đầu', 'primary', S.startError ? 'disabled' : '')}</div>`
        : '<div class="start-row"><span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu…</span></div>';
      html = `<div class="panel"><h3>📨 Mời bạn bè</h3><div class="invite"><div class="bigcode">${ROOM}</div><div class="link">${esc(inviteLink())}</div>
          ${btn('copy-link', '⧉ Sao chép link', 'small')} ${btn('edit-look', '👗 Đổi nhân vật', 'small')}</div></div>
        ${host ? botPanel() : ''}${settingsPanel()}<div class="panel">${start}</div>`;
    }
    setHTML(el, html);
  }

  // ---------------------------------------------------------------- biểu cảm & menu người chơi
  const SELF_FX = [['laugh', 'Cười'], ['angry', 'Tức'], ['cry', 'Khóc'], ['shock', 'Sốc'], ['think', 'Nghĩ'], ['clap', 'Vỗ tay'], ['dance', 'Nhảy']];
  const OTHER_FX = [['wave', 'Vẫy tay'], ['heart', 'Thả tim'], ['flower', 'Tặng hoa'], ['tomato', 'Ném cà chua'], ['highfive', 'Đập tay'], ['poke', 'Chọc']];
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function renderEmotes() {
    setHTML($('#emotes'), SELF_FX.map(([k, l]) => `<button class="emo" data-fx="${k}" data-self="1" title="${l}">${FX_EMOJI[k]}</button>`).join('')
      + btn('edit-look', '👗 Nhân vật', 'small')
      + (S && S.me.host && S.phase === 'play' ? btn('stop', '🏁 Kết thúc ván', 'small ghost') : '')
      + '<span class="hint">Nhấn vào nhân vật đối thủ để ném cà chua 🍅</span>');
  }
  function openMenu(id, anchor) {
    closeMenu();
    const p = player(id);
    if (!p) return;
    const me = id === S.me.id;
    let html = `<div class="pmenu-head">${me ? '🙋 Bạn' : esc(p.name)}${p.bot ? ' 🤖' : ''}</div>
      <div class="pmenu-grid">${(me ? SELF_FX : OTHER_FX).map(([k, l]) => `<button data-fx="${k}"><span>${FX_EMOJI[k]}</span>${l}</button>`).join('')}</div>`;
    if (me) html += btn('edit-look', '👗 Đổi nhân vật', 'small');
    if (!me && S.me.host && S.phase !== 'play') html += `<button class="gh-btn small danger" data-kick="${esc(id)}">${p.bot ? '🗑 Xoá bot' : '🚪 Mời ra khỏi phòng'}</button>`;
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
    menuEl.dataset.target = me ? '' : id;
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
      : '<div class="empty-note">Diễn biến trận đánh sẽ hiện ở đây.</div>';
    const list = $('#log-list');
    if (setHTML(list, html)) list.scrollTop = list.scrollHeight;
  }

  // ---------------------------------------------------------------- vẽ giao diện
  function render() {
    if (!S) return;
    $('#phase-pill').textContent = S.phase === 'lobby' ? '🏠 Phòng chờ' : S.phase === 'end' ? `🏁 Hết ván ${S.gameNo}` : (S.stage === 'place' ? '🚢 Xếp tàu' : '⚔️ Giao chiến');
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `${S.phase === 'play' && S.turn === S.me.id ? '🎯 ' : ''}Hải Chiến ${ROOM}`;
    renderBanner();
    renderCast();
    renderWar();
    renderDock();
    renderPlayers();
    renderPanel();
    renderEmotes();
    renderChat();
    renderLog();
    tick();
  }

  function tick() {
    const timer = $('#timer');
    const fill = $('#timebar-fill');
    if (!S || !S.deadline || S.phase !== 'play') { timer.hidden = true; fill.style.width = '0'; return; }
    const remaining = Math.max(0, S.deadline - (Date.now() / 1000 + clockOffset));
    const secs = Math.ceil(remaining);
    timer.hidden = false;
    timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    timer.classList.toggle('urgent', secs <= 5 && S.turn === S.me.id);
    fill.style.width = `${S.total ? Math.min(1, remaining / S.total) * 100 : 0}%`;
  }
  setInterval(tick, 250);

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-cfg]');
    if (!el) return;
    const key = el.dataset.cfg;
    const v = el.type === 'checkbox' ? el.checked : (['turn_time', 'place_time', 'size'].includes(key) ? Number(el.value) : el.value);
    send('config', { [key]: v });
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
    try { localStorage.setItem('haichien_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) SOUND.splash();
  });
  const liteBtn = $('#btn-lite');
  const syncLite = () => { liteBtn.textContent = ui.lite ? '🐢' : '✨'; liteBtn.title = ui.lite ? 'Đồ hoạ nhẹ (bấm để bật hiệu ứng đầy đủ)' : 'Đồ hoạ đẹp (bấm để chuyển sang nhẹ nếu máy bị lag)'; };
  syncLite();
  liteBtn.addEventListener('click', () => {
    ui.lite = !ui.lite;
    document.body.classList.toggle('lite', ui.lite);
    try { localStorage.setItem('haichien_lite', ui.lite ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    syncLite();
    P.toast(ui.lite ? '🐢 Đã chuyển sang đồ hoạ nhẹ' : '✨ Đã bật đồ hoạ đầy đủ', 'good', 1800);
  });
  $('#btn-room').addEventListener('click', async () => { if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good'); });
  $('#btn-leave').addEventListener('click', () => {
    const doLeave = () => { if (conn) conn.leave(); setTimeout(() => { location.href = '/'; }, 150); };
    if (S && S.phase === 'play' && S.me.playing) {
      P.modal({
        title: 'Rời trận?',
        body: '<p>Trận đang diễn ra — khi bạn vắng mặt, máy sẽ bắn hộ. Vào lại phòng với <b>đúng tên cũ</b> để chơi tiếp.</p>',
        actions: [{ label: 'Ở lại', kind: 'ghost' }, { label: 'Rời phòng', kind: 'danger', onClick: doLeave }],
      });
    } else doLeave();
  });

  fetch('/api/info').then((r) => r.json()).then((inf) => {
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    const lan = location.protocol === 'https:' ? inf.https : inf.urls;
    if (local && lan && lan.length) { ui.lanBase = lan[0]; if (S) render(); }
  }).catch(() => {});

  $('#room-code').textContent = ROOM;
  P.ensureName(() => connect());
})();
