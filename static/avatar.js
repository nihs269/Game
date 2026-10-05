/* Nhân vật dùng chung cho mọi game: vẽ SVG nhiều lớp (da, tóc, trang phục,
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
    acc: ['none', 'glasses', 'sunglasses', 'beanie', 'cap', 'crown', 'flower', 'headband', 'witchhat'],
    accColor: ['#e74c3c', '#ff8a3d', '#f6c945', '#35c46a', '#3b8cff', '#8e5cf7', '#2d3436', '#ff79b0'],
  };
  const LABELS = {
    hair: { short: 'Ngắn', spiky: 'Dựng', long: 'Dài', bob: 'Bob', ponytail: 'Đuôi ngựa', bun: 'Búi', curly: 'Xoăn', mohawk: 'Mohawk', bald: 'Trọc' },
    outfit: { tshirt: 'Áo thun', hoodie: 'Hoodie', dress: 'Váy', suit: 'Vest', robe: 'Áo choàng', overall: 'Yếm' },
    shoes: { sneaker: 'Sneaker', boot: 'Bốt', sandal: 'Dép', formal: 'Giày tây' },
    acc: { none: 'Không', glasses: 'Kính', sunglasses: 'Kính râm', beanie: 'Mũ len', cap: 'Mũ lưỡi trai', crown: 'Vương miện', flower: 'Hoa cài', headband: 'Băng đô', witchhat: 'Mũ phù thủy' },
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

  function shade(hex, pct) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(c + (pct / 100) * (pct < 0 ? c : 255 - c))));
    const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // ---------------------------------------------------------------- các bộ phận
  function hairParts(style, c) {
    const d = shade(c, -18);
    const shortFront = `<path d="M25 48 Q24 18 50 17 Q76 18 75 48 Q72 34 60 30 Q50 36 38 31 Q28 36 25 48Z" fill="${c}"/>`;
    const bangs = `<path d="M25 50 Q24 17 50 17 Q76 17 75 50 Q73 34 64 30 Q58 38 46 35 Q36 38 27 50Z" fill="${c}"/>`;
    switch (style) {
      case 'spiky':
        return { back: '', front: `<path d="M25 46 L23 28 L32 30 L33 13 L43 25 L50 6 L57 25 L67 13 L68 30 L77 28 L75 46 Q70 32 50 31 Q30 32 25 46Z" fill="${c}"/>` };
      case 'long':
        return { back: `<path d="M24 46 Q22 15 50 15 Q78 15 76 46 L80 104 Q67 110 62 99 L62 72 L38 72 L38 99 Q33 110 20 104Z" fill="${d}"/>`, front: bangs };
      case 'bob':
        return { back: `<path d="M23 48 Q21 15 50 15 Q79 15 77 48 L78 72 Q72 78 66 70 L34 70 Q28 78 22 72Z" fill="${d}"/>`, front: bangs };
      case 'ponytail':
        return { back: `<path d="M70 28 Q94 30 90 66 Q87 84 78 78 Q86 54 68 40Z" fill="${d}"/><circle cx="72" cy="31" r="4" fill="#ff5d8f"/>`, front: shortFront };
      case 'bun':
        return { back: `<circle cx="50" cy="14" r="11" fill="${d}"/>`, front: shortFront };
      case 'curly': {
        const pts = [[27, 42], [31, 29], [40, 21], [50, 18], [60, 21], [69, 29], [73, 42]];
        return {
          back: `<circle cx="24" cy="54" r="8" fill="${d}"/><circle cx="76" cy="54" r="8" fill="${d}"/>`,
          front: pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8.5" fill="${c}"/>`).join(''),
        };
      }
      case 'mohawk':
        return { back: '', front: `<path d="M44 34 Q43 8 50 0 Q57 8 56 34 Q50 29 44 34Z" fill="${c}"/>` };
      case 'bald':
        return { back: '', front: '<ellipse cx="41" cy="30" rx="7" ry="4" fill="#fff" opacity=".25"/>' };
      default:
        return { back: '', front: shortFront };
    }
  }

  function accPart(style, c) {
    const d = shade(c, -25);
    switch (style) {
      case 'glasses':
        return `<g fill="none" stroke="${d}" stroke-width="2"><circle cx="41" cy="49" r="7"/><circle cx="59" cy="49" r="7"/><path d="M48 49h4M34 47l-8-2M66 47l8-2"/></g>`;
      case 'sunglasses':
        return '<g><rect x="32" y="44" width="16" height="10" rx="4" fill="#111"/><rect x="52" y="44" width="16" height="10" rx="4" fill="#111"/><path d="M48 48h4M32 47l-6-2M68 47l6-2" stroke="#111" stroke-width="2"/><path d="M35 46l4 0" stroke="#fff" stroke-width="1.5" opacity=".6"/></g>';
      case 'beanie':
        return `<path d="M23 40 Q24 9 50 9 Q76 9 77 40Z" fill="${c}"/><rect x="21" y="34" width="58" height="10" rx="5" fill="${d}"/><circle cx="50" cy="8" r="6" fill="#fff"/>`;
      case 'cap':
        return `<path d="M25 37 Q26 11 50 11 Q74 11 75 37Z" fill="${c}"/><path d="M48 35 Q80 30 94 39 Q80 43 48 39Z" fill="${d}"/><circle cx="50" cy="12" r="2.5" fill="${d}"/>`;
      case 'crown':
        return '<path d="M33 25 L35 7 L43 16 L50 3 L57 16 L65 7 L67 25Z" fill="#f9ca24" stroke="#d99a00" stroke-width="1.5"/><circle cx="50" cy="18" r="2.6" fill="#e74c3c"/><circle cx="40" cy="20" r="2" fill="#3b8cff"/><circle cx="60" cy="20" r="2" fill="#35c46a"/>';
      case 'flower':
        return `<g transform="translate(70 26)">${[0, 72, 144, 216, 288].map((a) => `<circle cx="${(Math.cos(a * Math.PI / 180) * 5).toFixed(1)}" cy="${(Math.sin(a * Math.PI / 180) * 5).toFixed(1)}" r="4.2" fill="${c}"/>`).join('')}<circle r="3" fill="#ffd93b"/></g>`;
      case 'headband':
        return `<path d="M26 37 Q50 20 74 37" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M64 26 l10 -7 l0 12Z M64 26 l-3 -11 l11 4Z" fill="${d}"/>`;
      case 'witchhat':
        return `<path d="M31 26 Q44 20 52 -14 Q58 6 69 26Z" fill="${c}"/><ellipse cx="50" cy="26" rx="33" ry="6" fill="${d}"/><rect x="36" y="18" width="28" height="5" fill="#f6c945"/>`;
      default:
        return '';
    }
  }

  function outfitParts(style, c, skin) {
    const d = shade(c, -22);
    const body = 'M31 74 Q31 70 37 70 L63 70 Q69 70 69 74 L70 110 L30 110Z';
    switch (style) {
      case 'hoodie':
        return {
          torso: `<path d="M35 72 Q50 60 65 72 L61 77 Q50 70 39 77Z" fill="${d}"/><path d="${body}" fill="${c}"/>
            <path d="M40 95h20v11h-20z" fill="${d}" opacity=".6"/><path d="M46 72v12M54 72v12" stroke="#fff" stroke-width="1.4"/>`,
          sleeve: 'long', sc: c,
        };
      case 'dress':
        return {
          torso: `<path d="M34 71 L66 71 L64 90 L36 90Z" fill="${c}"/><path d="M36 88 L64 88 L77 121 Q50 128 23 121Z" fill="${c}"/>
            <path d="M24 119 Q50 126 76 119" stroke="${d}" stroke-width="3" fill="none"/><path d="M36 89h28" stroke="${d}" stroke-width="3"/>`,
          sleeve: 'short', sc: c, over: true,
        };
      case 'suit':
        return {
          torso: `<path d="${body}" fill="${c}"/><path d="M43 70 L50 88 L57 70Z" fill="#f5f6fa"/><path d="M48.5 72h3l1.5 14-3 4-3-4z" fill="#d63031"/>
            <path d="M43 70 L47 92 M57 70 L53 92" stroke="${d}" stroke-width="2"/><circle cx="50" cy="98" r="1.6" fill="${d}"/><circle cx="50" cy="104" r="1.6" fill="${d}"/>`,
          sleeve: 'long', sc: c,
        };
      case 'robe':
        return {
          torso: `<path d="M31 72 Q50 64 69 72 L79 134 Q50 141 21 134Z" fill="${c}"/><rect x="31" y="90" width="38" height="5" fill="${d}"/>
            <path d="M50 70 L50 136" stroke="${d}" stroke-width="1.5"/><path d="M22 132 Q50 139 78 132" stroke="#f6c945" stroke-width="2.5" fill="none"/>`,
          sleeve: 'wide', sc: c, over: true,
        };
      case 'overall':
        return {
          torso: `<path d="${body}" fill="#f5f6fa"/><path d="M36 84h28v26h-28z" fill="${c}"/><path d="M37 85 L39 70 M63 85 L61 70" stroke="${c}" stroke-width="4"/>
            <circle cx="40" cy="87" r="1.8" fill="#f6c945"/><circle cx="60" cy="87" r="1.8" fill="#f6c945"/><path d="M44 92h12v7h-12z" fill="${d}"/>`,
          sleeve: 'short', sc: '#f5f6fa',
        };
      default:
        return {
          torso: `<path d="${body}" fill="${c}"/><path d="M44 70 Q50 76 56 70" stroke="${d}" stroke-width="2" fill="none"/>`,
          sleeve: 'short', sc: c,
        };
    }
  }

  function arm(side, sleeve, sc, skin) {
    const x = side === 'l' ? 21 : 69;
    const hx = x + 5;
    let sleeveEl;
    if (sleeve === 'short') sleeveEl = `<rect x="${x - 1}" y="72" width="12" height="15" rx="5" fill="${sc}"/>`;
    else if (sleeve === 'wide') sleeveEl = `<path d="M${x - 2} 74 h14 l3 30 h-20z" fill="${sc}"/>`;
    else sleeveEl = `<rect x="${x - 0.5}" y="72" width="11" height="29" rx="5" fill="${sc}"/>`;
    return `<g class="av-arm av-arm-${side}"><rect x="${x}" y="74" width="10" height="30" rx="5" fill="${skin}"/>${sleeveEl}
      <circle cx="${hx}" cy="105" r="5.5" fill="${skin}"/><g class="av-hold"></g></g>`;
  }

  function shoe(x, style, c, skin) {
    switch (style) {
      case 'boot':
        return `<path d="M${x - 6} 121h12v12q5 1 5 5v2h-17z" fill="${c}"/><rect x="${x - 6}" y="121" width="12" height="3" fill="${shade(c, -25)}"/>`;
      case 'sandal':
        return `<ellipse cx="${x + 1}" cy="136" rx="8" ry="4" fill="${skin}"/><rect x="${x - 6}" y="133" width="14" height="2.6" rx="1" fill="${c}"/><rect x="${x - 8}" y="138.5" width="18" height="2.4" rx="1" fill="${c}"/>`;
      case 'formal':
        return `<ellipse cx="${x + 1}" cy="136.5" rx="9.5" ry="4.8" fill="${c}"/><ellipse cx="${x + 3}" cy="134.5" rx="4" ry="1.4" fill="#fff" opacity=".4"/>`;
      default:
        return `<path d="M${x - 8} 133 Q${x - 8} 129 ${x - 4} 129 L${x + 3} 129 Q${x + 10} 131 ${x + 10} 136 L${x + 10} 139 L${x - 8} 139Z" fill="${c}"/><rect x="${x - 8}" y="137.5" width="18" height="3" rx="1.5" fill="#fff"/>`;
    }
  }

  function svg(look, opts = {}) {
    const L = sanitize(look, opts.seed);
    const skin = L.skin;
    const skinD = shade(skin, -12);
    const hair = hairParts(L.hair, L.hairColor);
    const out = outfitParts(L.outfit, L.outfitColor, skin);
    const vb = opts.head ? '14 -16 72 88' : '0 -16 100 166';
    const legs = `<rect x="37" y="104" width="11" height="30" rx="5" fill="${L.pants}"/><rect x="52" y="104" width="11" height="30" rx="5" fill="${L.pants}"/>`;
    const shoes = shoe(42.5, L.shoes, L.shoeColor, skin) + shoe(57.5, L.shoes, L.shoeColor, skin);
    const face = `
      <g class="av-eo"><ellipse cx="41" cy="50" rx="3.4" ry="4.3" fill="#2a2a2a"/><ellipse cx="59" cy="50" rx="3.4" ry="4.3" fill="#2a2a2a"/>
        <circle cx="42.3" cy="48.4" r="1.3" fill="#fff"/><circle cx="60.3" cy="48.4" r="1.3" fill="#fff"/></g>
      <g class="av-ec" fill="none" stroke="#2a2a2a" stroke-width="2" stroke-linecap="round"><path d="M37 50 Q41 53.5 45 50"/><path d="M55 50 Q59 53.5 63 50"/></g>
      <g class="av-ew"><ellipse cx="41" cy="50" rx="4" ry="3" fill="#ff2a2a"/><ellipse cx="59" cy="50" rx="4" ry="3" fill="#ff2a2a"/>
        <ellipse cx="41" cy="50" rx="1.2" ry="2.6" fill="#300"/><ellipse cx="59" cy="50" rx="1.2" ry="2.6" fill="#300"/></g>
      <ellipse cx="34" cy="57" rx="4" ry="2.4" fill="#ff7b9c" opacity=".35"/><ellipse cx="66" cy="57" rx="4" ry="2.4" fill="#ff7b9c" opacity=".35"/>
      <path class="av-ms" d="M45 59 Q50 63.5 55 59" stroke="#7a3b2e" stroke-width="2" fill="none" stroke-linecap="round"/>
      <ellipse class="av-mo" cx="50" cy="61" rx="3" ry="3.8" fill="#7a3b2e"/>
      <path class="av-md" d="M45 62.5 Q50 58 55 62.5" stroke="#7a3b2e" stroke-width="2" fill="none" stroke-linecap="round"/>
      <g class="av-tears"><path d="M38 55 q-2 5 0 7 q2 -2 0 -7z" fill="#6ecbff"/><path d="M62 55 q-2 5 0 7 q2 -2 0 -7z" fill="#6ecbff"/></g>`;
    const body = opts.head ? '' : `
      <g class="av-seat"><rect x="17" y="113" width="66" height="15" rx="7.5" fill="#7a5230"/><ellipse cx="18" cy="120.5" rx="4.5" ry="7.5" fill="#b07a4c"/><path d="M28 118h20M52 123h22" stroke="#5c3b20" stroke-width="1.4"/></g>
      ${hair.back}${out.over ? legs + shoes + out.torso : legs + shoes + out.torso}
      ${arm('l', out.sleeve, out.sc, skin)}${arm('r', out.sleeve, out.sc, skin)}
      <rect x="45" y="64" width="10" height="9" fill="${skinD}"/>`;
    return `<svg class="av-svg" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      ${opts.head ? '' : '<ellipse class="av-shadow" cx="50" cy="143" rx="32" ry="5" fill="rgba(0,0,0,.35)"/>'}
      <g class="av-body">${opts.head ? hair.back : ''}${body}
        <g class="av-head"><circle cx="25" cy="49" r="5" fill="${skinD}"/><circle cx="75" cy="49" r="5" fill="${skinD}"/>
          <circle cx="50" cy="46" r="25" fill="${skin}"/>${face}${hair.front}${accPart(L.acc, L.accColor)}</g>
      </g></svg>`;
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

  window.Avatar = { OPT, svg, random, sanitize, get, set, editor };
})();
