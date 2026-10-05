(function () {
  const P = window.Platform;
  const $ = (s) => document.querySelector(s);
  const esc = P.esc;
  const ROOM = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (!ROOM) { location.href = '/'; return; }

  let S = null;          // trạng thái mới nhất từ máy chủ
  let voice = null;      // voice chat (tạo khi người chơi bật mic)
  let voiceInfo = { peers: [], muted: [], to: [], from: [] };
  let httpsBase = null;  // địa chỉ HTTPS của máy chủ (cần để dùng mic qua LAN)
  let conn = null;
  let clockOffset = 0;   // giờ máy chủ - giờ máy mình
  const ui = {
    selected: null, heal: false, poisonMode: false, poison: null,
    actionKey: '', phaseKey: '', tab: 'chat', unread: 0, lastChatId: null,
    peek: false, voice: false, accent: 'north', lanBase: null, revealModal: null,
  };
  try {
    ui.voice = localStorage.getItem('ww_voice') === '1';
    if (localStorage.getItem('ww_accent') === 'south') ui.accent = 'south';
  } catch (e) { /* bỏ qua */ }

  const PHASES = {
    lobby: ['🏠', 'Phòng chờ'], reveal: ['🃏', 'Nhận vai'], night: ['🌙', 'Ban đêm'], witch: ['🌙', 'Ban đêm'],
    day: ['☀️', 'Thảo luận'], vote: ['⚖️', 'Bỏ phiếu'], verdict: ['⚖️', 'Phán quyết'],
    hunter: ['🏹', 'Thợ Săn'], end: ['🏁', 'Kết thúc'],
  };
  const THEME = { lobby: 'lobby', reveal: 'night', night: 'night', witch: 'night', end: 'end' };
  const INPUT_KINDS = ['wolf_vote', 'seer', 'guard', 'witch', 'vote', 'hunter'];

  // ---------------------------------------------------------------- tiện ích
  const htmlCache = new Map();
  function setHTML(el, html) {
    if (htmlCache.get(el) === html) return false;
    htmlCache.set(el, html);
    el.innerHTML = html;
    return true;
  }
  const player = (id) => (S && S.players.find((p) => p.id === id)) || null;
  const nm = (id) => { const p = player(id); return p ? p.name : '?'; };
  const role = (r) => S.roleInfo[r];
  const roleLabel = (r) => `${role(r).icon} ${role(r).name}`;
  const send = (action, data) => conn && conn.send(action, data);
  const fmtTime = (t) => { const d = new Date(t * 1000); return d.toTimeString().slice(0, 5); };
  const stripEmoji = (s) => s.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2B00}-\u{2BFF}]/gu, '').trim();

  // ---------------------------------------------------------------- giọng quản trò (tiếng Việt)
  // Đọc bằng MP3 tiếng Việt do máy chủ tạo (/api/tts) để giọng giống nhau trên mọi máy — Chrome
  // không có sẵn giọng Việt. Chrome/điện thoại chặn phát âm thanh khi người dùng chưa chạm vào trang,
  // và iPhone chỉ cho phát trên phần tử đã từng được phát trong lúc chạm. Vì vậy dùng MỘT phần tử
  // <audio> duy nhất, “mở khoá” ở lần chạm đầu tiên; câu nào bị chặn thì giữ lại và đọc bù khi người
  // dùng chạm màn hình. Mỗi người chọn một giọng (Bắc / Nam) và chỉ nghe đúng giọng đó — câu nào
  // máy chủ không đọc được thì bỏ qua, không đổi sang giọng khác (kể cả giọng có sẵn của trình duyệt).
  const narrator = (() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.setAttribute('playsinline', '');
    let unlocked = false;
    let pending = null;      // câu bị chặn vì chưa chạm vào trang: { text, at }
    let current = '';
    let hinted = false;
    let warned = false;

    // Một đoạn WAV im lặng rất ngắn để mở khoá phần tử <audio> trong lúc người dùng chạm.
    const SILENT = (() => {
      const n = 800;
      const buf = new Uint8Array(44 + n);
      const dv = new DataView(buf.buffer);
      const str = (o, t) => { for (let i = 0; i < t.length; i++) buf[o + i] = t.charCodeAt(i); };
      str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVEfmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
      str(36, 'data'); dv.setUint32(40, n, true); buf.fill(128, 44);
      let bin = '';
      buf.forEach((b) => { bin += String.fromCharCode(b); });
      return 'data:audio/wav;base64,' + btoa(bin);
    })();

    const url = (text) => `/api/tts?accent=${ui.accent}&text=${encodeURIComponent(text)}`;

    function unlock() {
      if (unlocked) return;
      unlocked = true;
      if (pending) {
        // Đọc bù câu bị chặn — nhưng chờ một chút: nếu chính cú chạm này làm chuyển giai đoạn
        // (VD chủ phòng bấm ⏭) thì câu cũ đã lỗi thời, bỏ luôn để không bị đọc lại.
        const p = pending;
        setTimeout(() => {
          if (pending === p && p.phase === ui.phaseKey && Date.now() - p.at < 20000) {
            pending = null;
            say(p.text);
          }
        }, 400);
        return;
      }
      if (current) return;  // đang có câu được phát — không chen đoạn im lặng vào
      audio.src = SILENT;
      audio.play().catch((e) => { if (e && e.name === 'NotAllowedError') unlocked = false; });
    }
    // Trình duyệt chỉ coi là “người dùng đã tương tác” ở lúc nhấc tay (chạm) / click / gõ phím,
    // không phải lúc vừa chạm xuống — nên mở khoá ở các sự kiện này.
    ['pointerup', 'touchend', 'click', 'keydown'].forEach((ev) => document.addEventListener(ev, unlock, { capture: true, passive: true }));

    audio.addEventListener('error', () => {
      if (!current) return;
      current = '';
      if (!warned) {
        warned = true;
        P.toast(ui.accent === 'north'
          ? 'Quản trò không đọc được câu này (dịch vụ giọng Bắc đang chập chờn). Nếu hay bị, hãy thử chuyển sang “Giọng Nam”.'
          : 'Quản trò không đọc được câu này — máy chủ cần có kết nối Internet.', 'error', 7000);
      }
    });

    function stop() {
      current = '';
      pending = null;
      audio.pause();
    }

    // Tạo sẵn trên máy chủ (và lưu vào bộ nhớ đệm của trình duyệt) những câu cố định, để lúc cần đọc là có ngay.
    const warmed = new Set();
    function prefetch(lines) {
      lines.forEach((t) => {
        const u = url(t);
        if (warmed.has(u)) return;
        warmed.add(u);
        fetch(u).catch(() => warmed.delete(u));
      });
    }

    function say(text) {
      stop();
      current = text;
      audio.src = url(text);
      audio.play().then(() => { unlocked = true; }).catch((e) => {
        if (!e || e.name !== 'NotAllowedError' || current !== text) return;
        // Trình duyệt chặn vì chưa chạm vào trang: giữ câu lại, đọc khi người dùng chạm.
        unlocked = false;
        pending = { text, at: Date.now(), phase: ui.phaseKey };
        if (!hinted) {
          hinted = true;
          P.toast('🔊 Chạm vào màn hình một lần để nghe giọng quản trò.', 'info', 6000);
        }
      });
    }

    return { say, stop, prefetch };
  })();

  function stopSpeak() { narrator.stop(); }
  let lastSpoken = '';
  // Mỗi câu chỉ đọc một lần trong một giai đoạn (bỏ qua giờ, kết nối lại… không làm đọc lại).
  // `force` dùng cho câu xác nhận khi người chơi tự bấm (bật giọng, đổi giọng).
  function speak(text, { force = false } = {}) {
    if (!ui.voice || !text) return;
    text = stripEmoji(text);
    if (!text) return;
    const key = `${ui.phaseKey}|${text}`;
    if (!force && key === lastSpoken) return;
    lastSpoken = key;
    narrator.say(text);
  }
  // Các câu quản trò không đổi theo ván — đọc sẵn khi bật giọng.
  const FIXED_LINES = [
    'Đã bật giọng quản trò.', 'Ván đấu bắt đầu. Mỗi người hãy bí mật xem vai trò của mình.',
    'Phù Thủy thức dậy.', 'Đã đến giờ bỏ phiếu treo cổ.',
    ...[1, 2, 3].map((r) => `Đêm thứ ${r}. Màn đêm buông xuống, cả làng đi ngủ. Ma Sói, Tiên Tri và Bảo Vệ hãy thức dậy.`),
  ];
  function warmNarrator() { if (ui.voice) narrator.prefetch(FIXED_LINES); }

  // ---------------------------------------------------------------- kết nối
  function connect() {
    conn = P.connect({
      room: ROOM,
      onState,
      onFx: (m) => { if (scene) scene.fx(m); },
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
    const a = state.action;
    const actionKey = `${state.phase}:${state.round}:${a ? a.kind : ''}`;
    if (actionKey !== ui.actionKey) {
      ui.actionKey = actionKey;
      ui.selected = null; ui.heal = false; ui.poisonMode = false; ui.poison = null;
      if (a && INPUT_KINDS.includes(a.kind) && navigator.vibrate) navigator.vibrate(150);
    }
    const phaseKey = `${state.phase}:${state.round}`;
    if (phaseKey !== ui.phaseKey) {
      const first = !ui.phaseKey;
      ui.phaseKey = phaseKey;
      onPhaseChange(first);
    }
    render();
  }

  function onPhaseChange(first) {
    if (ui.revealModal && S.phase !== 'reveal') { ui.revealModal.close(); ui.revealModal = null; }
    if (S.phase === 'reveal' && S.action && !S.action.done) openReveal();
    if (S.phase !== 'end') ui.peek = false;
    if (first) return;
    const news = (S.news || []).join('. ');
    const lines = {
      reveal: 'Ván đấu bắt đầu. Mỗi người hãy bí mật xem vai trò của mình.',
      night: `Đêm thứ ${S.round}. Màn đêm buông xuống, cả làng đi ngủ. Ma Sói, Tiên Tri và Bảo Vệ hãy thức dậy.`,
      witch: 'Phù Thủy thức dậy.',
      day: `Trời sáng rồi. ${news}. Mọi người hãy thảo luận.`,
      vote: 'Đã đến giờ bỏ phiếu treo cổ.',
      verdict: news,
      hunter: news,
      end: news,
    };
    speak(lines[S.phase]);
  }

  // ---------------------------------------------------------------- vẽ giao diện
  function render() {
    if (!S) return;
    renderTop();
    renderBanner();
    renderMyRole();
    renderAction();
    renderLobby();
    renderPlayers();
    renderChat();
    renderLog();
    renderRoles();
    renderVoice();
    tick();
  }

  function renderTop() {
    const theme = THEME[S.phase] || 'day';
    document.body.className = 't-' + theme;
    const [icon, label] = PHASES[S.phase] || ['', S.phase];
    const round = S.round && !['lobby', 'end', 'reveal'].includes(S.phase) ? ` · ${S.round}` : '';
    $('#phase-pill').textContent = `${icon} ${label}${round}`;
    $('#room-code').textContent = ROOM;
    $('#btn-voice').textContent = ui.voice ? '🔊' : '🔇';
    document.title = `${icon} ${label} · Ma Sói ${ROOM}`;
  }

  function newsHTML() {
    if (!S.news || !S.news.length) return '';
    return `<div class="news">${S.news.map((n) => `<div>${esc(n)}</div>`).join('')}</div>`;
  }

  function renderBanner() {
    const n = S.players.length;
    let big = '', title = '', sub = '', extra = '', cls = 'banner';
    switch (S.phase) {
      case 'lobby':
        big = '🏡'; title = 'Phòng chờ';
        sub = `${n} người đã vào · cần tối thiểu ${S.minPlayers} người. ` +
          (S.me.host ? 'Bạn là chủ phòng — hãy chỉnh vai trò rồi bắt đầu!' : 'Chờ chủ phòng bắt đầu ván đấu…');
        break;
      case 'reveal':
        big = '🃏'; title = 'Ván đấu bắt đầu!';
        sub = 'Hãy bí mật xem vai trò của bạn — đừng để ai nhìn thấy màn hình nhé 👀';
        break;
      case 'night':
        big = '🌙'; title = `Đêm thứ ${S.round}`;
        sub = 'Cả làng chìm vào giấc ngủ… Ma Sói, Tiên Tri và Bảo Vệ thức dậy.';
        break;
      case 'witch':
        big = '🌙'; title = `Đêm thứ ${S.round}`;
        sub = 'Phù Thủy thức dậy và cân nhắc những bình thuốc của mình…';
        break;
      case 'day':
        big = '☀️'; title = `Ngày thứ ${S.round}`;
        sub = 'Hãy thảo luận: ai là Ma Sói đang ẩn mình?'; extra = newsHTML();
        break;
      case 'vote':
        big = '⚖️'; title = 'Bỏ phiếu treo cổ';
        sub = 'Chọn người bạn nghi ngờ nhất. Bạn có thể đổi phiếu trước khi hết giờ.';
        break;
      case 'verdict':
        big = '⚖️'; title = 'Phán quyết'; extra = newsHTML();
        break;
      case 'hunter':
        big = '🏹'; title = 'Phát súng cuối cùng'; extra = newsHTML();
        break;
      case 'end':
        big = S.winner === 'wolf' ? '🐺' : '🎉';
        title = S.winner === 'wolf' ? 'Phe Ma Sói chiến thắng!' : 'Phe Dân Làng chiến thắng!';
        sub = 'Toàn bộ vai trò đã được tiết lộ bên dưới.';
        cls += ' win-' + S.winner;
        break;
      default:
        title = S.phase;
    }
    setHTML($('#banner'), `<div class="${cls}"><div class="big">${big}</div><h1>${esc(title)}</h1>
      ${sub ? `<p class="sub">${esc(sub)}</p>` : ''}${extra}</div>`);
  }

  function renderMyRole() {
    const r = S.me.role;
    if (!r) { setHTML($('#myrole'), ''); return; }
    const info = role(r);
    const shown = ui.peek || S.phase === 'end';
    let extra = '';
    if (r === 'werewolf') {
      const mates = S.players.filter((p) => p.role === 'werewolf' && p.id !== S.me.id).map((p) => p.name);
      extra = `<div class="potions">🐺 Đồng bọn: ${mates.length ? esc(mates.join(', ')) : 'không có — bạn là Sói đơn độc'}</div>`;
    }
    if (r === 'witch' && S.me.potions) {
      extra = `<div class="potions">💚 Thuốc cứu: ${S.me.potions.heal ? 'còn' : 'đã dùng'} · ☠️ Thuốc độc: ${S.me.potions.poison ? 'còn' : 'đã dùng'}</div>`;
    }
    const status = S.me.alive ? '' : ' · 💀 Đã chết';
    setHTML($('#myrole'), `<div class="myrole ${shown ? '' : 'hidden'} team-${info.team}" data-act="peek">
      <div class="ricon">${info.icon}</div>
      <div class="rtext"><div class="rname">Bạn là ${esc(info.name)}${status}</div>
        <div class="rdesc">${esc(info.desc)}</div>${shown ? extra : ''}</div>
      <div class="peek">${shown ? '🙈 Ẩn' : '👁 Nhấn để xem'}</div></div>`);
  }

  function btn(act, label, kind = '', extra = '') {
    return `<button class="gh-btn ${kind}" data-act="${act}" ${extra}>${label}</button>`;
  }

  function renderAction() {
    const a = S.action;
    const el = $('#action');
    let html = '';
    let attention = false;
    if (S.phase === 'end') {
      html = `<div class="prompt"><span class="emo">🏁</span>Ván đấu đã kết thúc</div>
        <div class="btns">${S.me.host ? btn('play-again', '🔁 Chơi ván mới', 'primary') : '<span class="hint">Đang chờ chủ phòng bắt đầu ván mới…</span>'}
        ${btn('home', '🏠 Về sảnh', 'ghost')}</div>`;
    } else if (a) {
      attention = INPUT_KINDS.includes(a.kind);
      html = actionHTML(a);
    }
    el.className = 'action' + (attention ? ' attention' : '');
    setHTML(el, html);
    fitAction();
  }

  // Bảng hành động nằm đè lên phần trời của khung cảnh; khung cảnh dành chỗ phía trên
  // đúng bằng chiều cao bảng (--sc-top) để không che nhân vật nào.
  let actionTop = -1;
  function fitAction() {
    const el = $('#action');
    const sceneEl = $('#scene');
    const top = el.innerHTML ? Math.ceil(el.offsetHeight) + 16 : 0;
    if (top === actionTop) return;
    actionTop = top;
    sceneEl.style.setProperty('--sc-top', top + 'px');
    if (scene) scene.layout();
  }
  if (window.ResizeObserver) new ResizeObserver(() => fitAction()).observe($('#action'));

  function actionHTML(a) {
    const sel = (id) => (id ? `<b class="sel">${esc(nm(id))}</b>` : '<i>chưa chọn</i>');
    switch (a.kind) {
      case 'reveal':
        return a.done
          ? `<div class="prompt"><span class="emo">⏳</span>Đang chờ mọi người xem vai trò… (${S.readyCount}/${S.readyNeeded})</div>
             ${S.me.host ? `<div class="btns">${btn('skip', '⏭ Bắt đầu đêm ngay', 'ghost small')}</div>` : ''}`
          : `<div class="prompt"><span class="emo">🃏</span>Bạn đã nhận được vai trò!</div>
             <div class="btns">${btn('open-reveal', '👀 Xem lá bài của tôi', 'primary')}</div>`;
      case 'sleep':
        return `<div class="sleeping"><div class="zzz">😴</div>
          <div class="prompt" style="justify-content:center">Bạn đang ngủ say…</div>
          <p class="hint">${esc(a.text || 'Hãy nhắm mắt và chờ trời sáng. Đừng để lộ gì nhé!')}</p></div>`;
      case 'watch':
        return `<div class="prompt"><span class="emo">👀</span>Bạn đang xem ván này</div>
          <p class="hint">Bạn vào giữa ván nên chỉ được xem: không thấy vai của ai, không thấy kênh chat của Sói hay người chết. Tin nhắn của bạn chỉ người xem khác (và người đã chết) đọc được. Ván sau bạn sẽ được nhận vai.</p>`;
      case 'spectate':
        return `<div class="prompt"><span class="emo">👻</span>Bạn đã chết</div>
          <p class="hint">${S.config.reveal_on_death
            ? 'Bạn có thể xem toàn bộ vai trò và trò chuyện với những người đã chết.'
            : 'Ván này không lộ vai trò — bạn chỉ trò chuyện được với những người đã chết.'} Đừng tiết lộ gì cho người còn sống nhé!</p>`;
      case 'wolf_vote':
        return `<div class="prompt"><span class="emo">🐺</span>Chọn con mồi đêm nay</div>
          <p class="hint">Nhấn vào một người chơi. Cả bầy cần thống nhất cùng một mục tiêu (dùng khung chat để bàn bạc). Lựa chọn của bạn: ${sel(a.selected)}</p>`;
      case 'seer':
        return `<div class="prompt"><span class="emo">🔮</span>Bạn muốn soi ai đêm nay?</div>
          <p class="hint">Nhấn vào một người chơi rồi xác nhận. Đã chọn: ${sel(ui.selected)}</p>
          <div class="btns">${btn('seer-confirm', '🔮 Soi người này', 'primary', ui.selected ? '' : 'disabled')}</div>`;
      case 'guard':
        return `<div class="prompt"><span class="emo">🛡️</span>Bạn muốn bảo vệ ai đêm nay?</div>
          <p class="hint">Có thể tự bảo vệ mình${a.lastGuarded ? `, nhưng không được chọn lại <b>${esc(nm(a.lastGuarded))}</b> (đã bảo vệ đêm trước)` : ''}. Đã chọn: ${sel(ui.selected)}</p>
          <div class="btns">${btn('guard-confirm', '🛡️ Bảo vệ', 'primary', ui.selected ? '' : 'disabled')}
          ${btn('guard-none', 'Không bảo vệ ai', 'ghost')}</div>`;
      case 'witch': {
        const victim = a.victim
          ? `<div class="witch-victim">🩸 Đêm nay Ma Sói đã tấn công <b>${esc(nm(a.victim))}</b>${a.victim === S.me.id ? ' (chính bạn!)' : ''}.</div>`
          : '<div class="witch-victim">🌫️ Đêm nay Ma Sói không tấn công ai.</div>';
        return `<div class="prompt"><span class="emo">🧪</span>Phù Thủy, bạn sẽ làm gì?</div>${victim}
          <div class="btns">
            ${a.canHeal ? btn('witch-heal', ui.heal ? '💚 Sẽ cứu người này' : '💚 Dùng thuốc cứu', 'toggle' + (ui.heal ? ' on' : '')) : ''}
            ${a.canPoison ? btn('witch-poison', ui.poisonMode ? `☠️ Đầu độc: ${ui.poison ? esc(nm(ui.poison)) : 'chọn người…'}` : '☠️ Dùng thuốc độc', 'toggle poison' + (ui.poisonMode ? ' on' : '')) : ''}
          </div>
          ${ui.poisonMode ? '<p class="hint">Nhấn vào người chơi bạn muốn đầu độc.</p>' : ''}
          <div class="btns">${btn('witch-confirm', '✅ Xác nhận', 'primary', (ui.heal || (ui.poisonMode && ui.poison)) ? '' : 'disabled')}
            ${btn('witch-none', 'Không dùng thuốc', 'ghost')}</div>`;
      }
      case 'discuss':
        return `<div class="prompt"><span class="emo">🗣️</span>Thời gian thảo luận</div>
          <p class="hint">Trò chuyện, nghi ngờ, bào chữa! Khi tất cả đã sẵn sàng, phần bỏ phiếu sẽ bắt đầu ngay. (${S.readyCount}/${S.readyNeeded} sẵn sàng)</p>
          <div class="btns">${btn('ready', a.ready ? '✅ Đã sẵn sàng (nhấn để huỷ)' : '✋ Sẵn sàng bỏ phiếu', a.ready ? 'good' : 'primary')}
          ${S.me.host ? btn('skip', '⏭ Kết thúc thảo luận', 'ghost') : ''}</div>`;
      case 'vote': {
        const skipCount = Object.values(S.votes || {}).filter((v) => v === 'skip').length;
        const mine = a.selected === 'skip' ? '<b class="sel">Bỏ qua</b>' : sel(a.selected);
        return `<div class="prompt"><span class="emo">⚖️</span>Treo cổ ai?</div>
          <p class="hint">Nhấn vào người bạn nghi là Ma Sói. Phiếu của bạn: ${mine} · Bỏ qua: ${skipCount}</p>
          <div class="btns">${btn('vote-skip', '🤐 Không treo ai', a.selected === 'skip' ? 'good' : 'ghost')}</div>`;
      }
      case 'hunter':
        return `<div class="prompt"><span class="emo">🏹</span>Bạn là Thợ Săn — hãy bắn một người!</div>
          <p class="hint">Người bị bắn sẽ chết ngay lập tức. Đã chọn: ${sel(ui.selected)}</p>
          <div class="btns">${btn('shoot-confirm', '💥 Bắn!', 'danger', ui.selected ? '' : 'disabled')}
          ${btn('shoot-none', 'Không bắn', 'ghost')}</div>`;
      case 'wait_hunter':
        return `<div class="prompt"><span class="emo">🏹</span>Thợ Săn ${esc(nm(S.hunter))} đang ngắm bắn…</div>`;
      default:
        return '';
    }
  }

  function targetMode() {
    const a = S.action;
    if (!a) return null;
    if (['wolf_vote', 'vote', 'seer', 'guard', 'hunter'].includes(a.kind)) return { kind: a.kind, ids: new Set(a.targets) };
    if (a.kind === 'witch' && ui.poisonMode) return { kind: 'poison', ids: new Set(a.targets) };
    return null;
  }

  let scene = null;
  function renderPlayers() {
    if (!scene) scene = new window.WWScene($('#scene'), { onClick: onCharClick });
    const mode = targetMode();
    let selected = null;
    if (mode) {
      if (mode.kind === 'wolf_vote' || mode.kind === 'vote') selected = S.action.selected;
      else if (mode.kind === 'poison') selected = ui.poison;
      else selected = ui.selected;
    }
    scene.update(S, { mode, selected, voice: voiceInfo });
    renderEmotes();
  }

  function onCharClick(id, seatEl) {
    const mode = targetMode();
    if (mode && mode.ids.has(id)) {
      closeMenu();
      if (mode.kind === 'wolf_vote') send('wolf_vote', { target: id });
      else if (mode.kind === 'vote') send('vote', { target: id });
      else if (mode.kind === 'poison') ui.poison = id;
      else ui.selected = ui.selected === id ? null : id;
      render();
      return;
    }
    openMenu(id, seatEl);
  }

  // ---------------------------------------------------------------- tương tác & biểu cảm
  const SELF_FX = [['laugh', '😂', 'Cười'], ['angry', '😡', 'Tức'], ['cry', '😭', 'Khóc'], ['shock', '😱', 'Sốc'],
    ['think', '🤔', 'Nghĩ'], ['clap', '👏', 'Vỗ tay'], ['dance', '💃', 'Nhảy'], ['wave', '👋', 'Vẫy tay']];
  const OTHER_FX = [['wave', '👋', 'Vẫy tay'], ['heart', '❤️', 'Thả tim'], ['flower', '🌹', 'Tặng hoa'],
    ['tomato', '🍅', 'Ném cà chua'], ['highfive', '✋', 'Đập tay'], ['poke', '👉', 'Chọc']];
  let menuEl = null;

  function quietNight() {
    return S && ['night', 'witch'].includes(S.phase) && S.me.playing && S.me.alive;
  }

  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }

  function openMenu(id, seatEl) {
    closeMenu();
    const p = player(id);
    if (!p) return;
    const me = id === S.me.id;
    const items = me ? SELF_FX : OTHER_FX;
    let html = `<div class="pmenu-head">${me ? '🙋 Bạn' : esc(p.name)}${p.bot ? ' 🤖' : ''}</div>`;
    html += quietNight()
      ? '<div class="pmenu-note">🤫 Ban đêm phải ngủ — không thể tương tác.</div>'
      : `<div class="pmenu-grid">${items.map(([k, e, l]) => `<button data-fx="${k}"><span>${e}</span>${l}</button>`).join('')}</div>`;
    if (me) html += btn('edit-look', '👗 Đổi nhân vật', 'small');
    if (!me && S.phase === 'lobby' && S.me.host) html += `<button class="gh-btn small danger" data-kick="${id}">${p.bot ? '🗑 Xoá bot' : '🚪 Mời ra khỏi phòng'}</button>`;
    menuEl = document.createElement('div');
    menuEl.className = 'pmenu';
    menuEl.innerHTML = html;
    document.body.appendChild(menuEl);
    const r = seatEl.getBoundingClientRect();
    const mw = menuEl.offsetWidth;
    const x = Math.min(window.innerWidth - mw / 2 - 8, Math.max(mw / 2 + 8, r.left + r.width / 2));
    let y = r.top + r.height * 0.25;
    if (y - menuEl.offsetHeight < 8) y = menuEl.offsetHeight + 8;
    menuEl.style.left = x + 'px';
    menuEl.style.top = y + 'px';
    menuEl.dataset.target = me ? '' : id;
  }

  function renderEmotes() {
    const html = SELF_FX.map(([k, e, l]) => `<button class="emo" data-fx="${k}" data-self="1" title="${l}">${e}</button>`).join('') +
      btn('edit-look', '👗 Nhân vật', 'small') +
      `<span class="hint">${quietNight() ? '🤫 Ban đêm — hãy giữ im lặng' : 'Nhấn vào nhân vật khác để vẫy tay, thả tim, ném cà chua…'}</span>`;
    setHTML($('#emotes'), html);
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
        onSpeaking: (pid, on) => { if (scene) scene.setSpeaking(pid, on); },
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

  function voiceRuleText() {
    if (!S || !S.me.playing || S.phase === 'lobby' || S.phase === 'end') return '';
    if (!S.me.alive) return '👻 Chỉ hồn ma nghe thấy bạn';
    if (S.phase === 'night' || S.phase === 'witch') {
      return S.me.role === 'werewolf' ? '🐺 Đang nói riêng với bầy Sói' : '🤫 Ban đêm — mic bị khoá';
    }
    return '';
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
      const rule = voiceRuleText();
      html = `<div class="vgroup">
        ${st.listenOnly
          ? '<button class="vbtn warn" data-act="voice-help" title="Chỉ nghe — cần HTTPS hoặc quyền mic để nói">🔈</button>'
          : `<button class="vbtn ${st.muted ? 'off' : 'on'}" data-act="voice-mute" title="${st.muted ? 'Bật mic' : 'Tắt mic'}">${st.muted ? '🔇' : '🎤'}</button>`}
        <button class="vbtn ${st.deaf ? 'off' : ''}" data-act="voice-deaf" title="${st.deaf ? 'Bật loa' : 'Tắt loa'}">${st.deaf ? '🔕' : '🎧'}</button>
        <span class="vinfo" title="Số người trong voice">${rule ? esc(rule) : `👥 ${st.peers} người`}</span>
        <button class="vbtn leave" data-act="voice-off" title="Rời voice">✕</button></div>`;
    }
    setHTML(el, html);
  }

  // ---------------------------------------------------------------- phòng chờ
  const LIMITS = { werewolf: [1, 6], seer: [0, 1], bodyguard: [0, 1], witch: [0, 1], hunter: [0, 1] };
  const TIME_OPTS = {
    night_time: [30, 45, 60, 90, 120],
    discussion_time: [60, 90, 120, 180, 240, 300, 420, 600],
    vote_time: [20, 30, 45, 60, 90],
  };
  const fmtSec = (s) => (s >= 60 ? `${Math.floor(s / 60)} phút${s % 60 ? ` ${s % 60}s` : ''}` : `${s} giây`);

  function inviteLink() {
    const base = ui.lanBase || location.origin;
    return `${base}/g/werewolf/?room=${ROOM}`;
  }

  function renderLobby() {
    const el = $('#lobby');
    if (S.phase !== 'lobby') { setHTML(el, ''); return; }
    const host = S.me.host;
    const cfg = S.config;
    const comp = S.composition;
    const rows = S.roleOrder.map((r) => {
      const info = S.roleInfo[r];
      let control;
      if (r === 'villager') {
        control = `<div class="stepper"><b>${comp.villager || 0}</b></div>`;
      } else {
        const v = cfg.roles[r] || 0;
        const [lo, hi] = LIMITS[r];
        control = host
          ? `<div class="stepper"><button data-step="${r}" data-d="-1" ${v <= lo ? 'disabled' : ''}>−</button><b>${v}</b>
             <button data-step="${r}" data-d="1" ${v >= hi ? 'disabled' : ''}>+</button></div>`
          : `<div class="stepper"><b>${v}</b></div>`;
      }
      return `<div class="role-row" title="${esc(info.desc)}"><span class="ri">${info.icon}</span><span class="rn">${esc(info.name)}</span>${control}</div>`;
    }).join('');

    const select = (key, label) => {
      const opts = TIME_OPTS[key].includes(cfg[key]) ? TIME_OPTS[key] : [...TIME_OPTS[key], cfg[key]].sort((x, y) => x - y);
      return `<div class="setting"><label>${label}</label>
        <select data-cfg="${key}" ${host ? '' : 'disabled'}>${opts.map((o) => `<option value="${o}" ${o === cfg[key] ? 'selected' : ''}>${fmtSec(o)}</option>`).join('')}</select></div>`;
    };

    const start = host
      ? `<div class="start-row"><div>${S.startError ? `<span class="warn">⚠️ ${esc(S.startError)}</span>` : '<span class="gh-muted">Mọi thứ đã sẵn sàng!</span>'}</div>
         ${btn('start', '🎬 Bắt đầu ván đấu', 'primary', S.startError ? 'disabled' : '')}</div>`
      : '<div class="start-row"><span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu ván đấu…</span></div>';

    setHTML(el, `<div class="lobby">
      <div class="panel"><h3>📨 Mời bạn bè</h3>
        <div class="invite"><div class="bigcode">${ROOM}</div><div class="link">${esc(inviteLink())}</div>
        ${btn('copy-link', '⧉ Sao chép link', 'small')} ${btn('edit-look', '👗 Đổi nhân vật', 'small')}</div></div>
      ${host ? botPanel() : ''}
      <div class="panel"><h3><span class="grow">🎭 Vai trò trong ván (${S.players.length} người)</span>
        ${host ? btn('auto-roles', cfg.auto_roles ? '✨ Tự động: BẬT' : '✨ Tự động', 'small ' + (cfg.auto_roles ? 'good' : '')) : ''}</h3>
        <div class="role-rows">${rows}</div></div>
      <div class="panel"><h3>⚙️ Cài đặt</h3><div class="settings">
        ${select('night_time', '🌙 Thời gian ban đêm')}${select('discussion_time', '🗣️ Thời gian thảo luận')}${select('vote_time', '⚖️ Thời gian bỏ phiếu')}
        <label class="switch"><input type="checkbox" data-cfg="reveal_on_death" ${cfg.reveal_on_death ? 'checked' : ''} ${host ? '' : 'disabled'}> <span>Lộ vai trò khi chết<small>Tắt: cả người đã chết cũng không xem được vai người khác</small></span></label>
      </div></div>
      <div class="panel">${start}</div></div>`);
  }

  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    const full = n >= S.maxPlayers;
    const fillTo = Math.max(n < 8 ? 8 : n + 1, S.minPlayers);
    return `<div class="panel"><h3><span class="grow">🤖 Người chơi ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Không đủ người? Thêm bot để test — bot tự nhận vai, hành động ban đêm, trò chuyện và bỏ phiếu.</p>
      <div class="btns-row">
        ${btn('add-bot', '＋ 1 bot', 'small', full ? 'disabled' : '', ) }
        ${btn('add-bot-3', '＋ 3 bot', 'small', full ? 'disabled' : '')}
        ${btn('fill-bots', `Lấp đủ ${Math.min(fillTo, S.maxPlayers)} người`, 'small primary', full ? 'disabled' : '')}
        ${bots ? btn('remove-bots', '🗑 Xoá hết bot', 'small ghost') : ''}
      </div></div>`;
  }

  // ---------------------------------------------------------------- thanh bên
  function renderChat() {
    const list = $('#chat-list');
    const msgs = S.chat;
    const lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const html = msgs.length ? msgs.map((m) => {
      if (m.channel === 'system') return `<div class="msg system">${esc(m.text)}</div>`;
      const ch = m.channel === 'wolf' ? '<span class="ch wolf">🐺 SÓI</span>' : m.channel === 'dead' ? '<span class="ch dead">👻 MA</span>'
        : m.channel === 'spec' ? '<span class="ch spec">👀 XEM</span>' : '';
      return `<div class="msg ${m.channel}">${ch}<span class="who" style="color:hsl(${P.hue(m.name || '')},80%,72%)">${esc(m.name)}</span>${esc(m.text)}</div>`;
    }).join('') : '<div class="empty-note">Chưa có tin nhắn nào. Chào mọi người đi! 👋</div>';
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

    const ch = S.chatChannel;
    const input = $('#chat-input');
    input.disabled = !ch;
    $('#chat-channel').textContent = { all: '💬', wolf: '🐺', dead: '👻', spec: '👀' }[ch] || '🤫';
    input.placeholder = {
      all: 'Nhập tin nhắn…', wolf: 'Bàn bạc riêng với bầy Sói…', dead: 'Chỉ người đã chết mới thấy…',
      spec: 'Chat với người xem (người chơi còn sống không thấy)…',
    }[ch] || 'Ban đêm — dân làng đang ngủ 🤫';
  }

  function renderLog() {
    const items = [
      ...S.log.map((l) => ({ ...l, priv: false })),
      ...S.private.map((l) => ({ ...l, priv: true })),
    ].sort((x, y) => x.t - y.t);
    const html = items.length ? items.map((l) =>
      `<div class="log-item ${l.priv ? 'private' : ''} ${esc(l.kind)}"><span class="lt">${fmtTime(l.t)}</span>${l.priv ? '🔒 ' : ''}${esc(l.text)}</div>`,
    ).join('') : '<div class="empty-note">Nhật ký sẽ ghi lại diễn biến ván đấu và thông tin bí mật của riêng bạn.</div>';
    const list = $('#log-list');
    if (setHTML(list, html)) list.scrollTop = list.scrollHeight;
  }

  function renderRoles() {
    const comp = S.composition || {};
    const html = `<div class="gh-muted" style="font-size:13px">Các vai trò ${S.phase === 'lobby' ? 'dự kiến' : ''} trong ván này:</div>` +
      S.roleOrder.map((r) => {
        const info = S.roleInfo[r];
        const c = comp[r] || 0;
        return `<div class="role-card" style="${c ? '' : 'opacity:.45'}"><div class="ri">${info.icon}</div><div>
          <b>${esc(info.name)}<span class="tm ${info.team === 'wolf' ? 'wolf' : ''}">${info.team === 'wolf' ? 'Phe Sói' : 'Phe Dân'}</span></b>
          <p>${esc(info.desc)}</p></div><div class="cnt">×${c}</div></div>`;
      }).join('') +
      `<div class="role-card"><div class="ri">📋</div><div><b>Luật cơ bản</b><p>
        Đêm: Sói chọn người để cắn, các vai đặc biệt dùng năng lực. Ngày: công bố người chết, thảo luận rồi bỏ phiếu treo cổ
        (hoà phiếu thì không ai chết). Dân thắng khi hết Sói; Sói thắng khi số Sói ≥ số người còn lại.</p></div></div>`;
    setHTML($('#roles-list'), html);
  }

  // ---------------------------------------------------------------- đồng hồ
  function tick() {
    const timer = $('#timer');
    const fill = $('#timebar-fill');
    if (!S || !S.deadline) { timer.hidden = true; fill.style.width = '0'; return; }
    const remaining = Math.max(0, S.deadline - (Date.now() / 1000 + clockOffset));
    const secs = Math.ceil(remaining);
    timer.hidden = false;
    timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    timer.classList.toggle('urgent', secs <= 10);
    fill.style.width = S.total ? `${Math.min(100, (remaining / S.total) * 100)}%` : '0';
  }
  setInterval(tick, 250);

  // ---------------------------------------------------------------- lá bài vai trò
  function openReveal() {
    if (ui.revealModal || !S.me.role) return;
    const info = role(S.me.role);
    const body = document.createElement('div');
    body.innerHTML = `<div class="flip"><div class="flip-inner">
        <div class="face front">🃏<small>Nhấn để lật bài</small></div>
        <div class="face back ${S.me.role === 'werewolf' ? 'wolf' : ''}">
          <div class="ric">${info.icon}</div><h2>${esc(info.name)}</h2>
          <div class="team">${info.team === 'wolf' ? '🐺 Phe Sói' : '🏡 Phe Dân Làng'}</div>
          <p>${esc(info.desc)}</p></div></div></div>`;
    const flip = body.querySelector('.flip');
    flip.addEventListener('click', () => flip.classList.toggle('open'));
    ui.revealModal = P.modal({
      title: 'Vai trò của bạn', body, dismissable: false,
      actions: [
        { label: 'Để sau', kind: 'ghost', onClick: () => { ui.revealModal = null; } },
        { label: '✅ Tôi đã nhớ', kind: 'primary', onClick: () => { ui.revealModal = null; send('ready'); } },
      ],
    });
  }

  // ---------------------------------------------------------------- sự kiện
  document.addEventListener('click', async (e) => {
    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled) {
      const act = actEl.dataset.act;
      switch (act) {
        case 'peek': ui.peek = !ui.peek; break;
        case 'edit-look': openLookEditor(); return;
        case 'voice-on': startVoice(); return;
        case 'voice-off': if (voice) voice.disable(); return;
        case 'voice-mute': if (voice) voice.setMuted(!voice.muted); return;
        case 'voice-deaf': if (voice) voice.setDeaf(!voice.deaf); return;
        case 'voice-help': showMicHelp(); return;
        case 'open-reveal': openReveal(); break;
        case 'ready': send('ready'); break;
        case 'skip': send('skip'); break;
        case 'start': send('start'); break;
        case 'play-again': send('play_again'); break;
        case 'home': leave(); break;
        case 'seer-confirm': send('seer', { target: ui.selected }); break;
        case 'guard-confirm': send('guard', { target: ui.selected }); break;
        case 'guard-none': send('guard', { target: null }); break;
        case 'witch-heal': ui.heal = !ui.heal; break;
        case 'witch-poison': ui.poisonMode = !ui.poisonMode; if (!ui.poisonMode) ui.poison = null; break;
        case 'witch-confirm': send('witch', { heal: ui.heal, target: ui.poisonMode ? ui.poison : null }); break;
        case 'witch-none': send('witch', { heal: false, target: null }); break;
        case 'vote-skip': send('vote', { target: 'skip' }); break;
        case 'shoot-confirm': send('shoot', { target: ui.selected }); break;
        case 'shoot-none': send('shoot', { target: null }); break;
        case 'auto-roles': send('config', { auto_roles: true }); break;
        case 'add-bot': send('add_bot', { count: 1 }); break;
        case 'add-bot-3': send('add_bot', { count: 3 }); break;
        case 'fill-bots': {
          const n = S.players.length;
          const target = Math.min(Math.max(n < 8 ? 8 : n + 1, S.minPlayers), S.maxPlayers);
          send('add_bot', { count: target - n });
          break;
        }
        case 'remove-bots': send('remove_bots'); break;
        case 'copy-link':
          if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good');
          break;
        default: return;
      }
      render();
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

    const stepEl = e.target.closest('[data-step]');
    if (stepEl && !stepEl.disabled) {
      const r = stepEl.dataset.step;
      const roles = { ...S.config.roles, [r]: (S.config.roles[r] || 0) + Number(stepEl.dataset.d) };
      send('config', { roles });
      return;
    }

    const fxEl = e.target.closest('[data-fx]');
    if (fxEl) {
      const target = fxEl.dataset.self ? null : (menuEl && menuEl.dataset.target) || null;
      send('fx', { kind: fxEl.dataset.fx, target });
      closeMenu();
      return;
    }
    if (menuEl && !e.target.closest('.pmenu')) closeMenu();
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-cfg]');
    if (!el) return;
    const key = el.dataset.cfg;
    send('config', { [key]: el.type === 'checkbox' ? el.checked : Number(el.value) });
  });

  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    if (send('chat', { text })) input.value = '';
  });

  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    ui.tab = b.dataset.tab;
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab-body').forEach((x) => { x.hidden = x.dataset.body !== ui.tab; });
    if (ui.tab === 'chat') { ui.unread = 0; $('#unread').hidden = true; const l = $('#chat-list'); l.scrollTop = l.scrollHeight; }
    if (ui.tab === 'log') { const l = $('#log-list'); l.scrollTop = l.scrollHeight; }
  }));

  $('#btn-voice').addEventListener('click', () => {
    ui.voice = !ui.voice;
    try { localStorage.setItem('ww_voice', ui.voice ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-voice').textContent = ui.voice ? '🔊' : '🔇';
    $('#voice-accent').hidden = !ui.voice;
    if (ui.voice) { speak('Đã bật giọng quản trò.', { force: true }); warmNarrator(); } else stopSpeak();
  });

  // Mỗi người tự chọn giọng quản trò (lưu trên trình duyệt); mọi câu sau đó đều đọc bằng đúng giọng này.
  const accentSel = $('#voice-accent');
  accentSel.value = ui.accent;
  accentSel.hidden = !ui.voice;
  accentSel.addEventListener('change', () => {
    ui.accent = accentSel.value === 'south' ? 'south' : 'north';
    try { localStorage.setItem('ww_accent', ui.accent); } catch (e) { /* bỏ qua */ }
    speak(ui.accent === 'south' ? 'Đây là giọng miền Nam.' : 'Đây là giọng miền Bắc.', { force: true });
    warmNarrator();
  });
  warmNarrator();

  $('#btn-room').addEventListener('click', async () => {
    if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good');
  });

  function leave() {
    const doLeave = () => { if (voice) voice.disable(); if (conn) conn.leave(); setTimeout(() => { location.href = '/'; }, 150); };
    if (S && S.phase !== 'lobby' && S.phase !== 'end' && S.me.playing) {
      P.modal({
        title: 'Rời ván đấu?',
        body: '<p>Ván đấu đang diễn ra. Bạn có thể quay lại bất cứ lúc nào bằng cách vào lại phòng với <b>đúng tên cũ</b>.</p>',
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

  $('#room-code').textContent = ROOM;
  P.ensureName(() => connect());
})();
