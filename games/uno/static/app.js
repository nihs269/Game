(function () {
  const P = window.Platform;
  const $ = (s) => document.querySelector(s);
  const esc = P.esc;
  const ROOM = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (!ROOM) { location.href = '/'; return; }

  let S = null;          // trạng thái mới nhất từ máy chủ
  let conn = null;
  let voice = null;
  let voiceInfo = { peers: [], muted: [], to: [], from: [] };
  let httpsBase = null;
  let clockOffset = 0;
  const ui = {
    lastSeq: null, handIds: new Set(), fresh: new Set(), wasMyTurn: false,
    tab: 'chat', unread: 0, lastChatId: null, lanBase: null, speaking: new Set(), sound: true,
  };
  try { ui.sound = localStorage.getItem('uno_sound') !== '0'; } catch (e) { /* bỏ qua */ }

  const COLOR_NAMES = { r: 'Đỏ', y: 'Vàng', g: 'Xanh lá', b: 'Xanh dương' };
  const COLOR_HEX = { r: '#e8363f', y: '#f7c21b', g: '#2fa84f', b: '#1f7fe0' };
  const SYM = { skip: '⊘', rev: '⇄', d2: '+2', wild: '', w4: '+4' };
  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
  };

  // ---------------------------------------------------------------- tiện ích
  const bubbles = new window.ChatBubbles({
    anchor: (pid) => document.querySelector(`#seats [data-pid="${CSS.escape(pid)}"] .ava`),
  });
  const htmlCache = new Map();
  function setHTML(el, html) {
    if (htmlCache.get(el) === html) return false;
    htmlCache.set(el, html);
    el.innerHTML = html;
    return true;
  }
  const player = (id) => (S && S.players.find((p) => p.id === id)) || null;
  const nm = (id) => { const p = player(id); return p ? p.name : '?'; };
  const send = (action, data) => conn && conn.send(action, data);
  const fmtTime = (t) => new Date(t * 1000).toTimeString().slice(0, 5);
  const myTurn = () => S && S.phase === 'play' && S.turn === S.me.id;
  const btn = (act, label, kind = '', extra = '') => `<button class="gh-btn ${kind}" data-act="${act}" ${extra}>${label}</button>`;

  function cardHTML(c, { cls = '', color = null } = {}) {
    if (!c) return '<div class="card back"><span class="oval"></span><span class="sym">UNO</span></div>';
    const sym = SYM[c.v] !== undefined ? SYM[c.v] : c.v;
    const corner = c.v === 'wild' ? 'W' : sym;
    const picked = c.c === 'w' && color ? ` picked" style="--pick:${COLOR_HEX[color]}` : '';
    return `<div class="card c-${c.c} ${cls}${picked}" data-card="${c.id}">
      <span class="corner tl">${corner}</span><span class="oval"></span><span class="sym">${sym}</span><span class="corner br">${corner}</span></div>`;
  }
  const backHTML = (cls = '') => `<div class="card back ${cls}"><span class="oval"></span><span class="sym">UNO</span></div>`;
  const cardPoints = (c) => (c.c === 'w' ? 50 : ['skip', 'rev', 'd2'].includes(c.v) ? 20 : Number(c.v));

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
    play: [[520, 0.07, 'triangle']],
    draw: [[260, 0.08, 'triangle', 0.06]],
    turn: [[660, 0.12], [880, 0.18]],
    uno: [[784, 0.1, 'square', 0.05], [988, 0.1, 'square', 0.05], [1175, 0.2, 'square', 0.05]],
    bad: [[300, 0.15, 'sawtooth', 0.05], [200, 0.25, 'sawtooth', 0.05]],
    win: [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.35]],
  };

  // ---------------------------------------------------------------- kết nối
  function connect() {
    conn = P.connect({
      room: ROOM,
      onState,
      onFx,
      onRtc: (m) => { if (voice) voice.signal(m.from, m.data); },
      onStatus: (on) => $('#conn').classList.toggle('off', !on),
      onFatal: (m) => P.showFatal(m, { onRetryName: () => connect() }),
    });
  }

  function onState(state, vinfo) {
    S = state;
    voiceInfo = vinfo || voiceInfo;
    if (voice) voice.update(state.me.id, voiceInfo);
    clockOffset = state.now - Date.now() / 1000;

    const ids = new Set((state.hand || []).map((c) => c.id));
    ui.fresh = new Set([...ids].filter((id) => !ui.handIds.has(id)));
    if (ui.lastSeq === null) ui.fresh.clear();
    ui.handIds = ids;

    const mine = myTurn();
    if (mine && !ui.wasMyTurn && ui.lastSeq !== null) {
      beep(SOUNDS.turn);
      if (navigator.vibrate) navigator.vibrate(120);
    }
    ui.wasMyTurn = mine;

    render();
    const events = state.events || [];
    if (ui.lastSeq === null) ui.lastSeq = events.length ? events[events.length - 1].seq : 0;
    events.filter((e) => e.seq > ui.lastSeq).forEach(playEvent);
    if (events.length) ui.lastSeq = Math.max(ui.lastSeq, events[events.length - 1].seq);
  }

  // ---------------------------------------------------------------- hiệu ứng
  function seatRect(pid) {
    if (S && pid === S.me.id && S.me.playing && S.phase === 'play') {
      const h = $('#hand');
      if (h && h.offsetHeight) return h.getBoundingClientRect();
    }
    const el = document.querySelector(`#seats [data-pid="${CSS.escape(pid)}"] .ava`);
    return el ? el.getBoundingClientRect() : null;
  }

  function fly(html, from, to, { dur = 450, delay = 0 } = {}) {
    if (!from || !to) return;
    const el = document.createElement('div');
    el.className = 'flyer';
    el.innerHTML = html;
    el.style.left = '0px'; el.style.top = '0px'; el.style.opacity = '0';
    document.body.appendChild(el);
    const w = el.offsetWidth; const h = el.offsetHeight;
    const x0 = from.left + from.width / 2 - w / 2; const y0 = from.top + from.height / 2 - h / 2;
    const x1 = to.left + to.width / 2 - w / 2; const y1 = to.top + to.height / 2 - h / 2;
    const anim = el.animate([
      { transform: `translate(${x0}px, ${y0}px) scale(.55) rotate(-25deg)`, opacity: 1 },
      { transform: `translate(${x1}px, ${y1}px) scale(1) rotate(0deg)`, opacity: 1 },
    ], { duration: dur, delay, easing: 'cubic-bezier(.3,.8,.3,1)', fill: 'forwards' });
    anim.onfinish = () => el.remove();
  }

  function bubble(pid, text, cls = '') {
    const r = seatRect(pid);
    if (!r) return;
    const el = document.createElement('div');
    el.className = 'bubble ' + cls;
    el.textContent = text;
    el.style.left = (r.left + r.width / 2) + 'px';
    el.style.top = (r.top + Math.min(r.height, 60) * 0.1) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1900);
  }

  function playEvent(e) {
    const pileRect = () => { const d = $('#center .discard'); return d ? d.getBoundingClientRect() : null; };
    const deckRect = () => { const d = $('#center .deck'); return d ? d.getBoundingClientRect() : null; };
    switch (e.type) {
      case 'deal': beep(SOUNDS.draw); break;
      case 'play': {
        fly(cardHTML(e.card, { color: e.color }), seatRect(e.pid), pileRect(), { dur: 380 });
        const d = $('#center .discard');
        if (d) { d.classList.remove('pop'); void d.offsetWidth; d.classList.add('pop'); }
        beep(SOUNDS.play);
        break;
      }
      case 'draw':
        for (let i = 0; i < Math.min(e.n, 4); i++) fly(backHTML('mid'), deckRect(), seatRect(e.pid), { dur: 380, delay: i * 90 });
        if (e.n > 1) bubble(e.pid, `+${e.n}`, 'bad');
        beep(e.n > 1 ? SOUNDS.bad : SOUNDS.draw);
        break;
      case 'uno': bubble(e.pid, 'UNO!', 'big'); beep(SOUNDS.uno); break;
      case 'catch': bubble(e.pid, '🚨 Bắt lỗi!', 'bad'); setTimeout(() => bubble(e.target, '+2 😱', 'bad'), 400); break;
      case 'skip': bubble(e.pid, '⛔', 'emoji'); break;
      case 'reverse': {
        const d = $('#center .dir');
        if (d) { d.classList.remove('flip'); void d.offsetWidth; d.classList.add('flip'); }
        break;
      }
      case 'win': bubble(e.pid, '🏆', 'emoji'); beep(SOUNDS.win); break;
      default:
    }
  }

  function onFx(m) {
    const emoji = FX_EMOJI[m.kind] || '✨';
    if (m.to && m.to !== m.from) {
      fly(`<span style="font-size:30px">${emoji}</span>`, seatRect(m.from), seatRect(m.to), { dur: 550 });
      setTimeout(() => bubble(m.to, emoji, 'emoji'), 520);
    } else {
      bubble(m.from, emoji, 'emoji');
    }
  }

  // ---------------------------------------------------------------- vẽ giao diện
  function render() {
    if (!S) return;
    renderTop();
    renderTable();
    renderBar();
    renderHand();
    renderPanel();
    renderEmotes();
    renderChat();
    renderLog();
    renderVoice();
    tick();
  }

  function renderTop() {
    const label = S.phase === 'lobby' ? '🏠 Phòng chờ' : S.phase === 'end' ? `🏁 Hết ván ${S.round}` : `🃏 Ván ${S.round}`;
    $('#phase-pill').textContent = label;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `${myTurn() ? '🔔 Tới lượt bạn · ' : ''}UNO ${ROOM}`;
  }

  function renderTable() {
    const table = $('#table');
    table.dataset.color = S.phase === 'play' || S.phase === 'end' ? (S.color || '') : '';

    // --- giữa bàn
    let center = '';
    if (S.top) {
      const rot = ((S.top.id * 37) % 30) - 15;
      const canDraw = myTurn() && S.drawn === null;
      center = `<div class="pile deck ${canDraw ? 'can' : ''}" data-act="${canDraw ? 'draw' : ''}" title="Rút bài">
          <div class="stack"></div>${backHTML()}<div class="cnt">${S.deckCount} lá</div></div>
        <div class="pile discard"><div class="card-wrap" style="transform:rotate(${rot}deg)">${cardHTML(S.top, { color: S.color })}</div></div>
        <div class="info">
          <div class="dir ${S.direction < 0 ? 'ccw' : ''}" title="Chiều vòng chơi"><span>${S.direction < 0 ? '↺' : '↻'}</span></div>
          <div class="color-dot" style="background:${COLOR_HEX[S.color] || '#888'}" title="Màu hiện tại: ${COLOR_NAMES[S.color] || ''}"></div>
          ${S.pending ? `<div class="pending-badge">+${S.pending}</div>` : ''}
        </div>`;
    } else {
      center = `<div class="pile">${backHTML()}</div>`;
    }
    setHTML($('#center'), center);

    // --- ghế ngồi: mình ở dưới cùng, xếp theo chiều vòng chơi
    const seated = S.players.filter((p) => p.playing);
    const n = seated.length;
    const meIdx = Math.max(0, seated.findIndex((p) => p.id === S.me.id));
    const html = S.players.map((p) => {
      const i = seated.indexOf(p);
      let x, y;
      if (i >= 0) {
        const rel = (i - meIdx + n) % n;
        const a = Math.PI / 2 + (rel * 2 * Math.PI) / n;
        x = 50 + 43 * Math.cos(a); y = 50 + 40 * Math.sin(a);
      } else {
        const k = S.players.filter((q) => !q.playing).indexOf(p);
        x = 4 + k * 9; y = 4;
      }
      const turn = S.turn === p.id;
      const fanN = Math.min(p.count, 7);
      const fan = S.phase === 'play' && p.id !== S.me.id && fanN
        ? `<div class="fan">${Array.from({ length: fanN }, (_, j) => `<i style="transform:rotate(${(j - (fanN - 1) / 2) * 11}deg)"></i>`).join('')}</div>` : '';
      const tags = [];
      if (p.bot) tags.push('<span class="tag">🤖</span>');
      if (p.host) tags.push('<span class="tag">👑</span>');
      if (S.phase === 'play' && p.count === 1) tags.push('<span class="tag uno">UNO</span>');
      if (S.phase === 'end' && S.winner === p.id) tags.push('<span class="tag win">🏆</span>');
      const count = S.phase === 'play' || S.phase === 'end'
        ? `<span class="count ${p.count === 1 && S.phase === 'play' ? 'one' : ''}">${p.count}</span>` : '';
      const cls = ['seat', turn ? 'turn' : '', p.id === S.me.id ? 'me' : '', p.connected ? '' : 'off',
        p.playing ? '' : 'watch', ui.speaking.has(p.id) ? 'speaking' : ''].join(' ');
      const ring = turn && S.deadline
        ? '<svg class="ring" viewBox="0 0 72 72"><circle cx="36" cy="36" r="33" stroke-dasharray="207.3" stroke-dashoffset="0"/></svg>' : '';
      return `<div class="${cls}" data-pid="${esc(p.id)}" style="left:${x}%;top:${y}%">
        ${fan}<div class="avabox"><div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>${ring}</div>
        <div class="name">${p.id === S.me.id ? 'Bạn' : esc(p.name)}</div>
        <div class="meta">${count}${tags.join('')}${p.score ? `<span>⭐${p.score}</span>` : ''}</div></div>`;
    }).join('');
    setHTML($('#seats'), html);
  }

  function renderBar() {
    const el = $('#bar');
    let html = '';
    let mine = false;
    if (S.phase === 'play') {
      const catchBtn = S.unoPending && S.unoPending !== S.me.id && S.me.playing
        ? btn('catch', `🚨 Bắt lỗi ${esc(nm(S.unoPending))} quên hô UNO!`, 'catch') : '';
      const unoBtn = S.unoPending === S.me.id || (myTurn() && S.hand && S.hand.length === 2 && S.playable.length)
        ? btn('uno', S.unoSaid ? 'UNO! ✓' : 'UNO!', 'uno' + (S.unoSaid ? ' done' : '')) : '';
      if (!S.me.playing) {
        html = `<div class="msg-main">👀 Bạn đang xem ván này<small>Ván sau bạn sẽ được chia bài.</small></div>`;
      } else if (myTurn()) {
        mine = true;
        let title, sub = '';
        if (S.pending) {
          title = `😱 Bạn bị phạt +${S.pending}!`;
          sub = S.playable.length ? 'Chồng thêm lá +2/+4 để đẩy cho người sau, hoặc chịu rút.' : `Không có lá để chồng — phải rút ${S.pending} lá.`;
        } else if (S.drawn !== null) {
          title = '🂠 Lá vừa rút đánh được!'; sub = 'Đánh luôn lá có viền đứt nét, hoặc bỏ lượt.';
        } else if (S.playable.length) {
          title = '👉 Đến lượt bạn!'; sub = `Chọn lá cùng màu ${COLOR_NAMES[S.color] || ''}, cùng số/ký hiệu, hoặc lá đổi màu.`;
        } else {
          title = '😕 Không có lá nào đánh được'; sub = 'Hãy rút bài (bấm vào chồng bài hoặc nút bên cạnh).';
        }
        if (S.hand && S.hand.length === 2 && S.playable.length && !S.unoSaid) sub += ' Nhớ bấm UNO! trước khi đánh lá áp chót.';
        const main = S.drawn !== null
          ? btn('pass', '⏭ Bỏ lượt', 'ghost')
          : btn('draw', S.pending ? `🂠 Rút ${S.pending} lá` : '🂠 Rút bài', S.playable.length ? 'ghost' : 'primary');
        html = `<div class="msg-main">${title}<small>${sub}</small></div>${unoBtn}${catchBtn}${main}`;
      } else {
        const who = esc(nm(S.turn));
        html = `<div class="msg-main">⏳ Đang chờ <b>${who}</b> đánh…${S.pending ? `<small>${who} đang bị phạt +${S.pending}.</small>` : ''}</div>${unoBtn}${catchBtn}`;
      }
    }
    el.className = 'bar' + (mine ? ' myturn' : '');
    setHTML(el, html);
  }

  function renderHand() {
    const el = $('#hand');
    if (S.phase !== 'play' || !S.hand) { setHTML(el, ''); return; }
    const active = myTurn();
    const ok = new Set(S.playable);
    const html = `<div class="hand-row">${S.hand.map((c) => {
      const cls = [ok.has(c.id) ? 'ok' : 'no', ui.fresh.has(c.id) ? 'fresh' : '', S.drawn === c.id ? 'drawn' : ''].join(' ');
      return cardHTML(c, { cls });
    }).join('')}</div><div class="hand-label">Bài của bạn: ${S.hand.length} lá</div>`;
    el.classList.toggle('active', active);
    if (setHTML(el, html)) fitHand();
  }

  function fitHand() {
    const el = $('#hand');
    const row = el.querySelector('.hand-row');
    const first = row && row.querySelector('.card');
    if (!first) return;
    const n = S.hand.length;
    const cw = first.offsetWidth;
    const avail = el.clientWidth - 30;
    let overlap = n > 1 ? (avail - n * cw) / (n - 1) : 0;
    overlap = Math.max(-cw * 0.62, Math.min(6, overlap));
    el.style.setProperty('--overlap', overlap + 'px');
  }
  window.addEventListener('resize', () => { if (S) fitHand(); });

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const fmtSec = (s) => (s ? `${s} giây` : 'Không giới hạn');

  function inviteLink() {
    return `${ui.lanBase || location.origin}/g/uno/?room=${ROOM}`;
  }

  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    const full = n >= S.maxPlayers;
    return `<div class="panel"><h3><span class="grow">🤖 Người chơi ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Không đủ người? Thêm bot để test — bot tự đánh bài, hô UNO (thỉnh thoảng quên!), bắt lỗi và trò chuyện.</p>
      <div class="btns-row">
        ${btn('add-bot', '＋ 1 bot', 'small', full ? 'disabled' : '')}
        ${btn('add-bot-3', '＋ 3 bot', 'small', full ? 'disabled' : '')}
        ${btn('fill-bots', `Lấp đủ ${Math.min(Math.max(4, n + 1), S.maxPlayers)} người`, 'small primary', full ? 'disabled' : '')}
        ${bots ? btn('remove-bots', '🗑 Xoá hết bot', 'small ghost') : ''}
      </div></div>`;
  }

  function settingsPanel() {
    const host = S.me.host;
    const cfg = S.config;
    const dis = host ? '' : 'disabled';
    return `<div class="panel"><h3>⚙️ Luật chơi</h3><div class="settings">
      <div class="setting"><label>⏱ Thời gian mỗi lượt</label>
        <select data-cfg="turn_time" ${dis}>${S.turnTimes.map((t) => `<option value="${t}" ${t === cfg.turn_time ? 'selected' : ''}>${fmtSec(t)}</option>`).join('')}</select></div>
      <label class="switch"><input type="checkbox" data-cfg="stacking" ${cfg.stacking ? 'checked' : ''} ${dis}>
        <span>Cộng dồn +2/+4<small>Bị +2 có thể đỡ bằng +2/+4 để đẩy cho người sau</small></span></label>
      <label class="switch"><input type="checkbox" data-cfg="draw_until_play" ${cfg.draw_until_play ? 'checked' : ''} ${dis}>
        <span>Rút tới khi đánh được<small>Tắt: mỗi lượt chỉ rút 1 lá</small></span></label>
    </div></div>`;
  }

  function renderPanel() {
    const el = $('#panel');
    if (S.phase === 'play') { setHTML(el, ''); return; }
    const host = S.me.host;
    let html = '';
    if (S.phase === 'end') {
      const rows = S.players.filter((p) => p.hand).map((p) => ({
        p, pts: p.hand.reduce((s, c) => s + cardPoints(c), 0),
      })).sort((a, b) => a.p.hand.length - b.p.hand.length || a.pts - b.pts);
      const ranking = rows.map(({ p, pts }, i) => `<div class="res-row ${p.id === S.winner ? 'win' : ''}">
          <span class="rank">${p.id === S.winner ? '🏆' : i + 1}</span><span class="rname">${esc(p.name)}${p.bot ? ' 🤖' : ''}</span>
          <div class="rcards">${p.hand.length ? p.hand.map((c) => cardHTML(c, { cls: 'mini' })).join('') : '<span class="gh-muted">Hết bài!</span>'}</div>
          <span class="rpts">${p.id === S.winner ? `+${S.roundPoints}` : `${pts} đ`}<small>Tổng: ${p.score}</small></span></div>`).join('');
      const board = [...S.players].sort((a, b) => b.score - a.score)
        .map((p, i) => `<span class="gh-muted">${i + 1}.</span> <b>${esc(p.name)}</b> ${p.score}`).join(' &nbsp;·&nbsp; ');
      html += `<div class="panel">
        <div class="result-head"><div class="trophy">🏆</div><div>
          <h2>${esc(nm(S.winner))}${S.winner === S.me.id ? ' (bạn)' : ''} thắng ván ${S.round}!</h2>
          <p>Nhận ${S.roundPoints} điểm từ bài còn lại của mọi người (số = điểm số, chức năng = 20, đổi màu = 50).</p></div></div>
        <div class="results">${ranking}</div>
        <p style="font-size:14px;margin:14px 0 0">📊 Bảng điểm: ${board}</p>
        <div class="start-row" style="margin-top:14px">${host
          ? `${btn('lobby', '🏠 Về phòng chờ (xoá điểm)', 'ghost')}${btn('next', '▶ Ván tiếp theo', 'primary', S.startError ? 'disabled' : '')}`
          : '<span class="gh-muted">⏳ Đang chờ chủ phòng chia ván tiếp theo…</span>'}</div>
        ${host && S.startError ? `<p class="warn">⚠️ ${esc(S.startError)}</p>` : ''}</div>`;
      if (host) html += botPanel() + settingsPanel();
    } else {
      const start = host
        ? `<div class="start-row"><div>${S.startError ? `<span class="warn">⚠️ ${esc(S.startError)}</span>` : `<span class="gh-muted">${S.players.length} người — sẵn sàng!</span>`}</div>
           ${btn('start', '🎬 Chia bài', 'primary', S.startError ? 'disabled' : '')}</div>`
        : '<div class="start-row"><span class="gh-muted">⏳ Đang chờ chủ phòng chia bài…</span></div>';
      html = `<div class="panel"><h3>📨 Mời bạn bè</h3>
          <div class="invite"><div class="bigcode">${ROOM}</div><div class="link">${esc(inviteLink())}</div>
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
    const html = SELF_FX.map(([k, l]) => `<button class="emo" data-fx="${k}" data-self="1" title="${l}">${FX_EMOJI[k]}</button>`).join('') +
      btn('edit-look', '👗 Nhân vật', 'small') +
      '<span class="hint">Nhấn vào người khác để vẫy tay, thả tim, ném cà chua…</span>';
    setHTML($('#emotes'), html);
  }

  function openMenu(id, seatEl) {
    closeMenu();
    const p = player(id);
    if (!p) return;
    const me = id === S.me.id;
    const items = me ? SELF_FX : OTHER_FX;
    let html = `<div class="pmenu-head">${me ? '🙋 Bạn' : esc(p.name)}${p.bot ? ' 🤖' : ''}</div>
      <div class="pmenu-grid">${items.map(([k, l]) => `<button data-fx="${k}"><span>${FX_EMOJI[k]}</span>${l}</button>`).join('')}</div>`;
    if (me) html += btn('edit-look', '👗 Đổi nhân vật', 'small');
    if (!me && S.phase !== 'play' && S.me.host) html += `<button class="gh-btn small danger" data-kick="${esc(id)}">${p.bot ? '🗑 Xoá bot' : '🚪 Mời ra khỏi phòng'}</button>`;
    menuEl = document.createElement('div');
    menuEl.className = 'pmenu';
    menuEl.innerHTML = html;
    document.body.appendChild(menuEl);
    const r = seatEl.getBoundingClientRect();
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
      actions: [
        { label: 'Huỷ', kind: 'ghost' },
        { label: '💾 Lưu', kind: 'primary', onClick: () => { window.Avatar.set(look); send('set_look', { look: window.Avatar.get() }); } },
      ],
    });
    m.el.querySelector('.gh-modal').classList.add('wide');
  }

  function pickColor(cardId) {
    const body = document.createElement('div');
    body.className = 'color-pick';
    body.innerHTML = Object.entries(COLOR_NAMES).map(([c, name]) =>
      `<button data-color="${c}" style="background:${COLOR_HEX[c]}">${name}</button>`).join('');
    const m = P.modal({ title: '🎨 Chọn màu tiếp theo', body, actions: [{ label: 'Huỷ', kind: 'ghost' }] });
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-color]');
      if (!b) return;
      m.close();
      send('play', { card: cardId, color: b.dataset.color });
    });
  }

  // ---------------------------------------------------------------- voice chat
  async function startVoice() {
    if (!window.GameVoice || !window.GameVoice.supported) {
      P.toast('Trình duyệt này không hỗ trợ voice chat.', 'error');
      return;
    }
    if (!voice) {
      voice = new window.GameVoice({
        sendRaw: (m) => conn && conn.sendRaw(m),
        onChange: () => renderVoice(),
        onSpeaking: (pid, on) => { if (on) ui.speaking.add(pid); else ui.speaking.delete(pid); if (S) renderTable(); },
      });
    }
    await voice.enable();
    if (S) voice.update(S.me.id, voiceInfo);
    if (voice.error === 'insecure') showMicHelp();
    else if (voice.error === 'denied') P.toast('Bạn đã chặn quyền mic — hiện chỉ nghe được. Hãy cho phép mic trên thanh địa chỉ.', 'error', 6000);
    else if (voice.error === 'nomic') P.toast('Không tìm thấy mic — hiện chỉ nghe được.', 'error', 5000);
    else P.toast('🎙️ Đã vào voice chat!', 'good');
  }

  function showMicHelp() {
    const link = httpsBase ? `${httpsBase}${location.pathname}${location.search}` : null;
    P.modal({
      title: '🎙️ Cần HTTPS để dùng mic',
      body: `<p>Trình duyệt chỉ cho dùng mic trên trang <b>HTTPS</b> (hoặc localhost). Hiện bạn vẫn <b>nghe</b> được mọi người, nhưng chưa nói được.</p>
        ${link ? `<p>Mở địa chỉ này rồi vào lại phòng (trình duyệt sẽ cảnh báo chứng chỉ tự ký → bấm <b>Nâng cao</b> → <b>Tiếp tục</b>):</p>
        <p><code style="word-break:break-all;color:var(--accent-2)">${esc(link)}</code></p>` : '<p>Chủ máy chủ cần chạy lại server để bật HTTPS.</p>'}`,
      actions: link
        ? [{ label: 'Để sau', kind: 'ghost' }, { label: 'Mở trang HTTPS', kind: 'primary', onClick: () => { location.href = link; } }]
        : [{ label: 'Đã hiểu', kind: 'primary' }],
    });
  }

  function renderVoice() {
    const el = $('#voice-ctl');
    if (!window.GameVoice || !window.GameVoice.supported) { setHTML(el, ''); return; }
    const st = voice ? voice.status() : { on: false };
    let html;
    if (!st.on) {
      const n = voiceInfo.peers.length;
      html = `<button class="vbtn join" data-act="voice-on" title="Vào voice chat">🎙️ <span>Voice${n ? ` · ${n}` : ''}</span></button>`;
    } else {
      html = `<div class="vgroup">
        ${st.listenOnly
          ? '<button class="vbtn warn" data-act="voice-help" title="Chỉ nghe — cần HTTPS hoặc quyền mic để nói">🔈</button>'
          : `<button class="vbtn ${st.muted ? 'off' : 'on'}" data-act="voice-mute" title="${st.muted ? 'Bật mic' : 'Tắt mic'}">${st.muted ? '🔇' : '🎤'}</button>`}
        <button class="vbtn ${st.deaf ? 'off' : ''}" data-act="voice-deaf" title="${st.deaf ? 'Bật loa' : 'Tắt loa'}">${st.deaf ? '🔕' : '🎧'}</button>
        <span class="vinfo">👥 ${st.peers}</span>
        <button class="vbtn leave" data-act="voice-off" title="Rời voice">✕</button></div>`;
    }
    setHTML(el, html);
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
      : '<div class="empty-note">Diễn biến ván đấu sẽ hiện ở đây.</div>';
    const list = $('#log-list');
    if (setHTML(list, html)) list.scrollTop = list.scrollHeight;
  }

  function renderRules() {
    const c = (v, col = 'r') => cardHTML({ id: -1, c: col, v }, { cls: 'mini' });
    $('#rules').innerHTML = `
      <h4>🎯 Mục tiêu</h4><p>Đánh hết bài trên tay trước mọi người. Người thắng được cộng điểm bằng tổng điểm bài còn lại của những người khác.</p>
      <h4>🃏 Đánh bài</h4><p>Đến lượt, đánh 1 lá <b>cùng màu</b> hoặc <b>cùng số/ký hiệu</b> với lá trên bàn, hoặc lá đổi màu. Không đánh được thì rút bài; lá vừa rút đánh được thì có thể đánh luôn.</p>
      <h4>✨ Lá chức năng</h4>
      <div class="row">${c('skip')}<p><b>Cấm lượt</b> — người kế tiếp mất lượt.</p></div>
      <div class="row">${c('rev', 'b')}<p><b>Đảo chiều</b> — đổi chiều vòng chơi (2 người: như Cấm lượt).</p></div>
      <div class="row">${c('d2', 'g')}<p><b>+2</b> — người kế tiếp rút 2 lá và mất lượt.</p></div>
      <div class="row">${c('wild', 'w')}<p><b>Đổi màu</b> — đánh lúc nào cũng được, chọn màu tiếp theo.</p></div>
      <div class="row">${c('w4', 'w')}<p><b>+4</b> — chọn màu, người kế tiếp rút 4 lá và mất lượt.</p></div>
      <h4>📣 Hô UNO!</h4><p>Khi đánh lá áp chót (còn 1 lá), bấm <b>UNO!</b>. Ai quên hô mà bị người khác bấm <b>Bắt lỗi</b> trước khi người kế tiếp đánh sẽ bị phạt rút 2 lá.</p>
      <h4>⚙️ Luật tuỳ chọn</h4><ul>
        <li><b>Cộng dồn +2/+4</b>: bị +2 có thể đỡ bằng +2 hoặc +4, bị +4 có thể đỡ bằng +4 — người không đỡ được rút tổng số lá.</li>
        <li><b>Rút tới khi đánh được</b>: rút liên tục tới khi được lá đánh được.</li>
        <li>Hết giờ lượt: tự động rút bài và bỏ lượt.</li></ul>
      <h4>🧮 Tính điểm</h4><p>Lá số = điểm số trên lá · Cấm lượt / Đảo chiều / +2 = 20 · Đổi màu / +4 = 50.</p>`;
  }

  // ---------------------------------------------------------------- đồng hồ
  function tick() {
    const timer = $('#timer');
    const fill = $('#timebar-fill');
    if (!S || !S.deadline) { timer.hidden = true; fill.style.width = '0'; return; }
    const remaining = Math.max(0, S.deadline - (Date.now() / 1000 + clockOffset));
    const secs = Math.ceil(remaining);
    const frac = S.total ? Math.min(1, remaining / S.total) : 0;
    timer.hidden = false;
    timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    timer.classList.toggle('urgent', secs <= 5 && myTurn());
    fill.style.width = `${frac * 100}%`;
    const ring = document.querySelector('#seats .turn .ring circle');
    if (ring) ring.style.strokeDashoffset = String(207.3 * (1 - frac));
  }
  setInterval(tick, 250);

  // ---------------------------------------------------------------- sự kiện
  document.addEventListener('click', async (e) => {
    const cardEl = e.target.closest('#hand .card');
    if (cardEl) {
      if (!myTurn()) { P.toast('Chưa đến lượt của bạn.'); return; }
      const id = Number(cardEl.dataset.card);
      const card = S.hand.find((c) => c.id === id);
      if (!card) return;
      if (!S.playable.includes(id)) {
        P.toast(S.pending ? `Phải chồng lá +2/+4 hoặc rút ${S.pending} lá.` : 'Lá này không hợp màu hoặc số.', 'error');
        return;
      }
      if (card.c === 'w') pickColor(id);
      else send('play', { card: id });
      return;
    }

    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled && actEl.dataset.act) {
      switch (actEl.dataset.act) {
        case 'draw': send('draw'); break;
        case 'pass': send('pass'); break;
        case 'uno': send('uno'); break;
        case 'catch': send('catch'); break;
        case 'start': send('start'); break;
        case 'next': send('next_round'); break;
        case 'lobby': send('lobby'); break;
        case 'edit-look': openLookEditor(); break;
        case 'voice-on': startVoice(); break;
        case 'voice-off': if (voice) voice.disable(); break;
        case 'voice-mute': if (voice) voice.setMuted(!voice.muted); break;
        case 'voice-deaf': if (voice) voice.setDeaf(!voice.deaf); break;
        case 'voice-help': showMicHelp(); break;
        case 'add-bot': send('add_bot', { count: 1 }); break;
        case 'add-bot-3': send('add_bot', { count: 3 }); break;
        case 'fill-bots': {
          const n = S.players.length;
          send('add_bot', { count: Math.min(Math.max(4, n + 1), S.maxPlayers) - n });
          break;
        }
        case 'remove-bots': send('remove_bots'); break;
        case 'copy-link':
          if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good');
          break;
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
      const target = fxEl.dataset.self ? null : (menuEl && menuEl.dataset.target) || null;
      send('fx', { kind: fxEl.dataset.fx, target });
      closeMenu();
      return;
    }

    const seatEl = e.target.closest('.seat');
    if (seatEl) { openMenu(seatEl.dataset.pid, seatEl); return; }
    if (menuEl && !e.target.closest('.pmenu')) closeMenu();
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-cfg]');
    if (!el) return;
    send('config', { [el.dataset.cfg]: el.type === 'checkbox' ? el.checked : Number(el.value) });
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
    try { localStorage.setItem('uno_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) beep(SOUNDS.play);
  });

  $('#btn-room').addEventListener('click', async () => {
    if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good');
  });

  function leave() {
    const doLeave = () => { if (voice) voice.disable(); if (conn) conn.leave(); setTimeout(() => { location.href = '/'; }, 150); };
    if (S && S.phase === 'play' && S.me.playing) {
      P.modal({
        title: 'Rời ván đấu?',
        body: '<p>Ván đang diễn ra — khi bạn vắng mặt, máy sẽ tự rút bài và bỏ lượt hộ. Bạn có thể quay lại bằng cách vào lại phòng với <b>đúng tên cũ</b>.</p>',
        actions: [{ label: 'Ở lại', kind: 'ghost' }, { label: 'Rời phòng', kind: 'danger', onClick: doLeave }],
      });
    } else {
      doLeave();
    }
  }
  $('#btn-leave').addEventListener('click', leave);

  // Nếu mở bằng localhost thì link mời dùng địa chỉ LAN để bạn bè vào được.
  fetch('/api/info').then((r) => r.json()).then((info) => {
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    const secure = location.protocol === 'https:';
    if (info.https && info.https.length) {
      httpsBase = local ? info.https[0] : `https://${location.hostname}:${info.httpsPort}`;
    }
    const lan = secure ? info.https : info.urls;
    if (local && lan && lan.length) { ui.lanBase = lan[0]; render(); }
  }).catch(() => {});

  renderRules();
  $('#room-code').textContent = ROOM;
  P.ensureName(() => connect());
})();
