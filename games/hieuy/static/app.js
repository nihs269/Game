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
  try { ui.sound = localStorage.getItem('hieuy_sound') !== '0'; } catch (e) { /* bỏ qua */ }

  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
  };
  const MODE_NAMES = { mix: 'Trộn cả hai kiểu', pair: 'Chỉ 🤝 Tâm Đầu Ý Hợp', single: 'Chỉ 🎯 Hiểu Bạn Đến Đâu' };
  const KIND = {
    pair: { icon: '🤝', title: 'Tâm Đầu Ý Hợp' },
    single: { icon: '🎯', title: 'Hiểu Bạn Đến Đâu' },
  };

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
  const head = (id, cls = '') => `<span class="mini-ava ${cls}" style="--pc:${(player(id) || {}).color || '#888'}">${window.Avatar.svg((player(id) || {}).look, { head: true, seed: id })}</span>`;
  let cast = null;
  function anchorEl(pid) {
    const a = cast && cast.anchor(pid);
    if (a) return a;
    return document.querySelector(`#plist [data-pid="${CSS.escape(pid || '')}"] .ava`);
  }
  const rectOf = (el) => (el ? el.getBoundingClientRect() : null);
  const serverNow = () => Date.now() / 1000 + clockOffset;

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
    intro: () => [[392, 0.08], [523, 0.08], [659, 0.14]],
    tap: () => [[700, 0.04, 'triangle', 0.05]],
    ok: () => [[784, 0.08], [1046, 0.16]],
    bad: () => [[220, 0.12, 'square', 0.05], [180, 0.16, 'square', 0.05]],
    love: () => [[523, 0.1], [659, 0.1], [784, 0.1], [1046, 0.3]],
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
      case 'intro': play('intro'); break;
      case 'reveal': {
        const r = R();
        if (!r) break;
        if (r.type === 'pair') {
          play(r.matched ? 'love' : 'bad');
          if (r.matched) r.who.forEach((p) => { bubble(p, '💞', 'emoji'); if (cast) cast.react(p, 'cheer'); });
        } else if (S.me.playing) {
          const got = r.points && r.points[S.me.id];
          play(got ? 'ok' : 'bad');
        }
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

  // ---------------------------------------------------------------- khu chơi
  const R = () => S.round;
  const val = (r, v) => (v === undefined || v === null ? '—' : r.options ? (r.options[v] !== undefined ? r.options[v] : '?') : String(v));
  const amIn = () => R() && R().who.includes(S.me.id);
  let arenaKey = null;
  let draft = '';   // nội dung đang gõ dở (giữ lại khi giao diện vẽ lại)

  function whoLine(r) {
    if (r.type === 'pair') {
      const [a, b] = r.who;
      return `<div class="duo">${head(a, 'big')}<span class="nm">${who(a)}</span><span class="heart">💞</span><span class="nm">${who(b)}</span>${head(b, 'big')}</div>`;
    }
    return `<div class="duo">${head(r.who[0], 'big')}<span class="nm">${who(r.who[0])}</span></div>`;
  }

  // Câu hỏi hiện cho từng vai.
  function questionFor(r) {
    const me = S.me.id;
    if (r.type === 'pair') {
      if (r.who.includes(me)) {
        const mate = r.who.find((p) => p !== me);
        return { q: r.you, note: `Trả lời thật lòng về bạn — hy vọng <b>${who(mate)}</b> trả lời giống bạn!` };
      }
      return { q: `“${r.you}”`, note: `<b>${who(r.who[0])}</b> và <b>${who(r.who[1])}</b> đang trả lời câu này về chính mình. Hai người sẽ trả lời <b>giống</b> hay <b>khác</b>?` };
    }
    if (r.who[0] === me) return { q: r.you, note: 'Trả lời <b>thật lòng</b> nhé — cả phòng đang đoán về bạn! Mỗi người đoán đúng bạn được +50.' };
    return { q: r.about, note: S.me.playing ? 'Đoán xem! Đúng được +100.' : '' };
  }

  function renderArena() {
    const el = $('#arena');
    if (!S || S.phase !== 'play' || !R()) { arenaKey = null; setHTML(el, ''); return; }
    const r = R();
    const key = `${S.gameNo}:${r.n}:${S.stage}`;
    if (arenaKey !== key) {
      if (!arenaKey || arenaKey.split(':').slice(0, 2).join(':') !== key.split(':').slice(0, 2).join(':')) draft = '';
      arenaKey = key;
      htmlCache.delete(el);
      const k = KIND[r.type];
      el.innerHTML = `<div class="rhead"><span class="rn">Vòng ${r.n}/${r.total}</span><span class="rt ${r.type}">${k.icon} ${k.title}</span></div><div id="abody" class="abody"></div>`;
      if (S.stage === 'answer') buildAnswer();
    }
    if (S.stage === 'intro') renderIntro();
    else if (S.stage === 'answer') updateAnswer();
    else if (S.stage === 'judge') renderJudge();
    else renderReveal();
  }

  function renderIntro() {
    const r = R();
    const k = KIND[r.type];
    const sub = r.type === 'pair' ? 'Hai người cùng trả lời một câu — liệu có giống nhau?' : 'Cả phòng đoán xem người này trả lời thế nào!';
    setHTML($('#abody'), `<div class="intro"><div class="ii">${k.icon}</div><h2>${k.title}</h2>${whoLine(r)}<p>${sub}</p></div>`);
  }

  // --- trả lời / đoán
  function buildAnswer() {
    const r = R();
    const body = $('#abody');
    const { q, note } = questionFor(r);
    const me = S.me.id;
    let input = '';
    if (!S.me.playing) input = '<div class="waitnote">👀 Bạn đang xem ván này.</div>';
    else if (r.type === 'pair' && !r.who.includes(me)) {
      input = `<div class="predict"><button class="pbtn same" data-pred="1">🤝 Giống nhau</button><button class="pbtn diff" data-pred="0">🙅 Khác nhau</button></div>`;
    } else if (r.options) {
      input = `<div class="opts ${r.options.length > 6 ? 'many' : ''}">${r.options.map((o, i) => `<button class="opt" data-opt="${i}">${esc(o)}</button>`).join('')}</div>`;
    } else {
      input = `<form class="ansform" id="ansform"><input id="ans-in" maxlength="60" autocomplete="off" placeholder="${amIn() ? 'Câu trả lời của bạn…' : 'Bạn đoán là…'}">
        <button class="gh-btn primary" type="submit">Gửi</button></form>`;
    }
    body.innerHTML = `${whoLine(r)}<div class="qcard"><div class="q">${esc(q)}</div><div class="qnote">${note}</div></div>
      ${input}<div class="mine" id="mine"></div><div class="chips" id="chips"></div>`;
    const inp = $('#ans-in');
    if (inp) { inp.value = draft; setTimeout(() => inp.focus(), 0); }
  }

  function updateAnswer() {
    const r = R();
    const mine = r.mine;
    document.querySelectorAll('#abody .opt').forEach((b) => b.classList.toggle('picked', mine !== null && mine !== undefined && Number(b.dataset.opt) === mine));
    document.querySelectorAll('#abody .pbtn').forEach((b) => b.classList.toggle('picked', mine !== null && mine !== undefined && (b.dataset.pred === '1') === mine));
    let m = '';
    if (mine !== null && mine !== undefined && S.me.playing) {
      const shown = typeof mine === 'boolean' ? (mine ? '🤝 Giống nhau' : '🙅 Khác nhau') : val(r, mine);
      m = `✅ Đã gửi: <b>${esc(shown)}</b> <span class="gh-muted">— đổi ý thì chọn / gửi lại trước khi hết giờ</span>`;
    }
    setHTML($('#mine'), m);
    const ps = S.players.filter((p) => p.playing);
    setHTML($('#chips'), ps.map((p) => {
      const done = r.answered.includes(p.id);
      const role = r.who.includes(p.id) ? (r.type === 'pair' ? '💞' : '🎯') : '';
      return `<span class="chip ${done ? 'done' : ''}">${head(p.id)}${role}${p.id === S.me.id ? 'Bạn' : esc(p.name)} ${done ? '✅' : '…'}</span>`;
    }).join(''));
  }

  // --- chấm / xác nhận
  function renderJudge() {
    const r = R();
    const me = S.me.id;
    let html;
    if (r.type === 'single') {
      const subj = r.who[0];
      const judge = subj === me;
      const rows = Object.entries(r.guesses).map(([g, v]) => {
        const ok = !!r.marks[g];
        return `<div class="grow-row ${ok ? 'ok' : ''}" style="--pc:${(player(g) || {}).color}">
          ${head(g)}<span class="gn">${who(g)}</span><span class="gv">${esc(val(r, v))}</span>
          ${judge ? `<button class="mark ${ok ? 'on' : ''}" data-mark="${esc(g)}">${ok ? '✅ Đúng' : '❌ Sai'}</button>` : `<span class="mk">${ok ? '✅' : '❌'}</span>`}</div>`;
      }).join('');
      html = `<div class="qcard"><div class="q">${esc(r.about)}</div></div>
        <div class="truth">${head(subj)}<span>${who(subj)} trả lời:</span><b>${esc(val(r, r.answers[subj]))}</b></div>
        <div class="glist">${rows}</div>
        ${judge ? `<div class="judge-bar"><span>Bấm vào từng câu để chấm <b>Đúng / Sai</b> (máy đã chấm sẵn câu khớp).</span>${btn('judge-done', '✔ Chấm xong', 'primary')}</div>`
          : `<div class="waitnote">⏳ ${who(subj)} đang chấm xem ai đoán đúng…</div>`}`;
    } else {
      const [a, b] = r.who;
      const inPair = r.who.includes(me);
      const agreed = r.agree.includes(me);
      html = `<div class="qcard"><div class="q">${esc(r.you)}</div></div>
        <div class="vs">${pairAns(r, a)}<div class="vsmid">?</div>${pairAns(r, b)}</div>
        <div class="waitnote">Hai câu trả lời không khớp hẳn — nếu thật ra là một ý thì <b>cả hai</b> bấm “Tính là giống”.</div>
        ${inPair ? `<div class="judge-bar jcenter"><button class="gh-btn ${agreed ? 'ghost' : 'primary'}" data-act="agree">${agreed ? '↩ Thôi, khác thật' : '🤝 Tính là giống'}</button>
          <button class="gh-btn ghost" data-act="disagree" ${agreed ? 'hidden' : ''}>🙅 Khác thật</button></div>` : ''}
        <div class="chips">${r.who.map((p) => `<span class="chip ${r.agree.includes(p) ? 'done' : ''}">${head(p)}${who(p)} ${r.agree.includes(p) ? '🤝 đồng ý' : '…'}</span>`).join('')}</div>`;
    }
    setHTML($('#abody'), html);
  }

  function pairAns(r, p) {
    return `<div class="pans" style="--pc:${(player(p) || {}).color}">${head(p, 'big')}<span class="pn">${who(p)}</span><b>${esc(val(r, (r.answers || {})[p]))}</b></div>`;
  }

  // --- lật kết quả
  function renderReveal() {
    const r = R();
    const pts = r.points || {};
    const plus = (p) => (pts[p] ? `<span class="pts">+${pts[p]}</span>` : '<span class="pts zero">+0</span>');
    let html;
    if (r.type === 'single') {
      const subj = r.who[0];
      const ans = r.answers[subj];
      const rows = Object.entries(r.guesses).map(([g, v]) => `<div class="grow-row ${r.marks[g] ? 'ok' : 'no'}" style="--pc:${(player(g) || {}).color}">
          ${head(g)}<span class="gn">${who(g)}</span><span class="gv">${esc(val(r, v))}</span><span class="mk">${r.marks[g] ? '✅' : '❌'}</span>${plus(g)}</div>`).join('');
      const right = Object.values(r.marks).filter(Boolean).length;
      html = `<div class="qcard"><div class="q">${esc(r.about)}</div></div>
        ${ans === undefined ? `<div class="truth">${head(subj)}<span>${who(subj)} chưa kịp trả lời 😅</span></div>`
          : `<div class="truth big">${head(subj, 'big')}<span>${who(subj)}:</span><b>${esc(val(r, ans))}</b>${plus(subj)}</div>
             <div class="verdict">${right ? `🎉 ${right}/${Object.keys(r.guesses).length} người hiểu ${who(subj)}!` : `😱 Không ai hiểu ${who(subj)} cả!`}</div>`}
        <div class="glist">${rows || '<div class="waitnote">Không ai đoán.</div>'}</div>`;
    } else {
      const [a, b] = r.who;
      const preds = Object.entries(r.guesses).map(([g, v]) => `<span class="chip ${v === !!r.matched ? 'done' : 'miss'}">${head(g)}${who(g)}: ${v ? '🤝' : '🙅'} ${v === !!r.matched ? '✅' : '❌'} ${pts[g] ? `+${pts[g]}` : ''}</span>`).join('');
      html = `<div class="qcard"><div class="q">${esc(r.you)}</div></div>
        <div class="vs ${r.matched ? 'match' : 'nomatch'}">${pairAns(r, a)}<div class="vsmid">${r.matched ? '💞' : '💔'}</div>${pairAns(r, b)}</div>
        <div class="verdict ${r.matched ? 'love' : ''}">${r.matched ? `Tâm đầu ý hợp! ${who(a)} & ${who(b)} +${pts[a] || 0}` : 'Mỗi người một ý 😅'}</div>
        ${preds ? `<div class="chips">${preds}</div>` : ''}`;
    }
    setHTML($('#abody'), html);
  }

  // ---------------------------------------------------------------- banner, nhân vật, danh sách
  function renderBanner() {
    const el = $('#banner');
    let big = '💞';
    let title = '';
    let sub = '';
    let cls = 'gbanner';
    if (S.phase === 'lobby') {
      title = 'Phòng chờ';
      sub = `${S.players.length}/${S.maxPlayers} người · ${S.me.host ? 'bạn là chủ phòng — chỉnh luật rồi bấm Bắt đầu bên dưới' : 'đang chờ chủ phòng bắt đầu…'}`;
    } else if (S.phase === 'end') {
      big = '🏆'; cls += ' win';
      title = `${who(S.winner)} thắng!`;
      sub = `Ván ${S.gameNo} kết thúc — xem ai hiểu ai nhất bên dưới.`;
    } else {
      const r = R();
      big = r ? KIND[r.type].icon : '💞';
      title = r ? `Vòng ${r.n}/${r.total}: ${KIND[r.type].title}` : '…';
      const mine = r && r.who.includes(S.me.id);
      sub = S.stage === 'intro' ? 'Chuẩn bị…'
        : S.stage === 'answer' ? (mine ? 'Đến lượt bạn trả lời!' : 'Đoán đi nào!')
          : S.stage === 'judge' ? (r.type === 'single' ? 'Đang chấm điểm…' : 'Hai người xác nhận…') : 'Kết quả vòng';
      if (S.stage === 'answer' && mine) cls += ' mine';
    }
    if (S.phase === 'play' && !S.me.playing) sub = `👀 Bạn đang xem ván này — ván sau sẽ được vào chơi.${sub ? ` · ${sub}` : ''}`;
    el.className = cls;
    setHTML(el, `<div class="big">${big}</div><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div></div>`);
  }

  function renderCast() {
    if (!cast) cast = new window.Cast($('#cast'), { onClick: (pid, el) => openMenu(pid, el) });
    const list = S.phase === 'lobby' ? S.players : S.players.filter((p) => p.playing);
    const r = S.phase === 'play' ? R() : null;
    cast.update(list.map((p) => ({
      id: p.id, name: p.name, look: p.look, bot: p.bot, me: p.id === S.me.id, color: p.color,
      turn: !!(r && r.who.includes(p.id)),
      dim: !p.connected,
      sub: p.playing ? `⭐ ${p.score}` : (p.host ? '👑 chủ phòng' : ''),
      badge: S.phase === 'end' && S.winner === p.id ? '🏆' : (r && S.stage === 'answer' && r.answered.includes(p.id) ? '✅' : (r && r.who.includes(p.id) ? (r.type === 'pair' ? '💞' : '🎯') : '')),
    })));
  }

  function renderPlayers() {
    const ranked = S.phase === 'lobby' ? S.players : S.players.slice().sort((a, b) => (b.playing - a.playing) || (b.score - a.score));
    const html = ranked.map((p) => {
      const tags = [p.bot ? '🤖' : '', p.host ? '👑' : '', p.wins ? `🏆${p.wins}` : '', p.connected ? '' : '📴'].filter(Boolean).join(' ');
      const sub = p.playing ? 'Đang chơi' : (S.phase === 'lobby' ? 'Sẵn sàng' : '👀 Đang xem');
      return `<div class="pcard" style="--pc:${p.color || 'transparent'}" data-pid="${esc(p.id)}">
        <div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>
        <div class="pn"><b>${p.id === S.me.id ? 'Bạn' : esc(p.name)} ${tags}</b><span>${sub}</span></div>
        ${p.playing ? `<div class="sc">${p.score}<small>điểm</small></div>` : ''}</div>`;
    }).join('');
    setHTML($('#plist'), html);
  }

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const inviteLink = () => `${ui.lanBase || location.origin}/g/hieuy/?room=${ROOM}`;
  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    return `<div class="panel"><h3><span class="grow">🤖 Người chơi ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Thiếu người thì thêm bot cho đủ vui — bot trả lời ngẫu nhiên, thỉnh thoảng đoán trúng ý bạn.</p>
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
      ${sel('rounds', '🔁 Số vòng', S.choices.rounds.map((v) => [v, `${v} vòng`]))}
      ${sel('mode', '❓ Kiểu câu hỏi', S.choices.mode.map((v) => [v, MODE_NAMES[v]]))}
    </div><p class="gh-muted" style="margin:10px 0 0;font-size:13px">🤝 <b>Tâm Đầu Ý Hợp</b>: 2 người cùng trả lời một câu về mình, giống nhau thì cả hai được điểm ·
      🎯 <b>Hiểu Bạn Đến Đâu</b>: cả phòng đoán câu trả lời của 1 người.</p></div>`;
  }
  function bestPanel() {
    const b = S.best;
    if (!b || (!b.know.length && !b.match.length)) return '';
    const know = b.know.map(([g, s, c, t]) => `<div class="best-row">${head(g)}<b>${who(g)}</b><span>hiểu</span>${head(s)}<b>${who(s)}</b><em>${c}/${t} lần đoán đúng</em></div>`).join('');
    const match = b.match.map(([x, y, c]) => `<div class="best-row">${head(x)}<b>${who(x)}</b><span>💞</span>${head(y)}<b>${who(y)}</b><em>${c} lần giống nhau</em></div>`).join('');
    return `<div class="panel best"><div class="best-col"><h3>🧠 Ai hiểu ai nhất</h3>${know || '<p class="gh-muted">Chưa ai đoán trúng ai 😅</p>'}</div>
      <div class="best-col"><h3>💞 Cặp tâm đầu ý hợp</h3>${match || '<p class="gh-muted">Chưa cặp nào trả lời giống nhau.</p>'}</div></div>`;
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
          <span class="rpts">${p.score} điểm<small>${p.wins} ván thắng</small></span></div>`;
      }).join('');
      html = `<div class="panel"><div class="result-head"><div class="trophy">🏆</div><div>
          <h2>${esc(nm(S.winner))}${S.winner === S.me.id ? ' (bạn)' : ''} thắng!</h2><p>Ván ${S.gameNo} kết thúc.</p></div></div>
        <div class="results">${rows}</div>
        <div class="start-row" style="margin-top:14px">${host
          ? `${btn('lobby', '🏠 Về phòng chờ', 'ghost')}${btn('next', '▶ Ván mới', 'primary', S.startError ? 'disabled' : '')}`
          : '<span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu ván mới…</span>'}</div></div>${bestPanel()}${host ? botPanel() + settingsPanel() : ''}`;
    } else {
      const start = host
        ? `<div class="start-row"><div>${S.startError ? `<span class="warn">⚠️ ${esc(S.startError)}</span>` : `<span class="gh-muted">${S.players.length}/${S.maxPlayers} người — sẵn sàng!</span>`}</div>
           ${btn('start', '💞 Bắt đầu', 'primary', S.startError ? 'disabled' : '')}</div>`
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
      : `💞 Vòng ${R() ? R().n : 0}/${R() ? R().total : 0}`;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `Hiểu Ý Nhau ${ROOM}`;
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
    const remaining = Math.max(0, S.deadline - serverNow());
    const secs = Math.ceil(remaining);
    timer.hidden = false;
    timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    timer.classList.toggle('urgent', S.stage === 'answer' && secs <= 5);
    fill.style.width = `${S.total ? Math.min(1, remaining / S.total) * 100 : 0}%`;
  }
  setInterval(tick, 250);

  // ---------------------------------------------------------------- sự kiện
  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'ansform') return;
    e.preventDefault();
    const inp = $('#ans-in');
    const text = inp.value.trim();
    if (!text) return;
    play('tap');
    send('answer', { round: R().n, value: text });
    draft = '';
    inp.value = '';
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'ans-in') draft = e.target.value; });

  document.addEventListener('click', async (e) => {
    const opt = e.target.closest('#abody .opt');
    if (opt && S && S.stage === 'answer') { play('tap'); send('answer', { round: R().n, value: Number(opt.dataset.opt) }); return; }
    const pred = e.target.closest('#abody .pbtn');
    if (pred && S && S.stage === 'answer') { play('tap'); send('predict', { round: R().n, same: pred.dataset.pred === '1' }); return; }
    const mark = e.target.closest('[data-mark]');
    if (mark && S && S.stage === 'judge') {
      const g = mark.dataset.mark;
      send('mark', { pid: g, ok: !R().marks[g] });
      return;
    }
    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled && actEl.dataset.act) {
      switch (actEl.dataset.act) {
        case 'start': send('start'); break;
        case 'next': send('next_round'); break;
        case 'lobby': send('lobby'); break;
        case 'judge-done': send('judge_done'); break;
        case 'agree': send('agree', { on: !R().agree.includes(S.me.id) }); break;
        case 'disagree': send('agree', { on: false, final: true }); actEl.hidden = true; break;
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

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-cfg]');
    if (!el) return;
    const key = el.dataset.cfg;
    send('config', { [key]: key === 'rounds' ? Number(el.value) : el.value });
  });

  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    e.stopPropagation();
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
    try { localStorage.setItem('hieuy_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
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
