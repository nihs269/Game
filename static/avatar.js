/* Nhân vật chibi dùng chung cho mọi game: vẽ SVG nhiều lớp (da, tóc, trang phục,
 * quần, giày, phụ kiện) + trình tạo nhân vật. Ngoại hình lưu ở localStorage
 * và gửi lên máy chủ khi vào phòng. */
(function () {
  const OPT = {
    skin: ['#ffe0c4', '#f6c9a0', '#e3aa7c', '#c68652', '#915d38', '#5e3b24'],
    hair: ['short', 'spiky', 'long', 'bob', 'ponytail', 'bun', 'curly', 'mohawk', 'bald'],
    hairColor: ['#2b1b12', '#5a3825', '#9c5a2e', '#d9a55b', '#f3dc92', '#c0392b', '#ff6fae', '#7b61ff', '#1fbf8f', '#e8edf2'],
    outfit: ['tshirt', 'hoodie', 'dress', 'suit', 'robe', 'overall'],
    outfitColor: ['#e74c3c', '#ff8a3d', '#f6c945', '#35c46a', '#1abc9c', '#3b8cff', '#8e5cf7', '#34495e', '#f2f2f2', '#ff79b0'],
    pants: ['#2d3436', '#40506a', '#1e6fd9', '#6c5ce7', '#b2bec3', '#8d6e63', '#0f8b6d'],
    shoes: ['sneaker', 'boot', 'sandal', 'formal'],
    shoeColor: ['#ffffff', '#2d3436', '#e03e3e', '#2f7cf6', '#f7c948', '#7a4a2e'],
    acc: ['none', 'glasses', 'sunglasses', 'crown', 'flower', 'headband'],
    accColor: ['#e74c3c', '#ff8a3d', '#f6c945', '#35c46a', '#3b8cff', '#8e5cf7', '#2d3436', '#ff79b0'],
  };
  const LABELS = {
    hair: { short: 'Ngắn', spiky: 'Dựng', long: 'Dài', bob: 'Bob', ponytail: 'Đuôi ngựa', bun: 'Búi', curly: 'Xoăn', mohawk: 'Mohawk', bald: 'Trọc' },
    outfit: { tshirt: 'Áo thun', hoodie: 'Hoodie', dress: 'Váy', suit: 'Vest', robe: 'Áo choàng', overall: 'Yếm' },
    shoes: { sneaker: 'Sneaker', boot: 'Bốt', sandal: 'Dép', formal: 'Giày tây' },
    acc: { none: 'Không', glasses: 'Kính', sunglasses: 'Kính râm', crown: 'Vương miện', flower: 'Hoa cài', headband: 'Băng đô' },
  };
  const CATS = [
    ['hair', 'Kiểu tóc', 'style'], ['hairColor', 'Màu tóc', 'color'], ['skin', 'Màu da', 'color'],
    ['outfit', 'Trang phục', 'style'], ['outfitColor', 'Màu áo', 'color'], ['pants', 'Màu quần', 'color'],
    ['shoes', 'Giày dép', 'style'], ['shoeColor', 'Màu giày', 'color'], ['acc', 'Phụ kiện', 'style'], ['accColor', 'Màu phụ kiện', 'color'],
  ];

  // ---------------------------------------------------------------- ngẫu nhiên có hạt giống
  function hash(str) {
    let h = 1779033703;
    for (const ch of String(str)) { h = Math.imul(h ^ ch.codePointAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = hash(seed);
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function random(seed) {
    const r = seed != null ? rng(seed) : Math.random;
    const look = {};
    Object.keys(OPT).forEach((k) => { look[k] = OPT[k][Math.floor(r() * OPT[k].length)]; });
    if (r() < 0.45) look.acc = 'none';
    return look;
  }
  function sanitize(look, seed) {
    const base = random(seed != null ? seed : 'default');
    const out = {};
    Object.keys(OPT).forEach((k) => { out[k] = look && OPT[k].includes(look[k]) ? look[k] : base[k]; });
    return out;
  }

  // ---------------------------------------------------------------- các bộ phận (ảnh chibi trong static/chibi)
  // Mỗi bộ phận là một ảnh xám, tô màu bằng bộ lọc SVG. Khung hình giữ như cũ để các game cắt ghép không lệch:
  // viewBox 0 -16 100 166, bàn chân ở y≈141, vai ở y≈76.
  // PART[tên] = [x, y, rộng, cao, màu tô (khoá trong look)]
  const PART = {"head":[12.9,0.7,74.0,71.5,"skin"],"body":[30.9,71.7,38.5,62.0,"skin"],"torso":[39.4,71.7,21.5,36.0,"skin"],"feet":[30.4,133.7,39.0,7.5,"skin"],"neck-long":[43.9,68.7,12.5,15.5,"skin"],"body-slim":[30.9,71.7,38.0,62.0,"skin"],"arm-l":[20.9,85.7,16.0,28.0,"skin"],"arm-r":[63.4,85.7,16.0,28.0,"skin"],"neck":[41.9,71.7,16.0,4.5,"skin"],"legs":[31.9,125.7,36.5,8.0,"skin"],"hand-l":[20.9,102.2,12.0,11.5,"skin"],"hand-r":[67.4,102.2,12.0,11.5,"skin"],"hair-short-front":[9.9,-5.3,80.0,56.0,"hairColor"],"hair-short-back":[13.9,-4.3,72.0,55.5,"hairColor"],"hair-spiky-front":[8.9,-7.3,82.0,56.0,"hairColor"],"hair-spiky-back":[7.9,-7.3,84.0,68.5,"hairColor"],"hair-long-front":[12.9,-4.3,74.0,98.0,"hairColor"],"hair-long-back":[10.4,-3.3,79.0,109.5,"hairColor"],"hair-bob-front":[10.4,-3.3,79.0,58.0,"hairColor"],"hair-bob-back":[8.9,-4.3,82.0,60.5,"hairColor"],"hair-ponytail-front":[12.9,-13.3,93.0,76.0,"hairColor"],"hair-bun-front":[10.9,-13.3,78.0,68.0,"hairColor"],"hair-bun-back":[12.9,-15.3,74.0,75.5,"hairColor"],"hair-curly-front":[6.9,-7.3,86.0,63.0,"hairColor"],"hair-curly-back":[4.9,-5.3,90.0,63.0,"hairColor"],"hair-mohawk-front":[13.9,-11.3,72.0,58.5,"hairColor"],"hair-mohawk-back":[13.9,-11.3,72.0,71.0,"hairColor"],"hair-bald-front":[31.9,7.7,12.5,6.0],"acc-sunglasses":[24.9,39.7,50.0,19.5,"accColor"],"acc-sunglasses-lens":[29.9,43.2,40.0,13.5],"acc-crown":[30.9,-18.3,38.0,27.0,"accColor"],"acc-flower":[18.9,7.7,20.0,15.0,"accColor"],"acc-headband":[13.9,-3.3,72.0,42.0,"accColor"],"face-eyes-open":[31.9,41.2,36.0,15.0],"face-eyes-angry":[33.4,43.7,33.0,13.0],"face-mouth-smile":[45.4,58.2,9.0,6.0],"face-mouth-open":[47.9,59.2,4.0,4.0],"face-mouth-sad":[47.4,59.7,5.0,2.0],"face-tears":[36.9,52.7,26.0,7.5],"outfit-tshirt":[30.4,73.2,39.0,41.0,"outfitColor"],"outfit-tshirt-back":[42.4,73.2,15.0,6.0,"outfitColor"],"outfit-tshirt-sl":[26.4,73.7,14.5,20.5,"outfitColor"],"outfit-tshirt-sr":[59.4,74.2,14.0,20.0,"outfitColor"],"outfit-hoodie":[31.4,72.7,37.0,45.5,"outfitColor"],"outfit-hoodie-back":[41.4,72.7,17.0,11.0,"outfitColor"],"outfit-hoodie-sl":[24.9,72.7,16.5,41.5,"outfitColor"],"outfit-hoodie-sr":[58.9,72.7,16.0,41.5,"outfitColor"],"outfit-overall":[28.9,72.7,42.0,57.0,"outfitColor"],"outfit-overall-sl":[26.9,73.2,14.0,21.0,"outfitColor"],"outfit-overall-sr":[59.4,73.2,13.5,21.0,"outfitColor"],"outfit-dress":[21.9,73.2,56.0,62.0,"outfitColor"],"outfit-dress-sl":[27.4,73.7,13.5,18.5,"outfitColor"],"outfit-dress-sr":[59.4,74.2,13.0,18.0,"outfitColor"],"outfit-robe":[23.9,73.2,52.0,64.5,"outfitColor"],"outfit-robe-back":[40.4,72.7,19.0,9.0,"outfitColor"],"outfit-robe-sl":[22.9,77.2,15.0,34.5,"outfitColor"],"outfit-robe-sr":[61.9,77.2,15.0,34.5,"outfitColor"],"outfit-suit":[26.9,73.7,46.0,61.0,"outfitColor"],"outfit-suit-back":[43.9,73.2,12.0,5.5,"outfitColor"],"outfit-suit-sl":[24.4,77.7,13.5,26.0,"outfitColor"],"outfit-suit-sr":[61.9,77.7,13.5,26.0,"outfitColor"],"pants-shorts":[30.9,103.7,38.0,29.0,"pants"],"shoes-sneaker":[27.9,124.2,43.5,18.5,"shoeColor"],"shoes-sneaker-low":[27.9,131.7,43.5,11.0,"shoeColor"],"shoes-boot":[27.9,118.2,43.5,24.5,"shoeColor"],"shoes-boot-low":[27.9,131.7,43.5,11.0,"shoeColor"],"shoes-formal":[27.9,122.7,44.0,20.0,"shoeColor"],"shoes-formal-low":[27.9,131.7,44.0,11.0,"shoeColor"],"shoes-sandal":[29.4,118.7,41.0,24.0,"shoeColor"],"shoes-sandal-low":[29.4,131.7,41.0,11.0,"shoeColor"]};
  const DIR = (() => {
    const s = document.currentScript && document.currentScript.src;
    return s ? new URL('chibi/', s).href : '/static/chibi/';
  })();
  const VER = '261111095326';   // đổi mỗi lần dựng lại ảnh -> trình duyệt tải ảnh mới
  const DATA = {};           // tên -> data URI (dùng khi game vẽ hình lên canvas)
  const TALL_HATS = ['crown'];
  // Mũ trùm đầu: giấu phần tóc nằm trên mép dưới của mũ để tóc không chọc xuyên mũ.
  const HAT_MASK = {};
  // Áo dài tay: chỉ vẽ bàn tay, dời tới cổ tay áo (đơn vị hình, tay trái; tay phải lật dấu x).
  const NECK_DROP = { tshirt: 3, hoodie: 6, suit: 2.5, robe: 5 };   // hạ đầu xuống để cổ chui vào cổ áo
  const HAND = { hoodie: [2.5, 8], suit: [0.8, -1.5], robe: [2.0, 0.5] };
  let uid = 0;
  // Kính tròn: vẽ vector, mỗi tròng ôm trọn một mắt (tâm mắt x 39.3 / 60.4, y 47.4).
  function glasses(c) {
    const ring = (x) => `<circle cx="${x}" cy="47.4" r="8.7"/>`;
    const shape = `${ring(39.3)}${ring(60.4)}<path d="M47.6 45.6 Q49.85 43.9 52.1 45.6 M30.7 46.2 H28.6 M69 46.2 H71.1"/>`;
    return `<g fill="none" stroke-linecap="round">
      <g fill="#fff" fill-opacity=".14" stroke="none">${ring(39.3)}${ring(60.4)}</g>
      <path d="M33.6 43.6 A6.6 6.6 0 0 1 37.6 40.9 M54.7 43.6 A6.6 6.6 0 0 1 58.7 40.9" stroke="#fff" stroke-opacity=".75" stroke-width=".9"/>
      <g stroke="#3a2a22" stroke-width="2.5">${shape}</g><g stroke="${c}" stroke-width="1.3">${shape}</g></g>`;
  }

  function tintFilter(fid, hex) {
    const n = parseInt(hex.slice(1), 16);
    const k = (c) => (c / 255 / 0.85).toFixed(3);
    return `<filter id="${fid}" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${k(n >> 16)} 0 0 0 0 0 ${k((n >> 8) & 255)} 0 0 0 0 0 ${k(n & 255)} 0 0 0 0 0 1 0"/></filter>`;
  }

  function svg(look, opts = {}) {
    const L = sanitize(look, opts.seed);
    const id = 'a' + (++uid);
    const used = new Set();
    const img = (name, attrs = '') => {
      const p = PART[name];
      if (!p) return '';
      const src = (opts.inline && DATA[name]) || DIR + name + '.webp?v=' + VER;
      let f = '';
      if (p[4]) { used.add(p[4]); f = ` filter="url(#${id}${p[4]})"`; }
      return `<image href="${src}" x="${p[0]}" y="${p[1]}" width="${p[2]}" height="${p[3]}" preserveAspectRatio="none"${f}${attrs}/>`;
    };
    const hm = HAT_MASK[L.acc];
    const clip = hm ? ` mask="url(#${id}hm)"` : '';
    const hairBack = PART[`hair-${L.hair}-back`] ? `<g${clip}>${img(`hair-${L.hair}-back`)}</g>` : '';
    const hairFront = PART[`hair-${L.hair}-front`] ? `<g${clip}>${img(`hair-${L.hair}-front`)}</g>` : '';
    const o = L.outfit;
    const hand = HAND[o];
    const drop = opts.head ? 0 : (NECK_DROP[o] || 0);
    const arm = (s) => `<g class="av-arm av-arm-${s}">${hand
      ? `<g transform="translate(${s === 'l' ? hand[0] : -hand[0]} ${hand[1]})">${img('hand-' + s)}</g>` : img('arm-' + s)}${img(`outfit-${o}-s${s}`)}<g class="av-hold"></g></g>`;
    const body = opts.head ? '' : `
      <g class="av-seat"><rect x="17" y="113" width="66" height="15" rx="7.5" fill="#7a5230" stroke="#3a2a22" stroke-width="1.4"/><ellipse cx="18" cy="120.5" rx="4.5" ry="7.5" fill="#b07a4c" stroke="#3a2a22" stroke-width="1.2"/><path d="M28 118h20M52 123h22" stroke="#5c3b20" stroke-width="1.4"/></g>
      <g transform="translate(0 ${drop})">${hairBack}</g>${PART[`outfit-${o}-back`] ? '' : img('neck')}${o === 'suit' ? '' : img('legs')}${L.shoes === 'sandal' ? img('feet') : ''}${img('shoes-' + L.shoes + (o === 'suit' ? '-low' : ''))}${o === 'tshirt' || o === 'hoodie' ? img('pants-shorts') : ''}
      ${arm('l')}${arm('r')}${PART[`outfit-${o}-back`] ? img(`outfit-${o}-back`) + img('neck-long') : ''}${img('outfit-' + o)}`;
    const face = `<g class="av-eo">${img('face-eyes-open')}</g>
      <g class="av-ec"><path d="M35.8 48.2 Q39.3 44.6 42.8 48.2 M57.2 48.2 Q60.7 44.6 64.2 48.2" fill="none" stroke="#3a2a22" stroke-width="1.5" stroke-linecap="round"/><ellipse cx="38.6" cy="53.4" rx="2.6" ry="1.4" fill="#ff8fa3" opacity=".55"/><ellipse cx="61.4" cy="53.4" rx="2.6" ry="1.4" fill="#ff8fa3" opacity=".55"/></g>
      <g class="av-ew">${img('face-eyes-angry')}</g>
      <g class="av-ms">${img('face-mouth-smile')}</g><g class="av-mo">${img('face-mouth-open')}</g><g class="av-md">${img('face-mouth-sad')}</g>
      <g class="av-tears">${img('face-tears')}</g>`;
    const head = `<g transform="translate(0 ${drop})"><g class="av-head">${opts.head ? hairBack : ''}${img('head')}${face}${hairFront}${L.acc === 'glasses' ? glasses(L.accColor) : L.acc !== 'none' ? img('acc-' + L.acc + '-lens') + img('acc-' + L.acc) : ''}</g></g>`;
    const vb = !opts.head ? '0 -16 100 166' : TALL_HATS.includes(L.acc) ? '3 -32 94 106' : '9 -16 82 90';
    const inner = `${opts.head ? '' : '<ellipse class="av-shadow" cx="50" cy="142.5" rx="24" ry="3.8" fill="rgba(0,0,0,.3)"/>'}
      <g class="av-body">${body}${head}</g>`;
    const C = { skin: L.skin, hairColor: L.hairColor, outfitColor: L.outfitColor, pants: L.pants, shoeColor: L.shoeColor, accColor: L.accColor };
    const defs = [...used].map((k) => tintFilter(id + k, C[k])).join('') +
      (hm ? `<mask id="${id}hm" maskUnits="userSpaceOnUse" x="-50" y="-100" width="200" height="300"><rect x="-50" y="-100" width="200" height="300" fill="#fff"/><path d="${hm}" fill="#000"/></mask>` : '');
    return `<svg class="av-svg" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"${opts.head ? ' style="overflow:hidden"' : ''}>
      <defs>${defs}</defs>${inner}</svg>`;
  }

  // Nạp sẵn ảnh thành data URI: ảnh SVG vẽ lên canvas (qua <img>) không được tải file ngoài.
  let readyP = null;
  function ready() {
    if (!readyP) {
      readyP = Promise.all(Object.keys(PART).map((n) => fetch(DIR + n + '.webp?v=' + VER)
        .then((r) => r.blob())
        .then((b) => new Promise((ok) => { const fr = new FileReader(); fr.onload = () => { DATA[n] = fr.result; ok(); }; fr.onerror = () => ok(); fr.readAsDataURL(b); }))
        .catch(() => {})));
    }
    return readyP;
  }
  // Như svg() nhưng nhúng ảnh vào chuỗi — dùng để vẽ lên canvas.
  function svgInline(look, opts = {}) {
    return ready().then(() => svg(look, { ...opts, inline: true }));
  }

  // ---------------------------------------------------------------- lưu trữ
  function get() {
    try {
      const raw = localStorage.getItem('gh_look');
      if (raw) return sanitize(JSON.parse(raw));
    } catch (e) { /* bỏ qua */ }
    const look = random();
    set(look);
    return look;
  }
  function set(look) {
    try { localStorage.setItem('gh_look', JSON.stringify(sanitize(look))); } catch (e) { /* bỏ qua */ }
  }

  // ---------------------------------------------------------------- trình tạo nhân vật
  function editor(container, { look, onChange } = {}) {
    let cur = sanitize(look || get());
    let cat = 'hair';
    container.classList.add('av-editor');

    function draw() {
      const [key, , type] = CATS.find((c) => c[0] === cat);
      const opts = OPT[key].map((v) => {
        const on = cur[key] === v ? 'on' : '';
        if (type === 'color') return `<button class="av-swatch ${on}" data-opt="${v}" style="--c:${v}" title="${v}"></button>`;
        const head = key === 'hair' || key === 'acc';
        return `<button class="av-thumb ${on}" data-opt="${v}">${svg({ ...cur, [key]: v }, { head })}<span>${LABELS[key][v]}</span></button>`;
      }).join('');
      container.innerHTML = `
        <div class="av-preview"><div class="av-stage">${svg(cur)}</div>
          <button type="button" class="gh-btn small" data-rand>🎲 Ngẫu nhiên</button></div>
        <div class="av-controls">
          <div class="av-cats">${CATS.map(([k, l]) => `<button type="button" data-cat="${k}" class="${k === cat ? 'on' : ''}">${l}</button>`).join('')}</div>
          <div class="av-opts ${type}">${opts}</div>
        </div>`;
    }

    container.addEventListener('click', (e) => {
      const c = e.target.closest('[data-cat]');
      const o = e.target.closest('[data-opt]');
      if (c) { cat = c.dataset.cat; draw(); return; }
      if (o) { const key = cat; cur = { ...cur, [key]: o.dataset.opt }; }
      else if (e.target.closest('[data-rand]')) cur = random();
      else return;
      draw();
      onChange && onChange(cur);
    });
    draw();
    return { get: () => cur };
  }

  window.Avatar = { OPT, svg, svgInline, ready, random, sanitize, get, set, editor };
})();
