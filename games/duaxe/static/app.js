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
  try { ui.sound = localStorage.getItem('duaxe_sound') !== '0'; } catch (e) { /* bỏ qua */ }

  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
  };
  const LEVEL_NAMES = { easy: 'Dễ (~25 WPM)', normal: 'Vừa (~42 WPM)', hard: 'Khó (~65 WPM)', pro: 'Tay đua (~95 WPM)' };
  const LENGTH_NAMES = { short: 'Ngắn (1 câu)', medium: 'Vừa (2–3 câu)', long: 'Dài (cả đoạn)', mixed: 'Ngẫu nhiên' };
  const ACCENT_NAMES = { co: 'Có dấu (cần bộ gõ tiếng Việt)', khong: 'Không dấu' };
  const PLACE = ['', '🥇', '🥈', '🥉'];

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
  const fmtSec = (ms) => `${(ms / 1000).toFixed(1)} giây`;
  const btn = (act, text, kind = '', extra = '') => `<button class="gh-btn ${kind}" data-act="${act}" ${extra}>${text}</button>`;
  let cast = null;
  function anchorEl(pid) {
    const lane = document.querySelector(`#track .lane[data-pid="${CSS.escape(pid || '')}"] .car-box`);
    if (lane) return lane;
    const a = cast && !$('#cast').hidden && cast.anchor(pid);
    if (a) return a;
    return document.querySelector(`#plist [data-pid="${CSS.escape(pid || '')}"] .ava`);
  }
  const rectOf = (el) => (el ? el.getBoundingClientRect() : null);
  const serverNow = () => Date.now() / 1000 + clockOffset;
  // Bỏ dấu tiếng Việt: dùng để không báo sai khi bộ gõ chưa kịp đặt dấu (gõ "ban" rồi mới thành "bàn").
  const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

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
    light: () => [[440, 0.18, 'square', 0.05]],
    go: () => [[880, 0.35, 'square', 0.06]],
    word: () => [[1200, 0.03, 'triangle', 0.025]],
    bad: () => [[200, 0.09, 'square', 0.04]],
    finish: () => [[659, 0.1], [784, 0.1], [1046, 0.25]],
    nitro: () => [[160, 0.12, 'sawtooth', 0.05], [320, 0.12, 'sawtooth', 0.05], [640, 0.3, 'sawtooth', 0.04]],
    charged: () => [[988, 0.07, 'triangle', 0.05], [1319, 0.14, 'triangle', 0.05]],
    lose: () => [[392, 0.14], [330, 0.2]],
    win: () => [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]],
  };
  const play = (k) => beep(SOUNDS[k]());

  // ---------------------------------------------------------------- kết nối
  function connect() {
    conn = P.connect({
      room: ROOM,
      onState,
      onFx,
      onMessage,
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

  // Tiến độ của mọi người (tin nhắn nhẹ ~10 lần/giây từ máy chủ).
  function onMessage(m) {
    if (m.type !== 'duaxe' || !S || !S.race || m.race !== S.race.n) return;
    S.race.prog = Object.assign({}, S.race.prog, m.prog);
    S.race.boost = m.boost || [];
    S.race.err = m.err || [];
    S.race.charge = m.charge || {};
    updateNitro();
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
      case 'finish':
        if (e.pid === S.me.id) play(e.place === 1 ? 'finish' : 'lose');
        if (e.place === 1) bubble(e.pid, '🏁', 'emoji');
        break;
      case 'nitro':
        if (e.pid !== S.me.id) bubble(e.pid, '🔥', 'emoji');
        break;
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

  // ---------------------------------------------------------------- xe
  function carSVG(color) {
    return `<svg class="car" viewBox="0 0 64 28" aria-hidden="true">
      <ellipse cx="32" cy="25.5" rx="29" ry="2.5" fill="rgba(0,0,0,.35)"/>
      <rect x="1" y="6" width="9" height="2.2" rx="1" fill="#222"/><rect x="5" y="7" width="2" height="4" fill="#222"/>
      <path d="M2 20 L2 12 Q2 10 5 10 L18 9 L24 4 Q26 3 29 3 L38 3 Q40 3 42 5 L47 10 L58 12 Q62 13 62 16 L62 20 Q62 21.5 60 21.5 L4 21.5 Q2 21.5 2 20 Z" fill="${color}"/>
      <path d="M2 15 L62 15 L62 17 L2 17 Z" fill="rgba(255,255,255,.55)"/>
      <path d="M24.5 9.4 L28.5 4.6 L32 4.6 L32 9.4 Z M33.5 4.6 L37.6 4.6 Q39 4.6 40 6 L43 9.4 L33.5 9.4 Z" fill="#cfe8ff" opacity=".9"/>
      <rect x="57" y="12.6" width="4.5" height="2.2" rx="1" fill="#fff6b0"/>
      <rect x="2" y="11.5" width="2.5" height="2" rx=".6" fill="#ff5b5b"/>
      <g class="wheel"><circle cx="15" cy="21" r="5" fill="#1b1b1f"/><circle cx="15" cy="21" r="2.4" fill="#c9ccd4"/><rect x="14.4" y="17" width="1.2" height="8" fill="#555"/></g>
      <g class="wheel"><circle cx="50" cy="21" r="5" fill="#1b1b1f"/><circle cx="50" cy="21" r="2.4" fill="#c9ccd4"/><rect x="49.4" y="17" width="1.2" height="8" fill="#555"/></g>
    </svg>`;
  }

  // ---------------------------------------------------------------- khu đua
  const R = () => S.race;
  let arenaKey = null;
  const disp = {};        // vị trí xe đang vẽ (0..1), trượt dần tới vị trí thật cho mượt
  const lastMove = {};    // lúc xe tiến lên gần nhất → bánh xe quay
  let dispRace = null;
  // Trạng thái gõ của mình trong chặng hiện tại.
  let ty = { key: null };
  let composing = false;

  function resetTyping(key) {
    const r = R();
    const words = r.text.split(' ');
    ty = { key, words, wi: 0, base: 0, cur: '', err: false, typos: 0, finished: false, lastSent: 0, sendTimer: 0, lastStat: 0,
      streak: 0, bonus: 0, boostUntil: 0, wasCharged: false };
    // Vào lại giữa chặng: đi tiếp từ từ đã hoàn thành.
    const mine = r.mine;
    if (mine) {
      ty.typos = mine.typos || 0;
      ty.streak = mine.streak || 0;
      ty.bonus = mine.bonus || 0;
      if (mine.done >= r.text.length || (r.fin && r.fin[S.me.id])) { ty.finished = true; ty.wi = words.length; ty.base = r.text.length; }
      else {
        while (ty.wi < words.length && ty.base + words[ty.wi].length + 1 <= mine.done) { ty.base += words[ty.wi].length + 1; ty.wi++; }
      }
    }
  }

  const canType = () => S && S.phase === 'play' && S.stage === 'race' && S.me.playing && !ty.finished;
  const myPos = () => {
    if (ty.finished) return R().text.length;
    const w = ty.words[ty.wi] || '';
    let k = 0;
    const sv = strip(ty.cur); const sw = strip(w);
    while (k < sv.length && k < sw.length && sv[k] === sw[k]) k++;
    return ty.base + k;
  };
  // Quãng đường xe của mình = chữ đã gõ đúng + quãng thưởng nitro (máy chủ tính y hệt và quyết định về đích).
  const myDist = () => Math.min(R().text.length, myPos() + ty.bonus);
  const boosting = () => performance.now() < ty.boostUntil;
  const hasCharge = () => !!(S && R() && R().charge && R().charge[S.me.id]);

  function renderArena() {
    const el = $('#arena');
    if (!S || S.phase !== 'play' || !R()) { arenaKey = null; setHTML(el, ''); return; }
    const raceKey = `${S.gameNo}:${R().n}`;
    if (dispRace !== raceKey) { dispRace = raceKey; Object.keys(disp).forEach((k) => delete disp[k]); }
    if (ty.key !== raceKey) resetTyping(raceKey);
    const key = `${raceKey}:${S.stage}:${S.me.playing}`;
    if (arenaKey !== key) {
      arenaKey = key;
      buildArena(el);
    } else {
      updateZone();
    }
  }

  function buildArena(el) {
    const r = R();
    const lanes = S.players.filter((p) => p.playing).map((p) => `<div class="lane ${p.id === S.me.id ? 'me' : ''}" data-pid="${esc(p.id)}" style="--pc:${p.color}">
        <span class="lname">${p.id === S.me.id ? 'Bạn' : esc(p.name)}${p.bot ? ' 🤖' : ''}</span>
        <i class="start"></i><i class="finish"></i>
        <div class="road"><div class="car-box">${carSVG(p.color)}</div></div>
        <span class="lwpm"></span></div>`).join('');
    htmlCache.delete(el);
    el.innerHTML = `<div class="rhead"><span class="rn">Chặng ${r.n}/${r.total}</span>
        <span class="rt" id="rtitle"></span>
        ${S.me.playing ? '<div class="stats"><div class="stat"><b id="st-wpm">0</b><small>WPM</small></div><div class="stat"><b id="st-acc">100%</b><small>chính xác</small></div><div class="stat"><b id="st-pct">0%</b><small>tiến độ</small></div></div>' : ''}</div>
      <div class="track" id="track">${lanes}<div id="lights"></div></div>
      <div id="zone"></div>`;
    buildZone();
    frame(true);
  }

  // Phần dưới đường đua: đoạn văn + ô gõ (khi đua) hoặc bảng kết quả chặng.
  function buildZone() {
    const z = $('#zone');
    if (!z) return;
    const r = R();
    $('#rtitle').innerHTML = S.stage === 'countdown' ? 'Chuẩn bị…<small>Đọc trước đoạn văn, chờ đèn xanh!</small>'
      : S.stage === 'race' ? 'Gõ nhanh lên!<small>Gõ đúng cả từ rồi bấm dấu cách</small>' : 'Kết quả chặng';
    if (S.stage === 'result') {
      const rows = (r.results || []).map((x, i) => {
        const p = player(x.pid);
        return `<div class="rr ${x.pid === S.me.id ? 'me' : ''}" style="--pc:${p ? p.color : '#888'};animation-delay:${i * 70}ms">
          <span class="ok">${x.finished ? (PLACE[x.rank] || x.rank) : '⏱️'}</span><span class="nm">${who(x.pid)}${p && p.bot ? ' 🤖' : ''}</span>
          <span class="ms">${x.finished ? `${x.wpm} WPM · ${x.acc}% · ${fmtSec(x.ms)}` : `chưa về đích (${x.pct}%)`}</span>
          <span class="pts ${x.pts ? '' : 'zero'}">+${x.pts}</span></div>`;
      }).join('');
      z.innerHTML = `<div class="results-r">${rows}</div>
        <div class="typenote">${r.n < r.total ? 'Chặng tiếp theo sắp bắt đầu…' : 'Sắp công bố kết quả chung cuộc…'}</div>`;
      return;
    }
    let bottom;
    if (!S.me.playing) bottom = '<div class="typenote">👀 Bạn đang xem chặng này — ván sau sẽ được vào đua.</div>';
    else bottom = `<div class="typebox" id="typebox"><input id="type-in" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
        placeholder="${S.stage === 'countdown' ? 'Chờ đèn xanh…' : 'Gõ ở đây…'}" ${S.stage === 'race' ? '' : 'disabled'}>
        <button class="nitro" id="nitro" type="button" title="Gõ liền ${R().nitroWords} từ không sai để nạp — bấm Tab để kích hoạt">
          <i id="nitro-fill"></i><span>🔥 Nitro</span><small id="nitro-sub"></small></button></div>
      <div class="typenote" id="typenote"></div>`;
    z.innerHTML = `<div class="passage" id="passage"></div>${bottom}`;
    updateZone();
    const inp = $('#type-in');
    if (inp && S.stage === 'race' && !ty.finished) setTimeout(() => inp.focus(), 0);
  }

  function updateZone() {
    if (S.stage === 'result') return;
    // Nitro có thể đưa xe về đích trước khi gõ hết chữ — máy chủ báo về đích thì dừng gõ.
    if (!ty.finished && R().fin && R().fin[S.me.id]) {
      ty.finished = true;
      const inp = $('#type-in');
      if (inp) inp.blur();
    }
    renderPassage();
    updateNitro();
    const tb = $('#typebox');
    if (tb && ty.finished && !$('#done-msg')) {
      const f = R().fin && R().fin[S.me.id];
      tb.outerHTML = `<div class="done-msg" id="done-msg">🏁 Về đích${f ? ` hạng ${f.place} — ${f.wpm} WPM, chính xác ${f.acc}%` : '!'}
        <small>Chờ mọi người về đích…</small></div>`;
    } else if ($('#done-msg')) {
      const f = R().fin && R().fin[S.me.id];
      if (f) $('#done-msg').innerHTML = `🏁 Về đích hạng ${f.place} — ${f.wpm} WPM, chính xác ${f.acc}%<small>Chờ mọi người về đích…</small>`;
    }
    const note = $('#typenote');
    if (note) {
      const accentNote = S.config.accent === 'co' ? 'Bật bộ gõ tiếng Việt (Telex / VNI)' : 'Tắt bộ gõ tiếng Việt, gõ không dấu';
      note.innerHTML = ty.finished ? '' : (ty.err ? '<b>Gõ sai rồi</b> — xoá đi gõ lại từ đang tô sáng' : accentNote);
    }
  }

  // Nút nitro: thanh nạp theo chuỗi từ đúng liền, sáng lên khi có bình, cháy khi đang dùng.
  function updateNitro() {
    const b = $('#nitro');
    if (!b || !S || !R()) return;
    const need = R().nitroWords || 10;
    const charged = hasCharge();
    const on = boosting();
    if (charged && !ty.wasCharged && !on) play('charged');
    ty.wasCharged = charged;
    const fill = on ? 1 : charged ? 1 : Math.min(1, ty.streak / need);
    $('#nitro-fill').style.transform = `scaleX(${fill})`;
    b.classList.toggle('ready', charged && !on);
    b.classList.toggle('on', on);
    b.disabled = !canType() || !charged || on;
    $('#nitro-sub').textContent = on ? 'Đang chạy!' : charged ? 'Bấm Tab' : `${Math.min(ty.streak, need)}/${need} từ`;
  }

  function useNitro() {
    if (!canType() || !hasCharge() || boosting()) return;
    ty.boostUntil = performance.now() + (R().nitroTime || 4) * 1000;
    R().charge = Object.assign({}, R().charge, { [S.me.id]: 0 });
    play('nitro');
    pushProgress(true, true);
    updateNitro();
    const inp = $('#type-in');
    if (inp) inp.focus();
  }

  function renderPassage() {
    const el = $('#passage');
    if (!el) return;
    const words = ty.words;
    const active = S.me.playing && S.stage === 'race' && !ty.finished;
    const html = words.map((w, i) => {
      if (i < ty.wi) return `<span class="w done">${esc(w)}</span>`;
      if (i === ty.wi && active) {
        const v = ty.cur;
        let s = '';
        for (let j = 0; j < w.length; j++) {
          let cls = 'todo';
          if (j < v.length) cls = v[j] === w[j] ? 'ok' : strip(v[j]) === strip(w[j]) ? 'part' : 'bad';
          else if (j === v.length) cls = 'todo cursor';
          s += `<span class="c ${cls}">${esc(w[j])}</span>`;
        }
        if (v.length > w.length) s += [...v.slice(w.length)].map((ch) => `<span class="c extra">${ch === ' ' ? '·' : esc(ch)}</span>`).join('');
        return `<span class="w cur ${ty.err ? 'bad' : ''}">${s}</span>`;
      }
      return `<span class="w">${esc(w)}</span>`;
    }).join(' ');
    setHTML(el, html);
  }

  // Xử lý ô gõ. Bộ gõ kiểu "ghép chữ" (macOS, điện thoại) thì chờ ghép xong mới đổi nội dung ô.
  function onType(e) {
    if (!canType()) return;
    const inp = e.target;
    let v = inp.value.normalize('NFC');
    const editable = !composing && !(e && e.isComposing);
    let advanced = false;
    const base0 = ty.base;
    if (editable) {
      v = v.replace(/^ +/, '');
      for (;;) {
        const w = ty.words[ty.wi];
        if (ty.wi === ty.words.length - 1) {
          if (v === w) { finishTyping(inp); return; }
          break;
        }
        const k = v.indexOf(' ');
        if (k < 0 || v.slice(0, k) !== w) break;
        ty.base += w.length + 1;
        ty.wi++;
        v = v.slice(k + 1);
        advanced = true;
        // Đếm chuỗi từ đúng liền giống máy chủ: đang giữ bình thì chưa nạp tiếp; đủ chuỗi thì có bình, đếm lại.
        if (!hasCharge()) {
          ty.streak++;
          if (ty.streak >= (R().nitroWords || 10)) {
            ty.streak = 0;
            R().charge = Object.assign({}, R().charge, { [S.me.id]: 1 });
          }
        }
      }
      if (inp.value !== v) inp.value = v;
    }
    if (ty.base > base0 && boosting()) ty.bonus += (ty.base - base0) * (R().nitroGain || 0.5);
    const w = ty.words[ty.wi];
    const expected = ty.wi === ty.words.length - 1 ? w : `${w} `;
    // Sai khi chữ (đã bỏ dấu) không khớp đầu từ, hoặc đã gõ quá hết từ mà dấu chưa đúng.
    const err = !strip(expected).startsWith(strip(v)) || (v.length > w.length && v.slice(0, w.length) !== w);
    const errChanged = err !== ty.err;
    if (err && !ty.err) { ty.typos++; ty.streak = 0; play('bad'); }
    if (advanced) play('word');
    ty.err = err;
    ty.cur = v;
    inp.classList.toggle('bad', err);
    pushProgress(advanced || errChanged);
    updateZone();
  }

  function finishTyping(inp) {
    ty.finished = true;
    ty.base = R().text.length;
    ty.wi = ty.words.length;
    ty.cur = '';
    ty.err = false;
    inp.blur();
    pushProgress(true);
    updateZone();
  }

  function pushProgress(force, nitro = false) {
    clearTimeout(ty.sendTimer);
    const now = performance.now();
    const doSend = (useNitro) => {
      ty.lastSent = performance.now();
      send('progress', { race: R().n, pos: myPos(), done: ty.base, typos: ty.typos, err: ty.err, nitro: useNitro || undefined });
    };
    if (nitro) { doSend(true); return; }
    if (force || now - ty.lastSent > 120) doSend();
    else ty.sendTimer = setTimeout(() => { if (S && S.stage === 'race') doSend(); }, 120 - (now - ty.lastSent));
  }

  document.addEventListener('input', (e) => { if (e.target.id === 'type-in') onType(e); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && e.target.id === 'type-in') { e.preventDefault(); useNitro(); }
  });
  document.addEventListener('compositionstart', (e) => { if (e.target.id === 'type-in') composing = true; });
  document.addEventListener('compositionend', (e) => { if (e.target.id === 'type-in') { composing = false; onType(e); } });
  ['paste', 'drop'].forEach((t) => document.addEventListener(t, (e) => {
    if (e.target.id === 'type-in') { e.preventDefault(); P.toast('Không được dán chữ — tự gõ nhé! 😄', 'error'); }
  }));

  // Vẽ theo từng khung hình: vị trí xe, đèn xuất phát, chỉ số WPM.
  let lastFrame = performance.now();
  let lightN = null;
  function frame(force) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!S || S.phase !== 'play' || !R()) return;
    const r = R();
    const n = r.text.length;
    const elapsedMin = r.startedAt ? Math.max(1 / 60, (serverNow() - r.startedAt) / 60) : 0;
    document.querySelectorAll('#track .lane').forEach((lane) => {
      const pid = lane.dataset.pid;
      const fin = r.fin && r.fin[pid];
      const mine = pid === S.me.id && S.me.playing && S.stage === 'race';
      const pos = fin ? n : mine ? myDist() : (r.prog[pid] || 0);
      const target = n ? pos / n : 0;
      const cur = disp[pid] === undefined ? target : disp[pid];
      const next = force ? target : cur + (target - cur) * Math.min(1, dt * 7);
      if (next > cur + 0.0005) lastMove[pid] = now;
      disp[pid] = next;
      const box = lane.querySelector('.car-box');
      box.style.left = `calc(${next} * (100% - ${box.offsetWidth}px))`;
      box.classList.toggle('moving', now - (lastMove[pid] || 0) < 250);
      const racing = S.stage === 'race' && !fin;
      box.classList.toggle('boost', racing && (mine ? boosting() : (r.boost || []).includes(pid)));
      box.classList.toggle('err', racing && (mine ? ty.err : (r.err || []).includes(pid)));
      const badge = fin ? `<span class="place">${PLACE[fin.place] || ''} ${fin.place}</span>` : '';
      if (box.dataset.badge !== badge) {
        box.dataset.badge = badge;
        const old = box.querySelector('.place');
        if (old) old.remove();
        if (badge) box.insertAdjacentHTML('beforeend', badge);
      }
      const wpm = fin ? fin.wpm : (elapsedMin ? Math.round((mine ? myPos() : pos) / 5 / elapsedMin) : 0);
      const lw = lane.querySelector('.lwpm');
      const txt = S.stage === 'countdown' ? '' : `${wpm}<small>WPM</small>`;
      if (lw.dataset.t !== txt) { lw.dataset.t = txt; lw.innerHTML = txt; }
    });
    // Đèn xuất phát
    const lights = $('#lights');
    if (lights) {
      let html = '';
      let k = null;
      if (S.stage === 'countdown' && S.deadline) {
        const left = Math.max(0, S.deadline - serverNow());
        const secs = Math.ceil(left);
        const on = Math.max(0, Math.min(3, 4 - secs));
        k = `c${on}`;
        if (k !== lightN && on > 0) play('light');
        html = `<div class="lights">${[1, 2, 3].map((i) => `<i class="${i <= on ? 'on' : ''}"></i>`).join('')}<span>${on ? 4 - on : 'Chuẩn bị'}</span></div>`;
      } else if (S.stage === 'race' && r.startedAt && serverNow() - r.startedAt < 1.1) {
        k = 'go';
        html = '<div class="lights go"><i></i><i></i><i></i><span>XUẤT PHÁT!</span></div>';
      }
      if (k !== lightN) { lightN = k; lights.innerHTML = html; }
    }
    // Chỉ số của mình
    if (S.me.playing && $('#st-wpm') && now - (ty.lastStat || 0) > 200) {
      ty.lastStat = now;
      const f = r.fin && r.fin[S.me.id];
      const pos = myPos();
      $('#st-wpm').textContent = f ? f.wpm : (elapsedMin && S.stage !== 'countdown' ? Math.round(pos / 5 / elapsedMin) : 0);
      $('#st-acc').textContent = `${f ? f.acc : (pos ? Math.round((100 * pos) / (pos + ty.typos)) : 100)}%`;
      $('#st-pct').textContent = `${n ? Math.round((100 * (f ? n : myDist())) / n) : 0}%`;
    }
    // Nitro hết giờ thì cập nhật nút.
    if (ty.boostUntil && !boosting()) { ty.boostUntil = 0; updateNitro(); }
  }
  (function loop() { frame(false); requestAnimationFrame(loop); }());

  // ---------------------------------------------------------------- banner, nhân vật, danh sách
  function renderBanner() {
    const el = $('#banner');
    let big = '🏎️';
    let title = '';
    let sub = '';
    let cls = 'gbanner';
    if (S.phase === 'lobby') {
      title = 'Phòng chờ';
      sub = `${S.players.length}/${S.maxPlayers} người · ${S.me.host ? 'bạn là chủ phòng — chỉnh luật rồi bấm Xuất phát bên dưới (đua một mình cũng được)' : 'đang chờ chủ phòng bắt đầu…'}`;
    } else if (S.phase === 'end') {
      big = '🏆'; cls += ' win';
      title = `${who(S.winner)} thắng!`;
      sub = `Ván ${S.gameNo} kết thúc — xem bảng xếp hạng bên dưới.`;
    } else {
      const r = R();
      title = r ? `Chặng ${r.n}/${r.total}` : '…';
      sub = S.stage === 'countdown' ? 'Chuẩn bị xuất phát…' : S.stage === 'race' ? 'Đang đua!' : 'Kết quả chặng';
      if (S.stage === 'race') cls += ' mine';
    }
    if (S.phase === 'play' && !S.me.playing) sub = `👀 Bạn đang xem ván này — ván sau sẽ được vào đua.${sub ? ` · ${sub}` : ''}`;
    el.className = cls;
    setHTML(el, `<div class="big">${big}</div><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div></div>`);
  }

  function renderCast() {
    const el = $('#cast');
    el.hidden = S.phase === 'play';
    if (el.hidden) return;
    if (!cast) cast = new window.Cast(el, { onClick: (pid, a) => openMenu(pid, a) });
    const list = S.phase === 'lobby' ? S.players : S.players.filter((p) => p.playing);
    cast.update(list.map((p) => ({
      id: p.id, name: p.name, look: p.look, bot: p.bot, me: p.id === S.me.id, color: p.color,
      turn: false,
      dim: !p.connected,
      sub: p.playing ? `⭐ ${p.points}` : (p.host ? '👑 chủ phòng' : ''),
      badge: S.phase === 'end' && S.winner === p.id ? '🏆' : '',
    })));
  }

  function renderPlayers() {
    const ranked = S.phase === 'lobby' ? S.players : S.players.slice().sort((a, b) => (b.playing - a.playing) || (b.points - a.points));
    const html = ranked.map((p) => {
      const tags = [p.bot ? '🤖' : '', p.host ? '👑' : '', p.wins ? `🏆${p.wins}` : '', p.connected ? '' : '📴'].filter(Boolean).join(' ');
      const sub = p.playing ? (p.best ? `⚡ tốt nhất ${p.best} WPM · TB ${p.avg}` : 'Chưa về đích chặng nào') : (S.phase === 'lobby' ? 'Sẵn sàng' : '👀 Đang xem');
      return `<div class="pcard" style="--pc:${p.color || 'transparent'}" data-pid="${esc(p.id)}">
        <div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>
        <div class="pn"><b>${p.id === S.me.id ? 'Bạn' : esc(p.name)} ${tags}</b><span>${sub}</span></div>
        ${p.playing ? `<div class="sc">${p.points}<small>điểm</small></div>` : ''}</div>`;
    }).join('');
    setHTML($('#plist'), html);
  }

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const inviteLink = () => `${ui.lanBase || location.origin}/g/duaxe/?room=${ROOM}`;
  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    return `<div class="panel"><h3><span class="grow">🤖 Tay đua ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Thêm bot để có đối thủ so tốc độ gõ — chọn độ khó ở phần Luật chơi.</p>
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
      ${sel('rounds', '🏁 Số chặng', S.choices.rounds.map((v) => [v, `${v} chặng`]))}
      ${sel('length', '📏 Độ dài đoạn văn', S.choices.length.map((v) => [v, LENGTH_NAMES[v]]))}
      ${sel('accent', '✍️ Kiểu gõ', S.choices.accent.map((v) => [v, ACCENT_NAMES[v]]))}
      ${sel('bot_level', '🤖 Độ khó của bot', S.choices.bot_level.map((v) => [v, LEVEL_NAMES[v]]))}
    </div><p class="gh-muted" style="margin:10px 0 0;font-size:13px">Điểm mỗi chặng theo thứ hạng về đích: ${S.points.join(' · ')}.</p></div>`;
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
          <div class="rcards"><span class="gh-muted">${p.best ? `⚡ tốt nhất ${p.best} WPM · trung bình ${p.avg} WPM` : 'chưa về đích chặng nào'}</span></div>
          <span class="rpts">${p.points} điểm<small>${p.wins} ván thắng</small></span></div>`;
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
           ${btn('start', '🏁 Xuất phát', 'primary', S.startError ? 'disabled' : '')}</div>`
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
      + '<span class="hint">Nhấn vào người chơi khác để vẫy tay, ném cà chua…</span>');
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
      : '<div class="empty-note">Diễn biến ván đua sẽ hiện ở đây.</div>';
    const list = $('#log-list');
    if (setHTML(list, html)) list.scrollTop = list.scrollHeight;
  }

  // ---------------------------------------------------------------- vẽ giao diện
  function render() {
    if (!S) return;
    $('#phase-pill').textContent = S.phase === 'lobby' ? '🏠 Phòng chờ' : S.phase === 'end' ? `🏁 Hết ván ${S.gameNo}`
      : `🏎️ Chặng ${R() ? R().n : 0}/${R() ? R().total : 0}`;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `Đua Xe Gõ Phím ${ROOM}`;
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
    timer.classList.toggle('urgent', S.stage === 'race' && secs <= 10);
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
            actions: [{ label: 'Đua tiếp', kind: 'ghost' }, { label: '🛑 Kết thúc', kind: 'danger', onClick: () => send('stop') }],
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
    if (e.target.closest('#nitro')) { useNitro(); return; }
    const pc = e.target.closest('.pcard');
    if (pc && pc.dataset.pid) { openMenu(pc.dataset.pid, pc); return; }
    // Bấm vào đường đua / đoạn văn thì đưa con trỏ về ô gõ.
    if (e.target.closest('#passage, #track') && canType()) { const inp = $('#type-in'); if (inp) inp.focus(); }
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
    try { localStorage.setItem('duaxe_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) play('finish');
  });
  $('#btn-room').addEventListener('click', async () => { if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good'); });
  $('#btn-leave').addEventListener('click', () => {
    const doLeave = () => { if (conn) conn.leave(); setTimeout(() => { location.href = '/'; }, 150); };
    if (S && S.phase === 'play' && S.me.playing) {
      P.modal({
        title: 'Rời cuộc đua?',
        body: '<p>Ván đang diễn ra — vào lại phòng với <b>đúng tên cũ</b> để đua tiếp.</p>',
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
