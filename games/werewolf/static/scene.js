/* Cảnh đống lửa: nhân vật ngồi quanh lửa, animation theo diễn biến ván đấu,
 * bong bóng chat và hiệu ứng tương tác (ném cà chua, thả tim...). */
(function () {
  const P = window.Platform;
  const A = window.Avatar;
  const esc = P.esc;

  const FX = {
    wave: { emoji: '👋', self: 'waving', ms: 1600 },
    heart: { emoji: '❤️', throw: true, impact: 'hearts' },
    flower: { emoji: '🌹', throw: true, impact: 'flower' },
    tomato: { emoji: '🍅', throw: true, impact: 'splat' },
    highfive: { emoji: '✋', throw: true, impact: 'five', self: 'raise', ms: 900 },
    poke: { emoji: '👉', throw: true, impact: 'poke' },
    laugh: { emoji: '😂', self: 'bounce', ms: 1500 },
    angry: { emoji: '😡', self: 'angry', ms: 1800 },
    cry: { emoji: '😭', self: 'cry', ms: 3200 },
    shock: { emoji: '😱', self: 'shock', ms: 1400 },
    think: { emoji: '🤔', self: 'think', ms: 2200 },
    clap: { emoji: '👏', self: 'clap', ms: 1600 },
    dance: { emoji: '💃', self: 'dance', ms: 3200 },
  };

  const FIRE = `
    <div class="sc-glow"></div>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <ellipse cx="50" cy="88" rx="40" ry="8" fill="rgba(0,0,0,.35)"/>
      <g fill="#6f7680"><ellipse cx="16" cy="86" rx="7" ry="5"/><ellipse cx="84" cy="86" rx="7" ry="5"/>
        <ellipse cx="30" cy="92" rx="7" ry="5" fill="#858c95"/><ellipse cx="70" cy="92" rx="7" ry="5" fill="#858c95"/><ellipse cx="50" cy="94" rx="7" ry="5"/></g>
      <rect x="16" y="79" width="68" height="11" rx="5.5" fill="#5e3a20" transform="rotate(-14 50 84)"/>
      <rect x="16" y="79" width="68" height="11" rx="5.5" fill="#7a4d2b" transform="rotate(14 50 84)"/>
      <g class="sc-flames">
        <path class="fl fl1" d="M50 86 C24 78 26 52 38 36 C40 50 46 50 48 20 C62 38 79 56 70 74 C66 83 58 86 50 86Z" fill="#ff5a1f"/>
        <path class="fl fl2" d="M50 86 C34 80 34 62 42 50 C44 60 50 60 52 40 C62 54 68 66 62 78 C60 83 55 86 50 86Z" fill="#ffa21f"/>
        <path class="fl fl3" d="M50 86 C42 82 42 72 46 64 C48 70 52 70 53 58 C58 68 60 76 57 81 C55 85 52 86 50 86Z" fill="#fff0a0"/>
      </g>
    </svg>
    <div class="sc-sparks">${'<i></i>'.repeat(8)}</div>`;

  function Scene(root, { onClick }) {
    this.root = root;
    this.onClick = onClick;
    root.classList.add('scene');
    root.innerHTML = `
      <div class="sc-trees"></div><div class="sc-ground"></div><div class="sc-dark"></div>
      <svg class="sc-links"></svg>
      <div class="sc-seats"><div class="sc-fire">${FIRE}</div></div>
      <div class="sc-fx"></div>`;
    this.seatsEl = root.querySelector('.sc-seats');
    this.fireEl = root.querySelector('.sc-fire');
    this.fxEl = root.querySelector('.sc-fx');
    this.linksEl = root.querySelector('.sc-links');
    this.seats = new Map();
    this.pos = new Map();
    this.order = [];
    this.prevAlive = null;
    this.lastChatId = null;
    this.linksHTML = '';
    this.S = null;
    this.cw = 60;
    if (window.ResizeObserver) new ResizeObserver(() => this.layout()).observe(root);
    else window.addEventListener('resize', () => this.layout());
  }

  Scene.prototype.makeSeat = function (id) {
    const el = document.createElement('div');
    el.className = 'seat';
    el.innerHTML = `<div class="char" style="--d:${(Math.random() * -3).toFixed(2)}s">
        <div class="ch-ring"></div>
        <div class="ch-fig"></div>
        <div class="ch-splat"></div>
        <div class="ch-hold">🌹</div>
        <div class="ch-halo"></div>
        <div class="ch-zzz"><i>z</i><i>z</i><i>Z</i></div>
        <div class="ch-marks"></div>
        <div class="ch-bubble"></div>
        <div class="ch-tag"></div>
      </div>`;
    el.addEventListener('click', (e) => { e.stopPropagation(); this.onClick(id, el); });
    this.seatsEl.appendChild(el);
    const q = (s) => el.querySelector(s);
    return {
      el, char: q('.char'), fig: q('.ch-fig'), marks: q('.ch-marks'), bubble: q('.ch-bubble'), tag: q('.ch-tag'),
      lookKey: null, tagHTML: null, marksHTML: null, timers: {},
    };
  };

  Scene.prototype.update = function (S, ctx) {
    this.S = S;
    const players = S.players.filter((p) => p.playing);
    const ids = players.map((p) => p.id);
    const mi = ids.indexOf(S.me.id);
    this.order = mi >= 0 ? ids.slice(mi).concat(ids.slice(0, mi)) : ids;

    const inGame = S.phase !== 'lobby';
    const night = S.phase === 'night' || S.phase === 'witch';
    const iWolf = S.me.role === 'werewolf';
    const iAct = !!(S.action && ['wolf_vote', 'seer', 'guard', 'witch'].includes(S.action.kind));
    const mode = ctx.mode;
    const count = (obj) => {
      const out = {};
      if (obj) Object.values(obj).forEach((t) => { if (t && t !== 'skip') out[t] = (out[t] || 0) + 1; });
      return out;
    };
    const votesFor = S.phase === 'vote' || S.phase === 'verdict' ? count(S.votes) : {};
    const wolfFor = count(S.wolfVotes);
    const known = S.known || {};
    const vpeers = (ctx.voice && ctx.voice.peers) || [];
    const vmuted = (ctx.voice && ctx.voice.muted) || [];
    const nmk = S.nightMarks || {};

    for (const [id, s] of this.seats) {
      if (!ids.includes(id)) { s.el.remove(); this.seats.delete(id); }
    }

    this.root.className = `scene ph-${S.phase}`;
    players.forEach((p) => {
      if (!this.seats.has(p.id)) this.seats.set(p.id, this.makeSeat(p.id));
      const s = this.seats.get(p.id);
      const lk = JSON.stringify(p.look || null);
      if (s.lookKey !== lk) { s.fig.innerHTML = A.svg(p.look, { seed: p.id }); s.lookKey = lk; }

      const me = p.id === S.me.id;
      const dead = inGame && !p.alive;
      const team = p.role && S.roleInfo[p.role] ? S.roleInfo[p.role].team : null;
      const wolfeyes = night && !dead && iWolf && p.role === 'werewolf';
      const myVote = (S.votes && (S.phase === 'vote' || S.phase === 'verdict') && S.votes[p.id]) ||
        (S.wolfVotes && S.wolfVotes[p.id]);
      let pointDir = null;
      if (myVote && myVote !== 'skip' && this.pos.get(myVote) && this.pos.get(p.id)) {
        pointDir = this.pos.get(myVote).x < this.pos.get(p.id).x ? 'l' : 'r';
      }
      const c = s.char.classList;
      const set = (cls, on) => c.toggle(cls, !!on);
      set('me', me);
      set('dead', dead);
      set('off', !p.connected && !p.bot);
      set('sleep', night && !dead && !wolfeyes && !(me && iAct));
      set('wolfeyes', wolfeyes);
      set('target', mode && mode.ids.has(p.id));
      set('dim', mode && !mode.ids.has(p.id) && !dead);
      set('selected', ctx.selected === p.id);
      set('poison', ctx.selected === p.id && mode && mode.kind === 'poison');
      set('victim', S.victim === p.id);
      set('raise', !dead && p.ready && (S.phase === 'day' || S.phase === 'reveal'));
      set('point-l', pointDir === 'l');
      set('point-r', pointDir === 'r');
      set('cheer', S.phase === 'end' && team && team === S.winner);
      set('sad-end', S.phase === 'end' && team && team !== S.winner);
      set('aim', S.phase === 'hunter' && S.hunter === p.id);

      const rinfo = p.role ? S.roleInfo[p.role] : null;
      const tag = `${p.host ? '<b class="crown">👑</b>' : ''}${p.bot ? '<b>🤖</b>' : ''}<span>${esc(p.name)}</span>` +
        `${rinfo ? `<em class="${p.role === 'werewolf' ? 'wolf' : ''}" title="${esc(rinfo.name)}">${rinfo.icon}</em>` : ''}` +
        `${!p.connected && !p.bot ? '<b title="Mất kết nối">📴</b>' : ''}` +
        `${vpeers.includes(p.id) ? (vmuted.includes(p.id) ? '<b title="Đã tắt mic">🔇</b>' : '<b title="Đang trong voice">🎙️</b>') : ''}`;
      if (s.tagHTML !== tag) { s.tag.innerHTML = tag; s.tagHTML = tag; }

      const m = [];
      if (votesFor[p.id]) m.push(`<span class="mk vote">${votesFor[p.id]}</span>`);
      if (wolfFor[p.id]) m.push(`<span class="mk wolf">🐺${wolfFor[p.id]}</span>`);
      if (known[p.id]) m.push(`<span class="mk seer ${known[p.id]}" title="Kết quả soi">${known[p.id] === 'wolf' ? '🐺' : '✅'}</span>`);
      if (nmk.seer === p.id) m.push('<span class="mk orb">🔮</span>');
      if (nmk.guard === p.id) m.push('<span class="mk shield">🛡️</span>');
      if (S.victim === p.id) m.push('<span class="mk">🩸</span>');
      if (S.phase === 'hunter' && S.hunter === p.id) m.push('<span class="mk">🏹</span>');
      if (!dead && p.ready && (S.phase === 'day' || S.phase === 'reveal')) m.push('<span class="mk ok">✓</span>');
      const marks = m.join('');
      if (s.marksHTML !== marks) { s.marks.innerHTML = marks; s.marksHTML = marks; }
    });

    // Người vừa chết → animation theo cách chết
    if (this.prevAlive && inGame) {
      players.forEach((p) => { if (this.prevAlive.get(p.id) === true && !p.alive) this.playDeath(p); });
    }
    this.prevAlive = new Map(players.map((p) => [p.id, inGame ? p.alive : true]));

    // Tin nhắn mới → bong bóng thoại
    const msgs = S.chat || [];
    const lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
    if (this.lastChatId === null) this.lastChatId = lastId;
    else {
      msgs.filter((m) => m.id > this.lastChatId && m.pid).forEach((m) => this.say(m.pid, m.text, m.channel));
      this.lastChatId = Math.max(this.lastChatId, lastId);
    }

    this.layout();
  };

  Scene.prototype.layout = function () {
    const w = this.root.clientWidth;
    const top = parseFloat(this.root.style.getPropertyValue('--sc-top')) || 0;  // chỗ dành cho bảng hành động
    const h = this.root.clientHeight - top;
    if (!w || h <= 0) return;
    const n = Math.max(this.order.length, 1);
    const narrow = w < 600;
    const cx = w / 2;
    const cy = top + h * 0.55;
    const rx = w * (narrow ? 0.37 : 0.39);
    const ry = h * 0.27;
    const f = n <= 6 ? 1 : n <= 9 ? 0.88 : n <= 12 ? 0.76 : n <= 15 ? 0.66 : 0.6;
    const cw = Math.min(w * 0.15, h * 0.21) * f;
    this.cw = cw;
    const fw = Math.min(w, h) * 0.24;
    this.fireEl.style.cssText = `left:${cx}px;top:${cy + fw * 0.12}px;width:${fw}px;z-index:${10 + Math.round(cy + fw * 0.12)}`;
    this.order.forEach((id, i) => {
      const s = this.seats.get(id);
      if (!s) return;
      const th = Math.PI / 2 + (i * 2 * Math.PI) / n;
      const x = cx + rx * Math.cos(th);
      const y = cy + ry * Math.sin(th) + cw * 0.35;
      const depth = (Math.sin(th) + 1) / 2;
      const sc = 0.72 + 0.32 * depth;
      s.el.style.cssText = `left:${x}px;top:${y}px;width:${cw}px;font-size:${cw * 0.2}px;z-index:${10 + Math.round(y)};--s:${sc.toFixed(3)}`;
      const figH = cw * 1.66 * sc;
      this.pos.set(id, { x, y, s: sc, chest: y - figH * 0.4, head: y - figH * 0.9 });
    });
    this.drawLinks(w, h + top);
  };

  Scene.prototype.drawLinks = function (w, h) {
    const S = this.S;
    if (!S) return;
    const lines = [];
    const add = (from, to, cls) => {
      const a = this.pos.get(from);
      const b = this.pos.get(to);
      if (!a || !b || from === to) return;
      const len = Math.hypot(b.x - a.x, b.chest - a.chest);
      const mx = (a.x + b.x) / 2;
      const my = (a.chest + b.chest) / 2 - len * 0.2;
      lines.push(`<path class="ln ${cls}" d="M${a.x.toFixed(1)} ${a.chest.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.chest.toFixed(1)}"/>` +
        `<circle class="ln-dot ${cls}" cx="${b.x.toFixed(1)}" cy="${b.chest.toFixed(1)}" r="5"/>`);
    };
    if (S.votes && (S.phase === 'vote' || S.phase === 'verdict')) {
      Object.entries(S.votes).forEach(([v, t]) => { if (t !== 'skip') add(v, t, 'vote'); });
    }
    if (S.wolfVotes) Object.entries(S.wolfVotes).forEach(([v, t]) => add(v, t, 'wolf'));
    this.linksEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const html = lines.join('');
    if (html !== this.linksHTML) { this.linksEl.innerHTML = html; this.linksHTML = html; }
  };

  Scene.prototype.setSpeaking = function (id, on) {
    const s = this.seats.get(id);
    if (s) s.char.classList.toggle('speaking', !!on);
  };

  // ---------------------------------------------------------------- hiệu ứng
  Scene.prototype.temp = function (id, cls, ms) {
    const s = this.seats.get(id);
    if (!s) return;
    clearTimeout(s.timers[cls]);
    s.char.classList.remove(cls);
    void s.char.offsetWidth; // chạy lại animation
    s.char.classList.add(cls);
    s.timers[cls] = setTimeout(() => s.char.classList.remove(cls), ms);
  };

  Scene.prototype.pop = function (id, emoji, cls = '') {
    const p = this.pos.get(id);
    if (!p) return;
    const el = document.createElement('span');
    el.className = 'sc-pop ' + cls;
    el.textContent = emoji;
    el.style.cssText = `left:${p.x + (cls === 'burst' ? (Math.random() - 0.5) * this.cw : 0)}px;top:${p.head}px;font-size:${Math.max(22, this.cw * 0.42)}px`;
    this.fxEl.appendChild(el);
    setTimeout(() => el.remove(), 1700);
  };

  Scene.prototype.throwItem = function (from, to, emoji, done) {
    const a = this.pos.get(from);
    const b = this.pos.get(to);
    if (!a || !b) { if (done) done(); return; }
    const el = document.createElement('span');
    el.className = 'sc-proj';
    el.textContent = emoji;
    el.style.cssText = `left:${a.x}px;top:${a.chest}px;font-size:${Math.max(20, this.cw * 0.36)}px`;
    this.fxEl.appendChild(el);
    const dx = b.x - a.x;
    const dy = b.chest - a.chest;
    const arc = Math.min(170, 50 + Math.hypot(dx, dy) * 0.35);
    const base = 'translate(-50%,-50%)';
    const anim = el.animate([
      { transform: `${base} translate(0,0) rotate(0deg) scale(.7)` },
      { transform: `${base} translate(${dx / 2}px,${dy / 2 - arc}px) rotate(220deg) scale(1.25)` },
      { transform: `${base} translate(${dx}px,${dy}px) rotate(440deg) scale(1)` },
    ], { duration: 720, easing: 'ease-in-out' });
    anim.onfinish = () => { el.remove(); if (done) done(); };
  };

  Scene.prototype.say = function (id, text, channel) {
    const s = this.seats.get(id);
    if (!s) return;
    s.bubble.textContent = text.length > 90 ? text.slice(0, 88) + '…' : text;
    s.bubble.className = 'ch-bubble show ' + (channel || '');
    clearTimeout(s.timers.bubble);
    s.timers.bubble = setTimeout(() => { s.bubble.className = 'ch-bubble'; }, 4500 + Math.min(4000, text.length * 40));
    this.temp(id, 'talk', 1200);
  };

  Scene.prototype.rope = function (id) {
    const p = this.pos.get(id);
    if (!p) return;
    const el = document.createElement('div');
    el.className = 'sc-rope';
    el.style.cssText = `left:${p.x}px;height:${Math.max(0, p.head + this.cw * 0.15)}px`;
    this.fxEl.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  };

  Scene.prototype.playDeath = function (p) {
    const s = this.seats.get(p.id);
    if (!s) return;
    const d = p.death || { cause: 'night' };
    s.char.classList.add('dying');
    let total = 2300;
    if (d.cause === 'vote') {
      this.rope(p.id);
      this.temp(p.id, 'hanged', 2700);
      total = 2700;
    } else if (d.cause === 'hunter' && d.by && this.pos.get(d.by)) {
      this.throwItem(d.by, p.id, '🏹', () => { this.pop(p.id, '💥'); this.temp(p.id, 'knocked', 1800); });
      total = 2600;
    } else {
      this.pop(p.id, '💀');
      this.temp(p.id, 'knocked', 1800);
    }
    setTimeout(() => s.char.classList.remove('dying'), total);
  };

  Scene.prototype.fx = function (m) {
    const def = FX[m.kind];
    if (!def || !this.seats.has(m.from)) return;
    if (def.self) this.temp(m.from, def.self, def.ms);
    const to = m.to && m.to !== m.from && this.seats.has(m.to) ? m.to : null;
    if (def.throw && to) {
      this.throwItem(m.from, to, def.emoji, () => this.impact(to, def.impact, m.from));
    } else {
      this.pop(m.from, def.emoji);
      if (m.kind === 'wave' && to) setTimeout(() => this.pop(to, '👋', 'small'), 300);
    }
  };

  Scene.prototype.impact = function (to, kind, from) {
    switch (kind) {
      case 'hearts':
        ['❤️', '💕', '💖'].forEach((e, i) => setTimeout(() => this.pop(to, e, 'burst'), i * 130));
        this.temp(to, 'blush', 2500);
        break;
      case 'flower':
        this.temp(to, 'holdflower', 6000);
        this.temp(to, 'blush', 3000);
        this.pop(to, '🥰');
        break;
      case 'splat':
        this.temp(to, 'splat', 4000);
        this.temp(to, 'shake', 600);
        this.pop(to, '💥');
        break;
      case 'five':
        this.pop(to, '✨');
        this.temp(to, 'hop', 600);
        if (from) this.temp(from, 'hop', 600);
        break;
      case 'poke':
        this.temp(to, 'jolt', 500);
        this.pop(to, '❗');
        break;
      default:
    }
  };

  window.WWScene = Scene;
})();
