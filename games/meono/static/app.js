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
    lastSeq: null, handIds: new Set(), fresh: new Set(), selected: new Set(), selKey: '', wasMyTurn: false,
    lastPrivate: null, insertPos: '0', rulesDone: false,
    tab: 'chat', unread: 0, lastChatId: null, lanBase: null, speaking: new Set(), sound: true,
  };
  try { ui.sound = localStorage.getItem('meono_sound') !== '0'; } catch (e) { /* bỏ qua */ }

  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
  };
  const ACTION_TEXT = {
    attack: 'Tấn Công', skip: 'Bỏ Lượt', favor: 'Xin Xỏ', shuffle: 'Xáo Bài', future: 'Tiên Tri',
    pair: 'Đôi mèo (rút ngẫu nhiên 1 lá)', triple: 'Bộ ba mèo (đòi đích danh 1 lá)',
  };
  const SINGLE = ['attack', 'skip', 'favor', 'shuffle', 'future'];

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
  const info = (t) => S.cardInfo[t];
  const label = (t) => `${info(t).icon} ${info(t).name}`;
  const myTurn = () => S && S.phase === 'play' && S.turn === S.me.id && !S.wait;
  const btn = (act, text, kind = '', extra = '') => `<button class="gh-btn ${kind}" data-act="${act}" ${extra}>${text}</button>`;

  function cardHTML(c, { cls = '', badge = '' } = {}) {
    const i = info(c.t);
    return `<div class="card k-${i.kind} t-${c.t} ${cls}" data-card="${c.id}" data-type="${c.t}">
      <div class="face"><div class="ctag">${esc(i.tag)}</div><div class="ci">${i.icon}</div>
      <div class="cn">${esc(i.name)}</div><div class="cs">${esc(i.short)}</div></div>
      ${badge ? `<span class="cbadge">${badge}</span>` : ''}</div>`;
  }
  const backHTML = (cls = '') => `<div class="card back ${cls}"><div class="face"><div class="ci">🐱</div><div class="cn">MÈO NỔ</div></div></div>`;

  // Nhóm bài trên tay theo công dụng
  const HAND_GROUPS = [
    ['🧯 Bảo mệnh', (t) => t === 'defuse'],
    ['⚡ Hành động', (t) => SINGLE.includes(t)],
    ['🚫 Chặn', (t) => t === 'nope'],
    ['🐱 Mèo · gom đôi', (t) => info(t).kind === 'cat'],
  ];

  // Lá này lúc này dùng được không, và vì sao
  function cardHint(t) {
    const w = S.wait;
    const count = S.hand.filter((c) => c.t === t).length;
    if (w && w.kind === 'favor' && w.target === S.me.id) return { ok: true, hint: `👉 Chạm để đưa lá này cho ${nm(w.from)}.` };
    if (t === 'nope') {
      if (S.canNope) return { ok: true, ready: true, hint: '👉 Chạm ngay để chặn lá vừa đánh!' };
      return { ok: false, hint: 'Dùng khi ai đó vừa đánh một lá — có vài giây để chặn.' };
    }
    if (t === 'defuse') return { ok: false, hint: 'Không cần đánh — tự động dùng khi bạn rút phải Mèo Nổ. Giữ thật kỹ!' };
    if (!myTurn()) return { ok: false, hint: 'Chờ đến lượt bạn để dùng lá này.' };
    if (info(t).kind === 'cat') {
      if (count < 2) return { ok: false, hint: 'Cần thêm 1 lá mèo giống hệt mới đánh được.' };
      return { ok: true, hint: count >= 3 ? 'Chọn 2 lá để rút ngẫu nhiên, hoặc 3 lá để đòi đích danh 1 lá.' : 'Chọn cả đôi rồi bấm Đánh để rút ngẫu nhiên 1 lá của người khác.' };
    }
    return { ok: true, hint: 'Chạm để chọn, rồi bấm Đánh.' };
  }

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
    nope: [[400, 0.08, 'square', 0.05], [300, 0.16, 'square', 0.05]],
    boom: [[120, 0.5, 'sawtooth', 0.12], [60, 0.6, 'sawtooth', 0.1]],
    defuse: [[500, 0.1], [700, 0.1], [900, 0.2]],
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
    const first = S === null;
    S = state;
    voiceInfo = vinfo || voiceInfo;
    if (voice) voice.update(state.me.id, voiceInfo);
    clockOffset = state.now - Date.now() / 1000;

    const ids = new Set((state.hand || []).map((c) => c.id));
    ui.fresh = first ? new Set() : new Set([...ids].filter((id) => !ui.handIds.has(id)));
    ui.handIds = ids;
    const selKey = `${state.round}:${state.turnNo}:${state.turn}`;
    if (selKey !== ui.selKey || !myTurn()) { ui.selKey = selKey; ui.selected.clear(); }
    ui.selected.forEach((id) => { if (!ids.has(id)) ui.selected.delete(id); });

    const mine = myTurn();
    if (mine && !ui.wasMyTurn && !first) { beep(SOUNDS.turn); if (navigator.vibrate) navigator.vibrate(120); }
    ui.wasMyTurn = mine;

    // thông tin bí mật mới (rút được lá gì, bị lấy lá gì…) → hiện toast
    const priv = state.private || [];
    const lastT = priv.length ? priv[priv.length - 1].t : 0;
    if (ui.lastPrivate !== null) priv.filter((m) => m.t > ui.lastPrivate).forEach((m) => P.toast(m.text, 'info', 4000));
    ui.lastPrivate = Math.max(ui.lastPrivate || 0, lastT);

    if (!ui.rulesDone) { renderRules(); ui.rulesDone = true; }
    render();
    const events = state.events || [];
    if (ui.lastSeq === null) ui.lastSeq = events.length ? events[events.length - 1].seq : 0;
    events.filter((e) => e.seq > ui.lastSeq).forEach(playEvent);
    if (events.length) ui.lastSeq = Math.max(ui.lastSeq, events[events.length - 1].seq);
  }

  // ---------------------------------------------------------------- hiệu ứng
  function seatRect(pid) {
    if (S && pid === S.me.id && S.phase === 'play' && S.me.alive) {
      const h = $('#hand');
      if (h && h.offsetHeight) return h.getBoundingClientRect();
    }
    const el = document.querySelector(`#seats [data-pid="${CSS.escape(pid || '')}"] .ava`);
    return el ? el.getBoundingClientRect() : null;
  }
  const rectOf = (sel) => { const el = $(sel); return el ? el.getBoundingClientRect() : null; };

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
      { transform: `translate(${x0}px, ${y0}px) scale(.55) rotate(-20deg)`, opacity: 1 },
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

  function restart(el, cls) {
    if (!el) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  }

  function playEvent(e) {
    switch (e.type) {
      case 'deal': beep(SOUNDS.draw); break;
      case 'play':
        (e.cards || []).forEach((c, i) => fly(cardHTML(c), seatRect(e.pid), rectOf('#center .discard'), { dur: 380, delay: i * 90 }));
        beep(SOUNDS.play);
        break;
      case 'nope':
        fly(cardHTML(e.card), seatRect(e.pid), rectOf('#center .discard'), { dur: 320 });
        bubble(e.pid, e.nopes % 2 ? '🚫 KHÔNG!' : '🚫 KHÔNG… Không!', 'big');
        beep(SOUNDS.nope);
        break;
      case 'blocked': bubble(e.pid, '❌ Bị chặn', 'bad'); break;
      case 'draw':
        fly(backHTML('mid'), rectOf('#center .deck'), seatRect(e.pid), { dur: 380 });
        beep(SOUNDS.draw);
        break;
      case 'defuse': bubble(e.pid, '😱 🧯 Gỡ bom!', 'bad'); beep(SOUNDS.defuse); break;
      case 'insert': fly(backHTML('mid'), seatRect(e.pid), rectOf('#center .deck'), { dur: 450 }); break;
      case 'explode':
        bubble(e.pid, '💥 BÙM!', 'big');
        restart(document.body, 'boom');
        beep(SOUNDS.boom);
        break;
      case 'attack': bubble(e.pid, '⚔️ Bị tấn công!', 'bad'); break;
      case 'shuffle': restart($('#center .deck'), 'shake'); bubble(e.pid, '🔀', 'emoji'); break;
      case 'future': bubble(e.pid, '🔮', 'emoji'); break;
      case 'steal':
      case 'give':
        fly(backHTML('mid'), seatRect(e.target), seatRect(e.pid), { dur: 450 });
        break;
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
    const label_ = S.phase === 'lobby' ? '🏠 Phòng chờ' : S.phase === 'end' ? `🏁 Hết ván ${S.round}` : `💣 Ván ${S.round}`;
    $('#phase-pill').textContent = label_;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    const alert = (S.wait && S.wait.kind === 'favor' && S.wait.target === S.me.id) || (S.wait && S.wait.kind === 'defuse' && S.wait.pid === S.me.id);
    document.title = `${myTurn() || alert ? '🔔 ' : ''}Mèo Nổ ${ROOM}`;
  }

  function renderTable() {
    // --- giữa bàn
    let center;
    if (S.phase === 'play' || S.phase === 'end') {
      const canDraw = myTurn();
      center = `<div class="pile deck ${canDraw ? 'can' : ''}" data-act="${canDraw ? 'draw' : ''}" title="Rút bài (kết thúc lượt)">
          <div class="stack"></div>${backHTML()}<div class="cnt">${S.deckCount} lá</div></div>
        <div class="pile discard">${S.discardTop ? cardHTML(S.discardTop) : '<div class="card back" style="opacity:.25"></div>'}
          <div class="cnt">${S.discardCount} lá đã đánh</div></div>
        <div class="info">${S.phase === 'play' ? `<div class="bomb-badge" title="Số Mèo Nổ còn trong chồng bài">💣 × ${S.kittens}</div>` : ''}
          ${S.phase === 'play' && S.deckCount ? `<div class="gh-muted" style="font-size:12px">≈ ${Math.round((S.kittens / S.deckCount) * 100)}% nổ</div>` : ''}</div>`;
    } else {
      center = `<div class="pile">${backHTML()}</div>`;
    }
    setHTML($('#center'), center);

    // --- ghế ngồi: mình ở dưới cùng, xếp theo thứ tự lượt chơi
    const seated = S.players.filter((p) => p.playing);
    const n = seated.length;
    const meIdx = Math.max(0, seated.findIndex((p) => p.id === S.me.id));
    const w = S.wait;
    const targeted = w && (w.kind === 'nope' ? w.target : w.kind === 'favor' ? w.target : null);
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
      const inGame = S.phase === 'play' || S.phase === 'end';
      const fanN = Math.min(p.count, 7);
      const fan = S.phase === 'play' && p.id !== S.me.id && fanN
        ? `<div class="fan">${Array.from({ length: fanN }, (_, j) => `<i style="transform:rotate(${(j - (fanN - 1) / 2) * 11}deg)"></i>`).join('')}</div>` : '';
      const tags = [];
      if (p.bot) tags.push('<span class="tag">🤖</span>');
      if (p.host) tags.push('<span class="tag">👑</span>');
      if (inGame && p.playing && !p.alive) tags.push('<span class="tag">💀</span>');
      if (turn && S.turnsLeft > 1) tags.push(`<span class="tag turns">×${S.turnsLeft} lượt</span>`);
      if (S.phase === 'end' && S.winner === p.id) tags.push('<span class="tag win">🏆</span>');
      const count = inGame && p.alive && p.playing ? `<span class="count">${p.count}</span>` : '';
      const cls = ['seat', turn ? 'turn' : '', p.id === S.me.id ? 'me' : '', p.connected ? '' : 'off',
        p.playing ? '' : 'watch', inGame && p.playing && !p.alive ? 'dead' : '', targeted === p.id ? 'target' : '',
        ui.speaking.has(p.id) ? 'speaking' : ''].join(' ');
      const ring = turn && S.deadline && S.timerKind === 'turn'
        ? '<svg class="ring" viewBox="0 0 72 72"><circle cx="36" cy="36" r="33" stroke-dasharray="207.3" stroke-dashoffset="0"/></svg>' : '';
      return `<div class="${cls}" data-pid="${esc(p.id)}" style="left:${x}%;top:${y}%">
        ${fan}<div class="avabox"><div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>${ring}</div>
        <div class="name">${p.id === S.me.id ? 'Bạn' : esc(p.name)}</div>
        <div class="meta">${count}${tags.join('')}${p.score ? `<span>🏆${p.score}</span>` : ''}</div></div>`;
    }).join('');
    setHTML($('#seats'), html);
  }

  // Các lá đang chọn có tạo thành một nước đi hợp lệ không?
  function selection() {
    const cards = S.hand.filter((c) => ui.selected.has(c.id));
    if (!cards.length) return null;
    const types = new Set(cards.map((c) => c.t));
    const t = cards[0].t;
    if (cards.length === 1 && SINGLE.includes(t)) return { cards, action: t, needTarget: t === 'favor' };
    if (types.size === 1 && info(t).kind === 'cat' && (cards.length === 2 || cards.length === 3)) {
      return { cards, action: cards.length === 2 ? 'pair' : 'triple', needTarget: true };
    }
    return { cards, action: null };
  }

  function futureHTML() {
    if (!S.future || !S.future.length || !S.me.alive) return '';
    return `<div class="future">🔮 Bạn biết trước: <div class="cards">${S.future.map((c, i) =>
      `${cardHTML(c, { cls: 'mini' })}${i < S.future.length - 1 ? '<small>→</small>' : ''}`).join('')}</div>
      <span class="gh-muted" style="font-weight:600">(trên cùng ở bên trái)</span></div>`;
  }

  function renderBar() {
    const el = $('#bar');
    let html = '';
    let mine = false;
    const w = S.wait;
    if (S.phase === 'play') {
      if (w && w.kind === 'nope') {
        const blocked = w.nopes % 2 === 1;
        const what = w.action === 'triple' ? `${ACTION_TEXT.triple}: ${label(w.name)}` : ACTION_TEXT[w.action];
        const cards = `<span class="wait-cards">${w.cards.map((c) => cardHTML(c, { cls: 'mini' })).join('')}</span>`;
        const state = w.nopes ? `<span class="nope-state ${blocked ? 'on' : 'off'}">${blocked ? '🚫 ĐANG BỊ CHẶN' : '✅ ĐÃ GỠ CHẶN'} (${w.nopes} lá Không!)</span>` : '';
        const nopeBtn = S.canNope ? btn('nope', blocked ? '🚫 Không! (gỡ chặn)' : '🚫 KHÔNG!', 'nope') : '';
        html = `<div class="msg-main">${w.pid === S.me.id ? 'Bạn' : `<b>${esc(nm(w.pid))}</b>`} đánh ${cards} <b>${esc(what)}</b>
            ${w.target ? `→ ${w.target === S.me.id ? '<b>BẠN</b>' : esc(nm(w.target))}` : ''}${state}
            <small>${S.canNope ? 'Có lá Không! — chặn ngay trước khi hết giờ!' : 'Đang chờ xem có ai chặn bằng lá Không!…'}</small>
            <div class="progress"><i id="wait-progress"></i></div></div>${nopeBtn}`;
        mine = S.canNope;
      } else if (w && w.kind === 'favor') {
        if (w.target === S.me.id) {
          mine = true;
          html = `<div class="msg-main">🙏 <b>${esc(nm(w.from))}</b> xin bạn 1 lá!<small>Nhấn vào một lá trên tay để đưa cho họ (hết giờ sẽ đưa ngẫu nhiên).</small></div>`;
        } else {
          html = `<div class="msg-main">⏳ Đang chờ <b>${esc(nm(w.target))}</b> chọn 1 lá đưa cho ${w.from === S.me.id ? 'bạn' : esc(nm(w.from))}…</div>`;
        }
      } else if (w && w.kind === 'defuse') {
        if (w.pid === S.me.id) {
          mine = true;
          const n = S.deckCount;
          const opts = [['0', 'Trên cùng (người sau rút ngay!)']];
          for (let i = 1; i < Math.min(n, 6); i++) opts.push([String(i), `Thứ ${i + 1} từ trên xuống`]);
          if (n > 0) opts.push([String(n), 'Dưới cùng']);
          opts.push(['random', '🎲 Ngẫu nhiên']);
          if (!opts.some(([v]) => v === ui.insertPos)) ui.insertPos = '0';
          html = `<div class="msg-main">🧯 Phù! Bạn đã gỡ bom.<small>Bí mật nhét Mèo Nổ trở lại chồng bài (${n} lá) — chọn vị trí:</small></div>
            <div class="insert-row"><select id="insert-pos">${opts.map(([v, t]) => `<option value="${v}" ${v === ui.insertPos ? 'selected' : ''}>${t}</option>`).join('')}</select>
            ${btn('insert', '💣 Nhét bom', 'primary')}</div>`;
        } else {
          html = `<div class="msg-main">🤫 <b>${esc(nm(w.pid))}</b> đang bí mật nhét Mèo Nổ trở lại chồng bài…</div>`;
        }
      } else if (!S.me.playing) {
        html = '<div class="msg-main">👀 Bạn đang xem ván này<small>Ván sau bạn sẽ được chia bài.</small></div>';
      } else if (!S.me.alive) {
        html = '<div class="msg-main">💀 Bạn đã nổ tung!<small>Hãy xem mọi người chơi tiếp — đừng tiết lộ gì nhé.</small></div>';
      } else if (myTurn()) {
        mine = true;
        const sel = selection();
        const turns = S.turnsLeft > 1 ? ` (còn ${S.turnsLeft} lượt)` : '';
        let hint = 'Chọn lá để đánh (1 lá chức năng, hoặc 2–3 lá mèo giống nhau), hoặc rút bài để kết thúc lượt.';
        let playBtn = '';
        if (sel && sel.action) {
          const how = sel.action === 'pair' ? 'rút ngẫu nhiên 1 lá của người bạn chọn.'
            : sel.action === 'triple' ? 'chọn 1 người và gọi tên lá muốn lấy.' : info(sel.cards[0].t).desc;
          hint = `Đã chọn: <b>${esc(ACTION_TEXT[sel.action])}</b> — ${esc(how)}`;
          playBtn = btn('play', `▶ Đánh ${sel.cards.length > 1 ? `${sel.cards.length} lá` : ''}`, 'primary');
        } else if (sel) {
          hint = sel.cards.length === 1 && info(sel.cards[0].t).kind === 'cat'
            ? 'Lá mèo phải đánh theo đôi hoặc bộ ba giống nhau.'
            : sel.cards.some((c) => c.t === 'nope') ? 'Lá Không! chỉ dùng để chặn hành động của người khác.'
              : sel.cards.some((c) => c.t === 'defuse') ? 'Gỡ Bom sẽ tự động dùng khi bạn rút phải Mèo Nổ.'
                : 'Tổ hợp lá này không đánh được.';
        }
        html = `<div class="msg-main">👉 Lượt của bạn${turns}!<small>${hint}</small></div>${playBtn}
          ${ui.selected.size ? btn('clear', 'Bỏ chọn', 'ghost small') : ''}${btn('draw', '🂠 Rút bài & hết lượt', sel && sel.action ? 'ghost' : 'primary')}`;
      } else {
        const turns = S.turnsLeft > 1 ? ` <small>Còn ${S.turnsLeft} lượt.</small>` : '';
        html = `<div class="msg-main">⏳ Đang chờ <b>${esc(nm(S.turn))}</b>…${turns}</div>`;
      }
      html = futureHTML() + (html ? `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;width:100%">${html}</div>` : '');
    }
    el.className = 'bar' + (mine ? ' myturn' : '');
    setHTML(el, html);
  }

  function renderHand() {
    const el = $('#hand');
    if (S.phase !== 'play' || !S.hand || !S.me.alive) { setHTML(el, ''); return; }
    const w = S.wait;
    const giving = w && w.kind === 'favor' && w.target === S.me.id;
    const active = myTurn();
    const counts = {};
    S.hand.forEach((c) => { counts[c.t] = (counts[c.t] || 0) + 1; });
    const groups = HAND_GROUPS.map(([title, test]) => {
      const cards = S.hand.filter((c) => test(c.t));
      if (!cards.length) return '';
      return `<div class="hgroup"><div class="hg-label">${title}</div><div class="hg-cards">${cards.map((c, i) => {
        const h = cardHint(c.t);
        const last = i === cards.length - 1 || cards[i + 1].t !== c.t;
        const cls = [ui.selected.has(c.id) ? 'sel' : '', ui.fresh.has(c.id) ? 'fresh' : '',
          h.ready ? 'ready' : '', active || giving ? (h.ok ? 'ok' : 'dim') : ''].join(' ');
        return cardHTML(c, { cls, badge: last && counts[c.t] > 1 ? `×${counts[c.t]}` : '' });
      }).join('')}</div></div>`;
    }).join('');
    let labelText = `Bài của bạn: <b>${S.hand.length} lá</b>`;
    if (giving) labelText = `👉 <b>Chạm vào lá muốn đưa cho ${esc(nm(w.from))}</b>`;
    else if (S.canNope) labelText = '👉 <b>Chạm lá 🚫 Không! để chặn</b>';
    else if (active) labelText += ' · chạm để chọn · lá mờ là chưa đánh được lúc này · rê chuột lên lá để xem giải thích';
    el.classList.toggle('active', active);
    el.classList.toggle('giving', !!giving);
    if (setHTML(el, `<div class="hand-row">${groups}</div><div class="hand-label">${labelText}</div>`)) fitHand();
  }

  function fitHand() {
    const el = $('#hand');
    const row = el.querySelector('.hand-row');
    const first = row && row.querySelector('.card');
    if (!first) return;
    const n = S.hand.length;
    const g = row.querySelectorAll('.hgroup').length;
    const cw = first.offsetWidth;
    const avail = el.clientWidth - 30 - (g - 1) * 16;
    let overlap = n > g ? (avail - n * cw) / (n - g) : 0;
    overlap = Math.max(-cw * 0.6, Math.min(4, overlap));
    el.style.setProperty('--overlap', overlap + 'px');
  }
  window.addEventListener('resize', () => { if (S) fitHand(); });

  // ---------------------------------------------------------------- chọn mục tiêu / tên lá
  function pickTarget(title, onPick) {
    const body = document.createElement('div');
    body.className = 'pick-list';
    const others = S.players.filter((p) => p.playing && p.alive && p.id !== S.me.id);
    body.innerHTML = others.map((p) => `<button data-pick="${esc(p.id)}" ${p.count ? '' : 'disabled'}>
      ${p.bot ? '🤖' : '🙂'} ${esc(p.name)}<small>${p.count} lá</small></button>`).join('');
    const m = P.modal({ title, body, actions: [{ label: 'Huỷ', kind: 'ghost' }] });
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b || b.disabled) return;
      m.close();
      onPick(b.dataset.pick);
    });
  }

  function pickName(onPick) {
    const body = document.createElement('div');
    body.className = 'pick-grid';
    body.innerHTML = S.cardOrder.filter((t) => t !== 'kitten').map((t) => cardHTML({ id: t, t })).join('');
    const m = P.modal({ title: '🎯 Bạn muốn đòi lá nào?', body, actions: [{ label: 'Huỷ', kind: 'ghost' }] });
    body.addEventListener('click', (e) => {
      const c = e.target.closest('[data-card]');
      if (!c) return;
      m.close();
      onPick(c.dataset.card);
    });
  }

  function playSelection() {
    const sel = selection();
    if (!sel || !sel.action) return;
    const ids = sel.cards.map((c) => c.id);
    const go = (target, name) => { send('play', { cards: ids, target, name }); ui.selected.clear(); };
    if (!sel.needTarget) { go(null, null); return; }
    const title = sel.action === 'favor' ? '🙏 Xin bài của ai?' : sel.action === 'pair' ? '🐱 Rút ngẫu nhiên 1 lá của ai?' : '🐱 Đòi bài của ai?';
    pickTarget(title, (target) => {
      if (sel.action === 'triple') pickName((name) => go(target, name));
      else go(target, null);
    });
  }

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const fmtSec = (s) => (s ? `${s} giây` : 'Không giới hạn');
  const inviteLink = () => `${ui.lanBase || location.origin}/g/meono/?room=${ROOM}`;

  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    const full = n >= S.maxPlayers;
    return `<div class="panel"><h3><span class="grow">🤖 Người chơi ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Không đủ người? Thêm bot để test — bot biết dùng Tiên Tri, né bom, chặn bằng Không!, xin bài và nhét bom hại người sau.</p>
      <div class="btns-row">
        ${btn('add-bot', '＋ 1 bot', 'small', full ? 'disabled' : '')}
        ${btn('add-bot-3', '＋ 3 bot', 'small', full ? 'disabled' : '')}
        ${btn('fill-bots', `Lấp đủ ${Math.min(Math.max(4, n + 1), S.maxPlayers)} người`, 'small primary', full ? 'disabled' : '')}
        ${bots ? btn('remove-bots', '🗑 Xoá hết bot', 'small ghost') : ''}
      </div></div>`;
  }

  function settingsPanel() {
    const dis = S.me.host ? '' : 'disabled';
    const cfg = S.config;
    const select = (key, opts, fmt, text) => `<div class="setting"><label>${text}</label>
      <select data-cfg="${key}" ${dis}>${opts.map((t) => `<option value="${t}" ${t === cfg[key] ? 'selected' : ''}>${fmt(t)}</option>`).join('')}</select></div>`;
    return `<div class="panel"><h3>⚙️ Luật chơi</h3><div class="settings">
      ${select('turn_time', S.turnTimes, fmtSec, '⏱ Thời gian mỗi lượt (hết giờ tự rút bài)')}
      ${select('nope_time', S.nopeTimes, (t) => `${t} giây`, '🚫 Thời gian chờ chặn bằng Không!')}
    </div></div>`;
  }

  function renderPanel() {
    const el = $('#panel');
    if (S.phase === 'play') { setHTML(el, ''); return; }
    const host = S.me.host;
    let html = '';
    if (S.phase === 'end') {
      const board = [...S.players].sort((a, b) => b.score - a.score)
        .map((p, i) => `<div class="res-row ${p.id === S.winner ? 'win' : ''}"><span class="rank">${p.id === S.winner ? '🏆' : i + 1}</span>
          <span class="rname">${esc(p.name)}${p.bot ? ' 🤖' : ''}</span>
          <div class="rcards">${p.hand ? p.hand.map((c) => cardHTML(c, { cls: 'mini' })).join('') : ''}${p.playing && !p.alive ? '<span class="gh-muted">💥 Đã nổ</span>' : ''}</div>
          <span class="rpts">${p.score} ván thắng</span></div>`).join('');
      html += `<div class="panel">
        <div class="result-head"><div class="trophy">🏆</div><div>
          <h2>${esc(nm(S.winner))}${S.winner === S.me.id ? ' (bạn)' : ''} sống sót đến cuối cùng!</h2>
          <p>Ván ${S.round} kết thúc. Bảng xếp hạng theo số ván thắng:</p></div></div>
        <div class="results">${board}</div>
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

  // ---------------------------------------------------------------- voice chat (tắt khi không nạp voice.js)
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
    if (voice.error === 'insecure') P.toast('Cần mở trang bằng HTTPS để dùng mic.', 'error', 5000);
    else if (voice.error) P.toast('Không dùng được mic — hiện chỉ nghe được.', 'error', 5000);
    else P.toast('🎙️ Đã vào voice chat!', 'good');
  }

  function renderVoice() {
    const el = $('#voice-ctl');
    if (!window.GameVoice || !window.GameVoice.supported) { setHTML(el, ''); return; }
    const st = voice ? voice.status() : { on: false };
    const html = !st.on
      ? `<button class="vbtn join" data-act="voice-on" title="Vào voice chat">🎙️ <span>Voice${voiceInfo.peers.length ? ` · ${voiceInfo.peers.length}` : ''}</span></button>`
      : `<div class="vgroup">
        <button class="vbtn ${st.muted ? 'off' : 'on'}" data-act="voice-mute">${st.muted ? '🔇' : '🎤'}</button>
        <button class="vbtn ${st.deaf ? 'off' : ''}" data-act="voice-deaf">${st.deaf ? '🔕' : '🎧'}</button>
        <span class="vinfo">👥 ${st.peers}</span>
        <button class="vbtn leave" data-act="voice-off" title="Rời voice">✕</button></div>`;
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
    const items = [
      ...S.log.map((l) => ({ ...l, priv: false })),
      ...(S.private || []).map((l) => ({ ...l, priv: true })),
    ].sort((x, y) => x.t - y.t);
    const html = items.length
      ? items.map((l) => `<div class="log-item ${l.priv ? 'private' : ''} ${esc(l.kind)}"><span class="lt">${fmtTime(l.t)}</span>${l.priv ? '🔒 ' : ''}${esc(l.text)}</div>`).join('')
      : '<div class="empty-note">Diễn biến ván đấu và thông tin bí mật của riêng bạn (🔒) sẽ hiện ở đây.</div>';
    const list = $('#log-list');
    if (setHTML(list, html)) list.scrollTop = list.scrollHeight;
  }

  function renderRules() {
    const rows = S.cardOrder.filter((t) => t === 'kitten' || info(t).kind !== 'cat' || t === 'taco')
      .map((t) => `<div class="row">${cardHTML({ id: t, t }, { cls: 'mini' })}<p><b>${esc(info(t).kind === 'cat' ? 'Các lá mèo' : info(t).name)}</b> — ${esc(info(t).desc)}</p></div>`).join('');
    $('#rules').innerHTML = `
      <h4>🎯 Mục tiêu</h4><p>Đừng nổ tung! Người cuối cùng còn sống thắng ván.</p>
      <h4>🔁 Mỗi lượt</h4><p>Đánh bao nhiêu lá tuỳ thích (hoặc không đánh), rồi <b>rút 1 lá</b> để kết thúc lượt.
        Rút phải 💣 Mèo Nổ mà không có 🧯 Gỡ Bom là bị loại.</p>
      <h4>🃏 Các lá bài</h4>${rows}
      <h4>🚫 Chặn bằng Không!</h4><p>Sau mỗi lá được đánh có vài giây để ai đó chặn. Không! chặn được cả Không! — số lá Không! lẻ là hành động bị huỷ.</p>
      <h4>🧮 Chia bài</h4><p>Mỗi người 7 lá + 1 Gỡ Bom. Chồng bài có (số người − 1) Mèo Nổ. Từ 6 người trở lên dùng gấp đôi bộ bài.</p>`;
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
    timer.classList.toggle('urgent', secs <= 5 && (myTurn() || S.timerKind === 'nope'));
    fill.style.width = `${frac * 100}%`;
    const ring = document.querySelector('#seats .turn .ring circle');
    if (ring) ring.style.strokeDashoffset = String(207.3 * (1 - frac));
    const wp = $('#wait-progress');
    if (wp) wp.style.width = `${frac * 100}%`;
  }
  setInterval(tick, 200);

  // ---------------------------------------------------------------- giải thích lá bài khi rê chuột
  let tipEl = null;
  function hideTip() { if (tipEl) { tipEl.remove(); tipEl = null; } }
  function showTip(cardEl) {
    const t = cardEl.dataset.type;
    if (!t || !S || !info(t)) return;
    hideTip();
    const i = info(t);
    const inHand = !!cardEl.closest('#hand');
    const hint = inHand && S.phase === 'play' ? cardHint(t).hint : '';
    tipEl = document.createElement('div');
    tipEl.className = 'card-tip';
    tipEl.innerHTML = `<b>${i.icon} ${esc(i.name)}</b>${esc(i.desc)}${hint ? `<div class="tip-hint">${esc(hint)}</div>` : ''}`;
    document.body.appendChild(tipEl);
    const r = cardEl.getBoundingClientRect();
    const half = tipEl.offsetWidth / 2;
    tipEl.style.left = Math.min(window.innerWidth - half - 8, Math.max(half + 8, r.left + r.width / 2)) + 'px';
    if (r.top - 10 - tipEl.offsetHeight < 8) {
      tipEl.style.transform = 'translate(-50%, 0)';
      tipEl.style.top = (r.bottom + 10) + 'px';
    } else {
      tipEl.style.top = (r.top - 10) + 'px';
    }
  }
  if (window.matchMedia('(hover: hover)').matches) {
    document.addEventListener('mouseover', (e) => {
      const c = e.target.closest('.card[data-type]');
      if (c) showTip(c); else hideTip();
    });
  }

  // ---------------------------------------------------------------- sự kiện
  document.addEventListener('click', async (e) => {
    const cardEl = e.target.closest('#hand .card');
    if (!e.target.closest('.card')) hideTip();
    if (cardEl) {
      const id = Number(cardEl.dataset.card);
      const w = S.wait;
      if (w && w.kind === 'favor' && w.target === S.me.id) { hideTip(); send('give', { card: id }); return; }
      if (cardEl.dataset.type === 'nope' && S.canNope) { send('nope'); return; }
      if (!myTurn()) { if (!w) P.toast('Chưa đến lượt của bạn.'); return; }
      if (ui.selected.has(id)) ui.selected.delete(id);
      else {
        // chọn lá khác loại thì bỏ chọn các lá cũ
        const card = S.hand.find((c) => c.id === id);
        const keep = S.hand.filter((c) => ui.selected.has(c.id) && c.t === card.t && info(c.t).kind === 'cat');
        ui.selected = new Set(keep.map((c) => c.id).slice(-2));
        ui.selected.add(id);
      }
      render();
      return;
    }

    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled && actEl.dataset.act) {
      switch (actEl.dataset.act) {
        case 'draw': ui.selected.clear(); send('draw'); break;
        case 'play': playSelection(); break;
        case 'clear': ui.selected.clear(); render(); break;
        case 'nope': send('nope'); break;
        case 'insert': send('insert', { pos: ($('#insert-pos') || {}).value || '0' }); break;
        case 'start': send('start'); break;
        case 'next': send('next_round'); break;
        case 'lobby': send('lobby'); break;
        case 'edit-look': openLookEditor(); break;
        case 'voice-on': startVoice(); break;
        case 'voice-off': if (voice) voice.disable(); break;
        case 'voice-mute': if (voice) voice.setMuted(!voice.muted); break;
        case 'voice-deaf': if (voice) voice.setDeaf(!voice.deaf); break;
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
    if (e.target.id === 'insert-pos') { ui.insertPos = e.target.value; return; }
    const el = e.target.closest('[data-cfg]');
    if (!el) return;
    send('config', { [el.dataset.cfg]: Number(el.value) });
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
    try { localStorage.setItem('meono_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) beep(SOUNDS.play);
  });

  $('#btn-room').addEventListener('click', async () => {
    if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good');
  });

  function leave() {
    const doLeave = () => { if (voice) voice.disable(); if (conn) conn.leave(); setTimeout(() => { location.href = '/'; }, 150); };
    if (S && S.phase === 'play' && S.me.playing && S.me.alive) {
      P.modal({
        title: 'Rời ván đấu?',
        body: '<p>Ván đang diễn ra — khi bạn vắng mặt, máy sẽ tự rút bài hộ (rất dễ nổ đấy 💣). Bạn có thể quay lại bằng cách vào lại phòng với <b>đúng tên cũ</b>.</p>',
        actions: [{ label: 'Ở lại', kind: 'ghost' }, { label: 'Rời phòng', kind: 'danger', onClick: doLeave }],
      });
    } else {
      doLeave();
    }
  }
  $('#btn-leave').addEventListener('click', leave);

  // Nếu mở bằng localhost thì link mời dùng địa chỉ LAN để bạn bè vào được.
  fetch('/api/info').then((r) => r.json()).then((inf) => {
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    const secure = location.protocol === 'https:';
    if (inf.https && inf.https.length) {
      httpsBase = local ? inf.https[0] : `https://${location.hostname}:${inf.httpsPort}`;
    }
    const lan = secure ? inf.https : inf.urls;
    if (local && lan && lan.length) { ui.lanBase = lan[0]; render(); }
  }).catch(() => {});

  $('#room-code').textContent = ROOM;
  P.ensureName(() => connect());
})();
