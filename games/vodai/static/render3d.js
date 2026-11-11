/* Võ Đài Sinh Tử — dựng hình 3D (Three.js): võ sĩ là model người thật có khung xương + sàn đấu phối cảnh.
 *
 * Võ sĩ dùng chung model ma-nơ-canh của Quaternius (CC0, models/base/mannequin.glb), mỗi người được tô màu trang
 * phục theo vùng cơ thể (mũ trùm, khăn che mặt, áo, quần, giày, găng, da) và gắn phụ kiện vào xương (băng đô, nón,
 * tóc, râu, giáp vai…). Có model riêng (models/manifest.json) thì dùng model riêng.
 *
 * Chuyển động: đòn nào có animation mocap (đấm, trúng đòn, ngã, đứng dậy, tung chưởng, ngồi) thì dùng animation; còn
 * lại xoay trực tiếp các xương theo tư thế app.js tính (góc khớp đo từ hướng thẳng xuống, quay về phía trước là
 * dương), có thêm xoay hông / vai. Hai cách được trộn mượt với nhau.
 *
 * Camera phối cảnh nhìn thẳng vào mặt phẳng giao đấu z = 0, nên lớp 2D phía trên (HUD, chưởng, máu) khớp vị trí.
 */
(function () {
  const T = window.THREE;
  if (!T) return;
  if (T.ColorManagement) T.ColorManagement.legacyMode = false;   // mã màu hex hiểu là sRGB → ánh sáng PBR đúng màu
  const FOV = 34;
  const HEIGHT = 124;                 // chiều cao võ sĩ (đơn vị sân đấu)
  const BASE_MODEL = 'models/base/mannequin.glb';

  const G = { cone: new T.ConeGeometry(1, 1, 16), disc: new T.CircleGeometry(1, 24), sph: new T.SphereGeometry(1, 20, 14),
    box: new T.BoxGeometry(1, 1, 1), cyl: new T.CylinderGeometry(1, 1, 1, 16), torus: new T.TorusGeometry(1, 0.12, 8, 28),
    skirt: new T.CylinderGeometry(0.75, 1, 1, 18, 1, true) };
  const stdMat = (color, o = {}) => new T.MeshStandardMaterial({ color: new T.Color(color), roughness: o.rough ?? 0.6, metalness: o.metal ?? 0.05, ...(o.extra || {}) });
  const V = () => new T.Vector3();

  // ---------------------------------------------------------------- tải model
  const A = { base: null, manifest: null, custom: {}, loading: {}, anims: [], listeners: [] };
  const notify = () => A.listeners.forEach((fn) => { try { fn(); } catch (e) { /* bỏ qua */ } });
  const loadGLB = (url, ok) => new T.GLTFLoader().load(url, ok, undefined, (e) => console.warn('Không tải được ' + url, e));
  function loadBase() {
    if (A.base || A.loading.__base) return;
    A.loading.__base = true;
    loadGLB(BASE_MODEL, (g) => { A.base = prepare(g, {}); notify(); });
  }
  function loadManifest() {
    loadBase();
    if (A.manifest) return;
    A.manifest = { chars: {} };
    fetch('models/manifest.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((m) => {
      if (!m) return;
      A.manifest = m;
      if (m.anims) loadGLB(`models/${m.anims}`, (g) => { A.anims = g.animations.map(inPlace); notify(); });
      notify();
    });
  }
  function templateFor(charId) {
    const file = A.manifest && A.manifest.chars && A.manifest.chars[charId];
    if (file) {
      if (A.custom[charId]) return A.custom[charId];
      if (!A.loading[charId]) {
        A.loading[charId] = true;
        loadGLB(`models/${file}`, (g) => { A.custom[charId] = prepare(g, (A.manifest.adjust || {})[charId] || {}, true); notify(); });
      }
    }
    return A.base;
  }

  // Bỏ phần trôi ngang của hông (root motion): võ sĩ đứng tại chỗ, game tự lo di chuyển.
  function inPlace(clip) {
    clip.tracks.forEach((tr) => {
      if (!/hips\.position$|pelvis\.position$/i.test(tr.name)) return;
      const v = tr.values;
      for (let i = 0; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
    });
    return clip;
  }

  // ---------------------------------------------------------------- khung xương
  const RIG = {
    hips: ['def-hips', 'hips', 'pelvis'], spine1: ['def-spine.001', 'spine', 'spine_01'], spine2: ['def-spine.002', 'spine1', 'spine_02'],
    spine3: ['def-spine.003', 'spine2', 'spine_03'], neck: ['def-neck', 'neck', 'neck_01'], head: ['def-head', 'head'],
    armR: ['def-upper_arm.r', 'rightarm', 'upperarm_r'], foreR: ['def-forearm.r', 'rightforearm', 'lowerarm_r'], handR: ['def-hand.r', 'righthand', 'hand_r'],
    armL: ['def-upper_arm.l', 'leftarm', 'upperarm_l'], foreL: ['def-forearm.l', 'leftforearm', 'lowerarm_l'], handL: ['def-hand.l', 'lefthand', 'hand_l'],
    thighR: ['def-thigh.r', 'rightupleg', 'thigh_r'], shinR: ['def-shin.r', 'rightleg', 'calf_r'], footR: ['def-foot.r', 'rightfoot', 'foot_r'], toeR: ['def-toe.r', 'righttoebase', 'ball_r'],
    thighL: ['def-thigh.l', 'leftupleg', 'thigh_l'], shinL: ['def-shin.l', 'leftleg', 'calf_l'], footL: ['def-foot.l', 'leftfoot', 'foot_l'], toeL: ['def-toe.l', 'lefttoebase', 'ball_l'],
  };
  // Bộ tải GLTF tự bỏ các ký tự “.” “:” trong tên node (DEF-upper_arm.R → DEF-upper_armR, mixamorig:Hips → mixamorigHips)
  // → so tên sau khi chuẩn hoá: chữ thường, bỏ tiền tố mixamorig, chỉ giữ chữ / số / “_”.
  const nameKey = (n) => String(n).toLowerCase().replace(/^mixamorig[:_]?/, '').replace(/[^a-z0-9_]/g, '');
  const bname = (o) => nameKey(o.name);
  function findRig(root) {
    const bones = {};
    root.traverse((o) => { if (o.isBone) bones[bname(o)] = o; });
    const rig = {};
    Object.entries(RIG).forEach(([k, names]) => { rig[k] = names.map((n) => bones[nameKey(n)]).find(Boolean) || null; });
    return rig;
  }
  // vùng cơ thể theo tên xương (để tô màu trang phục)
  function regionOf(n) {
    if (/head|eye|jaw/.test(n)) return 'head';
    if (/neck/.test(n)) return 'neck';
    if (/hand|thumb|index|middle|ring|pinky|f_/.test(n)) return 'hand';
    if (/forearm|lowerarm/.test(n)) return 'fore';
    if (/upper_arm|upperarm|^(left|right)arm$|shoulder|clavicle/.test(n)) return 'upper';
    if (/toe|ball|foot/.test(n)) return 'foot';
    if (/shin|calf|^(left|right)leg$/.test(n)) return 'shin';
    if (/thigh|upleg/.test(n)) return 'thigh';
    if (/hips|pelvis/.test(n)) return 'hips';
    return 'torso';
  }

  // Chuẩn bị model: đo chiều cao (theo lưới đã gắn xương), hướng mặt, vùng của từng đỉnh, số đo đầu.
  function prepare(g, cfg) {
    const scene = g.scene;
    scene.updateMatrixWorld(true);
    const rig = findRig(scene);
    const meshes = [];
    scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
    const box = new T.Box3();
    const pos = V();
    const info = meshes.map((m) => {
      const n = m.geometry.attributes.position.count;
      const wp = new Float32Array(n * 3);
      const reg = new Array(n);
      const si = m.geometry.attributes.skinIndex; const sw = m.geometry.attributes.skinWeight;
      for (let i = 0; i < n; i++) {
        pos.fromBufferAttribute(m.geometry.attributes.position, i);
        m.boneTransform(i, pos);
        pos.applyMatrix4(m.matrixWorld);
        wp[i * 3] = pos.x; wp[i * 3 + 1] = pos.y; wp[i * 3 + 2] = pos.z;
        box.expandByPoint(pos);
        let best = 0; let bw = -1;
        const ws = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)]; const is = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)];
        for (let k = 0; k < 4; k++) if (ws[k] > bw) { bw = ws[k]; best = is[k]; }
        reg[i] = regionOf(bname(m.skeleton.bones[best]));
      }
      return { wp, reg };
    });
    const wpos = (b) => b.getWorldPosition(V());
    const up = V().set(0, 1, 0);
    let fwd = V().set(0, 0, 1);
    if (rig.footR && rig.toeR) { fwd = wpos(rig.toeR).sub(wpos(rig.footR)); fwd.y = 0; if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, 1); fwd.normalize(); }
    const right = V().crossVectors(fwd, up).normalize();
    const h = Math.max(1e-3, box.max.y - box.min.y);
    const scale = (HEIGHT * (cfg.height || 1)) / h;
    // số đo đầu (theo các đỉnh thuộc vùng đầu)
    const hp = rig.head ? wpos(rig.head) : V().set(0, box.max.y * 0.9, 0);
    let hmin = Infinity; let hmax = -Infinity; let fmax = 0; let rmax = 0;
    info.forEach(({ wp, reg }) => reg.forEach((r, i) => {
      if (r !== 'head') return;
      const d = V().set(wp[i * 3] - hp.x, wp[i * 3 + 1] - hp.y, wp[i * 3 + 2] - hp.z);
      const y = d.dot(up); hmin = Math.min(hmin, y); hmax = Math.max(hmax, y);
      fmax = Math.max(fmax, d.dot(fwd)); rmax = Math.max(rmax, Math.abs(d.dot(right)));
    }));
    if (!Number.isFinite(hmin)) { hmin = 0; hmax = h * 0.13; fmax = h * 0.06; rmax = h * 0.05; }
    return {
      scene, clips: g.animations.map(inPlace), rig, meshes, info, scale, foot: -box.min.y, fwd, up, right,
      rotY: Math.atan2(fwd.z, fwd.x) + (cfg.rotY || 0), head: { hp, hmin, hmax, fmax, rmax }, custom: !!cfg.custom,
    };
  }

  // ---------------------------------------------------------------- dựng một võ sĩ từ model
  function buildFighter(tpl, L, opts = {}) {
    const obj = T.SkeletonUtils.clone(tpl.scene);
    const col = (c) => new T.Color(c === 'skin' || !c ? L.skin : c);
    const mats = [];
    const hd = tpl.head;
    const hh = hd.hmax - hd.hmin;
    // tô màu trang phục theo vùng cơ thể (màu đỉnh nhân với màu vật liệu)
    const paint = !tpl.custom;
    let mi = 0;
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.frustumCulled = false;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const cloned = list.map((m, k) => {
        const c = m.clone();
        if (paint) {
          c.vertexColors = true; c.map = null;
          c.color.set(/joint/i.test(m.name) || k === 1 ? '#7a7a7a' : '#ffffff');   // khớp nối tối hơn cho rõ khối
          c.roughness = 0.55; c.metalness = 0.04;
        }
        if (!c.emissive) c.emissive = new T.Color(0, 0, 0);
        mats.push(c);
        return c;
      });
      o.material = Array.isArray(o.material) ? cloned : cloned[0];
      if (!paint || !o.isSkinnedMesh) return;
      const inf = tpl.info[mi++];
      if (!inf) return;
      o.geometry = o.geometry.clone();
      const n = o.geometry.attributes.position.count;
      const colors = new Float32Array(n * 3);
      const C = {
        skin: col(L.skin), head: col(L.hood || L.skin), neck: col(L.hood || L.mask || L.skin), torso: col(L.chest === 'bare' ? L.skin : L.top),
        upper: col(L.sleeve), fore: col(L.glove), hand: col(L.glove), thigh: col(L.pants), hips: col(L.pants), shin: col(L.pants),
        boots: col(L.boots), foot: col(L.boots), belt: col(L.belt), mask: col(L.mask), hair: col(L.hairColor || '#111'), beard: col(L.beard || '#888'),
      };
      const shinTop = tpl.rig.shinR ? tpl.rig.shinR.getWorldPosition(V()).y : 0;
      const footY = tpl.rig.footR ? tpl.rig.footR.getWorldPosition(V()).y : 0;
      const beltY = tpl.rig.spine1 ? tpl.rig.spine1.getWorldPosition(V()).y : 0;
      for (let i = 0; i < n; i++) {
        let r = inf.reg[i];
        const x = inf.wp[i * 3] - hd.hp.x; const y = inf.wp[i * 3 + 1]; const z = inf.wp[i * 3 + 2] - hd.hp.z;
        let c = C[r] || C.torso;
        if (r === 'shin' && y < footY + (shinTop - footY) * 0.55) c = C.boots;
        if ((r === 'hips' || r === 'torso') && Math.abs(y - beltY) < hh * 0.18) c = C.belt;
        if (r === 'head' || r === 'neck') {
          const hy = y - hd.hp.y - hd.hmin; const f = x * tpl.fwd.x + z * tpl.fwd.z;
          const front = f > hd.fmax * 0.25;
          const eyeLo = hh * 0.46; const eyeHi = hh * 0.63;
          if (L.hood) c = front && hy > eyeLo && hy < eyeHi ? C.skin : C.head;
          else if (r === 'head') {
            c = C.skin;
            const hairy = L.hair && L.hair !== 'bald' && (hy > hh * (L.hair === 'flattop' ? 0.78 : 0.72) || (f < -hd.fmax * 0.25 && hy > hh * (L.hair === 'long' || L.hair === 'ponytail' ? 0.1 : 0.35)));
            if (hairy) c = C.hair;
            if (L.beard && front && hy < hh * 0.36) c = C.beard;
          }
          if (L.mask && front && hy < eyeLo && r === 'head') c = C.mask;
          if (L.mask && r === 'neck') c = C.mask;
          r = 'head';
        }
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      o.geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
    });

    // khung: root (vị trí, hướng, lật trái/phải) → rotG (ngã) → spinG (lộn vòng) → body (xoay roundhouse) → obj
    const root = new T.Group(); const rotG = new T.Group(); const spinG = new T.Group(); const body = new T.Group();
    root.add(rotG); rotG.add(spinG); spinG.add(body); body.add(obj);
    obj.rotation.y = tpl.rotY;   // mặt model → +x
    const k = L.build === 'big' ? 1.08 : L.build === 'f' ? 0.9 : 1;
    obj.scale.set(tpl.scale * k, tpl.scale * (L.build === 'f' ? 0.97 : 1), tpl.scale * k);
    root.updateMatrixWorld(true);
    const rig = findRig(obj);
    const bones = []; obj.traverse((o) => { if (o.isBone) bones.push(o); });
    const restQ = bones.map((b) => b.quaternion.clone()); const restP = bones.map((b) => b.position.clone());
    // phụ kiện gắn vào xương (kích thước theo đơn vị sân đấu, vị trí theo hệ: x trước, y lên, z bên phải)
    const acc = [];
    const M = (c, o) => { const m = stdMat(c, o); mats.push(m); return m; };
    // Gắn phụ kiện vào xương. Toạ độ theo hệ sân đấu khi võ sĩ đứng ở gốc: x phía trước, y lên trên, z bên phải.
    const attach = (bone, geo, mat, sc, at, rot) => {
      if (!bone) return null;
      const m = new T.Mesh(geo, mat); m.castShadow = true;
      const p0 = bone.getWorldPosition(V());
      const world = new T.Matrix4().compose(V().set(p0.x + at[0], p0.y + at[1], p0.z + at[2]),
        new T.Quaternion().setFromEuler(new T.Euler(...(rot || [0, 0, 0]))), V().set(...sc));
      new T.Matrix4().copy(bone.matrixWorld).invert().multiply(world).decompose(m.position, m.quaternion, m.scale);
      bone.add(m);
      return m;
    };
    // Ống bọc chạy dọc theo xương (từ khớp này tới khớp con), ví dụ tay thép của Jax.
    const sleeve = (bone, child, mat, r) => {
      if (!bone || !child) return;
      const a = bone.getWorldPosition(V()); const b = child.getWorldPosition(V());
      const len = a.distanceTo(b);
      const q = new T.Quaternion().setFromUnitVectors(V().set(0, 1, 0), V().subVectors(b, a).normalize());
      const m = new T.Mesh(G.cyl, mat); m.castShadow = true;
      const world = new T.Matrix4().compose(a.clone().lerp(b, 0.5), q, V().set(r, len * 0.9, r));
      new T.Matrix4().copy(bone.matrixWorld).invert().multiply(world).decompose(m.position, m.quaternion, m.scale);
      bone.add(m);
    };
    const head = rig.head;
    const eyeY = hd.hmin + hh * 0.55;                       // độ cao mắt (hệ model chưa thu phóng → đổi sang sân đấu)
    const U = (v) => v * tpl.scale;                         // đơn vị model → sân đấu
    const hr = U(hd.rmax); const hf = U(hd.fmax);
    if (head) {
      if (L.eyes) {
        const glow = new T.MeshStandardMaterial({ color: '#000', emissive: new T.Color(L.eyes === 'red' ? '#ff3020' : L.eyes === 'yellow' ? '#ffe040' : '#ffffff'), emissiveIntensity: 2.2 });
        mats.push(glow);
        [-1, 1].forEach((s) => attach(head, G.sph, glow, [0.9, 0.42, 1.25], [hf * 0.92, U(eyeY), s * hr * 0.38]));
      }
      if (L.band) {
        const bm = M(L.band, { rough: 0.7 });
        attach(head, G.torus, bm, [hr * 1.06, hr * 1.06, hr * 1.12], [hf * 0.05, U(hd.hmin + hh * 0.72), 0], [Math.PI / 2, 0, 0]);
        [-0.25, 0.25].forEach((s, i) => attach(head, G.box, bm, [1.2, 9 - i * 2, 2.6], [-hf * 1.15, U(hd.hmin + hh * 0.62), s * hr], [0, 0, 0.5 + i * 0.2]));
      }
      if (L.hat === 'straw') attach(head, G.cone, M('#cdb46c', { rough: 0.9 }), [hr * 3.1, hr * 0.9, hr * 3.1], [0, U(hd.hmax) + hr * 0.25, 0]);
      const hairM = M(L.hairColor || '#111', { rough: 0.85 });
      if (!L.hood && L.hair === 'long') attach(head, G.sph, hairM, [hr * 0.55, hr * 1.5, hr * 0.95], [-hf * 0.7, U(hd.hmin + hh * 0.3), 0]);
      if (!L.hood && L.hair === 'ponytail') attach(head, G.sph, hairM, [hr * 0.32, hr * 1.1, hr * 0.32], [-hf * 1.15, U(hd.hmin + hh * 0.35), 0], [0, 0, -0.5]);
      if (!L.hood && L.hair === 'flattop') attach(head, G.box, hairM, [hr * 1.6, hr * 0.5, hr * 1.8], [0, U(hd.hmax) + hr * 0.12, 0]);
      if (!L.hood && L.hair === 'spiky') {
        for (let i = 0; i < 6; i++) attach(head, G.cone, hairM, [hr * 0.28, hr * 0.7, hr * 0.28], [(i % 3 - 1) * hf * 0.45, U(hd.hmax) + hr * 0.12, (i < 3 ? -1 : 1) * hr * 0.35], [(i < 3 ? -0.4 : 0.4), 0, -(i % 3 - 1) * 0.4]);
      }
      if (L.beard) attach(head, G.cone, M(L.beard, { rough: 0.9 }), [hr * 0.45, hr * 0.9, hr * 0.6], [hf * 0.6, U(hd.hmin) - hr * 0.1, 0], [Math.PI, 0, -0.3]);
      if (L.shades) attach(head, G.box, M('#0b0b10', { rough: 0.15, metal: 0.6 }), [hf * 0.25, hr * 0.22, hr * 1.7], [hf * 0.92, U(eyeY), 0]);
    }
    if (L.pads) ['armR', 'armL'].forEach((b, i) => attach(rig[b], G.sph, M(L.pads, { metal: 0.45, rough: 0.35 }), [9, 6, 9], [0, 4, (i ? -1 : 1) * 3]));
    if (L.metal) { const cm = M('#c8d0d8', { metal: 0.95, rough: 0.2 }); sleeve(rig.foreR, rig.handR, cm, 3.9); sleeve(rig.foreL, rig.handL, cm, 3.9); }
    if (L.sash && rig.hips) [-0.3, 0.3].forEach((s, i) => attach(rig.hips, G.box, M(L.sash, { rough: 0.75 }), [1.6, 16 - i * 3, 3.4], [-10, -9, s * 6], [0, 0, -0.25]));
    if (L.chest === 'robe' && rig.hips) attach(rig.hips, G.skirt, M(L.top, { rough: 0.8, extra: { side: T.DoubleSide } }), [16, 34, 18], [1, -16, 0]);

    obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const mixer = new T.AnimationMixer(obj);
    const byName = {};
    [...tpl.clips, ...A.anims].forEach((c) => { const n = norm(c.name); if (!byName[n]) byName[n] = c; });
    const actions = {};
    const clipFor = (key) => {
      if (key in actions) return actions[key];
      const c = (CLIPS[key] || [key]).map((n) => byName[n]).find(Boolean) || null;
      let a = null;
      if (c) { a = mixer.clipAction(c); a.play(); a.setEffectiveWeight(0); }
      actions[key] = a;
      return a;
    };
    // độ cao xương thấp nhất ở tư thế gốc (để đặt chân chạm sàn)
    const rest = lowestBone(rig);
    const base = mats.map((m) => ({ m, c: m.color.clone(), e: m.emissive.clone(), ei: m.emissiveIntensity }));
    return { root, rotG, spinG, body, obj, rig, bones, restQ, restP, mixer, clipFor, actions, look: L, tint: '', mats, base,
      restLow: rest, clipW: 0, lastClip: null, lastT: 0, stKey: '', stT0: 0, tpl };
  }
  const norm = (n) => String(n || '').toLowerCase().replace(/^.*\|/, '').replace(/[\s-]+/g, '_');
  function lowestBone(rig) {
    let m = Infinity;
    ['footR', 'footL', 'toeR', 'toeL', 'handR', 'handL', 'head', 'hips', 'shinR', 'shinL'].forEach((k) => { if (rig[k]) m = Math.min(m, rig[k].getWorldPosition(V()).y); });
    return Number.isFinite(m) ? m : 0;
  }
  function disposeFighter(F) {
    F.mats.forEach((m) => m.dispose());
    F.obj.traverse((o) => { if (o.isSkinnedMesh && o.geometry.attributes.color) o.geometry.dispose(); });
  }

  // ---------------------------------------------------------------- animation
  // tên clip được nhận (chữ thường, khoảng trắng → _). Thư viện Quaternius: Punch_Jab, Hit_Head, Death01…
  const CLIPS = {
    idle: ['idle', 'fighting_idle', 'fight_idle', 'boxing_idle'], walk: ['walk_fwd', 'walk_forward'], walk_back: ['walk_back', 'walk_backward'],
    crouch: ['crouch', 'crouch_idle_loop', 'crouch_idle'], block: ['block', 'guard'], cblock: ['crouch_block'],
    jump: ['jump'], flip: ['jump_flip', 'front_flip'], hurt: ['hit', 'hit_head', 'hit_reaction', 'hurt'], hurt2: ['hit_chest', 'hit_head', 'hit'],
    fall: ['knockdown', 'knocked_down', 'death01', 'fall'], rise: ['get_up', 'getup', 'laytoidle'], dizzy: ['dizzy', 'stunned'],
    win: ['victory', 'win'], sad: ['defeated', 'sad'],
    jab: ['punch', 'punch_jab', 'jab'], kick: ['kick', 'high_kick', 'mma_kick'], upper: ['uppercut'], sweep: ['sweep', 'leg_sweep'],
    round: ['roundhouse', 'roundhouse_kick'], apunch: ['air_punch', 'jump_punch'], akick: ['air_kick', 'jump_kick'], throw: ['throw'],
    fkick: ['flying_kick'], bicycle: ['bicycle', 'hurricane_kick'], slide: ['slide'], shoulder: ['shoulder', 'dash_punch', 'punch_cross'],
    fireball: ['cast', 'fireball', 'spell_simple_shoot'], iceball: ['cast', 'spell_simple_shoot'], spear: ['spear', 'throw_object', 'spell_simple_shoot'],
    teleport: ['teleport', 'spell_simple_shoot'],
  };
  const LOOPS = new Set(['idle', 'walk', 'walk_back', 'crouch', 'block', 'cblock', 'dizzy', 'win']);
  const MOVES = new Set(['jab', 'kick', 'upper', 'sweep', 'round', 'apunch', 'akick', 'throw', 'fkick', 'bicycle', 'slide', 'shoulder',
    'fireball', 'iceball', 'spear', 'teleport']);

  // Chọn clip mocap cho trạng thái hiện tại (nếu có). Trả về { a, t } hoặc null (→ dùng tư thế tự xoay xương).
  function pickClip(F, o, now) {
    let key = o.st || 'idle';
    if (key === 'atk' && o.mv) key = o.mv;
    if (key === 'walk' && o.back) key = 'walk_back';
    if (key === 'jump' && o.flip) key = 'flip';
    if (key === 'down' || key === 'ko') key = 'fall';          // ngã rồi nằm: cùng một clip, chạy liền
    if (F.stKey !== key) { F.stKey = key; F.stT0 = now; F.hurtAlt = !F.hurtAlt; }
    const since = now - F.stT0;
    if (key === 'fall') {
      const a = F.clipFor('fall');
      if (!a) return null;
      const d = a.getClip().duration;
      return { a, t: Math.min(d * 0.999, since * 2.4) };     // clip ngã khá chậm: tua nhanh cho khớp nhịp game
    }
    if (key === 'rise') {
      const a = F.clipFor('rise');
      if (a) return { a, t: Math.min(a.getClip().duration * 0.999, since * (a.getClip().duration / 0.35)) };
      const f = F.clipFor('fall');   // không có clip đứng dậy: tua ngược clip ngã
      if (!f) return null;
      const d = f.getClip().duration;
      return { a: f, t: Math.max(0, d * 0.999 - since * (d / 0.35)) };
    }
    if (key === 'hurt') {
      const a = F.clipFor(F.hurtAlt ? 'hurt2' : 'hurt') || F.clipFor('hurt');
      return a ? { a, t: Math.min(a.getClip().duration * 0.999, since * 1.3) } : null;
    }
    const a = F.clipFor(key);
    if (!a) return null;
    const d = a.getClip().duration;
    if (MOVES.has(key) && o.prog !== undefined) return { a, t: Math.min(0.999, Math.max(0, o.prog)) * d };
    if (key === 'jump' || key === 'flip') return { a, t: Math.min(0.999, Math.max(0, o.jumpProg || 0)) * d };
    if (LOOPS.has(key)) return { a, t: since % d };
    return { a, t: Math.min(d * 0.999, since) };
  }

  // Xoay xương sao cho đoạn xương (từ khớp này tới khớp con) hướng theo `dir` (hệ thế giới khi root ở gốc).
  const _a = V(); const _b = V(); const _q = new T.Quaternion(); const _wq = new T.Quaternion(); const _pq = new T.Quaternion();
  function aim(bone, child, dir) {
    if (!bone) return;
    bone.getWorldPosition(_a);
    if (child) child.getWorldPosition(_b).sub(_a); else _b.set(0, 1, 0).applyQuaternion(bone.getWorldQuaternion(_wq));
    if (_b.lengthSq() < 1e-10) return;
    _b.normalize();
    _q.setFromUnitVectors(_b, dir);
    bone.getWorldQuaternion(_wq);
    bone.parent.getWorldQuaternion(_pq);
    bone.quaternion.copy(_pq.invert().multiply(_q.multiply(_wq)));
    bone.updateMatrixWorld(true);
  }
  function twist(bone, axis, ang) {
    if (!bone || !ang) return;
    bone.getWorldQuaternion(_wq);
    bone.parent.getWorldQuaternion(_pq);
    _q.setFromAxisAngle(axis, ang);
    bone.quaternion.copy(_pq.invert().multiply(_q.multiply(_wq)));
    bone.updateMatrixWorld(true);
  }
  const dirA = (a, z = 0) => V().set(Math.sin(a), -Math.cos(a), z).normalize();   // góc khớp → hướng (x trước, y lên, z phải)
  const UP = V().set(0, 1, 0);

  // Đặt tư thế bằng cách xoay xương theo góc khớp (z dương = phía bên phải người = phía gần camera).
  function solvePose(F, p) {
    const R = F.rig;
    F.obj.updateMatrixWorld(true);
    const lean = p.lean || 0;
    twist(R.hips, UP, -(p.hipTwist || 0));
    aim(R.spine1, R.spine2, V().set(Math.sin(lean * 0.35), Math.cos(lean * 0.35), 0));
    aim(R.spine2, R.spine3, V().set(Math.sin(lean * 0.7), Math.cos(lean * 0.7), 0));
    aim(R.spine3, R.neck, V().set(Math.sin(lean), Math.cos(lean), 0));
    twist(R.spine3, UP, -(p.twist || 0));
    const hl = lean + (p.tilt || 0) * 0.8;
    aim(R.neck, R.head, V().set(Math.sin(hl * 0.6), Math.cos(hl * 0.6), 0));
    aim(R.head, null, V().set(Math.sin(hl), Math.cos(hl), 0));
    // chân (F = chân phải, gần camera)
    [['R', p.legF, 1], ['L', p.legB, -1]].forEach(([s, g, side]) => {
      aim(R['thigh' + s], R['shin' + s], dirA(g[0], side * 0.07));
      aim(R['shin' + s], R['foot' + s], dirA(g[0] + g[1], side * 0.03));
      aim(R['foot' + s], R['toe' + s], dirA(g[0] + g[1] + 1.45, 0));
    });
    // tay
    [['R', p.armF, 1], ['L', p.armB, -1]].forEach(([s, g, side]) => {
      const a1 = g[0] + lean;
      aim(R['arm' + s], R['fore' + s], dirA(a1, side * 0.32));
      aim(R['fore' + s], R['hand' + s], dirA(a1 + g[1], -side * 0.18));
    });
  }

  const _tmpQ = new T.Quaternion();
  function animate(F, o, now) {
    // 1. root ở gốc, xương về tư thế gốc
    F.root.position.set(0, 0, 0); F.root.rotation.set(0, 0, 0); F.root.scale.set(1, 1, 1);
    F.rotG.position.set(0, 0, 0); F.rotG.rotation.set(0, 0, 0);
    F.spinG.position.set(0, 0, 0); F.spinG.rotation.set(0, 0, 0);
    F.body.position.set(0, 0, 0); F.body.rotation.set(0, 0, 0);
    F.bones.forEach((b, i) => { b.quaternion.copy(F.restQ[i]); b.position.copy(F.restP[i]); });
    // 2. tư thế tự xoay xương
    const p = o.pose || {};
    solvePose(F, p);
    // 3. trộn clip mocap (mờ dần vào / ra trong 0,1 giây)
    const pick = pickClip(F, o, now);
    const target = pick ? 1 : 0;
    const dt = Math.min(0.1, Math.max(0, now - (F.lastNow || now)));
    F.lastNow = now;
    F.clipW += Math.sign(target - F.clipW) * Math.min(Math.abs(target - F.clipW), dt / 0.1);
    if (pick) { F.lastClip = pick.a; F.lastT = pick.t; }
    const useClip = F.clipW > 0.001 && F.lastClip;
    if (useClip) {
      const procQ = F.bones.map((b) => b.quaternion.clone()); const procP = F.bones.map((b) => b.position.clone());
      Object.values(F.actions).forEach((a) => { if (a) a.setEffectiveWeight(a === F.lastClip ? 1 : 0); });
      F.lastClip.time = F.lastT;
      F.mixer.update(0);
      const w = F.clipW;
      F.bones.forEach((b, i) => {
        _tmpQ.copy(procQ[i]).slerp(b.quaternion, w); b.quaternion.copy(_tmpQ);
        b.position.lerpVectors(procP[i], b.position, w);
      });
    }
    // 4. ngã / lộn vòng / xoay người (chỉ khi không có clip lo việc đó)
    const clipBody = useClip && F.clipW > 0.5 && ['fall', 'down', 'ko', 'rise'].includes(F.stKey);
    const kk = p.rot && !clipBody ? Math.min(1, Math.abs(p.rot) / (Math.PI / 2)) : 0;
    F.rotG.position.y = kk * 12; F.rotG.rotation.z = clipBody ? 0 : -(p.rot || 0);
    if (p.spin) { F.spinG.position.y = 62; F.spinG.rotation.z = -p.spin; F.body.position.y = -62; }
    if (p.spinX !== undefined) F.body.rotation.y = 2 * Math.PI * (1 - (p.spinX + 1) / 2);
    F.root.updateMatrixWorld(true);
    // 5. đặt điểm thấp nhất của cơ thể chạm sàn (ngồi, nằm, ngã đều đúng)
    const low = lowestBone(F.rig);
    return F.restLow - low;
  }

  function place(F, o, now) {
    const dy = animate(F, o, now);
    F.root.position.set(o.x, (o.y || 0) + dy + (o.pose && o.pose.lift > 0 ? o.pose.lift : 0), 0);
    F.root.rotation.set(0, -o.face * 0.42, 0);        // đứng nghiêng ¾ về phía camera
    F.root.scale.set(o.face * (o.sx || 1), o.sy || 1, o.sx || 1);
    setTint(F, o.tint || '', o.tintK ?? 1);
  }

  // Đổi màu tạm: flash (trúng đòn) | white (sét) | burn (cháy đen) | ice (đóng băng).
  const WHITE = new T.Color('#ffffff'); const BLACK = new T.Color('#000000'); const ICE = new T.Color('#9fd8ff');
  function setTint(F, mode, k) {
    const key = mode + ':' + (mode ? Math.round(k * 20) : 0);
    if (F.tint === key) return;
    F.tint = key;
    F.base.forEach(({ m, c, e, ei }) => {
      m.color.copy(c); m.emissive.copy(e); m.emissiveIntensity = ei;
      if (mode === 'flash') { m.emissive.copy(WHITE); m.emissiveIntensity = 0.5 * k; }
      else if (mode === 'white') { m.color.copy(WHITE); m.emissive.copy(WHITE); m.emissiveIntensity = 1.2; }
      else if (mode === 'burn') { m.color.lerp(BLACK, 0.88 * k); m.emissiveIntensity *= 1 - k; }
      else if (mode === 'ice') { m.color.lerp(ICE, 0.55); m.emissive.copy(ICE); m.emissiveIntensity = 0.25; }
    });
  }

  // ---------------------------------------------------------------- ánh sáng, sàn
  function makeLights(scene) {
    const hemi = new T.HemisphereLight('#c8b8a8', '#1a0c08', 0.45);
    const key = new T.DirectionalLight('#fff1dc', 1.25); key.position.set(-250, 420, 520);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -420, right: 420, top: 260, bottom: -60, near: 10, far: 2500 });
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.6;
    scene.add(key.target);
    const fill = new T.DirectionalLight('#8090b0', 0.3); fill.position.set(300, 120, 400);
    const rim = new T.DirectionalLight('#ff7a3a', 1.6); rim.position.set(150, 260, -500);
    scene.add(hemi, key, fill, rim);
    return { hemi, key, fill, rim };
  }
  function floorTexture(kind) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const P = {
      stone: ['#4a3d38', '#3a2f2b', 'rgba(0,0,0,.55)'], wood: ['#4a3322', '#3a2618', 'rgba(0,0,0,.6)'],
      dark: ['#33291f', '#261e17', 'rgba(0,0,0,.65)'], bridge: ['#6a6460', '#55504c', 'rgba(0,0,0,.5)'],
    }[kind];
    g.fillStyle = P[0]; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.06})`; g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3); }
    g.strokeStyle = P[2]; g.lineWidth = 3;
    if (kind === 'wood') {
      for (let y = 0; y <= 256; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
      for (let y = 0; y < 256; y += 32) { const x = (y * 7) % 256; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke(); }
    } else {
      for (let y = 0; y <= 256; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
      for (let y = 0; y < 256; y += 64) for (let x = (y / 64) % 2 ? 0 : 64; x <= 256; x += 128) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 64); g.stroke(); }
      g.fillStyle = P[1];
      for (let i = 0; i < 6; i++) g.fillRect((i * 97) % 256, (i * 61) % 256, 50, 40);
    }
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }
  const STAGE_3D = [
    { floor: 'stone', fog: '#3a0c08', rim: '#ff6a2a', key: '#ffe2c0' },
    { floor: 'wood', fog: '#0c1a20', rim: '#7ab8ff', key: '#c8dcff' },
    { floor: 'dark', fog: '#2a0e06', rim: '#ff7a20', key: '#ffd0a0' },
    { floor: 'bridge', fog: '#1a1430', rim: '#b8a8ff', key: '#d8d0ff' },
  ];
  function setupRenderer(renderer, scene) {
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    if (T.RoomEnvironment) {
      const pm = new T.PMREMGenerator(renderer);
      scene.environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
      pm.dispose();
    }
  }

  // ---------------------------------------------------------------- màn chính
  function create(canvas) {
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setClearColor('#000000');
    const scene = new T.Scene();
    setupRenderer(renderer, scene);
    loadManifest();
    const camera = new T.PerspectiveCamera(FOV, 16 / 9, 1, 9000);
    scene.add(camera);
    const lights = makeLights(scene);
    // nền xa: gắn vào camera (luôn phủ kín khung hình), trượt nhẹ theo camera tạo cảm giác xa
    const bgTex = new T.CanvasTexture(document.createElement('canvas'));
    bgTex.encoding = T.sRGBEncoding;
    const bg = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: bgTex, depthWrite: false, fog: false }));
    bg.renderOrder = -10; camera.add(bg);
    // sàn
    const floorTex = { stone: floorTexture('stone'), wood: floorTexture('wood'), dark: floorTexture('dark'), bridge: floorTexture('bridge') };
    const floorMat = new T.MeshStandardMaterial({ map: floorTex.stone, roughness: 0.85, metalness: 0.05 });
    const floor = new T.Mesh(new T.PlaneGeometry(7000, 6000), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(500, 0, -1000);
    floor.receiveShadow = true;
    scene.add(floor);
    // The Pit: cầu hẹp + vực tối
    const abyss = new T.Mesh(new T.PlaneGeometry(9000, 4000), new T.MeshBasicMaterial({ color: '#030205' }));
    abyss.rotation.x = -Math.PI / 2; abyss.position.set(500, -420, -1200); scene.add(abyss);
    const spikes = new T.Group();
    const spikeM = new T.MeshStandardMaterial({ color: '#5a5a62', metalness: 0.6, roughness: 0.4 });
    for (let i = 0; i < 70; i++) {
      const s = new T.Mesh(G.cone, spikeM); s.scale.set(9, 60, 9);
      s.position.set(-900 + (i % 35) * 70 + (i > 34 ? 35 : 0), -390, i > 34 ? -160 : 120);
      spikes.add(s);
    }
    scene.add(spikes);
    // bóng tiếp xúc dưới chân (thêm vào bóng đổ thật) + vết máu
    const shadowMat = new T.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false });
    const shadows = [0, 1].map(() => { const m = new T.Mesh(G.disc, shadowMat); m.rotation.x = -Math.PI / 2; scene.add(m); return m; });
    const stainMat = new T.MeshBasicMaterial({ color: '#5a0000', transparent: true, opacity: 0.85, depthWrite: false });
    const stains = [];
    const fighters = new Map();
    let stage = -1;
    let vsMode = false;

    function setStage(i) {
      if (i === stage) return;
      stage = i;
      const st = STAGE_3D[i] || STAGE_3D[0];
      const pit = i === 3;
      floorMat.map = floorTex[st.floor]; floorMat.needsUpdate = true;
      floor.geometry.dispose();
      floor.geometry = pit ? new T.PlaneGeometry(7000, 150) : new T.PlaneGeometry(7000, 6000);
      floor.position.z = pit ? 0 : -1000;
      floorMat.map.repeat.set(7000 / (pit ? 90 : 130), (pit ? 150 : 6000) / (pit ? 90 : 130));
      abyss.visible = spikes.visible = pit;
      scene.fog = new T.Fog(st.fog, 1600, 5200);
      renderer.setClearColor(st.fog);
      lights.rim.color.set(st.rim); lights.key.color.set(st.key);
    }
    function setBackground(c, horizonRow) {
      bgTex.image = c; bgTex.needsUpdate = true;
      bg.userData.horizon = horizonRow;
    }
    function fighter(o) {
      const tpl = templateFor(o.char);
      if (!tpl) return null;
      let F = fighters.get(o.key);
      if (!F || F.look !== o.look || F.tpl !== tpl) {
        if (F) { scene.remove(F.root); disposeFighter(F); }
        F = buildFighter(tpl, o.look);
        fighters.set(o.key, F);
        scene.add(F.root);
      }
      return F;
    }
    function prune(keep) {
      for (const [k, F] of fighters) if (!keep.has(k)) { scene.remove(F.root); disposeFighter(F); fighters.delete(k); }
    }

    // v: { cssW, cssH, dpr, s, ox, oy, camX, zoom, floorY }
    // list: [{ key, look, char, x, y, face, pose, st, mv, prog, back, flip, jumpProg, sx, sy, tint, tintK, hidden }]
    function render(v, list, stainList) {
      if (renderer.getPixelRatio() !== v.dpr) renderer.setPixelRatio(v.dpr);
      const size = renderer.getSize(new T.Vector2());
      if (size.x !== v.cssW || size.y !== v.cssH) renderer.setSize(v.cssW, v.cssH, false);
      const k = v.zoom * v.s;                       // điểm ảnh CSS cho mỗi đơn vị trên mặt phẳng z = 0
      const f = (v.cssH / 2) / Math.tan((FOV * Math.PI) / 360);
      const D = f / k;
      camera.fov = FOV; camera.aspect = v.cssW / v.cssH; camera.updateProjectionMatrix();
      camera.position.set(v.camX + (v.cssW / 2 - v.ox * v.s) / k, ((v.floorY + v.oy) * v.s - v.cssH / 2) / k, D);
      camera.rotation.set(0, 0, 0);
      // nền xa phủ kín khung hình; hàng chân trời của ảnh nền đặt ngang tâm màn hình (= độ cao camera)
      const dist = 6000;
      const half = dist * Math.tan((FOV * Math.PI) / 360);
      const hz = bg.userData.horizon || 0.97;
      const h = (half / hz) * 1.04;
      const w = h * (bgTex.image && bgTex.image.width ? bgTex.image.width / bgTex.image.height : 2.5);
      bg.scale.set(w, h, 1);
      bg.position.set(-((v.camX - 500) / 1000) * w * 0.08, hz * h - h / 2, -dist);
      bg.visible = !vsMode;
      lights.key.position.set(v.camX + 250, 420, 520); lights.key.target.position.set(v.camX + 500 / v.zoom, 0, 0);
      const now = performance.now() / 1000;
      const keep = new Set();
      list.forEach((o, i) => {
        const F = fighter(o);
        const sh = shadows[i];
        if (!F) { if (sh) sh.visible = false; return; }
        keep.add(o.key);
        F.root.visible = !o.hidden;
        if (!o.hidden) place(F, o, now);
        if (sh) {
          sh.visible = !o.hidden && !vsMode;
          const kk = Math.max(0.35, 1 - (o.y || 0) / 300);
          sh.position.set(o.x, 0.6, 0); sh.scale.set(30 * kk * (o.sx || 1), 13 * kk, 1);
        }
      });
      for (let i = list.length; i < shadows.length; i++) shadows[i].visible = false;
      prune(keep);
      while (stains.length < stainList.length) { const m = new T.Mesh(G.disc, stainMat); m.rotation.x = -Math.PI / 2; scene.add(m); stains.push(m); }
      stains.forEach((m, i) => {
        const st = stainList[i];
        m.visible = !!st && !vsMode;
        if (st) { m.position.set(st.x, 0.5 + i * 0.01, st.z || 0); m.scale.set(st.r * 2.4, st.r * 1.6, 1); }
      });
      renderer.render(scene, camera);
    }
    // Màn VS: chỉ có hai võ sĩ trên nền đỏ thẫm.
    function renderVS(v, list) {
      vsMode = true;
      const keepFog = scene.fog; scene.fog = null;
      floor.visible = false; abyss.visible = false; spikes.visible = false;
      scene.background = new T.Color('#2a0303');
      render(v, list, []);
      scene.background = null; scene.fog = keepFog;
      floor.visible = true; abyss.visible = spikes.visible = stage === 3;
      vsMode = false;
    }
    // Vị trí bàn tay phải (toạ độ sân đấu) — để vẽ quả cầu năng lượng đúng chỗ.
    function handPos(key) {
      const F = fighters.get(key);
      if (!F || !F.rig.handR) return null;
      const v3 = F.rig.handR.getWorldPosition(V());
      return [v3.x, v3.y];
    }
    return { render, renderVS, setStage, setBackground, handPos, renderer };
  }

  // ---------------------------------------------------------------- ảnh chân dung + võ sĩ xem trước (canvas riêng)
  function createStudio(canvas, opts = {}) {
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !!opts.snapshot });
    const scene = new T.Scene();
    setupRenderer(renderer, scene);
    renderer.shadowMap.enabled = false;
    loadManifest();
    scene.background = new T.Color(opts.bg || '#1a0404');
    const camera = new T.PerspectiveCamera(30, 1, 1, 3000);
    makeLights(scene);
    let F = null;
    function show(look, pose, face = 1, extra = {}) {
      const tpl = templateFor(extra.char);
      if (!tpl) return false;
      if (!F || F.look !== look || F.tpl !== tpl) {
        if (F) { scene.remove(F.root); disposeFighter(F); }
        F = buildFighter(tpl, look);
        scene.add(F.root);
      }
      place(F, { x: 0, y: 0, face, pose, st: 'idle', ...extra }, performance.now() / 1000);
      return true;
    }
    function render(w, h, dpr, mode) {
      if (!F) return false;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      if (mode === 'head' && F.rig.head) {
        const hp = F.rig.head.getWorldPosition(V());
        camera.fov = 24; camera.position.set(hp.x + 22, hp.y + 9, 70); camera.lookAt(hp.x + 4, hp.y + 7, hp.z);
      } else { camera.fov = 30; camera.position.set(0, 72, 330); camera.lookAt(0, 66, 0); }
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      return true;
    }
    return { show, render, renderer };
  }

  window.MK3D = {
    create, createStudio,
    onModels: (fn) => { A.listeners.push(fn); },   // gọi lại khi model / animation tải xong
    ready: () => !!A.base,
  };
})();
