/* Bong bóng thoại trên đầu người chơi khi họ chat (giống cảnh đống lửa của Ma Sói).
 *
 *   const bubbles = new ChatBubbles({ anchor: (pid) => element | null });
 *   bubbles.update(S.chat);   // gọi mỗi lần nhận trạng thái mới
 *
 * Bong bóng nằm ở một lớp riêng (position: fixed) và được đặt lại vị trí mỗi khung hình theo
 * phần tử `anchor(pid)`, nên vẫn bám đúng người nói dù giao diện bàn chơi bị vẽ lại hay trang cuộn. */
(function () {
  const MAX_LEN = 90;

  function ChatBubbles({ anchor }) {
    this.anchor = anchor;
    this.lastId = null;
    this.items = new Map();  // pid -> { el, until }
    this.raf = null;
    this.layer = document.createElement('div');
    this.layer.className = 'gh-say-layer';
    document.body.appendChild(this.layer);
  }

  ChatBubbles.prototype.update = function (chat) {
    const msgs = chat || [];
    const lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
    if (this.lastId === null) { this.lastId = lastId; return; }  // lần đầu: không bật lại tin cũ
    msgs.filter((m) => m.id > this.lastId && m.pid && m.channel !== 'system').forEach((m) => this.say(m.pid, m.text, m.channel));
    this.lastId = Math.max(this.lastId, lastId);
  };

  ChatBubbles.prototype.say = function (pid, text, channel) {
    let it = this.items.get(pid);
    if (!it) {
      const el = document.createElement('div');
      this.layer.appendChild(el);
      it = { el };
      this.items.set(pid, it);
    }
    it.el.textContent = text.length > MAX_LEN ? text.slice(0, MAX_LEN - 2) + '…' : text;
    it.el.className = 'gh-say ' + (channel && channel !== 'all' ? channel : '');
    void it.el.offsetWidth;  // chạy lại hiệu ứng bật lên
    it.el.classList.add('show');
    it.at = Date.now();
    it.until = it.at + 4500 + Math.min(4000, text.length * 40);
    this.loop();
  };

  ChatBubbles.prototype.loop = function () {
    if (this.raf) return;
    const step = () => {
      const now = Date.now();
      const placed = [];
      // Bong bóng cũ giữ chỗ trước, bong bóng mới hơn bị chồng lên thì đẩy lên trên.
      const list = [...this.items].sort((a, b) => a[1].at - b[1].at);
      for (const [pid, it] of list) {
        if (now > it.until + 300) { it.el.remove(); this.items.delete(pid); continue; }
        if (now > it.until) it.el.classList.remove('show');
        const a = this.anchor(pid);
        const r = a && a.getBoundingClientRect();
        if (!r || (!r.width && !r.height)) { it.el.style.visibility = 'hidden'; continue; }
        it.el.style.visibility = '';
        const w = it.el.offsetWidth;
        const h = it.el.offsetHeight;
        const ax = r.left + r.width / 2;
        const clampX = (v) => Math.max(8 + w / 2, Math.min(window.innerWidth - 8 - w / 2, v));
        let x = clampX(ax);
        let bottom = r.top - 6;
        const hit = (bx, bb) => placed.find((o) => Math.abs(o.x - bx) < (o.w + w) / 2 + 4
          && bb > o.bottom - o.h - 4 && bb - h < o.bottom + 4);
        // Bị chồng: thử dịch sang ngang (về phía người nói), không được thì đẩy lên trên.
        for (let guard = 0, o = hit(x, bottom); o && guard < 10; guard++, o = hit(x, bottom)) {
          const side = ax < o.x ? -1 : 1;
          const nx = o.x + side * ((o.w + w) / 2 + 6);
          if (nx === clampX(nx) && !hit(nx, bottom)) { x = nx; break; }
          bottom = o.bottom - o.h - 14;
        }
        placed.push({ x, w, h, bottom });
        const tip = Math.max(-(w / 2 - 14), Math.min(w / 2 - 14, ax - x));
        it.el.style.setProperty('--tip', `${tip}px`);
        it.el.style.left = `${x}px`;
        it.el.style.top = `${bottom}px`;
      }
      this.raf = this.items.size ? requestAnimationFrame(step) : null;
    };
    this.raf = requestAnimationFrame(step);
  };

  window.ChatBubbles = ChatBubbles;
})();
