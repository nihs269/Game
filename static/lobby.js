(function () {
  const P = window.Platform;
  const $ = (s) => document.querySelector(s);
  const nameInput = $('#name');
  nameInput.value = P.getName();
  nameInput.addEventListener('input', () => P.setName(nameInput.value.trim()));

  function needName() {
    const n = nameInput.value.trim();
    if (!n) {
      nameInput.focus();
      nameInput.classList.add('shake');
      setTimeout(() => nameInput.classList.remove('shake'), 400);
      P.toast('Hãy nhập tên trước nhé!', 'error');
      return false;
    }
    P.setName(n);
    return true;
  }

  function goRoom(game, code) {
    location.href = `/g/${game}/?room=${encodeURIComponent(code)}`;
  }

  async function createRoom(gameId) {
    if (!needName()) return;
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game: gameId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lỗi');
      goRoom(data.game, data.code);
    } catch (e) {
      P.toast('Không tạo được phòng: ' + e.message, 'error');
    }
  }

  async function joinByCode(code) {
    code = code.trim().toUpperCase();
    if (!needName()) return;
    if (code.length !== 4) { P.toast('Mã phòng gồm 4 ký tự.', 'error'); return; }
    const res = await fetch('/api/rooms/' + encodeURIComponent(code));
    if (!res.ok) { P.toast('Không tìm thấy phòng ' + code, 'error'); return; }
    const room = await res.json();
    goRoom(room.game, room.code);
  }

  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    joinByCode($('#code').value);
  });

  async function loadGames() {
    const games = await (await fetch('/api/games')).json();
    const box = $('#games');
    box.innerHTML = games.map((g) => `
      <article class="game">
        <div class="icon">${g.icon}</div>
        <h3>${P.esc(g.name)}</h3>
        <p>${P.esc(g.description)}</p>
        <div class="meta">👥 ${g.minPlayers}–${g.maxPlayers} người chơi</div>
        <div class="game-actions">
          <button class="gh-btn ghost" data-guide="${g.id}">📖 Hướng dẫn</button>
          <button class="gh-btn primary" data-create="${g.id}">＋ Tạo phòng</button>
        </div>
      </article>`).join('') + `
      <article class="game soon"><div class="icon">🧩</div><p>Sắp có thêm game mới…</p></article>`;
    box.querySelectorAll('[data-create]').forEach((b) => {
      b.addEventListener('click', () => createRoom(b.dataset.create));
    });
    box.querySelectorAll('[data-guide]').forEach((b) => {
      b.addEventListener('click', () => window.Guide.open(b.dataset.guide));
    });
  }

  async function loadRooms() {
    let rooms = [];
    try { rooms = await (await fetch('/api/rooms')).json(); } catch (e) { return; }
    $('#room-count').textContent = rooms.length;
    const box = $('#rooms');
    if (!rooms.length) {
      box.innerHTML = '<div class="empty">Chưa có phòng nào. Hãy tạo phòng mới ở trên! ✨</div>';
      return;
    }
    box.innerHTML = rooms.map((r) => `
      <div class="room">
        <div class="ricon">${r.icon}</div>
        <div class="rinfo">
          <div class="rtitle">${P.esc(r.gameName)} <span class="rcode">${r.code}</span>
            <span class="badge ${r.joinable ? '' : 'busy'}">${P.esc(r.status)}</span></div>
          <div class="rsub">Chủ phòng: ${P.esc(r.host || '—')} · ${r.online} online · ${r.players} người${r.bots ? ` (${r.bots} bot)` : ''} · tối đa ${r.maxPlayers}</div>
        </div>
        <button class="gh-btn small ${r.joinable ? 'primary' : ''}" data-join="${r.code}" data-game="${r.game}">
          ${r.joinable ? 'Vào' : '👀 Xem'}</button>
      </div>`).join('');
    box.querySelectorAll('[data-join]').forEach((b) => {
      b.addEventListener('click', () => { if (needName()) goRoom(b.dataset.game, b.dataset.join); });
    });
  }

  async function loadInfo() {
    try {
      const info = await (await fetch('/api/info')).json();
      if (!info.urls.length) return;
      const code = (u) => `<code data-copy="${u}" title="Nhấn để sao chép">${u}</code>`;
      $('#lan').innerHTML = '📡 Bạn bè cùng mạng truy cập: ' + info.urls.map(code).join(' ') +
        (info.https && info.https.length
          ? '<br>🎙️ Muốn nói chuyện bằng mic, hãy vào: ' + info.https.map(code).join(' ') +
            ' <span class="gh-muted">(trình duyệt cảnh báo thì bấm Nâng cao → Tiếp tục)</span>'
          : '');
      $('#lan').querySelectorAll('[data-copy]').forEach((c) => c.addEventListener('click', async () => {
        if (await P.copy(c.dataset.copy)) P.toast('Đã sao chép địa chỉ!', 'good');
      }));
    } catch (e) { /* bỏ qua */ }
  }

  // ---------------------------------------------------------------- người đang hoạt động
  // Trang sảnh “điểm danh” với máy chủ mỗi 10 giây (người trong phòng chơi thì máy chủ tự biết).
  function presence(leave = false) {
    const body = JSON.stringify(leave
      ? { pid: P.getPid(), leave: true }
      : { pid: P.getPid(), name: nameInput.value.trim() || P.getName(), look: Avatar.get() });
    if (leave && navigator.sendBeacon) {
      navigator.sendBeacon('/api/presence', new Blob([body], { type: 'application/json' }));
      return Promise.resolve();
    }
    return fetch('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
      .catch(() => {});
  }
  let presenceTimer = null;
  const presenceSoon = () => { clearTimeout(presenceTimer); presenceTimer = setTimeout(() => presence().then(loadOnline), 700); };
  nameInput.addEventListener('input', presenceSoon);
  window.addEventListener('pagehide', () => presence(true));

  const onlineBox = $('#online');
  let onlineOpen = window.innerWidth >= 1560;  // đủ chỗ bên phải thì mở sẵn, không thì thu gọn
  try { const v = localStorage.getItem('gh_online_open'); if (v !== null) onlineOpen = v === '1'; } catch (e) { /* bỏ qua */ }
  onlineBox.classList.toggle('open', onlineOpen);
  $('#online-toggle').addEventListener('click', () => {
    onlineOpen = !onlineOpen;
    onlineBox.classList.toggle('open', onlineOpen);
    try { localStorage.setItem('gh_online_open', onlineOpen ? '1' : '0'); } catch (e) { /* bỏ qua */ }
  });

  let onlineHTML = '';
  async function loadOnline() {
    let list;
    try { list = await (await fetch('/api/online')).json(); } catch (e) { return; }
    const me = P.getPid();
    $('#online-count').textContent = list.length;
    const html = list.length ? list.map((u) => {
      const where = u.room
        ? `${u.room.icon} ${P.esc(u.room.gameName)} · phòng ${P.esc(u.room.code)}`
        : '🏠 Đang ở sảnh';
      const attrs = u.room && u.id !== me ? `data-room="${P.esc(u.room.code)}" data-game="${P.esc(u.room.game)}" title="Vào phòng ${P.esc(u.room.code)}"` : '';
      return `<div class="ol-row ${u.id === me ? 'me' : ''}" ${attrs}>
        <div class="ol-ava">${Avatar.svg(u.look, { head: true, seed: u.id })}<i class="dot"></i></div>
        <div class="ol-info"><b>${P.esc(u.name)}${u.id === me ? ' (bạn)' : ''}</b><span>${where}</span></div></div>`;
    }).join('') : '<div class="empty">Chưa có ai.</div>';
    if (html !== onlineHTML) {  // chỉ vẽ lại khi có thay đổi để không làm nhảy vị trí cuộn
      onlineHTML = html;
      $('#online-list').innerHTML = html;
    }
  }
  $('#online-list').addEventListener('click', (e) => {
    const row = e.target.closest('[data-room]');
    if (row && needName()) goRoom(row.dataset.game, row.dataset.room);
  });

  Avatar.editor($('#avatar-editor'), { look: Avatar.get(), onChange: (look) => { Avatar.set(look); presenceSoon(); } });
  loadGames();
  loadRooms();
  loadInfo();
  presence().then(loadOnline);
  setInterval(loadRooms, 3000);
  setInterval(loadOnline, 3000);
  setInterval(presence, 10000);
})();
