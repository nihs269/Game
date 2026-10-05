(function () {
  const P = window.Platform;
  const $ = (s) => document.querySelector(s);
  const esc = P.esc;
  const ROOM = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (!ROOM) { location.href = '/'; return; }

  let S = null;          // trạng thái mới nhất từ máy chủ
  let CARDS = [];        // 78 lá, nạp từ cards.json
  let conn = null;
  let clockOffset = 0;
  const ui = {
    lastSeq: null, wasMine: false, just: new Set(), question: '', spread: 'time',
    tab: 'chat', unread: 0, lastChatId: null, lanBase: null, sound: true, deckFilter: 'major',
  };
  try { ui.sound = localStorage.getItem('tarot_sound') !== '0'; } catch (e) { /* bỏ qua */ }

  const SUIT = {
    wands: { name: 'Gậy', sym: '🔥', text: '🔥 Chất Gậy (Lửa) nổi bật: hành động, đam mê và sự nghiệp đang dẫn dắt câu chuyện.' },
    cups: { name: 'Cốc', sym: '🏆', text: '🏆 Chất Cốc (Nước) nổi bật: cảm xúc, tình cảm và các mối quan hệ là trọng tâm.' },
    swords: { name: 'Kiếm', sym: '⚔️', text: '⚔️ Chất Kiếm (Khí) nổi bật: suy nghĩ, lời nói và các quyết định lý trí đang chi phối — có thể kèm căng thẳng.' },
    pentacles: { name: 'Tiền', sym: '💰', text: '💰 Chất Tiền (Đất) nổi bật: tiền bạc, công việc và những điều thực tế là mối bận tâm chính.' },
  };
  const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];
  const RANK_MARK = { 1: 'A', 11: 'P', 12: 'Kn', 13: 'Q', 14: 'K' };
  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
  };

  // ---------------------------------------------------------------- tiện ích
  const bubbles = new window.ChatBubbles({
    anchor: (pid) => document.querySelector(`#audience [data-pid="${CSS.escape(pid)}"] .ava`),
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
  const btn = (act, text, kind = '', extra = '') => `<button class="gh-btn ${kind}" data-act="${act}" ${extra}>${text}</button>`;
  const isQuerent = () => !!(S && S.reading && S.reading.querent === S.me.id);
  const spreadOf = (r) => (r && r.spread ? S.spreads[r.spread] : null);

  // ---------------------------------------------------------------- lá bài
  function faceHTML(cid, rev, { cls = '' } = {}) {
    const c = CARDS[cid];
    if (!c) return '';
    const suit = SUIT[c.arc];
    if (cls.includes('xs')) {
      return `<div class="tcard face a-${c.arc} ${rev ? 'rev' : ''} ${cls}" title="${esc(c.name)}${rev ? ' (ngược)' : ''}"><span class="x">${suit && c.num <= 10 ? suit.sym : c.sym}</span></div>`;
    }
    let art;
    let mark;
    if (!suit) {
      art = `<div class="big">${c.sym}</div>`;
      mark = ROMAN[c.num];
    } else if (c.num === 1) {
      art = `<div class="big">${suit.sym}</div>`;
      mark = 'A';
    } else if (c.num <= 10) {
      art = `<div class="pips ${c.num <= 4 ? 'c2' : ''}">${Array.from({ length: c.num }, () => `<span>${suit.sym}</span>`).join('')}</div>`;
      mark = String(c.num);
    } else {
      art = `<div class="big">${c.sym}</div><div class="small">${suit.sym}</div>`;
      mark = RANK_MARK[c.num];
    }
    return `<div class="tcard face a-${c.arc} ${rev ? 'rev' : ''} ${cls}"><div class="inner">
      <div class="num">${mark}</div><div class="art">${art}</div><div class="nm">${esc(c.name)}</div></div></div>`;
  }
  const backHTML = (cls = '') => `<div class="tcard back ${cls}"><div class="inner"><span class="moon">☾✦☽</span></div></div>`;

  function meaningHTML(cid, rev, label) {
    const c = CARDS[cid];
    const m = rev ? c.rev : c.up;
    return `<div class="meaning">${faceHTML(cid, rev, { cls: 'sm' })}<div class="mtext">
      ${label ? `<div class="mpos">${esc(label)}</div>` : ''}
      <h4>${esc(c.name)} <span class="en">${esc(c.en)}</span>${rev ? '<span class="revtag">Ngược</span>' : ''}</h4>
      <div class="kw">🔑 ${esc(m[0])}</div><p>${esc(m[1])}</p></div></div>`;
  }

  const cardScore = ([cid, rev]) => (rev ? -CARDS[cid].tone / 2 : CARDS[cid].tone);

  // Tổng quan tự rút ra từ các lá: Ẩn Chính, chất nổi bật, lá ngược và “độ sáng” chung.
  function summaryHTML(cards, spread) {
    const n = cards.length;
    const lines = [];
    const majors = cards.filter(([c]) => CARDS[c].arc === 'major').length;
    if (n >= 3 && majors >= Math.ceil(n / 2)) lines.push('🌟 Nhiều lá Ẩn Chính: đây là giai đoạn mang tính bước ngoặt — những bài học lớn của cuộc đời đang vận hành.');
    else if (n >= 3 && majors === 0) lines.push('🍃 Không có lá Ẩn Chính: mọi việc nằm trong tầm tay bạn, phụ thuộc vào những lựa chọn hằng ngày.');
    if (n >= 3) {
      const counts = {};
      cards.forEach(([c]) => { const a = CARDS[c].arc; if (SUIT[a]) counts[a] = (counts[a] || 0) + 1; });
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      if (sorted.length && sorted[0][1] >= 2 && (!sorted[1] || sorted[1][1] < sorted[0][1])) lines.push(SUIT[sorted[0][0]].text);
      const revs = cards.filter(([, r]) => r).length;
      if (revs >= Math.ceil(n / 2)) lines.push('🔄 Nhiều lá ngược: năng lượng đang bị tắc nghẽn hoặc hướng vào bên trong — hãy nhìn lại chính mình trước.');
    }
    if (spread === 'choice' && n === 5) {
      const a = cardScore(cards[1]) + cardScore(cards[3]);
      const b = cardScore(cards[2]) + cardScore(cards[4]);
      if (a - b >= 0.5) lines.push('🅰️ Con đường A mang năng lượng thuận lợi hơn.');
      else if (b - a >= 0.5) lines.push('🅱️ Con đường B mang năng lượng thuận lợi hơn.');
      else lines.push('⚖️ Hai con đường khá ngang nhau — hãy lắng nghe trái tim mình.');
    }
    const avg = cards.reduce((s, c) => s + cardScore(c), 0) / Math.max(1, n);
    if (avg >= 0.34) lines.push('☀️ Tổng thể: tín hiệu tích cực, mọi thứ đang thuận lợi cho bạn.');
    else if (avg <= -0.34) lines.push('🌧️ Tổng thể: đang có thử thách, nhưng mỗi thử thách là một bài học để trưởng thành.');
    else lines.push('⚖️ Tổng thể: khá cân bằng — kết quả phụ thuộc nhiều vào cách bạn hành động.');
    if (spread === 'one') {
      const yn = avg > 0 ? 'CÓ ✅' : avg < 0 ? 'KHÔNG ❌' : 'CHƯA RÕ — hãy hỏi lại sau 🌫️';
      lines.push(`<span class="yn">❓ Nếu là câu hỏi Có/Không: ${yn}</span>`);
    }
    return `<div class="summary"><h3>🔮 Tổng quan</h3><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
      <p class="disclaimer">Tarot mang tính giải trí và gợi mở suy ngẫm — người quyết định vẫn là bạn.</p></div>`;
  }

  function readingDetailHTML(cards, spreadKey, { summary = true } = {}) {
    const sp = S.spreads[spreadKey];
    const items = cards.map(([cid, rev], i) => (cid === null ? '' : meaningHTML(cid, rev, `${i + 1} · ${sp.slots[i][0]}`))).join('');
    return `${summary ? summaryHTML(cards, spreadKey) : ''}<div class="meanings">${items}</div>`;
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
    shuffle: () => Array.from({ length: 16 }, () => [180 + Math.random() * 220, 0.05, 'triangle', 0.035]),
    pick: () => [[520, 0.08, 'sine', 0.06], [780, 0.1, 'sine', 0.04]],
    flip: () => [[880, 0.12], [1320, 0.4, 'sine', 0.05]],
    done: () => [[523, 0.15], [659, 0.15], [784, 0.15], [1047, 0.6]],
    turn: () => [[660, 0.12], [880, 0.18]],
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

    // Vị trí lá trong xấp phải lấy trước khi vẽ lại (để bay từ đó lên bàn).
    const pickFrom = {};
    fresh.filter((e) => e.type === 'pick').forEach((e) => {
      const el = document.querySelector(`#fan .fcard[data-pos="${e.pos}"]`);
      if (el) pickFrom[e.pos] = el.getBoundingClientRect();
    });
    const rid = state.reading ? state.reading.id : 0;
    fresh.filter((e) => e.type === 'flip').forEach((e) => {
      const key = `${rid}:${e.slot}`;
      ui.just.add(key);
      setTimeout(() => ui.just.delete(key), 900);
    });

    const mine = isQuerent();
    if (mine && !ui.wasMine && !first) { play('turn'); if (navigator.vibrate) navigator.vibrate(120); }
    ui.wasMine = mine;

    render();
    fresh.forEach((e) => playEvent(e, pickFrom));
  }

  // ---------------------------------------------------------------- hiệu ứng
  function seatRect(pid) {
    const el = document.querySelector(`#audience [data-pid="${CSS.escape(pid || '')}"] .ava`);
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
      { transform: `translate(${x0}px, ${y0}px) scale(.7) rotate(-12deg)`, opacity: 1 },
      { transform: `translate(${x1}px, ${y1}px) scale(1.2) rotate(0deg)`, opacity: 1 },
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

  function playEvent(e, pickFrom) {
    switch (e.type) {
      case 'shuffle': play('shuffle'); break;
      case 'pick': {
        const slot = document.querySelector(`#board-main .slot[data-slot="${e.slot}"] .slot-card`);
        fly(backHTML(), pickFrom[e.pos], slot && slot.getBoundingClientRect(), { dur: 420 });
        play('pick');
        break;
      }
      case 'flip': play('flip'); break;
      case 'done': play('done'); bubble(e.pid, '✨', 'emoji'); break;
      case 'turn': bubble(e.pid, '🔮', 'emoji'); break;
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
    if (!S || !CARDS.length) return;
    renderTop();
    renderAudience();
    renderBar();
    renderBoard();
    renderHostCfg();
    renderReading();
    renderEmotes();
    renderChat();
    renderHistory();
    tick();
  }

  function renderTop() {
    const r = S.reading;
    $('#phase-pill').textContent = r ? `🔮 Đang xem cho ${r.querent === S.me.id ? 'bạn' : nm(r.querent)}` : '🌙 Đang chờ';
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `${isQuerent() && r.stage !== 'done' ? '🔔 ' : ''}Bói Tarot ${ROOM}`;
  }

  function renderAudience() {
    const r = S.reading;
    const html = S.players.map((p) => {
      const q = r && r.querent === p.id;
      const tags = [];
      if (q) tags.push('<span class="tag q">🔮</span>');
      if (p.queue) tags.push(`<span class="tag" title="Thứ tự xếp hàng">#${p.queue}</span>`);
      if (p.host) tags.push('<span class="tag">👑</span>');
      if (p.count) tags.push(`<span title="Số lần đã xem">🃏${p.count}</span>`);
      const cls = ['seat', q ? 'querent' : '', p.queue ? 'queued' : '', p.id === S.me.id ? 'me' : '', p.connected ? '' : 'off'].join(' ');
      return `<div class="${cls}" data-pid="${esc(p.id)}"><div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>
        <div class="name">${p.id === S.me.id ? 'Bạn' : esc(p.name)}</div><div class="meta">${tags.join('')}</div></div>`;
    }).join('');
    setHTML($('#audience'), html);
  }

  function renderBar() {
    const r = S.reading;
    const sp = spreadOf(r);
    const total = sp ? sp.slots.length : 0;
    const myQ = S.queue.indexOf(S.me.id) + 1;
    let msg;
    let btns = '';
    let mine = false;
    if (!r) {
      msg = '🌙 Lều xem bói đang trống<small>Ai muốn xem thì bấm nút bên cạnh — cả phòng sẽ cùng xem nhé.</small>';
      btns = btn('queue', '🙋 Xem bói cho tôi', 'gold');
    } else if (r.querent === S.me.id) {
      mine = r.stage !== 'done';
      if (r.stage === 'setup') msg = '✨ Đến lượt bạn!<small>Nhập câu hỏi, chọn cách trải bài rồi bấm Xáo bài.</small>';
      else if (r.stage === 'shuffle') msg = '🔀 Đang xáo bài…<small>Hãy tập trung nghĩ về câu hỏi của bạn.</small>';
      else if (r.stage === 'pick') msg = `🃏 Hãy rút lá thứ ${r.slots.length + 1}/${total}<small>Chạm vào một lá bất kỳ trong xấp bài úp — hãy tin vào trực giác.</small>`;
      else if (r.stage === 'reveal') {
        msg = '👆 Chạm vào từng lá để lật<small>…hoặc lật tất cả một lượt.</small>';
        btns = btn('flip-all', '✨ Lật tất cả', 'gold');
      } else {
        msg = '🌟 Trải bài đã hoàn tất!<small>Đọc ý nghĩa từng lá bên dưới.</small>';
        btns = S.queue.length
          ? btn('finish', `✅ Nhường lượt cho ${esc(nm(S.queue[0]))}`, 'gold')
          : btn('queue', '🔁 Xem quẻ mới', 'gold') + btn('finish', '✅ Xong', 'ghost');
      }
    } else {
      const q = `<b>${esc(nm(r.querent))}</b>`;
      const lines = {
        setup: `✨ ${q} đang tĩnh tâm và chuẩn bị câu hỏi…`,
        shuffle: `🔀 ${q} đang xáo bài…`,
        pick: `🃏 ${q} đang rút bài (${r.slots.length}/${total})…`,
        reveal: `👀 ${q} đang lật bài…`,
        done: `🌟 Trải bài của ${q} đã hoàn tất!`,
      };
      const sub = myQ ? `Bạn đang xếp hàng thứ ${myQ}.` : 'Muốn xem bói thì xếp hàng nhé.';
      msg = `${lines[r.stage] || ''}<small>${sub}</small>`;
      btns = myQ ? btn('unqueue', 'Rời hàng', 'ghost small') : btn('queue', '🙋 Xếp hàng xem bói', 'primary');
      if (S.me.host) btns += btn('finish', r.stage === 'done' ? '⏭ Chuyển lượt' : '⏭ Bỏ qua lượt', 'ghost small');
    }
    if (r && S.timerKind === 'offline') {
      msg = msg.replace('</small>', ` · ${esc(nm(r.querent))} đang mất kết nối — sẽ nhường lượt nếu không quay lại.</small>`);
    } else if (r && S.timerKind === 'next') {
      msg = msg.replace('</small>', ' · Tự chuyển lượt khi hết giờ.</small>');
    }
    const el = $('#bar');
    el.className = 'bar' + (mine ? ' mine' : '');
    setHTML(el, `<div class="msg-main">${msg}</div>${btns}`);
  }

  function setupHTML() {
    return `<div class="setup"><h3>✨ Hãy tĩnh tâm và nghĩ về điều bạn muốn hỏi</h3>
      <input id="q-input" class="gh-input" maxlength="140" autocomplete="off"
        placeholder="Câu hỏi của bạn (không bắt buộc) — VD: Công việc sắp tới của tôi thế nào?">
      <div class="spreads">${Object.entries(S.spreads).map(([k, s]) => `<button class="spread-opt" data-spread="${k}">
        <span class="si">${s.icon}</span><b>${esc(s.name)}</b><small>${esc(s.hint)}</small></button>`).join('')}</div>
      <div>${btn('begin', '🔀 Xáo bài', 'gold big')}</div></div>`;
  }

  function syncSetup() {
    const input = $('#q-input');
    if (input && input.value !== ui.question) input.value = ui.question;
    document.querySelectorAll('.spread-opt').forEach((b) => b.classList.toggle('on', b.dataset.spread === ui.spread));
  }

  function renderBoard() {
    const r = S.reading;
    const head = $('#board-head');
    const main = $('#board-main');
    const fan = $('#fan');
    if (!r) {
      setHTML(head, '');
      setHTML(main, `<div class="idle"><div class="ball">🔮</div><h3>Lều xem bói đang trống</h3>
        <p>Mỗi lượt một người đặt câu hỏi và tự tay rút bài, cả phòng cùng xem lật bài và luận giải.</p>
        ${btn('queue', '🙋 Xem bói cho tôi', 'gold big')}</div>`);
      setHTML(fan, '');
      return;
    }
    const iAm = r.querent === S.me.id;
    if (r.stage === 'setup') {
      setHTML(head, '');
      if (setHTML(main, iAm ? setupHTML() : `<div class="idle"><div class="ball busy">🔮</div>
          <h3>${esc(nm(r.querent))} đang tĩnh tâm…</h3><p>Đang chọn cách trải bài và nghĩ về câu hỏi.</p></div>`) && iAm) {
        syncSetup();
        const input = $('#q-input');
        if (input && window.innerWidth > 900) input.focus();
      }
      setHTML(fan, '');
      return;
    }
    const sp = spreadOf(r);
    setHTML(head, `<div class="q-who">🔮 ${iAm ? 'Trải bài của bạn' : `Trải bài của ${esc(nm(r.querent))}`} · ${sp.icon} ${esc(sp.name)}</div>
      ${r.question ? `<div class="q-text">“${esc(r.question)}”</div>` : ''}`);

    const cols = Math.max(...sp.slots.map((s) => s[1]));
    const rows = Math.max(...sp.slots.map((s) => s[2]));
    setHTML(main, `<div class="spread rows-${rows}" style="grid-template-columns:repeat(${cols}, auto)">${sp.slots.map((s, i) => `
      <div class="slot" data-slot="${i}" style="grid-column:${s[1]};grid-row:${s[2]}">
        <div class="slot-card"></div><div class="slot-label"><b>${i + 1}</b>${esc(s[0])}</div></div>`).join('')}</div>`);
    sp.slots.forEach((s, i) => {
      const el = main.querySelector(`.slot[data-slot="${i}"] .slot-card`);
      const sl = r.slots[i];
      let h;
      if (!sl) h = `<div class="tcard ghost ${r.stage === 'pick' && i === r.slots.length ? 'next' : ''}"></div>`;
      else if (sl.card === null) h = backHTML(iAm && r.stage === 'reveal' ? 'can' : '');
      else h = faceHTML(sl.card, sl.rev, { cls: ui.just.has(`${r.id}:${i}`) ? 'just' : '' });
      setHTML(el, h);
    });
    renderFan(r, iAm);
  }

  function renderFan(r, iAm) {
    const fan = $('#fan');
    if (r.stage === 'shuffle') {
      setHTML(fan, `<div style="display:flex;justify-content:center"><div class="shuffle">${Array.from({ length: 5 }, () => backHTML()).join('')}</div></div>`);
      return;
    }
    if (r.stage !== 'pick') { setHTML(fan, ''); return; }
    const picked = new Set(r.slots.map((s) => s.pos));
    const rows = window.innerWidth < 560 ? 3 : 2;
    const per = Math.ceil(S.deckSize / rows);
    let html = '';
    for (let row = 0; row < rows; row++) {
      const start = row * per;
      const n = Math.min(per, S.deckSize - start);
      html += '<div class="fan-row">';
      for (let j = 0; j < n; j++) {
        const pos = start + j;
        const t = n > 1 ? j / (n - 1) : 0.5;
        html += `<div class="fcard ${picked.has(pos) ? 'gone' : ''}" data-pos="${pos}" style="left:${4 + t * 92}%;--a:${((t - 0.5) * 36).toFixed(1)}deg"></div>`;
      }
      html += '</div>';
    }
    html += `<div class="fan-hint">${iAm ? '👆 Chạm vào lá bạn cảm thấy “gọi” mình' : `78 lá đang được úp — ${esc(nm(r.querent))} đang chọn…`}</div>`;
    fan.classList.toggle('can', iAm);
    setHTML(fan, html);
  }

  function renderHostCfg() {
    if (!S.me.host) { setHTML($('#host-cfg'), ''); return; }
    setHTML($('#host-cfg'), `<div class="host-cfg"><span>⚙️ Chủ phòng:</span>
      <label><input type="checkbox" data-cfg="reversed" ${S.config.reversed ? 'checked' : ''}> Dùng lá ngược
      <small>(lá rút ra có thể bị lộn ngược, mang nghĩa khác — áp dụng từ lượt xáo bài sau)</small></label></div>`);
  }

  function renderReading() {
    const r = S.reading;
    const el = $('#reading');
    if (!r || !r.spread || !r.slots.some((s) => s.card !== null)) { setHTML(el, ''); return; }
    const cards = r.slots.map((s) => [s.card, s.rev]);
    const done = r.stage === 'done';
    setHTML(el, `<div class="panel"><h3>📖 Luận giải${iAmText(r)}</h3>${readingDetailHTML(cards, r.spread, { summary: done })}</div>`);
  }
  const iAmText = (r) => (r.querent === S.me.id ? '' : ` cho ${esc(nm(r.querent))}`);

  // ---------------------------------------------------------------- biểu cảm & menu người chơi
  const SELF_FX = [['laugh', 'Cười'], ['angry', 'Tức'], ['cry', 'Khóc'], ['shock', 'Sốc'], ['think', 'Nghĩ'], ['clap', 'Vỗ tay'], ['dance', 'Nhảy']];
  const OTHER_FX = [['wave', 'Vẫy tay'], ['heart', 'Thả tim'], ['flower', 'Tặng hoa'], ['tomato', 'Ném cà chua'], ['highfive', 'Đập tay'], ['poke', 'Chọc']];
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }

  function renderEmotes() {
    const html = SELF_FX.map(([k, l]) => `<button class="emo" data-fx="${k}" data-self="1" title="${l}">${FX_EMOJI[k]}</button>`).join('') +
      btn('edit-look', '👗 Nhân vật', 'small') + btn('copy-link', '📨 Mời bạn', 'small') +
      '<span class="hint">Nhấn vào người khác để vẫy tay, thả tim, tặng hoa…</span>';
    setHTML($('#emotes'), html);
  }

  function openMenu(id, seatEl) {
    closeMenu();
    const p = player(id);
    if (!p) return;
    const me = id === S.me.id;
    const items = me ? SELF_FX : OTHER_FX;
    let html = `<div class="pmenu-head">${me ? '🙋 Bạn' : esc(p.name)}</div>
      <div class="pmenu-grid">${items.map(([k, l]) => `<button data-fx="${k}"><span>${FX_EMOJI[k]}</span>${l}</button>`).join('')}</div>`;
    if (me) html += btn('edit-look', '👗 Đổi nhân vật', 'small');
    if (!me && S.me.host) html += `<button class="gh-btn small danger" data-kick="${esc(id)}">🚪 Mời ra khỏi phòng</button>`;
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
      : `<div class="msg"><span class="who" style="color:hsl(${P.hue(m.name || '')},80%,76%)">${esc(m.name)}</span>${esc(m.text)}</div>`)).join('')
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

  function renderHistory() {
    const html = S.history.length ? [...S.history].reverse().map((h) => {
      const sp = S.spreads[h.spread];
      return `<div class="hist" data-hist="${h.id}"><div class="hh"><span class="lt">${fmtTime(h.t)}</span>
        <b>${esc(h.name)}</b> · ${sp.icon} ${esc(sp.name)}</div>
        ${h.question ? `<div class="hq">“${esc(h.question)}”</div>` : ''}
        <div class="hcards">${h.cards.map(([c, r]) => faceHTML(c, r, { cls: 'xs' })).join('')}</div></div>`;
    }).join('') : '<div class="empty-note">Chưa có lượt xem nào. Các trải bài đã xem sẽ được lưu ở đây.</div>';
    setHTML($('#history-list'), html);
  }

  function openHistory(id) {
    const h = S.history.find((x) => x.id === id);
    if (!h) return;
    const sp = S.spreads[h.spread];
    const m = P.modal({
      title: `🔮 ${esc(h.name)} · ${sp.icon} ${esc(sp.name)}`,
      body: `${h.question ? `<p><i>“${esc(h.question)}”</i></p>` : ''}${readingDetailHTML(h.cards, h.spread)}`,
      actions: [{ label: 'Đóng', kind: 'primary' }],
    });
    m.el.querySelector('.gh-modal').classList.add('wide');
  }

  const DECK_GROUPS = [['major', '🌟 Ẩn Chính'], ['wands', '🔥 Gậy'], ['cups', '🏆 Cốc'], ['swords', '⚔️ Kiếm'], ['pentacles', '💰 Tiền']];
  function renderDeck() {
    setHTML($('#deck-filter'), DECK_GROUPS.map(([k, l]) => `<button data-deck="${k}" class="${ui.deckFilter === k ? 'on' : ''}">${l}</button>`).join(''));
    const list = CARDS.filter((c) => c.arc === ui.deckFilter);
    setHTML($('#deck-list'), `<div class="deck-grid">${list.map((c) => `<div class="deck-item" data-card="${c.id}">${faceHTML(c.id, false)}<span>${esc(c.name)}</span></div>`).join('')}</div>`);
  }

  function openCard(cid) {
    const c = CARDS[cid];
    const m = P.modal({
      title: `${esc(c.name)} <span class="gh-muted" style="font-size:14px;font-weight:500">· ${esc(c.en)}</span>`,
      body: `<div class="card-detail">${faceHTML(cid, false)}<div class="cd-text">
        <div><h4>⬆️ Chiều xuôi</h4><div class="kw">🔑 ${esc(c.up[0])}</div><p>${esc(c.up[1])}</p></div>
        <div><h4>⬇️ Chiều ngược</h4><div class="kw">🔑 ${esc(c.rev[0])}</div><p>${esc(c.rev[1])}</p></div></div></div>`,
      actions: [{ label: 'Đóng', kind: 'primary' }],
    });
    m.el.querySelector('.gh-modal').classList.add('wide');
  }

  function renderRules() {
    $('#rules').innerHTML = `
      <h4>🔮 Lều xem bói</h4><p>Mỗi lượt một người ngồi “ghế xem bói”, cả phòng cùng xem bài được rút và lật. Ai muốn xem thì bấm <b>Xếp hàng</b>, xong lượt sẽ tự đến người kế tiếp.</p>
      <h4>✨ Các bước</h4><ul>
        <li><b>Đặt câu hỏi</b> (không bắt buộc) — càng cụ thể càng dễ luận.</li>
        <li><b>Chọn cách trải bài</b>: 1 lá thông điệp, 3 lá Quá khứ · Hiện tại · Tương lai, Tình yêu, Tâm · Thân · Trí, Hai lựa chọn hoặc Chữ thập 5 lá.</li>
        <li><b>Xáo bài</b> rồi tự tay <b>rút</b> từng lá trong xấp 78 lá úp — lá nào cũng có thể là lá bất kỳ, kể cả bạn cũng không biết trước.</li>
        <li><b>Lật bài</b> từng lá để xem ý nghĩa theo vị trí của nó.</li></ul>
      <h4>📚 Bộ bài</h4><p>22 lá <b>Ẩn Chính</b> (những bài học lớn) và 56 lá <b>Ẩn Phụ</b> chia 4 chất: 🔥 Gậy (hành động), 🏆 Cốc (cảm xúc), ⚔️ Kiếm (lý trí), 💰 Tiền (vật chất). Xem ý nghĩa từng lá ở tab <b>Bộ bài</b>.</p>
      <h4>🔄 Lá ngược</h4><p>Lá rút ra bị lộn ngược mang nghĩa ngược lại hoặc năng lượng bị tắc nghẽn. Chủ phòng có thể tắt lá ngược.</p>
      <h4>⏱ Nhường lượt</h4><p>Người xem mất kết nối quá 20 giây sẽ bị nhường lượt. Xem xong mà có người đang chờ thì sau 60 giây tự chuyển lượt. Chủ phòng có thể bỏ qua một lượt.</p>
      <h4>💡 Lưu ý</h4><p>Tarot chỉ mang tính giải trí và gợi mở suy ngẫm — đừng dùng nó thay cho những quyết định quan trọng nhé!</p>`;
  }

  // ---------------------------------------------------------------- đồng hồ
  function tick() {
    const timer = $('#timer');
    const fill = $('#timebar-fill');
    if (!S || !S.deadline || S.timerKind === 'shuffle') { timer.hidden = true; fill.style.width = '0'; return; }
    const remaining = Math.max(0, S.deadline - (Date.now() / 1000 + clockOffset));
    const secs = Math.ceil(remaining);
    const frac = S.total ? Math.min(1, remaining / S.total) : 0;
    timer.hidden = false;
    timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    fill.style.width = `${frac * 100}%`;
  }
  setInterval(tick, 250);

  // ---------------------------------------------------------------- sự kiện
  const inviteLink = () => `${ui.lanBase || location.origin}/g/tarot/?room=${ROOM}`;

  function begin() {
    const input = $('#q-input');
    if (input) ui.question = input.value.trim();
    send('begin', { spread: ui.spread, question: ui.question });
  }

  document.addEventListener('click', async (e) => {
    const fcard = e.target.closest('#fan.can .fcard:not(.gone)');
    if (fcard) { send('pick', { pos: Number(fcard.dataset.pos) }); return; }

    const back = e.target.closest('#board-main .tcard.back.can');
    if (back) { send('flip', { slot: Number(back.closest('.slot').dataset.slot) }); return; }

    const spreadEl = e.target.closest('[data-spread]');
    if (spreadEl) { ui.spread = spreadEl.dataset.spread; syncSetup(); return; }

    const histEl = e.target.closest('[data-hist]');
    if (histEl) { openHistory(Number(histEl.dataset.hist)); return; }

    const deckEl = e.target.closest('[data-deck]');
    if (deckEl) { ui.deckFilter = deckEl.dataset.deck; renderDeck(); $('#deck-list').scrollTop = 0; return; }

    const cardEl = e.target.closest('.deck-item[data-card]');
    if (cardEl) { openCard(Number(cardEl.dataset.card)); return; }

    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled && actEl.dataset.act) {
      switch (actEl.dataset.act) {
        case 'queue': send('queue'); break;
        case 'unqueue': send('unqueue'); break;
        case 'begin': begin(); break;
        case 'flip-all': send('flip_all'); break;
        case 'finish': send('finish'); break;
        case 'edit-look': openLookEditor(); break;
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

  document.addEventListener('input', (e) => {
    if (e.target.id === 'q-input') ui.question = e.target.value;
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.id === 'q-input' && e.key === 'Enter') begin();
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-cfg]');
    if (el) send('config', { [el.dataset.cfg]: el.checked });
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
  }));

  $('#btn-sound').addEventListener('click', () => {
    ui.sound = !ui.sound;
    try { localStorage.setItem('tarot_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) play('pick');
  });

  $('#btn-room').addEventListener('click', async () => {
    if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good');
  });

  $('#btn-leave').addEventListener('click', () => {
    if (conn) conn.leave();
    setTimeout(() => { location.href = '/'; }, 150);
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (S && S.reading) renderFan(S.reading, isQuerent()); }, 150);
  });

  // Nếu mở bằng localhost thì link mời dùng địa chỉ LAN để bạn bè vào được.
  fetch('/api/info').then((r) => r.json()).then((inf) => {
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    const lan = location.protocol === 'https:' ? inf.https : inf.urls;
    if (local && lan && lan.length) ui.lanBase = lan[0];
  }).catch(() => {});

  renderRules();
  $('#room-code').textContent = ROOM;
  fetch('cards.json').then((r) => r.json()).then((cards) => {
    CARDS = cards;
    renderDeck();
    render();
  }).catch(() => P.toast('Không tải được bộ bài — hãy tải lại trang.', 'error', 8000));
  P.ensureName(() => connect());
})();
