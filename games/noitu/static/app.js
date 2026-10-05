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
    lastSeq: null, wasMine: false, tab: 'players', unread: 0, lastChatId: null, lanBase: null, sound: true,
    draft: '', lastTick: null, chainLen: 0, sentAt: 0,
  };
  try { ui.sound = localStorage.getItem('noitu_sound') !== '0'; } catch (e) { /* bỏ qua */ }

  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
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
  const hearts = (p) => (p.alive ? '❤️'.repeat(Math.max(0, p.lives)) : '💀');
  const myTurn = () => !!(S && S.phase === 'play' && S.stage === 'turn' && S.turn === S.me.id);
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
    word: () => [[880, 0.07], [1320, 0.12]],
    wrong: () => [[220, 0.12, 'square', 0.05], [180, 0.16, 'square', 0.05]],
    fail: () => [[392, 0.18, 'triangle'], [311, 0.18, 'triangle'], [247, 0.32, 'triangle']],
    out: () => [[300, 0.2, 'sawtooth', 0.06], [200, 0.25, 'sawtooth', 0.06], [120, 0.45, 'sawtooth', 0.06]],
    block: () => [[600, 0.1, 'square', 0.05], [300, 0.3, 'square', 0.05]],
    vote: () => [[660, 0.1], [990, 0.1]],
    ok: () => [[784, 0.08], [1046, 0.16]],
    tick: () => [[1200, 0.04, 'square', 0.025]],
    win: () => [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]],
    turn: () => [[660, 0.12], [880, 0.18]],
  };
  const play = (k) => beep(SOUNDS[k]());

  // Lỗi khi gửi từ (máy chủ báo bằng toast) → rung ô nhập.
  const baseToast = P.toast;
  P.toast = (message, kind, ms) => {
    if (kind === 'error' && Date.now() - ui.sentAt < 3000) {
      const box = $('.answer');
      if (box) { box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); }
      play('wrong');
    }
    return baseToast(message, kind, ms);
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
    const mine = myTurn();
    if (mine && !ui.wasMine && !first) { play('turn'); if (navigator.vibrate) navigator.vibrate(100); }
    // Mỗi lượt mới của mình bắt đầu với ô nhập trống (từ cũ tự xoá).
    if (!mine || !ui.wasMine) ui.draft = '';
    render();
    if (mine && !ui.wasMine) focusInput();
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
  function popWord() {
    const box = $('#wordbox');
    box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop');
  }

  function playEvent(e) {
    switch (e.type) {
      case 'word':
        play('word'); popWord();
        bubble(e.pid, e.word);
        if (e.killer && cast) { cast.react(e.pid, 'cheer'); setTimeout(() => play('block'), 400); }
        break;
      case 'newword': popWord(); break;
      case 'fail': play(e.reason === 'block' ? 'block' : 'fail'); bubble(e.pid, '💔', 'emoji'); if (cast) cast.react(e.pid, 'sad'); break;
      case 'out': setTimeout(() => { play('out'); bubble(e.pid, '💥', 'emoji'); }, 500); break;
      case 'vote': play('vote'); bubble(e.pid, '🗳️', 'emoji'); break;
      case 'voted': play(e.ok ? 'ok' : 'wrong'); bubble(e.pid, e.ok ? '✅' : '❌', 'emoji'); break;
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

  // ---------------------------------------------------------------- khu chơi chính
  function renderChain() {
    const el = $('#chain');
    if (S.phase === 'lobby' || !S.chain.length) { setHTML(el, ''); ui.chainLen = 0; return; }
    const n = S.chain.length;
    // Từ mở màn giữa chuỗi (sau khi có người bí) được ngăn bằng dấu ┃ thay cho mũi tên.
    const html = S.chain.map((c, i) => `${i ? `<span class="arrow">${c.pid ? '➜' : '┃'}</span>` : ''}<span class="chip ${c.pid ? '' : 'start'} ${i === n - 1 && n !== ui.chainLen ? 'fresh' : ''}"
      style="--pc:${c.pid ? colorOf(c.pid) : '#fff'}" title="${c.pid ? esc(nm(c.pid)) : 'Từ mở màn'}">${esc(c.w)}</span>`).join('');
    if (setHTML(el, html)) el.scrollLeft = el.scrollWidth;
    ui.chainLen = n;
  }

  function renderWord() {
    const el = $('#wordbox');
    if (S.phase === 'lobby' || !S.word) { setHTML(el, ''); return; }
    const [a, b] = S.word.w.split(' ');
    const last = S.chain.length ? S.chain[S.chain.length - 1] : null;
    const by = last && last.pid ? `<div class="by">${who(last.pid)} vừa nối</div>` : '<div class="by">Từ mở màn</div>';
    const left = S.phase === 'play'
      ? (S.word.left ? `<div class="left">Còn <b>${S.word.left}</b> từ có thể nối với «${esc(b)}»</div>`
        : '<div class="left killer">🧱 Từ chặn — không còn từ nào nối được!</div>')
      : '';
    setHTML(el, `${by}<div class="cur"><span class="w1">${esc(a)}</span> <span class="w2">${esc(b)}</span></div>${left}`);
  }

  function focusInput() {
    setTimeout(() => { const i = $('#say-input'); if (i) i.focus(); }, 30);
  }

  function renderAction() {
    const el = $('#action');
    if (S.phase !== 'play') { setHTML(el, ''); return; }
    let html = '';
    if (S.reveal && S.stage === 'pause') {
      const r = S.reveal;
      const why = { timeout: 'hết giờ', giveup: 'chịu thua', block: 'gặp từ chặn' }[r.reason];
      html += `<div class="reveal">💔 <b>${who(r.pid)}</b> ${why} ở «${esc(r.word)}»${r.hints.length
        ? `<div class="hints">Có thể nối: ${r.hints.map((h) => `<b>${esc(h)}</b>`).join(', ')}</div>` : ''}</div>`;
    }
    if (S.stage === 'vote' && S.vote) {
      const v = S.vote;
      const canVote = v.voters.includes(S.me.id);
      html += `<div class="votecard"><div>🗳️ <b>${who(v.pid)}</b> xin duyệt từ mới</div><div class="vw">«${esc(v.w)}»</div>
        ${canVote ? (v.mine === undefined || v.mine === null
          ? `<div class="row">${btn('vote-yes', '👍 Hợp lệ', 'good')}${btn('vote-no', '👎 Không', 'danger')}</div>`
          : `<div class="note">Bạn đã chọn ${v.mine ? '👍 Hợp lệ' : '👎 Không'}</div>`)
          : `<div class="note">${v.pid === S.me.id ? 'Đang chờ mọi người bỏ phiếu' : 'Đang bỏ phiếu'}<span class="dots"></span></div>`}
        <div class="tally">${v.voted.length}/${v.voters.length} người đã bỏ phiếu · quá nửa đồng ý thì từ được tính và thêm vào từ điển</div></div>`;
    } else if (S.stage === 'turn') {
      if (myTurn()) {
        const need = S.word ? S.word.last : '';
        html += `<form class="answer" id="say-form" autocomplete="off"><div class="prefix">${esc(need)}</div>
          <input id="say-input" maxlength="40" placeholder="gõ tiếng thứ hai…" value="${esc(ui.draft)}" autocomplete="off" autocapitalize="off" spellcheck="false">
          <button class="gh-btn gold" type="submit">Nối ➜</button></form>
          <div class="row">${S.me.propose ? `<div class="propose"><b>«${esc(S.me.propose)}»</b> chưa có trong từ điển ${btn('propose', '🗳️ Xin duyệt', 'small primary')}</div>` : ''}
          ${btn('giveup', '🏳️ Chịu', 'small ghost')}</div>`;
      } else {
        html += `<div class="waiting">Đang chờ <b style="color:${colorOf(S.turn)}">${who(S.turn)}</b> nối «${esc(S.word ? S.word.last : '')} …»<span class="dots"></span></div>`;
      }
    } else if (S.stage === 'pause') {
      html += '<div class="note">Chuẩn bị từ mới<span class="dots"></span></div>';
    }
    // Bản nháp chỉ được ghi qua sự kiện gõ phím (ui.draft) — không đọc lại từ ô nhập cũ của lượt trước.
    const input = $('#say-input');
    const hadFocus = input && document.activeElement === input;
    if (setHTML(el, html) && hadFocus) {
      const i = $('#say-input');
      if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    }
  }

  function renderBanner() {
    const el = $('#banner');
    let big = '🔤';
    let title = '';
    let sub = '';
    let cls = 'gbanner';
    if (S.phase === 'lobby') {
      title = 'Phòng chờ';
      sub = `${S.players.length}/${S.maxPlayers} người · ${S.me.host ? 'bạn là chủ phòng — chỉnh luật rồi bấm Bắt đầu bên dưới' : 'đang chờ chủ phòng bắt đầu…'} · từ điển ${S.dictSize.toLocaleString('vi-VN')} từ`;
    } else if (S.phase === 'end') {
      big = '🏆'; cls += ' win';
      title = `${who(S.winner)} thắng!`;
      sub = `${esc(S.winReason || '')} · ván ${S.gameNo} kết thúc — xem bảng xếp hạng bên dưới.`;
    } else {
      const dot = S.turn ? `<span class="dotc" style="--pc:${colorOf(S.turn)}"></span>` : '';
      if (S.stage === 'vote') { big = '🗳️'; title = `Bỏ phiếu từ «${esc(S.vote ? S.vote.w : '')}»`; }
      else if (S.stage === 'pause') { big = '💔'; title = 'Có người bí rồi!'; }
      else if (myTurn()) {
        big = '✍️'; cls += ' mine'; title = `${dot}Đến lượt bạn — nối với «${esc(S.word.last)}»!`;
        sub = 'Gõ tiếng thứ hai rồi Enter · gõ sai được gõ lại · hết giờ mất 1 mạng.';
      } else { big = '🤔'; title = `${dot}${who(S.turn)} đang nghĩ…`; }
      if (!sub) sub = `Đã nối ${S.used} từ · từ điển ${S.dictSize.toLocaleString('vi-VN')} từ`;
    }
    if (S.phase === 'play' && !S.me.playing) sub = `👀 Bạn đang xem ván này — ván sau sẽ được vào chơi.${sub ? ` · ${sub}` : ''}`;
    el.className = cls;
    setHTML(el, `<div class="big">${big}</div><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div></div>`);
  }

  function renderCast() {
    if (!cast) cast = new window.Cast($('#cast'), { onClick: (pid, el) => openMenu(pid, el) });
    const list = S.phase === 'lobby' ? S.players : S.players.filter((p) => p.playing);
    cast.update(list.map((p) => ({
      id: p.id, name: p.name, look: p.look, bot: p.bot, me: p.id === S.me.id, color: p.color,
      turn: S.phase === 'play' && S.turn === p.id,
      dim: !p.connected || (p.playing && !p.alive),
      sub: p.playing ? `<span class="hearts">${hearts(p)}</span> · ${p.score} từ` : (p.host ? '👑 chủ phòng' : ''),
      badge: S.phase === 'end' && S.winner === p.id ? '🏆' : (p.playing && !p.alive ? '💀' : ''),
    })));
  }

  function renderPlayers() {
    const html = S.players.map((p) => {
      const tags = [p.bot ? '🤖' : '', p.host ? '👑' : '', p.wins ? `🏆${p.wins}` : '', p.connected ? '' : '📴'].filter(Boolean).join(' ');
      const sub = p.playing ? `${hearts(p)}${p.alive ? '' : ' bị loại'}` : (S.phase === 'lobby' ? 'Sẵn sàng' : '👀 Đang xem');
      return `<div class="pcard ${S.turn === p.id && S.phase === 'play' ? 'turn' : ''} ${p.playing && !p.alive ? 'out' : ''}" style="--pc:${p.color || 'transparent'}" data-pid="${esc(p.id)}">
        <div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>
        <div class="pn"><b>${p.id === S.me.id ? 'Bạn' : esc(p.name)} ${tags}</b><span>${sub}</span></div>
        ${p.playing ? `<div class="sc">${p.score}<small>từ</small></div>` : ''}</div>`;
    }).join('');
    setHTML($('#plist'), html);
  }

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const inviteLink = () => `${ui.lanBase || location.origin}/g/noitu/?room=${ROOM}`;
  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    return `<div class="panel"><h3><span class="grow">🤖 Người chơi ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Không đủ người? Thêm bot — bot tra cùng từ điển, bot khó hay chọn từ hiểm để dồn bạn vào thế bí.</p>
      <div class="btns-row">${btn('add-bot', '＋ 1 bot', 'small', n >= S.maxPlayers ? 'disabled' : '')}
        ${btn('fill-bots', 'Lấp đủ 4 người', 'small primary', n >= 4 ? 'disabled' : '')}
        ${bots ? btn('remove-bots', '🗑 Xoá hết bot', 'small ghost') : ''}</div></div>`;
  }
  function settingsPanel() {
    const dis = S.me.host ? '' : 'disabled';
    const cfg = S.config;
    const sel = (key, label, opts) => `<div class="setting"><label>${label}</label><select data-cfg="${key}" ${dis}>
      ${opts.map(([v, t]) => `<option value="${v}" ${String(v) === String(cfg[key]) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    return `<div class="panel"><h3>⚙️ Luật chơi</h3><div class="settings">
      ${sel('lives', '❤️ Số mạng mỗi người', S.choices.lives.map((v) => [v, `${v} mạng`]))}
      ${sel('turn_time', '⏱ Thời gian mỗi lượt', S.choices.turn_time.map((v) => [v, `${v} giây`]))}
      ${sel('bot_level', '🤖 Độ khó của bot', S.choices.bot_level.map((v) => [v, LEVEL_NAMES[v]]))}
      <label class="switch"><input type="checkbox" data-cfg="block" ${cfg.block ? 'checked' : ''} ${dis}>
        <span>Từ chặn<small>Nói được từ không ai nối tiếp được → người sau mất mạng luôn</small></span></label>
    </div><p class="estimate">📚 Từ điển: ${S.dictSize.toLocaleString('vi-VN')} từ 2 tiếng — từ hợp lệ chưa có thể xin duyệt và được lưu lại cho các ván sau.</p></div>`;
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
          <div class="rcards"><span class="gh-muted">${hearts(p)}${p.alive ? '' : ' bị loại'}</span></div>
          <span class="rpts">${p.score} từ<small>${p.wins} ván thắng</small></span></div>`;
      }).join('');
      html = `<div class="panel"><div class="result-head"><div class="trophy">🏆</div><div>
          <h2>${esc(nm(S.winner))}${S.winner === S.me.id ? ' (bạn)' : ''} thắng!</h2><p>Ván ${S.gameNo} · cả bàn đã nối ${S.used} từ.</p></div></div>
        <div class="results">${rows}</div>
        <div class="start-row" style="margin-top:14px">${host
          ? `${btn('lobby', '🏠 Về phòng chờ', 'ghost')}${btn('next', '▶ Ván mới', 'primary', S.startError ? 'disabled' : '')}`
          : '<span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu ván mới…</span>'}</div></div>${host ? botPanel() + settingsPanel() : ''}`;
    } else {
      const start = host
        ? `<div class="start-row"><div>${S.startError ? `<span class="warn">⚠️ ${esc(S.startError)}</span>` : `<span class="gh-muted">${S.players.length}/${S.maxPlayers} người — sẵn sàng!</span>`}</div>
           ${btn('start', '🔤 Bắt đầu', 'primary', S.startError ? 'disabled' : '')}</div>`
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
    $('#phase-pill').textContent = S.phase === 'lobby' ? '🏠 Phòng chờ' : S.phase === 'end' ? `🏁 Hết ván ${S.gameNo}` : `🔤 Ván ${S.gameNo} · ${S.used} từ`;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `${myTurn() ? '🔔 ' : ''}Nối Từ ${ROOM}`;
    renderBanner();
    renderCast();
    renderChain();
    renderWord();
    renderAction();
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
    const tfill = $('#tbar-fill');
    if (!S || !S.deadline || S.phase !== 'play') {
      timer.hidden = true; fill.style.width = '0'; if (tfill) tfill.style.width = '0'; return;
    }
    const remaining = Math.max(0, S.deadline - (Date.now() / 1000 + clockOffset));
    const secs = Math.ceil(remaining);
    const pct = `${S.total ? Math.min(1, remaining / S.total) * 100 : 0}%`;
    timer.hidden = false;
    timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const urgent = secs <= 5 && S.stage === 'turn';
    timer.classList.toggle('urgent', urgent && myTurn());
    fill.style.width = pct;
    if (tfill) { tfill.style.width = pct; tfill.classList.toggle('urgent', urgent); }
    if (urgent && myTurn() && secs !== ui.lastTick && secs > 0) { ui.lastTick = secs; play('tick'); }
  }
  setInterval(tick, 250);

  // ---------------------------------------------------------------- sự kiện
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'say-form') {
      e.preventDefault();
      const input = $('#say-input');
      const text = input.value.trim();
      if (!text) return;
      ui.sentAt = Date.now();
      send('say', { text });
      input.select();
    }
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'say-input') ui.draft = e.target.value; });

  document.addEventListener('click', async (e) => {
    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled && actEl.dataset.act) {
      switch (actEl.dataset.act) {
        case 'giveup':
          P.modal({
            title: 'Chịu thua lượt này?', body: '<p>Bạn sẽ mất 1 mạng và người kế tiếp bắt đầu với từ mới.</p>',
            actions: [{ label: 'Nghĩ tiếp', kind: 'ghost' }, { label: '🏳️ Chịu', kind: 'danger', onClick: () => send('giveup') }],
          });
          break;
        case 'propose': send('propose'); break;
        case 'vote-yes': send('vote', { yes: true }); break;
        case 'vote-no': send('vote', { yes: false }); break;
        case 'start': send('start'); break;
        case 'next': send('next_round'); break;
        case 'lobby': send('lobby'); break;
        case 'stop':
          P.modal({
            title: 'Kết thúc ván?', body: '<p>Ván dừng ngay, người còn nhiều mạng (rồi nhiều từ) nhất thắng.</p>',
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

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-cfg]');
    if (!el) return;
    const key = el.dataset.cfg;
    const v = el.type === 'checkbox' ? el.checked : (['turn_time', 'lives'].includes(key) ? Number(el.value) : el.value);
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
    try { localStorage.setItem('noitu_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) play('ok');
  });
  $('#btn-room').addEventListener('click', async () => { if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good'); });
  $('#btn-leave').addEventListener('click', () => {
    const doLeave = () => { if (conn) conn.leave(); setTimeout(() => { location.href = '/'; }, 150); };
    if (S && S.phase === 'play' && S.me.playing) {
      P.modal({
        title: 'Rời ván chơi?',
        body: '<p>Ván đang diễn ra — khi bạn vắng mặt, lượt của bạn sẽ tự hết giờ. Vào lại phòng với <b>đúng tên cũ</b> để chơi tiếp.</p>',
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
