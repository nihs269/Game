(function () {
  const P = window.Platform;
  const $ = (s) => document.querySelector(s);
  const esc = P.esc;
  const ROOM = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (!ROOM) { location.href = '/'; return; }

  let S = null;          // trạng thái mới nhất từ máy chủ
  let conn = null;
  let clockOffset = 0;
  const ui = { lastSeq: null, tab: 'players', unread: 0, lastChatId: null, lanBase: null, sound: true, hideWord: false, draft: '', wasMine: false };
  try {
    ui.sound = localStorage.getItem('giandiep_sound') !== '0';
    ui.hideWord = localStorage.getItem('giandiep_hide') === '1';
  } catch (e) { /* bỏ qua */ }

  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
  };
  const ROLE = {
    civ: { name: 'Dân', icon: '🙂', cls: 'role-civ' },
    spy: { name: 'Gián điệp', icon: '🕵️', cls: 'role-spy' },
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
  const fmtTime = (t) => new Date(t * 1000).toTimeString().slice(0, 5);
  const btn = (act, text, kind = '', extra = '') => `<button class="gh-btn ${kind}" data-act="${act}" ${extra}>${text}</button>`;
  const colorOf = (id) => { const p = player(id); return (p && p.color) || '#8892b0'; };
  const mini = (p) => `<div class="mini" style="--pc:${p.color || '#888'}">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>`;
  const myTurn = () => !!(S && S.phase === 'play' && S.stage === 'describe' && S.speaker === S.me.id);
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
    turn: () => [[660, 0.12], [880, 0.18]],
    said: () => [[600, 0.06, 'triangle', 0.05]],
    vote: () => [[330, 0.15, 'triangle'], [392, 0.15, 'triangle'], [494, 0.2, 'triangle']],
    spy: () => [[300, 0.15, 'sawtooth', 0.05], [450, 0.3, 'sawtooth', 0.05]],
    civ: () => [[392, 0.2, 'triangle'], [311, 0.3, 'triangle']],
    tie: () => [[440, 0.1], [440, 0.1]],
    win: () => [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]],
    lose: () => [[392, 0.2, 'triangle'], [330, 0.2, 'triangle'], [262, 0.4, 'triangle']],
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
    S = state;
    clockOffset = state.now - Date.now() / 1000;
    const events = state.events || [];
    let fresh = [];
    if (ui.lastSeq === null) ui.lastSeq = events.length ? events[events.length - 1].seq : 0;
    else fresh = events.filter((e) => e.seq > ui.lastSeq);
    if (events.length) ui.lastSeq = Math.max(ui.lastSeq, events[events.length - 1].seq);
    const mine = myTurn();
    if (mine && !ui.wasMine && !first) { play('turn'); if (navigator.vibrate) navigator.vibrate(100); }
    if (!mine) ui.draft = '';
    render();
    if (mine && !ui.wasMine) setTimeout(() => { const i = $('#say-input'); if (i) i.focus(); }, 30);
    ui.wasMine = mine;
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
    setTimeout(() => el.remove(), 2600);
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
      case 'said': play('said'); if (e.pid) bubble(e.pid, e.text || '…'); break;
      case 'vote': play('vote'); break;
      case 'out': play(e.role === 'civ' ? 'civ' : 'spy'); bubble(e.pid, ROLE[e.role].icon, 'emoji'); if (cast) cast.react(e.pid, 'sad'); break;
      case 'guessed': bubble(e.pid, e.ok ? '🎯' : '❌', 'emoji'); break;
      case 'tie': play('tie'); break;
      case 'win': {
        const me = player(S.me.id);
        const mineTeam = me && me.role;
        const won = mineTeam && mineTeam === e.team;
        play(S.me.playing ? (won ? 'win' : 'lose') : 'win');
        break;
      }
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

  // ---------------------------------------------------------------- khu chơi
  function renderSecret() {
    const el = $('#secret');
    if (S.phase !== 'play' || !S.me.playing) { setHTML(el, ''); el.className = 'secret'; return; }
    el.className = 'secret';
    setHTML(el, `<div class="ic">🔑</div><div class="grow"><div class="lbl">Từ khoá của bạn</div>
      <div class="kw ${ui.hideWord ? 'hidden' : ''}">${esc(S.me.word || '')}</div>
      <div class="tip">Bạn là dân hay gián điệp? Nghe kỹ xem từ của người khác có giống từ của bạn không.</div></div>
      ${btn('toggle-word', ui.hideWord ? '👁 Hiện' : '🙈 Che', 'small ghost')}`);
  }

  function renderStage() {
    const el = $('#stagebox');
    if (S.phase !== 'play') { setHTML(el, ''); return; }
    let html = '';
    if (S.stage === 'describe') {
      const sp = player(S.speaker);
      if (myTurn()) {
        html = `<h3>🗣️ Đến lượt bạn mô tả!</h3><div class="sub">Một câu ngắn về từ khoá — <b>không nói thẳng từ khoá</b>.</div>
          <form class="say-form" id="say-form" autocomplete="off"><input id="say-input" maxlength="60" placeholder="VD: thường uống buổi sáng…" value="${esc(ui.draft)}" autocomplete="off">
          <button class="gh-btn gold" type="submit">Nói ➜</button></form>`;
      } else if (sp) {
        html = `<div class="speaking">${mini(sp)}<span>${who(sp.id)} đang mô tả<span class="dots"></span></span></div>
          <div class="sub">Vòng ${S.round} · lượt ${S.speakers.indexOf(S.speaker) + 1}/${S.speakers.length}</div>`;
      }
    } else if (S.stage === 'vote') {
      const alive = S.players.filter((p) => p.playing && p.alive);
      const canVote = S.me.playing && alive.some((p) => p.id === S.me.id);
      const voted = alive.filter((p) => p.voted).length;
      html = `<h3>🗳️ Bỏ phiếu — ai là gián điệp?</h3>
        <div class="sub">${canVote ? 'Chọn người đáng ngờ nhất (đổi ý được tới khi hết giờ) · trò chuyện ở tab 💬 để tranh luận.' : 'Bạn không còn quyền bỏ phiếu.'} Đã bỏ phiếu: <b>${voted}/${alive.length}</b></div>
        <div class="vote-grid">${alive.map((p) => {
          const meCard = p.id === S.me.id;
          const clues = p.clues.filter(Boolean).slice(-2).map((c) => `“${esc(c)}”`).join('<br>') || '<i>(chưa nói gì)</i>';
          return `<button class="vcard ${meCard ? 'me' : ''} ${S.me.vote === p.id ? 'picked' : ''}" data-vote="${esc(p.id)}" ${!canVote || meCard ? 'disabled' : ''}>
            ${mini(p)}<b>${who(p.id)}</b><span class="cl">${clues}</span>${p.voted ? '<span class="tag">✓ đã bỏ phiếu</span>' : ''}</button>`;
        }).join('')}</div>`;
    } else if ((S.stage === 'result' || S.stage === 'guess') && S.last) {
      const L = S.last;
      const tally = Object.entries(L.tally).sort((a, b) => b[1] - a[1])
        .map(([pid, n]) => `<span style="--pc:${colorOf(pid)}">${who(pid)}: <b>${n}</b> phiếu</span>`).join('');
      if (L.out) {
        const p = player(L.out);
        const r = ROLE[L.role];
        html = `<div class="outcard">${mini(p)}<div><b>${who(L.out)}</b> bị loại — là</div><div class="role ${r.cls}">${r.icon} ${r.name.toUpperCase()}</div></div>`;
        if (S.stage === 'guess' && S.guess) {
          html += S.guess.pid === S.me.id
            ? `<div class="sub">Bạn bị lộ! Còn một cơ hội: đoán đúng <b>từ của dân</b> là bạn <b>thắng</b>, sai là thua.</div>
               <form class="say-form" id="guess-form" autocomplete="off"><input id="guess-input" maxlength="40" placeholder="Từ của dân là…" autocomplete="off">
               <button class="gh-btn gold" type="submit">Đoán</button></form>`
            : `<div class="sub">Gián điệp ${who(S.guess.pid)} đang đoán từ của dân — đúng là gián điệp lật kèo<span class="dots"></span></div>`;
        }
      } else {
        html = '<h3>🤝 Hoà phiếu — không ai bị loại</h3>';
      }
      html += `<div class="tally">${tally || '<span style="--pc:#888">Không ai bỏ phiếu</span>'}</div>`;
    }
    const input = $('#say-input');
    const hadFocus = input && document.activeElement === input;
    if (setHTML(el, html) && hadFocus) { const i = $('#say-input'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }

  function renderBoard() {
    const el = $('#board');
    if (S.phase === 'lobby') { setHTML(el, ''); return; }
    const ps = S.players.filter((p) => p.playing);
    const rounds = Math.max(1, S.round);
    const rows = ps.map((p) => {
      const cells = Array.from({ length: rounds }, (_, i) => {
        const c = p.clues[i];
        return `<td>${c ? esc(c) : (i < p.clues.length ? '<span class="silent">(im lặng)</span>' : '')}</td>`;
      }).join('');
      const role = p.role ? `<span class="rtag ${ROLE[p.role].cls}">${ROLE[p.role].icon} ${ROLE[p.role].name}</span>` : '';
      const word = p.word !== undefined && p.word !== null && S.phase === 'end' ? ` <small style="color:var(--muted)">· ${esc(p.word)}</small>` : '';
      return `<tr class="${S.speaker === p.id ? 'now' : ''} ${p.alive ? '' : 'dead'}" style="--pc:${p.color}"><td>${who(p.id)}${role}${word}</td>${cells}</tr>`;
    }).join('');
    setHTML(el, `<table><thead><tr><th>Người chơi</th>${Array.from({ length: rounds }, (_, i) => `<th>Vòng ${i + 1}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`);
  }

  // ---------------------------------------------------------------- banner, nhân vật, danh sách
  function renderBanner() {
    const el = $('#banner');
    let big = '🕵️';
    let title = '';
    let sub = '';
    let cls = 'gbanner';
    if (S.phase === 'lobby') {
      title = 'Phòng chờ';
      sub = `${S.players.length}/${S.maxPlayers} người · ${S.me.host ? 'bạn là chủ phòng — chỉnh luật rồi bấm Bắt đầu bên dưới' : 'đang chờ chủ phòng bắt đầu…'} · nên chơi từ 4 người`;
    } else if (S.phase === 'end') {
      const t = S.winnerTeam;
      big = t === 'civ' ? '🙂' : t === 'spy' ? '🕵️' : '🏁';
      cls += ' win';
      title = t === 'civ' ? 'Dân thắng!' : t === 'spy' ? 'Gián điệp thắng!' : 'Ván dừng';
      sub = esc(S.winReason || '');
    } else {
      sub = `Vòng ${S.round} · còn ${S.aliveCount} người, trong đó có 1 gián điệp`;
      if (S.stage === 'describe') { big = '🗣️'; title = myTurn() ? 'Đến lượt bạn mô tả!' : `${who(S.speaker)} đang mô tả…`; if (myTurn()) cls += ' mine'; }
      else if (S.stage === 'vote') { big = '🗳️'; title = 'Bỏ phiếu loại người đáng ngờ'; cls += ' mine'; }
      else if (S.stage === 'guess') { big = '🎯'; title = 'Gián điệp bị lộ — được đoán từ của dân!'; }
      else { big = '📢'; title = S.last && S.last.out ? `${who(S.last.out)} bị loại` : 'Hoà phiếu'; }
    }
    if (S.phase === 'play' && !S.me.playing) sub = `👀 Bạn đang xem ván này — ván sau sẽ được vào chơi. · ${sub}`;
    el.className = cls;
    setHTML(el, `<div class="big">${big}</div><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div></div>`);
  }

  function renderCast() {
    if (!cast) cast = new window.Cast($('#cast'), { onClick: (pid, el) => openMenu(pid, el) });
    const list = S.phase === 'lobby' ? S.players : S.players.filter((p) => p.playing);
    cast.update(list.map((p) => ({
      id: p.id, name: p.name, look: p.look, bot: p.bot, me: p.id === S.me.id, color: p.color,
      turn: S.phase === 'play' && S.speaker === p.id,
      dim: !p.connected || (p.playing && !p.alive && S.phase === 'play'),
      sub: p.role ? `${ROLE[p.role].icon} ${ROLE[p.role].name}` : (p.playing ? `⭐ ${p.points}` : (p.host ? '👑 chủ phòng' : '')),
      badge: S.stage === 'vote' && p.voted ? '🗳️' : S.speaker === p.id ? '🗣️' : (p.playing && !p.alive && S.phase === 'play' ? '💀' : ''),
    })));
  }

  function renderPlayers() {
    const ranked = S.phase === 'lobby' ? S.players : S.players.slice().sort((a, b) => (b.playing - a.playing) || (b.points - a.points));
    const html = ranked.map((p) => {
      const tags = [p.bot ? '🤖' : '', p.host ? '👑' : '', p.connected ? '' : '📴'].filter(Boolean).join(' ');
      const sub = p.role ? `${ROLE[p.role].icon} ${ROLE[p.role].name}${p.alive ? '' : ' · bị loại'}`
        : p.playing ? (S.speaker === p.id ? '🗣️ đang mô tả' : '🔍 chưa rõ phe') : (S.phase === 'lobby' ? 'Sẵn sàng' : '👀 Đang xem');
      return `<div class="pcard ${S.speaker === p.id ? 'now' : ''} ${p.playing && !p.alive && S.phase === 'play' ? 'dead' : ''}" style="--pc:${p.color || 'transparent'}" data-pid="${esc(p.id)}">
        <div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>
        <div class="pn"><b>${p.id === S.me.id ? 'Bạn' : esc(p.name)} ${tags}</b><span>${sub}</span></div>
        <div class="sc">${p.points}<small>điểm</small></div></div>`;
    }).join('');
    setHTML($('#plist'), html);
  }

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const inviteLink = () => `${ui.lanBase || location.origin}/g/giandiep/?room=${ROOM}`;
  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    return `<div class="panel"><h3><span class="grow">🤖 Người chơi ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Bot mô tả bằng gợi ý ngắn, nghe mô tả để đoán ai là gián điệp — và cũng biết “trà trộn” khi nghi mình là gián điệp.</p>
      <div class="btns-row">${btn('add-bot', '＋ 1 bot', 'small', n >= S.maxPlayers ? 'disabled' : '')}
        ${btn('fill-bots', 'Lấp đủ 6 người', 'small primary', n >= 6 ? 'disabled' : '')}
        ${bots ? btn('remove-bots', '🗑 Xoá hết bot', 'small ghost') : ''}</div></div>`;
  }
  function settingsPanel() {
    const dis = S.me.host ? '' : 'disabled';
    const cfg = S.config;
    const sel = (key, label, opts) => `<div class="setting"><label>${label}</label><select data-cfg="${key}" ${dis}>
      ${opts.map(([v, t]) => `<option value="${v}" ${String(v) === String(cfg[key]) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    return `<div class="panel"><h3>⚙️ Luật chơi</h3><div class="settings">
      ${sel('turn_time', '🗣️ Thời gian mô tả', S.choices.turn_time.map((v) => [v, `${v} giây`]))}
      ${sel('vote_time', '🗳️ Thời gian bỏ phiếu', S.choices.vote_time.map((v) => [v, `${v} giây`]))}
      ${sel('bot_level', '🤖 Độ khó của bot', [['easy', LEVEL_NAMES.easy], ['normal', LEVEL_NAMES.normal], ['hard', LEVEL_NAMES.hard]])}
    </div><p class="gh-muted" style="margin:10px 0 0;font-size:13px">🕵️ Mỗi ván 1 gián điệp · bị loại thì được đoán từ của dân (đúng là thắng) · còn 1 – 1 thì gián điệp thắng.<br>📚 ${S.pairCount} cặp từ (cà phê ↔ trà sữa, mèo ↔ chó, Tết ↔ Trung Thu…).</p></div>`;
  }
  function renderPanel() {
    const el = $('#panel');
    if (S.phase === 'play') { setHTML(el, ''); return; }
    const host = S.me.host;
    let html;
    if (S.phase === 'end') {
      const rows = S.players.filter((p) => p.playing).sort((a, b) => b.points - a.points).map((p, i) => {
        const r = p.role ? ROLE[p.role] : null;
        return `<div class="res-row"><span class="rank">${i + 1}</span>
          <span class="rname">${esc(p.name)}${p.bot ? ' 🤖' : ''}</span>
          <div class="rcards"><span class="${r ? r.cls : ''}">${r ? `${r.icon} ${r.name}` : ''}</span><span class="gh-muted">&nbsp;· ${p.word ? esc(p.word) : 'không có từ'}${p.alive ? '' : ' · bị loại'}</span></div>
          <span class="rpts">${p.points}<small>${p.wins} ván thắng</small></span></div>`;
      }).join('');
      const words = S.words ? `<div class="words-reveal"><div><small>Từ của dân</small><b class="role-civ">${esc(S.words.civ)}</b></div>
        <div><small>Từ gián điệp</small><b class="role-spy">${esc(S.words.spy)}</b></div></div>` : '';
      html = `<div class="panel"><div class="result-head"><div class="trophy">${S.winnerTeam === 'civ' ? '🙂' : '🕵️'}</div><div>
          <h2>${S.winnerTeam === 'civ' ? 'Dân thắng!' : S.winnerTeam === 'spy' ? 'Gián điệp thắng!' : 'Ván dừng'}</h2><p>${esc(S.winReason || '')}</p></div></div>
        ${words}${S.guess && S.guess.pid ? `<p class="gh-muted" style="text-align:center;margin:0 0 10px">🎯 ${S.guess.pid === S.me.id ? 'Bạn (gián điệp)' : `Gián điệp ${who(S.guess.pid)}`} đoán: <b>«${esc(S.guess.text || '…')}»</b></p>` : ''}<div class="results">${rows}</div>
        <div class="start-row" style="margin-top:14px">${host
          ? `${btn('lobby', '🏠 Về phòng chờ', 'ghost')}${btn('next', '▶ Ván mới', 'primary', S.startError ? 'disabled' : '')}`
          : '<span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu ván mới…</span>'}</div></div>${host ? botPanel() + settingsPanel() : ''}`;
    } else {
      const start = host
        ? `<div class="start-row"><div>${S.startError ? `<span class="warn">⚠️ ${esc(S.startError)}</span>` : `<span class="gh-muted">${S.players.length}/${S.maxPlayers} người — sẵn sàng!</span>`}</div>
           ${btn('start', '🕵️ Bắt đầu', 'primary', S.startError ? 'disabled' : '')}</div>`
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
      + '<span class="hint">Tranh luận ở tab 💬 Trò chuyện · nhấn vào nhân vật để ném cà chua kẻ đáng ngờ 🍅</span>');
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
    $('#phase-pill').textContent = S.phase === 'lobby' ? '🏠 Phòng chờ' : S.phase === 'end' ? `🏁 Hết ván ${S.gameNo}` : `🕵️ Vòng ${S.round}`;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `${myTurn() ? '🔔 ' : ''}Gián Điệp ${ROOM}`;
    $('#mission').hidden = S.phase === 'lobby';
    renderBanner();
    renderCast();
    renderSecret();
    renderStage();
    renderBoard();
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
    timer.classList.toggle('urgent', secs <= 5 && (myTurn() || S.stage === 'vote'));
    fill.style.width = `${S.total ? Math.min(1, remaining / S.total) * 100 : 0}%`;
  }
  setInterval(tick, 250);

  // ---------------------------------------------------------------- sự kiện
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'say-form') {
      e.preventDefault();
      const text = $('#say-input').value.trim();
      if (text) send('say', { text });
    } else if (e.target.id === 'guess-form') {
      e.preventDefault();
      const text = $('#guess-input').value.trim();
      if (text) send('guess', { text });
    }
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'say-input') ui.draft = e.target.value; });

  document.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-vote]');
    if (v && !v.disabled) { send('vote', { target: S.me.vote === v.dataset.vote ? '' : v.dataset.vote }); return; }
    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled && actEl.dataset.act) {
      switch (actEl.dataset.act) {
        case 'toggle-word':
          ui.hideWord = !ui.hideWord;
          try { localStorage.setItem('giandiep_hide', ui.hideWord ? '1' : '0'); } catch (err) { /* bỏ qua */ }
          htmlCache.delete($('#secret'));
          renderSecret();
          break;
        case 'start': send('start'); break;
        case 'next': send('next_round'); break;
        case 'lobby': send('lobby'); break;
        case 'stop':
          P.modal({
            title: 'Kết thúc ván?', body: '<p>Ván dừng ngay và lật hết vai.</p>',
            actions: [{ label: 'Chơi tiếp', kind: 'ghost' }, { label: '🛑 Kết thúc', kind: 'danger', onClick: () => send('stop') }],
          });
          break;
        case 'edit-look': openLookEditor(); break;
        case 'add-bot': send('add_bot', { count: 1 }); break;
        case 'fill-bots': send('add_bot', { count: Math.max(1, 6 - S.players.length) }); break;
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
    const v = el.type === 'checkbox' ? el.checked : (['turn_time', 'vote_time'].includes(key) ? Number(el.value) : el.value);
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
    try { localStorage.setItem('giandiep_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) play('said');
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
