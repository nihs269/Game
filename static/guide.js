/* Hướng dẫn chơi dùng chung cho sảnh và mọi game. Nội dung lấy từ thuộc tính
 * `guide` của từng game (qua /api/games). Trong phòng, nút #btn-guide tự mở
 * hướng dẫn của game hiện tại (xác định theo đường dẫn /g/<id>/). */
(function () {
  const P = window.Platform;
  let games = null;

  async function load() {
    if (!games) games = await (await fetch('/api/games')).json();
    return games;
  }

  // Thoát HTML rồi mới cho phép **chữ đậm**.
  const fmt = (s) => P.esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  function bodyHTML(g) {
    const sections = g.guide.map((s) => `<section class="gd-sec"><h3>${fmt(s.title)}</h3>${Array.isArray(s.body)
      ? `<ul>${s.body.map((li) => `<li>${fmt(li)}</li>`).join('')}</ul>`
      : `<p>${fmt(s.body)}</p>`}</section>`).join('');
    const common = `<section class="gd-sec gd-common"><h3>🏠 Phòng chơi</h3><ul>
      <li>Nhập tên ở sảnh, bấm <b>＋ Tạo phòng</b> rồi gửi <b>mã phòng 4 ký tự</b> hoặc <b>link mời</b> cho bạn bè.</li>
      ${g.bots ? '<li>Không đủ người? Chủ phòng bấm <b>＋ bot</b> ở phòng chờ để thêm người chơi ảo.</li>' : ''}
      <li>Rớt mạng hay lỡ đóng tab? Vào lại phòng với <b>đúng tên cũ</b> là chơi tiếp được.</li>
      <li>Nhấn vào nhân vật của người khác để vẫy tay, thả tim, ném cà chua…</li></ul></section>`;
    return `<div class="gd-meta">👥 ${g.minPlayers}–${g.maxPlayers} người chơi${g.bots ? ' · 🤖 có bot' : ''}</div>
      <p class="gd-desc">${P.esc(g.description)}</p>${sections || '<p class="gh-muted">Game này chưa có hướng dẫn.</p>'}${common}`;
  }

  async function open(gameId) {
    let g;
    try { g = (await load()).find((x) => x.id === gameId); } catch (e) { g = null; }
    if (!g) { P.toast('Không tải được hướng dẫn.', 'error'); return; }
    const m = P.modal({
      title: `${g.icon} Hướng dẫn chơi ${P.esc(g.name)}`,
      body: bodyHTML(g),
      actions: [{ label: 'Đã hiểu!', kind: 'primary' }],
    });
    m.el.querySelector('.gh-modal').classList.add('gd-modal');
  }

  window.Guide = { open };

  const match = location.pathname.match(/^\/g\/([^/]+)/);
  const btn = document.getElementById('btn-guide');
  if (match && btn) btn.addEventListener('click', () => open(match[1]));
})();
