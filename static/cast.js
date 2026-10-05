/* Dàn nhân vật cho các game bàn cờ: mỗi người chơi là một nhân vật toàn thân đứng trên “sân khấu”,
 * người đang tới lượt được chiếu đèn và nhún nhảy, có thể vui / buồn khi có chuyện xảy ra.
 *
 *   const cast = new Cast(el, { onClick: (pid, el) => … });
 *   cast.update([{ id, name, look, color, sub, badge, turn, dim, me, bot }]);
 *   cast.react(pid, 'cheer' | 'sad');
 *   cast.anchor(pid)  // phần tử để gắn bong bóng thoại / hiệu ứng
 */
(function () {
  const A = window.Avatar;
  const esc = window.Platform.esc;

  function Cast(root, { onClick } = {}) {
    this.root = root;
    this.onClick = onClick;
    this.items = new Map();
    root.classList.add('cast');
  }

  Cast.prototype.update = function (list) {
    const ids = new Set(list.map((p) => p.id));
    for (const [id, it] of this.items) {
      if (!ids.has(id)) { it.el.remove(); this.items.delete(id); }
    }
    list.forEach((p, i) => {
      let it = this.items.get(p.id);
      if (!it) {
        const el = document.createElement('div');
        el.className = 'cast-p';
        el.dataset.pid = p.id;
        el.style.setProperty('--d', `${(Math.random() * -3).toFixed(2)}s`);
        el.innerHTML = `<div class="cast-spot"></div><div class="cast-fig"></div><div class="cast-badge"></div>
          <div class="cast-name"></div><div class="cast-sub"></div>`;
        el.addEventListener('click', (e) => { e.stopPropagation(); if (this.onClick) this.onClick(p.id, el); });
        it = { el, fig: el.querySelector('.cast-fig'), name: el.querySelector('.cast-name'),
          sub: el.querySelector('.cast-sub'), badge: el.querySelector('.cast-badge'), look: null, cache: {} };
        this.items.set(p.id, it);
      }
      if (this.root.children[i] !== it.el) this.root.insertBefore(it.el, this.root.children[i] || null);
      const lk = JSON.stringify(p.look || null);
      if (it.look !== lk) { it.fig.innerHTML = A.svg(p.look, { seed: p.id }); it.look = lk; }
      it.el.style.setProperty('--pc', p.color || 'rgba(255,255,255,.5)');
      it.el.classList.toggle('turn', !!p.turn);
      it.el.classList.toggle('dim', !!p.dim);
      it.el.classList.toggle('me', !!p.me);
      const set = (key, node, html) => { if (it.cache[key] !== html) { node.innerHTML = html; it.cache[key] = html; } };
      set('name', it.name, `${p.me ? 'Bạn' : esc(p.name)}${p.bot ? ' 🤖' : ''}`);
      set('sub', it.sub, p.sub || '');
      set('badge', it.badge, p.badge || '');
    });
  };

  Cast.prototype.react = function (pid, kind) {
    const it = this.items.get(pid);
    if (!it) return;
    it.el.classList.remove('cheer', 'sad');
    void it.el.offsetWidth;
    it.el.classList.add(kind);
    clearTimeout(it.reactTimer);
    it.reactTimer = setTimeout(() => it.el.classList.remove(kind), kind === 'sad' ? 2200 : 1500);
  };

  Cast.prototype.anchor = function (pid) {
    const it = this.items.get(pid);
    return it ? it.fig : null;
  };

  window.Cast = Cast;
})();
