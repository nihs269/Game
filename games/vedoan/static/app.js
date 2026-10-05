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
    turnId: null, ver: 0, syncTimer: null, lastFeedId: 0, lastClock: null,
  };
  try { ui.sound = localStorage.getItem('vedoan_sound') !== '0'; } catch (e) { /* bỏ qua */ }

  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
  };
  const LEVEL_NAMES = { easy: 'Dễ', normal: 'Vừa', hard: 'Khó' };
  const PALETTE = ['#000000', '#7a7a7a', '#ffffff', '#e53935', '#ff7043', '#ffb300', '#fdd835', '#7cb342',
    '#2e7d32', '#00acc1', '#1e88e5', '#3949ab', '#8e24aa', '#ec407a', '#8d6e63', '#ffccbc'];
  const SIZES = [3, 7, 14, 28];
  const CW = 800;
  const CH = 600;

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
  const colorOf = (id) => { const p = player(id); return (p && p.color) || '#8892b0'; };
  const amDrawer = () => !!(S && S.phase === 'play' && S.drawer === S.me.id);
  const canDraw = () => amDrawer() && S.stage === 'draw';
  let cast = null;
  function anchorEl(pid) {
    const a = cast && cast.anchor(pid);
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
    correct: () => [[784, 0.08], [1046, 0.14]],
    mine: () => [[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.3]],
    close: () => [[660, 0.08, 'triangle'], [700, 0.1, 'triangle']],
    start: () => [[440, 0.1], [660, 0.16]],
    reveal: () => [[392, 0.12], [523, 0.2]],
    tick: () => [[1000, 0.04, 'square', 0.025]],
    hint: () => [[880, 0.06, 'triangle'], [1175, 0.1, 'triangle']],
    win: () => [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]],
  };
  const play = (k) => beep(SOUNDS[k]());

  // ---------------------------------------------------------------- kết nối
  function connect() {
    conn = P.connect({
      room: ROOM,
      onState,
      onFx,
      onMessage: (m) => { if (m.type === 'draw') onDraw(m); },
      onStatus: (on) => $('#conn').classList.toggle('off', !on),
      onFatal: (m) => P.showFatal(m, { onRetryName: () => connect() }),
    });
  }

  function onState(state) {
    const prevTurn = S ? S.turnId : null;
    S = state;
    clockOffset = state.now - Date.now() / 1000;
    const events = state.events || [];
    let fresh = [];
    if (ui.lastSeq === null) ui.lastSeq = events.length ? events[events.length - 1].seq : 0;
    else fresh = events.filter((e) => e.seq > ui.lastSeq);
    if (events.length) ui.lastSeq = Math.max(ui.lastSeq, events[events.length - 1].seq);
    if (prevTurn !== null && S.turnId !== prevTurn) { ops = []; strokeEnds.clear(); redraw(); }
    checkVersion();
    render();
    fresh.forEach(playEvent);
  }

  // ---------------------------------------------------------------- bức vẽ
  const canvas = $('#canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let ops = [];                     // bản sao các thao tác vẽ (để vẽ lại khi hoàn tác / đồng bộ)
  const strokeEnds = new Map();     // id nét → điểm cuối đã vẽ (để nối tiếp các đoạn)
  const tool = { mode: 'pen', color: '#000000', size: 7 };

  function wipe() { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CW, CH); }
  function drawSegment(c, w, pts, from) {
    if (!pts.length) return;
    ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    let [x0, y0] = from || [pts[0], pts[1]];
    if (!from && pts.length === 2) { ctx.beginPath(); ctx.arc(x0, y0, w / 2, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.beginPath(); ctx.moveTo(x0, y0);
    for (let i = from ? 0 : 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
    [x0, y0] = [pts[pts.length - 2], pts[pts.length - 1]];
    return [x0, y0];
  }
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  // Đổ màu vùng kín (so màu có dung sai để ăn cả viền khử răng cưa).
  function floodFill(x, y, color) {
    const img = ctx.getImageData(0, 0, CW, CH);
    const d = img.data;
    const [r, g, b] = hexRgb(color);
    const i0 = (y * CW + x) * 4;
    const tr = d[i0]; const tg = d[i0 + 1]; const tb = d[i0 + 2];
    if (Math.abs(tr - r) + Math.abs(tg - g) + Math.abs(tb - b) < 10) return;
    const tol = 90;
    const match = (i) => Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) <= tol;
    const seen = new Uint8Array(CW * CH);
    const stack = [x, y];
    while (stack.length) {
      const py = stack.pop(); const px = stack.pop();
      let lx = px;
      while (lx >= 0 && !seen[py * CW + lx] && match((py * CW + lx) * 4)) lx--;
      lx++;
      let up = false; let down = false;
      for (let cx = lx; cx < CW; cx++) {
        const k = py * CW + cx;
        if (seen[k] || !match(k * 4)) break;
        seen[k] = 1;
        d[k * 4] = r; d[k * 4 + 1] = g; d[k * 4 + 2] = b; d[k * 4 + 3] = 255;
        if (py > 0) { const u = k - CW; if (!seen[u] && match(u * 4)) { if (!up) { stack.push(cx, py - 1); up = true; } } else up = false; }
        if (py < CH - 1) { const v = k + CW; if (!seen[v] && match(v * 4)) { if (!down) { stack.push(cx, py + 1); down = true; } } else down = false; }
      }
    }
    // Lấp viền khử răng cưa còn sót quanh vùng vừa đổ.
    for (let k = 0; k < CW * CH; k++) {
      if (seen[k]) continue;
      const xk = k % CW;
      if ((xk > 0 && seen[k - 1]) || (xk < CW - 1 && seen[k + 1]) || (k >= CW && seen[k - CW]) || (k < CW * (CH - 1) && seen[k + CW])) {
        const j = k * 4;
        if (Math.abs(d[j] - tr) + Math.abs(d[j + 1] - tg) + Math.abs(d[j + 2] - tb) <= 250) { d[j] = r; d[j + 1] = g; d[j + 2] = b; }
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  function applyOp(op) {
    if (op.k === 'f') floodFill(op.x, op.y, op.c);
    else drawSegment(op.c, op.w, op.pts, null);
  }
  function redraw() {
    wipe();
    strokeEnds.clear();
    ops.forEach((op) => {
      applyOp(op);
      if (op.k === 's' && op.pts.length) strokeEnds.set(op.id, [op.pts[op.pts.length - 2], op.pts[op.pts.length - 1]]);
    });
  }
  wipe();

  function onDraw(m) {
    if (m.op === 'full') { ops = m.ops || []; redraw(); }
    else if (m.op === 'clear') { ops = []; redraw(); }
    else if (m.op === 'undo') { ops.pop(); redraw(); }
    else if (m.op === 'fill') { const op = { k: 'f', x: m.x, y: m.y, c: m.c }; ops.push(op); applyOp(op); }
    else if (m.op === 'seg') {
      let op = ops[ops.length - 1];
      if (!op || op.k !== 's' || op.id !== m.id) { op = { k: 's', id: m.id, c: m.c, w: m.w, pts: [] }; ops.push(op); }
      const from = strokeEnds.get(m.id);
      op.pts = op.pts.concat(m.pts);
      const end = drawSegment(m.c, m.w, m.pts, from);
      if (end) strokeEnds.set(m.id, end);
      else if (m.pts.length) strokeEnds.set(m.id, [m.pts[m.pts.length - 2], m.pts[m.pts.length - 1]]);
    }
    if (typeof m.v === 'number') ui.ver = m.v;
  }

  // Lệch phiên bản bức vẽ (mất gói, vào giữa chừng…) → xin máy chủ gửi lại toàn bộ.
  function checkVersion() {
    if (!S) return;
    if (amDrawer()) { ui.ver = S.canvasVer; return; }
    clearTimeout(ui.syncTimer);
    if (S.canvasVer !== ui.ver) {
      ui.syncTimer = setTimeout(() => { if (S && S.canvasVer !== ui.ver) send('sync'); }, 700);
    }
  }

  // --- người vẽ: nhập nét
  let cur = null;           // nét đang vẽ
  let pending = [];         // toạ độ chưa gửi
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * CW), Math.round(((e.clientY - r.top) / r.height) * CH)];
  }
  function flush() {
    if (!cur || !pending.length) return;
    send('draw', { id: cur.id, c: cur.c, w: cur.w, pts: pending });
    pending = [];
  }
  setInterval(flush, 50);
  canvas.addEventListener('pointerdown', (e) => {
    if (!canDraw()) return;
    e.preventDefault();
    const [x, y] = toCanvas(e);
    if (tool.mode === 'fill') {
      const op = { k: 'f', x, y, c: tool.color };
      ops.push(op); applyOp(op);
      send('fill', { x, y, c: tool.color });
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    const c = tool.mode === 'eraser' ? '#ffffff' : tool.color;
    const w = tool.mode === 'eraser' ? Math.max(14, tool.size * 2) : tool.size;
    cur = { id: Math.random().toString(36).slice(2, 10), c, w, last: [x, y] };
    ops.push({ k: 's', id: cur.id, c, w, pts: [x, y] });
    drawSegment(c, w, [x, y], null);
    pending.push(x, y);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!cur || !canDraw()) return;
    const [x, y] = toCanvas(e);
    if (Math.abs(x - cur.last[0]) + Math.abs(y - cur.last[1]) < 2) return;
    drawSegment(cur.c, cur.w, [x, y], cur.last);
    cur.last = [x, y];
    ops[ops.length - 1].pts.push(x, y);
    pending.push(x, y);
  });
  const endStroke = () => { flush(); cur = null; };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  function renderTools() {
    const el = $('#tools');
    $('#canvas-wrap').classList.toggle('can-draw', canDraw());
    if (!canDraw()) { setHTML(el, ''); return; }
    const html = `<div class="swatches">${PALETTE.map((c) => `<button class="sw ${tool.color === c && tool.mode !== 'eraser' ? 'on' : ''}" style="background:${c}" data-color="${c}" title="${c}"></button>`).join('')}</div>
      <div class="tgroup">${SIZES.map((s) => `<button class="tbtn ${tool.size === s ? 'on' : ''}" data-size="${s}" title="Cỡ ${s}"><span class="dot" style="width:${Math.min(22, s)}px;height:${Math.min(22, s)}px"></span></button>`).join('')}</div>
      <div class="tgroup">
        <button class="tbtn ${tool.mode === 'pen' ? 'on' : ''}" data-mode="pen" title="Bút">✏️</button>
        <button class="tbtn ${tool.mode === 'eraser' ? 'on' : ''}" data-mode="eraser" title="Tẩy">🧽</button>
        <button class="tbtn ${tool.mode === 'fill' ? 'on' : ''}" data-mode="fill" title="Đổ màu">🪣</button>
      </div>
      <div class="tgroup"><button class="tbtn" data-tool="undo" title="Hoàn tác (Ctrl+Z)">↩️</button><button class="tbtn" data-tool="clear" title="Xoá hết">🗑️</button></div>`;
    setHTML(el, html);
  }
  document.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-color]');
    if (sw) { tool.color = sw.dataset.color; if (tool.mode === 'eraser') tool.mode = 'pen'; renderTools(); return; }
    const sz = e.target.closest('[data-size]');
    if (sz) { tool.size = Number(sz.dataset.size); renderTools(); return; }
    const md = e.target.closest('[data-mode]');
    if (md) { tool.mode = md.dataset.mode; renderTools(); return; }
    const t = e.target.closest('[data-tool]');
    if (t && canDraw()) {
      if (t.dataset.tool === 'undo') undo();
      else { ops = []; redraw(); send('clear'); }
    }
  });
  function undo() { if (!ops.length) return; flush(); cur = null; ops.pop(); redraw(); send('undo'); }
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && canDraw() && !e.target.closest('input, textarea')) { e.preventDefault(); undo(); }
  });

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
  function playEvent(e) {
    switch (e.type) {
      case 'draw': play('start'); if (e.pid === S.me.id) P.toast('Bắt đầu vẽ! Không được viết chữ nhé ✏️', 'good'); break;
      case 'correct': play(e.pid === S.me.id ? 'mine' : 'correct'); bubble(e.pid, '✅', 'emoji'); if (cast) cast.react(e.pid, 'cheer'); break;
      case 'hint': play('hint'); break;
      case 'reveal': play('reveal'); break;
      case 'choose': if (e.pid === S.me.id) play('start'); break;
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

  // ---------------------------------------------------------------- khu vẽ & đoán
  function renderHead() {
    const el = $('#whead');
    if (S.phase !== 'play') { setHTML(el, ''); return; }
    const w = S.word;
    let mid = '';
    if (S.stage === 'choose') mid = `<div class="meta">${amDrawer() ? 'Chọn một từ để vẽ' : `${who(S.drawer)} đang chọn từ…`}</div>`;
    else if (w && w.text) {
      const mine = amDrawer();
      mid = `<div class="word ${mine ? 'mine' : ''}">${mine ? '✏️ ' : S.stage === 'reveal' ? '' : '✅ '}${esc(w.text)}</div>
        <div class="meta">${w.topicIcon} ${esc(w.topic)}${mine ? ' · bạn đang vẽ' : ''}</div>`;
    } else if (w) {
      let i = 0;
      const words = w.mask.split(' ').map((part) => `<span class="wd">${[...part].map((ch) => { i++; return `<span class="ch ${ch !== '_' ? 'lit' : ''}">${ch === '_' ? '' : esc(ch)}</span>`; }).join('')}</span>`).join('');
      mid = `<div class="mask">${words}</div><div class="meta">${w.topicIcon} ${esc(w.topic)} · ${w.lens.join(' + ')} chữ</div>`;
    }
    setHTML(el, `<div class="clock" id="clock"><span id="clock-n"></span></div><div class="wmid">${mid}</div><span class="rnd">Vòng ${S.round}/${S.rounds}</span>`);
    tickClock();
  }
  function tickClock() {
    const c = $('#clock');
    if (!c || !S) return;
    const left = S.deadline ? Math.max(0, S.deadline - (Date.now() / 1000 + clockOffset)) : 0;
    const secs = Math.ceil(left);
    c.style.setProperty('--p', S.total ? Math.min(1, left / S.total) : 0);
    $('#clock-n').textContent = S.deadline ? secs : '';
    const urgent = S.stage === 'draw' && secs <= 10;
    c.classList.toggle('urgent', urgent);
    if (urgent && secs !== ui.lastClock && secs > 0 && (amDrawer() || !(player(S.me.id) || {}).guessed)) play('tick');
    ui.lastClock = secs;
  }

  function renderOverlay() {
    const el = $('#overlay');
    if (S.phase !== 'play') {
      setHTML(el, S.phase === 'end'
        ? `<div class="big">🏆</div><h2>${who(S.winner)} thắng!</h2><p>Xem bảng xếp hạng bên dưới.</p>`
        : `<div class="big">🎨</div><h2>Vẽ Đoán</h2><p>${S.wordCount} từ · ${S.me.host ? 'thêm bạn bè rồi bấm Bắt đầu bên dưới' : 'đang chờ chủ phòng bắt đầu…'}</p>`);
      return;
    }
    if (S.stage === 'choose') {
      setHTML(el, S.choices
        ? `<h2>Chọn từ để vẽ</h2><div class="choices">${S.choices.map((c, i) => `<button class="choice" data-choose="${i}"><span class="lv">${'★'.repeat(c.level)}${'☆'.repeat(3 - c.level)}</span>
            <b>${esc(c.w)}</b><small>${esc(c.topic)}</small></button>`).join('')}</div><p>Từ càng khó, người đoán ra càng được nhiều điểm.</p>`
        : `<div class="big">✏️</div><h2>${who(S.drawer)} đang chọn từ…</h2>`);
      return;
    }
    if (S.stage === 'reveal' && S.word) {
      const gains = S.players.filter((p) => p.playing && p.gained).map((p) => `<span style="--pc:${p.color}">${who(p.id)} <b>+${p.gained}</b></span>`).join('');
      setHTML(el, `<p>Đáp án là</p><div class="reveal-word">${esc(S.word.text || '')}</div>
        <div class="gains">${gains || '<span style="--pc:#888">Không ai đoán ra 😢</span>'}</div>`);
      return;
    }
    setHTML(el, '');
  }

  function renderFeed() {
    const el = $('#feed');
    const f = S.phase === 'play' ? S.feed : [];
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    const html = f.map((m) => {
      if (m.kind === 'system' || m.kind === 'answer') return `<div class="fm ${m.kind}">${esc(m.text)}</div>`;
      if (m.kind === 'correct') return `<div class="fm correct">✅ ${who(m.pid)} ${esc(m.text)}</div>`;
      if (m.kind === 'close') return `<div class="fm close">🔥 ${esc(m.text)}</div>`;
      return `<div class="fm ${m.kind}"><span class="who" style="color:${colorOf(m.pid)}">${who(m.pid)}</span>${esc(m.text)}</div>`;
    }).join('') || '<div class="fm system">Các lượt đoán sẽ hiện ở đây.</div>';
    if (setHTML(el, html) && (nearBottom || f.length && f[f.length - 1].pid === S.me.id)) el.scrollTop = el.scrollHeight;
    const last = f.length ? f[f.length - 1] : null;
    if (last && last.id > ui.lastFeedId && last.kind === 'close') play('close');
    if (last) ui.lastFeedId = Math.max(ui.lastFeedId, last.id);
    // Ô đoán
    const input = $('#guess-input');
    const meP = player(S.me.id);
    const drawing = S.phase === 'play' && S.stage === 'draw';
    let ph = 'Gõ đáp án rồi Enter…';
    let dis = false;
    if (!drawing) { ph = S.phase === 'play' ? 'Chờ lượt vẽ bắt đầu…' : 'Ván chưa bắt đầu'; dis = true; }
    else if (!S.me.playing) { ph = 'Bạn đang xem — ván sau mới được đoán'; dis = true; }
    else if (amDrawer()) ph = 'Nhắn riêng với người đã đoán ra…';
    else if (meP && meP.guessed) ph = 'Đã đoán ra! Nhắn riêng với nhóm đoán ra…';
    input.placeholder = ph;
    input.disabled = dis;
  }

  // ---------------------------------------------------------------- banner, nhân vật, danh sách
  function renderBanner() {
    const el = $('#banner');
    let big = '🎨';
    let title = '';
    let sub = '';
    let cls = 'gbanner';
    if (S.phase === 'lobby') {
      title = 'Phòng chờ';
      sub = `${S.players.length}/${S.maxPlayers} người · ${S.me.host ? 'bạn là chủ phòng — chỉnh luật rồi bấm Bắt đầu bên dưới' : 'đang chờ chủ phòng bắt đầu…'}`;
    } else if (S.phase === 'end') {
      big = '🏆'; cls += ' win'; title = `${who(S.winner)} thắng!`; sub = `Ván ${S.gameNo} kết thúc — xem bảng xếp hạng bên dưới.`;
    } else if (amDrawer()) {
      big = '✏️'; cls += ' mine';
      title = S.stage === 'choose' ? 'Đến lượt bạn vẽ — chọn một từ!' : S.stage === 'draw' ? 'Bạn đang vẽ!' : 'Hết lượt vẽ';
      sub = 'Vẽ cho mọi người đoán · không được viết chữ hay số · Ctrl+Z để hoàn tác.';
    } else {
      const meP = player(S.me.id);
      big = meP && meP.guessed ? '✅' : '🤔';
      title = S.stage === 'choose' ? `${who(S.drawer)} đang chọn từ…` : S.stage === 'draw' ? (meP && meP.guessed ? 'Bạn đã đoán ra!' : `Đoán xem ${who(S.drawer)} đang vẽ gì!`) : 'Hết lượt';
      sub = 'Gõ đáp án vào ô Đoán bên phải · gõ không dấu cũng được.';
    }
    if (S.phase === 'play' && !S.me.playing) sub = '👀 Bạn đang xem ván này — ván sau sẽ được vào chơi.';
    el.className = cls;
    setHTML(el, `<div class="big">${big}</div><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div></div>`);
  }

  function renderCast() {
    if (!cast) cast = new window.Cast($('#cast'), { onClick: (pid, el) => openMenu(pid, el) });
    const list = S.phase === 'lobby' ? S.players : S.players.filter((p) => p.playing);
    cast.update(list.map((p) => ({
      id: p.id, name: p.name, look: p.look, bot: p.bot, me: p.id === S.me.id, color: p.color,
      turn: S.phase === 'play' && S.drawer === p.id,
      dim: !p.connected,
      sub: p.playing ? `⭐ ${p.score}` : (p.host ? '👑 chủ phòng' : ''),
      badge: S.phase === 'end' && S.winner === p.id ? '🏆' : S.phase === 'play' && S.drawer === p.id ? '✏️' : p.guessed ? '✅' : '',
    })));
  }

  function renderPlayers() {
    const ranked = S.phase === 'lobby' ? S.players : S.players.slice().sort((a, b) => (b.playing - a.playing) || (b.score - a.score));
    const html = ranked.map((p) => {
      const tags = [p.bot ? '🤖' : '', p.host ? '👑' : '', p.wins ? `🏆${p.wins}` : '', p.connected ? '' : '📴'].filter(Boolean).join(' ');
      const drawing = S.phase === 'play' && S.drawer === p.id;
      const sub = p.playing ? (drawing ? '✏️ đang vẽ' : p.guessed ? '✅ đã đoán ra' : '🤔 đang đoán') : (S.phase === 'lobby' ? (p.bot ? 'Chỉ đoán, không vẽ' : 'Sẵn sàng') : '👀 Đang xem');
      return `<div class="pcard ${drawing ? 'drawing' : ''} ${p.guessed ? 'ok' : ''}" style="--pc:${p.color || 'transparent'}" data-pid="${esc(p.id)}">
        <div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>
        <div class="pn"><b>${p.id === S.me.id ? 'Bạn' : esc(p.name)} ${tags}</b><span>${sub}</span></div>
        ${p.playing ? `<div class="sc">${p.score}<small>điểm</small></div>` : ''}</div>`;
    }).join('');
    setHTML($('#plist'), html);
  }

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const inviteLink = () => `${ui.lanBase || location.origin}/g/vedoan/?room=${ROOM}`;
  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    return `<div class="panel"><h3><span class="grow">🤖 Người chơi ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Bot chỉ <b>đoán</b> (không vẽ) — thêm cho vui khi ít người.</p>
      <div class="btns-row">${btn('add-bot', '＋ 1 bot', 'small', n >= S.maxPlayers ? 'disabled' : '')}
        ${bots ? btn('remove-bots', '🗑 Xoá hết bot', 'small ghost') : ''}</div></div>`;
  }
  function settingsPanel() {
    const dis = S.me.host ? '' : 'disabled';
    const cfg = S.config;
    const sel = (key, label, opts) => `<div class="setting"><label>${label}</label><select data-cfg="${key}" ${dis}>
      ${opts.map(([v, t]) => `<option value="${v}" ${String(v) === String(cfg[key]) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    return `<div class="panel"><h3>⚙️ Luật chơi</h3><div class="settings">
      ${sel('rounds', '🔁 Số vòng (mỗi người vẽ 1 lần/vòng)', S.choicesCfg.rounds.map((v) => [v, `${v} vòng`]))}
      ${sel('draw_time', '⏱ Thời gian vẽ', S.choicesCfg.draw_time.map((v) => [v, `${v} giây`]))}
      ${sel('topic', '🗂️ Chủ đề', [['all', '🌈 Tất cả chủ đề']].concat(S.choicesCfg.topics.map((t) => [t.key, `${t.icon} ${t.name}`])))}
      ${sel('bot_level', '🤖 Độ giỏi của bot', [['easy', LEVEL_NAMES.easy], ['normal', LEVEL_NAMES.normal], ['hard', LEVEL_NAMES.hard]])}
    </div><p class="gh-muted" style="margin:10px 0 0;font-size:13px">📚 Kho ${S.wordCount} từ quen thuộc: con vật, đồ ăn, đồ vật, phương tiện, thiên nhiên, địa điểm, nghề nghiệp, hoạt động, Việt Nam.</p></div>`;
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
          <span class="rname">${esc(p.name)}${p.bot ? ' 🤖' : ''}</span><div class="rcards"></div>
          <span class="rpts">${p.score}<small>${p.wins} ván thắng</small></span></div>`;
      }).join('');
      html = `<div class="panel"><div class="result-head"><div class="trophy">🏆</div><div>
          <h2>${esc(nm(S.winner))}${S.winner === S.me.id ? ' (bạn)' : ''} thắng!</h2><p>Ván ${S.gameNo} kết thúc.</p></div></div>
        <div class="results">${rows}</div>
        <div class="start-row" style="margin-top:14px">${host
          ? `${btn('lobby', '🏠 Về phòng chờ', 'ghost')}${btn('next', '▶ Ván mới', 'primary', S.startError ? 'disabled' : '')}`
          : '<span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu ván mới…</span>'}</div></div>${host ? botPanel() + settingsPanel() : ''}`;
    } else {
      const start = host
        ? `<div class="start-row"><div>${S.startError ? `<span class="warn">⚠️ ${esc(S.startError)}</span>` : `<span class="gh-muted">${S.players.length}/${S.maxPlayers} người — sẵn sàng!</span>`}</div>
           ${btn('start', '🎨 Bắt đầu', 'primary', S.startError ? 'disabled' : '')}</div>`
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
      + '<span class="hint">Nhấn vào nhân vật người khác để vẫy tay, ném cà chua…</span>');
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
    $('#phase-pill').textContent = S.phase === 'lobby' ? '🏠 Phòng chờ' : S.phase === 'end' ? `🏁 Hết ván ${S.gameNo}` : `🎨 Vòng ${S.round}/${S.rounds}`;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `${amDrawer() && S.stage !== 'reveal' ? '✏️ ' : ''}Vẽ Đoán ${ROOM}`;
    $('#vd').hidden = S.phase === 'lobby';   // phòng chờ: chỉ hiện phần mời bạn & luật chơi
    renderBanner();
    renderCast();
    renderHead();
    renderOverlay();
    renderTools();
    renderFeed();
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
    tickClock();
    if (!S || !S.deadline || S.phase !== 'play') { timer.hidden = true; fill.style.width = '0'; return; }
    const remaining = Math.max(0, S.deadline - (Date.now() / 1000 + clockOffset));
    const secs = Math.ceil(remaining);
    timer.hidden = false;
    timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    fill.style.width = `${S.total ? Math.min(1, remaining / S.total) * 100 : 0}%`;
  }
  setInterval(tick, 250);

  // ---------------------------------------------------------------- sự kiện
  $('#guess-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#guess-input');
    const text = input.value.trim();
    if (text && send('guess', { text })) input.value = '';
  });

  document.addEventListener('click', async (e) => {
    const ch = e.target.closest('[data-choose]');
    if (ch) { send('choose', { i: Number(ch.dataset.choose) }); return; }
    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled && actEl.dataset.act) {
      switch (actEl.dataset.act) {
        case 'start': send('start'); break;
        case 'next': send('next_round'); break;
        case 'lobby': send('lobby'); break;
        case 'stop':
          P.modal({
            title: 'Kết thúc ván?', body: '<p>Ván dừng ngay và xếp hạng theo điểm hiện tại.</p>',
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

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-cfg]');
    if (!el) return;
    const key = el.dataset.cfg;
    send('config', { [key]: ['rounds', 'draw_time'].includes(key) ? Number(el.value) : el.value });
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
    try { localStorage.setItem('vedoan_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) play('correct');
  });
  $('#btn-room').addEventListener('click', async () => { if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good'); });
  $('#btn-leave').addEventListener('click', () => {
    const doLeave = () => { if (conn) conn.leave(); setTimeout(() => { location.href = '/'; }, 150); };
    if (S && S.phase === 'play' && S.me.playing) {
      P.modal({
        title: 'Rời ván chơi?',
        body: '<p>Ván đang diễn ra — vào lại phòng với <b>đúng tên cũ</b> để chơi tiếp.</p>',
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
