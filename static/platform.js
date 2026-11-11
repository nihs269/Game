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
  // Mã chung cho mọi tab của trình duyệt: để danh sách “Đang hoạt động” gộp các tab của cùng một người.
  P.getDid = () => {
    let id = store('local', 'gh_did');
    if (!id) { id = randomId(); store('local', 'gh_did', id); }
    return id;
  };

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

  // ---------------------------------------------------------------- thông báo của admin (dòng chữ chạy ở trên cùng)
  // Khung bo góc, rộng bằng khối nội dung giữa trang chủ (980 − 2×16px), cách mép trên một chút.
  // Chữ cầu vồng lấp lánh chạy ngang vài lượt rồi tự ẩn. Tự mang CSS theo để trang game nào cũng giống nhau.
  const TICK_SPEED = 130;      // px / giây
  const TICK_LOOPS = 3;        // số lượt chạy rồi tự ẩn
  const TICK_CSS = `
.gh-tick{position:fixed;left:0;right:0;top:10px;margin:0 auto;width:min(var(--gh-tick-w,948px),calc(100% - 32px));z-index:10000;height:44px;display:flex;align-items:center;gap:10px;padding:0 8px 0 10px;
  border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,.1);
  background:linear-gradient(180deg,rgba(14,10,38,.97),rgba(24,14,52,.95));box-shadow:0 6px 24px rgba(0,0,0,.45);
  animation:gh-tick-in .4s ease-out both}
.gh-tick.out{animation:gh-tick-out .35s ease-in both}
.gh-tick::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;
  background:linear-gradient(90deg,#ff4d6d,#ffb347,#ffe66d,#5bf08f,#4dd9ff,#7a7bff,#d36bff,#ff4d6d);background-size:200% 100%;animation:gh-tick-hue 3s linear infinite}
.gh-tick-view{position:relative;flex:1;min-width:0;height:100%;overflow:hidden;
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 24px,#000 calc(100% - 24px),transparent);mask-image:linear-gradient(90deg,transparent,#000 24px,#000 calc(100% - 24px),transparent)}
.gh-tick-track{position:absolute;top:0;bottom:0;left:0;display:flex;align-items:center;white-space:nowrap;will-change:transform}
.gh-tick-text{position:relative;font-size:18px;font-weight:800;letter-spacing:.01em;color:transparent;
  background:linear-gradient(90deg,#ff4d6d,#ffb347,#ffe66d,#5bf08f,#4dd9ff,#7a7bff,#d36bff,#ff4d6d);background-size:300px 100%;
  -webkit-background-clip:text;background-clip:text;animation:gh-tick-hue 2.4s linear infinite;
  filter:drop-shadow(0 0 6px rgba(255,255,255,.28))}
.gh-tick-star{position:absolute;pointer-events:none;color:#fff;font-size:12px;line-height:1;text-shadow:0 0 6px #fff,0 0 12px #ffe66d;
  animation:gh-tick-star 1.6s ease-in-out infinite;opacity:0}
.gh-tick-x{flex:0 0 auto;width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);
  color:#eceaf8;font-size:17px;line-height:1;cursor:pointer;display:grid;place-items:center}
.gh-tick-x:hover{background:rgba(255,255,255,.16)}
@keyframes gh-tick-in{from{transform:translateY(-120%);opacity:0}to{transform:none;opacity:1}}
@keyframes gh-tick-out{to{transform:translateY(-120%);opacity:0}}
@keyframes gh-tick-hue{from{background-position:0 0}to{background-position:300px 0}}
@keyframes gh-tick-star{0%,100%{opacity:0;transform:scale(.3) rotate(0)}50%{opacity:1;transform:scale(1) rotate(90deg)}}
@media (max-width:600px){.gh-tick{height:40px;top:8px;width:calc(100% - 16px);border-radius:12px}.gh-tick-text{font-size:16px}}
@media (prefers-reduced-motion:reduce){.gh-tick,.gh-tick.out,.gh-tick-text,.gh-tick::after,.gh-tick-star{animation:none}.gh-tick-star{opacity:.8}}
`;
  let tickEl = null;
  P.announce = (message, id) => {
    if (id) { try { sessionStorage.setItem('gh_notice', id); } catch (e) { /* bỏ qua */ } }
    if (!document.getElementById('gh-tick-css')) {
      const st = document.createElement('style');
      st.id = 'gh-tick-css';
      st.textContent = TICK_CSS;
      document.head.appendChild(st);
    }
    if (tickEl) tickEl.remove();
    const bar = document.createElement('div');
    bar.className = 'gh-tick';
    bar.setAttribute('role', 'status');
    bar.innerHTML = `<div class="gh-tick-view"><div class="gh-tick-track"><span class="gh-tick-text"></span></div></div>
      <button class="gh-tick-x" type="button" aria-label="Đóng">×</button>`;
    const text = bar.querySelector('.gh-tick-text');
    const track = bar.querySelector('.gh-tick-track');
    text.textContent = message;
    document.body.appendChild(bar);
    tickEl = bar;
    // Ngôi sao lấp lánh rải dọc dòng chữ
    const tw = text.offsetWidth;
    for (let x = 10; x < tw; x += 42 + Math.random() * 40) {
      const s = document.createElement('span');
      s.className = 'gh-tick-star';
      s.textContent = Math.random() < 0.5 ? '✦' : '✧';
      s.style.left = x + 'px';
      s.style.top = (Math.random() < 0.5 ? 3 : 62) + Math.random() * 12 + '%';
      s.style.fontSize = 8 + Math.random() * 7 + 'px';
      s.style.animationDelay = (-Math.random() * 1.6).toFixed(2) + 's';
      track.appendChild(s);
    }
    let closed = false;
    let anim = null;
    const close = () => {
      if (closed) return;
      closed = true;
      if (anim) anim.cancel();
      bar.classList.add('out');
      setTimeout(() => { bar.remove(); if (tickEl === bar) tickEl = null; }, 360);
    };
    bar.querySelector('.gh-tick-x').addEventListener('click', close);
    const view = bar.querySelector('.gh-tick-view');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !track.animate) {
      track.style.transform = `translateX(${Math.max(0, (view.offsetWidth - tw) / 2)}px)`;
      setTimeout(close, 15000);
      return;
    }
    // Chạy từ mép phải sang hết mép trái; rê chuột (hoặc chạm giữ) thì dừng để đọc.
    const vw = view.offsetWidth;
    anim = track.animate([{ transform: `translateX(${vw}px)` }, { transform: `translateX(${-tw}px)` }],
      { duration: (vw + tw) / TICK_SPEED * 1000, iterations: TICK_LOOPS, easing: 'linear' });
    anim.onfinish = close;
    bar.addEventListener('mouseenter', () => anim.pause());
    bar.addEventListener('mouseleave', () => { if (!closed) anim.play(); });
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
          look: window.Avatar ? window.Avatar.get() : null, did: P.getDid(), away: document.hidden,
          code: store('local', 'gh_code') || '',     // người có vai trò → cả phòng thấy “… đã vào phòng”
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
        } else if (m.type === 'announce') {
          P.announce(m.message, m.id);
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
    // Báo máy chủ khi tab bị ẩn / hiện lại: tab bỏ chạy nền lâu thì không tính là “đang hoạt động”.
    document.addEventListener('visibilitychange', () => {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'away', away: document.hidden }));
    });

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
