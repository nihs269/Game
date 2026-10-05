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
  let clockOffset = 0;
  const ui = {
    lastSeq: null, handIds: new Set(), fresh: new Set(), selected: new Set(), selKey: '', wasMyTurn: false,
    tab: 'chat', unread: 0, lastChatId: null, lanBase: null, speaking: new Set(), sound: true,
  };
  try { ui.sound = localStorage.getItem('liar_sound') !== '0'; } catch (e) { /* bỏ qua */ }

  const PIC = { Q: '👸', K: '🤴', A: '♠️', J: '🃏' };
  const SHORT = { Q: 'Đầm', K: 'Già', A: 'Xì', J: 'Joker' };
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
  const who = (id) => (S && id === S.me.id ? 'Bạn' : esc(nm(id)));
  const send = (action, data) => conn && conn.send(action, data);
  const fmtTime = (t) => new Date(t * 1000).toTimeString().slice(0, 5);
  const myTurn = () => S && S.phase === 'play' && S.stage === 'turn' && S.turn === S.me.id;
  const btn = (act, text, kind = '', extra = '') => `<button class="gh-btn ${kind}" data-act="${act}" ${extra}>${text}</button>`;
  const isValid = (c) => S && (c.r === S.table || c.r === 'J');

  function cardHTML(c, { cls = '' } = {}) {
    const rk = c.r === 'J' ? '★' : c.r;
    return `<div class="card r-${c.r} ${cls}" data-card="${c.id}">
      <span class="rk tl">${rk}</span><span class="pic">${PIC[c.r]}</span><span class="rk br">${rk}</span><span class="nm">${SHORT[c.r]}</span></div>`;
  }
  const backHTML = (cls = '') => `<div class="card back ${cls}"><span class="pic">🍺</span></div>`;

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
    play: [[300, 0.06, 'triangle', 0.06]],
    turn: [[660, 0.12], [880, 0.18]],
    liar: [[500, 0.1, 'square', 0.05], [350, 0.2, 'square', 0.05]],
    click: [[1800, 0.03, 'square', 0.06], [900, 0.05, 'square', 0.04]],
    bang: [[90, 0.5, 'sawtooth', 0.2], [45, 0.6, 'sawtooth', 0.15]],
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
    const selKey = `${state.round}:${state.handNo}:${state.turn}`;
    if (selKey !== ui.selKey || !myTurn()) { ui.selKey = selKey; ui.selected.clear(); }

    const mine = myTurn() || (state.stage === 'roulette' && state.reveal && state.reveal.shooter === state.me.id);
    if (mine && !ui.wasMyTurn && !first) { beep(SOUNDS.turn); if (navigator.vibrate) navigator.vibrate(120); }
    ui.wasMyTurn = mine;

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

  function playEvent(e) {
    switch (e.type) {
      case 'deal': beep(SOUNDS.play); break;
      case 'play':
        for (let i = 0; i < e.n; i++) fly(backHTML('mid'), seatRect(e.pid), rectOf('#center .pile .stackwrap'), { dur: 380, delay: i * 110 });
        bubble(e.pid, `${e.n} lá ${S.table || ''}`, '');
        beep(SOUNDS.play);
        break;
      case 'call': bubble(e.pid, '🤥 LIAR!', 'big'); beep(SOUNDS.liar); break;
      case 'shot':
        if (e.dead) {
          bubble(e.pid, '💥 ĐOÀNG!', 'big');
          const f = document.createElement('div');
          f.className = 'flash';
          document.body.appendChild(f);
          setTimeout(() => f.remove(), 600);
          document.body.classList.remove('boom'); void document.body.offsetWidth; document.body.classList.add('boom');
          beep(SOUNDS.bang);
        } else {
          bubble(e.pid, '😮‍💨 Cạch…', '');
          beep(SOUNDS.click);
        }
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
    const label = S.phase === 'lobby' ? '🏠 Phòng chờ' : S.phase === 'end' ? `🏁 Hết ván ${S.round}` : `🍺 Ván ${S.round} · lượt bài ${S.handNo}`;
    $('#phase-pill').textContent = label;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    const alert = myTurn() || (S.stage === 'roulette' && S.reveal && S.reveal.shooter === S.me.id);
    document.title = `${alert ? '🔔 ' : ''}Liar's Bar ${ROOM}`;
  }

  function gunHTML() {
    const r = S.reveal;
    const shooter = r.shooter;
    const p = player(shooter);
    const shots = p ? p.shots : 0;
    const dots = Array.from({ length: S.chambers }, (_, i) => `<i class="${i < shots ? 'used' : ''}"></i>`).join('');
    if (S.stage === 'shot' && S.shot) {
      const dead = S.shot.dead;
      return `<div class="gun bang"><div class="big">🔫</div>
        <div class="result ${dead ? 'dead' : 'safe'}">${dead ? '💥 ĐOÀNG!' : '😮‍💨 Cạch… ổ trống!'}</div>
        <div class="who">${who(shooter)} ${dead ? 'đã gục xuống' : 'sống sót'}</div><div class="chambers">${dots}</div></div>`;
    }
    const left = S.chambers - shots;
    return `<div class="gun aim"><div class="big">🔫</div>
      <div class="who">${who(shooter)} ${shooter === S.me.id ? 'phải' : 'đang'} kề súng vào đầu…</div>
      <div class="chambers">${dots}</div>
      <div class="odds">Đã bắn ${shots}/${S.chambers} ổ · khả năng trúng đạn: 1/${left} (${Math.round(100 / left)}%)</div></div>`;
  }

  function renderTable() {
    // --- giữa bàn
    let center;
    const r = S.reveal;
    if (S.phase === 'play' && (S.stage === 'roulette' || S.stage === 'shot') && r) {
      center = gunHTML();
    } else if (S.phase === 'play' && S.stage === 'reveal' && r) {
      center = `<div class="row"><div class="revealed">${r.cards.map((c) => cardHTML(c, { cls: `flip ${isValid(c) ? 'truth' : 'lie'}` })).join('')}</div></div>
        <div class="verdict ${r.liar ? 'lie' : 'truth'}">${r.liar ? `🤥 ${who(r.pid)} NÓI DỐI!` : `😇 ${who(r.pid)} NÓI THẬT!`}</div>
        <div class="claim">${who(r.caller)} hô LIAR! với ${who(r.pid)} · lá của bàn: ${S.table}</div>`;
    } else if (S.phase === 'play' && S.table) {
      const stack = Math.min(S.pileCount, 3);
      const lp = S.lastPlay;
      center = `<div class="row">
          <div class="table-card"><div class="lbl">Lá của bàn</div>${cardHTML({ id: 't', r: S.table })}</div>
          <div class="pile"><div class="lbl">Bài đã úp</div><div class="stackwrap">${stack
            ? Array.from({ length: stack }, (_, i) => `<div style="position:absolute;transform:translate(${i * 3}px,${-i * 3}px) rotate(${(i - 1) * 6}deg)">${backHTML()}</div>`).join('')
            : '<div class="card back" style="opacity:.2"></div>'}</div><div class="cnt">${S.pileCount} lá</div></div></div>
        <div class="claim">${lp ? `${who(lp.pid)} khai: ${lp.count} lá ${S.table}` : 'Chưa ai úp bài'}</div>`;
    } else {
      center = `<div class="row">${backHTML()}</div>`;
    }
    setHTML($('#center'), center);

    // --- ghế ngồi: mình ở dưới cùng, xếp theo thứ tự lượt
    const seated = S.players.filter((p) => p.playing);
    const n = seated.length;
    const meIdx = Math.max(0, seated.findIndex((p) => p.id === S.me.id));
    const inGame = S.phase === 'play' || S.phase === 'end';
    const shooter = S.phase === 'play' && r && S.stage !== 'reveal' ? r.shooter : null;
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
      const dead = inGame && p.playing && !p.alive;
      const fanN = Math.min(p.count, 5);
      const fan = S.phase === 'play' && p.id !== S.me.id && fanN && !dead
        ? `<div class="fan">${Array.from({ length: fanN }, (_, j) => `<i style="transform:rotate(${(j - (fanN - 1) / 2) * 12}deg)"></i>`).join('')}</div>` : '';
      const tags = [];
      if (p.bot) tags.push('<span class="tag">🤖</span>');
      if (p.host) tags.push('<span class="tag">👑</span>');
      if (dead) tags.push('<span class="tag">💀</span>');
      if (S.phase === 'end' && S.winner === p.id) tags.push('<span class="tag win">🏆</span>');
      if (inGame && p.playing) tags.push(`<span class="gunchip ${p.shots >= 4 ? 'hot' : ''}" title="Số ổ đã bắn">🔫 ${p.shots}/${S.chambers}</span>`);
      const count = S.phase === 'play' && p.alive && p.playing ? `<span class="count">${p.count}</span>` : '';
      const cls = ['seat', turn ? 'turn' : '', p.id === S.me.id ? 'me' : '', p.connected ? '' : 'off',
        p.playing ? '' : 'watch', dead ? 'dead' : '', shooter === p.id ? 'shooter' : '',
        ui.speaking.has(p.id) ? 'speaking' : ''].join(' ');
      const ring = turn && S.deadline
        ? '<svg class="ring" viewBox="0 0 72 72"><circle cx="36" cy="36" r="33" stroke-dasharray="207.3" stroke-dashoffset="0"/></svg>' : '';
      return `<div class="${cls}" data-pid="${esc(p.id)}" style="left:${x}%;top:${y}%">
        ${fan}<div class="avabox"><div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>${ring}</div>
        <div class="name">${p.id === S.me.id ? 'Bạn' : esc(p.name)}</div>
        <div class="meta">${count}${tags.join('')}${p.score ? `<span>🏆${p.score}</span>` : ''}</div></div>`;
    }).join('');
    setHTML($('#seats'), html);
  }

  function renderBar() {
    const el = $('#bar');
    let html = '';
    let mine = false;
    const r = S.reveal;
    if (S.phase === 'play') {
      const tbl = `<b>${S.table}</b>`;
      if (S.stage === 'reveal' && r) {
        html = `<div class="msg-main">🤥 ${who(r.caller)} hô LIAR! — lật bài của ${who(r.pid)}…
          <small>${r.liar ? `Có lá không phải ${S.table}/Joker → ${who(r.pid)} phải chơi cò quay.` : `Toàn lá ${S.table}/Joker → ${who(r.caller)} bắt oan, phải chơi cò quay!`}</small></div>`;
      } else if (S.stage === 'roulette' && r) {
        if (r.shooter === S.me.id) {
          mine = true;
          html = `<div class="msg-main">😰 Đến lượt bạn bóp cò…<small>Hết giờ sẽ tự bóp. Cầu trời đi!</small></div>${btn('trigger', '🔫 Bóp cò', 'trigger')}`;
        } else {
          html = `<div class="msg-main">😬 ${who(r.shooter)} đang kề súng vào đầu…</div>`;
        }
      } else if (S.stage === 'shot' && S.shot) {
        html = `<div class="msg-main">${S.shot.dead ? `💥 ${who(S.shot.pid)} đã bị loại!` : `😮‍💨 ${who(S.shot.pid)} thoát chết!`}<small>Chuẩn bị chia bài lượt mới…</small></div>`;
      } else if (!S.me.playing) {
        html = '<div class="msg-main">👀 Bạn đang xem ván này<small>Ván sau bạn sẽ được vào bàn.</small></div>';
      } else if (!S.me.alive) {
        html = '<div class="msg-main">💀 Bạn đã bị loại<small>Ngồi xem những kẻ nói dối còn lại đấu tiếp nhé.</small></div>';
      } else if (myTurn()) {
        mine = true;
        const lp = S.lastPlay;
        const liarBtn = S.canCall ? btn('call', `🤥 LIAR!${lp ? ` (${lp.count} lá của ${esc(nm(lp.pid))})` : ''}`, 'liar' + (S.mustCall ? ' urgent' : '')) : '';
        if (S.mustCall) {
          html = `<div class="msg-main">🃏 Bạn đã hết bài!<small>Bắt buộc phải lật bài của ${who(lp.pid)}.</small></div>${liarBtn}`;
        } else {
          const n = ui.selected.size;
          const sub = lp
            ? `${who(lp.pid)} vừa khai ${lp.count} lá ${S.table}. Tin thì úp bài tiếp, không tin thì hô LIAR!`
            : 'Bạn mở màn lượt bài này.';
          html = `<div class="msg-main">👉 Lượt của bạn — úp 1–3 lá và khai là lá ${tbl}<small>${sub} Lá có dấu ✓ là hàng thật (${S.table} hoặc Joker).</small></div>
            ${btn('play', n ? `🂠 Úp ${n} lá (khai ${n} lá ${S.table})` : '🂠 Chọn lá để úp', 'primary', n ? '' : 'disabled')}${liarBtn}`;
        }
      } else {
        const lp = S.lastPlay;
        html = `<div class="msg-main">⏳ Đang chờ <b>${esc(nm(S.turn))}</b>…${lp ? `<small>${who(lp.pid)} vừa khai ${lp.count} lá ${S.table}.</small>` : ''}</div>`;
      }
    }
    el.className = 'bar' + (mine ? ' myturn' : '');
    setHTML(el, html);
  }

  function renderHand() {
    const el = $('#hand');
    if (S.phase !== 'play' || !S.hand) { setHTML(el, ''); return; }
    const active = myTurn() && !S.mustCall;
    const html = `<div class="hand-row">${S.hand.map((c) => {
      const cls = [isValid(c) ? 'valid' : '', ui.fresh.has(c.id) ? 'fresh' : ''].join(' ');
      return cardHTML(c, { cls });
    }).join('')}</div><div class="hand-label">${S.hand.length
      ? `Bài của bạn: <b>${S.hand.length} lá</b> · ✓ = lá ${S.table} hoặc Joker (hàng thật)${active ? ' · chạm để chọn tối đa 3 lá' : ''}`
      : 'Bạn đã hết bài.'}</div>`;
    el.classList.toggle('active', active);
    if (setHTML(el, html)) fitHand();
    // Lá đang chọn chỉ bật/tắt class trên phần tử có sẵn (không vẽ lại) để lá trượt lên/xuống mượt.
    el.querySelectorAll('.hand-row .card').forEach((card) => {
      card.classList.toggle('sel', ui.selected.has(Number(card.dataset.card)));
    });
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
    overlap = Math.max(-cw * 0.5, Math.min(10, overlap));
    el.style.setProperty('--overlap', overlap + 'px');
  }
  window.addEventListener('resize', () => { if (S) fitHand(); });

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const fmtSec = (s) => (s ? `${s} giây` : 'Không giới hạn');
  const inviteLink = () => `${ui.lanBase || location.origin}/g/liarbar/?room=${ROOM}`;

  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    const full = n >= S.maxPlayers;
    return `<div class="panel"><h3><span class="grow">🤖 Người chơi ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Không đủ người? Thêm bot để test — bot biết đếm bài để đoán ai nói dối, lúc thật lúc bịp.</p>
      <div class="btns-row">
        ${btn('add-bot', '＋ 1 bot', 'small', full ? 'disabled' : '')}
        ${btn('fill-bots', `Lấp đủ ${S.maxPlayers} người`, 'small primary', full ? 'disabled' : '')}
        ${bots ? btn('remove-bots', '🗑 Xoá hết bot', 'small ghost') : ''}
      </div></div>`;
  }

  function settingsPanel() {
    const dis = S.me.host ? '' : 'disabled';
    return `<div class="panel"><h3>⚙️ Luật chơi</h3><div class="settings">
      <div class="setting"><label>⏱ Thời gian mỗi lượt (hết giờ tự úp 1 lá)</label>
        <select data-cfg="turn_time" ${dis}>${S.turnTimes.map((t) => `<option value="${t}" ${t === S.config.turn_time ? 'selected' : ''}>${fmtSec(t)}</option>`).join('')}</select></div>
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
          <div class="rcards"><span class="gh-muted">${p.playing ? (p.alive ? `sống sót · 🔫 ${p.shots}/${S.chambers}` : '💀 bị loại') : 'chưa vào bàn'}</span></div>
          <span class="rpts">${p.score} ván thắng</span></div>`).join('');
      html += `<div class="panel">
        <div class="result-head"><div class="trophy">🏆</div><div>
          <h2>${esc(nm(S.winner))}${S.winner === S.me.id ? ' (bạn)' : ''} là người cuối cùng còn sống!</h2>
          <p>Ván ${S.round} kết thúc. Bảng xếp hạng theo số ván thắng:</p></div></div>
        <div class="results">${board}</div>
        <div class="start-row" style="margin-top:14px">${host
          ? `${btn('lobby', '🏠 Về phòng chờ (xoá điểm)', 'ghost')}${btn('next', '▶ Ván tiếp theo', 'primary', S.startError ? 'disabled' : '')}`
          : '<span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu ván tiếp theo…</span>'}</div>
        ${host && S.startError ? `<p class="warn">⚠️ ${esc(S.startError)}</p>` : ''}</div>`;
      if (host) html += botPanel() + settingsPanel();
    } else {
      const start = host
        ? `<div class="start-row"><div>${S.startError ? `<span class="warn">⚠️ ${esc(S.startError)}</span>` : `<span class="gh-muted">${S.players.length}/${S.maxPlayers} người — sẵn sàng!</span>`}</div>
           ${btn('start', '🎬 Vào bàn', 'primary', S.startError ? 'disabled' : '')}</div>`
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
    if (!window.GameVoice || !window.GameVoice.supported) { P.toast('Trình duyệt này không hỗ trợ voice chat.', 'error'); return; }
    if (!voice) {
      voice = new window.GameVoice({
        sendRaw: (m) => conn && conn.sendRaw(m),
        onChange: () => renderVoice(),
        onSpeaking: (pid, on) => { if (on) ui.speaking.add(pid); else ui.speaking.delete(pid); if (S) renderTable(); },
      });
    }
    await voice.enable();
    if (S) voice.update(S.me.id, voiceInfo);
    if (voice.error) P.toast('Không dùng được mic — hiện chỉ nghe được.', 'error', 5000);
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
    const html = S.log.length
      ? S.log.map((l) => `<div class="log-item ${esc(l.kind)}"><span class="lt">${fmtTime(l.t)}</span>${esc(l.text)}</div>`).join('')
      : '<div class="empty-note">Diễn biến ván đấu sẽ hiện ở đây.</div>';
    const list = $('#log-list');
    if (setHTML(list, html)) list.scrollTop = list.scrollHeight;
  }

  function renderRules() {
    const c = (r) => cardHTML({ id: r, r }, { cls: 'mini' });
    $('#rules').innerHTML = `
      <h4>🎯 Mục tiêu</h4><p>Là người cuối cùng còn sống trong quán bar.</p>
      <h4>🃏 Bộ bài</h4><div class="row">${c('Q')}${c('K')}${c('A')}${c('J')}<p>20 lá: 6 Q, 6 K, 6 A và 2 Joker. Mỗi lượt bài chia mỗi người 5 lá.</p></div>
      <h4>🍺 Lá của bàn</h4><p>Đầu mỗi lượt bài, máy chọn ngẫu nhiên Q, K hoặc A làm “lá của bàn”. <b>Joker</b> thay được mọi lá.</p>
      <h4>🂠 Đến lượt</h4><p>Úp 1–3 lá và khai rằng tất cả đều là lá của bàn — thật hay bịp tuỳ bạn. Người kế tiếp chọn:</p>
      <ul><li><b>Tin</b>: úp bài của mình tiếp.</li><li><b>Không tin</b>: hô <b>LIAR!</b> để lật bài người vừa đánh.</li></ul>
      <h4>🤥 Lật bài</h4><p>Có lá nào không phải lá của bàn (hay Joker) → người vừa đánh <b>nói dối</b>, phải chơi cò quay. Toàn hàng thật → người hô LIAR <b>bắt oan</b>, tự mình chơi cò quay.</p>
      <h4>🔫 Cò quay Nga</h4><p>Mỗi người có một khẩu súng 6 ổ với 1 viên đạn ở vị trí ngẫu nhiên. Mỗi lần bóp cò lại gần viên đạn hơn (1/6 → 1/5 → … → chắc chắn nổ). Trúng đạn là bị loại.</p>
      <h4>🔁 Lượt bài mới</h4><p>Sau mỗi lần bóp cò, bài được chia lại với lá của bàn mới. Người vừa bóp cò (nếu còn sống) đi trước. Ai hết bài thì bỏ qua; nếu chỉ còn người hết bài để đáp lại, người đó buộc phải lật bài.</p>`;
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
      if (!myTurn() || S.mustCall) { if (S.phase === 'play' && S.stage === 'turn') P.toast(S.mustCall ? 'Bạn đã hết bài — hãy hô LIAR!' : 'Chưa đến lượt của bạn.'); return; }
      const id = Number(cardEl.dataset.card);
      if (ui.selected.has(id)) ui.selected.delete(id);
      else if (ui.selected.size >= 3) P.toast('Chỉ úp tối đa 3 lá mỗi lượt.', 'error');
      else ui.selected.add(id);
      render();
      return;
    }

    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled && actEl.dataset.act) {
      switch (actEl.dataset.act) {
        case 'play': send('play', { cards: [...ui.selected] }); break;
        case 'call': send('call'); break;
        case 'trigger': send('trigger'); break;
        case 'start': send('start'); break;
        case 'next': send('next_round'); break;
        case 'lobby': send('lobby'); break;
        case 'edit-look': openLookEditor(); break;
        case 'voice-on': startVoice(); break;
        case 'voice-off': if (voice) voice.disable(); break;
        case 'voice-mute': if (voice) voice.setMuted(!voice.muted); break;
        case 'voice-deaf': if (voice) voice.setDeaf(!voice.deaf); break;
        case 'add-bot': send('add_bot', { count: 1 }); break;
        case 'fill-bots': send('add_bot', { count: S.maxPlayers - S.players.length }); break;
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
    if (el) send('config', { [el.dataset.cfg]: Number(el.value) });
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
    try { localStorage.setItem('liar_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
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
        body: '<p>Ván đang diễn ra — khi bạn vắng mặt, máy sẽ tự úp bài và bóp cò hộ. Bạn có thể quay lại bằng cách vào lại phòng với <b>đúng tên cũ</b>.</p>',
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
    const lan = location.protocol === 'https:' ? inf.https : inf.urls;
    if (local && lan && lan.length) { ui.lanBase = lan[0]; render(); }
  }).catch(() => {});

  renderRules();
  $('#room-code').textContent = ROOM;
  P.ensureName(() => connect());
})();
