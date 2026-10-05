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
    lastSeq: null, wasMyTurn: false, raiseKey: '', raiseTo: 0, boardN: 0, handKey: '',
    tab: 'chat', unread: 0, lastChatId: null, lanBase: null, sound: true,
  };
  try { ui.sound = localStorage.getItem('poker_sound') !== '0'; } catch (e) { /* bỏ qua */ }

  const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
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
  const num = (n) => Number(n || 0).toLocaleString('vi-VN');
  const btn = (act, text, kind = '', extra = '') => `<button class="gh-btn ${kind}" data-act="${act}" ${extra}>${text}</button>`;
  const myTurn = () => !!(S && S.options);
  const seated = () => S.players.filter((p) => p.seated);

  function cardHTML(c, cls = '') {
    if (!c) return `<div class="pc back ${cls}"></div>`;
    const r = c[0] === 'T' ? '10' : c[0];
    const s = SUIT[c[1]];
    return `<div class="pc ${c[1] === 'h' || c[1] === 'd' ? 'red' : ''} ${cls}"><span class="c">${r}${s}</span><span class="r">${r}</span><span class="s">${s}</span></div>`;
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
    deal: [[300, 0.05, 'triangle', 0.05], [340, 0.05, 'triangle', 0.05], [380, 0.05, 'triangle', 0.05]],
    chip: [[1800, 0.04, 'square', 0.03], [2400, 0.05, 'square', 0.025]],
    check: [[220, 0.06, 'triangle', 0.08], [220, 0.06, 'triangle', 0.06]],
    fold: [[500, 0.08, 'sine', 0.04], [300, 0.1, 'sine', 0.03]],
    street: [[440, 0.08, 'triangle', 0.05], [660, 0.12, 'triangle', 0.05]],
    turn: [[660, 0.12], [880, 0.18]],
    win: [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.35]],
    allin: [[200, 0.15, 'sawtooth', 0.06], [300, 0.15, 'sawtooth', 0.06], [450, 0.3, 'sawtooth', 0.06]],
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
    const o = state.options;
    const key = o ? `${state.handNo}:${state.street}:${o.currentBet}:${o.bet}` : '';
    if (key !== ui.raiseKey) { ui.raiseKey = key; ui.raiseTo = o ? o.minTo : 0; }
    if (myTurn() && !ui.wasMyTurn && !first) { beep(SOUNDS.turn); if (navigator.vibrate) navigator.vibrate(120); }
    ui.wasMyTurn = myTurn();

    render();
    const events = state.events || [];
    if (ui.lastSeq === null) ui.lastSeq = events.length ? events[events.length - 1].seq : 0;
    events.filter((e) => e.seq > ui.lastSeq).forEach(playEvent);
    if (events.length) ui.lastSeq = Math.max(ui.lastSeq, events[events.length - 1].seq);
  }

  // ---------------------------------------------------------------- hiệu ứng
  function seatRect(pid) {
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
      { transform: `translate(${x0}px, ${y0}px) scale(.6)`, opacity: 1 },
      { transform: `translate(${x1}px, ${y1}px) scale(1)`, opacity: 1 },
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
    el.style.top = (r.top + 4) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1900);
  }

  const CHIP = '<span style="font-size:22px">🪙</span>';
  function playEvent(e) {
    switch (e.type) {
      case 'deal': {
        beep(SOUNDS.deal);
        const from = rectOf('#center .board');
        seated().filter((p) => p.inHand).forEach((p, i) => fly(cardHTML(null, 'sm'), from, seatRect(p.id), { dur: 350, delay: i * 60 }));
        break;
      }
      case 'act':
        if (e.move === 'fold') beep(SOUNDS.fold);
        else if (e.move === 'check') beep(SOUNDS.check);
        else {
          beep(e.move === 'allin' ? SOUNDS.allin : SOUNDS.chip);
          fly(CHIP, seatRect(e.pid), rectOf('#center .pot'), { dur: 420 });
          if (e.move === 'allin') bubble(e.pid, '🔥 ALL-IN!', 'big');
        }
        break;
      case 'street': beep(SOUNDS.street); break;
      case 'win':
        beep(SOUNDS.win);
        (e.pids || []).forEach((pid, i) => {
          for (let k = 0; k < 4; k++) fly(CHIP, rectOf('#center .pot'), seatRect(pid), { dur: 500, delay: 250 + i * 150 + k * 90 });
        });
        break;
      case 'champion': bubble(e.pid, '🏆', 'emoji'); beep(SOUNDS.win); break;
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
    tick();
  }

  function renderTop() {
    const label = S.phase === 'lobby' ? '🏠 Phòng chờ' : S.phase === 'end' ? `🏁 Hết ván ${S.round}`
      : `♠️ Ván bài ${S.handNo} · mù ${num(S.bb / 2)}/${num(S.bb)}`;
    $('#phase-pill').textContent = label;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `${myTurn() ? '🔔 ' : ''}Poker ${ROOM}`;
  }

  function winnersOf() {
    return S.result ? Object.keys(S.result.payouts || {}) : [];
  }

  function renderTable() {
    const res = S.result;
    const winners = winnersOf();
    // Lá chung: làm nổi bật các lá nằm trong tay bài thắng.
    let hiCards = new Set();
    if (res && res.showdown && winners.length && res.hands[winners[0]]) hiCards = new Set(res.hands[winners[0]].best);
    const n = S.board.length;
    const boardKey = `${S.handNo}`;
    if (boardKey !== ui.handKey) { ui.handKey = boardKey; ui.boardN = 0; }
    const board = Array.from({ length: 5 }, (_, i) => {
      const c = S.board[i];
      if (!c) return '<div class="slot"></div>';
      const cls = [i >= ui.boardN ? 'flip' : '', res && res.showdown ? (hiCards.has(c) ? 'hi' : 'dim') : ''].join(' ');
      return cardHTML(c, cls);
    }).join('');
    let center;
    if (S.phase === 'play' && S.stage !== 'waiting' && S.handNo) {
      let banner = '';
      if (res) {
        const pots = res.pots.map((p) => `${p.winners.map(who).join(' & ')} ăn ${num(p.amount)}${p.hand ? ` · ${esc(p.hand)}` : ''}`);
        banner = `<div class="win-banner">🏆 ${pots[0]}${pots.slice(1).map((t) => `<small>${t}</small>`).join('')}</div>`;
      }
      center = `<div class="street">${res ? (res.showdown ? 'Lật bài' : 'Kết thúc') : S.stage === 'runout' ? 'Lật nốt bài chung' : ({ preflop: 'Trước flop', flop: 'Flop', turn: 'Turn', river: 'River' }[S.street] || '')}</div>
        <div class="board">${board}</div>
        <div class="pot">💰 Pot ${num(S.pot)}${S.bb ? `<small>mù ${num(S.bb / 2)}/${num(S.bb)}</small>` : ''}</div>${banner}`;
    } else if (S.phase === 'play' && S.stage === 'waiting') {
      center = '<div class="pot">⏳ Đang chờ đủ người kết nối…</div>';
    } else {
      center = `<div class="board">${Array.from({ length: 5 }, () => cardHTML(null)).join('')}</div>`;
    }
    if (setHTML($('#center'), center)) ui.boardN = n;

    // Ghế: mình ở dưới cùng.
    const seats = seated();
    const cnt = seats.length;
    const meIdx = Math.max(0, seats.findIndex((p) => p.id === S.me.id));
    const pos = {};
    seats.forEach((p, i) => {
      const rel = (i - meIdx + cnt) % cnt;
      const a = Math.PI / 2 + (rel * 2 * Math.PI) / cnt;
      pos[p.id] = { x: 50 + 44 * Math.cos(a), y: 50 + 41 * Math.sin(a) };
    });
    const inPlay = S.phase === 'play';
    const html = S.players.map((p) => {
      let x; let y;
      if (pos[p.id]) ({ x, y } = pos[p.id]);
      else { const k = S.players.filter((q) => !pos[q.id]).indexOf(p); x = 4 + k * 9; y = 4; }
      const turn = S.turn === p.id;
      const hand = res && res.hands && res.hands[p.id];
      const tags = [];
      if (p.bot) tags.push('<span class="tag">🤖</span>');
      if (p.host) tags.push('<span class="tag">👑</span>');
      if (inPlay && S.handNo && p.id === S.sb) tags.push('<span class="tag bl">SB</span>');
      if (inPlay && S.handNo && p.id === S.bbPid) tags.push('<span class="tag bl">BB</span>');
      if (S.phase === 'end' && S.winner === p.id) tags.push('<span class="tag win">🏆</span>');
      let cards = '';
      if (inPlay && p.inHand && p.id !== S.me.id) {
        const best = hand ? new Set(hand.best) : null;
        cards = p.cards
          ? p.cards.map((c) => cardHTML(c, `sm ${best && res.showdown ? (best.has(c) ? 'hi' : 'dim') : ''}`)).join('')
          : (p.folded ? '' : cardHTML(null, 'sm') + cardHTML(null, 'sm'));
      }
      const act = inPlay && p.action && !res
        ? `<div class="act ${/Bỏ/.test(p.action) ? 'fold' : /All-in/.test(p.action) ? 'allin' : /Tố|Cược/.test(p.action) ? 'raise' : ''}">${esc(p.action)}</div>` : '';
      const cls = ['seat', turn ? 'turn' : '', p.id === S.me.id ? 'me' : '', p.connected ? '' : 'off',
        pos[p.id] ? '' : 'watch', p.folded ? 'folded' : '', inPlay && !p.chips && !p.inHand ? 'out' : '',
        winners.includes(p.id) ? 'winner' : ''].join(' ');
      const ring = turn && S.deadline
        ? '<svg class="ring" viewBox="0 0 72 72"><circle cx="36" cy="36" r="33" stroke-dasharray="207.3" stroke-dashoffset="0"/></svg>' : '';
      const chips = S.phase === 'lobby' ? '' : `<span class="chipcount">🪙 ${num(p.chips)}</span>`;
      return `<div class="${cls}" data-pid="${esc(p.id)}" style="left:${x}%;top:${y}%">
        <div class="hole">${cards}</div>${act}
        <div class="avabox"><div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>${ring}</div>
        <div class="name">${p.id === S.me.id ? 'Bạn' : esc(p.name)}</div>
        <div class="meta">${chips}${tags.join('')}</div>
        ${hand && res.showdown ? `<div class="handname">${esc(hand.name)}</div>` : ''}</div>`;
    }).join('');
    setHTML($('#seats'), html);

    // Chip cược & nút nhà cái, đặt giữa ghế và tâm bàn.
    let bets = '';
    if (inPlay && S.handNo) {
      seats.forEach((p) => {
        const q = pos[p.id];
        if (p.bet > 0 && !res) bets += `<div class="betchip" style="left:${50 + (q.x - 50) * 0.58}%;top:${50 + (q.y - 50) * 0.55}%"><i></i>${num(p.bet)}</div>`;
      });
      const d = pos[S.dealer];
      if (d) bets += `<div class="dealer-btn" style="left:${50 + (d.x - 50) * 0.72 + 5}%;top:${50 + (d.y - 50) * 0.7}%">D</div>`;
    }
    setHTML($('#bets'), bets);
  }

  function renderBar() {
    const el = $('#bar');
    let html = '';
    let mine = false;
    const o = S.options;
    if (S.phase === 'play') {
      if (o) {
        mine = true;
        const potAfter = S.pot + o.toCall;
        const preset = (label, to) => {
          const v = Math.max(o.minTo, Math.min(o.maxTo, Math.round(to)));
          return `<button class="gh-btn small preset" data-preset="${v}">${label}</button>`;
        };
        const raiseWord = o.currentBet ? 'Tố lên' : 'Cược';
        const raise = o.canRaise ? (o.minTo >= o.maxTo
          ? btn('allin', `🔥 All-in ${num(o.maxTo)}`, 'allin')
          : `<div class="raise-box">
              <input type="range" id="raise-range" min="${o.minTo}" max="${o.maxTo}" step="${Math.max(1, Math.round(S.bb / 2))}" value="${ui.raiseTo}">
              <input type="number" id="raise-num" min="${o.minTo}" max="${o.maxTo}" value="${ui.raiseTo}">
              ${preset('Min', o.minTo)}${preset('½ Pot', o.currentBet + potAfter / 2)}${preset('Pot', o.currentBet + potAfter)}
              ${btn('raise', `💰 ${raiseWord} <span id="raise-label">${num(ui.raiseTo)}</span>`, 'raise')}
              ${btn('allin', '🔥 All-in', 'allin small')}</div>`) : '';
        const call = o.canCheck ? btn('check', '👀 Xem', 'call')
          : btn('call', o.toCall >= S.me.chips ? `🔥 Theo all-in ${num(o.toCall)}` : `✅ Theo ${num(o.toCall)}`, 'call');
        html = `<div class="msg-main">👉 Lượt của bạn<small>${o.toCall ? `Cần ${num(o.toCall)} chip để theo · pot ${num(S.pot)}` : 'Chưa ai cược thêm — bạn có thể Xem hoặc Cược.'}</small></div>
          <div class="acts">${btn('fold', '🏳️ Bỏ bài', 'fold')}${call}${raise}</div>`;
      } else if (S.stage === 'waiting') {
        html = '<div class="msg-main">⏳ Đang chờ ít nhất 2 người có chip và đang kết nối…</div>';
      } else if (S.result) {
        html = `<div class="msg-main">🏆 Kết thúc ván bài ${S.handNo}<small>Ván bài mới sẽ bắt đầu sau vài giây…</small></div>`;
      } else if (S.stage === 'runout') {
        html = '<div class="msg-main">🔥 Không còn ai cược được — lật nốt các lá chung!</div>';
      } else if (S.turn) {
        html = `<div class="msg-main">⏳ Đang chờ <b>${esc(nm(S.turn))}</b>…</div>`;
      }
      if (S.me.canRebuy) {
        html = `<div class="msg-main">💸 Bạn đã hết chip<small>Nạp lại để vào bàn từ ván bài sau.</small></div>${btn('rebuy', `💵 Nạp lại ${num(S.config.chips)} chip`, 'primary')}`;
      } else if (!S.me.seated) {
        html = '<div class="msg-main">👀 Bạn đang xem<small>Bạn sẽ được xếp chỗ từ ván bài sau nếu bàn còn ghế (tối đa 9 người).</small></div>';
      }
      if (S.me.host) html += btn('stop', '🛑 Kết thúc ván', 'ghost small');
    }
    el.className = 'bar' + (mine ? ' myturn' : '');
    setHTML(el, html);
  }

  function renderHand() {
    const me = player(S.me.id);
    if (S.phase !== 'play' || !me || !me.inHand || !me.cards) { setHTML($('#hand'), ''); return; }
    const res = S.result;
    const hand = res && res.hands && res.hands[S.me.id];
    const best = hand && res.showdown ? new Set(hand.best) : null;
    const won = res && res.payouts && res.payouts[S.me.id];
    const html = `<div class="cards">${me.cards.map((c) => cardHTML(c, `big ${best ? (best.has(c) ? 'hi' : 'dim') : ''}`)).join('')}</div>
      <div class="info"><div class="hname">${me.folded ? '🏳️ Đã bỏ bài' : esc(S.myHand || '')}</div>
      <div class="mychips">🪙 ${num(me.chips)} chip${me.bet ? ` · đang cược ${num(me.bet)}` : ''}${me.allin ? ' · 🔥 ALL-IN' : ''}</div>
      ${won ? `<div class="mychips">🏆 Thắng ${num(won)} chip!</div>` : ''}</div>`;
    const el = $('#hand');
    el.classList.toggle('folded', !!me.folded);
    setHTML(el, html);
  }

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const inviteLink = () => `${ui.lanBase || location.origin}/g/poker/?room=${ROOM}`;

  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    const full = n >= S.maxPlayers;
    return `<div class="panel"><h3><span class="grow">🤖 Người chơi ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Không đủ người? Thêm bot — bot biết tính xác suất thắng, có đứa liều có đứa chặt, thỉnh thoảng còn bluff.</p>
      <div class="btns-row">
        ${btn('add-bot', '＋ 1 bot', 'small', full ? 'disabled' : '')}
        ${btn('fill-bots', `Lấp đủ ${Math.min(6, S.maxPlayers)} người`, 'small primary', n >= 6 ? 'disabled' : '')}
        ${bots ? btn('remove-bots', '🗑 Xoá hết bot', 'small ghost') : ''}
      </div></div>`;
  }

  function settingsPanel() {
    const dis = S.me.host ? '' : 'disabled';
    const sel = (key, label, fmt) => `<div class="setting"><label>${label}</label>
      <select data-cfg="${key}" ${dis}>${S.choices[key].map((v) => `<option value="${v}" ${v === S.config[key] ? 'selected' : ''}>${fmt(v)}</option>`).join('')}</select></div>`;
    return `<div class="panel"><h3>⚙️ Luật chơi</h3><div class="settings">
      ${sel('chips', '🪙 Chip khởi điểm', (v) => `${num(v)} chip`)}
      ${sel('big_blind', '🎯 Mù nhỏ / mù lớn', (v) => `${num(v / 2)} / ${num(v)}`)}
      ${sel('turn_time', '⏱ Thời gian mỗi lượt', (v) => (v ? `${v} giây` : 'Không giới hạn'))}
      ${sel('blind_up', '⬆️ Tăng mù gấp đôi', (v) => (v ? `Mỗi ${v} ván bài` : 'Không tăng'))}
    </div></div>`;
  }

  function renderPanel() {
    const el = $('#panel');
    if (S.phase === 'play') { setHTML(el, ''); return; }
    const host = S.me.host;
    let html = '';
    if (S.phase === 'end') {
      const board = [...S.players].sort((a, b) => b.chips - a.chips)
        .map((p, i) => `<div class="res-row ${p.id === S.winner ? 'win' : ''}"><span class="rank">${p.id === S.winner ? '🏆' : i + 1}</span>
          <span class="rname">${esc(p.name)}${p.bot ? ' 🤖' : ''}</span>
          <div class="rcards"><span class="gh-muted">🪙 ${num(p.chips)} chip${p.rebuys ? ` · nạp lại ${p.rebuys} lần` : ''}</span></div>
          <span class="rpts">${p.wins} ván thắng</span></div>`).join('');
      html += `<div class="panel">
        <div class="result-head"><div class="trophy">🏆</div><div>
          <h2>${esc(nm(S.winner))}${S.winner === S.me.id ? ' (bạn)' : ''} thắng ván ${S.round}!</h2>
          <p>Xếp hạng theo số chip cuối ván:</p></div></div>
        <div class="results">${board}</div>
        <div class="start-row" style="margin-top:14px">${host
          ? `${btn('lobby', '🏠 Về phòng chờ', 'ghost')}${btn('next', '▶ Ván mới', 'primary', S.startError ? 'disabled' : '')}`
          : '<span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu ván mới…</span>'}</div>
        ${host && S.startError ? `<p class="warn">⚠️ ${esc(S.startError)}</p>` : ''}</div>`;
      if (host) html += botPanel() + settingsPanel();
    } else {
      const start = host
        ? `<div class="start-row"><div>${S.startError ? `<span class="warn">⚠️ ${esc(S.startError)}</span>` : `<span class="gh-muted">${S.players.length}/${S.maxPlayers} người — sẵn sàng!</span>`}</div>
           ${btn('start', '🃏 Chia bài', 'primary', S.startError ? 'disabled' : '')}</div>`
        : '<div class="start-row"><span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu…</span></div>';
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
    if (!me && S.me.host && !(S.phase === 'play' && p.inHand && !p.folded)) {
      html += `<button class="gh-btn small danger" data-kick="${esc(id)}">${p.bot ? '🗑 Xoá bot' : '🚪 Mời ra khỏi phòng'}</button>`;
    }
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

  // Lá bài trong nhật ký được ghi dạng "As Td …" → hiển thị ký hiệu chất cho dễ đọc.
  const prettyCards = (text) => esc(text).replace(/\b([2-9TJQKA])([shdc])\b/g, (m, r, s) => `${r === 'T' ? '10' : r}${SUIT[s]}`);

  function renderLog() {
    const html = S.log.length
      ? S.log.map((l) => `<div class="log-item ${esc(l.kind)}"><span class="lt">${fmtTime(l.t)}</span>${prettyCards(l.text)}</div>`).join('')
      : '<div class="empty-note">Diễn biến các ván bài sẽ hiện ở đây.</div>';
    const list = $('#log-list');
    if (setHTML(list, html)) list.scrollTop = list.scrollHeight;
  }

  function renderRules() {
    const rows = [
      ['Thùng phá sảnh', '5 lá liên tiếp cùng chất', 'Ah Kh Qh Jh Th'],
      ['Tứ quý', '4 lá cùng hạng', '9s 9h 9d 9c Kd'],
      ['Cù lũ', 'Bộ ba + một đôi', 'Qs Qh Qd 5c 5s'],
      ['Thùng', '5 lá cùng chất', 'Ad Jd 8d 6d 2d'],
      ['Sảnh', '5 lá liên tiếp', '9c 8d 7s 6h 5c'],
      ['Sám cô', '3 lá cùng hạng', '7h 7d 7c Ks 2d'],
      ['Thú', 'Hai đôi', 'Js Jd 4h 4c As'],
      ['Đôi', 'Hai lá cùng hạng', 'Ts Th 8c 5d 2s'],
      ['Mậu thầu', 'Không có gì — tính lá cao nhất', 'Ac Jh 8s 4d 2c'],
    ];
    $('#rules').innerHTML = `<h4>📊 Thứ tự tay bài (mạnh → yếu)</h4><div class="hands">${rows.map(([n, d, cs]) => `
      <div class="hrow"><div class="cs">${cs.split(' ').map((c) => cardHTML(c, 'sm')).join('')}</div><div><b>${n}</b><span>${d}</span></div></div>`).join('')}</div>
      <h4>💡 Nhớ nhanh</h4><p>Tay bài = 5 lá tốt nhất từ 2 lá tẩy + 5 lá chung. Bằng nhau thì so lá phụ (kicker); vẫn bằng thì chia đều pot. Bấm ❓ trên thanh trên cùng để xem hướng dẫn đầy đủ.</p>`;
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
  function setRaise(v) {
    const o = S && S.options;
    if (!o) return;
    ui.raiseTo = Math.max(o.minTo, Math.min(o.maxTo, Math.round(Number(v) || o.minTo)));
    const range = $('#raise-range'); const box = $('#raise-num'); const label = $('#raise-label');
    if (range) range.value = ui.raiseTo;
    if (box && document.activeElement !== box) box.value = ui.raiseTo;
    if (label) label.textContent = num(ui.raiseTo);
  }

  document.addEventListener('input', (e) => {
    if (e.target.id === 'raise-range') setRaise(e.target.value);
    else if (e.target.id === 'raise-num') {
      const o = S.options;
      const v = Number(e.target.value);
      if (o && v >= o.minTo && v <= o.maxTo) setRaise(v);
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'raise-num') { setRaise(e.target.value); e.target.value = ui.raiseTo; return; }
    const el = e.target.closest('[data-cfg]');
    if (el) send('config', { [el.dataset.cfg]: Number(el.value) });
  });

  document.addEventListener('click', async (e) => {
    const pre = e.target.closest('[data-preset]');
    if (pre) { setRaise(pre.dataset.preset); return; }

    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled && actEl.dataset.act) {
      switch (actEl.dataset.act) {
        case 'fold':
          if (S.options && S.options.canCheck) {
            P.modal({
              title: 'Bỏ bài?', body: '<p>Bạn có thể <b>Xem</b> miễn phí mà không cần bỏ bài. Vẫn muốn bỏ?</p>',
              actions: [{ label: 'Không', kind: 'ghost' }, { label: 'Bỏ bài', kind: 'danger', onClick: () => send('move', { move: 'fold' }) }],
            });
          } else send('move', { move: 'fold' });
          break;
        case 'check': send('move', { move: 'check' }); break;
        case 'call': send('move', { move: 'call' }); break;
        case 'raise': send('move', { move: 'raise', to: ui.raiseTo }); break;
        case 'allin': send('move', { move: 'allin' }); break;
        case 'rebuy': send('rebuy'); break;
        case 'stop':
          P.modal({
            title: 'Kết thúc ván?', body: '<p>Tiền đang cược của ván bài dở dang sẽ được trả lại, rồi xếp hạng theo số chip.</p>',
            actions: [{ label: 'Chơi tiếp', kind: 'ghost' }, { label: '🛑 Kết thúc', kind: 'danger', onClick: () => send('stop') }],
          });
          break;
        case 'start': send('start'); break;
        case 'next': send('next_round'); break;
        case 'lobby': send('lobby'); break;
        case 'edit-look': openLookEditor(); break;
        case 'add-bot': send('add_bot', { count: 1 }); break;
        case 'fill-bots': send('add_bot', { count: Math.max(1, 6 - S.players.length) }); break;
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
    try { localStorage.setItem('poker_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) beep(SOUNDS.chip);
  });

  $('#btn-room').addEventListener('click', async () => {
    if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good');
  });

  $('#btn-leave').addEventListener('click', () => {
    const doLeave = () => { if (conn) conn.leave(); setTimeout(() => { location.href = '/'; }, 150); };
    const me = S && player(S.me.id);
    if (S && S.phase === 'play' && me && me.inHand && !me.folded) {
      P.modal({
        title: 'Rời sòng?',
        body: '<p>Bạn đang trong một ván bài — khi vắng mặt, máy sẽ tự Xem hoặc Bỏ bài hộ bạn. Vào lại phòng với <b>đúng tên cũ</b> để chơi tiếp với số chip hiện có.</p>',
        actions: [{ label: 'Ở lại', kind: 'ghost' }, { label: 'Rời phòng', kind: 'danger', onClick: doLeave }],
      });
    } else doLeave();
  });

  // Nếu mở bằng localhost thì link mời dùng địa chỉ LAN để bạn bè vào được.
  fetch('/api/info').then((r) => r.json()).then((inf) => {
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    const lan = location.protocol === 'https:' ? inf.https : inf.urls;
    if (local && lan && lan.length) { ui.lanBase = lan[0]; render(); }
  }).catch(() => {});

  renderRules();
  $('#room-code').textContent = ROOM;
  P.ensureName(() => connect());
})();
