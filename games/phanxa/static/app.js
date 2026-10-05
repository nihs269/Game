(function () {
  const P = window.Platform;
  const $ = (s) => document.querySelector(s);
  const esc = P.esc;
  const ROOM = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (!ROOM) { location.href = '/'; return; }

  let S = null;          // trạng thái mới nhất từ máy chủ
  let conn = null;
  let clockOffset = 0;
  const ui = { lastSeq: null, tab: 'players', unread: 0, lastChatId: null, lanBase: null, sound: true };
  try { ui.sound = localStorage.getItem('phanxa_sound') !== '0'; } catch (e) { /* bỏ qua */ }

  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
  };
  const LEVEL_NAMES = { easy: 'Dễ', normal: 'Vừa', hard: 'Khó' };
  const SPEED_NAMES = { normal: 'Bình thường', fast: 'Nhanh' };
  const SHOW_TYPES = ['sequence', 'count', 'position'];

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
  const pts = (n) => Number(n || 0).toLocaleString('vi-VN');
  const btn = (act, text, kind = '', extra = '') => `<button class="gh-btn ${kind}" data-act="${act}" ${extra}>${text}</button>`;
  const colorOf = (id) => { const p = player(id); return (p && p.color) || '#8892b0'; };
  let cast = null;
  function anchorEl(pid) {
    const a = cast && cast.anchor(pid);
    if (a) return a;
    return document.querySelector(`#plist [data-pid="${CSS.escape(pid || '')}"] .ava`);
  }
  const rectOf = (el) => (el ? el.getBoundingClientRect() : null);
  // Mốc thời gian máy chủ (giây) → mốc Date.now() của máy này (ms).
  const localMs = (serverSec) => (serverSec - clockOffset) * 1000;

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
  const PAD_NOTE = [330, 440, 554, 659];
  const SOUNDS = {
    intro: () => [[392, 0.08], [523, 0.08], [659, 0.14]],
    tick: () => [[880, 0.05, 'square', 0.03]],
    go: () => [[1046, 0.12, 'square', 0.06]],
    tap: () => [[700, 0.04, 'triangle', 0.05]],
    ok: () => [[784, 0.08], [1046, 0.16]],
    bad: () => [[220, 0.12, 'square', 0.05], [180, 0.16, 'square', 0.05]],
    win: () => [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]],
  };
  const play = (k) => beep(SOUNDS[k]());
  const padSound = (i) => beep([[PAD_NOTE[i], 0.22, 'triangle', 0.07]]);

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
    S = state;
    clockOffset = state.now - Date.now() / 1000;
    const events = state.events || [];
    let fresh = [];
    if (ui.lastSeq === null) ui.lastSeq = events.length ? events[events.length - 1].seq : 0;
    else fresh = events.filter((e) => e.seq > ui.lastSeq);
    if (events.length) ui.lastSeq = Math.max(ui.lastSeq, events[events.length - 1].seq);
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

  function playEvent(e) {
    switch (e.type) {
      case 'intro': play('intro'); break;
      case 'reveal': {
        const r = S.round && S.round.results && S.round.results[S.me.id];
        if (S.me.playing) play(r && r.ok ? 'ok' : 'bad');
        if (e.pid) { bubble(e.pid, '⚡', 'emoji'); if (cast) cast.react(e.pid, 'cheer'); }
        break;
      }
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

  // ---------------------------------------------------------------- khu trò chơi (điều khiển theo từng khung hình)
  // ctl giữ trạng thái cục bộ của vòng đang chơi: đã vào phần trả lời chưa, lúc bắt đầu tính giờ, lựa chọn của mình…
  let ctl = { key: null };
  function resetCtl(key) {
    cancelAnimationFrame(ctl.raf);
    ctl = { key, raf: 0, step: null, part: null, ansStart: null, greenAt: null, sent: false, picked: null, seq: [], lastCd: null };
  }

  const R = () => S.round;
  const playMs = () => Date.now() - localMs(R().startedAt);   // ms kể từ lúc bắt đầu phần chơi

  function head(extra = '') {
    const r = R();
    return `<div class="rhead"><span class="rn">Vòng ${r.n}/${r.total}</span><span class="rt">${r.icon} ${esc(r.title)}<small>${esc(r.hint)}</small></span>${extra}</div>`;
  }

  function renderArena() {
    const el = $('#arena');
    if (!S || S.phase !== 'play' || !R()) { resetCtl(null); setHTML(el, ''); return; }
    const key = `${S.gameNo}:${R().n}:${S.stage}`;
    if (ctl.key !== key) {
      const prevPick = ctl.picked;
      const sameRound = ctl.key && ctl.key.split(':').slice(0, 2).join(':') === key.split(':').slice(0, 2).join(':');
      resetCtl(key);
      if (sameRound) ctl.picked = prevPick;
      if (S.stage === 'intro') buildIntro(el);
      else if (S.stage === 'play') buildPlay(el);
      else buildReveal(el);
    } else if (S.stage === 'play') {
      updateWaitNote();
    }
  }

  // --- giới thiệu vòng
  function buildIntro(el) {
    const r = R();
    htmlCache.delete(el);
    el.innerHTML = `<div class="intro"><div class="ii">${r.icon}</div><h2>${esc(r.title)}</h2><p>${esc(r.hint)}</p><div class="cd" id="cd"></div></div>`;
    ctl.step = () => {
      const left = S.deadline ? Math.max(0, S.deadline - (Date.now() / 1000 + clockOffset)) : 0;
      const n = Math.ceil(left);
      const cd = $('#cd');
      if (cd && n !== ctl.lastCd) { ctl.lastCd = n; cd.textContent = n > 0 ? n : 'Bắt đầu!'; if (n > 0 && n <= 3) play('tick'); }
    };
    runLoop();
  }

  // --- phần chơi
  function buildPlay(el) {
    const r = R();
    htmlCache.delete(el);
    el.innerHTML = `${head()}<div class="abar"><i id="abar"></i></div><div class="qbody" id="qbody"></div>`;
    if (r.mine) { ctl.sent = true; ctl.picked = r.mine.value; }
    const show = SHOW_TYPES.includes(r.type) ? r.show : 0;
    ctl.step = () => {
      if (!S || S.stage !== 'play' || ctl.key !== `${S.gameNo}:${R().n}:play`) return;
      const t = playMs();
      // Thanh thời gian trả lời
      let frac = 1;
      if (r.type === 'reaction') frac = t < r.content.wait ? 1 : 1 - (t - r.content.wait) / r.limit;
      else frac = t < show ? 1 : 1 - (t - show) / r.limit;
      const bar = $('#abar');
      if (bar) { bar.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`; bar.classList.toggle('urgent', frac < 0.3); }
      // Chuyển phần: xem đề → trả lời
      let part = 'answer';
      if (ctl.sent) part = 'sent';
      else if (r.type === 'reaction') part = t < r.content.wait ? 'wait' : 'go';
      else if (t < show) part = 'show';
      if (part !== ctl.part) {
        const prev = ctl.part;
        ctl.part = part;
        drawPart(part, prev);
      }
      if (part === 'show' && r.type === 'sequence') litSequence(t);
    };
    runLoop();
  }

  // Chạy ctl.step mỗi khung hình; thêm bộ đếm 100 ms dự phòng khi trình duyệt tạm dừng khung hình (tab ẩn…).
  function runLoop() {
    const loop = () => { if (ctl.step) ctl.step(); ctl.raf = requestAnimationFrame(loop); };
    loop();
  }
  setInterval(() => { if (ctl.step) ctl.step(); }, 100);

  function submit(value, ms) {
    if (ctl.sent) return;
    ctl.sent = true;
    ctl.picked = value;
    send('answer', { round: R().n, value, ms: Math.round(ms) });
  }
  const elapsed = () => performance.now() - (ctl.ansStart || performance.now());

  function optionsHTML(labels, cls = '') {
    return `<div class="opts">${labels.map((l, i) => `<button class="opt ${cls}" data-opt="${i}">${l}</button>`).join('')}</div>`;
  }
  function gridHTML(size, cellFn, pick) {
    return `<div class="grid ${pick ? 'pick' : ''} ${size >= 6 ? 'dense' : ''}" style="--n:${size}">${Array.from({ length: size * size }, (_, i) => cellFn(i)).join('')}</div>`;
  }

  function drawPart(part, prev) {
    const r = R();
    const c = r.content;
    const q = $('#qbody');
    if (!q) return;
    if (part === 'answer' || part === 'go') ctl.ansStart = performance.now();
    if (r.type === 'reaction') {
      if (part === 'wait') q.innerHTML = '<div class="react wait" id="react">Chờ…<small>Bấm khi màn hình chuyển XANH — bấm sớm là hỏng!</small></div>';
      else if (part === 'go') { ctl.greenAt = performance.now(); play('go'); q.innerHTML = '<div class="react go" id="react">BẤM!<small>Nhanh lên!</small></div>'; }
      else if (part === 'sent') {
        const early = ctl.picked === 'early';
        q.innerHTML = early
          ? '<div class="react early">😅 Bấm sớm quá!<small>Vòng này không được điểm</small></div>'
          : `<div class="react done">⚡ ${ctl.reactMs != null ? `${ctl.reactMs} ms` : 'Đã bấm!'}<small>Chờ mọi người…</small></div>`;
        q.insertAdjacentHTML('beforeend', '<div class="waitnote" id="waitnote"></div>');
        updateWaitNote();
      }
      return;
    }
    let html = '';
    const answered = part === 'sent';
    if (r.type === 'stroop') {
      html = `<div class="stroop-word" style="color:${c.ink}">${esc(c.word)}</div>
        <div class="rule">Chọn ${c.rule === 'ink' ? '<b>MÀU CỦA CHỮ</b>' : '<b>NGHĨA</b> của chữ'}</div>${optionsHTML(c.options.map((o) => esc(o.label)))}`;
    } else if (r.type === 'math') {
      html = `<div class="expr">${esc(c.expr)} = ?</div>${optionsHTML(c.options.map(String))}`;
    } else if (r.type === 'sequence') {
      const watching = part === 'show';
      html = `<div class="prompt">${watching ? 'Nhớ thứ tự các ô sáng lên…' : `Bấm lại <b>${c.seq.length}</b> ô theo đúng thứ tự`}</div>
        <div class="pads ${watching ? 'watch' : answered ? 'watch' : 'input'}">${[0, 1, 2, 3].map((i) => `<button class="pad" data-pad="${i}"></button>`).join('')}</div>
        <div class="seqdots" id="seqdots">${watching ? '' : Array.from({ length: c.seq.length }, (_, i) => `<i class="${ctl.seq[i] !== undefined ? `c${ctl.seq[i]}` : (answered && Array.isArray(ctl.picked) && ctl.picked[i] !== undefined ? `c${ctl.picked[i]}` : '')}"></i>`).join('')}</div>`;
    } else if (r.type === 'count') {
      if (part === 'show') html = `<div class="prompt">Nhìn kỹ lưới hình…</div>${gridHTML(c.size, (i) => `<div class="cell">${c.icons[c.grid[i]]}</div>`)}`;
      else html = `<div class="prompt">Có bao nhiêu</div><div class="ask-icon">${c.icons[c.ask]}</div>${optionsHTML(c.options.map(String))}`;
    } else if (r.type === 'odd') {
      html = `<div class="prompt">Bấm vào hình <b>khác</b> các hình còn lại</div>${gridHTML(c.size, (i) => `<div class="cell" data-cell="${i}">${i === c.cell ? c.odd : c.base}</div>`, !answered)}`;
    } else if (r.type === 'position') {
      if (part === 'show') html = `<div class="prompt">Nhớ vị trí các con vật…</div>${gridHTML(c.size, (i) => `<div class="cell">${c.icons[i]}</div>`)}`;
      else html = `<div class="prompt"><span class="ask-icon">${c.askIcon}</span><br>nằm ở ô nào?</div>${gridHTML(c.size, (i) => `<div class="cell hidden" data-cell="${i}">?</div>`, !answered)}`;
    }
    q.innerHTML = html + (answered ? '<div class="waitnote" id="waitnote"></div>' : '');
    if (answered) markPicked();
    updateWaitNote();
    if (prev === 'show' && part === 'answer') play('tap');
  }

  function markPicked() {
    const r = R();
    if (ctl.picked === null || ctl.picked === undefined) return;
    if (['stroop', 'math', 'count'].includes(r.type)) {
      document.querySelectorAll('#qbody .opt').forEach((b) => { b.disabled = true; b.classList.toggle('picked', Number(b.dataset.opt) === Number(ctl.picked)); });
    } else if (['odd', 'position'].includes(r.type)) {
      const cell = document.querySelector(`#qbody .cell[data-cell="${Number(ctl.picked)}"]`);
      if (cell) cell.classList.add('picked');
    }
  }

  function updateWaitNote() {
    const n = $('#waitnote');
    if (!n || !S) return;
    const ps = S.players.filter((p) => p.playing);
    const done = ps.filter((p) => p.answered).length;
    n.innerHTML = `Đã trả lời — chờ mọi người (<b>${done}/${ps.length}</b>)…`;
  }

  function litSequence(t) {
    const c = R().content;
    const k = (t - 300) / c.step;
    const i = Math.floor(k);
    const on = i >= 0 && i < c.seq.length && k - i < 0.72 ? c.seq[i] : -1;
    if (on !== ctl.lit) {
      ctl.lit = on;
      document.querySelectorAll('#qbody .pad').forEach((p) => p.classList.toggle('lit', Number(p.dataset.pad) === on));
      if (on >= 0) padSound(on);
    }
  }

  // Bấm chuột / chạm (pointerdown để đo phản xạ chính xác hơn click)
  document.addEventListener('pointerdown', (e) => {
    if (!S || S.stage !== 'play' || ctl.sent || !R()) return;
    const r = R();
    if (r.type === 'reaction' && e.target.closest('#react')) {
      e.preventDefault();
      if (ctl.part === 'go') {
        const ms = performance.now() - ctl.greenAt;
        ctl.reactMs = Math.round(ms);
        play('tap');
        submit('go', ms);
      } else if (ctl.part === 'wait') {
        play('bad');
        submit('early', 0);
      }
      return;
    }
    if (ctl.part !== 'answer') return;
    const opt = e.target.closest('#qbody .opt');
    if (opt) { play('tap'); submit(Number(opt.dataset.opt), elapsed()); return; }
    const cell = e.target.closest('#qbody .grid.pick .cell');
    if (cell) { play('tap'); submit(Number(cell.dataset.cell), elapsed()); return; }
    const pad = e.target.closest('#qbody .pads.input .pad');
    if (pad) {
      const i = Number(pad.dataset.pad);
      padSound(i);
      pad.classList.add('lit');
      setTimeout(() => pad.classList.remove('lit'), 160);
      ctl.seq.push(i);
      const dots = document.querySelectorAll('#seqdots i');
      if (dots[ctl.seq.length - 1]) dots[ctl.seq.length - 1].className = `c${i}`;
      if (ctl.seq.length >= r.content.seq.length) submit(ctl.seq.slice(), elapsed());
    }
  });

  // --- kết quả vòng
  function buildReveal(el) {
    const r = R();
    const c = r.content;
    const res = r.results || {};
    const mine = res[S.me.id];
    const myVal = r.mine ? r.mine.value : ctl.picked;
    let show = '';
    if (['stroop', 'math', 'count'].includes(r.type)) {
      const labels = r.type === 'stroop' ? c.options.map((o) => esc(o.label)) : c.options.map(String);
      const top = r.type === 'stroop' ? `<div class="stroop-word" style="color:${c.ink};font-size:48px">${esc(c.word)}</div>`
        : r.type === 'math' ? `<div class="expr" style="font-size:48px">${esc(c.expr)} = ${esc(String(c.options[r.key]))}</div>`
          : `<div class="answer-show">Có <b style="font-size:28px;color:var(--gold)">${esc(String(c.options[r.key]))}</b> <span class="ask-icon" style="font-size:34px">${c.icons[c.ask]}</span></div>`;
      show = `${top}<div class="opts">${labels.map((l, i) => `<button class="opt ${i === r.key ? 'right' : ''} ${Number(myVal) === i && i !== r.key ? 'wrongpick' : ''}" disabled>${l}</button>`).join('')}</div>`;
    } else if (r.type === 'odd' || r.type === 'position') {
      const cellText = (i) => (r.type === 'odd' ? (i === c.cell ? c.odd : c.base) : c.icons[i]);
      show = gridHTML(c.size, (i) => `<div class="cell ${i === r.key ? 'right' : ''} ${Number(myVal) === i && i !== r.key ? 'wrongpick' : ''}">${cellText(i)}</div>`);
    } else if (r.type === 'sequence') {
      const dots = (arr) => `<div class="seqdots">${arr.map((x) => `<i class="c${x}"></i>`).join('')}</div>`;
      show = `<div class="answer-show">Đáp án: ${dots(r.key)}</div>${Array.isArray(myVal) ? `<div class="answer-show">Bạn bấm: ${dots(myVal)}</div>` : ''}`;
    } else {
      show = `<div class="answer-show">${mine ? (mine.early ? '😅 Bạn bấm sớm' : `⚡ Bạn: <b style="color:var(--gold)">${mine.ms} ms</b>`) : ''}</div>`;
    }
    const rows = S.players.filter((p) => p.playing).map((p) => ({ p, a: res[p.id] }))
      .sort((x, y) => ((y.a ? y.a.pts : -1) - (x.a ? x.a.pts : -1)) || ((x.a ? x.a.ms : 1e9) - (y.a ? y.a.ms : 1e9)))
      .map(({ p, a }, i) => `<div class="rr ${p.id === S.me.id ? 'me' : ''}" style="--pc:${p.color};animation-delay:${i * 60}ms">
        <span class="ok">${!a ? '⏱️' : a.early ? '🙈' : a.ok ? '✅' : '❌'}</span><span class="nm">${who(p.id)}${a && a.fastest ? ' 🏅' : ''}</span>
        <span class="ms">${a && !a.early ? `${a.ms} ms` : a ? 'bấm sớm' : 'hết giờ'}</span><span class="pts ${a && a.pts ? '' : 'zero'}">+${pts(a ? a.pts : 0)}</span></div>`).join('');
    htmlCache.delete(el);
    el.innerHTML = `${head()}<div class="qbody">${show}<div class="results-r">${rows}</div></div>`;
  }

  // ---------------------------------------------------------------- banner, nhân vật, danh sách
  function renderBanner() {
    const el = $('#banner');
    let big = '⚡';
    let title = '';
    let sub = '';
    let cls = 'gbanner';
    if (S.phase === 'lobby') {
      title = 'Phòng chờ';
      sub = `${S.players.length}/${S.maxPlayers} người · ${S.me.host ? 'bạn là chủ phòng — chỉnh luật rồi bấm Bắt đầu bên dưới (chơi một mình cũng được)' : 'đang chờ chủ phòng bắt đầu…'}`;
    } else if (S.phase === 'end') {
      big = '🏆'; cls += ' win';
      title = `${who(S.winner)} thắng!`;
      sub = `Ván ${S.gameNo} kết thúc — xem bảng xếp hạng bên dưới.`;
    } else {
      const r = R();
      big = r ? r.icon : '⚡';
      title = r ? `Vòng ${r.n}/${r.total}: ${esc(r.title)}` : '…';
      sub = S.stage === 'intro' ? 'Chuẩn bị…' : S.stage === 'play' ? 'Nhanh tay lên!' : 'Kết quả vòng';
      if (S.stage === 'play') cls += ' mine';
    }
    if (S.phase === 'play' && !S.me.playing) sub = `👀 Bạn đang xem ván này — ván sau sẽ được vào chơi.${sub ? ` · ${sub}` : ''}`;
    el.className = cls;
    setHTML(el, `<div class="big">${big}</div><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div></div>`);
  }

  function renderCast() {
    if (!cast) cast = new window.Cast($('#cast'), { onClick: (pid, el) => openMenu(pid, el) });
    const list = S.phase === 'lobby' ? S.players : S.players.filter((p) => p.playing);
    const lead = S.phase !== 'lobby' && list.length ? list.reduce((a, b) => (b.score > a.score ? b : a)) : null;
    cast.update(list.map((p) => ({
      id: p.id, name: p.name, look: p.look, bot: p.bot, me: p.id === S.me.id, color: p.color,
      turn: S.phase === 'play' && S.stage === 'play' && !p.answered && p.playing,
      dim: !p.connected,
      sub: p.playing ? `⭐ ${pts(p.score)}` : (p.host ? '👑 chủ phòng' : ''),
      badge: S.phase === 'end' && S.winner === p.id ? '🏆' : (S.stage === 'play' && p.answered ? '✅' : (lead && lead.id === p.id && p.score > 0 ? '👑' : '')),
    })));
  }

  function renderPlayers() {
    const ranked = S.phase === 'lobby' ? S.players : S.players.slice().sort((a, b) => (b.playing - a.playing) || (b.score - a.score));
    const html = ranked.map((p) => {
      const tags = [p.bot ? '🤖' : '', p.host ? '👑' : '', p.wins ? `🏆${p.wins}` : '', p.connected ? '' : '📴'].filter(Boolean).join(' ');
      const sub = p.playing ? `✅ ${p.correct} câu đúng${p.best ? ` · ⚡ ${p.best} ms` : ''}` : (S.phase === 'lobby' ? 'Sẵn sàng' : '👀 Đang xem');
      return `<div class="pcard" style="--pc:${p.color || 'transparent'}" data-pid="${esc(p.id)}">
        <div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>
        <div class="pn"><b>${p.id === S.me.id ? 'Bạn' : esc(p.name)} ${tags}</b><span>${sub}</span></div>
        ${p.playing ? `<div class="sc">${pts(p.score)}<small>điểm</small></div>` : ''}</div>`;
    }).join('');
    setHTML($('#plist'), html);
  }

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const inviteLink = () => `${ui.lanBase || location.origin}/g/phanxa/?room=${ROOM}`;
  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    return `<div class="panel"><h3><span class="grow">🤖 Người chơi ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Thêm bot để có đối thủ so tốc độ — bot khó phản xạ ~250 ms!</p>
      <div class="btns-row">${btn('add-bot', '＋ 1 bot', 'small', n >= S.maxPlayers ? 'disabled' : '')}
        ${btn('fill-bots', 'Lấp đủ 4 người', 'small primary', n >= 4 ? 'disabled' : '')}
        ${bots ? btn('remove-bots', '🗑 Xoá hết bot', 'small ghost') : ''}</div></div>`;
  }
  function settingsPanel() {
    const dis = S.me.host ? '' : 'disabled';
    const cfg = S.config;
    const sel = (key, label, opts) => `<div class="setting"><label>${label}</label><select data-cfg="${key}" ${dis}>
      ${opts.map(([v, t]) => `<option value="${v}" ${String(v) === String(cfg[key]) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    const types = Object.values(S.types).map((t) => `${t.icon} ${t.title}`).join(' · ');
    return `<div class="panel"><h3>⚙️ Luật chơi</h3><div class="settings">
      ${sel('rounds', '🔁 Số vòng', S.choices.rounds.map((v) => [v, `${v} vòng`]))}
      ${sel('speed', '⏩ Tốc độ', S.choices.speed.map((v) => [v, SPEED_NAMES[v]]))}
      ${sel('bot_level', '🤖 Độ khó của bot', S.choices.bot_level.map((v) => [v, LEVEL_NAMES[v]]))}
    </div><p class="gh-muted" style="margin:10px 0 0;font-size:13px">Các trò: ${types}</p></div>`;
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
          <div class="rcards"><span class="gh-muted">✅ ${p.correct} câu đúng${p.best ? ` · ⚡ nhanh nhất ${p.best} ms` : ''}</span></div>
          <span class="rpts">${pts(p.score)}<small>${p.wins} ván thắng</small></span></div>`;
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
           ${btn('start', '⚡ Bắt đầu', 'primary', S.startError ? 'disabled' : '')}</div>`
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
    $('#phase-pill').textContent = S.phase === 'lobby' ? '🏠 Phòng chờ' : S.phase === 'end' ? `🏁 Hết ván ${S.gameNo}`
      : `⚡ Vòng ${R() ? R().n : 0}/${R() ? R().total : 0}`;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `Phản Xạ ${ROOM}`;
    renderBanner();
    renderCast();
    renderArena();
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
    fill.style.width = `${S.total ? Math.min(1, remaining / S.total) * 100 : 0}%`;
  }
  setInterval(tick, 250);

  // ---------------------------------------------------------------- sự kiện
  document.addEventListener('click', async (e) => {
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
        case 'fill-bots': send('add_bot', { count: Math.max(1, 4 - S.players.length) }); break;
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

  // Phím tắt: Space cho vòng ⚡, phím 1–4 chọn đáp án.
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || !S || S.stage !== 'play' || ctl.sent || !R()) return;
    const r = R();
    if (r.type === 'reaction' && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      const el = $('#react');
      if (el) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      return;
    }
    if (/^[1-4]$/.test(e.key) && ctl.part === 'answer' && ['stroop', 'math', 'count'].includes(r.type)) {
      const b = document.querySelector(`#qbody .opt[data-opt="${Number(e.key) - 1}"]`);
      if (b) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-cfg]');
    if (!el) return;
    const key = el.dataset.cfg;
    send('config', { [key]: key === 'rounds' ? Number(el.value) : el.value });
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
    try { localStorage.setItem('phanxa_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) play('ok');
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
