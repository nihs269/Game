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
    lastSeq: null, disp: {}, anims: {}, wasMine: false,
    tab: 'players', unread: 0, lastChatId: null, lanBase: null, sound: true,
  };
  try { ui.sound = localStorage.getItem('cangua_sound') !== '0'; } catch (e) { /* bỏ qua */ }

  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
  };
  const HEX = ['#ff6b6b', '#3cc47c', '#ffc23c', '#4d8df7'];
  const CNAME = ['Đỏ', 'Xanh lá', 'Vàng', 'Xanh dương'];
  const G = 17;
  const GATE = 58;
  const HOME = 100;
  const STEP_MS = 160;

  // ---------------------------------------------------------------- hình học bàn cờ (lưới 17×17)
  // Đường đi chung 60 ô, chạy theo chiều kim đồng hồ; màu c xuất quân ở ô 15c+1, cửa chuồng ở ô 15c−1.
  const TRACK = (() => {
    const c = [];
    for (let x = 0; x <= 6; x++) c.push([7, x]);
    for (let y = 6; y >= 0; y--) c.push([y, 7]);
    c.push([0, 8]);
    for (let y = 0; y <= 6; y++) c.push([y, 9]);
    for (let x = 10; x <= 16; x++) c.push([7, x]);
    c.push([8, 16]);
    for (let x = 16; x >= 10; x--) c.push([9, x]);
    for (let y = 10; y <= 16; y++) c.push([y, 9]);
    c.push([16, 8]);
    for (let y = 16; y >= 10; y--) c.push([y, 7]);
    for (let x = 6; x >= 0; x--) c.push([9, x]);
    c.push([8, 0]);
    return c;
  })();
  const startOf = (c) => 15 * c + 1;
  const absOf = (c, pos) => (startOf(c) + pos) % 60;
  const homeCell = (c, s) => [[8, s], [s, 8], [8, 16 - s], [16 - s, 8]][c];
  const STABLE = [[0, 0], [0, 10], [10, 10], [10, 0]];
  const stableSpot = (c, h) => { const [r, col] = STABLE[c]; return [r + [2, 2, 4, 4][h] + 0.5, col + [2, 4, 2, 4][h] + 0.5]; };
  function cellOfId(id) {
    if (id[0] === 't') return TRACK[Number(id.slice(1))];
    if (id[0] === 'h') { const [c, s] = id.slice(1).split('-').map(Number); return homeCell(c, s); }
    return null;
  }
  // Mã ô ngựa đang đứng: chuồng `s{màu}-{ngựa}`, đường đi `t{ô}`, bậc lên chuồng `h{màu}-{bậc}`.
  function horseId(c, h, pos) {
    if (pos === -1) return `s${c}-${h}`;
    return pos >= HOME ? `h${c}-${pos - HOME}` : `t${absOf(c, pos)}`;
  }

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
  let cast = null;
  function anchorEl(pid) {
    const a = cast && cast.anchor(pid);
    if (a) return a;
    const p = player(pid);
    if (p && p.color !== null && p.color !== undefined) {
      const st = document.querySelector(`.stable[data-c="${p.color}"] .sname`);
      if (st) return st;
    }
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
      notes.forEach(([freq, dur, type = 'sine', vol = 0.08]) => {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(actx.destination);
        o.start(t); o.stop(t + dur);
        t += dur * 0.8;
      });
    } catch (e) { /* bỏ qua */ }
  }
  const SOUNDS = {
    dice: () => Array.from({ length: 7 }, () => [220 + Math.random() * 260, 0.05, 'square', 0.03]),
    step: () => [[520 + Math.random() * 120, 0.05, 'triangle', 0.05]],
    kick: () => [[160, 0.12, 'sawtooth', 0.09], [90, 0.25, 'sawtooth', 0.07]],
    home: () => [[784, 0.08], [1046, 0.16]],
    pass: () => [[300, 0.12, 'triangle', 0.05], [240, 0.16, 'triangle', 0.05]],
    six: () => [[880, 0.08], [1175, 0.08], [1568, 0.16]],
    win: () => [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]],
    turn: () => [[660, 0.12], [880, 0.18]],
  };
  const play = (k) => beep(SOUNDS[k]());

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
    const prev = S;
    S = state;
    clockOffset = state.now - Date.now() / 1000;
    const events = state.events || [];
    let fresh = [];
    if (ui.lastSeq === null) ui.lastSeq = events.length ? events[events.length - 1].seq : 0;
    else fresh = events.filter((e) => e.seq > ui.lastSeq);
    if (events.length) ui.lastSeq = Math.max(ui.lastSeq, events[events.length - 1].seq);
    // Ngựa sắp chạy: giữ ở vị trí cũ cho tới khi hoạt ảnh đi từng ô.
    fresh.filter((e) => e.type === 'move').forEach((e) => {
      const key = `${e.pid}:${e.horse}`;
      clearInterval(ui.anims[key]);
      const old = prev && prev.players.find((p) => p.id === e.pid);
      ui.anims[key] = -1;
      ui.disp[key] = old && old.horses ? old.horses[e.horse] : undefined;
      if (e.kicked) {  // ngựa bị đá đứng yên tới khi ngựa kia chạy tới nơi, rồi mới bay về chuồng
        const victim = prev && prev.players.find((p) => p.id === e.kicked.pid);
        ui.disp[`${e.kicked.pid}:${e.kicked.horse}`] = victim && victim.horses ? victim.horses[e.kicked.horse] : undefined;
      }
    });
    fresh.filter((e) => e.type === 'roll' && e.dice).forEach((e) => rollDie(e.dice));
    const mine = S.phase === 'play' && S.turn === S.me.id && ['roll', 'move'].includes(S.stage);
    if (mine && !ui.wasMine && !first) { play('turn'); if (navigator.vibrate) navigator.vibrate(100); }
    ui.wasMine = mine;
    render();
    fresh.forEach(playEvent);
  }

  // ---------------------------------------------------------------- hiệu ứng
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

  function animateMove(e) {
    const key = `${e.pid}:${e.horse}`;
    const p = player(e.pid);
    if (!p) return;
    const path = e.path.filter((id) => cellOfId(id));
    let k = 0;
    clearInterval(ui.anims[key]);
    ui.anims[key] = setInterval(() => {
      if (k >= path.length) {
        clearInterval(ui.anims[key]);
        delete ui.anims[key];
        delete ui.disp[key];
        if (e.kicked) {
          const hv = document.querySelector(`.horse[data-key="${CSS.escape(`${e.kicked.pid}:${e.kicked.horse}`)}"]`);
          if (hv) { hv.classList.add('kicked'); setTimeout(() => hv.classList.remove('kicked'), 700); }
          delete ui.disp[`${e.kicked.pid}:${e.kicked.horse}`];
          play('kick');
          bubble(e.kicked.pid, '💥', 'emoji');
          if (cast) { cast.react(e.pid, 'cheer'); cast.react(e.kicked.pid, 'sad'); }
        } else if (e.home) { play('home'); if (cast) cast.react(e.pid, 'cheer'); }
        renderHorses();
        return;
      }
      ui.disp[key] = { id: path[k++] };
      renderHorses();
      play('step');
    }, STEP_MS);
  }

  function playEvent(e) {
    switch (e.type) {
      case 'roll': play('dice'); if (e.dice === 6) setTimeout(() => play('six'), DICE_MS); break;
      case 'move': animateMove(e); break;
      case 'pass': play('pass'); bubble(e.pid, '😶', 'emoji'); break;
      case 'win': play('win'); bubble(e.pid, '🏆', 'emoji'); if (cast) cast.react(e.pid, 'cheer'); break;
      default:
    }
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

  // ---------------------------------------------------------------- vẽ bàn cờ
  function buildBoard() {
    const board = $('#board');
    const add = (cls, r, c, w = 1, h = 1, html = '', style = '') => {
      const el = document.createElement('div');
      el.className = cls;
      el.style.cssText = `grid-row:${r + 1} / span ${h};grid-column:${c + 1} / span ${w};${style}`;
      el.innerHTML = html;
      board.insertBefore(el, $('#horses'));
      return el;
    };
    for (let c = 0; c < 4; c++) {
      const [r, col] = STABLE[c];
      const st = add('stable', r, col, 7, 7, '<div class="owner"></div><span class="sname"></span>', `--cc:${HEX[c]}`);
      st.dataset.c = c;
      for (let h = 0; h < 4; h++) {
        const [sr, sc] = stableSpot(c, h);
        add('spot', Math.floor(sr), Math.floor(sc), 1, 1, '', `--cc:${HEX[c]}`).dataset.id = `s${c}-${h}`;
      }
    }
    TRACK.forEach(([r, c], i) => {
      const color = [0, 1, 2, 3].find((k) => startOf(k) === i);
      const gate = [0, 1, 2, 3].find((k) => (startOf(k) + 58) % 60 === i);
      let cls = 'sq';
      let style = '';
      let html = '';
      if (color !== undefined) { cls += ' start'; style = `--cc:${HEX[color]}`; html = '★'; }
      if (gate !== undefined) { cls += ' gate'; style = `--cc:${HEX[gate]}`; html = '⬆'; }
      const el = add(cls, r, c, 1, 1, html, style);
      el.dataset.id = `t${i}`;
    });
    for (let c = 0; c < 4; c++) {
      for (let s = 1; s <= 6; s++) {
        const [r, col] = homeCell(c, s);
        const el = add('sq hstep', r, col, 1, 1, String(s), `--cc:${HEX[c]}`);
        el.dataset.id = `h${c}-${s}`;
      }
    }
    add('goal', 7, 7, 3, 3, '<div id="die" class="die-box"></div><button id="roll-btn" class="gh-btn gold roll-btn" data-act="roll" hidden>🎲 Đổ</button>');
  }

  // ---------------------------------------------------------------- xúc xắc 3D (giống Cờ Tỷ Phú)
  // Kết quả là MẶT NẰM TRÊN: góc quay khối để mặt v hướng lên trời.
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const faceHTML = (v) => `<div class="face f${v}">${Array.from({ length: 9 }, (_, k) => `<i class="${PIPS[v].includes(k) ? 'on' : ''}"></i>`).join('')}</div>`;
  const FACE_ROT = { 1: [90, 0], 2: [-90, 90], 3: [0, 0], 4: [180, 0], 5: [90, 90], 6: [-90, 0] };
  const FACE_N = [[0, 0, 1], [1, 0, 0], [0, -1, 0], [0, 1, 0], [-1, 0, 0], [0, 0, -1]];
  const LIGHT = (() => { const l = [-0.2, -0.9, 0.4]; const m = Math.hypot(...l); return l.map((v) => v / m); })();
  const TILT = [-58, -22];  // nhìn từ trên xuống: mặt trên (kết quả) to và sáng nhất
  const DICE_MS = 1000;
  const dice = { el: null, cube: null, toss: null, shadow: null, faces: [], rot: [0, 0], val: 0, animUntil: 0, raf: 0 };
  const rad = (d) => (d * Math.PI) / 180;
  const rotX = ([x, y, z], a) => { const c = Math.cos(rad(a)); const s = Math.sin(rad(a)); return [x, y * c - z * s, y * s + z * c]; };
  const rotY = ([x, y, z], a) => { const c = Math.cos(rad(a)); const s = Math.sin(rad(a)); return [x * c + z * s, y, -x * s + z * c]; };
  function poseDie(ax, ay) {
    dice.cube.style.transform = `rotateX(${ax}deg) rotateY(${ay}deg)`;
    dice.faces.forEach((el, idx) => {
      const n = rotX(rotY(rotX(rotY(FACE_N[idx], ay), ax), TILT[1]), TILT[0]);
      const d = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
      el.style.setProperty('--shade', (0.55 * (1 - Math.max(0, d)) ** 1.3).toFixed(3));
    });
  }
  function markTop(v) { dice.faces.forEach((el, idx) => el.classList.toggle('top', v === idx + 1)); }
  function diceEl() {
    if (dice.el) return dice.el;
    const el = document.createElement('div');
    el.className = 'dice3';
    el.innerHTML = `<div class="d3"><div class="d3-shadow"></div><div class="d3-toss">
        <div class="d3-tilt" style="transform:rotateX(${TILT[0]}deg) rotateY(${TILT[1]}deg)"><div class="cube">
          <div class="core cz"></div><div class="core cx"></div><div class="core cy"></div>
          ${[1, 2, 3, 4, 5, 6].map(faceHTML).join('')}</div></div></div></div>`;
    dice.el = el;
    dice.cube = el.querySelector('.cube');
    dice.toss = el.querySelector('.d3-toss');
    dice.shadow = el.querySelector('.d3-shadow');
    dice.faces = [1, 2, 3, 4, 5, 6].map((v) => el.querySelector(`.f${v}`));
    setDie(6);
    return el;
  }
  function setDie(v) {
    if (v === dice.val) return;
    dice.rot = FACE_ROT[v].slice();
    poseDie(...dice.rot);
    dice.val = v;
    markTop(v);
  }
  // Độ cao nảy (theo % cạnh xúc xắc): rơi xuống, nảy lên 2 lần rồi nằm yên.
  function tossHeight(t) {
    if (t < 0.4) return 170 * (1 - (t / 0.4) ** 2);
    if (t < 0.72) { const u = (t - 0.4) / 0.32; return 120 * u * (1 - u); }
    if (t < 0.9) { const u = (t - 0.72) / 0.18; return 36 * u * (1 - u); }
    return 0;
  }
  function rollDie(v) {
    diceEl();
    cancelAnimationFrame(dice.raf);
    dice.el.classList.remove('six', 'settle');
    markTop(0);
    dice.animUntil = Date.now() + DICE_MS;
    const ahead = (cur, base, spins) => { const t = cur + spins * 360; return t + ((((base - t) % 360) + 360) % 360); };
    const from = dice.rot.slice();
    const to = [ahead(from[0], FACE_ROT[v][0], 2), ahead(from[1], FACE_ROT[v][1], 2)];
    dice.rot = to;
    dice.val = v;
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / DICE_MS);
      const e = 1 - (1 - t) ** 3;
      poseDie(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e);
      const h = tossHeight(t);
      const x = -60 * (1 - Math.min(1, t / 0.55)) ** 2;
      dice.toss.style.transform = `translate(${x}%, ${-h}%)`;
      dice.shadow.style.transform = `translateX(${x}%) scale(${1 - Math.min(0.65, h / 260)})`;
      dice.shadow.style.opacity = String(1 - Math.min(0.75, h / 230));
      if (t < 1) { dice.raf = requestAnimationFrame(frame); return; }
      markTop(v);
      dice.el.classList.add('settle');
      dice.el.classList.toggle('six', v === 6);
      setTimeout(() => dice.el.classList.remove('settle'), 400);
    };
    dice.raf = requestAnimationFrame(frame);
  }
  function renderDie() {
    const box = $('#die');
    if (!box) return;
    const el = diceEl();
    if (el.parentNode !== box) box.appendChild(el);
    // Đến lượt mình đổ: nút "Đổ" hiện ngay dưới xúc xắc giữa bàn (bấm vào xúc xắc cũng được).
    const canRoll = S.phase === 'play' && S.me.playing && S.turn === S.me.id && S.stage === 'roll';
    box.parentNode.classList.toggle('can-roll', canRoll);
    $('#roll-btn').hidden = !canRoll;
    if (Date.now() >= dice.animUntil) {
      const v = S.dice || 6;
      setDie(v);
      el.classList.toggle('six', S.phase === 'play' && v === 6 && !!S.dice);
    }
  }

  function renderStables() {
    document.querySelectorAll('.stable').forEach((el) => {
      const c = Number(el.dataset.c);
      const p = S.players.find((q) => q.playing && q.color === c);
      el.classList.toggle('empty', S.phase !== 'lobby' && !p);
      el.classList.toggle('turn', !!(p && S.turn === p.id && S.phase === 'play'));
      setHTML(el.querySelector('.sname'), p ? `${p.id === S.me.id ? 'Bạn' : esc(p.name)}${p.bot ? ' 🤖' : ''}` : (S.phase === 'lobby' ? CNAME[c] : ''));
      setHTML(el.querySelector('.owner'), p ? window.Avatar.svg(p.look, { head: true, seed: p.id }) : '');
    });
  }

  function renderTargets() {
    document.querySelectorAll('.sq.target').forEach((el) => el.classList.remove('target'));
    if (!S.moves) return;
    const me = player(S.me.id);
    Object.values(S.moves).forEach((to) => {
      const id = to >= HOME ? `h${me.color}-${to - HOME}` : `t${absOf(me.color, to)}`;
      const el = document.querySelector(`.sq[data-id="${id}"]`);
      if (el) el.classList.add('target');
    });
  }

  function renderHorses() {
    const box = $('#horses');
    const board = $('#board');
    if (!S || S.phase === 'lobby') { box.innerHTML = ''; return; }
    const keep = new Set();
    S.players.filter((p) => p.playing && p.horses).forEach((p) => {
      p.horses.forEach((pos, h) => {
        const key = `${p.id}:${h}`;
        keep.add(key);
        let el = box.querySelector(`[data-key="${CSS.escape(key)}"]`);
        if (!el) {
          el = document.createElement('div');
          el.className = 'horse';
          el.dataset.key = key;
          el.dataset.pid = p.id;
          el.dataset.h = h;
          box.appendChild(el);
        }
        el.style.setProperty('--cc', HEX[p.color]);
        // Mặt nhân vật của người chơi, viền theo màu quân.
        setHTML(el, `<div class="hface">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>`);
        const d = ui.disp[key];
        const id = d && d.id ? d.id : horseId(p.color, h, typeof d === 'number' ? d : pos);
        const cellEl = board.querySelector(`[data-id="${id}"]`);
        if (cellEl) {
          // Toạ độ tâm ô thật trên bàn (không tính theo lưới) → luôn khớp ô kể cả khi bàn đổi cỡ.
          el.style.left = `${cellEl.offsetLeft + cellEl.offsetWidth / 2}px`;
          el.style.top = `${cellEl.offsetTop + cellEl.offsetHeight / 2}px`;
        }
        const can = !!(S.moves && p.id === S.me.id && S.moves[String(h)] !== undefined);
        el.classList.toggle('can', can);
        el.classList.toggle('homed', pos >= HOME);
        el.title = can ? 'Bấm để đi con ngựa này' : `${p.name}`;
      });
    });
    box.querySelectorAll('.horse').forEach((el) => { if (!keep.has(el.dataset.key)) el.remove(); });
  }

  function renderBanner() {
    const el = $('#banner');
    let big = '🐴';
    let title = '';
    let sub = '';
    let acts = '';
    let cls = 'gbanner';
    if (S.phase === 'lobby') {
      big = '🏇'; title = 'Phòng chờ';
      sub = `${S.players.length}/${S.maxPlayers} người · ${S.me.host ? 'bạn là chủ phòng — chỉnh luật rồi bấm Xuất phát bên dưới' : 'đang chờ chủ phòng bắt đầu…'}`;
    } else if (S.phase === 'end') {
      big = '🏆'; cls += ' win';
      title = `${who(S.winner)} về đích trước!`;
      sub = `Ván ${S.gameNo} kết thúc — xem bảng xếp hạng bên dưới.`;
    } else {
      const cur = player(S.turn);
      const dot = cur ? `<span class="dotc" style="--pc:${HEX[cur.color]}"></span>` : '';
      const mine = S.turn === S.me.id;
      const name = mine ? 'Bạn' : esc(nm(S.turn));
      const outRule = S.config.out === '6' ? '6' : '1 hoặc 6';
      if (mine && S.stage === 'roll') {
        big = '🎲'; cls += ' mine'; title = `${dot}Đến lượt bạn!`;
        sub = `Bấm nút 🎲 Đổ giữa bàn cờ (hoặc phím Space) · ra quân khi đổ ${outRule} · đổ 6 được đổ thêm.`;
      } else if (mine && S.stage === 'move') {
        big = '👆'; cls += ' mine'; title = `${dot}Bạn đổ được ${S.dice} — chọn ngựa!`;
        sub = 'Bấm vào con ngựa đang nhảy (hoặc ô đích tô vàng). Phím 1–4 để chọn nhanh.';
      } else if (S.stage === 'rolling') {
        big = '🎲'; title = `${dot}${name} đang đổ xúc xắc…`;
      } else if (S.stage === 'move') {
        big = '🤔'; title = `${dot}${name} đổ được ${S.dice}, đang chọn ngựa…`;
      } else if (S.stage === 'moving') {
        big = '🏇'; title = `${dot}${name} đang phi ngựa…`;
      } else if (S.stage === 'pass') {
        big = '😶'; title = `${dot}${name} đổ ${S.dice} — không có nước đi`;
        sub = 'Mất lượt, chuyển sang người kế tiếp.';
      } else {
        title = `${dot}Lượt của ${name}`;
      }
    }
    if (S.phase === 'play' && !S.me.playing) {
      sub = `👀 Bạn đang xem ván này — ván sau sẽ được vào chơi.${sub ? ` · ${sub}` : ''}`;
      acts = '';
    }
    el.className = cls;
    setHTML(el, `<div class="big">${big}</div><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${acts ? `<div class="gacts">${acts}</div>` : '<div></div>'}`);
  }

  function renderCast() {
    if (!cast) cast = new window.Cast($('#cast'), { onClick: (pid, el) => openMenu(pid, el) });
    const list = S.phase === 'lobby' ? S.players : S.players.filter((p) => p.playing);
    cast.update(list.map((p) => ({
      id: p.id, name: p.name, look: p.look, bot: p.bot, me: p.id === S.me.id,
      color: p.color !== null && p.color !== undefined ? HEX[p.color] : null,
      turn: S.phase === 'play' && S.turn === p.id,
      dim: !p.connected,
      sub: p.playing ? `🏠 ${p.home}/${p.horses.length}` : (p.host ? '👑 chủ phòng' : ''),
      badge: S.phase === 'end' && S.winner === p.id ? '🏆' : (p.host && p.playing ? '👑' : ''),
    })));
  }

  function renderPlayers() {
    const n = S.phase === 'lobby' ? 4 : null;
    const html = S.players.map((p) => {
      const c = p.color;
      const horses = p.horses ? p.horses.map((x) => `<i class="${x >= HOME ? 'home' : x >= 0 ? 'out' : ''}"></i>`).join('') : '';
      const tags = [p.bot ? '🤖' : '', p.host ? '👑' : '', p.wins ? `🏆${p.wins}` : '', p.connected ? '' : '📴'].filter(Boolean).join(' ');
      const sub = p.playing ? `${CNAME[c]} · ${p.home}/${p.horses.length} ngựa lên chuồng` : (S.phase === 'lobby' ? 'Sẵn sàng' : '👀 Đang xem');
      return `<div class="pcard ${S.turn === p.id && S.phase === 'play' ? 'turn' : ''}" style="--cc:${c !== null && c !== undefined ? HEX[c] : 'transparent'}" data-pid="${esc(p.id)}">
        <div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>
        <div class="pn"><b>${p.id === S.me.id ? 'Bạn' : esc(p.name)} ${tags}</b><span>${sub}</span></div>
        <div class="hs">${horses}</div></div>`;
    }).join('') + (n ? '' : '');
    setHTML($('#plist'), html);
  }

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const inviteLink = () => `${ui.lanBase || location.origin}/g/cangua/?room=${ROOM}`;
  const ESTIMATE = { 2: { 2: 5, 3: 8, 4: 12 }, 3: { 2: 9, 3: 20, 4: 35 }, 4: { 2: 13, 3: 35, 4: 66 } };
  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    return `<div class="panel"><h3><span class="grow">🤖 Người chơi ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Không đủ người? Thêm bot — bot biết đá ngựa, tránh bị rình và ưu tiên lên chuồng.</p>
      <div class="btns-row">${btn('add-bot', '＋ 1 bot', 'small', n >= S.maxPlayers ? 'disabled' : '')}
        ${btn('fill-bots', 'Lấp đủ 4 người', 'small primary', n >= S.maxPlayers ? 'disabled' : '')}
        ${bots ? btn('remove-bots', '🗑 Xoá hết bot', 'small ghost') : ''}</div></div>`;
  }
  function settingsPanel() {
    const dis = S.me.host ? '' : 'disabled';
    const cfg = S.config;
    const sel = (key, label, opts) => `<div class="setting"><label>${label}</label><select data-cfg="${key}" ${dis}>
      ${opts.map(([v, t]) => `<option value="${v}" ${String(v) === String(cfg[key]) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    const n = Math.min(4, Math.max(2, S.players.length));
    return `<div class="panel"><h3>⚙️ Luật chơi</h3><div class="settings">
      ${sel('horses', '🐴 Số ngựa mỗi người', S.horseChoices.map((v) => [v, `${v} ngựa${v === 2 ? ' (ván nhanh)' : ''}`]))}
      ${sel('out', '🚪 Ra quân khi đổ', [['16', '1 hoặc 6'], ['6', 'Chỉ 6']])}
      ${sel('home', '🏠 Lên chuồng', [['jump', 'Nhảy bậc (đổ số nào lên bậc đó)'], ['step', 'Từng bậc (đổ đúng bậc kế tiếp)']])}
      ${sel('turn_time', '⏱ Thời gian mỗi lượt', S.turnTimes.map((v) => [v, v ? `${v} giây` : 'Không giới hạn']))}
      <label class="switch"><input type="checkbox" data-cfg="block" ${cfg.block ? 'checked' : ''} ${dis}>
        <span>Cản đường<small>Không được nhảy qua đầu ngựa khác</small></span></label>
    </div><p class="estimate">⏳ Ước lượng: ${n} người × ${cfg.horses} ngựa ≈ ${ESTIMATE[n][cfg.horses]} phút (ván với bot).</p></div>`;
  }
  function renderPanel() {
    const el = $('#panel');
    if (S.phase === 'play') { setHTML(el, ''); return; }
    const host = S.me.host;
    let html;
    if (S.phase === 'end') {
      const rows = S.ranking.map((pid, i) => {
        const p = player(pid);
        if (!p) return '';
        return `<div class="res-row ${pid === S.winner ? 'win' : ''}"><span class="rank">${pid === S.winner ? '🏆' : i + 1}</span>
          <span class="rname">${esc(p.name)}${p.bot ? ' 🤖' : ''}</span>
          <div class="rcards"><span class="gh-muted">${CNAME[p.color]} · ${p.home}/${p.horses.length} ngựa lên chuồng</span></div>
          <span class="rpts">${p.wins} ván thắng</span></div>`;
      }).join('');
      html = `<div class="panel"><div class="result-head"><div class="trophy">🏆</div><div>
          <h2>${esc(nm(S.winner))}${S.winner === S.me.id ? ' (bạn)' : ''} về đích trước!</h2><p>Ván ${S.gameNo} kết thúc.</p></div></div>
        <div class="results">${rows}</div>
        <div class="start-row" style="margin-top:14px">${host
          ? `${btn('lobby', '🏠 Về phòng chờ', 'ghost')}${btn('next', '▶ Ván mới', 'primary', S.startError ? 'disabled' : '')}`
          : '<span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu ván mới…</span>'}</div></div>${host ? botPanel() + settingsPanel() : ''}`;
    } else {
      const start = host
        ? `<div class="start-row"><div>${S.startError ? `<span class="warn">⚠️ ${esc(S.startError)}</span>` : `<span class="gh-muted">${S.players.length}/${S.maxPlayers} người — sẵn sàng!</span>`}</div>
           ${btn('start', '🐴 Xuất phát', 'primary', S.startError ? 'disabled' : '')}</div>`
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
      + btn('edit-look', '👗 Nhân vật', 'small') + '<span class="hint">Nhấn vào người chơi khác (bên phải) để vẫy tay, ném cà chua…</span>');
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
      : '<div class="empty-note">Diễn biến ván cờ sẽ hiện ở đây.</div>';
    const list = $('#log-list');
    if (setHTML(list, html)) list.scrollTop = list.scrollHeight;
  }

  // ---------------------------------------------------------------- vẽ giao diện
  function render() {
    if (!S) return;
    $('#phase-pill').textContent = S.phase === 'lobby' ? '🏠 Phòng chờ' : S.phase === 'end' ? `🏁 Hết ván ${S.gameNo}` : `🐴 Ván ${S.gameNo}`;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `${S.phase === 'play' && S.turn === S.me.id && ['roll', 'move'].includes(S.stage) ? '🔔 ' : ''}Cờ Cá Ngựa ${ROOM}`;
    renderStables();
    renderDie();
    renderTargets();
    renderHorses();
    renderBanner();
    renderCast();
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
    if (!S || !S.deadline || !['roll', 'move'].includes(S.stage)) { timer.hidden = true; fill.style.width = '0'; return; }
    const remaining = Math.max(0, S.deadline - (Date.now() / 1000 + clockOffset));
    const secs = Math.ceil(remaining);
    timer.hidden = false;
    timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    timer.classList.toggle('urgent', secs <= 5 && S.turn === S.me.id);
    fill.style.width = `${S.total ? Math.min(1, remaining / S.total) * 100 : 0}%`;
  }
  setInterval(tick, 250);

  // ---------------------------------------------------------------- sự kiện
  document.addEventListener('click', async (e) => {
    const horse = e.target.closest('.horse.can');
    if (horse) { send('move', { horse: Number(horse.dataset.h) }); return; }
    const target = e.target.closest('.sq.target');
    if (target && S && S.moves) {
      const me = player(S.me.id);
      const id = target.dataset.id;
      const h = Object.keys(S.moves).find((k) => {
        const to = S.moves[k];
        return (to >= HOME ? `h${me.color}-${to - HOME}` : `t${absOf(me.color, to)}`) === id;
      });
      if (h !== undefined) { send('move', { horse: Number(h) }); return; }
    }
    if (e.target.closest('.goal.can-roll .die-box')) { send('roll'); return; }
    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled && actEl.dataset.act) {
      switch (actEl.dataset.act) {
        case 'roll': send('roll'); break;
        case 'start': send('start'); break;
        case 'next': send('next_round'); break;
        case 'lobby': send('lobby'); break;
        case 'edit-look': openLookEditor(); break;
        case 'add-bot': send('add_bot', { count: 1 }); break;
        case 'fill-bots': send('add_bot', { count: S.maxPlayers - S.players.length }); break;
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
    const pc = e.target.closest('.pcard') || e.target.closest('.horse');
    if (pc && pc.dataset.pid) { openMenu(pc.dataset.pid, pc); return; }
    if (menuEl && !e.target.closest('.pmenu')) closeMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if ((e.key === ' ' || e.key === 'Enter') && S && S.turn === S.me.id && S.stage === 'roll') { e.preventDefault(); send('roll'); }
    if (/^[1-4]$/.test(e.key) && S && S.moves && S.moves[String(Number(e.key) - 1)] !== undefined) send('move', { horse: Number(e.key) - 1 });
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-cfg]');
    if (!el) return;
    const key = el.dataset.cfg;
    const v = el.type === 'checkbox' ? el.checked : (['turn_time', 'horses'].includes(key) ? Number(el.value) : el.value);
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
    try { localStorage.setItem('cangua_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) play('home');
  });
  $('#btn-room').addEventListener('click', async () => { if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good'); });
  $('#btn-leave').addEventListener('click', () => {
    const doLeave = () => { if (conn) conn.leave(); setTimeout(() => { location.href = '/'; }, 150); };
    if (S && S.phase === 'play' && S.me.playing) {
      P.modal({
        title: 'Rời ván cờ?',
        body: '<p>Ván đang diễn ra — khi bạn vắng mặt, máy sẽ tự đổ và tự đi hộ. Vào lại phòng với <b>đúng tên cũ</b> để chơi tiếp.</p>',
        actions: [{ label: 'Ở lại', kind: 'ghost' }, { label: 'Rời phòng', kind: 'danger', onClick: doLeave }],
      });
    } else doLeave();
  });

  fetch('/api/info').then((r) => r.json()).then((inf) => {
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    const lan = location.protocol === 'https:' ? inf.https : inf.urls;
    if (local && lan && lan.length) { ui.lanBase = lan[0]; render(); }
  }).catch(() => {});

  buildBoard();
  // Bàn đổi cỡ (cửa sổ, thanh cuộn, phông chữ tải xong…) → đặt lại quân theo toạ độ ô mới.
  if (window.ResizeObserver) new ResizeObserver(() => { if (S) renderHorses(); }).observe($('#board'));
  else window.addEventListener('resize', () => { if (S) renderHorses(); });
  $('#room-code').textContent = ROOM;
  P.ensureName(() => connect());
})();
