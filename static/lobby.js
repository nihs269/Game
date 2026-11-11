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

  // ---------------------------------------------------------------- mã đặc biệt (VIP / điều hành / admin)
  // Mã đã nhập lưu trong trình duyệt và gửi kèm mỗi yêu cầu; máy chủ tự kiểm tra quyền.
  let perkCode = '';
  try { perkCode = localStorage.getItem('gh_code') || ''; } catch (e) { /* bỏ qua */ }
  let perk = null;  // {role, label, icon, perms}
  const can = (perm) => !!(perk && perk.perms.includes(perm));

  async function api(url, body) {
    const opts = { headers: { 'X-GH-Code': perkCode } };
    if (body !== undefined) {
      opts.method = 'POST';
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Lỗi'), { status: res.status });
    return data;
  }

  function goRoom(game, code) {
    location.href = `/g/${game}/?room=${encodeURIComponent(code)}`;
  }

  async function createRoom(gameId) {
    if (!needName()) return;
    try {
      const data = await api('/api/rooms', { game: gameId });
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
    const games = await api('/api/games');
    const box = $('#games');
    box.innerHTML = games.map((g) => `
      <article class="game ${g.hidden ? 'is-hidden' : ''}">
        ${g.hidden ? '<span class="hidden-badge">🙈 Đang ẩn</span>' : ''}
        ${can('games') ? `<button class="gh-btn small game-toggle" data-toggle="${g.id}" data-hidden="${g.hidden ? 1 : 0}">
          ${g.hidden ? '👁 Hiện' : '🙈 Ẩn'}</button>` : ''}
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
    box.querySelectorAll('[data-toggle]').forEach((b) => {
      b.addEventListener('click', async () => {
        const hide = b.dataset.hidden !== '1';
        try {
          await api('/api/admin/game', { game: b.dataset.toggle, hidden: hide });
          P.toast(hide ? 'Đã ẩn game.' : 'Đã hiện game.', 'good');
          loadGames();
          loadAdmin();
        } catch (e) { P.toast(e.message, 'error'); }
      });
    });
  }

  async function loadRooms() {
    let rooms = [];
    try { rooms = await api('/api/rooms'); } catch (e) { return; }
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
        ${can('rooms') ? `<button class="gh-btn small danger" data-close="${r.code}" title="Đóng phòng">✕</button>` : ''}
      </div>`).join('');
    box.querySelectorAll('[data-join]').forEach((b) => {
      b.addEventListener('click', () => { if (needName()) goRoom(b.dataset.game, b.dataset.join); });
    });
    box.querySelectorAll('[data-close]').forEach((b) => {
      b.addEventListener('click', () => {
        const code = b.dataset.close;
        P.modal({
          title: 'Đóng phòng ' + P.esc(code) + '?',
          body: '<p class="gh-muted">Mọi người trong phòng sẽ bị đưa về sảnh.</p>',
          actions: [
            { label: 'Huỷ' },
            { label: 'Đóng phòng', kind: 'danger', onClick: () => {
              api('/api/admin/close-room', { code })
                .then(() => { P.toast('Đã đóng phòng ' + code, 'good'); loadRooms(); loadAdmin(); })
                .catch((e) => P.toast(e.message, 'error'));
            } },
          ],
        });
      });
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

  // ---------------------------------------------------------------- nhập mã + bảng quản trị
  function renderPerk() {
    const status = $('#code-status');
    status.hidden = !perk;
    if (perk) {
      const what = [];
      if (can('hidden')) what.push('thấy & chơi game đang ẩn');
      if (can('rooms')) what.push('đóng phòng');
      if (can('announce')) what.push('gửi thông báo');
      if (can('games')) what.push('ẩn / hiện game');
      if (can('codes')) what.push('quản lý mã');
      if (can('ads')) what.push('đặt banner quảng cáo');
      status.innerHTML = `<span>${perk.icon} Đang dùng mã <b>${P.esc(perk.label)}</b> — ${what.join(', ')}</span>
        <button class="gh-btn small ghost" id="code-logout" type="button">Bỏ mã</button>`;
      $('#code-logout').addEventListener('click', () => setPerk('', null));
    }
    $('#admin').hidden = !(can('rooms') || can('games') || can('codes') || can('announce') || can('ads'));
    $('#admin-hb').hidden = !can('ads');
    $('#admin-stats').hidden = !can('rooms');
    $('#announce-form').hidden = !can('announce');
    $('#admin-codes').hidden = !can('codes');
    const hint = [];
    if (can('games')) hint.push('Ẩn / hiện game bằng nút trên thẻ game.');
    if (can('rooms')) hint.push('Đóng phòng bằng nút ✕ ở danh sách phòng.');
    $('#admin-hint').textContent = hint.join(' ');
  }

  function setPerk(code, info) {
    perkCode = info ? code : '';
    perk = info;
    try { if (perkCode) localStorage.setItem('gh_code', perkCode); else localStorage.removeItem('gh_code'); } catch (e) { /* bỏ qua */ }
    renderPerk();
    loadGames();
    loadRooms();
    loadAdmin();
    loadAdminAds();
  }

  $('#code-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#perk-code');
    const code = input.value.trim().toUpperCase();
    if (!code) { input.focus(); return; }
    try {
      const info = await api('/api/code', { code });
      input.value = '';
      setPerk(code, info);
      P.toast(`${info.icon} Mã hợp lệ: ${info.label}!`, 'good');
    } catch (err) {
      input.classList.add('shake');
      setTimeout(() => input.classList.remove('shake'), 400);
      P.toast(err.message, 'error');
    }
  });

  async function loadAdmin() {
    if (can('rooms')) {
      try {
        const o = await api('/api/admin/overview');
        $('#admin-stats').innerHTML = [
          ['🏠', o.rooms, 'phòng đang mở'], ['🎮', o.players, 'người đang chơi'],
          ['🛋️', o.lobby, 'người ở sảnh'], ['🙈', o.hidden, 'game đang ẩn'],
        ].map(([i, n, t]) => `<div class="stat"><b>${i} ${n}</b><span>${t}</span></div>`).join('');
      } catch (e) { /* bỏ qua */ }
    }
    if (can('codes')) {
      try { renderRoles(await api('/api/admin/roles')); } catch (e) { /* bỏ qua */ }
    }
    if (can('ads')) loadAdminAds();   // cập nhật trạng thái (hết hạn…); lần trước tải hỏng thì thử lại
  }

  let codesHTML = '';
  let roleOptsHTML = '';
  function renderCodes(data) {
    const sel = $('#newcode-role');
    const opts = data.roles.map((r) => `<option value="${P.esc(r.role)}">${P.esc(r.icon)} ${P.esc(r.label)}</option>`).join('');
    if (opts !== roleOptsHTML) {        // danh sách vai trò đổi → dựng lại, giữ lựa chọn cũ nếu còn
      const keep = sel.value;
      roleOptsHTML = opts;
      sel.innerHTML = opts;
      const ids = data.roles.map((r) => r.role);
      sel.value = ids.includes(keep) ? keep : ids.includes('vip') ? 'vip' : (ids.find((r) => r !== 'admin') || ids[0]);
    }
    const html = data.codes.map((c) => `
      <div class="code-row ${c.code === perkCode ? 'mine' : ''}">
        <code data-copy="${P.esc(c.code)}" title="Nhấn để sao chép">${P.esc(c.code)}</code>
        <span class="code-role">${c.icon} ${P.esc(c.label)}</span>
        <span class="code-note">${P.esc(c.note)}${c.code === perkCode ? ' (mã bạn đang dùng)' : ''}</span>
        <button class="gh-btn small ghost" data-del="${P.esc(c.code)}" title="Xoá mã">🗑</button>
      </div>`).join('');
    if (html !== codesHTML) { codesHTML = html; $('#code-list').innerHTML = html; }
  }

  // Vai trò: admin tự tạo / sửa / xoá; mỗi mã đặc biệt thuộc một vai trò.
  let roles = [];
  let permList = [];
  let rolesHTML = '';
  function renderRoles(data) {
    roles = data.roles || [];
    permList = data.perms || permList;
    const permName = Object.fromEntries(permList.map((x) => [x.perm, x.label]));
    const html = roles.map((r) => `
      <div class="code-row role-row">
        <span class="role-name">${P.esc(r.icon)} ${P.esc(r.label)}</span>
        <span class="role-perms">${r.perms.length ? r.perms.map((k) => `<i>${P.esc(permName[k] || k)}</i>`).join('') : '<i class="none">Không có quyền quản trị</i>'}</span>
        <span class="role-count">${r.codes} mã</span>
        <span class="hb-btns">
          <button class="gh-btn small ghost" type="button" data-role-edit="${P.esc(r.role)}" title="Sửa">✏️</button>
          ${r.locked ? '' : `<button class="gh-btn small ghost" type="button" data-role-del="${P.esc(r.role)}" title="Xoá">🗑</button>`}
        </span>
      </div>`).join('');
    if (html !== rolesHTML) { rolesHTML = html; $('#role-list').innerHTML = html; }
    if (data.codes) renderCodes({ codes: data.codes, roles });
  }
  async function afterRoleChange(data) {
    renderRoles(data);
    if (perkCode) await restorePerk();      // vai trò mình đang dùng có thể vừa đổi tên / quyền
  }
  const ROLE_EMOJIS = ['⭐', '💎', '👑', '🛡️', '🔥', '🎖️', '🏆', '🌟', '🦄', '🐉', '🎩', '🤝', '🎨', '🎵', '💰', '🧙'];
  function openRoleEditor(role) {
    const locked = role && role.locked;
    const body = document.createElement('div');
    body.className = 're';
    body.innerHTML = `
      <div>
        <span class="hbe-label">Biểu tượng & tên vai trò</span>
        <div class="re-top">
          <input class="gh-input re-icon" maxlength="8" value="${P.esc(role ? role.icon : '⭐')}" aria-label="Biểu tượng">
          <input class="gh-input re-label" maxlength="24" placeholder="Ví dụ: VIP, Nhà tài trợ, Đại sứ…" value="${P.esc(role ? role.label : '')}" aria-label="Tên vai trò">
        </div>
      </div>
      <div class="re-emojis">${ROLE_EMOJIS.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join('')}</div>
      <div>
        <span class="hbe-label">Quyền</span>
        <div class="re-perms">${permList.map((x) => `
          <label class="re-perm ${locked ? 'locked' : ''}"><input type="checkbox" value="${P.esc(x.perm)}" ${locked || (role && role.perms.includes(x.perm)) ? 'checked' : ''} ${locked ? 'disabled' : ''}> ${P.esc(x.label)}</label>`).join('')}
        </div>
      </div>
      <p class="gh-muted re-note">${locked ? 'Vai trò Quản trị viên luôn có đủ mọi quyền và không xoá được.' : 'Không chọn quyền nào cũng được (ví dụ VIP chỉ để có danh hiệu).'} Người dùng mã thuộc vai trò này khi vào phòng chơi, cả phòng sẽ thấy dòng chữ “<b>Tên vai trò + Tên người chơi</b> đã vào phòng”.</p>`;
    body.querySelector('.re-emojis').addEventListener('click', (e) => {
      const b = e.target.closest('[data-emoji]');
      if (b) body.querySelector('.re-icon').value = b.dataset.emoji;
    });
    let saving = false;
    const m = P.modal({
      title: role ? 'Sửa vai trò' : 'Tạo vai trò mới',
      body,
      actions: [
        { label: 'Huỷ' },
        { label: role ? 'Lưu' : 'Tạo vai trò', kind: 'primary', onClick: () => {
          if (saving) return false;
          const label = body.querySelector('.re-label').value.trim();
          if (!label) { body.querySelector('.re-label').focus(); P.toast('Hãy nhập tên vai trò.', 'error'); return false; }
          saving = true;
          api('/api/admin/roles', {
            role: role ? role.role : '', label, icon: body.querySelector('.re-icon').value.trim(),
            perms: [...body.querySelectorAll('.re-perms input:checked')].map((i) => i.value),
          }).then((data) => {
            m.close();
            afterRoleChange(data);
            P.toast(role ? 'Đã lưu vai trò.' : 'Đã tạo vai trò ' + label + '.', 'good');
          }).catch((err) => P.toast(err.message, 'error'))
            .finally(() => { saving = false; });
          return false;
        } },
      ],
    });
    m.el.querySelector('.gh-modal').classList.add('hb-modal');
    setTimeout(() => body.querySelector('.re-label').focus(), 50);
  }
  $('#role-create').addEventListener('click', () => openRoleEditor(null));
  $('#role-list').addEventListener('click', (e) => {
    const edit = e.target.closest('[data-role-edit]');
    const del = e.target.closest('[data-role-del]');
    if (edit) {
      const r = roles.find((x) => x.role === edit.dataset.roleEdit);
      if (r) openRoleEditor(r);
    } else if (del) {
      const r = roles.find((x) => x.role === del.dataset.roleDel);
      P.modal({
        title: 'Xoá vai trò này?',
        body: `<p class="gh-muted">Vai trò <b>${P.esc(r ? r.icon + ' ' + r.label : '')}</b> sẽ bị xoá. Chỉ xoá được khi không còn mã nào dùng vai trò này.</p>`,
        actions: [
          { label: 'Huỷ' },
          { label: 'Xoá', kind: 'danger', onClick: () => {
            api('/api/admin/roles', { delete: del.dataset.roleDel })
              .then((data) => { afterRoleChange(data); P.toast('Đã xoá vai trò.', 'good'); })
              .catch((err) => P.toast(err.message, 'error'));
          } },
        ],
      });
    }
  });

  $('#code-list').addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) { if (await P.copy(copy.dataset.copy)) P.toast('Đã sao chép mã!', 'good'); return; }
    const del = e.target.closest('[data-del]');
    if (!del) return;
    try {
      renderCodes(await api('/api/admin/codes', { delete: del.dataset.del }));
      loadAdmin();
      P.toast('Đã xoá mã.', 'good');
      if (del.dataset.del === perkCode) setPerk('', null);
    } catch (err) { P.toast(err.message, 'error'); }
  });

  $('#newcode-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await api('/api/admin/codes', {
        role: $('#newcode-role').value, code: $('#newcode-code').value.trim(), note: $('#newcode-note').value.trim(),
      });
      renderCodes(data);
      loadAdmin();
      $('#newcode-code').value = '';
      $('#newcode-note').value = '';
      P.toast('Đã tạo mã ' + data.created, 'good');
    } catch (err) { P.toast(err.message, 'error'); }
  });

  $('#announce-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#announce-text');
    if (!input.value.trim()) { input.focus(); return; }
    try {
      await api('/api/admin/announce', { message: input.value.trim() });
      input.value = '';
      P.toast('Đã gửi thông báo.', 'good');
    } catch (err) { P.toast(err.message, 'error'); }
  });

  // ---------------------------------------------------------------- banner quảng cáo
  // Trang chủ: vị trí nào có banner thì hiện (nhiều banner thì đổi lần lượt), không có thì giữ nguyên như cũ.
  const AD_ROTATE_MS = 12000;
  let adsKey = '';
  const adRot = {};          // vị trí → {list, i}
  function showAd(slot) {
    const box = $('#hb-' + slot);
    const r = adRot[slot];
    if (!r || !r.list.length) { box.hidden = true; box.innerHTML = ''; return; }
    const ad = r.list[r.i % r.list.length];
    const img = `<img src="${P.esc(ad.image)}" alt="${P.esc(ad.note || 'Quảng cáo')}">`;
    box.innerHTML = '<div class="hb-frame">' + (ad.link
      ? `<a class="hb-link" href="${P.esc(ad.link)}" target="_blank" rel="noopener sponsored nofollow">${img}</a>`
      : `<div class="hb-link">${img}</div>`) +
      (ad.note ? `<div class="hb-note">${P.esc(ad.note)}</div>` : '') + '</div>';
    box.hidden = false;
    box.dataset.hbId = ad.id || '';
    // Chỉ tính lượt hiển thị khi banner thật sự hiện ra (màn hẹp ẩn hai cột bên; tab chạy nền không tính).
    if (!document.hidden && getComputedStyle(box).display !== 'none') adHit(ad.id, 'view');
  }
  function adHit(id, kind) {
    if (!id) return;
    const body = JSON.stringify({ id, kind, did: P.getDid() });
    if (kind === 'click' && navigator.sendBeacon && navigator.sendBeacon('/api/board/hit', new Blob([body], { type: 'application/json' }))) return;
    fetch('/api/board/hit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }
  // Click (cả chuột giữa để mở tab mới) vào banner có liên kết.
  ['top', 'left', 'right'].forEach((slot) => {
    const box = $('#hb-' + slot);
    const onClick = (e) => { if ((e.type === 'click' || e.button === 1) && e.target.closest('a.hb-link')) adHit(box.dataset.hbId, 'click'); };
    box.addEventListener('click', onClick);
    box.addEventListener('auxclick', onClick);
  });
  // Lăn trang: hai cột banner trôi theo nội dung một đoạn rồi nhẹ nhàng trượt về giữa (có quán tính, như lò xo).
  const sideFrames = () => document.querySelectorAll('.hb-side:not([hidden]) .hb-frame');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const drift = { y: 0, v: 0, lastScroll: window.scrollY, raf: 0, t: 0 };
  function driftFrame(now) {
    const dt = Math.min(0.05, (now - (drift.t || now)) / 1000);
    drift.t = now;
    // lò xo giảm chấn: kéo về 0, hơi nảy nhẹ
    drift.v += (-drift.y * 60 - drift.v * 14) * dt;
    drift.y += drift.v * dt;
    const done = Math.abs(drift.y) < 0.3 && Math.abs(drift.v) < 5;
    if (done) { drift.y = 0; drift.v = 0; }
    sideFrames().forEach((f) => { f.style.transform = drift.y ? `translate3d(0, ${drift.y.toFixed(1)}px, 0)` : ''; });
    drift.raf = done ? 0 : requestAnimationFrame(driftFrame);
  }
  window.addEventListener('scroll', () => {
    const dy = window.scrollY - drift.lastScroll;
    drift.lastScroll = window.scrollY;
    if (reduceMotion || !dy) return;
    const lim = Math.max(60, window.innerHeight * 0.18);
    drift.y = Math.max(-lim, Math.min(lim, drift.y - dy * 0.6));     // trôi cùng chiều nội dung
    if (!drift.raf) { drift.t = 0; drift.raf = requestAnimationFrame(driftFrame); }
  }, { passive: true });

  async function loadAds() {
    let ads;
    try { ads = await (await fetch('/api/board')).json(); } catch (e) { return; }
    const key = JSON.stringify(ads);
    if (key === adsKey) return;
    adsKey = key;
    for (const slot of ['top', 'left', 'right']) {
      const v = ads[slot];       // danh sách banner; máy chủ bản cũ trả về một banner (object)
      const list = Array.isArray(v) ? v : v && v.image ? [v] : [];
      adRot[slot] = { list, i: Math.floor(Math.random() * Math.max(1, list.length)) };
      showAd(slot);
    }
  }
  setInterval(() => {
    for (const slot of ['top', 'left', 'right']) {
      const r = adRot[slot];
      if (!r || r.list.length < 2 || $('#hb-' + slot).matches(':hover')) continue;   // đang rê chuột thì giữ nguyên
      r.i += 1;
      showAd(slot);
    }
  }, AD_ROTATE_MS);

  // Bảng quản trị: nút “Tạo banner” ở đầu trang mở popup; danh sách banner đã tạo (sửa / bật tắt / xoá).
  const SLOTS = [
    { id: 'top', name: 'Giữa', where: 'Dải trên cùng', size: '980 × 120' },
    { id: 'left', name: 'Trái', where: 'Cột bên trái', size: '300 × 600' },
    { id: 'right', name: 'Phải', where: 'Cột bên phải', size: '300 × 600' },
  ];
  const SLOT_NAMES = { top: '⬆️ Giữa (trên cùng)', left: '⬅️ Trái', right: '➡️ Phải' };
  const isImageUrl = (url) => /^(https?:\/\/|\/media\/hb\/)/.test(url);
  const isoDay = (d) => d.toLocaleDateString('sv');          // YYYY-MM-DD theo giờ máy
  const viDay = (iso) => iso.split('-').reverse().join('/');
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };
  const EXPIRY = [['', 'Không giới hạn'], [7, '7 ngày'], [30, '30 ngày'], [90, '3 tháng'], ['pick', 'Chọn ngày…']];

  async function uploadAdImage(file) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('Chỉ nhận ảnh PNG, JPG, GIF hoặc WebP.');
    if (file.size > 2 * 1024 * 1024) throw new Error('Ảnh quá lớn (tối đa 2 MB).');
    const res = await fetch('/api/admin/board/upload', {
      method: 'POST', headers: { 'X-GH-Code': perkCode, 'Content-Type': file.type }, body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Không tải được ảnh.');
    return data.url;
  }

  function openAdEditor(banner) {
    const editing = !!banner;
    const st = {
      slot: 'top', image: '', link: '', note: '', until: '', enabled: true, ...(banner || {}),
      uploading: false, expiry: '',
    };
    st.expiry = st.until ? 'pick' : '';
    const el = document.createElement('div');
    el.className = 'hbe';
    el.innerHTML = `
      <div class="hbe-label">Vị trí hiển thị</div>
      <div class="hbe-slots">${SLOTS.map((s) => `
        <button type="button" class="hbe-slot" data-slot="${s.id}">
          <span class="hbe-mini ${s.id}"><i></i></span><b>${s.name}</b><small>${s.where} · ${s.size}</small></button>`).join('')}
      </div>
      <div class="hbe-label">Ảnh banner</div>
      <label class="hbe-drop"><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden><div class="hbe-drop-in"></div></label>
      <button type="button" class="hbe-linkbtn">hoặc dán địa chỉ ảnh có sẵn trên mạng</button>
      <div class="hbe-urlrow" hidden><input class="gh-input hbe-url" maxlength="500" placeholder="https://…/banner.png" autocomplete="off"></div>
      <div class="hbe-label">Liên kết khi bấm vào banner <i>(tuỳ chọn)</i></div>
      <input class="gh-input hbe-link" maxlength="500" placeholder="https://…" autocomplete="off">
      <div class="hbe-label">Thông tin hiện khi rê chuột vào banner <i>(tuỳ chọn)</i></div>
      <textarea class="gh-input hbe-note" maxlength="200" rows="2" placeholder="VD: Giảm 20% cho khách mới — bấm để xem chi tiết"></textarea>
      <div class="hbe-label">Thời hạn hiển thị</div>
      <div class="hbe-chips">${EXPIRY.map(([v, t]) => `<button type="button" class="hbe-chip" data-exp="${v}">${t}</button>`).join('')}</div>
      <div class="hbe-date" hidden>Hiển thị đến hết ngày <input type="date" class="gh-input"></div>
      <div class="hbe-until"></div>
      <label class="hbe-switch"><input type="checkbox" class="hbe-on"><span class="sw"></span> Hiển thị ngay trên trang chủ</label>`;
    const q = (s) => el.querySelector(s);
    const drop = q('.hbe-drop');
    const fileInput = drop.querySelector('input');
    const urlRow = q('.hbe-urlrow');
    q('.hbe-url').value = isImageUrl(st.image) && !st.image.startsWith('/media/hb/') ? st.image : '';
    q('.hbe-link').value = st.link;
    q('.hbe-note').value = st.note;
    q('.hbe-on').checked = st.enabled;
    q('.hbe-date input').value = st.until;
    q('.hbe-date input').min = isoDay(new Date());

    function paint() {
      el.querySelectorAll('.hbe-slot').forEach((b) => b.classList.toggle('on', b.dataset.slot === st.slot));
      const slot = SLOTS.find((s) => s.id === st.slot);
      q('.hbe-drop-in').innerHTML = st.uploading
        ? '<span class="big">⏳</span><b>Đang tải ảnh lên…</b>'
        : isImageUrl(st.image)
          ? `<img src="${P.esc(st.image)}" alt=""><span class="hbe-change">🔄 Đổi ảnh</span>`
          : `<span class="big">🖼️</span><b>Bấm để chọn ảnh, hoặc kéo thả ảnh vào đây</b>PNG, JPG, GIF, WebP · tối đa 2 MB · nên dùng ${slot.size} px`;
      el.querySelectorAll('.hbe-chip').forEach((c) => c.classList.toggle('on', c.dataset.exp === String(st.expiry)));
      q('.hbe-date').hidden = st.expiry !== 'pick';
      q('.hbe-until').textContent = st.until ? `⏰ Banner tự ẩn sau ngày ${viDay(st.until)}.` : '♾️ Banner hiển thị cho tới khi bạn tắt hoặc xoá.';
    }
    async function takeFile(file) {
      if (!file) return;
      st.uploading = true; paint();
      try {
        st.image = await uploadAdImage(file);
        q('.hbe-url').value = '';
      } catch (err) { P.toast(err.message, 'error'); }
      st.uploading = false; paint();
    }
    el.addEventListener('click', (e) => {
      const slot = e.target.closest('.hbe-slot');
      const chip = e.target.closest('.hbe-chip');
      if (slot) { st.slot = slot.dataset.slot; paint(); }
      if (chip) {
        const v = chip.dataset.exp;
        st.expiry = v === '' || v === 'pick' ? v : Number(v);
        if (v === '') st.until = '';
        else if (v === 'pick') { if (!st.until) st.until = addDays(30); q('.hbe-date input').value = st.until; }
        else st.until = addDays(Number(v));
        paint();
      }
    });
    q('.hbe-linkbtn').addEventListener('click', () => { urlRow.hidden = false; q('.hbe-url').focus(); });
    if (q('.hbe-url').value) urlRow.hidden = false;
    q('.hbe-url').addEventListener('input', (e) => { st.image = e.target.value.trim(); paint(); });
    q('.hbe-date input').addEventListener('change', (e) => { st.until = e.target.value; paint(); });
    fileInput.addEventListener('change', () => { const f = fileInput.files[0]; fileInput.value = ''; takeFile(f); });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); takeFile(e.dataTransfer.files[0]); });
    paint();

    let saving = false;
    const m = P.modal({
      title: editing ? '✏️ Sửa banner' : '📣 Tạo banner quảng cáo',
      body: el,
      actions: [
        { label: 'Huỷ' },
        { label: editing ? '💾 Lưu thay đổi' : '＋ Tạo banner', kind: 'primary', onClick: () => {
          if (saving) return false;
          if (st.uploading) { P.toast('Ảnh đang tải lên, chờ một chút nhé.', 'error'); return false; }
          if (!st.image) { P.toast('Hãy chọn ảnh banner.', 'error'); drop.classList.add('shake'); setTimeout(() => drop.classList.remove('shake'), 400); return false; }
          const body = {
            slot: st.slot, image: st.image, link: q('.hbe-link').value.trim(), note: q('.hbe-note').value.trim(),
            until: st.until, enabled: q('.hbe-on').checked,
          };
          if (editing) body.id = banner.id;
          saving = true;
          api('/api/admin/board', body)
            .then((data) => {
              m.close();
              P.toast(editing ? 'Đã lưu thay đổi.' : 'Đã tạo banner.', 'good');
              renderAdList(data);
              loadAds();
            })
            .catch((err) => P.toast(err.message, 'error'))
            .finally(() => { saving = false; });
          return false;
        } },
      ],
    });
    m.el.querySelector('.gh-modal').classList.add('hb-modal');
  }
  $('#hb-create').addEventListener('click', () => openAdEditor(null));

  let adListHTML = '';
  let adBanners = [];
  async function loadAdminAds() {
    if (!can('ads')) { $('#hb-list').innerHTML = ''; adListHTML = ''; return; }
    try {
      renderAdList(await api('/api/admin/board'));
    } catch (e) {
      adListHTML = '';
      $('#hb-list').innerHTML = `<div class="empty">⚠️ Chưa tải được danh sách banner: ${P.esc(e.message)}${e.status ? ` (mã ${e.status})` : ''} — đang thử lại…</div>`;
    }
  }
  const fmtNum = (n) => (n || 0).toLocaleString('vi-VN');
  const ctr = (v, c) => (v ? (c / v * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + '%' : '—');
  function statLine(st) {
    if (!st) return '';
    return `<span class="hb-statline">👁 <b>${fmtNum(st.views)}</b> lượt xem · 👆 <b>${fmtNum(st.clicks)}</b> click · tỉ lệ click <b>${ctr(st.views, st.clicks)}</b></span>`;
  }
  function agoText(t) {
    if (!t) return 'chưa có';
    const s = Math.max(0, Date.now() / 1000 - t);
    if (s < 60) return 'vừa xong';
    if (s < 3600) return Math.floor(s / 60) + ' phút trước';
    if (s < 86400) return Math.floor(s / 3600) + ' giờ trước';
    return new Date(t * 1000).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  // Biểu đồ cột 14 ngày (một chỉ số mỗi biểu đồ — lượt xem và lượt click khác thang đo nên tách riêng).
  function barChart(series, key, title) {
    const max = Math.max(1, ...series.map((d) => d[key]));
    // đỉnh trục tròn số (2, 4, 6, 8, 10 × 10ⁿ) để vạch giữa cũng là số chẵn
    const p10 = 10 ** Math.floor(Math.log10(max));
    const nice = Math.max(2, [1, 2, 4, 6, 8, 10].map((f) => f * p10).find((v) => v >= max));
    const total = series.reduce((a, d) => a + d[key], 0);
    const bars = series.map((d, i) => {
      const h = d[key] ? Math.max(2, d[key] / nice * 100) : 0;
      const [, m, dd] = d.day.split('-');
      const label = i % 2 === series.length % 2 || i === series.length - 1 ? `${+dd}/${+m}` : '';
      return `<div class="hbs-col" data-tip="${+dd}/${+m}: ${fmtNum(d[key])} ${key === 'views' ? 'lượt xem' : 'click'}" tabindex="0">
        <div class="hbs-bar-wrap"><div class="hbs-bar" style="height:${h}%"></div></div><span class="hbs-x">${label}</span></div>`;
    }).join('');
    return `<div class="hbs-chart">
      <div class="hbs-chart-head"><b>${title}</b><span class="gh-muted">14 ngày: ${fmtNum(total)}</span></div>
      <div class="hbs-plot">
        <div class="hbs-grid"><span data-v="${fmtNum(nice)}"></span><span data-v="${fmtNum(nice / 2)}"></span><span data-v="0"></span></div>
        <div class="hbs-cols">${bars}</div>
      </div>
    </div>`;
  }
  function openAdStats(b) {
    const st = b.stats || {};
    const series = st.series || [];
    const tile = (label, value, sub) => `<div class="hbs-tile"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const body = document.createElement('div');
    body.className = 'hbs';
    body.innerHTML = `
      <div class="hbs-banner">
        <div class="hb-thumb"><img src="${P.esc(b.image)}" alt=""></div>
        <div><b>${SLOT_NAMES[b.slot] || P.esc(b.slot)}</b><span class="gh-muted">${b.link ? '🔗 ' + P.esc(b.link) : 'Không có liên kết'}</span></div>
      </div>
      <div class="hbs-tiles">
        ${tile('Lượt hiển thị', fmtNum(st.views), `${fmtNum(st.viewers)} người khác nhau`)}
        ${tile('Lượt click', fmtNum(st.clicks), `${fmtNum(st.clickers)} người khác nhau`)}
        ${tile('Tỉ lệ click', ctr(st.views, st.clicks), 'click ÷ lượt hiển thị')}
        ${tile('Hôm nay', `${fmtNum(st.today && st.today.views)} / ${fmtNum(st.today && st.today.clicks)}`, 'xem / click')}
        ${tile('7 ngày qua', `${fmtNum(st.week && st.week.views)} / ${fmtNum(st.week && st.week.clicks)}`, 'xem / click')}
        ${tile('Click gần nhất', agoText(st.last_click), '')}
      </div>
      ${barChart(series, 'views', 'Lượt hiển thị theo ngày')}
      ${barChart(series, 'clicks', 'Lượt click theo ngày')}
      <details class="hbs-table"><summary>Bảng số liệu theo ngày</summary>
        <table><thead><tr><th>Ngày</th><th>Lượt xem</th><th>Click</th><th>Tỉ lệ</th></tr></thead><tbody>
        ${series.slice().reverse().map((d) => `<tr><td>${P.esc(viDay(d.day))}</td><td>${fmtNum(d.views)}</td><td>${fmtNum(d.clicks)}</td><td>${ctr(d.views, d.clicks)}</td></tr>`).join('')}
        </tbody></table>
      </details>
      <p class="gh-muted hbs-help">Lượt hiển thị được tính mỗi lần banner xuất hiện trên màn hình người xem (kể cả khi đổi lượt). Cùng một người xem lại trong 10 giây hoặc bấm lại trong 5 giây chỉ tính một lần.</p>
      <div class="hbs-tip" hidden></div>`;
    const tip = body.querySelector('.hbs-tip');
    const showTip = (col) => {
      if (!col) { tip.hidden = true; return; }
      tip.textContent = col.dataset.tip;
      tip.hidden = false;
      const r = col.getBoundingClientRect();
      const br = body.getBoundingClientRect();
      tip.style.left = (r.left + r.width / 2 - br.left) + 'px';
      tip.style.top = (r.top - br.top + col.querySelector('.hbs-bar-wrap').offsetHeight - col.querySelector('.hbs-bar').offsetHeight - 6) + 'px';
    };
    body.addEventListener('mouseover', (e) => showTip(e.target.closest('.hbs-col')));
    body.addEventListener('mouseleave', () => showTip(null));
    body.addEventListener('focusin', (e) => showTip(e.target.closest('.hbs-col')));
    const m = P.modal({ title: '📊 Thống kê banner', body, actions: [{ label: 'Đóng' }] });
    m.el.querySelector('.gh-modal').classList.add('hb-modal');
  }
  function renderAdList(data) {
    adBanners = data.banners || [];
    const html = adBanners.length ? adBanners.map((b) => {
      const [cls, label] = !b.enabled ? ['off', 'Đang tắt'] : !b.running ? ['off', 'Đã hết hạn'] : ['on', 'Đang chạy'];
      return `<div class="hb-row ${b.running ? '' : 'off'}">
        <div class="hb-thumb"><img src="${P.esc(b.image)}" alt=""></div>
        <div class="hb-info">
          <b>${SLOT_NAMES[b.slot] || P.esc(b.slot)} <span class="hb-state ${cls}">${label}</span><span class="gh-muted">${b.until ? 'đến ' + P.esc(viDay(b.until)) : 'không giới hạn'}</span></b>
          <span>${b.link ? '🔗 ' + P.esc(b.link) : 'Không có liên kết'}</span>
          ${b.note ? `<span>💬 ${P.esc(b.note)}</span>` : ''}
          ${statLine(b.stats)}
        </div>
        <div class="hb-btns">
          <button class="gh-btn small ghost" type="button" data-hb-stats="${P.esc(b.id)}" title="Thống kê">📊</button>
          <button class="gh-btn small ghost" type="button" data-hb-edit="${P.esc(b.id)}" title="Sửa">✏️</button>
          <button class="gh-btn small ghost" type="button" data-hb-toggle="${P.esc(b.id)}" data-on="${b.enabled ? 1 : 0}" title="${b.enabled ? 'Tắt' : 'Bật'}">${b.enabled ? '⏸' : '▶️'}</button>
          <button class="gh-btn small ghost" type="button" data-hb-del="${P.esc(b.id)}" title="Xoá">🗑</button>
        </div>
      </div>`;
    }).join('') : '<div class="empty">Chưa có banner nào — bấm “＋ Tạo banner” ở trên.</div>';
    if (html !== adListHTML) { adListHTML = html; $('#hb-list').innerHTML = html; }
  }
  $('#hb-list').addEventListener('click', (e) => {
    const edit = e.target.closest('[data-hb-edit]');
    const toggle = e.target.closest('[data-hb-toggle]');
    const del = e.target.closest('[data-hb-del]');
    const stats = e.target.closest('[data-hb-stats]');
    if (stats) {
      const b = adBanners.find((x) => x.id === stats.dataset.hbStats);
      if (b) openAdStats(b);
    } else if (edit) {
      const b = adBanners.find((x) => x.id === edit.dataset.hbEdit);
      if (b) openAdEditor(b);
    } else if (toggle) {
      api('/api/admin/board', { id: toggle.dataset.hbToggle, enabled: toggle.dataset.on !== '1' })
        .then((data) => { renderAdList(data); loadAds(); })
        .catch((err) => P.toast(err.message, 'error'));
    } else if (del) {
      P.modal({
        title: 'Xoá banner này?',
        body: '<p class="gh-muted">Banner sẽ biến mất khỏi trang chủ. Nếu vị trí đó không còn banner nào, trang chủ trở lại như bình thường.</p>',
        actions: [
          { label: 'Huỷ' },
          { label: 'Xoá', kind: 'danger', onClick: () => {
            api('/api/admin/board', { delete: del.dataset.hbDel })
              .then((data) => { renderAdList(data); loadAds(); P.toast('Đã xoá banner.', 'good'); })
              .catch((err) => P.toast(err.message, 'error'));
          } },
        ],
      });
    }
  });

  // Mã đã lưu từ lần trước: kiểm tra lại (admin có thể đã xoá mã).
  async function restorePerk() {
    if (!perkCode) return;
    try {
      setPerk(perkCode, await api('/api/code', { code: perkCode }));
    } catch (e) {
      if (e.status === 403) setPerk('', null);
    }
  }

  // ---------------------------------------------------------------- người đang hoạt động
  // Trang sảnh “điểm danh” với máy chủ mỗi 10 giây (người trong phòng chơi thì máy chủ tự biết).
  function presence(leave = false) {
    const body = JSON.stringify(leave
      ? { pid: P.getPid(), leave: true }
      : { pid: P.getPid(), name: nameInput.value.trim() || P.getName(), look: Avatar.get(), did: P.getDid(), away: document.hidden });
    if (leave && navigator.sendBeacon) {
      navigator.sendBeacon('/api/presence', new Blob([body], { type: 'application/json' }));
      return Promise.resolve();
    }
    return fetch('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
      .then((r) => r.json()).then(showNotice).catch(() => {});
  }

  // Thông báo của admin: mỗi thông báo chỉ hiện một lần.
  let lastNotice = null;
  try { lastNotice = sessionStorage.getItem('gh_notice'); } catch (e) { /* bỏ qua */ }
  function showNotice(data) {
    const n = data && data.notice;
    if (!n || n.id === lastNotice) return;
    lastNotice = n.id;
    try { sessionStorage.setItem('gh_notice', n.id); } catch (e) { /* bỏ qua */ }
    if (P.announce) P.announce(n.message, n.id); else P.toast('📢 ' + n.message, 'info', 8000);
  }
  let presenceTimer = null;
  const presenceSoon = () => { clearTimeout(presenceTimer); presenceTimer = setTimeout(() => presence().then(loadOnline), 700); };
  nameInput.addEventListener('input', presenceSoon);
  window.addEventListener('pagehide', () => presence(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) presence().then(loadOnline); else presence(); });

  const onlineBox = $('#online');
  let onlineOpen = false;  // mặc định thu gọn; mở ra thì nằm đè lên banner, banner giữ nguyên kích thước
  onlineBox.classList.toggle('open', onlineOpen);
  $('#online-toggle').addEventListener('click', () => {
    onlineOpen = !onlineOpen;
    onlineBox.classList.toggle('open', onlineOpen);
  });

  let onlineHTML = '';
  async function loadOnline() {
    let list;
    try { list = await (await fetch('/api/online?did=' + encodeURIComponent(P.getDid()))).json(); } catch (e) { return; }
    const me = P.getPid();
    $('#online-count').textContent = list.length;
    const html = list.length ? list.map((u) => {
      const mine = u.me || u.id === me;
      const where = u.room
        ? `${u.room.icon} ${P.esc(u.room.gameName)} · phòng ${P.esc(u.room.code)}`
        : '🏠 Đang ở sảnh';
      const attrs = u.room && !mine ? `data-room="${P.esc(u.room.code)}" data-game="${P.esc(u.room.game)}" title="Vào phòng ${P.esc(u.room.code)}"` : '';
      return `<div class="ol-row ${mine ? 'me' : ''}" ${attrs}>
        <div class="ol-ava">${Avatar.svg(u.look, { head: true, seed: u.id })}<i class="dot"></i></div>
        <div class="ol-info"><b>${P.esc(u.name)}${mine ? ' (bạn)' : ''}</b><span>${where}</span></div></div>`;
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
  loadAds();
  restorePerk();
  presence().then(loadOnline);
  setInterval(loadRooms, 3000);
  setInterval(loadOnline, 3000);
  setInterval(loadAdmin, 5000);
  setInterval(presence, 10000);
  setInterval(loadAds, 60000);
})();
