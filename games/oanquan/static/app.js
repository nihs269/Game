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
    lastSeq: null, wasMine: false, sel: null,
    view: null,          // bàn cờ đang diễn hoạt ảnh rải (khác S cho tới khi diễn xong)
    hand: null, timers: [],
    tab: 'players', unread: 0, lastChatId: null, lanBase: null, sound: true,
  };
  try { ui.sound = localStorage.getItem('oanquan_sound') !== '0'; } catch (e) { /* bỏ qua */ }

  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
  };
  const HEX = ['#ff8a5c', '#4db6ff', '#7ddc6a', '#e08bff'];
  const STONES = ['#8f8a80', '#b9ab92', '#6f7a83', '#c9c0b0', '#9a7f66', '#7d8b74', '#a6a29a', '#cbb79a'];
  const MAX_STONES = 18;  // vẽ tối đa chừng này viên mỗi ô, còn lại xem số đếm

  // ---------------------------------------------------------------- bố cục bàn
  // Vòng 6n ô cho n người: ghế s có ô quan 6s và hàng dân 6s+1..6s+5. Hàng của mình luôn nằm ở cạnh dưới,
  // đi sang phải trên cạnh dưới là chiều +1; các cạnh khác xếp tiếp theo vòng (ngược chiều kim đồng hồ).
  const nSeats = () => (S && S.n ? S.n : 2);
  const mySeat = () => (S && S.me.seat !== null && S.me.seat !== undefined ? S.me.seat : 0);
  const rowOf = (seat) => [1, 2, 3, 4, 5].map((j) => 6 * seat + j);
  const SIDE_NAME = { 2: ['Hàng dưới', 'Hàng trên'], 3: ['Cạnh dưới', 'Cạnh phải', 'Cạnh trái'], 4: ['Cạnh dưới', 'Cạnh phải', 'Cạnh trên', 'Cạnh trái'] };
  const sideName = (seat) => SIDE_NAME[nSeats()][(seat - mySeat() + nSeats()) % nSeats()];
  function layout() {
    const me = mySeat();
    const other = (me + 1) % 2;
    return { bot: rowOf(me), top: rowOf(other).reverse(), L: 6 * me, R: 6 * other };
  }

  // Bàn 3 người (tam giác đều) / 4 người (hình vuông): mỗi cạnh là hàng 5 ô dân của một người, ô quan tròn
  // nằm ở góc. Toạ độ theo đơn vị bàn rộng 1000 (= 100cqw). Ô dân xoay theo cạnh, mặt trên hướng vào tâm.
  function polyGeometry(n) {
    const W = 1000;
    const m = 26;
    const L = W - 2 * m;
    const theta = (Math.PI * (n - 2)) / n;            // góc trong của đa giác
    const H = n === 3 ? Math.round(L * Math.sin(Math.PI / 3) + 2 * m) : W;
    const V = n === 3 ? [[m, H - m], [W - m, H - m], [W / 2, m]] : [[m, H - m], [W - m, H - m], [W - m, m], [m, m]];
    const cx = V.reduce((t, v) => t + v[0], 0) / n;
    const cy = V.reduce((t, v) => t + v[1], 0) / n;
    const cot = 1 / Math.tan(theta / 2);
    const w = L / (5 + 2 * 1.25 * cot);                // bề ngang ô dân
    const dp = 1.25 * w;                               // chiều sâu ô dân (vuông góc với cạnh)
    const q = dp * cot;                                // phần cạnh dành cho góc quan
    const rq = dp * (n === 3 ? 0.6 : 0.48);            // bán kính ô quan
    const cells = [];
    for (let e = 0; e < n; e++) {
      const seat = (mySeat() + e) % n;
      const [ax, ay] = V[e];
      const [bx, by] = V[(e + 1) % n];
      const ux = (bx - ax) / L;
      const uy = (by - ay) / L;
      let nx = uy;
      let ny = -ux;
      if ((cx - ax) * nx + (cy - ay) * ny < 0) { nx = -nx; ny = -ny; }
      const rot = (Math.atan2(uy, ux) * 180) / Math.PI;
      const bl = Math.hypot(cx - ax, cy - ay);
      const dq = rq / Math.sin(theta / 2);
      cells.push({ i: 6 * seat, seat, quan: true, x: ax + ((cx - ax) / bl) * dq, y: ay + ((cy - ay) / bl) * dq, w: 2 * rq, h: 2 * rq, rot: 0 });
      for (let j = 1; j <= 5; j++) {
        const t = q + (j - 0.5) * w;
        cells.push({ i: 6 * seat + j, seat, quan: false, x: ax + ux * t + (nx * dp) / 2, y: ay + uy * t + (ny * dp) / 2, w: w * 0.9, h: dp * 0.92, rot });
      }
    }
    // viền gỗ: đa giác nới ra ngoài một chút quanh các đỉnh
    const wood = V.map(([x, y]) => { const d = Math.hypot(x - cx, y - cy); return [x + ((x - cx) / d) * 20, y + ((y - cy) / d) * 20]; });
    return { W, H, cells, wood };
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
  const cellEl = (i) => document.querySelector(`.cell[data-i="${i}"]`);
  let cast = null;
  function anchorEl(pid) {
    const a = cast && cast.anchor(pid);
    if (a) return a;
    const b = document.querySelector(`.bank[data-pid="${CSS.escape(pid || '')}"] .ava`);
    if (b) return b;
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
    pick: () => [[330, 0.05, 'triangle', 0.05], [262, 0.07, 'triangle', 0.05]],
    drop: () => [[900 + Math.random() * 300, 0.04, 'square', 0.025]],
    eat: () => [[523, 0.08], [784, 0.14]],
    quan: () => [[392, 0.1], [523, 0.1], [784, 0.1], [1047, 0.25]],
    stop: () => [[220, 0.1, 'triangle', 0.05]],
    spread: () => Array.from({ length: 5 }, (_, k) => [600 + k * 80, 0.05, 'square', 0.025]),
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
    const mine = S.phase === 'play' && S.turn === S.me.id && S.stage === 'pick';
    if (mine && !ui.wasMine && !first) { play('turn'); if (navigator.vibrate) navigator.vibrate(100); }
    if (!mine) ui.sel = null;
    ui.wasMine = mine;
    const move = fresh.find((e) => e.type === 'move');
    if (move && prev && prev.phase === 'play') animateMove(move, prev);
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
  function fly(html, from, to, { dur = 550, delay = 0 } = {}) {
    if (!from || !to) return;
    const el = document.createElement('div');
    el.className = 'flyer';
    el.innerHTML = html;
    el.style.left = '0px'; el.style.top = '0px'; el.style.opacity = '0';
    document.body.appendChild(el);
    const w = el.offsetWidth; const h = el.offsetHeight;
    const anim = el.animate([
      { transform: `translate(${from.left + from.width / 2 - w / 2}px, ${from.top + from.height / 2 - h / 2}px) scale(1)`, opacity: 1 },
      { transform: `translate(${to.left + to.width / 2 - w / 2}px, ${to.top + to.height / 2 - h / 2}px) scale(.7)`, opacity: 1 },
    ], { duration: dur, delay, easing: 'cubic-bezier(.3,.8,.3,1)', fill: 'forwards' });
    anim.onfinish = () => el.remove();
  }
  function flash(i, cls, ms) {
    const el = cellEl(i);
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  // Diễn lại nước đi từng bước trên bản sao bàn cờ trước nước đi, theo đúng nhịp máy chủ chờ.
  function animateMove(e, prev) {
    ui.timers.forEach(clearTimeout);
    ui.timers = [];
    const v = {
      dan: prev.dan.slice(), quan: prev.quan.slice(), gotDan: prev.gotDan.slice(), gotQuan: prev.gotQuan.slice(),
    };
    ui.view = v;
    ui.hand = { at: e.cell, n: 0 };
    let t = 0;
    const T = S.stepTime;
    e.steps.forEach((s) => {
      ui.timers.push(setTimeout(() => runStep(e, s), t * 1000));
      t += T[s[0]];
    });
    ui.timers.push(setTimeout(() => { ui.view = null; ui.hand = null; render(); }, t * 1000 + 120));
  }
  function runStep(e, s) {
    const v = ui.view;
    if (!v) return;
    const [kind, i] = s;
    if (kind === 'pick') {
      v.dan[i] = 0; ui.hand = { at: i, n: s[2] };
      flash(i, 'pick', 300); play('pick');
    } else if (kind === 'drop') {
      v.dan[i] += 1; ui.hand = { at: i, n: Math.max(0, ui.hand.n - 1) };
      flash(i, 'drop', 250); play('drop');
    } else if (kind === 'eat') {
      const from = rectOf(cellEl(i));
      v.dan[i] = 0; v.quan[i] = 0;
      v.gotDan[e.seat] += s[2]; v.gotQuan[e.seat] += s[3];
      ui.hand = { at: i, n: 0 };
      flash(i, 'eat', 600);
      play(s[3] ? 'quan' : 'eat');
      const bank = rectOf(document.querySelector(`.bank[data-seat="${e.seat}"] .chip.pts`));
      const stones = Math.min(6, s[2]);
      if (s[3]) fly('<span style="font-size:34px">🪨</span>', from, bank, { dur: 650 });
      for (let k = 0; k < stones; k++) fly(`<i class="fly-stone" style="--sc:${STONES[k % STONES.length]}"></i>`, from, bank, { dur: 500, delay: k * 40 });
      if (s[3]) bubble(e.pid, '👑', 'emoji');
    } else if (kind === 'stop') {
      flash(i, 'stop', 300); play('stop');
      ui.hand = null;
    }
    renderBoard();
    renderBanks();
    if (kind === 'eat') { renderCast(); renderPlayers(); }
  }

  function playEvent(e) {
    switch (e.type) {
      case 'spread':
        play('spread');
        bubble(e.pid, '🧺', 'emoji');
        rowOf(e.seat).forEach((c, k) => setTimeout(() => flash(c, 'drop', 250), k * 120));
        break;
      case 'move':
        if (e.quan && cast) cast.react(e.pid, 'cheer');
        break;
      case 'end':
        play('win');
        if (e.pid) { bubble(e.pid, '🏆', 'emoji'); if (cast) cast.react(e.pid, 'cheer'); }
        break;
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

  // ---------------------------------------------------------------- vẽ bàn
  function buildBoard() {
    const board = $('#board');
    const n = nSeats();
    ui.built = `${n}:${mySeat()}`;
    htmlCache.forEach((_, el) => { if (board.contains(el)) htmlCache.delete(el); });
    board.innerHTML = '';
    board.classList.toggle('poly', n > 2);
    board.classList.toggle('tri', n === 3);
    const add = (cls, pos) => {
      const el = document.createElement('div');
      el.className = `cell ${cls}`;
      if (pos !== undefined) el.dataset.pos = pos;
      board.appendChild(el);
      return el;
    };
    if (n > 2) {
      const g = polyGeometry(n);
      const u = (v) => `${(v / 10).toFixed(2)}cqw`;
      board.style.aspectRatio = `${g.W} / ${g.H}`;
      board.insertAdjacentHTML('beforeend', `<svg class="wood" viewBox="0 0 ${g.W} ${g.H}" aria-hidden="true">
        <defs><linearGradient id="oaq-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b77a43"/><stop offset=".55" stop-color="#8c5527"/><stop offset="1" stop-color="#74431c"/></linearGradient></defs>
        <polygon points="${g.wood.map((v) => v.map((k) => k.toFixed(1)).join(',')).join(' ')}" fill="url(#oaq-wood)" stroke="#5a3212" stroke-width="12" stroke-linejoin="round"/></svg>`);
      g.cells.forEach((c) => {
        const el = add(c.quan ? 'quan' : 'dan');
        el.dataset.i = c.i;
        el.style.cssText = `left:${u(c.x - c.w / 2)};top:${u(c.y - c.h / 2)};width:${u(c.w)};height:${u(c.h)};--rot:${c.rot.toFixed(1)}deg;--cc:${HEX[c.seat]}`;
      });
      board.insertAdjacentHTML('beforeend', '<div id="hand" class="hand" hidden>✋<b></b></div>');
      return;
    }
    board.style.aspectRatio = '';
    add('quan qL', 'L');
    for (let k = 0; k < 5; k++) add('dan', `t${k}`);
    add('quan qR', 'R');
    for (let k = 0; k < 5; k++) add('dan', `b${k}`);
    // xếp lưới: hàng trên ô 2..6 dòng 1, hàng dưới dòng 2
    board.querySelectorAll('.cell.dan').forEach((el) => {
      const top = el.dataset.pos[0] === 't';
      el.style.gridRow = top ? '1' : '2';
      el.style.gridColumn = String(Number(el.dataset.pos.slice(1)) + 2);
    });
    board.insertAdjacentHTML('beforeend', '<div class="side-tag top" id="tag-top"></div><div class="side-tag bot" id="tag-bot"></div><div id="hand" class="hand" hidden>✋<b></b></div>');
  }

  // Vị trí viên sỏi trong ô: rải theo xoắn ốc “góc vàng”, cố định theo số thứ tự để không nhảy lung tung.
  function stonesHTML(n, i, quan) {
    const shown = Math.min(n, MAX_STONES);
    let html = '';
    for (let k = 0; k < shown; k++) {
      const r = Math.sqrt((k + 0.6) / MAX_STONES) * (quan ? 0.34 : 0.4);
      const a = k * 2.39996 + i * 0.9;
      const x = 50 + Math.cos(a) * r * 100;
      const y = (quan ? 60 : 50) + Math.sin(a) * r * (quan ? 55 : 100);
      html += `<i class="stone" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--sc:${STONES[(k * 5 + i) % STONES.length]};--r:${(k * 47) % 360}deg"></i>`;
    }
    return html;
  }

  function renderBoard() {
    if (!S) return;
    if (ui.built !== `${nSeats()}:${mySeat()}`) buildBoard();
    const L = layout();
    const v = ui.view || S;
    const map = { L: L.L, R: L.R };
    L.top.forEach((c, k) => { map[`t${k}`] = c; });
    L.bot.forEach((c, k) => { map[`b${k}`] = c; });
    const canPick = !ui.view && S.legal ? new Set(S.legal) : null;
    const last = !ui.view && S.lastMove && S.phase === 'play' ? S.lastMove.cell : null;
    document.querySelectorAll('#board .cell').forEach((el) => {
      const i = el.dataset.pos ? map[el.dataset.pos] : Number(el.dataset.i);
      el.dataset.i = i;
      const n = v.dan[i];
      const q = v.quan[i];
      const sel = ui.sel === i && canPick && canPick.has(i);
      const arrows = sel ? '<button class="arr l" data-dir="-1" title="Rải sang trái">◀</button><button class="arr r" data-dir="1" title="Rải sang phải">▶</button>' : '';
      setHTML(el, `${q ? '<div class="qstone">👑</div>' : ''}${stonesHTML(n, i, el.classList.contains('quan'))}<span class="cnt ${n ? '' : 'zero'}">${n}</span>${arrows}`);
      el.classList.toggle('can', !!(canPick && canPick.has(i)));
      el.classList.toggle('sel', !!sel);
      el.classList.toggle('last', last === i);
      el.title = el.classList.contains('quan') ? `Ô quan: ${q ? '1 quan + ' : ''}${n} dân` : `${n} dân`;
    });
    // bàn tay đang cầm quân rải
    const hand = $('#hand');
    const h = ui.hand;
    const at = h ? cellEl(h.at) : null;
    hand.hidden = !at;
    if (at) {
      hand.style.left = `${at.offsetLeft + at.offsetWidth / 2}px`;
      hand.style.top = `${at.offsetTop + at.offsetHeight / 2}px`;
      hand.querySelector('b').textContent = h.n;
      hand.querySelector('b').hidden = !h.n;
    }
    const seatName = (seat) => {
      const pid = S.seats[seat];
      return pid ? `${pid === S.me.id ? 'BẠN' : esc(nm(pid)).toUpperCase()}` : '';
    };
    if (nSeats() === 2) {
      setHTML($('#tag-top'), S.seats.length ? `HÀNG CỦA ${seatName(1 - mySeat())}` : '');
      setHTML($('#tag-bot'), S.seats.length ? `HÀNG CỦA ${seatName(mySeat())}` : '');
    }
  }

  // Điểm đang hiển thị: trong lúc diễn hoạt ảnh rải thì theo bàn đang diễn, không nhảy trước.
  function shownScore(seat) {
    const v = ui.view || S;
    return S.phase === 'end' ? S.scores[seat] : v.gotDan[seat] + v.gotQuan[seat] * S.config.quan_value;
  }

  // Kho điểm: đối thủ ở trên bàn (theo thứ tự vòng chơi), mình ở dưới bàn.
  function renderBanks() {
    const n = nSeats();
    const on = S.seats.length > 0;
    fillBanks($('#banks-top'), on ? Array.from({ length: n - 1 }, (_, k) => (mySeat() + 1 + k) % n) : []);
    fillBanks($('#banks-bot'), on ? [mySeat()] : []);
  }
  function fillBanks(box, seats) {
    const want = seats.join(',');
    if (box.dataset.seats !== want) {
      box.dataset.seats = want;
      box.innerHTML = seats.map((seat) => `<div class="bank" data-seat="${seat}"></div>`).join('');
    }
    box.classList.toggle('many', seats.length > 1);
    box.querySelectorAll('.bank').forEach((el) => renderBank(el, Number(el.dataset.seat)));
  }
  function renderBank(el, seat) {
    const v = ui.view || S;
    const pid = S.seats[seat];
    const p = pid ? player(pid) : null;
    el.dataset.pid = pid || '';
    el.style.setProperty('--cc', HEX[seat]);
    el.classList.toggle('turn', S.phase === 'play' && S.turn === pid);
    el.classList.toggle('empty', !p);
    const qv = S.config.quan_value;
    const pts = shownScore(seat);
    const state = S.turn === pid && S.phase === 'play' ? '⏳ Đang đến lượt' : (p && p.wins ? `🏆 ${p.wins} ván thắng` : (p && p.bot ? 'Người chơi ảo' : ''));
    const sub = nSeats() > 2 ? `${sideName(seat)}${state ? ` · ${state}` : ''}` : state;
    const html = `<div class="ava">${p ? window.Avatar.svg(p.look, { head: true, seed: p.id }) : ''}</div>
      <div class="who"><b>${who(pid)}${p && p.bot ? ' 🤖' : ''}</b><span>${sub}</span></div>
      <div class="loot"><span class="chip" title="Dân đã ăn">🪨 ${v.gotDan[seat]}</span><span class="chip" title="Quan đã ăn (mỗi quan ${qv} điểm)">👑 ${v.gotQuan[seat]}</span>
        ${S.debt[seat] ? `<span class="chip debt" title="Dân đã vay, cuối ván trả lại">nợ ${S.debt[seat]}</span>` : ''}
        <span class="chip pts" data-v="${pts}">${pts} điểm</span></div>`;
    const old = el.querySelector('.chip.pts');
    const bumped = old && Number(old.dataset.v) < pts;
    if (setHTML(el, html) && bumped) el.querySelector('.chip.pts').classList.add('bump');
  }

  function renderBanner() {
    const el = $('#banner');
    let big = '🪨';
    let title = '';
    let sub = '';
    let cls = 'gbanner';
    if (S.phase === 'lobby') {
      big = '🧺'; title = 'Phòng chờ';
      sub = `${S.players.length}/${S.maxPlayers} người · ${S.me.host ? 'bạn là chủ phòng — chỉnh luật rồi bấm Bắt đầu bên dưới' : 'đang chờ chủ phòng bắt đầu…'}`;
    } else if (S.phase === 'end') {
      big = S.winner ? '🏆' : '🤝'; cls += ' win';
      title = S.winner ? `${who(S.winner)} thắng!` : 'Hoà!';
      sub = `Hết quan, tàn dân — ván ${S.gameNo} kết thúc ${S.final.ranking.map((k) => S.final.scores[k]).join(' : ')}.`;
    } else {
      const seat = S.seats.indexOf(S.turn);
      const dot = `<span class="dotc" style="--pc:${HEX[seat]}"></span>`;
      const mine = S.turn === S.me.id;
      const name = mine ? 'Bạn' : esc(nm(S.turn));
      if (S.stage === 'spread') {
        big = '🧺'; title = `${dot}${name} hết quân trên hàng — rải 5 dân từ kho`;
      } else if (S.stage === 'sowing') {
        big = '✋'; title = `${dot}${name} đang rải quân…`;
      } else if (mine) {
        big = '👆'; cls += ' mine'; title = `${dot}Đến lượt bạn!`;
        sub = ui.sel === null
          ? 'Bấm vào một ô sáng ở hàng dưới (phím 1–5) để bốc quân.'
          : 'Chọn chiều rải: ◀ sang trái hoặc ▶ sang phải (phím ← / →).';
      } else {
        big = '🤔'; title = `${dot}${name} đang tính nước…`;
      }
    }
    if (S.phase === 'play' && !S.me.playing) sub = `👀 Bạn đang xem ván này — ván sau sẽ được vào chơi.${sub ? ` · ${sub}` : ''}`;
    el.className = cls;
    setHTML(el, `<div class="big">${big}</div><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div></div>`);
  }

  function renderCast() {
    if (!cast) cast = new window.Cast($('#cast'), { onClick: (pid, el) => openMenu(pid, el) });
    const list = S.phase === 'lobby' ? S.players : S.players.filter((p) => p.playing);
    cast.update(list.map((p) => ({
      id: p.id, name: p.name, look: p.look, bot: p.bot, me: p.id === S.me.id,
      color: p.seat !== null ? HEX[p.seat] : null,
      turn: S.phase === 'play' && S.turn === p.id,
      dim: !p.connected,
      sub: p.playing ? `${shownScore(p.seat)} điểm` : (p.host ? '👑 chủ phòng' : ''),
      badge: S.phase === 'end' && S.winner === p.id ? '🏆' : (p.host && p.playing ? '👑' : ''),
    })));
  }

  function renderPlayers() {
    const html = S.players.map((p) => {
      const tags = [p.bot ? '🤖' : '', p.host ? '👑' : '', p.wins ? `🏆${p.wins}` : '', p.connected ? '' : '📴'].filter(Boolean).join(' ');
      const sub = p.playing ? sideName(p.seat) : (S.phase === 'lobby' ? 'Sẵn sàng' : '👀 Đang xem');
      return `<div class="pcard ${S.turn === p.id && S.phase === 'play' ? 'turn' : ''}" style="--cc:${p.seat !== null ? HEX[p.seat] : 'transparent'}" data-pid="${esc(p.id)}">
        <div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>
        <div class="pn"><b>${p.id === S.me.id ? 'Bạn' : esc(p.name)} ${tags}</b><span>${sub}</span></div>
        ${p.playing ? `<div class="pts">${shownScore(p.seat)} điểm</div>` : ''}</div>`;
    }).join('');
    setHTML($('#plist'), html);
  }

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const inviteLink = () => `${ui.lanBase || location.origin}/g/oanquan/?room=${ROOM}`;
  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    return `<div class="panel"><h3><span class="grow">🤖 Người chơi ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Thiếu người? Thêm bot — bot biết tính nước ăn quan và (ở mức khó) đề phòng bị ăn lại. 3 người chơi trên bàn tam giác, 4 người trên bàn vuông.</p>
      <div class="btns-row">${btn('add-bot', '＋ 1 bot', 'small', n >= S.maxPlayers ? 'disabled' : '')}
        ${btn('fill-bots', 'Lấp đủ 4 người', 'small primary', n >= S.maxPlayers ? 'disabled' : '')}
        ${bots ? btn('remove-bots', '🗑 Xoá bot', 'small ghost') : ''}</div></div>`;
  }
  function settingsPanel() {
    const dis = S.me.host ? '' : 'disabled';
    const cfg = S.config;
    const sel = (key, label, opts) => `<div class="setting"><label>${label}</label><select data-cfg="${key}" ${dis}>
      ${opts.map(([v, t]) => `<option value="${v}" ${String(v) === String(cfg[key]) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    return `<div class="panel"><h3>⚙️ Luật chơi</h3><div class="settings">
      ${sel('quan_value', '👑 Mỗi quan bằng', [[10, '10 dân'], [5, '5 dân']])}
      ${sel('turn_time', '⏱ Thời gian mỗi lượt', S.turnTimes.map((v) => [v, v ? `${v} giây` : 'Không giới hạn']))}
      ${sel('bot', '🤖 Độ khó bot', [['easy', 'Dễ'], ['normal', 'Vừa'], ['hard', 'Khó']])}
      <label class="switch"><input type="checkbox" data-cfg="quan_non" ${cfg.quan_non ? 'checked' : ''} ${dis}>
        <span>Luật quan non<small>Ô quan còn ít hơn 5 dân thì chưa được ăn</small></span></label>
    </div><p class="estimate">⏳ ${{ 2: 'Bàn chữ nhật 2 người: một ván khoảng 3–6 phút.', 3: 'Bàn tam giác 3 người: một ván khoảng 5–10 phút.', 4: 'Bàn vuông 4 người: một ván khoảng 8–15 phút.' }[nSeats()]}</p></div>`;
  }
  function renderPanel() {
    const el = $('#panel');
    if (S.phase === 'play') { setHTML(el, ''); return; }
    const host = S.me.host;
    let html;
    if (S.phase === 'end') {
      const f = S.final;
      const qv = S.config.quan_value;
      const rows = f.ranking.map((seat) => {
        const pid = S.seats[seat];
        const p = player(pid);
        const win = pid === S.winner;
        const rank = 1 + f.scores.filter((x) => x > f.scores[seat]).length;
        const parts = [`🪨 ${S.gotDan[seat]} dân`, `👑 ${S.gotQuan[seat]} quan × ${qv}`];
        if (f.swept[seat]) parts.push(`(gồm ${f.swept[seat]} dân thu trên hàng)`);
        if (f.borrowed[seat]) parts.push(`trả nợ ${f.borrowed[seat]}`);
        if (f.lent[seat]) parts.push(`được trả ${f.lent[seat]}`);
        return `<div class="res-row ${win ? 'win' : ''}"><span class="rank">${win ? '🏆' : (rank === 1 ? '🤝' : rank)}</span>
          <span class="rname">${who(pid)}${p && p.bot ? ' 🤖' : ''}</span>
          <div class="rcards"><span class="gh-muted">${parts.join(' · ')}</span></div>
          <span class="rpts">${f.scores[seat]} điểm<small>${p ? p.wins : 0} ván thắng</small></span></div>`;
      }).join('');
      const head = S.winner ? `${esc(nm(S.winner))}${S.winner === S.me.id ? ' (bạn)' : ''} thắng!`
        : (f.leaders.length === S.seats.length ? 'Tất cả hoà!' : `Hoà — ${f.leaders.map((k) => who(S.seats[k])).join(', ')} cùng dẫn đầu!`);
      html = `<div class="panel"><div class="result-head"><div class="trophy">${S.winner ? '🏆' : '🤝'}</div><div>
          <h2>${head}</h2><p>Hết quan, tàn dân — ván ${S.gameNo} kết thúc.${S.draws ? ` (${S.draws} ván hoà)` : ''}</p></div></div>
        <div class="results">${rows}</div>
        <div class="start-row" style="margin-top:14px">${host
          ? `${btn('lobby', '🏠 Về phòng chờ', 'ghost')}${btn('next', '▶ Ván mới', 'primary', S.startError ? 'disabled' : '')}`
          : '<span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu ván mới…</span>'}</div></div>${host ? botPanel() + settingsPanel() : ''}`;
    } else {
      const start = host
        ? `<div class="start-row"><div>${S.startError ? `<span class="warn">⚠️ ${esc(S.startError)}</span>` : `<span class="gh-muted">${S.players.length}/${S.maxPlayers} người — sẵn sàng!</span>`}</div>
           ${btn('start', '🪨 Bắt đầu', 'primary', S.startError ? 'disabled' : '')}</div>`
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
      + btn('edit-look', '👗 Nhân vật', 'small') + '<span class="hint">Nhấn vào người chơi khác để vẫy tay, ném cà chua…</span>');
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
      : '<div class="empty-note">Diễn biến ván chơi sẽ hiện ở đây.</div>';
    const list = $('#log-list');
    if (setHTML(list, html)) list.scrollTop = list.scrollHeight;
  }

  // ---------------------------------------------------------------- vẽ giao diện
  function render() {
    if (!S) return;
    $('#phase-pill').textContent = S.phase === 'lobby' ? '🏠 Phòng chờ' : S.phase === 'end' ? `🏁 Hết ván ${S.gameNo}` : `🪨 Ván ${S.gameNo}`;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `${S.phase === 'play' && S.turn === S.me.id && S.stage === 'pick' ? '🔔 ' : ''}Ô Ăn Quan ${ROOM}`;
    renderBoard();
    renderBanks();
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
    if (!S || !S.deadline || S.stage !== 'pick') { timer.hidden = true; fill.style.width = '0'; return; }
    const remaining = Math.max(0, S.deadline - (Date.now() / 1000 + clockOffset));
    const secs = Math.ceil(remaining);
    timer.hidden = false;
    timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    timer.classList.toggle('urgent', secs <= 5 && S.turn === S.me.id);
    fill.style.width = `${S.total ? Math.min(1, remaining / S.total) * 100 : 0}%`;
  }
  setInterval(tick, 250);

  // ---------------------------------------------------------------- sự kiện
  function pickCell(i) {
    if (!S || !S.legal || ui.view || !S.legal.includes(i)) return;
    ui.sel = ui.sel === i ? null : i;
    renderBoard();
    renderBanner();
  }
  function sow(d) {
    if (ui.sel === null || !S || !S.legal) return;
    send('move', { cell: ui.sel, dir: d });
    ui.sel = null;
  }

  document.addEventListener('click', async (e) => {
    const arr = e.target.closest('.cell .arr');
    if (arr) { sow(Number(arr.dataset.dir)); return; }
    const cell = e.target.closest('.cell.can');
    if (cell) { pickCell(Number(cell.dataset.i)); return; }
    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled && actEl.dataset.act) {
      switch (actEl.dataset.act) {
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
    const pc = e.target.closest('.pcard') || e.target.closest('.bank[data-pid]');
    if (pc && pc.dataset.pid) { openMenu(pc.dataset.pid, pc); return; }
    if (menuEl && !e.target.closest('.pmenu')) closeMenu();
    if (ui.sel !== null && !e.target.closest('.cell')) { ui.sel = null; renderBoard(); renderBanner(); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (!S || !S.legal) return;
    if (/^[1-5]$/.test(e.key)) pickCell(layout().bot[Number(e.key) - 1]);
    else if (e.key === 'ArrowLeft' && ui.sel !== null) { e.preventDefault(); sow(-1); }
    else if (e.key === 'ArrowRight' && ui.sel !== null) { e.preventDefault(); sow(1); }
    else if (e.key === 'Escape') { ui.sel = null; renderBoard(); renderBanner(); }
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-cfg]');
    if (!el) return;
    const key = el.dataset.cfg;
    const v = el.type === 'checkbox' ? el.checked : (['turn_time', 'quan_value'].includes(key) ? Number(el.value) : el.value);
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
    try { localStorage.setItem('oanquan_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) play('eat');
  });
  $('#btn-room').addEventListener('click', async () => { if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good'); });
  $('#btn-leave').addEventListener('click', () => {
    const doLeave = () => { if (conn) conn.leave(); setTimeout(() => { location.href = '/'; }, 150); };
    if (S && S.phase === 'play' && S.me.playing) {
      P.modal({
        title: 'Rời ván chơi?',
        body: '<p>Ván đang diễn ra — khi bạn vắng mặt, máy sẽ tự đi hộ. Vào lại phòng với <b>đúng tên cũ</b> để chơi tiếp.</p>',
        actions: [{ label: 'Ở lại', kind: 'ghost' }, { label: 'Rời phòng', kind: 'danger', onClick: doLeave }],
      });
    } else doLeave();
  });

  fetch('/api/info').then((r) => r.json()).then((inf) => {
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    const lan = location.protocol === 'https:' ? inf.https : inf.urls;
    if (local && lan && lan.length) { ui.lanBase = lan[0]; render(); }
  }).catch(() => {});

  if (window.ResizeObserver) new ResizeObserver(() => { if (S) renderBoard(); }).observe($('#board'));
  $('#room-code').textContent = ROOM;
  P.ensureName(() => connect());
})();
