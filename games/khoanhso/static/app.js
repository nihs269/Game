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
  try { ui.sound = localStorage.getItem('khoanhso_sound') !== '0'; } catch (e) { /* bỏ qua */ }

  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
  };
  const LEVEL_NAMES = { easy: 'Dễ', normal: 'Vừa', hard: 'Khó' };
  const limitName = (s) => (s ? `${s / 60} phút` : 'Không giới hạn');

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
  const serverNow = () => Date.now() / 1000 + clockOffset;
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
    tick: () => [[880, 0.05, 'square', 0.03]],
    go: () => [[1046, 0.14, 'square', 0.06]],
    mine: () => [[784, 0.07], [1175, 0.14]],
    other: () => [[392, 0.06, 'triangle', 0.04]],
    bad: () => [[220, 0.12, 'square', 0.05], [180, 0.16, 'square', 0.05]],
    win: () => [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]],
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
      case 'go': play('go'); break;
      case 'circle': play(e.pid === S.me.id ? 'mine' : 'other'); break;
      case 'miss':
        if (e.pid === S.me.id) {
          play('bad');
          const el = numEl(e.n);
          if (el) { el.classList.remove('wrong'); void el.offsetWidth; el.classList.add('wrong'); }
        }
        break;
      case 'win':
        play('win');
        (e.winners || []).forEach((w) => { bubble(w, '🏆', 'emoji'); if (cast) cast.react(w, 'cheer'); });
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

  // ---------------------------------------------------------------- tờ giấy
  // Tờ giấy dựng một lần mỗi ván (và khi xoay dọc/ngang); các lần sau chỉ thêm vòng khoanh mới.
  const portraitMQ = window.matchMedia('(max-width: 640px)');
  let paper = { key: null, drawn: null };
  const numEl = (n) => document.querySelector(`#paper .num[data-n="${n}"]`);

  // Vòng khoanh vẽ tay: elip hơi méo, bút đi quá điểm đầu một chút. Ổn định theo số (ai cũng thấy giống nhau).
  function circlePath(n) {
    let seed = n * 9301 + 49297;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const a0 = rnd() * Math.PI * 2;
    const sweep = Math.PI * 2 + 0.35 + rnd() * 0.45;
    const steps = 40;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = a0 + sweep * t;
      const wob = 1 + Math.sin(a * 3 + seed) * 0.03 + (t - 0.5) * 0.08;
      pts.push(`${(50 + Math.cos(a) * 45 * wob).toFixed(1)},${(30 + Math.sin(a) * 25 * wob).toFixed(1)}`);
    }
    return `M${pts.join(' L')}`;
  }
  function circleSVG(n, pid, animate) {
    return `<svg class="ring ${animate ? 'draw' : ''}" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
      <path d="${circlePath(n)}" pathLength="1" style="stroke:${colorOf(pid)}"/></svg>`;
  }

  function buildPaper(el) {
    const portrait = portraitMQ.matches;
    const [cols, rows] = S.grid;
    const across = portrait ? rows : cols;       // số cột theo chiều ngang màn hình
    const nums = S.board.map((b, i) => {
      const n = i + 1;
      const x = portrait ? b.y : b.x;
      const y = portrait ? b.x : b.y;
      const digits = String(n).length;
      return `<button class="num" data-n="${n}" style="left:${x}%;top:${y}%;--fs:${((32 / across) * b.s).toFixed(2)}cqw;--r:${b.r}deg;--w:${digits * 0.62 + 0.75}em">
        <span>${n}</span></button>`;
    }).join('');
    el.innerHTML = `<div id="paper" class="paper ${portrait ? 'portrait' : ''}">${nums}</div>`;
    paper.drawn = new Set();
  }

  function renderArena() {
    const el = $('#arena');
    if (!S || S.phase === 'lobby') { paper.key = null; setHTML(el, ''); return; }
    htmlCache.delete(el);
    if (S.stage === 'ready') {
      if (paper.key !== `ready:${S.gameNo}`) {
        paper.key = `ready:${S.gameNo}`;
        el.innerHTML = `<div class="target-bar"><div class="tlabel">Chuẩn bị bút…</div></div>
          <div class="paper blank"><div class="ready"><div class="pen">✍️</div><h2>Khoanh từ 1 đến ${S.size}</h2>
          <p>${S.me.playing ? `Bút của bạn màu <b style="color:${colorOf(S.me.id)}">${esc((player(S.me.id) || {}).pen || '')}</b>` : '👀 Bạn đang xem ván này'}</p>
          <div class="cd" id="cd"></div></div></div>`;
      }
      return;
    }
    if (!S.board) return;
    const key = `${S.gameNo}:${portraitMQ.matches ? 'p' : 'l'}`;
    const fresh = paper.key !== key;
    if (fresh) {
      paper.key = key;
      el.innerHTML = '<div class="target-bar" id="target-bar"></div><div class="paper-wrap" id="paper-wrap"></div>';
      buildPaper($('#paper-wrap'));
      if (S.phase === 'play') $('#target-bar').scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    // Vòng khoanh mới
    S.owner.forEach((pid, i) => {
      const n = i + 1;
      if (!pid || paper.drawn.has(n)) return;
      paper.drawn.add(n);
      const b = numEl(n);
      if (!b) return;
      b.classList.add('done');
      b.classList.remove('pending');
      b.style.setProperty('--pc', colorOf(pid));
      b.insertAdjacentHTML('beforeend', circleSVG(n, pid, !fresh));
    });
    $('#paper').classList.toggle('over', S.phase === 'end');
    renderTarget();
    tickPaper();
  }

  function renderTarget() {
    const bar = $('#target-bar');
    if (!bar) return;
    let html;
    if (S.phase === 'end') {
      const left = S.size - S.owner.filter(Boolean).length;
      html = `<div class="tlabel">${S.endReason === 'time' ? `⏰ Hết giờ — còn ${left} số chưa ai khoanh` : S.endReason === 'stop' ? '🏁 Ván đã dừng' : '🏁 Đã khoanh hết các số!'}</div>`;
    } else {
      const me = player(S.me.id);
      const last = S.target > 1 ? S.owner[S.target - 2] : null;
      html = `<div class="tlabel">Tìm số</div><div class="tnum" style="${last ? `--lc:${colorOf(last)}` : ''}">${S.target}</div>
        <div class="tinfo">${S.target - 1}/${S.size} đã khoanh${last ? `<br><small>Số ${S.target - 1}: <b style="color:${colorOf(last)}">${who(last)}</b></small>` : ''}</div>
        ${S.me.playing && me ? `<div class="mypen" style="--pc:${me.color}" title="Màu bút của bạn">✍️ <span>${me.count}</span></div>` : '<div class="mypen watch">👀 Đang xem</div>'}`;
    }
    setHTML(bar, html);
  }

  // Cập nhật theo thời gian: đếm ngược, khoá bút, gợi ý số cần tìm.
  function tickPaper() {
    if (!S) return;
    const cd = $('#cd');
    if (cd && S.stage === 'ready') {
      const n = Math.ceil(Math.max(0, (S.deadline || 0) - serverNow()));
      if (String(n) !== cd.textContent) { cd.textContent = n > 0 ? n : 'Bắt đầu!'; if (n > 0) play('tick'); }
    }
    const pp = $('#paper');
    if (!pp || S.phase !== 'play' || S.stage !== 'play') return;
    const now = serverNow();
    const lockUntil = Math.max(S.me.lockUntil || 0, ui.localLock || 0);
    const locked = lockUntil > now;
    pp.classList.toggle('locked', locked);
    pp.dataset.lock = locked ? `✋ Khoá bút ${(lockUntil - now).toFixed(1)}s` : '';
    const hintOn = S.targetAt && now - S.targetAt > S.hintAfter;
    document.querySelectorAll('#paper .num.hint').forEach((b) => { if (!hintOn || Number(b.dataset.n) !== S.target) b.classList.remove('hint'); });
    if (hintOn) { const t = numEl(S.target); if (t) t.classList.add('hint'); }
  }
  setInterval(tickPaper, 100);
  portraitMQ.addEventListener('change', () => { if (S) render(); });

  // Bấm số (pointerdown cho nhạy hơn click)
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('#paper .num');
    if (!b || !S || S.phase !== 'play' || S.stage !== 'play' || !S.me.playing) return;
    e.preventDefault();
    const n = Number(b.dataset.n);
    if (b.classList.contains('done')) return;
    const now = serverNow();
    if (Math.max(S.me.lockUntil || 0, ui.localLock || 0) > now) { play('tick'); return; }
    if (n !== S.target) ui.localLock = now + S.lockTime;   // máy chủ cũng khoá — hiện ngay cho đỡ trễ
    else { b.classList.add('pending'); setTimeout(() => b.classList.remove('pending'), 1200); }
    send('circle', { n });
    tickPaper();
  });

  // ---------------------------------------------------------------- banner, nhân vật, danh sách
  function renderBanner() {
    const el = $('#banner');
    let big = '⭕';
    let title = '';
    let sub = '';
    let cls = 'gbanner';
    if (S.phase === 'lobby') {
      title = 'Phòng chờ';
      sub = `${S.players.length}/${S.maxPlayers} người · ${S.me.host ? 'bạn là chủ phòng — chỉnh luật rồi bấm Bắt đầu bên dưới (chơi một mình cũng được)' : 'đang chờ chủ phòng bắt đầu…'}`;
    } else if (S.phase === 'end') {
      big = '🏆'; cls += ' win';
      title = !S.winners.length ? 'Không ai thắng' : S.winners.length > 1 ? 'Hoà!' : `${who(S.winners[0])} thắng!`;
      sub = `Ván ${S.gameNo} kết thúc — xem bảng xếp hạng bên dưới.`;
    } else {
      big = '✍️';
      title = S.stage === 'ready' ? 'Chuẩn bị…' : `Khoanh số ${S.target}`;
      sub = S.stage === 'ready' ? 'Tờ giấy sắp hiện ra!' : 'Tìm số đó trên tờ giấy và bấm vào — nhanh tay lên!';
      if (S.stage === 'play') cls += ' mine';
    }
    if (S.phase === 'play' && !S.me.playing) sub = `👀 Bạn đang xem ván này — ván sau sẽ được vào chơi.${sub ? ` · ${sub}` : ''}`;
    el.className = cls;
    setHTML(el, `<div class="big">${big}</div><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div></div>`);
  }

  function renderCast() {
    if (!cast) cast = new window.Cast($('#cast'), { onClick: (pid, el) => openMenu(pid, el) });
    const list = S.phase === 'lobby' ? S.players : S.players.filter((p) => p.playing);
    const lead = S.phase !== 'lobby' && list.length ? list.reduce((a, b) => (b.count > a.count ? b : a)) : null;
    cast.update(list.map((p) => ({
      id: p.id, name: p.name, look: p.look, bot: p.bot, me: p.id === S.me.id, color: p.color,
      dim: !p.connected,
      sub: p.playing ? `⭕ ${p.count}` : (p.host ? '👑 chủ phòng' : ''),
      badge: S.phase === 'end' && S.winners.includes(p.id) ? '🏆' : (lead && lead.id === p.id && p.count > 0 ? '👑' : ''),
    })));
  }

  function renderPlayers() {
    const ranked = S.phase === 'lobby' ? S.players : S.players.slice().sort((a, b) => (b.playing - a.playing) || (b.count - a.count));
    const html = ranked.map((p) => {
      const tags = [p.bot ? '🤖' : '', p.host ? '👑' : '', p.wins ? `🏆${p.wins}` : '', p.connected ? '' : '📴'].filter(Boolean).join(' ');
      const sub = p.playing ? `✍️ Bút ${esc(p.pen || '')}${p.misses ? ` · ❌ ${p.misses} lần nhầm` : ''}` : (S.phase === 'lobby' ? 'Sẵn sàng' : '👀 Đang xem');
      return `<div class="pcard" style="--pc:${p.color || 'transparent'}" data-pid="${esc(p.id)}">
        <div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>
        <div class="pn"><b>${p.id === S.me.id ? 'Bạn' : esc(p.name)} ${tags}</b><span>${sub}</span></div>
        ${p.playing ? `<div class="sc" style="color:${p.color}">${p.count}<small>số</small></div>` : ''}</div>`;
    }).join('');
    setHTML($('#plist'), html);
  }

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const inviteLink = () => `${ui.lanBase || location.origin}/g/khoanhso/?room=${ROOM}`;
  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    return `<div class="panel"><h3><span class="grow">🤖 Người chơi ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Thêm bot để có đối thủ tranh số với bạn.</p>
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
      ${sel('size', '🔢 Số lượng số', S.choices.size.map((v) => [v, `1 → ${v}`]))}
      ${sel('limit', '⏱️ Thời gian', S.choices.limit.map((v) => [v, limitName(v)]))}
      ${sel('bot_level', '🤖 Độ khó của bot', S.choices.bot_level.map((v) => [v, LEVEL_NAMES[v]]))}
    </div></div>`;
  }
  function renderPanel() {
    const el = $('#panel');
    if (S.phase === 'play') { setHTML(el, ''); return; }
    const host = S.me.host;
    let html;
    if (S.phase === 'end') {
      let rank = 0; let prev = null;
      const rows = S.ranking.map((pid, i) => {
        const p = player(pid);
        if (!p) return '';
        if (p.count !== prev) { rank = i + 1; prev = p.count; }
        const win = S.winners.includes(pid);
        const pct = S.size ? Math.round((p.count / S.size) * 100) : 0;
        return `<div class="res-row ${win ? 'win' : ''}" style="--pc:${p.color}"><span class="rank">${win ? '🏆' : rank}</span>
          <span class="rname">${esc(p.name)}${p.bot ? ' 🤖' : ''}</span>
          <div class="rcards"><div class="rbar"><i style="width:${pct}%"></i></div><span class="gh-muted">${p.misses ? `❌ ${p.misses}` : ''}</span></div>
          <span class="rpts" style="color:${p.color}">${p.count} số<small>${p.wins} ván thắng</small></span></div>`;
      }).join('');
      const head = !S.winners.length ? 'Không ai khoanh được số nào!'
        : S.winners.length > 1 ? `Hoà: ${S.winners.map((w) => esc(nm(w))).join(', ')}`
          : `${esc(nm(S.winners[0]))}${S.winners[0] === S.me.id ? ' (bạn)' : ''} thắng!`;
      html = `<div class="panel"><div class="result-head"><div class="trophy">🏆</div><div>
          <h2>${head}</h2><p>Ván ${S.gameNo} kết thúc.</p></div></div>
        <div class="results">${rows}</div>
        <div class="start-row" style="margin-top:14px">${host
          ? `${btn('lobby', '🏠 Về phòng chờ', 'ghost')}${btn('next', '▶ Ván mới', 'primary', S.startError ? 'disabled' : '')}`
          : '<span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu ván mới…</span>'}</div></div>${host ? botPanel() + settingsPanel() : ''}`;
    } else {
      const start = host
        ? `<div class="start-row"><div>${S.startError ? `<span class="warn">⚠️ ${esc(S.startError)}</span>` : `<span class="gh-muted">${S.players.length}/${S.maxPlayers} người — sẵn sàng!</span>`}</div>
           ${btn('start', '✍️ Bắt đầu', 'primary', S.startError ? 'disabled' : '')}</div>`
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
      : `⭕ ${S.target - 1}/${S.size}`;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `Khoanh Số ${ROOM}`;
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
    if (!S || !S.deadline || S.phase !== 'play' || S.stage !== 'play') { timer.hidden = true; fill.style.width = '0'; return; }
    const remaining = Math.max(0, S.deadline - serverNow());
    const secs = Math.ceil(remaining);
    timer.hidden = false;
    timer.classList.toggle('urgent', secs <= 15);
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
            title: 'Kết thúc ván?', body: '<p>Ván dừng ngay và xếp hạng theo số đã khoanh.</p>',
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
    send('config', { [key]: key === 'bot_level' ? el.value : Number(el.value) });
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
    try { localStorage.setItem('khoanhso_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) play('mine');
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
