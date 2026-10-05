/* Thư viện dùng chung cho sảnh và mọi game: định danh người chơi, kết nối
 * WebSocket (tự kết nối lại), toast, modal nhập tên, sao chép. */
(function () {
  const P = {};

  function randomId() {
    let s = '';
    for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
    return 'p' + s + Date.now().toString(16);
  }

  function store(kind, key, value) {
    try {
      const st = kind === 'session' ? sessionStorage : localStorage;
      if (value === undefined) return st.getItem(key);
      st.setItem(key, value);
    } catch (e) { return null; }
  }

  P.esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  P.getName = () => store('local', 'gh_name') || '';
  P.setName = (n) => store('local', 'gh_name', n);

  // Mỗi tab một mã người chơi (giữ nguyên khi tải lại trang).
  P.getPid = () => {
    let id = store('session', 'gh_pid');
    if (!id) { id = randomId(); store('session', 'gh_pid', id); }
    return id;
  };
  P.setPid = (id) => store('session', 'gh_pid', id);

  P.hue = (text) => {
    let h = 0;
    for (const ch of String(text)) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
  };
  P.initials = (name) => {
    const parts = String(name).trim().split(/\s+/);
    const a = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : String(name).slice(0, 2);
    return a.toUpperCase();
  };

  // ---------------------------------------------------------------- toast
  let toastBox;
  P.toast = (message, kind = 'info', ms = 3200) => {
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.className = 'gh-toasts';
      document.body.appendChild(toastBox);
    }
    const el = document.createElement('div');
    el.className = 'gh-toast ' + kind;
    el.textContent = message;
    toastBox.appendChild(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
  };

  // ---------------------------------------------------------------- copy (hoạt động cả khi không có HTTPS)
  P.copy = async (text) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* thử cách cũ */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  };

  // ---------------------------------------------------------------- modal
  P.modal = ({ title, body, actions = [], dismissable = true }) => {
    const wrap = document.createElement('div');
    wrap.className = 'gh-modal-wrap';
    wrap.innerHTML = `<div class="gh-modal" role="dialog" aria-modal="true">
      ${title ? `<h2>${title}</h2>` : ''}
      <div class="gh-modal-body"></div>
      <div class="gh-modal-actions"></div></div>`;
    const bodyEl = wrap.querySelector('.gh-modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    const close = () => wrap.remove();
    const actEl = wrap.querySelector('.gh-modal-actions');
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.className = 'gh-btn ' + (a.kind || '');
      b.textContent = a.label;
      b.onclick = () => { if (a.onClick && a.onClick(wrap) === false) return; close(); };
      actEl.appendChild(b);
    });
    if (dismissable) wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    document.body.appendChild(wrap);
    return { el: wrap, close };
  };

  P.askName = (onDone, { message } = {}) => {
    const body = document.createElement('div');
    body.innerHTML = `${message ? `<p class="gh-muted">${P.esc(message)}</p>` : ''}
      <input class="gh-input" maxlength="20" placeholder="Tên hiển thị của bạn" value="${P.esc(P.getName())}">`;
    const input = body.querySelector('input');
    const submit = () => {
      const name = input.value.trim().replace(/\s+/g, ' ');
      if (!name) { input.focus(); input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 400); return false; }
      P.setName(name);
      onDone(name);
      return true;
    };
    const m = P.modal({
      title: 'Bạn tên là gì?', body, dismissable: false,
      actions: [{ label: 'Vào chơi', kind: 'primary', onClick: () => submit() }],
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && submit()) m.close(); });
    setTimeout(() => input.focus(), 50);
  };

  P.ensureName = (cb) => { const n = P.getName(); if (n) cb(n); else P.askName(cb); };

  // ---------------------------------------------------------------- kết nối phòng
  P.connect = ({ room, onState, onJoined, onFatal, onStatus, onFx, onRtc, onMessage }) => {
    let ws = null;
    let stopped = false;
    let retry = 0;

    function open() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        retry = 0;
        ws.send(JSON.stringify({
          type: 'join', room, pid: P.getPid(), name: P.getName(),
          look: window.Avatar ? window.Avatar.get() : null,
        }));
      };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.type === 'joined') {
          if (m.pid !== P.getPid()) P.setPid(m.pid);
          onStatus && onStatus(true);
          onJoined && onJoined(m);
        } else if (m.type === 'state') {
          onState && onState(m.state, m.voice);
        } else if (m.type === 'rtc') {
          onRtc && onRtc(m);
        } else if (m.type === 'fx') {
          onFx && onFx(m);
        } else if (m.type === 'toast') {
          P.toast(m.message, m.kind || 'info');
        } else if (m.type === 'error') {
          if (m.fatal) {
            stopped = true;
            onFatal ? onFatal(m) : P.toast(m.message, 'error');
          } else {
            P.toast(m.message, 'error');
          }
        } else {
          onMessage && onMessage(m);  // tin nhắn riêng của từng game (VD nét vẽ)
        }
      };
      ws.onclose = () => {
        onStatus && onStatus(false);
        if (stopped) return;
        const delay = Math.min(5000, 400 * Math.pow(2, retry++));
        setTimeout(open, delay);
      };
    }
    open();

    return {
      send(action, data = {}) {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'action', action, data }));
          return true;
        }
        P.toast('Mất kết nối, đang thử kết nối lại…', 'error');
        return false;
      },
      sendRaw(msg) {
        if (ws && ws.readyState === 1) { ws.send(JSON.stringify(msg)); return true; }
        return false;
      },
      leave() {
        stopped = true;
        try { ws.send(JSON.stringify({ type: 'leave' })); } catch (e) { /* bỏ qua */ }
        setTimeout(() => { try { ws.close(); } catch (e) { /* bỏ qua */ } }, 100);
      },
      reconnect() { stopped = false; retry = 0; open(); },
    };
  };

  // Hiển thị lỗi nghiêm trọng mặc định (phòng không tồn tại, bị kick, ...).
  P.showFatal = (m, { onRetryName } = {}) => {
    const actions = [{ label: 'Về sảnh', kind: 'primary', onClick: () => { location.href = '/'; } }];
    if (m.code === 'name_taken' && onRetryName) {
      actions.unshift({ label: 'Đổi tên', onClick: () => { P.askName(onRetryName, { message: m.message }); } });
    }
    P.modal({ title: 'Không thể vào phòng', body: `<p>${P.esc(m.message)}</p>`, actions, dismissable: false });
  };

  window.Platform = P;
})();
