(function () {
  const P = window.Platform;
  const Synth = window.Synth;
  const $ = (s) => document.querySelector(s);
  const esc = P.esc;
  const ROOM = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
  if (!ROOM) { location.href = '/'; return; }

  let S = null;          // trạng thái mới nhất từ máy chủ
  let SONGS = [];        // nạp từ songs.json
  let conn = null;
  let clockOffset = 0;
  const ui = {
    mode: 'free', inst: 'piano', names: 'solfa', sound: true, tab: 'chat', unread: 0, lastChatId: null, lanBase: null,
    lessonSong: 'scale', lessonMode: 'wait', lessonSpeed: 1, contestSong: 'twinkle', contestSpeed: 1,
    earLevel: 'easy', earCount: 8, pianoOct: 0, live: {}, roundKey: null, earKey: null,
  };
  try {
    ui.inst = localStorage.getItem('nc_inst') || 'piano';
    ui.names = localStorage.getItem('nc_names') || 'solfa';
    ui.sound = localStorage.getItem('nc_sound') !== '0';
  } catch (e) { /* bỏ qua */ }

  // ---------------------------------------------------------------- nốt nhạc
  const SOLFA = ['Đô', 'Đô♯', 'Rê', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'Si♭', 'Si'];
  const LETTER = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
  const DIATONIC = [0, 2, 4, 5, 7, 9, 11];
  const LANE_OF_PC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];  // nốt thăng nằm chung làn với nốt tự nhiên bên dưới
  const LANE_COLORS = ['#ff5d6c', '#ff9f43', '#ffd84d', '#3ecf8e', '#36c5f0', '#5b8cff', '#b07bff'];
  const pcName = (pc) => (ui.names === 'letter' ? LETTER : SOLFA)[((pc % 12) + 12) % 12];
  const noteName = (m) => `${pcName(m % 12)}${ui.names === 'letter' ? Math.floor(m / 12) - 1 : ''}`;
  const fullName = (m) => `${SOLFA[m % 12]} (${LETTER[m % 12]}${Math.floor(m / 12) - 1})`;
  const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);
  const LETTER_IDX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function parseSong(song, speed = 1) {
    const spb = 60 / song.bpm / speed;
    let t = 0;
    const notes = [];
    song.notes.split(/\s+/).forEach((tok) => {
      const [name, dur] = tok.split('-');
      const beats = dur ? parseFloat(dur) : 1;
      const mt = /^([A-G])([#b]?)(-?\d)$/.exec(name);
      if (mt) {
        const m = 12 * (parseInt(mt[3], 10) + 1) + LETTER_IDX[mt[1]] + (mt[2] === '#' ? 1 : mt[2] === 'b' ? -1 : 0);
        notes.push({ m, pc: m % 12, lane: LANE_OF_PC[m % 12], t, d: beats * spb, st: 0 });
      }
      t += beats * spb;
    });
    return { notes, end: t, spb };
  }
  const songById = (id) => SONGS.find((s) => s.id === id) || SONGS[0];

  // ---------------------------------------------------------------- nhạc cụ
  const INST = {
    piano: { icon: '🎹', name: 'Piano', low: 48, high: 84 },
    sao: { icon: '🪈', name: 'Sáo trúc', low: 72, high: 95 },
    violin: { icon: '🎻', name: 'Violin', low: 55, high: 83 },
  };
  // Đưa nốt của bài vào tầm của nhạc cụ (theo quãng tám).
  function fit(m, inst = ui.inst) {
    const I = INST[inst];
    let x = m + (inst === 'sao' ? 12 : 0);
    while (x < I.low) x += 12;
    while (x > I.high) x -= 12;
    return x;
  }

  // Piano: bàn phím máy tính → nốt (tính theo Đô4, dời theo quãng tám đang chọn).
  const PIANO_KEYS = {
    KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
    KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21,
    Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
    Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  };
  const keyLabel = (code) => code.replace(/^Key|^Digit/, '').replace('Comma', ',').replace('Period', '.').replace('Semicolon', ';').replace('Slash', '/');
  const pianoBase = () => 60 + 12 * ui.pianoOct;

  // Sáo Đô 6 lỗ (lỗ 1 gần miệng thổi): thế bấm → nốt. 1 = bịt, 0 = mở.
  const FINGERING = { 111111: 0, 111110: 2, 111100: 4, 111000: 5, 110000: 7, 100000: 9, '000000': 11, '011000': 10 };
  const PATTERN_OF = {};
  Object.entries(FINGERING).forEach(([pat, pc]) => { PATTERN_OF[pc] = String(pat).padStart(6, '0'); });
  // Bàn phím: mặc định bịt cả 6 lỗ (Đô). Mỗi phím mở dần lỗ từ dưới lên, chỉ cần giữ phím xa nhất:
  // A = Rê, S = Mi, D = Fa, J = Sol, K = La, L = Si (mở hết). Hàng Q W E U I O giống vậy ở quãng tám trên.
  const LOW_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyJ', 'KeyK', 'KeyL'];
  const HIGH_KEYS = ['KeyQ', 'KeyW', 'KeyE', 'KeyU', 'KeyI', 'KeyO'];
  const sao = { keys: new Set(), clicks: [false, false, false, false, false, false], quick: null, space: false, btn: false, shift: false, strongLock: false, sound: null };

  // Violin: 4 dây, ô 0 = dây buông, 1…7 = số nửa cung tính từ dây buông.
  const STRINGS = [
    { name: 'Mi', open: 76, keys: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'], fingers: [0, 1, 3, 5, 7] },
    { name: 'La', open: 69, keys: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'], fingers: [0, 2, 3, 5, 7] },
    { name: 'Rê', open: 62, keys: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'], fingers: [0, 2, 3, 5, 7] },
    { name: 'Sol', open: 55, keys: ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB'], fingers: [0, 2, 4, 5, 7] },
  ];
  const FINGER_NAME = ['dây buông', 'ngón 1 (lùi)', 'ngón 1', 'ngón 2 (thấp)', 'ngón 2 (cao)', 'ngón 3', 'ngón 3 (cao)', 'ngón 4'];
  const VIOLIN_KEYS = {};
  STRINGS.forEach((s, si) => s.keys.forEach((k, fi) => { VIOLIN_KEYS[k] = [si, fi]; }));
  function violinPos(m) {
    // Chọn dây cho nốt gần dây buông nhất (ưu tiên dây buông, tránh ngón 4).
    let best = null;
    STRINGS.forEach((s, si) => {
      const off = m - s.open;
      if (off >= 0 && off <= 7 && (!best || off < best.off)) best = { si, off };
    });
    return best;
  }

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
  const send = (action, data) => conn && conn.send(action, data);
  const sendQuiet = (action, data) => conn && conn.sendRaw({ type: 'action', action, data });
  const fmtTime = (t) => new Date(t * 1000).toTimeString().slice(0, 5);
  const btn = (act, text, kind = '', extra = '') => `<button class="gh-btn ${kind}" data-act="${act}" ${extra}>${text}</button>`;
  const serverNow = () => Date.now() / 1000 + clockOffset;
  const stars = (n) => '⭐'.repeat(n) + '<span class="dim">' + '⭐'.repeat(Math.max(0, 3 - n)) + '</span>';
  const FX_EMOJI = {
    wave: '👋', heart: '❤️', flower: '🌹', tomato: '🍅', highfive: '✋', poke: '👉', laugh: '😂',
    angry: '😡', cry: '😭', shock: '😱', think: '🤔', clap: '👏', dance: '💃',
  };
  const R = () => S && S.round;
  const roundLive = () => { const r = R(); return !!(r && r.phase !== 'result'); };
  const inRound = () => { const r = R(); return !!(r && S && r.players.includes(S.me.id)); };

  // ---------------------------------------------------------------- chơi nốt (của mình)
  const held = new Map();   // nguồn (phím / ngón chạm / sáo) → {m, v}
  function noteOn(src, m) {
    noteOff(src);
    const v = Synth.start(ui.inst, m);
    held.set(src, { m, v });
    if (!roundLive()) sendQuiet('note', { m, on: true });
    played(m);
    refreshActive();
  }
  function noteOff(src) {
    const h = held.get(src);
    if (!h) return;
    h.v.stop();
    held.delete(src);
    sendQuiet('note', { m: h.m, on: false });
    refreshActive();
  }
  function releaseAll() {
    [...held.keys()].forEach(noteOff);
    sao.keys.clear(); sao.space = false; sao.btn = false; sao.shift = false; sao.quick = null;
    if (sao.sound && sao.sound.hiss) { sao.sound.hiss.stop(); sao.sound = null; }
  }

  // Âm thanh của người khác trong phòng tập.
  const remote = new Map();
  const seatGlow = new Map();
  function onRemoteNote(msg) {
    const key = msg.pid + ':' + msg.m;
    const old = remote.get(key);
    if (old) { old.v.stop(); clearTimeout(old.timer); remote.delete(key); }
    if (msg.on) {
      if (ui.sound && !roundLive()) {
        const v = Synth.start(msg.i, msg.m, { vol: 0.2 });
        const timer = setTimeout(() => { v.stop(); remote.delete(key); }, 6000);
        remote.set(key, { v, timer });
      }
      glowSeat(msg.pid, noteName(msg.m));
    }
  }
  function glowSeat(pid, label) {
    const seat = document.querySelector(`#audience [data-pid="${CSS.escape(pid)}"]`);
    if (!seat) return;
    seat.classList.add('playing');
    const tag = seat.querySelector('.note-tag');
    if (tag) tag.textContent = '♪ ' + label;
    clearTimeout(seatGlow.get(pid));
    seatGlow.set(pid, setTimeout(() => seat.classList.remove('playing'), 450));
  }

  // ---------------------------------------------------------------- mỗi nốt vừa chơi
  const flash = new Array(7).fill(0);       // làn sáng lên khi bấm
  const wrongFlash = new Array(7).fill(0);
  const staff = [];                          // nốt gần đây trên khuông (phòng tập)
  const pops = [];                           // chữ “Hoàn hảo!” bay lên
  let lastPlayed = null;
  function played(m) {
    const pc = m % 12;
    const lane = LANE_OF_PC[pc];
    flash[lane] = performance.now();
    lastPlayed = m;
    glowSeat(S ? S.me.id : '', noteName(m));
    staff.push({ m, at: performance.now() });
    if (staff.length > 24) staff.shift();
    const r = R();
    if (r && r.kind === 'ear') { earPlayed(pc); return; }
    if (r && r.kind === 'song' && r.phase === 'play' && contest && inRound()) { judge(contest, pc, contestTime()); return; }
    if (lesson && !lesson.auto && !lesson.done) lessonPlayed(pc);
    updateHint();
  }

  // ---------------------------------------------------------------- chấm điểm theo nhịp
  const PERFECT = 0.09;
  const GOOD = 0.22;
  function newRun(song, speed) {
    const p = parseSong(song, speed);
    return { song: song.id, speed, notes: p.notes, end: p.end, spb: p.spb, score: 0, combo: 0, maxCombo: 0, hit: 0, perfect: 0, judged: 0 };
  }
  function addPop(text, lane, cls) { pops.push({ text, lane, cls, at: performance.now() }); if (pops.length > 12) pops.shift(); }
  function judge(run, pc, t) {
    let best = null;
    run.notes.forEach((n) => {
      if (n.st || n.pc !== pc) return;
      const dt = Math.abs(n.t - t);
      if (dt <= GOOD && (!best || dt < Math.abs(best.t - t))) best = n;
    });
    if (!best) {
      run.combo = 0;
      wrongFlash[LANE_OF_PC[pc]] = performance.now();
      return null;
    }
    const perfect = Math.abs(best.t - t) <= PERFECT;
    best.st = perfect ? 1 : 2;
    run.hit++; run.judged++;
    if (perfect) run.perfect++;
    run.combo++;
    run.maxCombo = Math.max(run.maxCombo, run.combo);
    run.score += (perfect ? 100 : 60) + 2 * Math.min(run.combo, 50);
    addPop(perfect ? 'Hoàn hảo!' : 'Tốt', best.lane, perfect ? 'perfect' : 'good');
    return best;
  }
  function sweepMisses(run, t) {
    run.notes.forEach((n) => {
      if (!n.st && t - n.t > GOOD) { n.st = -1; run.judged++; run.combo = 0; addPop('Trượt', n.lane, 'miss'); }
    });
  }
  const nextPending = (run, t) => run.notes.find((n) => !n.st && n.t >= t - GOOD) || null;

  // ---------------------------------------------------------------- học bài
  let lesson = null;
  function startLesson(auto = false) {
    const song = songById(ui.lessonSong);
    if (!song) return;
    Synth.unlock();
    const speed = ui.lessonMode === 'wait' && !auto ? 1 : ui.lessonSpeed;
    lesson = { ...newRun(song, speed), mode: auto ? 'demo' : ui.lessonMode, auto, idx: 0, mistakes: 0, waitT: -1.2, done: false, sentPct: -1, lastTick: null };
    lesson.start = performance.now() / 1000 + (lesson.mode === 'wait' ? 0 : 3);
    if (!auto) reportProgress(0);
    renderPanel(); renderOverlay(); updateHint();
  }
  function stopLesson() {
    if (lesson && !lesson.auto && !lesson.done) sendQuiet('progress', { song: '' });
    lesson = null;
    renderPanel(); renderOverlay(); updateHint();
  }
  function reportProgress(pct) {
    const step = Math.floor(pct / 25) * 25;
    if (!lesson || step === lesson.sentPct) return;
    lesson.sentPct = step;
    sendQuiet('progress', { song: lesson.song, pct: step });
  }
  const lessonTime = () => performance.now() / 1000 - lesson.start;
  function lessonPlayed(pc) {
    if (lesson.mode === 'wait') {
      const n = lesson.notes[lesson.idx];
      if (!n) return;
      if (n.pc === pc) {
        n.st = 1; lesson.hit++; lesson.idx++;
        addPop('✓', n.lane, 'perfect');
        reportProgress(lesson.idx / lesson.notes.length * 100);
        if (lesson.idx >= lesson.notes.length) finishLesson();
      } else {
        lesson.mistakes++;
        wrongFlash[LANE_OF_PC[pc]] = performance.now();
        addPop('Chưa đúng', LANE_OF_PC[pc], 'miss');
      }
    } else if (lessonTime() >= -0.3) {
      judge(lesson, pc, lessonTime());
      reportProgress(lesson.judged / lesson.notes.length * 100);
    }
  }
  function finishLesson() {
    const L = lesson;
    L.done = true;
    if (L.auto) { lesson = null; renderPanel(); renderOverlay(); updateHint(); return; }
    const total = L.notes.length;
    if (L.mode === 'wait') {
      L.stars = L.mistakes <= 1 ? 3 : L.mistakes <= Math.max(2, Math.round(total * 0.15)) ? 2 : 1;
      L.passed = true;
    } else {
      const acc = L.hit / total;
      L.acc = acc;
      L.passed = acc >= 0.5;
      L.stars = acc >= 0.9 ? 3 : acc >= 0.7 ? 2 : 1;
    }
    if (L.passed) send('lesson_done', { song: L.song, stars: L.stars, mode: L.mode === 'tempo' ? 'tempo' : 'wait' });
    else sendQuiet('progress', { song: '' });
    playJingle(L.passed);
    renderPanel(); renderOverlay(); updateHint();
  }
  function playJingle(good) {
    const seq = good ? [72, 76, 79, 84] : [67, 63];
    seq.forEach((m, i) => Synth.play('piano', m, 0.25, { vol: 0.18, at: i * 0.12 }));
  }

  // ---------------------------------------------------------------- thi tài (cả phòng)
  let contest = null;
  const contestTime = () => serverNow() - R().startAt;
  function syncRound() {
    const r = R();
    const key = r ? `${r.id}:${r.kind}` : null;
    if (key !== ui.roundKey) {
      ui.roundKey = key;
      ui.live = {};
      contest = null;
      if (r && r.phase !== 'result') {
        if (lesson) stopLesson();
        releaseAll();
        ui.mode = 'contest';
        if (r.kind === 'song') {
          contest = newRun(songById(r.song), r.speed);
          contest.sent = false; contest.lastLive = 0; contest.lastTick = null;
        }
      }
    }
    if (r && r.kind === 'ear') syncEar(r);
    if (r && r.live) Object.entries(r.live).forEach(([pid, score]) => { if (!ui.live[pid]) ui.live[pid] = { score, combo: 0 }; });
  }
  function contestStep() {
    const r = R();
    if (!contest || !r || r.kind !== 'song' || r.phase !== 'play') return;
    const t = contestTime();
    if (t < 0) {
      const sec = Math.ceil(-t);
      if (sec <= 3 && sec !== contest.lastTick) { contest.lastTick = sec; Synth.tick(false); }
      return;
    }
    if (!inRound()) return;
    sweepMisses(contest, t);
    const now = performance.now();
    if (now - contest.lastLive > 500) {
      contest.lastLive = now;
      if (contest.score !== contest.sentScore) { contest.sentScore = contest.score; sendQuiet('live', { score: contest.score, combo: contest.combo }); }
    }
    if (!contest.sent && t > contest.end + GOOD + 0.3) {
      contest.sent = true;
      sendQuiet('score', { score: contest.score, hit: contest.hit, perfect: contest.perfect, combo: contest.maxCombo });
    }
  }

  // ---------------------------------------------------------------- đoán nốt
  function syncEar(r) {
    const key = `${r.id}:${r.q}`;
    if (r.phase === 'question' && key !== ui.earKey) {
      ui.earKey = key;
      ui.earSent = false;
      scheduleEar(r);
    }
  }
  function scheduleEar(r) {
    const inst = ui.inst;
    const ref = r.tone - (r.tone % 12);   // nốt Đô cùng quãng tám
    const lead = Math.max(0, r.startAt - serverNow());
    Synth.play(inst, ref, 0.7, { at: lead });
    Synth.play(inst, r.tone, 1.1, { at: Math.max(0, r.askAt - serverNow()) });
  }
  function replayEar() {
    const r = R();
    if (!r || r.kind !== 'ear') return;
    const ref = r.tone - (r.tone % 12);
    Synth.play(ui.inst, ref, 0.6);
    Synth.play(ui.inst, r.tone, 1.0, { at: 0.8 });
  }
  function earPlayed(pc) {
    const r = R();
    if (!r || r.phase !== 'question' || !inRound() || ui.earSent || r.mine) return;
    if (serverNow() < r.askAt + 0.2) return;
    ui.earSent = true;
    send('answer', { pc });
  }

  // ---------------------------------------------------------------- kết nối
  function connect() {
    conn = P.connect({
      room: ROOM,
      onState,
      onFx,
      onMessage: (m) => {
        if (m.type === 'note') onRemoteNote(m);
        else if (m.type === 'live') { ui.live[m.pid] = { score: m.score, combo: m.combo }; renderOverlay(); }
      },
      onStatus: (on) => $('#conn').classList.toggle('off', !on),
      onFatal: (m) => P.showFatal(m, { onRetryName: () => connect() }),
    });
  }

  function onState(state) {
    const first = S === null;
    S = state;
    clockOffset = state.now - Date.now() / 1000;
    const me = player(S.me.id);
    if (me && me.inst !== ui.inst) send('inst', { inst: ui.inst });
    if (first) buildInstrument();
    syncRound();
    render();
  }

  // ---------------------------------------------------------------- hiệu ứng
  function seatRect(pid) {
    const el = document.querySelector(`#audience [data-pid="${CSS.escape(pid || '')}"] .ava`);
    return el ? el.getBoundingClientRect() : null;
  }
  function fly(html, from, to, { dur = 450 } = {}) {
    if (!from || !to) return;
    const el = document.createElement('div');
    el.className = 'flyer';
    el.innerHTML = html;
    document.body.appendChild(el);
    const w = el.offsetWidth; const h = el.offsetHeight;
    const x0 = from.left + from.width / 2 - w / 2; const y0 = from.top + from.height / 2 - h / 2;
    const x1 = to.left + to.width / 2 - w / 2; const y1 = to.top + to.height / 2 - h / 2;
    const anim = el.animate([
      { transform: `translate(${x0}px, ${y0}px) scale(.7)`, opacity: 1 },
      { transform: `translate(${x1}px, ${y1}px) scale(1.2)`, opacity: 1 },
    ], { duration: dur, easing: 'cubic-bezier(.3,.8,.3,1)', fill: 'forwards' });
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
    if (!S || !SONGS.length) return;
    renderTop();
    renderAudience();
    renderBar();
    renderModes();
    renderInsts();
    renderPanel();
    renderOverlay();
    renderEmotes();
    renderChat();
    renderBoard();
    updateHint();
    tick();
  }

  function renderTop() {
    const r = R();
    let pill = '🎶 Phòng tập';
    if (r && r.phase !== 'result') pill = r.kind === 'song' ? `🏆 ${songById(r.song).name}` : `👂 Đoán nốt ${r.q}/${r.count}`;
    else if (lesson) pill = `📘 ${songById(lesson.song).name}`;
    $('#phase-pill').textContent = pill;
    $('#room-code').textContent = ROOM;
    $('#btn-sound').textContent = ui.sound ? '🔈' : '🔇';
    $('#btn-names').textContent = ui.names === 'letter' ? 'CDE' : 'ĐRM';
    document.title = `Lớp Nhạc Cụ ${ROOM}`;
  }

  function renderAudience() {
    const r = R();
    const html = S.players.map((p) => {
      const tags = [`<span class="tag inst" title="${INST[p.inst].name}">${INST[p.inst].icon}</span>`];
      if (p.host) tags.push('<span class="tag">👑</span>');
      if (p.stars) tags.push(`<span title="Tổng số sao học bài">⭐${p.stars}</span>`);
      if (p.wins) tags.push(`<span title="Số lần thắng">🏆${p.wins}</span>`);
      let sub = '';
      if (p.activity) sub = `📘 ${p.activity.pct}%`;
      if (r && r.kind === 'ear' && r.phase === 'question' && r.answered.includes(p.id)) sub = '✅ Đã trả lời';
      const cls = ['seat', p.id === S.me.id ? 'me' : '', p.connected ? '' : 'off', r && r.phase !== 'result' && r.players.includes(p.id) ? 'in' : ''].join(' ');
      const title = p.activity ? ` title="Đang học: ${esc(songById(p.activity.song).name)}"` : '';
      return `<div class="${cls}" data-pid="${esc(p.id)}"${title}><div class="ava">${window.Avatar.svg(p.look, { head: true, seed: p.id })}</div>
        <div class="note-tag"></div>
        <div class="name">${p.id === S.me.id ? 'Bạn' : esc(p.name)}</div><div class="meta">${tags.join('')}</div>
        <div class="sub">${sub}</div></div>`;
    }).join('');
    setHTML($('#audience'), html);
  }

  function renderBar() {
    const r = R();
    let msg;
    let btns = '';
    if (r && r.phase !== 'result') {
      if (r.kind === 'song') {
        msg = `🏆 Thi tài: <b>${esc(songById(r.song).name)}</b>${r.speed !== 1 ? ` · ${Math.round(r.speed * 100)}%` : ''}<small>${inRound() ? 'Chơi đúng nốt khi nốt chạm vạch — chỉ cần đúng tên nốt, quãng tám nào cũng được.' : 'Bạn vào sau nên chỉ xem lượt này.'}</small>`;
      } else {
        msg = `👂 Đoán nốt — câu ${r.q}/${r.count}<small>${inRound() ? 'Nghe nốt Đô chuẩn rồi nốt bí ẩn, chơi lại đúng nốt đó.' : 'Bạn vào sau nên chỉ xem lượt này.'}</small>`;
      }
      if (S.me.host) btns = btn('close', '⏹ Dừng', 'ghost small');
    } else if (ui.mode === 'lesson') {
      msg = '📘 Học bài<small>Chọn bài, nghe mẫu rồi tập — “Chờ nốt” để tập chậm, “Theo nhịp” để chơi đúng tốc độ.</small>';
    } else if (ui.mode === 'contest') {
      msg = S.me.host ? '🏆 Thi tài<small>Chọn bài và tốc độ rồi bắt đầu, hoặc chơi Đoán nốt để luyện tai.</small>'
        : '🏆 Thi tài<small>Chờ chủ phòng chọn bài… trong lúc đó cứ tập thoải mái.</small>';
    } else {
      const others = S.players.filter((p) => p.id !== S.me.id && p.connected).length;
      msg = `🎶 Phòng tập<small>${others ? `Cả phòng nghe nhau đàn — rủ ${others} người còn lại hoà tấu nhé!` : 'Đàn thoải mái. Mời bạn bè vào để cùng hoà tấu!'}</small>`;
      btns = btn('copy-link', '📨 Mời bạn', 'small');
    }
    setHTML($('#bar'), `<div class="msg-main">${msg}</div>${btns}`);
  }

  function renderModes() {
    document.querySelectorAll('#modes [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === ui.mode));
  }

  function renderInsts() {
    const html = Object.entries(INST).map(([k, I]) => `<button class="inst-opt ${k === ui.inst ? 'on' : ''}" data-inst="${k}">
      <span class="ii">${I.icon}</span><b>${I.name}</b></button>`).join('');
    setHTML($('#insts'), html);
  }

  function songPicker(attr, current) {
    const mine = S.me.stars || {};
    return `<div class="songs">${SONGS.map((s) => `<button class="song-opt ${s.id === current ? 'on' : ''}" data-${attr}="${s.id}">
      <span class="si">${s.icon}</span><b>${esc(s.name)}</b>
      <small>${'●'.repeat(s.level)}${'○'.repeat(3 - s.level)} · ${esc(s.hint)}</small>
      ${attr === 'lsong' ? `<span class="st">${stars(mine[s.id] || 0)}</span>` : ''}</button>`).join('')}</div>`;
  }
  const seg = (attr, value, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-${attr}="${v}" class="${String(v) === String(value) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const SPEED_OPTS = [[0.5, '50%'], [0.75, '75%'], [1, '100%']];

  function renderPanel() {
    if (!S || !SONGS.length) return;
    let html = '';
    const r = R();
    if (ui.mode === 'lesson') {
      if (lesson && !lesson.done) {
        const s = songById(lesson.song);
        const label = lesson.mode === 'demo' ? '🎧 Đang phát mẫu' : lesson.mode === 'wait' ? '🐢 Chờ nốt' : `⏱ Theo nhịp ${Math.round(lesson.speed * 100)}%`;
        html = `<div class="row"><div class="now-song">${s.icon} <b>${esc(s.name)}</b> <span class="gh-muted">· ${label}</span></div>
          ${btn('lesson-stop', '⏹ Dừng', 'ghost small')}</div>`;
      } else {
        html = `${songPicker('lsong', ui.lessonSong)}
          <div class="row">${seg('lmode', ui.lessonMode, [['wait', '🐢 Chờ nốt'], ['tempo', '⏱ Theo nhịp']])}
          ${ui.lessonMode === 'tempo' ? seg('lspeed', ui.lessonSpeed, SPEED_OPTS) : ''}
          <div class="spacer"></div>${btn('lesson-demo', '🎧 Nghe mẫu', 'small')}${btn('lesson-start', '▶ Bắt đầu tập', 'primary')}</div>`;
      }
    } else if (ui.mode === 'contest') {
      if (r && r.phase !== 'result') {
        html = '';
      } else if (S.me.host) {
        html = `<h4>🏆 Thi chơi đúng nhịp</h4>${songPicker('csong', ui.contestSong)}
          <div class="row">${seg('cspeed', ui.contestSpeed, SPEED_OPTS)}<div class="spacer"></div>${btn('start-song', '🏁 Bắt đầu thi', 'primary')}</div>
          <h4>👂 Đoán nốt</h4>
          <div class="row">${seg('elevel', ui.earLevel, [['easy', '7 nốt tự nhiên'], ['hard', 'Đủ 12 nốt']])}
          ${seg('ecount', ui.earCount, [[5, '5 câu'], [8, '8 câu'], [12, '12 câu']])}<div class="spacer"></div>${btn('start-ear', '👂 Bắt đầu', 'primary')}</div>`;
      } else {
        html = '<div class="gh-muted wait-note">⏳ Chờ chủ phòng chọn bài thi hoặc mở Đoán nốt…</div>';
      }
    } else {
      html = '';
    }
    const el = $('#panel');
    el.hidden = !html;
    setHTML(el, html);
  }

  // Lớp phủ trên màn hình: đếm ngược, đoán nốt, kết quả.
  function renderOverlay() {
    if (!S) return;
    const r = R();
    let html = '';
    if (r && r.kind === 'song') {
      if (r.phase === 'result') html = resultHTML(r);
      else {
        const rows = r.players.map((pid) => ({ pid, score: (pid === S.me.id && contest ? contest.score : (ui.live[pid] || {}).score) || 0 }))
          .sort((a, b) => b.score - a.score);
        html = `<div class="live-board">${rows.map((x, i) => `<div class="${x.pid === S.me.id ? 'me' : ''}"><span>${i + 1}. ${INST[(player(x.pid) || {}).inst || 'piano'].icon} ${esc(x.pid === S.me.id ? 'Bạn' : nm(x.pid))}</span><b>${x.score}</b></div>`).join('')}</div>`;
      }
    } else if (r && r.kind === 'ear') {
      html = r.phase === 'result' ? resultHTML(r) : earHTML(r);
    } else if (lesson && lesson.done) {
      const L = lesson;
      const s = songById(L.song);
      const detail = L.mode === 'wait' ? `Sai ${L.mistakes} lần` : `Trúng ${L.hit}/${L.notes.length} nốt · ${L.perfect} hoàn hảo · chuỗi dài nhất ${L.maxCombo}`;
      html = `<div class="card-center"><div class="big-emo">${L.passed ? '🎉' : '💪'}</div>
        <h3>${L.passed ? 'Hoàn thành' : 'Chưa đạt — thử lại nhé!'} “${esc(s.name)}”</h3>
        ${L.passed ? `<div class="stars-big">${stars(L.stars)}</div>` : ''}<p>${detail}</p>
        <div class="row center">${btn('lesson-again', '🔁 Chơi lại', 'primary')}${btn('lesson-close', '📚 Bài khác', 'ghost')}</div></div>`;
    } else if (ui.mode === 'free' && !lesson) {
      html = '';
    } else if (ui.mode === 'lesson' && !lesson) {
      html = '<div class="card-center soft"><div class="big-emo">📘</div><p>Chọn một bài ở trên rồi bấm <b>▶ Bắt đầu tập</b>.</p></div>';
    } else if (ui.mode === 'contest' && !r) {
      html = '<div class="card-center soft"><div class="big-emo">🏆</div><p>Cả phòng cùng chơi một bài, ai chính xác nhất sẽ thắng!</p></div>';
    }
    setHTML($('#overlay'), html);
  }

  function earHTML(r) {
    const playing = serverNow() < r.askAt + 0.6;
    const pcs = r.level === 'hard' ? [...Array(12).keys()] : DIATONIC;
    const mine = r.mine;
    if (r.phase === 'reveal') {
      const ans = r.answers || {};
      const rows = r.players.map((pid) => {
        const a = ans[pid];
        return `<div class="ans ${a ? (a.ok ? 'ok' : 'bad') : 'none'}"><span>${esc(pid === S.me.id ? 'Bạn' : nm(pid))}</span>
          <span>${a ? `${pcName(a.pc)} ${a.ok ? `✅ +${a.pts}` : '❌'}` : '— hết giờ'}</span></div>`;
      }).join('');
      return `<div class="card-center"><div class="gh-muted">Câu ${r.q}/${r.count} — đáp án</div>
        <div class="reveal-note" style="color:${LANE_COLORS[LANE_OF_PC[r.pc]]}">${pcName(r.pc)}</div>
        <div class="ans-list">${rows}</div></div>`;
    }
    let body;
    if (!inRound()) body = '<p class="gh-muted">Đang xem…</p>';
    else if (mine) body = `<p>Bạn chọn <b>${pcName(mine.pc)}</b> — chờ đáp án…</p>`;
    else if (ui.earSent) body = '<p class="gh-muted">Đã gửi câu trả lời…</p>';
    else if (playing) body = '<p class="gh-muted">🎧 Lắng nghe…</p>';
    else {
      body = `<p>Chơi lại nốt vừa nghe trên ${INST[ui.inst].name}, hoặc bấm tên nốt:</p>
        <div class="pc-grid">${pcs.map((pc) => `<button class="pc-btn" data-pc="${pc}" style="--c:${LANE_COLORS[LANE_OF_PC[pc]]}">${pcName(pc)}</button>`).join('')}</div>`;
    }
    return `<div class="card-center"><div class="gh-muted">Câu ${r.q}/${r.count}</div>
      <div class="big-emo ${playing ? 'pulse' : ''}">👂</div>${body}
      <div class="row center">${btn('ear-replay', '🔁 Nghe lại', 'ghost small')}</div></div>`;
  }

  function resultHTML(r) {
    const rows = (r.ranking || []).map((pid, i) => {
      const sc = r.scores[pid] || {};
      const p = player(pid);
      const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
      const detail = r.kind === 'song'
        ? (sc.missing ? 'không gửi điểm' : `${sc.hit}/${r.total} nốt · ${sc.perfect} hoàn hảo · chuỗi ${sc.combo}`)
        : `đúng ${sc.right || 0}/${r.count}`;
      return `<div class="res-row ${pid === S.me.id ? 'me' : ''}"><span class="md">${medal}</span>
        <span class="who">${p ? INST[p.inst].icon : ''} ${esc(pid === S.me.id ? 'Bạn' : nm(pid))}<small>${detail}</small></span><b>${sc.score || 0}</b></div>`;
    }).join('');
    const title = r.kind === 'song' ? `🏆 ${esc(songById(r.song).name)}` : '👂 Đoán nốt';
    return `<div class="card-center"><h3>${title} — kết quả</h3><div class="res-list">${rows}</div>
      ${S.me.host ? `<div class="row center">${btn('close', 'Đóng', 'primary')}</div>` : ''}</div>`;
  }

  // ---------------------------------------------------------------- gợi ý thế bấm
  let hintKey = '';
  function currentTarget() {
    const r = R();
    if (r && r.kind === 'song' && contest && r.phase === 'play') return nextPending(contest, contestTime());
    if (lesson && !lesson.done) {
      if (lesson.mode === 'wait') return lesson.notes[lesson.idx] || null;
      return nextPending(lesson, lessonTime());
    }
    return null;
  }
  function howTo(m) {
    if (ui.inst === 'piano') {
      const code = Object.keys(PIANO_KEYS).find((k) => pianoBase() + PIANO_KEYS[k] === m);
      return `phím ${isBlack(m) ? 'đen' : 'trắng'} ${fullName(m)}${code ? ` — bàn phím <kbd>${keyLabel(code)}</kbd>` : ''}`;
    }
    if (ui.inst === 'sao') {
      const pat = PATTERN_OF[m % 12];
      if (!pat) return 'sáo Đô không thổi được nốt này (cần bịt nửa lỗ)';
      const dots = pat.split('').map((c) => (c === '1' ? '●' : '○'));
      const closed = pat.split('').map((c, i) => (c === '1' ? i + 1 : 0)).filter(Boolean);
      const lv = DIATONIC.indexOf(m % 12) - 1;   // -1 = Đô (Space)
      const key = lv < 0 ? (m >= 84 ? '<kbd>Shift</kbd>+<kbd>Space</kbd>' : '<kbd>Space</kbd>') : `<kbd>${keyLabel((m >= 84 ? HIGH_KEYS : LOW_KEYS)[lv] || '')}</kbd>`;
      return `<span class="fing">${dots.slice(0, 3).join('')} ${dots.slice(3).join('')}</span> ${closed.length ? `bịt lỗ ${closed.join(', ')}` : 'mở hết các lỗ'}${m >= 84 ? ' · <b>thổi mạnh</b>' : ''}${DIATONIC.includes(m % 12) ? ` — bàn phím ${key}` : ''}`;
    }
    const pos = violinPos(m);
    if (!pos) return 'ngoài tầm thế bấm 1';
    const s = STRINGS[pos.si];
    const fi = s.fingers.indexOf(pos.off);
    const keyHint = fi >= 0 ? ` — phím <kbd>${keyLabel(s.keys[fi])}</kbd>` : '';
    return `dây <b>${s.name}</b> · ${FINGER_NAME[pos.off]}${keyHint}`;
  }
  function updateHint() {
    if (!S || !SONGS.length) return;
    const n = currentTarget();
    let html;
    let target = null;
    if (n) {
      target = fit(n.m);
      html = `Nốt kế tiếp: <b class="nn" style="color:${LANE_COLORS[n.lane]}">${pcName(n.pc)}</b> — ${howTo(target)}`;
    } else if (lastPlayed !== null) {
      html = `Bạn vừa chơi: <b class="nn" style="color:${LANE_COLORS[LANE_OF_PC[lastPlayed % 12]]}">${pcName(lastPlayed % 12)}</b> ${fullName(lastPlayed)}`;
    } else {
      html = `<span class="gh-muted">${INST[ui.inst].icon} ${instTip()}</span>`;
    }
    const key = `${ui.inst}|${target}|${html}`;
    if (key === hintKey) return;
    hintKey = key;
    $('#hint').innerHTML = html;
    markHint(target);
  }
  function instTip() {
    if (ui.inst === 'piano') return 'Bấm phím đàn, hoặc dùng bàn phím: Z X C V B N M (Đô→Si), Q W E R T Y U I (quãng tám trên). Nút ◀ ▶ để dời quãng tám.';
    if (ui.inst === 'sao') return 'Space = Đô, giữ A S D J K L = Rê Mi Fa Sol La Si (chỉ cần giữ một phím). Hàng Q W E U I O và Shift+Space là quãng tám trên. Hoặc nhấn giữ nút nốt bên dưới.';
    return 'Mỗi hàng phím là một dây: 1–5 dây Mi, Q–T dây La, A–G dây Rê, Z–B dây Sol (dây buông → ngón 4). Shift = lên nửa cung.';
  }

  // ---------------------------------------------------------------- dựng nhạc cụ
  function buildInstrument() {
    releaseAll();
    const el = $('#instrument');
    el.className = 'instrument inst-' + ui.inst;
    if (ui.inst === 'piano') el.innerHTML = pianoHTML();
    else if (ui.inst === 'sao') el.innerHTML = saoHTML();
    else el.innerHTML = violinHTML();
    hintKey = '';
    refreshActive();
    updateHint();
    if (ui.inst === 'piano') {
      const c4 = el.querySelector('[data-m="60"]');
      const wrap = el.querySelector('.piano-wrap');
      if (c4 && wrap) wrap.scrollLeft = c4.offsetLeft - wrap.clientWidth / 2 + 160;
    }
  }

  function pianoHTML() {
    const I = INST.piano;
    const codeOf = {};
    Object.entries(PIANO_KEYS).forEach(([code, off]) => { const m = pianoBase() + off; if (!codeOf[m]) codeOf[m] = code; });
    let whites = '';
    let blacks = '';
    let wi = 0;
    for (let m = I.low; m <= I.high; m++) {
      const k = codeOf[m] ? `<i>${keyLabel(codeOf[m])}</i>` : '';
      if (isBlack(m)) {
        blacks += `<div class="pk black" data-m="${m}" style="left:calc(${wi} * var(--kw) - var(--bw) / 2)">${k}</div>`;
      } else {
        whites += `<div class="pk white ${m % 12 === 0 ? 'c' : ''}" data-m="${m}"><span>${noteName(m)}</span>${k}</div>`;
        wi++;
      }
    }
    return `<div class="inst-tools">${btn('oct-down', '◀', 'small ghost')}<span class="gh-muted">Bàn phím: quãng ${4 + ui.pianoOct}–${5 + ui.pianoOct}</span>${btn('oct-up', '▶', 'small ghost')}</div>
      <div class="piano-wrap"><div class="piano" style="--n:${wi}">${whites}${blacks}</div></div>`;
  }

  function saoHTML() {
    const holes = [0, 1, 2, 3, 4, 5].map((i) => {
      const k = `${keyLabel(LOW_KEYS[5 - i])}/${keyLabel(HIGH_KEYS[5 - i])}`;
      return `<button class="hole" data-hole="${i}" title="Lỗ ${i + 1} — phím ${k} mở lỗ này và các lỗ bên dưới"><i>${k}</i></button>`;
    });
    const quick = [0, 1].map((o) => `<div class="quick-row">${DIATONIC.map((pc) => `<button class="qn" data-q="${pc},${o}" style="--c:${LANE_COLORS[LANE_OF_PC[pc]]}">${pcName(pc)}${o ? '<sup>•</sup>' : ''}</button>`).join('')}</div>`).join('');
    return `<div class="flute-wrap"><div class="flute">
        <div class="mouth" title="Lỗ thổi"></div><div class="membrane" title="Lỗ màng"></div>
        <div class="holes"><div class="hand">${holes.slice(0, 3).join('')}</div><div class="hand">${holes.slice(3).join('')}</div></div>
        <div class="flute-end"></div></div>
        <div class="flute-now" id="flute-now"></div></div>
      <div class="flute-ctl">
        <button class="gh-btn blow" data-blow="1">💨 Thổi <small>(Space)</small></button>
        <button class="gh-btn strong" data-strong="1">⬆ Hơi mạnh <small>(Shift)</small></button>
        <span class="gh-muted small">Bấm vào lỗ để bịt/mở · lỗ 1–3 tay trái, 4–6 tay phải</span>
      </div>
      <div class="quick">${quick}<div class="gh-muted small">Nhấn giữ một nốt để tự đặt thế bấm và thổi (hàng dưới = thổi mạnh)</div></div>`;
  }

  function violinHTML() {
    const head = `<div class="vrow head"><span class="sname"></span>${[...Array(8).keys()].map((o) => `<span>${o === 0 ? 'buông' : ''}</span>`).join('')}</div>`;
    const rows = STRINGS.map((s) => `<div class="vrow"><span class="sname">${s.name}</span>${[...Array(8).keys()].map((o) => {
      const m = s.open + o;
      const fi = s.fingers.indexOf(o);
      return `<div class="vc ${fi >= 0 ? 'diat' : ''} ${o === 0 ? 'open' : ''}" data-m="${m}">
        <span class="nn">${noteName(m)}</span>${fi >= 0 ? `<em>${fi === 0 ? '0' : fi}</em><i>${keyLabel(s.keys[fi])}</i>` : ''}</div>`;
    }).join('')}</div>`).join('');
    return `<div class="violin"><div class="fb">${head}${rows}</div>
      <div class="gh-muted small">Ô có số là thế bấm cơ bản giọng Đô trưởng (0 = dây buông, 1–4 = ngón). Nhấn giữ để kéo vĩ, rê ngón sang ô khác để đổi nốt.</div></div>`;
  }

  function refreshActive() {
    const on = new Set([...held.values()].map((h) => h.m));
    document.querySelectorAll('#instrument [data-m]').forEach((el) => el.classList.toggle('on', on.has(Number(el.dataset.m))));
    if (ui.inst === 'sao') refreshFlute();
  }
  function markHint(target) {
    document.querySelectorAll('#instrument .hint').forEach((el) => el.classList.remove('hint'));
    if (target === null) return;
    if (ui.inst === 'sao') {
      const pat = PATTERN_OF[target % 12];
      if (pat) pat.split('').forEach((c, i) => { if (c === '1') { const h = document.querySelector(`#instrument [data-hole="${i}"]`); if (h) h.classList.add('hint'); } });
      const q = document.querySelector(`#instrument [data-q="${target % 12},${target >= 84 ? 1 : 0}"]`);
      if (q) q.classList.add('hint');
      if (target >= 84) { const s = document.querySelector('#instrument [data-strong]'); if (s) s.classList.add('hint'); }
      return;
    }
    let m = target;
    if (ui.inst === 'violin') {
      const pos = violinPos(m);
      if (!pos) return;
      m = STRINGS[pos.si].open + pos.off;
      const cell = document.querySelector(`#instrument .vrow:nth-child(${pos.si + 2}) .vc[data-m="${m}"]`);
      if (cell) cell.classList.add('hint');
      return;
    }
    const key = document.querySelector(`#instrument [data-m="${m}"]`);
    if (key) {
      key.classList.add('hint');
      const wrap = document.querySelector('#instrument .piano-wrap');
      if (wrap) {
        const x = key.offsetLeft;
        if (x < wrap.scrollLeft + 20 || x > wrap.scrollLeft + wrap.clientWidth - 60) wrap.scrollTo({ left: x - wrap.clientWidth / 2, behavior: 'smooth' });
      }
    }
  }

  // ---------------------------------------------------------------- sáo: thế bấm + hơi thổi
  function saoClosed() {
    if (sao.quick) return sao.quick.pat.split('').map((c) => c === '1');
    const lv = saoKeyLevel();
    if (lv >= 0) return [0, 1, 2, 3, 4, 5].map((i) => i < 5 - lv);
    if (sao.space) return [true, true, true, true, true, true];
    return [...sao.clicks];
  }
  // Phím xa nhất đang giữ (0 = A/Q … 5 = L/O), -1 nếu không giữ phím nào.
  const saoKeyLevel = () => Math.max(-1, ...[...sao.keys].map((k) => k % 6));
  const saoKeyHigh = () => [...sao.keys].some((k) => k >= 6);
  const saoStrong = () => {
    if (sao.quick) return sao.quick.strong;
    if (saoKeyLevel() >= 0) return saoKeyHigh() || sao.shift;
    return sao.shift || sao.strongLock;
  };
  const saoBlowing = () => !!sao.quick || sao.keys.size > 0 || sao.space || sao.btn;
  function saoPitch() {
    const pat = saoClosed().map((c) => (c ? '1' : '0')).join('');
    const pc = FINGERING[pat];
    return pc === undefined ? null : 72 + pc + (saoStrong() ? 12 : 0);
  }
  function saoUpdate() {
    const want = saoBlowing() ? saoPitch() : undefined;   // undefined = không thổi, null = thế bấm sai
    const cur = held.get('sao');
    const hissing = sao.sound && sao.sound.hiss;
    if (want === undefined) {
      noteOff('sao');
      if (hissing) { sao.sound.hiss.stop(); sao.sound = null; }
    } else if (want === null) {
      noteOff('sao');
      if (!hissing) sao.sound = { hiss: Synth.hiss() };
    } else {
      if (hissing) { sao.sound.hiss.stop(); sao.sound = null; }
      if (!cur || cur.m !== want) noteOn('sao', want);
    }
    refreshFlute();
  }
  function refreshFlute() {
    const closed = saoClosed();
    document.querySelectorAll('#instrument [data-hole]').forEach((el) => el.classList.toggle('closed', closed[Number(el.dataset.hole)]));
    const blow = document.querySelector('#instrument [data-blow]');
    if (blow) blow.classList.toggle('active', saoBlowing());
    const strong = document.querySelector('#instrument [data-strong]');
    if (strong) strong.classList.toggle('active', saoStrong());
    const now = document.getElementById('flute-now');
    if (now) {
      const p = saoPitch();
      const blowing = saoBlowing();
      now.innerHTML = p === null
        ? '<span class="bad">Thế bấm chưa đúng</span>'
        : `<span style="color:${LANE_COLORS[LANE_OF_PC[p % 12]]}">${pcName(p % 12)}${p >= 84 ? '<sup>•</sup>' : ''}</span><small>${blowing ? '♪ đang thổi' : 'thế bấm hiện tại'}</small>`;
      now.classList.toggle('blowing', blowing);
    }
  }

  // ---------------------------------------------------------------- màn hình (canvas)
  const cv = $('#view');
  const ctx = cv.getContext('2d');
  let W = 0;
  let H = 0;
  function resize() {
    const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(cv); else window.addEventListener('resize', resize);

  function roundRect(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function drawHighway(run, t, { wait = false } = {}) {
    const lanes = 7;
    const lw = W / lanes;
    const hitY = H - 44;
    const pps = Math.max(110, Math.min(200, H * 0.6));   // thời gian nốt đã tính theo tốc độ bài
    const now = performance.now();
    // làn
    for (let i = 0; i < lanes; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.025)' : 'rgba(255,255,255,.05)';
      ctx.fillRect(i * lw, 0, lw, H);
      const f = Math.max(0, 1 - (now - flash[i]) / 260);
      if (f > 0) {
        const g = ctx.createLinearGradient(0, hitY, 0, 0);
        g.addColorStop(0, LANE_COLORS[i] + '88'); g.addColorStop(1, 'transparent');
        ctx.globalAlpha = f; ctx.fillStyle = g; ctx.fillRect(i * lw, 0, lw, hitY); ctx.globalAlpha = 1;
      }
      const wf = Math.max(0, 1 - (now - wrongFlash[i]) / 300);
      if (wf > 0) { ctx.globalAlpha = wf * 0.35; ctx.fillStyle = '#ff3b4f'; ctx.fillRect(i * lw, hitY - 60, lw, 80); ctx.globalAlpha = 1; }
    }
    // vạch nhịp
    if (run.spb && !wait) {
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
      const first = Math.ceil(t / run.spb) * run.spb;
      for (let bt = first; (bt - t) * pps < hitY; bt += run.spb) {
        const y = hitY - (bt - t) * pps;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
    }
    // nốt
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const target = wait ? run.notes[run.idx] : nextPending(run, t);
    run.notes.forEach((n) => {
      const yb = hitY - (n.t - t) * pps;
      const h = Math.max(16, n.d * pps - 5);
      if (yb < -10 || yb - h > H) return;
      if (n.st === 1 || n.st === 2) {
        if (t - n.t > 0.35) return;   // vừa trúng: loé lên rồi biến mất
        ctx.globalAlpha = Math.max(0, 1 - (t - n.t) / 0.35);
      } else if (n.st === -1) ctx.globalAlpha = 0.25;
      const x = n.lane * lw + 5;
      ctx.fillStyle = LANE_COLORS[n.lane];
      roundRect(x, yb - h, lw - 10, h, 7); ctx.fill();
      if (n === target) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke(); }
      if (h >= 16) {
        ctx.fillStyle = 'rgba(0,0,0,.72)';
        ctx.font = `800 ${Math.min(15, lw / 4)}px system-ui, sans-serif`;
        ctx.fillText(pcName(n.pc), x + (lw - 10) / 2, yb - Math.min(h, 22) / 2 - 1);
      }
      ctx.globalAlpha = 1;
    });
    // vạch đánh + nhãn làn
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(0, hitY, W, 3);
    for (let i = 0; i < lanes; i++) {
      const pressed = now - flash[i] < 160;
      ctx.fillStyle = pressed ? LANE_COLORS[i] : 'rgba(0,0,0,.45)';
      roundRect(i * lw + 4, hitY + 8, lw - 8, 30, 8); ctx.fill();
      ctx.fillStyle = pressed ? '#111' : LANE_COLORS[i];
      ctx.font = `800 ${Math.min(15, lw / 4)}px system-ui, sans-serif`;
      ctx.fillText(pcName(DIATONIC[i]), i * lw + lw / 2, hitY + 23);
    }
    // chữ phản hồi
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      const age = (now - p.at) / 700;
      if (age >= 1) { pops.splice(i, 1); continue; }
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = p.cls === 'perfect' ? '#ffe27a' : p.cls === 'good' ? '#8ef0c0' : '#ff8a96';
      ctx.font = '900 16px system-ui, sans-serif';
      ctx.fillText(p.text, p.lane * lw + lw / 2, hitY - 24 - age * 30);
      ctx.globalAlpha = 1;
    }
    // điểm, chuỗi
    ctx.textAlign = 'left';
    ctx.font = '800 15px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    if (wait) ctx.fillText(`Nốt ${Math.min(run.idx + 1, run.notes.length)}/${run.notes.length}${run.mistakes ? ` · sai ${run.mistakes}` : ''}`, 12, 20);
    else if (!run.auto) {
      ctx.fillText(`Điểm ${run.score}`, 12, 20);
      if (run.combo >= 3) { ctx.fillStyle = '#ffe27a'; ctx.fillText(`Chuỗi ×${run.combo}`, 12, 40); }
    }
    // đếm ngược
    if (!wait && t < 0) {
      ctx.textAlign = 'center';
      ctx.font = '900 64px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.fillText(String(Math.ceil(-t)), W / 2, H / 2 - 20);
    }
    // thanh tiến độ
    const prog = wait ? run.idx / run.notes.length : Math.max(0, Math.min(1, t / run.end));
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(0, 0, W, 3);
    ctx.fillStyle = '#8b7bff'; ctx.fillRect(0, 0, W * prog, 3);
  }

  // Khuông nhạc khoá Sol với các nốt vừa chơi (phòng tập).
  function drawStaff() {
    const gap = Math.max(10, Math.min(15, H / 16));
    const bottom = H / 2 + gap * 2;       // dòng kẻ dưới cùng = Mi4
    const left = 70;
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.3;
    for (let i = 0; i < 5; i++) { const y = bottom - i * gap; ctx.beginPath(); ctx.moveTo(14, y); ctx.lineTo(W - 14, y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = `${gap * 6.2}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('𝄞', 40, bottom + gap * 1.15);
    const now = performance.now();
    const shown = staff.slice(-Math.max(4, Math.floor((W - left - 20) / 44)));
    shown.forEach((s, i) => {
      let m = s.m;
      let ott = false;
      if (m >= 86) { m -= 12; ott = true; }
      const pc = m % 12;
      const nat = isBlack(m) ? pc - 1 : pc;
      const step = (Math.floor(m / 12) - 1) * 7 + DIATONIC.indexOf(nat);
      const pos = step - 30;            // 0 = Mi4 (dòng dưới cùng)
      const x = left + 30 + i * 44;
      const y = bottom - pos * gap / 2;
      const age = Math.min(1, (now - s.at) / 300);
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      for (let p = -2; p >= pos; p -= 2) { const ly = bottom - p * gap / 2; ctx.beginPath(); ctx.moveTo(x - 13, ly); ctx.lineTo(x + 13, ly); ctx.stroke(); }
      for (let p = 10; p <= pos; p += 2) { const ly = bottom - p * gap / 2; ctx.beginPath(); ctx.moveTo(x - 13, ly); ctx.lineTo(x + 13, ly); ctx.stroke(); }
      const color = LANE_COLORS[LANE_OF_PC[pc]];
      ctx.save();
      ctx.translate(x, y); ctx.rotate(-0.35);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(0, 0, gap * 0.62 * (0.6 + 0.4 * age), gap * 0.44, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = color; ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (pos < 4) { ctx.moveTo(x + gap * 0.55, y); ctx.lineTo(x + gap * 0.55, y - gap * 3.2); } else { ctx.moveTo(x - gap * 0.55, y); ctx.lineTo(x - gap * 0.55, y + gap * 3.2); }
      ctx.stroke();
      ctx.font = '700 15px serif'; ctx.fillStyle = color; ctx.textAlign = 'center';
      if (isBlack(m)) ctx.fillText('♯', x - gap * 1.2, y + 5);
      if (ott) { ctx.font = '700 10px system-ui'; ctx.fillText('8va', x, y - gap * 3.6); }
      ctx.font = '700 12px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.fillText(pcName(s.m % 12), x, H - 12);
    });
    if (!staff.length) {
      ctx.font = '600 14px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.textAlign = 'center';
      ctx.fillText('Chơi vài nốt — chúng sẽ hiện trên khuông nhạc này', W / 2 + 20, 24);
    }
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!S || !SONGS.length) return;
    if (!W) resize();
    ctx.clearRect(0, 0, W, H);
    const r = R();
    contestStep();
    if (r && r.kind === 'song' && contest) {
      if (r.phase === 'result') return;
      drawHighway(contest, contestTime());
    } else if (r && r.kind === 'ear') {
      drawStaffDim();
    } else if (lesson) {
      const L = lesson;
      if (L.mode === 'wait') {
        const n = L.notes[L.idx] || L.notes[L.notes.length - 1];
        const target = L.idx >= L.notes.length ? n.t + 0.5 : n.t;
        L.waitT += (target - L.waitT) * 0.15;
        drawHighway(L, L.waitT, { wait: true });
      } else {
        const t = lessonTime();
        if (t < 0) {
          const beat = Math.ceil(-t / L.spb);
          if (beat <= 4 && beat !== L.lastTick) { L.lastTick = beat; Synth.tick(beat === 4); }
        }
        if (L.auto) {
          L.notes.forEach((n) => {
            if (!n.st && t >= n.t) { n.st = 1; Synth.play(ui.inst, fit(n.m), n.d * 0.92); flash[n.lane] = performance.now(); lastPlayed = fit(n.m); }
          });
        } else if (!L.done) sweepMisses(L, t);
        if (!L.done) {
          drawHighway(L, t);
          if (!L.auto) reportProgress(L.judged / L.notes.length * 100);
          if (t > L.end + GOOD + 0.4) finishLesson();
        }
        updateHint();
      }
    } else {
      drawStaff();
    }
    if (r && r.kind === 'song' && r.phase === 'play') updateHint();
  }
  function drawStaffDim() { ctx.globalAlpha = 0.25; drawStaff(); ctx.globalAlpha = 1; }

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
    let html = `<div class="pmenu-head">${me ? '🙋 Bạn' : esc(p.name)} · ${INST[p.inst].icon} ${INST[p.inst].name}</div>
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

  function renderBoard() {
    const ps = [...S.players].sort((a, b) => b.wins - a.wins || b.stars - a.stars);
    const table = ps.map((p) => `<div class="brow ${p.id === S.me.id ? 'me' : ''}"><span>${INST[p.inst].icon} ${esc(p.id === S.me.id ? 'Bạn' : p.name)}</span>
      <span>⭐ ${p.stars}</span><span>🏆 ${p.wins}</span></div>`).join('');
    const hist = [...S.history].reverse().map((h) => `<div class="hist"><div class="hh"><span class="lt">${fmtTime(h.t)}</span>
      ${h.kind === 'song' ? '🏆' : '👂'} <b>${esc(h.title)}</b></div>
      ${h.rows.slice(0, 5).map((x, i) => `<div class="hr">${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ${INST[x.inst].icon} ${esc(x.name)} <b>${x.score}</b></div>`).join('')}</div>`).join('');
    setHTML($('#board-list'), `<h4>Cả phòng</h4>${table}<h4>Các lượt thi</h4>${hist || '<div class="empty-note">Chưa có lượt thi nào.</div>'}`);
  }

  function renderRules(games) {
    const g = games.find((x) => x.id === 'nhaccu');
    if (!g) return;
    const fmt = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    $('#rules').innerHTML = g.guide.map((s) => `<h4>${fmt(s.title)}</h4>${Array.isArray(s.body)
      ? `<ul>${s.body.map((li) => `<li>${fmt(li)}</li>`).join('')}</ul>` : `<p>${fmt(s.body)}</p>`}`).join('');
  }

  // ---------------------------------------------------------------- đồng hồ
  function tick() {
    const timer = $('#timer');
    const fill = $('#timebar-fill');
    if (!S || !S.deadline) { timer.hidden = true; fill.style.width = '0'; return; }
    const remaining = Math.max(0, S.deadline - serverNow());
    const secs = Math.ceil(remaining);
    timer.hidden = false;
    timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    fill.style.width = `${S.total ? Math.min(1, remaining / S.total) * 100 : 0}%`;
    const r = R();
    if (r && r.kind === 'ear' && r.phase === 'question') renderOverlay();
  }
  setInterval(tick, 250);

  // ---------------------------------------------------------------- nhập liệu: chuột / cảm ứng
  const pads = new Map();   // pointerId → phần tử đang giữ
  const instEl = $('#instrument');
  function padPress(id, el) {
    pads.set(id, el);
    noteOn('p' + id, Number(el.dataset.m));
  }
  instEl.addEventListener('pointerdown', (e) => {
    Synth.unlock();
    const pad = e.target.closest('[data-m]');
    if (pad) {
      e.preventDefault();
      if (e.target.hasPointerCapture && e.target.hasPointerCapture(e.pointerId)) e.target.releasePointerCapture(e.pointerId);
      padPress(e.pointerId, pad);
      return;
    }
    const hole = e.target.closest('[data-hole]');
    if (hole) { e.preventDefault(); const i = Number(hole.dataset.hole); sao.clicks[i] = !sao.clicks[i]; saoUpdate(); return; }
    if (e.target.closest('[data-blow]')) { e.preventDefault(); sao.btn = true; pads.set(e.pointerId, 'blow'); saoUpdate(); return; }
    if (e.target.closest('[data-strong]')) { e.preventDefault(); sao.strongLock = !sao.strongLock; saoUpdate(); return; }
    const q = e.target.closest('[data-q]');
    if (q) {
      e.preventDefault();
      const [pc, o] = q.dataset.q.split(',').map(Number);
      sao.quick = { pat: PATTERN_OF[pc], strong: o === 1 };
      pads.set(e.pointerId, 'quick');
      saoUpdate();
    }
  });
  instEl.addEventListener('pointerover', (e) => {
    const cur = pads.get(e.pointerId);
    if (!cur || typeof cur === 'string') return;
    const pad = e.target.closest('[data-m]');
    if (pad && pad !== cur) padPress(e.pointerId, pad);
  });
  function pointerEnd(e) {
    const cur = pads.get(e.pointerId);
    if (!cur) return;
    pads.delete(e.pointerId);
    if (cur === 'blow') { sao.btn = false; saoUpdate(); } else if (cur === 'quick') { sao.quick = null; saoUpdate(); } else noteOff('p' + e.pointerId);
  }
  window.addEventListener('pointerup', pointerEnd);
  window.addEventListener('pointercancel', pointerEnd);
  instEl.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------------------------------------------------------------- nhập liệu: bàn phím
  const typing = (e) => e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
  document.addEventListener('keydown', (e) => {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      if (ui.inst === 'sao') { sao.shift = true; saoUpdate(); }
      return;
    }
    if (e.repeat) { if (e.code === 'Space' || PIANO_KEYS[e.code] !== undefined || VIOLIN_KEYS[e.code]) e.preventDefault(); return; }
    Synth.unlock();
    if (ui.inst === 'piano') {
      const off = PIANO_KEYS[e.code];
      if (off === undefined) return;
      e.preventDefault();
      noteOn('k' + e.code, pianoBase() + off);
    } else if (ui.inst === 'violin') {
      const v = VIOLIN_KEYS[e.code];
      if (!v) return;
      e.preventDefault();
      const s = STRINGS[v[0]];
      noteOn('k' + e.code, s.open + s.fingers[v[1]] + (e.shiftKey ? 1 : 0));
    } else {
      const lo = LOW_KEYS.indexOf(e.code);
      const hi = HIGH_KEYS.indexOf(e.code);
      if (lo >= 0 || hi >= 0) { e.preventDefault(); sao.keys.add(lo >= 0 ? lo : 6 + hi); saoUpdate(); return; }
      if (e.code === 'Space') { e.preventDefault(); sao.space = true; saoUpdate(); }
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { if (sao.shift) { sao.shift = false; saoUpdate(); } return; }
    if (held.has('k' + e.code)) { noteOff('k' + e.code); return; }
    if (ui.inst !== 'sao') return;
    const lo = LOW_KEYS.indexOf(e.code);
    const hi = HIGH_KEYS.indexOf(e.code);
    if (lo >= 0 || hi >= 0) { sao.keys.delete(lo >= 0 ? lo : 6 + hi); saoUpdate(); } else if (e.code === 'Space') { sao.space = false; saoUpdate(); }
  });
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  // ---------------------------------------------------------------- các nút
  const inviteLink = () => `${ui.lanBase || location.origin}/g/nhaccu/?room=${ROOM}`;
  function setMode(mode) {
    if (roundLive() && inRound() && mode !== 'contest') { P.toast('Đang trong lượt thi — chờ lượt thi kết thúc nhé!', 'error'); return; }
    if (mode !== 'lesson' && lesson) stopLesson();
    ui.mode = mode;
    render();
  }

  document.addEventListener('click', async (e) => {
    const modeEl = e.target.closest('[data-mode]');
    if (modeEl) { setMode(modeEl.dataset.mode); return; }
    const instOpt = e.target.closest('[data-inst]');
    if (instOpt) {
      ui.inst = instOpt.dataset.inst;
      try { localStorage.setItem('nc_inst', ui.inst); } catch (err) { /* bỏ qua */ }
      send('inst', { inst: ui.inst });
      Synth.unlock();
      buildInstrument();
      renderInsts();
      return;
    }
    const pick = (attr, key) => { const el = e.target.closest(`[data-${attr}]`); if (!el) return false; ui[key] = el.dataset[attr]; renderPanel(); return true; };
    if (pick('lsong', 'lessonSong') || pick('csong', 'contestSong') || pick('lmode', 'lessonMode') || pick('elevel', 'earLevel')) return;
    const num = (attr, key) => { const el = e.target.closest(`[data-${attr}]`); if (!el) return false; ui[key] = Number(el.dataset[attr]); renderPanel(); return true; };
    if (num('lspeed', 'lessonSpeed') || num('cspeed', 'contestSpeed') || num('ecount', 'earCount')) return;

    const pcEl = e.target.closest('[data-pc]');
    if (pcEl) { const pc = Number(pcEl.dataset.pc); Synth.play(ui.inst, fit(60 + pc), 0.4); earPlayed(pc); renderOverlay(); return; }

    const actEl = e.target.closest('[data-act]');
    if (actEl && !actEl.disabled && actEl.dataset.act) {
      switch (actEl.dataset.act) {
        case 'lesson-start': startLesson(false); break;
        case 'lesson-demo': startLesson(true); break;
        case 'lesson-stop': stopLesson(); break;
        case 'lesson-again': startLesson(false); break;
        case 'lesson-close': lesson = null; render(); break;
        case 'start-song': Synth.unlock(); send('start_song', { song: ui.contestSong, speed: ui.contestSpeed }); break;
        case 'start-ear': Synth.unlock(); send('start_ear', { level: ui.earLevel, count: ui.earCount }); break;
        case 'close': send('close'); break;
        case 'ear-replay': replayEar(); break;
        case 'oct-down': ui.pianoOct = Math.max(-1, ui.pianoOct - 1); buildInstrument(); break;
        case 'oct-up': ui.pianoOct = Math.min(1, ui.pianoOct + 1); buildInstrument(); break;
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
    try { localStorage.setItem('nc_sound', ui.sound ? '1' : '0'); } catch (e) { /* bỏ qua */ }
    if (!ui.sound) remote.forEach((x) => { x.v.stop(); clearTimeout(x.timer); });
    if (!ui.sound) remote.clear();
    P.toast(ui.sound ? 'Đang nghe mọi người cùng chơi' : 'Đã tắt tiếng của người khác', 'info', 1800);
    renderTop();
  });
  $('#btn-names').addEventListener('click', () => {
    ui.names = ui.names === 'letter' ? 'solfa' : 'letter';
    try { localStorage.setItem('nc_names', ui.names); } catch (e) { /* bỏ qua */ }
    htmlCache.clear();
    buildInstrument();
    render();
  });
  $('#btn-room').addEventListener('click', async () => {
    if (await P.copy(inviteLink())) P.toast('Đã sao chép link mời!', 'good');
  });
  $('#btn-leave').addEventListener('click', () => {
    if (conn) conn.leave();
    setTimeout(() => { location.href = '/'; }, 150);
  });

  // Nếu mở bằng localhost thì link mời dùng địa chỉ LAN để bạn bè vào được.
  fetch('/api/info').then((r) => r.json()).then((inf) => {
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
    const lan = location.protocol === 'https:' ? inf.https : inf.urls;
    if (local && lan && lan.length) ui.lanBase = lan[0];
  }).catch(() => {});
  fetch('/api/games').then((r) => r.json()).then(renderRules).catch(() => {});

  $('#room-code').textContent = ROOM;
  fetch('songs.json').then((r) => r.json()).then((songs) => {
    SONGS = songs;
    if (S) buildInstrument();
    render();
  }).catch(() => P.toast('Không tải được danh sách bài — hãy tải lại trang.', 'error', 8000));
  requestAnimationFrame(frame);
  P.ensureName(() => connect());
})();
