(function () {
  const P = window.Platform;
  const $ = (s) => document.querySelector(s);
  const esc = P.esc;
  const ROOM = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (!ROOM) { location.href = '/'; return; }

  let S = null;          // trạng thái mới nhất từ máy chủ
  let B = null;          // dữ liệu bàn cờ (board.json)
  let conn = null;
  let clockOffset = 0;
  const ui = {
    lastSeq: null, disp: {}, anims: {}, flying: {}, info: null, hl: null,
    tab: 'players', unread: 0, lastChatId: null, lanBase: null, sound: true, wasMine: false,
  };
  try { ui.sound = localStorage.getItem('typhu_sound') !== '0'; } catch (e) { /* bỏ qua */ }

  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
  };
  const STEP_MS = 190;
  const FLY_MS = 80;
  const HOTEL = 4;
  const LEVEL_NAMES = ['Đất trống', 'Nhà cấp 1', 'Nhà cấp 2', 'Nhà cấp 3', 'Khách sạn'];
  const LEVEL_ICON = ['🌱', '🛖', '🏠', '🏡', '🏨'];
  const RENT_MULT = [0.1, 0.3, 0.6, 1.0, 1.8];
  const RESORT_RENT = [0, 40, 90, 180, 360];
  const SPECIAL_INFO = {
    start: 'Mỗi lần đi qua hoặc dừng ở đây, nhận lương $300K. Số vòng đã đi quyết định được xây tối đa mấy nhà.',
    island: 'Kẹt tối đa 3 lượt. Thoát bằng cách đổ ra đôi, nộp $200K hoặc dùng vé thoát đảo.',
    champ: 'Chọn một thành phố của bạn để tổ chức World Championship. Cả bàn chỉ có một nơi đăng cai — người sau tổ chức thì nơi cũ mất giải. Mỗi lần tổ chức hệ số tăng: ×2 → ×3 → ×4 → ×5.',
    tour: 'Lượt sau được bay tới một thành phố chưa có chủ hoặc của chính bạn (vé $50K) thay vì đổ xúc xắc.',
    chance: 'Rút một thẻ: vé thoát đảo, thiên thần (miễn tiền thuê), phiếu giảm 50%, động đất, xổ số…',
    tax: 'Nộp 10% tổng tài sản (tiền + giá trị thành phố) cho ngân hàng.',
  };

  // ---------------------------------------------------------------- tiện ích
  let cast = null;
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
  const money = (n) => `$${Number(n || 0).toLocaleString('vi-VN')}K`;
  const btn = (act, text, kind = '', extra = '') => `<button class="gh-btn ${kind}" data-act="${act}" ${extra}>${text}</button>`;
  const sq = (i) => B.squares[i];
  const propOf = (i) => (S && S.props[String(i)]) || null;
  const group = (s) => (s.group ? B.groups[s.group] : null);
  const groupBg = (g) => `linear-gradient(135deg, ${shade(g.color, 0.3)}, ${g.color})`;
  const me = () => player(S.me.id);
  const N = () => B.squares.length;
  const DECIDING = ['roll', 'island', 'tour', 'buy', 'upgrade', 'buyout', 'champ', 'debt'];

  function anchorEl(pid) {
    const a = cast && cast.anchor(pid);
    if (a) return a;
    return document.querySelector(`#tokens [data-pid="${CSS.escape(pid || '')}"]`)
      || document.querySelector(`#plist [data-pid="${CSS.escape(pid || '')}"] .ava`);
  }
  const rectOf = (el) => (el ? el.getBoundingClientRect() : null);
  const ownsGroup = (pid, g) => B.squares.every((s, i) => s.group !== g || (propOf(i) && propOf(i).owner === pid));

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
    dice: () => Array.from({ length: 9 }, () => [220 + Math.random() * 260, 0.05, 'square', 0.03]),
    step: () => [[700 + Math.random() * 80, 0.04, 'triangle', 0.04]],
    buy: () => [[880, 0.08], [1320, 0.08], [1760, 0.18]],
    buyout: () => [[440, 0.08, 'square', 0.05], [660, 0.08, 'square', 0.05], [990, 0.2, 'square', 0.05]],
    rent: () => [[520, 0.1, 'triangle'], [390, 0.18, 'triangle']],
    money: () => [[1046, 0.07], [1318, 0.14]],
    card: () => [[600, 0.06, 'triangle', 0.05], [900, 0.1, 'triangle', 0.05]],
    island: () => [[392, 0.2, 'sine', 0.07], [330, 0.2, 'sine', 0.07], [262, 0.4, 'sine', 0.07]],
    build: () => [[200, 0.05, 'square', 0.06], [200, 0.05, 'square', 0.06], [260, 0.08, 'square', 0.05]],
    champ: () => [[523, 0.1], [659, 0.1], [784, 0.1], [1046, 0.1], [1318, 0.3]],
    fly: () => [[300, 0.3, 'sawtooth', 0.03], [600, 0.3, 'sawtooth', 0.03], [900, 0.3, 'sawtooth', 0.02]],
    quake: () => [[80, 0.4, 'sawtooth', 0.1], [60, 0.4, 'sawtooth', 0.08]],
    bankrupt: () => [[300, 0.2, 'sawtooth', 0.06], [200, 0.25, 'sawtooth', 0.06], [120, 0.5, 'sawtooth', 0.06]],
    win: () => [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]],
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
    fresh.filter((e) => e.type === 'roll' && e.dice).forEach((e) => rollDice(e.dice));
    if (first) S.players.forEach((p) => { ui.disp[p.id] = p.pos; });
    fresh.filter((e) => e.type === 'move').forEach((e) => {
      clearInterval(ui.anims[e.pid]);
      ui.anims[e.pid] = -1;
      ui.disp[e.pid] = e.frm;
    });
    const mine = !!state.myTurn && DECIDING.includes(state.stage);
    if (mine && !ui.wasMine && !first) { play('turn'); if (navigator.vibrate) navigator.vibrate(120); }
    ui.wasMine = mine;
    if (B) render();
    fresh.forEach(playEvent);
  }

  // ---------------------------------------------------------------- hiệu ứng
  function floaty(pid, text, neg) {
    const r = rectOf(anchorEl(pid));
    if (!r) return;
    const el = document.createElement('div');
    el.className = 'floaty' + (neg ? ' neg' : '');
    el.textContent = text;
    el.style.left = (r.left + r.width / 2) + 'px';
    el.style.top = r.top + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1900);
  }
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
  function fly(html, from, to, { dur = 500 } = {}) {
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
  function flashCell(i, cls = 'landed') {
    const cell = document.querySelector(`.cell[data-sq="${i}"]`);
    if (cell) { cell.classList.remove(cls); void cell.offsetWidth; cell.classList.add(cls); setTimeout(() => cell.classList.remove(cls), 1300); }
  }

  // Quân cờ đi từng ô; World Tour thì bay lướt qua từng ô theo đúng chiều đi (không bay lùi).
  function animateMove(e) {
    const n = N();
    const path = [];
    let i = e.frm;
    while (i !== e.to && path.length < n) {
      i = e.back ? (i + n - 1) % n : (i + 1) % n;
      path.push(i);
    }
    if (e.fly) { play('fly'); ui.flying[e.pid] = true; }
    clearInterval(ui.anims[e.pid]);
    let k = 0;
    ui.anims[e.pid] = setInterval(() => {
      if (k >= path.length) {
        clearInterval(ui.anims[e.pid]);
        delete ui.anims[e.pid];
        delete ui.flying[e.pid];
        flashCell(e.to);
        renderTokens();
        renderBoard();
        return;
      }
      ui.disp[e.pid] = path[k++];
      renderTokens();
      if (!e.fly) play('step');
    }, e.fly ? FLY_MS : STEP_MS);
  }

  function playEvent(e) {
    switch (e.type) {
      case 'roll': play('dice'); break;
      case 'move': animateMove(e); break;
      case 'money': floaty(e.pid, `+${money(e.amount)}`); play('money'); if (cast) cast.react(e.pid, 'cheer'); break;
      case 'pay':
        floaty(e.pid, `-${money(e.amount)}`, true);
        (e.to || []).forEach((q) => setTimeout(() => floaty(q, `+${money(e.amount)}`), 500));
        break;
      case 'rent':
        play('rent');
        fly('<span style="font-size:26px">💸</span>', rectOf(anchorEl(e.pid)), rectOf(anchorEl(e.to)), { dur: 650 });
        if (cast) { cast.react(e.pid, 'sad'); setTimeout(() => cast.react(e.to, 'cheer'), 500); }
        break;
      case 'buy': play('buy'); flashCell(e.square, 'bought'); bubble(e.pid, '🏙️', 'emoji'); if (cast) cast.react(e.pid, 'cheer'); break;
      case 'build': play('build'); flashCell(e.square, 'bought'); if (cast) cast.react(e.pid, 'cheer'); break;
      case 'buyout':
        play('buyout'); flashCell(e.square, 'bought'); bubble(e.pid, '🤝', 'emoji');
        if (cast) { cast.react(e.pid, 'cheer'); cast.react(e.frm, 'sad'); }
        break;
      case 'champ': play('champ'); flashCell(e.square, 'bought'); (e.lost || []).forEach((j) => flashCell(j, 'quake')); bubble(e.pid, '🏆', 'emoji'); break;
      case 'monopoly': monopolyFx(e); break;
      case 'quake': play('quake'); flashCell(e.square, 'quake'); document.body.classList.remove('shake'); void document.body.offsetWidth; document.body.classList.add('shake'); break;
      case 'angel': bubble(e.pid, '😇', 'emoji'); play('money'); break;
      case 'card': play('card'); break;
      case 'island': play('island'); bubble(e.pid, '🏝️', 'emoji'); if (cast) cast.react(e.pid, 'sad'); break;
      case 'sell': flashCell(e.square, 'quake'); break;
      case 'debt': bubble(e.pid, '😰', 'emoji'); break;
      case 'bankrupt': play('bankrupt'); bubble(e.pid, '💥', 'emoji'); if (cast) cast.react(e.pid, 'sad'); break;
      case 'win': play('win'); bubble(e.pid, '🏆', 'emoji'); if (cast) cast.react(e.pid, 'cheer'); break;
      default:
    }
  }

  // Độc quyền vùng: vương miện + chữ lớn giữa bàn, pháo hoa màu chủ, các ô của vùng loé sáng.
  function monopolyFx(e) {
    const p = player(e.pid);
    const g = B.groups[e.group];
    const color = (p && p.color) || '#f5c542';
    play('champ');
    setTimeout(() => play('win'), 450);
    (e.squares || []).forEach((i, k) => setTimeout(() => flashCell(i, 'mono-burst'), k * 140));
    if (cast) cast.react(e.pid, 'cheer');
    const el = document.createElement('div');
    el.className = 'mono-fx';
    el.style.setProperty('--mc', color);
    el.style.setProperty('--gcol', g ? g.color : color);
    let sparks = '';
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * Math.PI * 2;
      const d = 22 + Math.random() * 18;
      sparks += `<i style="--x:${(Math.cos(a) * d).toFixed(1)}cqw;--y:${(Math.sin(a) * d).toFixed(1)}cqw;--dl:${(Math.random() * 0.25).toFixed(2)}s;--h:${Math.floor(Math.random() * 360)}"></i>`;
    }
    el.innerHTML = `<div class="mf-sparks">${sparks}</div><div class="mf-card"><div class="mf-crown">👑</div>
      <div class="mf-t">ĐỘC QUYỀN!</div><div class="mf-g">${esc(g ? g.name : '')}</div>
      <div class="mf-who">${who(e.pid)} · tiền thuê ×2</div></div>`;
    $('#board').appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function onFx(m) {
    const emoji = FX_EMOJI[m.kind] || '✨';
    if (m.to && m.to !== m.from) {
      fly(`<span style="font-size:30px">${emoji}</span>`, rectOf(anchorEl(m.from)), rectOf(anchorEl(m.to)), { dur: 550 });
      setTimeout(() => bubble(m.to, emoji, 'emoji'), 520);
    } else {
      bubble(m.from, emoji, 'emoji');
    }
  }

  // ---------------------------------------------------------------- bàn cờ 32 ô (lưới 9×9)
  function cellPos(i) {
    if (i <= 8) return [9, 9 - i];
    if (i <= 16) return [9 - (i - 8), 1];
    if (i <= 24) return [1, 1 + (i - 16)];
    return [1 + (i - 24), 9];
  }
  const sideOf = (i) => (i % 8 === 0 ? 'corner' : i < 8 ? 's-b' : i < 16 ? 's-l' : i < 24 ? 's-t' : 's-r');

  function buildBoard() {
    const board = $('#board');
    B.squares.forEach((s, i) => {
      const [r, c] = cellPos(i);
      const el = document.createElement('div');
      el.className = `cell ${sideOf(i)} t-${s.type}`;
      el.dataset.sq = i;
      el.style.gridRow = r;
      el.style.gridColumn = c;
      const g = group(s);
      if (g) el.style.setProperty('--gc', g.color);
      const ownable = s.type === 'city' || s.type === 'resort';
      const band = ownable ? `<div class="band ${s.type === 'resort' ? 'resort-band' : ''}"><span class="bn">${esc(s.name)}</span></div>` : '';
      el.innerHTML = `${ownable && s.icon ? `<div class="cbg">${s.icon}</div>` : ''}${band}<div class="cbody">
          ${ownable ? '<div class="bld"></div>' : `<div class="ci">${s.icon || ''}</div><div class="cn">${esc(s.name)}</div>`}
          ${s.price ? `<div class="cp">${money(s.price)}</div>` : ''}</div>
        <div class="champ"></div><div class="mono-b">👑</div>`;
      board.appendChild(el);
    });
  }

  // Pha sáng (amt > 0) / tối (amt < 0) một màu hex — để tô nhà theo màu chủ.
  function shade(hex, amt) {
    const n = parseInt(String(hex || '#888888').slice(1), 16) || 0;
    const f = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }
  // Pha trộn hai màu hex theo tỉ lệ t (0 = màu a, 1 = màu b).
  function mix(a, b, t) {
    const pa = parseInt(String(a).slice(1), 16) || 0;
    const pb = parseInt(String(b).slice(1), 16) || 0;
    const ch = (sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }
  // Phép chiếu isometric: (x, y, z) → toạ độ SVG. Mặt y = hằng (tường trái) và x = hằng (tường phải)
  // vẽ bằng ma trận để cửa, cửa sổ, chữ nằm đúng phối cảnh.
  const ISO = (x, y, z) => `${((x - y) * 0.866).toFixed(2)} ${((x + y) * 0.5 - z).toFixed(2)}`;
  const isoPoly = (pts, fill, extra = '') => `<path d="M${pts.map((q) => ISO(...q)).join('L')}Z" fill="${fill}" ${extra}/>`;
  const wallL = (y) => `matrix(.866 .5 0 1 ${(-y * 0.866).toFixed(2)} ${(y * 0.5).toFixed(2)})`;   // mặt y = const, toạ độ (x, -z)
  const wallR = (x) => `matrix(-.866 .5 0 1 ${(x * 0.866).toFixed(2)} ${(x * 0.5).toFixed(2)})`;  // mặt x = const, toạ độ (y, -z)
  const win = (x, y, w, h, glass = '#bfe4ff') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx=".25" fill="#fffaf0"/>`
    + `<rect x="${x + 0.3}" y="${y + 0.3}" width="${w - 0.6}" height="${h - 0.6}" rx=".15" fill="${glass}"/>`
    + `<path d="M${x + w / 2} ${y + 0.3}v${h - 0.6}M${x + 0.3} ${y + h / 2}h${w - 0.6}" stroke="#fffaf0" stroke-width=".25"/>`;

  // Mái hai dốc (sống mái chạy dọc trục x) — vẽ dốc sau, đầu hồi phải, rồi dốc trước.
  function gableRoof({ W, D, H, R, o, c, st, tiles = 3 }) {
    const lines = Array.from({ length: tiles }, (_, k) => (k + 1) / (tiles + 1)).map((t) => {
      const y = D + o - (D / 2 + o) * t; const z = H - 0.4 + (R + 0.4) * t;
      return `<path d="M${ISO(-o, y, z)}L${ISO(W + o, y, z)}" stroke="${shade(c, -0.25)}" stroke-width=".3"/>`;
    }).join('');
    return {
      back: isoPoly([[-o, -o, H - 0.4], [W + o, -o, H - 0.4], [W + o, D / 2, H + R], [-o, D / 2, H + R]], shade(c, -0.3), st),
      front: isoPoly([[-o, D + o, H - 0.4], [W + o, D + o, H - 0.4], [W + o, D / 2, H + R], [-o, D / 2, H + R]], c, st) + lines
        + isoPoly([[-o, D + o, H - 0.4], [W + o, D + o, H - 0.4], [W + o, D + o, H - 0.9], [-o, D + o, H - 0.9]], shade(c, -0.5))
        + `<path d="M${ISO(-o, D / 2, H + R)}L${ISO(W + o, D / 2, H + R)}" stroke="rgba(255,255,255,.5)" stroke-width=".4" stroke-linecap="round"/>`,
    };
  }
  const shadowBase = (W, D) => isoPoly([[-0.8, -0.8, 0], [W + 1.2, -0.8, 0], [W + 1.2, D + 1.2, 0], [-0.8, D + 1.2, 0]], 'rgba(0,0,0,.28)');
  const bush = (x, y, r) => { const [X, Y] = ISO(x, y, 0).split(' ').map(Number);
    return `<ellipse cx="${X}" cy="${Y - r * 0.7}" rx="${r}" ry="${r * 0.8}" fill="#3e9b4f"/><ellipse cx="${X - r * 0.3}" cy="${Y - r}" rx="${r * 0.55}" ry="${r * 0.45}" fill="#6cc46f"/>`; };

  // Cấp 1 — nhà gỗ đơn sơ: nhỏ, vách ván, một cửa, mái màu chủ.
  function cottageSVG(c) {
    const W = 7; const D = 6; const H = 4; const R = 3; const o = 0.5;
    const edge = shade(c, -0.55); const st = `stroke="${edge}" stroke-width=".3" stroke-linejoin="round"`;
    const left = mix(c, '#d9b47c', 0.78); const right = mix(c, '#a98353', 0.78);
    const planks = (w) => [1, 2, 3].map((z) => `<path d="M0 ${-z}H${w}" stroke="rgba(70,40,10,.3)" stroke-width=".18"/>`).join('');
    const roof = gableRoof({ W, D, H, R, o, c, st, tiles: 2 });
    return `<svg class="bld-1" viewBox="-7.1 -6 15.1 13.8">${shadowBase(W, D)}${roof.back}
      <g transform="${wallR(W)}"><path d="M0 0H${D}V${-H}L${D / 2} ${-H - R}L0 ${-H}Z" fill="${right}" ${st}/>${planks(D)}
        <rect x="2" y="-3.1" width="2" height="1.7" fill="#6b4a2a"/><path d="M2 -2.25h2" stroke="#d9b47c" stroke-width=".2"/></g>
      <g transform="${wallL(D)}"><rect x="0" y="${-H}" width="${W}" height="${H}" fill="${left}" ${st}/>${planks(W)}
        <rect x="2.6" y="-3" width="1.8" height="3" fill="#5a3a1e"/><rect x="5" y="-3" width="1.4" height="1.3" fill="#6b4a2a"/></g>
      ${roof.front}</svg>`;
  }
  // Cấp 2 — nhà 2 tầng: tường vữa, cửa sổ kính, ống khói, mái ngói.
  function houseSVG(c) {
    const W = 9; const D = 7; const H = 8; const R = 3.8; const o = 0.6;
    const edge = shade(c, -0.55); const st = `stroke="${edge}" stroke-width=".3" stroke-linejoin="round"`;
    const left = mix(c, '#fffaf2', 0.72); const right = mix(c, '#b8ad9e', 0.6);
    const roof = gableRoof({ W, D, H, R, o, c, st });
    return `<svg class="bld-2" viewBox="-8 -10.6 17.7 20">${shadowBase(W, D)}${roof.back}
      ${isoPoly([[6, 1, H + 1], [7.3, 1, H + 1], [7.3, 1, H + R + 1.5], [6, 1, H + R + 1.5]], shade(c, -0.2), st)}
      ${isoPoly([[7.3, 1, H + 1], [7.3, 2.3, H + 1], [7.3, 2.3, H + R + 1.5], [7.3, 1, H + R + 1.5]], shade(c, -0.4), st)}
      <g transform="${wallR(W)}"><path d="M0 0H${D}V${-H}L${D / 2} ${-H - R}L0 ${-H}Z" fill="${right}" ${st}/>
        <path d="M0 0H${D}V${-H}L${D / 2} ${-H - R}L0 ${-H}Z" fill="url(#bk-wall)"/>
        <rect x="0" y="-.7" width="${D}" height=".7" fill="#8d8a86"/><path d="M0 -4.2H${D}" stroke="${edge}" stroke-width=".25"/>
        ${win(2.2, -3.4, 2.6, 2.2, '#a9cde6')}${win(2.2, -7.2, 2.6, 2.2, '#a9cde6')}</g>
      <g transform="${wallL(D)}"><rect x="0" y="${-H}" width="${W}" height="${H}" fill="${left}" ${st}/>
        <rect x="0" y="${-H}" width="${W}" height="${H}" fill="url(#bk-wall)"/>
        <rect x="0" y="-.7" width="${W}" height=".7" fill="#9b9893"/><path d="M0 -4.2H${W}" stroke="${edge}" stroke-width=".25"/>
        <rect x="3.6" y="-3.5" width="1.9" height="3.5" rx=".3" fill="#7a4a2a"/><circle cx="5.1" cy="-1.7" r=".18" fill="#f5c542"/>
        ${win(0.9, -3.4, 2, 2.2)}${win(6.3, -3.4, 2, 2.2)}${win(0.9, -7.2, 2, 2.2)}${win(3.5, -7.2, 2, 2.2)}${win(6.3, -7.2, 2, 2.2)}</g>
      ${roof.front}</svg>`;
  }
  // Cấp 3 — biệt thự: rộng, mái chóp, sảnh cột trắng, ban công, viền vàng, cây xanh.
  function villaSVG(c) {
    const W = 12; const D = 9; const H = 8; const R = 3.6; const o = 0.6; const h = 3;
    const edge = shade(c, -0.55); const st = `stroke="${edge}" stroke-width=".3" stroke-linejoin="round"`;
    const left = mix(c, '#fffdf8', 0.85); const right = mix(c, '#cfc6b8', 0.8);
    const gold = '#e9b730';
    const arch = (x, y, w, hh, glass = '#bfe4ff') => `<path d="M${x} ${y + hh}V${y + w / 2}a${w / 2} ${w / 2} 0 0 1 ${w} 0V${y + hh}Z" fill="#fffaf0"/>`
      + `<path d="M${x + 0.3} ${y + hh - 0.2}V${y + w / 2}a${w / 2 - 0.3} ${w / 2 - 0.3} 0 0 1 ${w - 0.6} 0V${y + hh - 0.2}Z" fill="${glass}"/>`
      + `<rect x="${x - 0.35}" y="${y + 0.6}" width=".35" height="${hh - 0.6}" fill="${c}"/><rect x="${x + w}" y="${y + 0.6}" width=".35" height="${hh - 0.6}" fill="${c}"/>`;
    const px0 = 3.6; const px1 = 8.4; const pd = 2.2;   // sảnh cột
    return `<svg class="bld-3" viewBox="-11 -8.8 23.3 21.5">${shadowBase(W, D + 1.5)}
      ${isoPoly([[-o, -o, H], [W + o, -o, H], [W - h, D / 2, H + R], [h, D / 2, H + R]], shade(c, -0.3), st)}
      <g transform="${wallR(W)}"><rect x="0" y="${-H}" width="${D}" height="${H}" fill="${right}" ${st}/>
        <rect x="0" y="${-H}" width="${D}" height="${H}" fill="url(#bk-wall)"/>
        <rect x="0" y="-.8" width="${D}" height=".8" fill="#a7a29a"/><path d="M0 -4.3H${D}" stroke="${gold}" stroke-width=".35"/>
        ${arch(1.5, -3.8, 2, 2.9, '#a9cde6')}${arch(5.5, -3.8, 2, 2.9, '#a9cde6')}${arch(1.5, -7.6, 2, 2.9, '#a9cde6')}${arch(5.5, -7.6, 2, 2.9, '#a9cde6')}</g>
      <g transform="${wallL(D)}"><rect x="0" y="${-H}" width="${W}" height="${H}" fill="${left}" ${st}/>
        <rect x="0" y="${-H}" width="${W}" height="${H}" fill="url(#bk-wall)"/>
        <rect x="0" y="-.8" width="${W}" height=".8" fill="#b3aea6"/><path d="M0 -4.3H${W}" stroke="${gold}" stroke-width=".35"/>
        ${arch(0.9, -3.8, 1.9, 2.9)}${arch(9.2, -3.8, 1.9, 2.9)}${arch(0.9, -7.6, 1.9, 2.9)}${arch(9.2, -7.6, 1.9, 2.9)}
        <rect x="5" y="-3.6" width="2" height="3.6" rx=".9" fill="#6b3f22"/><path d="M6 -3.6V0" stroke="${gold}" stroke-width=".15"/>
        ${arch(4.8, -7.6, 2.4, 2.9)}</g>
      ${isoPoly([[px0 - 0.3, D, 0.4], [px1 + 0.3, D, 0.4], [px1 + 0.3, D + pd + 0.5, 0.4], [px0 - 0.3, D + pd + 0.5, 0.4]], '#e7e2d8', st)}
      <g transform="${wallL(D + pd + 0.5)}"><rect x="${px0 - 0.3}" y="-.4" width="${px1 - px0 + 0.6}" height=".4" fill="#c9c3b8"/></g>
      <g transform="${wallL(D + pd - 0.3)}">${[0, 1, 2, 3].map((k) => { const x = px0 + k * ((px1 - px0 - 0.5) / 3);
        return `<rect x="${x}" y="-4.4" width=".5" height="4" fill="#ffffff" stroke="#b9b2a6" stroke-width=".12"/><rect x="${x - 0.12}" y="-4.6" width=".74" height=".3" fill="#eee8dd"/>`; }).join('')}</g>
      ${isoPoly([[px0 - 0.3, D, 4.4], [px1 + 0.3, D, 4.4], [px1 + 0.3, D + pd, 4.4], [px0 - 0.3, D + pd, 4.4]], '#f4f0e8', st)}
      <g transform="${wallL(D + pd)}"><rect x="${px0 - 0.3}" y="-4.9" width="${px1 - px0 + 0.6}" height=".5" fill="${c}" ${st}/>
        <path d="M${px0} -5.9H${px1}" stroke="#fff" stroke-width=".3"/>${[0, 1, 2, 3, 4, 5, 6].map((k) => `<path d="M${px0 + k * 0.8} -4.9V-5.9" stroke="#fff" stroke-width=".2"/>`).join('')}</g>
      <g transform="${wallR(px1 + 0.3)}"><rect x="${D}" y="-4.9" width="${pd}" height=".5" fill="${shade(c, -0.25)}" ${st}/></g>
      ${isoPoly([[-o, D + o, H], [W + o, D + o, H], [W - h, D / 2, H + R], [h, D / 2, H + R]], c, st)}
      ${isoPoly([[W + o, D + o, H], [W + o, -o, H], [W - h, D / 2, H + R]], shade(c, -0.2), st)}
      <path d="M${ISO(-o, D + o, H)}L${ISO(W + o, D + o, H)}L${ISO(W + o, -o, H)}" fill="none" stroke="${gold}" stroke-width=".35"/>
      <path d="M${ISO(h, D / 2, H + R)}L${ISO(W - h, D / 2, H + R)}" stroke="${gold}" stroke-width=".45" stroke-linecap="round"/>
      ${bush(0.2, D + 1.2, 1.1)}${bush(W + 0.6, D + 0.6, 1.2)}</svg>`;
  }

  // Khách sạn: toà tháp isometric nhiều tầng, biển HOTEL vàng trên nóc.
  function hotelSVG(c) {
    const W = 9; const D = 9; const H = 24;
    const left = c; const right = shade(c, -0.3); const top = mix(c, '#ffffff', 0.35); const edge = shade(c, -0.6);
    const st = `stroke="${edge}" stroke-width=".3" stroke-linejoin="round"`;
    const grid = (w) => {
      let out = '';
      for (let r = 0; r < 6; r++) {
        for (let k = 0; k < 3; k++) {
          const lit = (r * 3 + k * 5 + w) % 4 === 0;
          out += win(0.9 + k * 2.6, -H + 2 + r * 3.2, 1.9, 2.2, lit ? '#ffe58a' : '#9fd0f0');
        }
      }
      return out;
    };
    return `<svg class="hotel" viewBox="-9.6 -25 19.2 35.5">
      ${isoPoly([[-0.6, -0.6, 0], [W + 1.2, -0.6, 0], [W + 1.2, D + 1.2, 0], [-0.6, D + 1.2, 0]], 'rgba(0,0,0,.3)')}
      <g transform="${wallR(W)}">
        <rect x="0" y="${-H}" width="${D}" height="${H}" fill="${right}" ${st}/>
        <rect x="0" y="${-H}" width="${D}" height="${H}" fill="url(#bk-wall)"/>${grid(1)}
        <rect x="0" y="-2.2" width="${D}" height="2.2" fill="${shade(c, -0.45)}"/>
      </g>
      <g transform="${wallL(D)}">
        <rect x="0" y="${-H}" width="${W}" height="${H}" fill="${left}" ${st}/>
        <rect x="0" y="${-H}" width="${W}" height="${H}" fill="url(#bk-wall)"/>${grid(0)}
        <rect x="0" y="-2.2" width="${W}" height="2.2" fill="${shade(c, -0.35)}"/>
        <rect x="3" y="-2.2" width="3" height="2.2" fill="#2d3a4a"/><path d="M3 -1.1h3M4.5 -2.2v2.2" stroke="#8fb3d4" stroke-width=".2"/>
        <rect x="2.4" y="-2.8" width="4.2" height=".7" rx=".2" fill="#f5c542"/>
      </g>
      ${isoPoly([[0, 0, H], [W, 0, H], [W, D, H], [0, D, H]], top, st)}
      ${isoPoly([[0.7, 0.7, H], [W - 0.7, 0.7, H], [W - 0.7, D - 0.7, H], [0.7, D - 0.7, H]], shade(c, -0.1))}
      <g transform="${wallL(D - 1.4)}">
        <path d="M2.2 ${-H}v-1.2M6.8 ${-H}v-1.2" stroke="#7a5a10" stroke-width=".35"/>
        <rect x="1" y="${-H - 4.4}" width="7" height="3.4" rx=".5" fill="#f5c542" stroke="#a87708" stroke-width=".3"/>
        <text x="4.5" y="${-H - 2.05}" font-size="1.75" font-weight="900" text-anchor="middle" fill="#6b4a00" font-family="Arial, sans-serif">HOTEL</text>
      </g>
    </svg>`;
  }

  // Mỗi cấp một công trình, từ đơn sơ tới hoành tráng.
  function buildingsHTML(level, color) {
    return [null, cottageSVG, houseSVG, villaSVG, hotelSVG][level](color);
  }

  function pickable(i) {
    if (!S || !S.myTurn) return false;
    const pr = propOf(i);
    if (S.stage === 'champ') return !!(pr && pr.owner === S.me.id && sq(i).type === 'city');
    if (S.stage === 'tour') return ['city', 'resort'].includes(sq(i).type) && (!pr || pr.owner === S.me.id);
    if (S.stage === 'debt') return !!(pr && pr.owner === S.me.id);
    return false;
  }

  function renderBoard() {
    const board = $('#board');
    board.classList.toggle('hl-mode', !!ui.hl);
    board.classList.toggle('pick-mode', !!(S.myTurn && ['champ', 'tour', 'debt'].includes(S.stage)));
    const here = S.phase === 'play' && player(S.turn) ? ui.disp[S.turn] : null;
    document.querySelectorAll('.cell').forEach((el) => {
      const i = Number(el.dataset.sq);
      const s = sq(i);
      const pr = propOf(i);
      const owner = pr && player(pr.owner);
      el.classList.toggle('owned', !!owner);
      el.classList.toggle('mono', !!(owner && s.type === 'city' && ownsGroup(owner.id, s.group)));
      el.style.setProperty('--oc', owner ? owner.color : 'transparent');
      const bld = el.querySelector('.bld');
      const built = !!(owner && s.type === 'city' && pr.level > 0);
      if (bld) setHTML(bld, built ? buildingsHTML(pr.level, owner.color) : '');
      el.classList.toggle('built', built);
      const cp = el.querySelector('.cp');
      if (cp) {
        setHTML(cp, owner ? `${money(pr.rent)}` : '');
        cp.classList.toggle('rent', !!owner);
      }
      setHTML(el.querySelector('.champ'), pr && pr.champ ? `🏆×${pr.champ + 1}` : '');
      el.classList.toggle('here', here === i);
      el.classList.toggle('pick', pickable(i));
      el.classList.toggle('pending', S.pending === i && ['buy', 'upgrade', 'buyout'].includes(S.stage));
      el.classList.toggle('hl', !!(ui.hl && pr && pr.owner === ui.hl));
      el.title = `${s.name}${s.price ? ` · giá đất ${money(s.price)}` : ''}${owner ? ` · chủ: ${owner.id === S.me.id ? 'Bạn' : owner.name} · tiền thuê ${money(pr.rent)}` : ''}`;
    });
  }
  // Rê chuột vào một người chơi → làm nổi bật thành phố của người đó.
  document.addEventListener('mouseover', (e) => {
    const p = e.target.closest('#cast .cast-p, .pcard');
    const pid = p ? p.dataset.pid : null;
    if (pid !== ui.hl && S && B) { ui.hl = pid; renderBoard(); }
  });

  function renderTokens() {
    const box = $('#tokens');
    const board = $('#board');
    if (!S || S.phase === 'lobby') { box.innerHTML = ''; return; }
    const list = S.players.filter((p) => p.playing && !p.bankrupt);
    list.forEach((p) => { if (!ui.anims[p.id]) ui.disp[p.id] = p.pos; });
    const bySq = {};
    list.forEach((p) => { (bySq[ui.disp[p.id]] = bySq[ui.disp[p.id]] || []).push(p.id); });
    const keep = new Set();
    const tokW = Math.max(20, board.clientWidth * 0.048);
    const tokH = tokW * 1.66;
    list.forEach((p) => {
      keep.add(p.id);
      let el = box.querySelector(`[data-pid="${CSS.escape(p.id)}"]`);
      if (!el) {
        el = document.createElement('div');
        el.className = 'tok';
        el.dataset.pid = p.id;
        box.appendChild(el);
      }
      // Nhân vật đầy đủ (đứng) của người chơi làm quân cờ.
      setHTML(el, `<div class="tok-base"></div><div class="fig">${window.Avatar.svg(p.look, { seed: p.id })}</div>`);
      el.style.setProperty('--c', p.color || '#fff');
      el.classList.toggle('turn', S.turn === p.id && S.phase === 'play');
      el.classList.toggle('jailed', p.island !== null);
      el.classList.toggle('fly', !!ui.flying[p.id]);
      el.classList.toggle('walk', !!ui.anims[p.id] && ui.anims[p.id] !== -1 && !ui.flying[p.id]);
      const i = ui.disp[p.id];
      const cell = board.querySelector(`.cell[data-sq="${i}"]`);
      if (!cell) return;
      // (x, y) là chỗ đặt chân: nhân vật đứng ngay trong ô đất; nhiều quân cùng ô thì xếp hàng ngang.
      const grp = bySq[i];
      const k = grp.indexOf(p.id);
      const n = grp.length;
      const spread = (k - (n - 1) / 2) * Math.min(tokW * 0.75, (cell.offsetWidth * 0.8) / n);
      const x = cell.offsetLeft + cell.offsetWidth / 2 + spread;
      const y = cell.offsetTop + cell.offsetHeight / 2 + tokH * 0.48 + (n > 1 && k % 2 ? tokH * 0.06 : 0);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.zIndex = el.classList.contains('turn') ? 999 : Math.round(y);
    });
    box.querySelectorAll('.tok').forEach((el) => { if (!keep.has(el.dataset.pid)) el.remove(); });
  }
  window.addEventListener('resize', () => { if (S && B) renderTokens(); });

  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const faceHTML = (v) => `<div class="face f${v}">${Array.from({ length: 9 }, (_, k) => `<i class="${PIPS[v].includes(k) ? 'on' : ''}"></i>`).join('')}</div>`;
  // Xúc xắc 3D: kết quả là MẶT NẰM TRÊN — góc quay khối để mặt v hướng lên trời.
  const FACE_ROT = { 1: [90, 0], 2: [-90, 90], 3: [0, 0], 4: [180, 0], 5: [90, 90], 6: [-90, 0] };
  // Pháp tuyến của từng mặt (thứ tự 1..6) trong hệ toạ độ CSS (y hướng xuống, z hướng về người xem).
  const FACE_N = [[0, 0, 1], [1, 0, 0], [0, -1, 0], [0, 1, 0], [-1, 0, 0], [0, 0, -1]];
  const LIGHT = (() => { const l = [-0.2, -0.9, 0.4]; const m = Math.hypot(...l); return l.map((v) => v / m); })();
  const TILT = [[-58, -22], [-58, 18]];  // nhìn từ trên xuống: mặt trên (kết quả) to và sáng nhất
  const DICE_MS = 1150;
  const dice = { el: null, cubes: [], tosses: [], shadows: [], faces: [], rot: [[0, 0], [0, 0]], vals: [0, 0], animUntil: 0, raf: 0 };
  const rad = (d) => (d * Math.PI) / 180;
  const rotX = ([x, y, z], a) => { const c = Math.cos(rad(a)); const s = Math.sin(rad(a)); return [x, y * c - z * s, y * s + z * c]; };
  const rotY = ([x, y, z], a) => { const c = Math.cos(rad(a)); const s = Math.sin(rad(a)); return [x * c + z * s, y, -x * s + z * c]; };
  // Đổ bóng từng mặt theo hướng ánh sáng → khối trông có chiều sâu thật khi lăn.
  function lightDie(k, ax, ay) {
    const [tx, ty] = TILT[k];
    dice.faces[k].forEach((el, idx) => {
      const n = rotX(rotY(rotX(rotY(FACE_N[idx], ay), ax), ty), tx);
      const d = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
      el.style.setProperty('--shade', (0.55 * (1 - Math.max(0, d)) ** 1.3).toFixed(3));
    });
  }
  function poseDie(k, ax, ay) {
    dice.cubes[k].style.transform = `rotateX(${ax}deg) rotateY(${ay}deg)`;
    lightDie(k, ax, ay);
  }
  function diceEl() {
    if (dice.el) return dice.el;
    const el = document.createElement('div');
    el.className = 'dice3';
    el.innerHTML = '<div class="d3row">' + TILT.map(([tx, ty]) => `<div class="d3"><div class="d3-shadow"></div><div class="d3-toss">
        <div class="d3-tilt" style="transform:rotateX(${tx}deg) rotateY(${ty}deg)"><div class="cube">
          <div class="core cz"></div><div class="core cx"></div><div class="core cy"></div>
          ${[1, 2, 3, 4, 5, 6].map(faceHTML).join('')}</div></div></div></div>`).join('') + '</div><div class="dice-sum"></div>';
    dice.el = el;
    dice.cubes = [...el.querySelectorAll('.cube')];
    dice.tosses = [...el.querySelectorAll('.d3-toss')];
    dice.shadows = [...el.querySelectorAll('.d3-shadow')];
    dice.faces = dice.cubes.map((c) => [1, 2, 3, 4, 5, 6].map((v) => c.querySelector(`.f${v}`)));
    dice.sum = el.querySelector('.dice-sum');
    setDice([5, 6]);
    return el;
  }
  function setDice(vals) {
    if (vals[0] === dice.vals[0] && vals[1] === dice.vals[1]) return;
    vals.forEach((v, k) => { dice.rot[k] = FACE_ROT[v].slice(); poseDie(k, ...dice.rot[k]); });
    dice.vals = vals.slice();
    markTop(vals);
  }
  // Viền sáng mặt trên của từng viên — đó là mặt tính điểm.
  function markTop(vals) {
    dice.faces.forEach((fs, k) => fs.forEach((el, idx) => el.classList.toggle('top', !!vals && vals[k] === idx + 1)));
  }
  // Kết quả ghi rõ bên dưới xúc xắc: "3 + 4 = 7".
  function showSum(vals) {
    if (dice.sum) dice.sum.innerHTML = vals[0] ? `<span class="lbl">Mặt trên:</span> <b>${vals[0]}</b> + <b>${vals[1]}</b> = <b class="tot">${vals[0] + vals[1]}</b>${vals[0] === vals[1] ? ' <span class="dbl">ĐÔI!</span>' : ''}` : '';
  }
  // Độ cao nảy (theo % cạnh xúc xắc): rơi xuống, nảy lên 2 lần rồi nằm yên.
  function tossHeight(t) {
    if (t < 0.4) return 190 * (1 - (t / 0.4) ** 2);
    if (t < 0.72) { const u = (t - 0.4) / 0.32; return 140 * u * (1 - u); }
    if (t < 0.9) { const u = (t - 0.72) / 0.18; return 40 * u * (1 - u); }
    return 0;
  }
  // Tung xúc xắc: rơi từ trên xuống, lăn vài vòng, nảy rồi dừng đúng mặt kết quả.
  function rollDice(vals) {
    diceEl();
    cancelAnimationFrame(dice.raf);
    dice.el.classList.remove('double', 'settle');
    dice.el.classList.add('rolling');
    markTop(null);
    dice.animUntil = Date.now() + DICE_MS;
    const ahead = (cur, base, spins) => { const t = cur + spins * 360; return t + ((((base - t) % 360) + 360) % 360); };
    const plan = vals.map((v, k) => {
      const [cx, cy] = dice.rot[k];
      const to = [ahead(cx, FACE_ROT[v][0], 2 + k), ahead(cy, FACE_ROT[v][1], 2 - k)];
      dice.rot[k] = to;
      return { from: [cx, cy], to, dir: k ? 1 : -1 };
    });
    dice.vals = vals.slice();
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / DICE_MS);
      const e = 1 - (1 - t) ** 3;
      plan.forEach((pl, k) => {
        poseDie(k, pl.from[0] + (pl.to[0] - pl.from[0]) * e, pl.from[1] + (pl.to[1] - pl.from[1]) * e);
        const h = tossHeight(t);
        const x = pl.dir * 80 * (1 - Math.min(1, t / 0.55)) ** 2;
        dice.tosses[k].style.transform = `translate(${x}%, ${-h}%)`;
        dice.shadows[k].style.transform = `translateX(${x}%) scale(${1 - Math.min(0.65, h / 280)})`;
        dice.shadows[k].style.opacity = String(1 - Math.min(0.75, h / 250));
      });
      if (t < 1) { dice.raf = requestAnimationFrame(frame); return; }
      dice.el.classList.remove('rolling');
      markTop(vals);
      dice.el.classList.add('settle');
      showSum(vals);
      dice.el.classList.toggle('double', vals[0] === vals[1]);
      setTimeout(() => dice.el.classList.remove('settle'), 400);
    };
    dice.raf = requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- banner: trạng thái + lựa chọn
  function offerHTML() {
    const o = S.offer;
    if (!o) return '';
    const s = sq(o.square);
    // Mỗi lựa chọn là một thẻ cùng kích thước: biểu tượng · tên · giá · tiền thuê; "Bỏ qua" nằm riêng bên dưới.
    const card = (act, level, icon, name, cost, rent) => `<button class="gh-btn opt" data-act="${act}" data-level="${level}"
        ${me().money < cost ? 'disabled' : ''}><span class="oi">${icon}</span><b class="on">${name}</b>
        <span class="oc">${money(cost)}</span>${rent !== null ? `<span class="or">thuê ${money(rent)}</span>` : ''}</button>`;
    let cards;
    if (S.stage === 'buyout') cards = [card('buyout', 0, '🤝', 'Mua lại', o.price, null)];
    else if (s.type === 'resort') cards = [card('buy', 0, s.icon || '🏖️', 'Mua bãi biển', o.levels[0].cost, null)];
    else cards = o.levels.map((l) => card('buy', l.level, LEVEL_ICON[l.level], LEVEL_NAMES[l.level], l.cost, l.rent));
    return `<div class="opts" style="--n:${cards.length}">${cards.join('')}</div><div class="opts-foot">${btn('skip', 'Bỏ qua', 'ghost small')}</div>`;
  }

  function renderBanner() {
    const el = $('#banner');
    let big = '🌍';
    let title = '';
    let sub = '';
    let acts = '';
    let cls = 'gbanner';
    if (S.phase === 'lobby') {
      big = '🌍'; title = 'Phòng chờ — vòng quanh thế giới';
      sub = `${S.players.length}/${S.maxPlayers} người · ${S.me.host ? 'bạn là chủ phòng — chỉnh luật rồi bấm Bắt đầu bên dưới' : 'đang chờ chủ phòng bắt đầu…'}`;
    } else if (S.phase === 'end') {
      big = '🏆'; cls += ' win'; title = `${who(S.winner)} là tỷ phú!`;
      sub = `${esc(S.winReason || '')} · ván ${S.gameNo} kết thúc — xem bảng xếp hạng bên dưới.`;
    } else {
      const cp = player(S.turn);
      const mine = S.myTurn;
      const dot = cp ? `<span class="dotc" style="--pc:${cp.color}"></span>` : '';
      const name = mine ? 'Bạn' : esc(nm(S.turn));
      const pend = S.pending !== null && S.pending !== undefined ? sq(S.pending) : null;
      switch (S.stage) {
        case 'roll':
          big = '🎲'; title = mine ? `${dot}Đến lượt bạn!` : `${dot}${name} chuẩn bị đổ xúc xắc…`;
          if (mine) { cls += ' mine'; sub = 'Đổ 2 xúc xắc — ra đôi được đổ tiếp.'; acts = btn('roll', '🎲 Đổ xúc xắc', 'gold pulse'); }
          break;
        case 'island':
          big = '🏝️'; title = `${dot}${name} đang kẹt ở Đảo hoang (lượt ${(cp.island || 0) + 1}/3)`;
          if (mine) {
            cls += ' mine'; sub = 'Đổ ra đôi để thoát, hoặc nộp tiền / dùng vé rồi đổ bình thường.';
            acts = btn('roll', '🎲 Đổ tìm đôi', 'gold') + btn('pay_island', `💵 Nộp ${money(S.fees.island)}`, '', cp.money < S.fees.island ? 'disabled' : '')
              + (cp.cards && cp.cards.escape ? btn('use_escape', `🎫 Vé thoát đảo (${cp.cards.escape})`, 'primary') : '');
          }
          break;
        case 'tour':
          big = '✈️'; title = mine ? `${dot}World Tour — bạn muốn bay tới đâu?` : `${dot}${name} đang chọn điểm đến World Tour…`;
          if (mine) { cls += ' mine'; sub = `Bấm vào một thành phố chưa có chủ hoặc của bạn (đang sáng) để bay tới — vé ${money(S.fees.tour)}; hoặc đổ xúc xắc như thường.`; acts = btn('roll', '🎲 Đổ bình thường', 'ghost'); }
          break;
        case 'rolling': big = '🎲'; title = `${dot}${name} đang đổ xúc xắc…`; break;
        case 'moving': big = '🚶'; title = `${dot}${name} đang di chuyển…`; break;
        case 'buy':
          big = pend.type === 'resort' ? '🏖️' : '🏙️';
          title = mine ? `${dot}Mua ${esc(pend.name)}?` : `${dot}${name} đang cân nhắc mua ${esc(pend.name)}…`;
          if (mine) { cls += ' mine'; sub = pend.type === 'resort' ? 'Khu nghỉ dưỡng: có càng nhiều khu, tiền thuê càng cao. Có đủ 4 khu là thắng!' : `Chọn cấp muốn xây ngay (vòng này xây tối đa ${LEVEL_NAMES[me().maxLevel].toLowerCase()}). Bạn có ${money(me().money)}.`; acts = offerHTML(); }
          break;
        case 'upgrade':
          big = '🏗️'; title = mine ? `${dot}Xây thêm ở ${esc(pend.name)}?` : `${dot}${name} đang xây thêm ở ${esc(pend.name)}…`;
          if (mine) { cls += ' mine'; sub = `Bạn có ${money(me().money)}.`; acts = offerHTML(); }
          break;
        case 'buyout':
          big = '🤝'; title = mine ? `${dot}Mua lại ${esc(pend.name)} của ${who(S.offer.owner)}?` : `${dot}${name} đang tính mua lại ${esc(pend.name)}…`;
          if (mine) { cls += ' mine'; sub = 'Giá gấp đôi giá trị thành phố — chủ cũ nhận toàn bộ số tiền. Mua xong được xây thêm.'; acts = offerHTML(); }
          break;
        case 'champ':
          big = '🏆'; title = mine ? `${dot}Chọn thành phố tổ chức World Championship` : `${dot}${name} đang chọn nơi tổ chức World Championship…`;
          if (mine) { cls += ' mine'; sub = 'Bấm vào một thành phố của bạn (đang sáng) — tiền thuê ở đó sẽ tăng thêm một bậc.'; acts = btn('skip', 'Bỏ qua', 'ghost'); }
          break;
        case 'card':
          big = '🎴'; title = `${dot}${name} rút thẻ Cơ hội`; sub = S.card ? esc(S.card.text) : '';
          break;
        case 'debt':
          big = '⚠️'; title = mine ? `${dot}Bạn đang nợ ${money(S.debt.amount)}` : `${dot}${name} đang xoay tiền trả nợ ${money(S.debt.amount)}…`;
          if (mine) {
            cls += ' mine'; sub = `${esc(S.debt.reason)} · tiền mặt ${money(me().money)} — bấm vào thành phố của bạn để bán cho ngân hàng (nửa giá trị).`;
            acts = (S.me.raisable >= S.debt.amount ? btn('auto_pay', '⚡ Tự bán cho đủ', 'gold') : '') + btn('bankrupt', '💥 Phá sản', 'danger');
          }
          break;
        default: title = '…';
      }
      if (!S.me.playing) { sub = `👀 Bạn đang xem ván này — ván sau sẽ được vào chơi.${sub ? ` · ${sub}` : ''}`; acts = ''; }
    }
    el.className = cls;
    setHTML(el, `<div class="big">${big}</div><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${acts ? `<div class="gacts">${acts}</div>` : '<div></div>'}`);
  }

  function renderCast() {
    if (!cast) cast = new window.Cast($('#cast'), { onClick: (pid, el) => openMenu(pid, el) });
    const list = S.phase === 'lobby' ? S.players : S.players.filter((p) => p.playing);
    cast.update(list.map((p) => ({
      id: p.id, name: p.name, look: p.look, bot: p.bot, me: p.id === S.me.id, color: p.color,
      turn: S.phase === 'play' && S.turn === p.id,
      dim: p.bankrupt || !p.connected,
      sub: p.playing ? (p.bankrupt ? '💥 phá sản' : `💰 ${money(p.money)}`) : (p.host ? '👑 chủ phòng' : ''),
      badge: S.phase === 'end' && S.winner === p.id ? '🏆' : p.island !== null && p.playing ? '🏝️' : p.tour ? '✈️' : '',
    })));
  }

  // Giữa bàn cờ: xúc xắc, thẻ vừa rút / thông tin thành phố đang được mua, vài dòng diễn biến.
  function renderCenter() {
    const el = $('#center-main');
    const d3 = diceEl();
    if (d3.parentNode !== el) {
      el.innerHTML = '';
      el.appendChild(d3);
      el.insertAdjacentHTML('beforeend', '<div class="center-info"></div>');
    }
    const info = el.querySelector('.center-info');
    const idle = Date.now() >= dice.animUntil;
    let html = '';
    if (S.phase !== 'play') {
      const won = S.phase === 'end' && S.winner;
      d3.hidden = !!won;
      if (idle) { setDice([5, 6]); d3.classList.remove('double'); showSum([0, 0]); }
      html = won
        ? `<div class="trophy">🏆</div><div class="status">${who(S.winner)} thắng!<small>${esc(S.winReason || '')}</small></div>`
        : '<div class="status"><small>Đi vòng quanh thế giới, mua thành phố và giành độc quyền!</small></div>';
      setHTML(info, html);
      return;
    }
    d3.hidden = false;
    if (idle) {
      if (S.dice) { setDice(S.dice); d3.classList.toggle('double', S.dice[0] === S.dice[1]); }
      showSum(S.dice || [0, 0]);
    }
    if (S.stage === 'card' && S.card) {
      html += `<div class="tcard"><div class="th">🎴 CƠ HỘI</div><div class="tt">${esc(S.card.text)}</div></div>`;
    } else if (['buy', 'upgrade', 'buyout'].includes(S.stage) && S.pending !== null) {
      const q = sq(S.pending);
      const g = group(q);
      const pr = propOf(S.pending);
      html += `<div class="deed"><div class="dh" style="background:${g ? groupBg(g) : 'linear-gradient(135deg,#40c9ff,#2bb673)'}"><span>${q.icon} ${esc(q.name)}</span></div>
        <div class="dp">${S.stage === 'buyout' ? money(S.offer.price) : money(q.price)}</div>
        <div class="dr">${g ? `${esc(g.name)} · ` : 'Khu nghỉ dưỡng · '}${pr ? `chủ: ${who(pr.owner)} · ${LEVEL_NAMES[pr.level]}` : 'chưa có chủ'}</div></div>`;
    }
    html += `<div class="recent">${S.log.slice(-3).map((l) => `<div>${esc(l.text)}</div>`).join('')}</div>`;
    setHTML(info, html);
  }

  // ---------------------------------------------------------------- người chơi & thông tin ô
  function chipHTML(i) {
    const s = sq(i);
    const pr = propOf(i);
    const g = group(s);
    const lv = s.type === 'city' && pr ? (pr.level ? ` ${LEVEL_ICON[pr.level]}` : '') : '';
    return `<span class="pchip" style="--gbg:${g ? groupBg(g) : 'linear-gradient(135deg,#40c9ff,#2bb673)'}" data-sq="${i}"><i></i>${esc(s.name)}${lv}${pr && pr.champ ? ` 🏆×${pr.champ + 1}` : ''}</span>`;
  }

  function renderPlayers() {
    const list = S.phase === 'lobby' ? S.players : S.players.filter((p) => p.playing).concat(S.players.filter((p) => !p.playing));
    const html = list.map((p) => {
      const owned = Object.keys(S.props).map(Number).filter((i) => S.props[i].owner === p.id).sort((a, b) => a - b);
      const cards = p.cards ? `${p.cards.escape ? ` 🎫×${p.cards.escape}` : ''}${p.cards.angel ? ` 😇×${p.cards.angel}` : ''}${p.cards.half ? ` 🏷️×${p.cards.half}` : ''}` : '';
      const tags = [p.bot ? '🤖' : '', p.host ? '👑' : '', p.wins ? `🏆${p.wins}` : '', p.connected ? '' : '📴'].filter(Boolean).join(' ');
      const where = p.playing ? (p.bankrupt ? '💥 Phá sản' : `${p.island !== null ? '🏝️ ' : '📍 '}${esc(sq(p.pos).name)} · vòng ${p.laps + 1}${cards}`) : (S.phase === 'lobby' ? 'Sẵn sàng' : '👀 Đang xem');
      return `<div class="pcard ${S.turn === p.id && S.phase === 'play' ? 'turn' : ''} ${p.bankrupt ? 'out' : ''}" style="--c:${p.color || 'transparent'}" data-pid="${esc(p.id)}">
        <div class="ph"><div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>
          <div class="pn"><b>${p.id === S.me.id ? 'Bạn' : esc(p.name)} ${tags}</b><span>${where}</span></div>
          ${p.playing ? `<div class="pm">${money(p.money)}<small>tài sản ${money(p.worth)}</small></div>` : ''}</div>
        ${owned.length ? `<div class="chips">${owned.map(chipHTML).join('')}</div>` : ''}</div>`;
    }).join('');
    setHTML($('#plist'), html);
  }

  function infoHTML(i) {
    const s = sq(i);
    const pr = propOf(i);
    const owner = pr && player(pr.owner);
    const g = group(s);
    let body = `<div class="sband" style="background:${g ? groupBg(g) : s.type === 'resort' ? 'linear-gradient(135deg,#40c9ff,#2bb673)' : 'linear-gradient(135deg,#ffd46b,#ff9a62)'}">
      <span>${s.icon || ''} ${esc(s.name)}</span></div>`;
    if (!['city', 'resort'].includes(s.type)) return body + `<p class="meta">${SPECIAL_INFO[s.type] || ''}</p>`;
    if (s.type === 'city') {
      const mono = owner && ownsGroup(owner.id, s.group);
      body += `<table>${LEVEL_NAMES.map((n, lv) => `<tr class="${pr && pr.level === lv ? 'cur' : ''}"><td>${LEVEL_ICON[lv]} ${n}</td>
        <td>${money(Math.floor(s.price * RENT_MULT[lv]))}</td></tr>`).join('')}</table>
        <p class="meta">Giá đất <b>${money(s.price)}</b> · mỗi cấp nhà <b>${money(Math.floor(s.price / 2))}</b> · khách sạn <b>${money(s.price)}</b> (chỉ nâng từ nhà cấp 3, từ vòng 2)<br>
        Sở hữu cả ${esc(g.name)} → tiền thuê ×2${pr && pr.champ ? ` · World Championship ×${pr.champ + 1}` : ''}${mono ? ' <b>(đang độc quyền)</b>' : ''}</p>`;
    } else {
      body += `<table>${[1, 2, 3, 4].map((n) => `<tr><td>Chủ có ${n} khu nghỉ dưỡng</td><td>${n === 4 ? 'Thắng luôn! 🏆' : money(RESORT_RENT[n])}</td></tr>`).join('')}</table>
        <p class="meta">Giá <b>${money(s.price)}</b> · không xây được nhà.</p>`;
    }
    body += `<p class="meta">Chủ: <b>${owner ? (owner.id === S.me.id ? 'Bạn' : esc(owner.name)) : 'Chưa có'}</b>${pr ? ` · tiền thuê hiện tại <b>${money(pr.rent)}</b>` : ''}
      ${pr ? `<br>Giá mua lại: <b>${pr.buyout ? money(pr.buyout) : (s.type === 'resort' ? 'không thể (bãi biển)' : 'không thể (đã có khách sạn)')}</b> · bán cho ngân hàng: ${money(pr.sell)}` : ''}</p>`;
    if (pr && pr.owner === S.me.id && S.myTurn && S.stage === 'debt') body += `<div class="btns">${btn('sell', `🏦 Bán cho ngân hàng (+${money(pr.sell)})`, 'gold', `data-sq="${i}"`)}</div>`;
    return body;
  }

  function openInfo(i) {
    const body = document.createElement('div');
    body.className = 'sq-info';
    const m = P.modal({ title: '', body, actions: [{ label: 'Đóng', kind: 'ghost', onClick: () => { ui.info = null; } }] });
    m.el.addEventListener('click', (e) => { if (e.target === m.el) ui.info = null; });
    ui.info = { i, body, el: m.el };
    body.innerHTML = infoHTML(i);
  }
  function refreshInfo() {
    if (!ui.info) return;
    if (!document.body.contains(ui.info.el)) { ui.info = null; return; }
    setHTML(ui.info.body, infoHTML(ui.info.i));
  }

  // ---------------------------------------------------------------- phòng chờ & kết thúc
  const inviteLink = () => `${ui.lanBase || location.origin}/g/cotyphu/?room=${ROOM}`;
  function botPanel() {
    const n = S.players.length;
    const bots = S.players.filter((p) => p.bot).length;
    const full = n >= S.maxPlayers;
    return `<div class="panel"><h3><span class="grow">🤖 Người chơi ảo (bot)</span><span class="gh-muted" style="font-size:13px">${bots} bot</span></h3>
      <p class="gh-muted" style="margin:0 0 12px;font-size:14px">Không đủ người? Thêm bot — bot biết mua lại đất để gom độc quyền, tổ chức World Championship và bay World Tour.</p>
      <div class="btns-row">${btn('add-bot', '＋ 1 bot', 'small', full ? 'disabled' : '')}
        ${btn('fill-bots', 'Lấp đủ 4 người', 'small primary', full ? 'disabled' : '')}
        ${bots ? btn('remove-bots', '🗑 Xoá hết bot', 'small ghost') : ''}</div></div>`;
  }
  function settingsPanel() {
    const dis = S.me.host ? '' : 'disabled';
    const sel = (key, label, fmt) => `<div class="setting"><label>${label}</label>
      <select data-cfg="${key}" ${dis}>${S.choices[key].map((v) => `<option value="${v}" ${v === S.config[key] ? 'selected' : ''}>${fmt(v)}</option>`).join('')}</select></div>`;
    return `<div class="panel"><h3>⚙️ Luật chơi</h3><div class="settings">
      ${sel('money', '💰 Tiền khởi điểm', money)}
      ${sel('max_rounds', '⏰ Giới hạn số vòng', (v) => (v ? `${v} vòng` : 'Không giới hạn'))}
      ${sel('turn_time', '⏱ Thời gian mỗi lựa chọn', (v) => (v ? `${v} giây` : 'Không giới hạn'))}
      </div><p class="gh-muted" style="margin:10px 0 0;font-size:13px">Thắng sớm bằng độc quyền 3 vùng, độc quyền một cạnh bàn hoặc cả 4 khu nghỉ dưỡng. Hết vòng thì ai có tổng tài sản lớn nhất thắng.</p></div>`;
  }
  function renderPanel() {
    const el = $('#panel');
    if (S.phase === 'play') { setHTML(el, ''); return; }
    const host = S.me.host;
    let html;
    if (S.phase === 'end') {
      const board = S.players.filter((p) => p.playing).sort((a, b) => (a.bankrupt - b.bankrupt) || b.worth - a.worth)
        .map((p, i) => `<div class="res-row ${p.id === S.winner ? 'win' : ''}"><span class="rank">${p.id === S.winner ? '🏆' : i + 1}</span>
          <span class="rname">${esc(p.name)}${p.bot ? ' 🤖' : ''}</span>
          <div class="rcards"><span class="gh-muted">${p.bankrupt ? '💥 phá sản' : `tiền ${money(p.money)}`}</span></div>
          <span class="rpts">${money(p.worth)}<small>${p.wins} ván thắng</small></span></div>`).join('');
      html = `<div class="panel"><div class="result-head"><div class="trophy">🏆</div><div>
          <h2>${esc(nm(S.winner))}${S.winner === S.me.id ? ' (bạn)' : ''} là tỷ phú!</h2><p>${esc(S.winReason || '')}</p></div></div>
        <div class="results">${board}</div>
        <div class="start-row" style="margin-top:14px">${host
          ? `${btn('lobby', '🏠 Về phòng chờ', 'ghost')}${btn('next', '▶ Ván mới', 'primary', S.startError ? 'disabled' : '')}`
          : '<span class="gh-muted">⏳ Đang chờ chủ phòng bắt đầu ván mới…</span>'}</div></div>${host ? botPanel() + settingsPanel() : ''}`;
    } else {
      const start = host
        ? `<div class="start-row"><div>${S.startError ? `<span class="warn">⚠️ ${esc(S.startError)}</span>` : `<span class="gh-muted">${S.players.length}/${S.maxPlayers} người — sẵn sàng!</span>`}</div>
           ${btn('start', '🌍 Bắt đầu', 'primary', S.startError ? 'disabled' : '')}</div>`
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
      + (S && S.me.host && S.phase === 'play' ? btn('stop', '🏁 Kết thúc ván', 'small ghost', 'title="Dừng ván và xếp hạng theo tổng tài sản"') : '')
      + '<span class="hint">Rê chuột vào nhân vật để xem thành phố của họ · nhấn vào để ném cà chua…</span>');
  }
  function openMenu(id, anchor) {
    closeMenu();
    const p = player(id);
    if (!p) return;
    const isMe = id === S.me.id;
    let html = `<div class="pmenu-head">${isMe ? '🙋 Bạn' : esc(p.name)}${p.bot ? ' 🤖' : ''}</div>
      <div class="pmenu-grid">${(isMe ? SELF_FX : OTHER_FX).map(([k, l]) => `<button data-fx="${k}"><span>${FX_EMOJI[k]}</span>${l}</button>`).join('')}</div>`;
    if (isMe) html += btn('edit-look', '👗 Đổi nhân vật', 'small');
    if (!isMe && S.me.host && S.phase !== 'play') html += `<button class="gh-btn small danger" data-kick="${esc(id)}">${p.bot ? '🗑 Xoá bot' : '🚪 Mời ra khỏi phòng'}</button>`;
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
    menuEl.dataset.target = isMe ? '' : id;
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
      : '<div class="empty-note">Diễn biến ván cờ sẽ hiện ở đây.</div>';
    const list = $('#log-list');
    if (setHTML(list, html)) list.scrollTop = list.scrollHeight;
  }

  // ---------------------------------------------------------------- vẽ giao diện
  function render() {
    if (!S || !B) return;
    const pill = S.phase === 'lobby' ? '🏠 Phòng chờ' : S.phase === 'end' ? `🏁 Hết ván ${S.gameNo}`
      : `🌍 Vòng ${S.round}${S.config.max_rounds ? `/${S.config.max_rounds}` : ''}`;
    $('#phase-pill').textContent = pill;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    document.title = `${S.myTurn && DECIDING.includes(S.stage) ? '🔔 ' : ''}Cờ Tỷ Phú ${ROOM}`;
    renderBoard();
    renderBanner();
    renderCast();
    renderCenter();
    renderTokens();
    renderPlayers();
    renderPanel();
    renderEmotes();
    renderChat();
    renderLog();
    refreshInfo();
    tick();
  }

  function tick() {
    const timer = $('#timer');
    const fill = $('#timebar-fill');
    if (!S || !S.deadline || !DECIDING.includes(S.stage)) { timer.hidden = true; fill.style.width = '0'; return; }
    const remaining = Math.max(0, S.deadline - (Date.now() / 1000 + clockOffset));
    const secs = Math.ceil(remaining);
    timer.hidden = false;
    timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    timer.classList.toggle('urgent', secs <= 5 && S.myTurn);
    fill.style.width = `${S.total ? Math.min(1, remaining / S.total) * 100 : 0}%`;
  }
  setInterval(tick, 250);

  // ---------------------------------------------------------------- sự kiện
  document.addEventListener('click', async (e) => {
    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled && actEl.dataset.act) {
      const a = actEl.dataset.act;
      switch (a) {
        case 'roll': case 'pay_island': case 'use_escape': case 'buyout': case 'skip': case 'auto_pay':
          send(a); break;
        case 'buy': send('buy', { level: Number(actEl.dataset.level || 0) }); break;
        case 'sell': send('sell', { square: Number(actEl.dataset.sq) }); break;
        case 'bankrupt':
          P.modal({
            title: 'Tuyên bố phá sản?', body: '<p>Bạn sẽ bị loại khỏi ván, mọi thành phố trở về ngân hàng.</p>',
            actions: [{ label: 'Thôi', kind: 'ghost' }, { label: '💥 Phá sản', kind: 'danger', onClick: () => send('bankrupt') }],
          });
          break;
        case 'stop':
          P.modal({
            title: 'Kết thúc ván?', body: '<p>Ván sẽ dừng ngay và xếp hạng theo tổng tài sản.</p>',
            actions: [{ label: 'Chơi tiếp', kind: 'ghost' }, { label: '🛑 Kết thúc', kind: 'danger', onClick: () => send('stop') }],
          });
          break;
        case 'start': send('start'); break;
        case 'next': send('next_round'); break;
        case 'lobby': send('lobby'); break;
        case 'edit-look': openLookEditor(); break;
        case 'add-bot': send('add_bot', { count: 1 }); break;
        case 'fill-bots': send('add_bot', { count: S.maxPlayers - S.players.length }); break;
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
    const tok = e.target.closest('.tok') || e.target.closest('.pcard .ph');
    if (tok) { openMenu(tok.dataset.pid || tok.closest('.pcard').dataset.pid, tok); return; }
    const cell = e.target.closest('.cell, .pchip');
    if (cell && S && B) {
      closeMenu();
      const i = Number(cell.dataset.sq);
      if (cell.classList.contains('cell') && pickable(i) && S.stage === 'champ') { send('champ', { square: i }); return; }
      if (cell.classList.contains('cell') && pickable(i) && S.stage === 'tour') { send('tour', { square: i }); return; }
      openInfo(i);
      return;
    }
    if (menuEl && !e.target.closest('.pmenu')) closeMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if ((e.key === ' ' || e.key === 'Enter') && S && S.myTurn && ['roll', 'island'].includes(S.stage)) { e.preventDefault(); send('roll'); }
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-cfg]');
    if (el) send('config', { [el.dataset.cfg]: Number(el.value) });
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
    try { localStorage.setItem('typhu_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    if (ui.sound) play('money');
  });
  $('#btn-room').addEventListener('click', async () => { if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good'); });
  $('#btn-leave').addEventListener('click', () => {
    const doLeave = () => { if (conn) conn.leave(); setTimeout(() => { location.href = '/'; }, 150); };
    const m = S && player(S.me.id);
    if (S && S.phase === 'play' && m && m.playing && !m.bankrupt) {
      P.modal({
        title: 'Rời ván cờ?',
        body: '<p>Ván đang diễn ra — khi bạn vắng mặt, máy sẽ tự đổ xúc xắc và bỏ qua các lựa chọn hộ. Vào lại phòng với <b>đúng tên cũ</b> để chơi tiếp.</p>',
        actions: [{ label: 'Ở lại', kind: 'ghost' }, { label: 'Rời phòng', kind: 'danger', onClick: doLeave }],
      });
    } else doLeave();
  });

  fetch('/api/info').then((r) => r.json()).then((inf) => {
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    const lan = location.protocol === 'https:' ? inf.https : inf.urls;
    if (local && lan && lan.length) { ui.lanBase = lan[0]; if (S && B) render(); }
  }).catch(() => {});

  $('#room-code').textContent = ROOM;
  fetch('board.json').then((r) => r.json()).then((b) => {
    B = b;
    buildBoard();
    if (S) render();
  }).catch(() => P.toast('Không tải được bàn cờ — hãy tải lại trang.', 'error', 8000));
  P.ensureName(() => connect());
})();
