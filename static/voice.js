/* Voice chat dùng chung cho mọi game: WebRTC dạng lưới (mỗi cặp người một kết nối),
 * máy chủ chỉ chuyển tín hiệu. Game quyết định ai nói được với ai qua `voice.to/from`
 * trong mỗi bản cập nhật trạng thái. */
(function () {
  const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
  const SPEAK_LEVEL = 0.035;

  function Voice({ sendRaw, onChange, onSpeaking }) {
    this.sendRaw = sendRaw;
    this.onChange = onChange || (() => {});
    this.onSpeaking = onSpeaking || (() => {});
    this.on = false;
    this.muted = false;
    this.deaf = false;
    this.listenOnly = false;
    this.error = null;
    this.myId = null;
    this.info = { peers: [], muted: [], to: [], from: [] };
    this.local = null;
    this.ctx = null;
    this.localMeter = null;
    this.peers = new Map();
    this.speaking = new Set();
    this.loop = null;
  }

  Voice.supported = !!window.RTCPeerConnection;
  Voice.micAvailable = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  Voice.prototype.status = function () {
    return {
      on: this.on, muted: this.muted, deaf: this.deaf, listenOnly: this.listenOnly, error: this.error,
      canTalk: this.info.to.length > 0, peers: this.info.peers.length,
      connected: [...this.peers.values()].filter((p) => p.pc.connectionState === 'connected').length,
    };
  };

  Voice.prototype.enable = async function () {
    if (this.on) return;
    this.error = null;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } catch (e) { this.ctx = null; }
    this.local = null;
    if (Voice.micAvailable()) {
      try {
        this.local = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (e) {
        this.error = e && e.name === 'NotAllowedError' ? 'denied' : 'nomic';
      }
    } else {
      this.error = 'insecure';
    }
    this.listenOnly = !this.local;
    if (this.local && this.ctx) this.localMeter = this.meter(this.local);
    this.on = true;
    this.muted = false;
    this.sendRaw({ type: 'voice', on: true, muted: false });
    this.loop = setInterval(() => this.tick(), 150);
    this.onChange();
  };

  Voice.prototype.disable = function () {
    if (!this.on) return;
    this.on = false;
    [...this.peers.keys()].forEach((pid) => this.closePeer(pid));
    if (this.local) this.local.getTracks().forEach((t) => t.stop());
    this.local = null;
    this.localMeter = null;
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    clearInterval(this.loop);
    this.speaking.forEach((pid) => this.onSpeaking(pid, false));
    this.speaking.clear();
    this.sendRaw({ type: 'voice', on: false });
    this.onChange();
  };

  Voice.prototype.setMuted = function (m) {
    this.muted = m;
    this.sendRaw({ type: 'voice', on: this.on, muted: m });
    this.applyGating();
    this.onChange();
  };

  Voice.prototype.setDeaf = function (d) {
    this.deaf = d;
    this.applyGating();
    this.onChange();
  };

  // Gọi mỗi khi có trạng thái mới từ máy chủ.
  Voice.prototype.update = function (myId, info) {
    this.myId = myId;
    this.info = info || { peers: [], muted: [], to: [], from: [] };
    if (!this.on) return;
    if (!this.info.peers.includes(myId)) {
      // máy chủ chưa biết mình đang bật voice (vd: vừa kết nối lại)
      this.sendRaw({ type: 'voice', on: true, muted: this.muted });
    }
    const others = this.info.peers.filter((p) => p !== myId);
    [...this.peers.keys()].forEach((pid) => { if (!others.includes(pid)) this.closePeer(pid); });
    others.forEach((pid) => {
      if (!this.peers.has(pid)) {
        this.createPeer(pid);
        if (myId < pid) this.negotiate(pid);
      }
    });
    this.applyGating();
  };

  Voice.prototype.createPeer = function (pid) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const audio = new Audio();
    audio.autoplay = true;
    const peer = { pc, audio, track: null, pending: [], meter: null };
    if (this.local) {
      peer.track = this.local.getAudioTracks()[0].clone();
      pc.addTrack(peer.track, this.local);
    } else {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendRaw({ type: 'rtc', to: pid, data: { candidate: e.candidate } });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      audio.srcObject = stream;
      audio.play().catch(() => {});
      if (this.ctx) peer.meter = this.meter(stream);
      this.applyGating();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this.closePeer(pid);
        setTimeout(() => this.update(this.myId, this.info), 1500);
      }
      this.onChange();
    };
    this.peers.set(pid, peer);
    return peer;
  };

  Voice.prototype.closePeer = function (pid) {
    const peer = this.peers.get(pid);
    if (!peer) return;
    this.peers.delete(pid);
    try { peer.pc.close(); } catch (e) { /* bỏ qua */ }
    if (peer.track) peer.track.stop();
    peer.audio.srcObject = null;
    if (this.speaking.delete(pid)) this.onSpeaking(pid, false);
  };

  Voice.prototype.negotiate = async function (pid) {
    const peer = this.peers.get(pid);
    if (!peer) return;
    try {
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      this.sendRaw({ type: 'rtc', to: pid, data: { sdp: peer.pc.localDescription } });
    } catch (e) { console.warn('voice offer', e); }
  };

  Voice.prototype.signal = async function (from, data) {
    if (!this.on || !data) return;
    const peer = this.peers.get(from) || this.createPeer(from);
    const pc = peer.pc;
    try {
      if (data.sdp) {
        if (data.sdp.type === 'offer' && pc.signalingState !== 'stable') {
          if (this.myId < from) return; // mình là bên gửi offer — bỏ qua offer trùng
          await pc.setLocalDescription({ type: 'rollback' });
        }
        await pc.setRemoteDescription(data.sdp);
        for (const c of peer.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        if (data.sdp.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          this.sendRaw({ type: 'rtc', to: from, data: { sdp: pc.localDescription } });
        }
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
        else peer.pending.push(data.candidate);
      }
    } catch (e) { console.warn('voice signal', e); }
    this.applyGating();
  };

  // Bật/tắt đường tiếng theo luật game: mỗi người một bản sao track mic.
  Voice.prototype.applyGating = function () {
    for (const [pid, peer] of this.peers) {
      if (peer.track) peer.track.enabled = !this.muted && this.info.to.includes(pid);
      peer.audio.muted = this.deaf || !this.info.from.includes(pid);
    }
  };

  Voice.prototype.meter = function (stream) {
    try {
      const src = this.ctx.createMediaStreamSource(stream);
      const an = this.ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Float32Array(an.fftSize);
      return () => {
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        return Math.sqrt(sum / buf.length);
      };
    } catch (e) { return null; }
  };

  Voice.prototype.tick = function () {
    const t = Date.now();
    this.loud = this.loud || {};
    if (this.localMeter && !this.muted && this.info.to.length && this.localMeter() > SPEAK_LEVEL) this.loud[this.myId] = t;
    for (const [pid, peer] of this.peers) {
      if (peer.meter && !peer.audio.muted && this.info.from.includes(pid) && peer.meter() > SPEAK_LEVEL) this.loud[pid] = t;
    }
    const now = new Set(Object.keys(this.loud).filter((pid) => t - this.loud[pid] < 400 &&
      (pid === this.myId || this.peers.has(pid))));
    now.forEach((pid) => { if (!this.speaking.has(pid)) this.onSpeaking(pid, true); });
    this.speaking.forEach((pid) => { if (!now.has(pid)) this.onSpeaking(pid, false); });
    this.speaking = now;
  };

  window.GameVoice = Voice;
})();
