'use strict';

/* ======================================================================
 * Go Meet client
 *  - Sign in (Google account chooser, or a guest name when Google is not configured)
 *  - Then open camera + mic and join the meeting directly (no lobby)
 *  - WebRTC mesh: every participant connects to every other participant.
 *    Each connection has 3 fixed transceivers: [0] mic, [1] camera, [2] screen.
 *    Toggling devices / screen sharing uses replaceTrack, so no renegotiation.
 *  - GitHub panel: browse linked repos, share issues/PRs/commits into the chat, create issues
 * ==================================================================== */

const $ = (id) => document.getElementById(id);
const EMOJIS = ['💖', '👍', '🎉', '👏', '😂', '😮', '😢', '🤔', '👎'];
const AUDIO = 0, CAM = 1, SCREEN = 2;

const state = {
  config: null,
  tokenClient: null,
  pendingSignIn: null,
  auth: null,              // { accessToken } or { name }
  roomId: null,
  socket: null,
  self: null,
  joined: false,
  mic: true,
  cam: true,
  hand: false,
  audioTrack: null,
  videoTrack: null,
  screenTrack: null,
  participants: new Map(), // socketId -> info
  peers: new Map(),        // socketId -> { pc, initiator, pendingIce, camStream, screenStream }
  tiles: new Map(),        // tile key -> tile object (key: socketId or socketId + ':screen')
  pinned: null,
  panel: null,
  audioCtx: null,
  meters: new Map(),       // tile key -> { analyser, data, source }
  unread: 0,
  chatLog: [],             // plain-text transcript, used to attach the chat to a GitHub issue
  gh: { repo: null, kind: 'issues', loaded: false },
};

/* ---------------------------- Utilities ---------------------------- */

function show(viewId) {
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('hidden', v.id !== viewId);
}

function newMeetingCode() {
  const letters = 'abcdefghijkmnopqrstuvwxyz';
  const pick = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => letters[b % letters.length]).join('');
  return `${pick(3)}-${pick(4)}-${pick(3)}`;
}

function parseCode(text) {
  const m = String(text).toLowerCase().match(/[a-z]{3}-[a-z]{4}-[a-z]{3}/);
  return m ? m[0] : null;
}

function timeText(d = new Date()) {
  return d.toLocaleTimeString('ar', { hour: 'numeric', minute: '2-digit' });
}

function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

function colorFor(id) {
  const colors = ['#1a73e8', '#e37400', '#188038', '#d93025', '#9334e6', '#c5221f', '#007b83', '#b06000'];
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return colors[h % colors.length];
}

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  $('toasts').append(el);
  setTimeout(() => el.remove(), 4000);
}

function chime(freqs = [660, 880]) {
  if (!state.audioCtx) return;
  const ctx = state.audioCtx;
  freqs.forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.12);
    g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + i * 0.12 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.25);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + i * 0.12);
    o.stop(ctx.currentTime + i * 0.12 + 0.3);
  });
}

/* ------------------------------ Boot ------------------------------- */

async function boot() {
  setInterval(() => {
    $('clock').textContent = new Date().toLocaleString('ar', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    $('meetClock').textContent = timeText();
  }, 1000);

  try {
    state.config = await (await fetch('/config')).json();
  } catch {
    state.config = { googleClientId: '', iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  }
  if (state.config.googleClientId) initGoogle();
  setupGithub();

  const code = parseCode(location.pathname);
  if (code) {
    $('joinCode').value = code;
    $('joinCode').dispatchEvent(new Event('input'));
    $('joinForm').querySelector('button').focus();
  }
  if (!window.isSecureContext) {
    $('homeError').textContent = 'تحتاج الكاميرا والمايك إلى اتصال HTTPS (أو localhost).';
  }
}

function initGoogle() {
  const tryInit = () => {
    if (!window.google?.accounts?.oauth2) return setTimeout(tryInit, 100);
    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: state.config.googleClientId,
      scope: 'openid email profile',
      prompt: 'select_account',
      callback: (resp) => {
        const p = state.pendingSignIn;
        state.pendingSignIn = null;
        if (!p) return;
        if (resp.error) p.reject(new Error(resp.error_description || resp.error));
        else p.resolve({ accessToken: resp.access_token });
      },
      error_callback: (err) => {
        const p = state.pendingSignIn;
        state.pendingSignIn = null;
        if (p) p.reject(new Error(err.type === 'popup_closed' ? 'تم إغلاق نافذة اختيار الحساب' : err.message || err.type));
      },
    });
  };
  tryInit();
}

// Must be called synchronously from a click so the Google popup is not blocked.
function signIn() {
  if (state.config.googleClientId) {
    if (!state.tokenClient) return Promise.reject(new Error('خدمة Google لم تُحمَّل بعد، حاول مرة أخرى'));
    return new Promise((resolve, reject) => {
      state.pendingSignIn = { resolve, reject };
      state.tokenClient.requestAccessToken({ prompt: 'select_account' });
    });
  }
  return new Promise((resolve, reject) => {
    const dlg = $('guestDialog');
    try { $('guestName').value = localStorage.getItem('meet.name') || ''; } catch {}
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', function onClose() {
      dlg.removeEventListener('close', onClose);
      const name = $('guestName').value.trim();
      if (dlg.returnValue !== 'ok' || !name) return reject(new Error(''));
      try { localStorage.setItem('meet.name', name); } catch {}
      resolve({ name });
    });
  });
}

async function startMeeting(roomId) {
  $('homeError').textContent = '';
  // AudioContext must be created inside the user gesture.
  if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  state.audioCtx.resume();
  let auth;
  try {
    auth = await signIn();
  } catch (err) {
    $('homeError').textContent = err.message;
    return;
  }
  state.auth = auth;
  state.roomId = roomId;
  await enterMeeting();
}

async function enterMeeting() {
  show('joining');
  $('joiningText').textContent = 'جارٍ تشغيل الكاميرا والميكروفون…';
  await openMedia();
  $('joiningText').textContent = 'جارٍ الانضمام…';
  history.replaceState(null, '', '/' + state.roomId);
  connectSocket();
}

/* ------------------------------ Media ------------------------------ */

const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const VIDEO_CONSTRAINTS = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'user' };

async function openMedia() {
  const tries = [
    { audio: AUDIO_CONSTRAINTS, video: VIDEO_CONSTRAINTS },
    { audio: AUDIO_CONSTRAINTS, video: false },
    { audio: false, video: VIDEO_CONSTRAINTS },
  ];
  let stream = null;
  for (const c of tries) {
    try { stream = await navigator.mediaDevices.getUserMedia(c); break; } catch {}
  }
  state.audioTrack = stream?.getAudioTracks()[0] || null;
  state.videoTrack = stream?.getVideoTracks()[0] || null;
  state.mic = !!state.audioTrack;
  state.cam = !!state.videoTrack;
  if (!stream) setTimeout(() => toast('لم يتم السماح بالوصول إلى الكاميرا أو الميكروفون'), 500);
}

function localCamStream() {
  return new MediaStream([state.audioTrack, state.videoTrack].filter(Boolean));
}

function forEachSender(index, fn) {
  for (const peer of state.peers.values()) {
    const t = peer.pc.getTransceivers()[index];
    if (t) fn(t.sender);
  }
}

async function toggleMic() {
  if (!state.audioTrack) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
      state.audioTrack = s.getAudioTracks()[0];
      forEachSender(AUDIO, (s) => s.replaceTrack(state.audioTrack));
      state.mic = true;
      refreshSelfTile();
    } catch {
      return toast('لا يمكن الوصول إلى الميكروفون. تحقّق من أذونات المتصفح.');
    }
  } else {
    state.mic = !state.mic;
    state.audioTrack.enabled = state.mic;
  }
  syncControls();
  sendState();
}

async function toggleCam() {
  if (state.cam) {
    state.cam = false;
    state.videoTrack?.stop();
    state.videoTrack = null;
    forEachSender(CAM, (s) => s.replaceTrack(null));
  } else {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
      state.videoTrack = s.getVideoTracks()[0];
      forEachSender(CAM, (s) => s.replaceTrack(state.videoTrack));
      state.cam = true;
    } catch {
      return toast('لا يمكن الوصول إلى الكاميرا. تحقّق من أذونات المتصفح.');
    }
  }
  refreshSelfTile();
  syncControls();
  sendState();
}

async function toggleScreen() {
  if (state.screenTrack) return stopScreen();
  if (!navigator.mediaDevices.getDisplayMedia) return toast('متصفحك لا يدعم مشاركة الشاشة');
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
    state.screenTrack = s.getVideoTracks()[0];
    state.screenTrack.contentHint = 'detail';
    state.screenTrack.addEventListener('ended', stopScreen);
    forEachSender(SCREEN, (s) => s.replaceTrack(state.screenTrack));
    const tile = ensureTile(state.self.socketId + ':screen', { ...state.self, screenTile: true, self: true });
    setTileStream(tile, new MediaStream([state.screenTrack]));
    state.pinned = null;
    layout();
  } catch {
    return; // user cancelled the picker
  }
  syncControls();
  sendState();
}

function stopScreen() {
  if (!state.screenTrack) return;
  state.screenTrack.removeEventListener('ended', stopScreen);
  state.screenTrack.stop();
  state.screenTrack = null;
  forEachSender(SCREEN, (s) => s.replaceTrack(null));
  removeTile(state.self.socketId + ':screen');
  syncControls();
  sendState();
}

function toggleHand() {
  state.hand = !state.hand;
  syncControls();
  sendState();
  updateTileBadges(state.self.socketId);
}

function sendState() {
  if (!state.self) return;
  Object.assign(state.self, { mic: state.mic, cam: state.cam, screen: !!state.screenTrack, hand: state.hand });
  state.socket?.emit('state', { mic: state.mic, cam: state.cam, screen: !!state.screenTrack, hand: state.hand });
  updateTileBadges(state.self.socketId);
  renderPeople();
}

/* ----------------------------- Signaling ---------------------------- */

function connectSocket() {
  const socket = io({ transports: ['websocket', 'polling'] });
  state.socket = socket;

  socket.on('connect', () => join());
  socket.on('disconnect', (reason) => {
    if (reason !== 'io client disconnect') toast('انقطع الاتصال، جارٍ إعادة الاتصال…');
  });

  socket.on('participant-joined', (info) => {
    state.participants.set(info.socketId, info);
    ensureTile(info.socketId, info);
    renderPeople();
    toast(`${info.name} انضم إلى الاجتماع`);
    chime([523, 784]);
  });

  socket.on('participant-left', ({ socketId }) => {
    const info = state.participants.get(socketId);
    removePeer(socketId);
    if (info) toast(`${info.name} غادر الاجتماع`);
    chime([784, 523]);
  });

  socket.on('signal', ({ from, data }) => handleSignal(from, data));

  socket.on('state', (s) => {
    const info = state.participants.get(s.socketId);
    if (!info) return;
    const raised = s.hand && !info.hand;
    Object.assign(info, s);
    if (raised) { toast(`${info.name} رفع يده ✋`); chime([880, 1046]); }
    updateTileBadges(s.socketId);
    refreshRemoteTiles(s.socketId);
    renderPeople();
  });

  socket.on('chat', addMessage);
  socket.on('reaction', ({ emoji, name, from }) => floatReaction(emoji, from === state.self?.socketId ? 'أنت' : name));
}

function join() {
  const payload = { roomId: state.roomId, mic: state.mic, cam: state.cam, ...state.auth };
  state.socket.emit('join', payload, (res) => {
    if (res.error) {
      state.socket.disconnect();
      state.socket = null;
      stopLocalMedia();
      show('home');
      $('homeError').textContent = res.error;
      return;
    }
    // On a reconnect the server forgot us; drop the old connections and rebuild them.
    for (const id of [...state.peers.keys()]) removePeer(id);
    for (const key of [...state.tiles.keys()]) removeTile(key);
    state.participants.clear();

    state.self = res.self;
    ensureTile(state.self.socketId, { ...state.self, self: true });
    refreshSelfTile();
    if (state.screenTrack) {
      const t = ensureTile(state.self.socketId + ':screen', { ...state.self, screenTile: true, self: true });
      setTileStream(t, new MediaStream([state.screenTrack]));
    }
    if (state.screenTrack || state.hand) sendState();
    for (const p of res.participants) {
      state.participants.set(p.socketId, p);
      ensureTile(p.socketId, p);
      createPeer(p.socketId, true); // newcomer calls everyone already in the room
    }
    if (!state.joined) {
      state.joined = true;
      show('meeting');
      $('meetCode').textContent = state.roomId;
      if (!res.participants.length) toast('أنت الوحيد هنا. انسخ الرابط وشاركه مع الآخرين.');
    }
    syncControls();
    renderPeople();
    layout();
  });
}

function signal(to, data) {
  state.socket?.emit('signal', { to, data });
}

function createPeer(id, initiator) {
  const pc = new RTCPeerConnection({ iceServers: state.config.iceServers });
  const peer = { pc, initiator, pendingIce: [], camStream: new MediaStream(), screenStream: new MediaStream(), restartTimer: null };
  state.peers.set(id, peer);

  if (initiator) {
    pc.addTransceiver(state.audioTrack || 'audio', { direction: 'sendrecv' });
    pc.addTransceiver(state.videoTrack || 'video', { direction: 'sendrecv' });
    pc.addTransceiver(state.screenTrack || 'video', { direction: 'sendrecv' });
    pc.onnegotiationneeded = async () => {
      try {
        await pc.setLocalDescription();
        signal(id, { description: pc.localDescription });
      } catch (err) { console.error('offer failed', err); }
    };
  }

  pc.onicecandidate = ({ candidate }) => { if (candidate) signal(id, { candidate }); };

  pc.ontrack = ({ track, transceiver }) => {
    const index = pc.getTransceivers().indexOf(transceiver);
    const target = index === SCREEN ? peer.screenStream : peer.camStream;
    target.addTrack(track);
    refreshRemoteTiles(id);
  };

  pc.onconnectionstatechange = () => {
    clearTimeout(peer.restartTimer);
    if (pc.connectionState === 'failed' && initiator) pc.restartIce();
    if (pc.connectionState === 'disconnected' && initiator) {
      peer.restartTimer = setTimeout(() => pc.connectionState === 'disconnected' && pc.restartIce(), 4000);
    }
  };
  return peer;
}

async function handleSignal(from, { description, candidate }) {
  let peer = state.peers.get(from);
  try {
    if (description) {
      if (description.type === 'offer') {
        const fresh = !peer;
        if (!peer) peer = createPeer(from, false);
        await peer.pc.setRemoteDescription(description);
        if (fresh) {
          const tr = peer.pc.getTransceivers();
          const tracks = [state.audioTrack, state.videoTrack, state.screenTrack];
          tr.slice(0, 3).forEach((t, i) => {
            t.direction = 'sendrecv';
            if (tracks[i]) t.sender.replaceTrack(tracks[i]);
          });
        }
        await peer.pc.setLocalDescription();
        signal(from, { description: peer.pc.localDescription });
      } else if (peer) {
        await peer.pc.setRemoteDescription(description);
      }
      if (peer) {
        for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
      }
    } else if (candidate && peer) {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(candidate).catch(() => {});
      else peer.pendingIce.push(candidate);
    }
  } catch (err) {
    console.error('signal error', err);
  }
}

function removePeer(id) {
  const peer = state.peers.get(id);
  if (peer) {
    clearTimeout(peer.restartTimer);
    peer.pc.close();
    state.peers.delete(id);
  }
  state.participants.delete(id);
  removeTile(id);
  removeTile(id + ':screen');
  if (state.pinned === id) state.pinned = null;
  renderPeople();
  layout();
}

/* ------------------------------ Tiles ------------------------------- */

function ensureTile(key, info) {
  let tile = state.tiles.get(key);
  if (tile) return tile;
  const el = document.createElement('div');
  el.className = 'tile cam-off' + (info.self ? ' self' : '') + (info.screenTile ? ' screen' : '');
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  if (info.self) video.muted = true; // never play our own mic back
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  const nameTag = document.createElement('div');
  nameTag.className = 'name-tag';
  const badges = document.createElement('div');
  badges.className = 'tile-badges';
  const pin = document.createElement('button');
  pin.className = 'icon-btn pin';
  pin.title = 'تثبيت';
  pin.innerHTML = '<span class="ms">push_pin</span>';
  pin.onclick = () => { state.pinned = state.pinned === key ? null : key; layout(); };
  el.append(video, avatar, nameTag, badges, pin);
  tile = { key, el, video, avatar, nameTag, badges, pin, info, socketId: key.split(':')[0], screen: !!info.screenTile };
  state.tiles.set(key, tile);

  const name = info.self ? (info.screenTile ? 'أنت (تعرض الشاشة)' : `${info.name} (أنت)`) : (info.screenTile ? `${info.name} (يعرض الشاشة)` : info.name);
  nameTag.textContent = name;
  if (info.picture) {
    avatar.style.backgroundImage = `url("${encodeURI(info.picture)}")`;
  } else {
    avatar.textContent = initials(info.name);
    avatar.style.backgroundColor = colorFor(info.socketId);
  }
  if (info.screenTile) el.classList.remove('cam-off');
  $('grid').append(el);
  updateTileBadges(tile.socketId);
  layout();
  return tile;
}

function removeTile(key) {
  const tile = state.tiles.get(key);
  if (!tile) return;
  tile.video.srcObject = null;
  tile.el.remove();
  state.tiles.delete(key);
  const m = state.meters.get(key);
  if (m) { m.source.disconnect(); state.meters.delete(key); }
  if (state.pinned === key) state.pinned = null;
  layout();
}

function setTileStream(tile, stream) {
  if (tile.video.srcObject !== stream) {
    tile.video.srcObject = stream;
    tile.video.play().catch(() => {});
  }
}

function refreshSelfTile() {
  const tile = state.tiles.get(state.self?.socketId);
  if (!tile) return;
  const stream = localCamStream();
  tile.video.srcObject = stream;
  tile.video.classList.add('mirror');
  tile.video.play().catch(() => {});
  tile.el.classList.toggle('cam-off', !state.cam);
  attachMeter(tile.key, state.audioTrack);
}

function refreshRemoteTiles(id) {
  const info = state.participants.get(id);
  const peer = state.peers.get(id);
  const tile = state.tiles.get(id);
  if (!info || !tile) return;
  if (peer) {
    setTileStream(tile, peer.camStream);
    attachMeter(id, peer.camStream.getAudioTracks()[0]);
  }
  tile.el.classList.toggle('cam-off', !info.cam || !peer?.camStream.getVideoTracks().length);

  const screenKey = id + ':screen';
  if (info.screen && peer?.screenStream.getVideoTracks().length) {
    const st = ensureTile(screenKey, { ...info, screenTile: true });
    setTileStream(st, peer.screenStream);
  } else {
    removeTile(screenKey);
  }
  layout();
}

function updateTileBadges(socketId) {
  const info = socketId === state.self?.socketId ? state.self : state.participants.get(socketId);
  const tile = state.tiles.get(socketId);
  if (!info || !tile) return;
  const badges = [];
  if (info.hand) badges.push('<span class="ms hand" title="رفع يده">back_hand</span>');
  if (!info.mic) badges.push('<span class="ms" title="الميكروفون مغلق">mic_off</span>');
  tile.badges.innerHTML = badges.join('');
}

function attachMeter(key, track) {
  const old = state.meters.get(key);
  if (old?.track === track) return;
  if (old) { old.source.disconnect(); state.meters.delete(key); }
  if (!track || !state.audioCtx) return;
  const source = state.audioCtx.createMediaStreamSource(new MediaStream([track]));
  const analyser = state.audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  state.meters.set(key, { source, analyser, track, data: new Uint8Array(analyser.fftSize), level: 0 });
}

setInterval(() => {
  for (const [key, m] of state.meters) {
    m.analyser.getByteTimeDomainData(m.data);
    let sum = 0;
    for (const v of m.data) sum += (v - 128) * (v - 128);
    const rms = Math.sqrt(sum / m.data.length);
    m.level = m.level * 0.6 + rms * 0.4;
    const muted = key === state.self?.socketId ? !state.mic : !state.participants.get(key)?.mic;
    state.tiles.get(key)?.el.classList.toggle('speaking', !muted && m.level > 4);
  }
}, 150);

// Spotlight: a pinned tile, otherwise the newest screen share. Everyone else goes in the grid.
function layout() {
  const stage = document.querySelector('.stage');
  const grid = $('grid');
  const spot = $('spotlight');
  if (state.pinned && !state.tiles.has(state.pinned)) state.pinned = null;
  let focus = state.pinned;
  if (!focus) {
    const screens = [...state.tiles.values()].filter((t) => t.screen);
    focus = screens.length ? screens[screens.length - 1].key : null;
  }
  // A lone participant viewing their own camera does not need the spotlight.
  if (focus && state.tiles.size < 2) focus = null;

  for (const t of state.tiles.values()) {
    const parent = t.key === focus ? spot : grid;
    if (t.el.parentElement !== parent) parent.append(t.el);
    t.pin.classList.toggle('active', state.pinned === t.key);
  }
  spot.classList.toggle('hidden', !focus);
  stage.classList.toggle('has-spotlight', !!focus);

  if (focus) {
    grid.style.gridTemplateColumns = '';
    return;
  }
  const n = grid.children.length || 1;
  const W = grid.clientWidth || stage.clientWidth;
  const H = (grid.clientHeight || stage.clientHeight) - 10;
  let best = { w: 0, cols: 1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.min((W - (cols - 1) * 10) / cols, ((H - (rows - 1) * 10) / rows) * 16 / 9);
    if (w > best.w) best = { w, cols };
  }
  grid.style.gridTemplateColumns = `repeat(${best.cols}, ${Math.floor(best.w)}px)`;
  grid.style.justifyContent = 'center';
}
window.addEventListener('resize', layout);

/* ---------------------------- Controls UI --------------------------- */

function setCtl(btn, icon, cls) {
  btn.querySelector('.ms').textContent = icon;
  btn.classList.remove('off', 'on');
  if (cls) btn.classList.add(cls);
}

function syncControls() {
  setCtl($('micBtn'), state.mic ? 'mic' : 'mic_off', state.mic ? '' : 'off');
  setCtl($('camBtn'), state.cam ? 'videocam' : 'videocam_off', state.cam ? '' : 'off');
  setCtl($('shareBtn'), state.screenTrack ? 'cancel_presentation' : 'present_to_all', state.screenTrack ? 'on' : '');
  setCtl($('handBtn'), 'back_hand', state.hand ? 'on' : '');
  $('shareBtn').title = state.screenTrack ? 'إيقاف العرض' : 'مشاركة الشاشة';
  $('handBtn').title = state.hand ? 'خفض اليد' : 'رفع اليد';
}

function openPanel(name) {
  state.panel = state.panel === name ? null : name;
  $('panel').classList.toggle('hidden', !state.panel);
  $('chatPane').classList.toggle('hidden', state.panel !== 'chat');
  $('peoplePane').classList.toggle('hidden', state.panel !== 'people');
  $('githubPane').classList.toggle('hidden', state.panel !== 'github');
  $('panelTitle').textContent = { chat: 'الرسائل أثناء الاجتماع', people: 'المشاركون', github: 'مشاريع GitHub' }[state.panel] || '';
  $('chatBtn').classList.toggle('active', state.panel === 'chat');
  $('peopleBtn').classList.toggle('active', state.panel === 'people');
  $('githubBtn').classList.toggle('active', state.panel === 'github');
  if (state.panel === 'github' && !state.gh.loaded) loadGithub();
  if (state.panel === 'chat') {
    state.unread = 0;
    $('chatDot').classList.add('hidden');
    $('chatInput').focus();
  }
  requestAnimationFrame(layout);
}

function renderPeople() {
  const list = [state.self, ...state.participants.values()].filter(Boolean);
  $('peopleCount').textContent = list.length;
  const ul = $('people');
  ul.replaceChildren();
  for (const p of list) {
    const li = document.createElement('li');
    const a = document.createElement('div');
    a.className = 'pa';
    if (p.picture) a.style.backgroundImage = `url("${encodeURI(p.picture)}")`;
    else { a.textContent = initials(p.name); a.style.backgroundColor = colorFor(p.socketId); }
    const n = document.createElement('div');
    n.className = 'pn';
    const nm = document.createElement('div');
    nm.textContent = p.name + (p === state.self ? ' (أنت)' : '');
    n.append(nm);
    if (p.email) { const s = document.createElement('small'); s.textContent = p.email; n.append(s); }
    const icons = document.createElement('div');
    icons.innerHTML = (p.hand ? '<span class="ms">back_hand</span>' : '') +
      (p.screen ? '<span class="ms">present_to_all</span>' : '') +
      `<span class="ms">${p.mic ? 'mic' : 'mic_off'}</span>`;
    li.append(a, n, icons);
    ul.append(li);
  }
}

function addMessage({ from, name, text, at, card }) {
  state.chatLog.push(`[${timeText(new Date(at))}] ${name}: ${text}${card ? (text ? ' ' : '') + card.url : ''}`);
  const wrap = document.createElement('div');
  wrap.className = 'msg';
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = from === state.self?.socketId ? 'أنت' : name;
  const t = document.createElement('time');
  t.textContent = timeText(new Date(at));
  meta.append(t);
  const body = document.createElement('div');
  body.className = 'body';
  // Linkify URLs without ever injecting HTML.
  for (const part of text.split(/(https?:\/\/[^\s]+)/g)) {
    if (/^https?:\/\//.test(part)) {
      const link = document.createElement('a');
      link.href = part; link.textContent = part; link.target = '_blank'; link.rel = 'noopener noreferrer';
      body.append(link);
    } else if (part) body.append(document.createTextNode(part));
  }
  wrap.append(meta, body);
  if (card) wrap.append(renderCard(card));
  const box = $('messages');
  box.append(wrap);
  box.scrollTop = box.scrollHeight;
  if (state.panel !== 'chat' && from !== state.self?.socketId) {
    state.unread++;
    $('chatDot').classList.remove('hidden');
    toast(`${name}: ${(text || card?.title || '').slice(0, 80)}`);
    chime([988]);
  }
}

function floatReaction(emoji, name) {
  const el = document.createElement('div');
  el.className = 'reaction';
  el.style.insetInlineStart = (8 + Math.random() * 30) + '%';
  el.style.setProperty('--drift', (Math.random() * 80 - 40) + 'px');
  const e = document.createElement('div'); e.className = 'e'; e.textContent = emoji;
  const n = document.createElement('div'); n.className = 'n'; n.textContent = name;
  el.append(e, n);
  $('reactions').append(el);
  setTimeout(() => el.remove(), 4000);
}

function copyLink() {
  const url = location.origin + '/' + state.roomId;
  navigator.clipboard?.writeText(url).then(() => toast('تم نسخ رابط الاجتماع'), () => prompt('رابط الاجتماع', url));
}

function stopLocalMedia() {
  for (const t of [state.audioTrack, state.videoTrack, state.screenTrack]) t?.stop();
  state.audioTrack = state.videoTrack = state.screenTrack = null;
}

function leave() {
  for (const id of [...state.peers.keys()]) removePeer(id);
  for (const key of [...state.tiles.keys()]) removeTile(key);
  state.participants.clear();
  state.socket?.disconnect();
  state.socket = null;
  stopLocalMedia();
  state.joined = false;
  state.self = null;
  state.hand = false;
  state.pinned = null;
  if (state.panel) openPanel(state.panel);
  $('messages').replaceChildren();
  state.chatLog = [];
  show('left');
}

/* ------------------------------ GitHub ------------------------------ */

const GH_ICONS = {
  issue: { open: 'adjust', closed: 'check_circle' },
  pull: { open: 'call_merge', closed: 'block', merged: 'merge' },
  commit: { default: 'commit' },
};

function cardIcon(item) {
  const span = document.createElement('span');
  span.className = 'ms gi st-' + (item.type === 'commit' ? 'commit' : item.state);
  const set = GH_ICONS[item.type];
  span.textContent = set[item.state] || set.default || set.open;
  return span;
}

function cardMeta(item) {
  const id = item.type === 'commit' ? item.sha.slice(0, 7) : '#' + item.number;
  const when = item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('ar', { day: 'numeric', month: 'short' }) : '';
  return `${item.repo.split('/')[1]} ${id} · ${item.author}${when ? ' · ' + when : ''}`;
}

function renderCard(item) {
  const a = document.createElement('a');
  a.className = 'gh-card';
  a.href = item.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  const b = document.createElement('div');
  const t = document.createElement('div'); t.className = 'gt'; t.textContent = item.title;
  const m = document.createElement('div'); m.className = 'gm'; m.textContent = cardMeta(item);
  b.append(t, m);
  a.append(cardIcon(item), b);
  return a;
}

function setupGithub() {
  const gh = state.config.github || { repos: [] };
  $('githubBtn').classList.toggle('hidden', !gh.repos.length);
  const sel = $('ghRepo');
  sel.replaceChildren(...gh.repos.map((r) => new Option(r, r)));
  state.gh.repo = gh.repos[0] || null;
  if (state.gh.repo) $('ghOpen').href = 'https://github.com/' + state.gh.repo;
  $('ghNewNote').textContent = gh.canWrite ? '' : 'إنشاء Issue غير مُفعّل: يحتاج الخادم إلى GITHUB_TOKEN.';
}

function ghRequest(event, payload) {
  return new Promise((resolve, reject) => {
    if (!state.socket) return reject(new Error('غير متصل'));
    state.socket.timeout(15000).emit(event, payload, (err, res) => {
      if (err) return reject(new Error('انتهت المهلة'));
      if (res.error) return reject(new Error(res.error));
      resolve(res);
    });
  });
}

async function loadGithub() {
  const { repo, kind } = state.gh;
  if (!repo) return;
  $('ghNew').classList.toggle('hidden', kind !== 'new');
  $('ghList').classList.toggle('hidden', kind === 'new');
  $('ghStatus').textContent = '';
  if (kind === 'new') return;
  state.gh.loaded = true;
  $('ghStatus').textContent = 'جارٍ التحميل…';
  try {
    const { items } = await ghRequest('gh:list', { repo, kind });
    if (state.gh.repo !== repo || state.gh.kind !== kind) return;
    renderGhList(items);
    $('ghStatus').textContent = items.length ? '' : 'لا يوجد شيء هنا بعد.';
  } catch (err) {
    $('ghList').replaceChildren();
    $('ghStatus').textContent = err.message;
  }
}

function renderGhList(items) {
  const ul = $('ghList');
  ul.replaceChildren();
  for (const item of items) {
    const li = document.createElement('li');
    const b = document.createElement('div'); b.className = 'gb';
    const t = document.createElement('a'); t.className = 'gt';
    t.href = item.url; t.target = '_blank'; t.rel = 'noopener noreferrer'; t.textContent = item.title;
    const m = document.createElement('div'); m.className = 'gm'; m.textContent = cardMeta(item);
    b.append(t, m);
    if (item.labels?.length) {
      const labels = document.createElement('div');
      for (const l of item.labels) {
        const s = document.createElement('span'); s.className = 'label'; s.textContent = l.name;
        if (/^[0-9a-f]{6}$/i.test(l.color)) s.style.background = '#' + l.color;
        labels.append(s);
      }
      b.append(labels);
    }
    const share = document.createElement('button');
    share.className = 'icon-btn share'; share.title = 'مشاركة في الاجتماع';
    share.innerHTML = '<span class="ms">forward_to_inbox</span>';
    share.onclick = async () => {
      share.disabled = true;
      try {
        await ghRequest('gh:share', { repo: item.repo, item: { type: item.type, number: item.number, sha: item.sha } });
        toast('تمت المشاركة في المحادثة');
      } catch (err) { toast(err.message); }
      share.disabled = false;
    };
    li.append(cardIcon(item), b, share);
    ul.append(li);
  }
}

$('ghRepo').onchange = (e) => {
  state.gh.repo = e.target.value;
  $('ghOpen').href = 'https://github.com/' + state.gh.repo;
  loadGithub();
};
$('ghRefresh').onclick = loadGithub;
for (const tab of document.querySelectorAll('.gh-tabs button')) {
  tab.onclick = () => {
    document.querySelectorAll('.gh-tabs button').forEach((b) => b.classList.toggle('active', b === tab));
    state.gh.kind = tab.dataset.kind;
    loadGithub();
  };
}
$('ghNew').onsubmit = async (e) => {
  e.preventDefault();
  let body = $('ghBody').value.trim();
  if ($('ghAttachChat').checked && state.chatLog.length) {
    body += '\n\n### محادثة الاجتماع\n```\n' + state.chatLog.join('\n').replace(/```/g, "'''") + '\n```';
  }
  const btn = $('ghNew').querySelector('button');
  btn.disabled = true;
  try {
    const { card } = await ghRequest('gh:create-issue', { repo: state.gh.repo, title: $('ghTitle').value, body });
    $('ghTitle').value = ''; $('ghBody').value = ''; $('ghAttachChat').checked = false;
    toast(`تم إنشاء Issue #${card.number}`);
    state.gh.loaded = false;
  } catch (err) { toast(err.message); }
  btn.disabled = false;
};

/* ------------------------------ Wiring ------------------------------ */

$('newMeetingBtn').onclick = () => startMeeting(newMeetingCode());
$('joinCode').addEventListener('input', (e) => {
  $('joinForm').querySelector('button').disabled = !parseCode(e.target.value);
});
$('joinForm').onsubmit = (e) => {
  e.preventDefault();
  const code = parseCode($('joinCode').value);
  if (code) startMeeting(code);
};
$('micBtn').onclick = toggleMic;
$('camBtn').onclick = toggleCam;
$('shareBtn').onclick = toggleScreen;
$('handBtn').onclick = toggleHand;
$('leaveBtn').onclick = () => { chime([660, 440]); leave(); };
$('chatBtn').onclick = () => openPanel('chat');
$('peopleBtn').onclick = () => openPanel('people');
$('githubBtn').onclick = () => openPanel('github');
$('closePanel').onclick = () => openPanel(state.panel);
$('copyLink').onclick = copyLink;
$('copyLink2').onclick = copyLink;
$('rejoinBtn').onclick = () => {
  state.audioCtx?.resume();
  enterMeeting();
};
$('homeBtn').onclick = () => { history.replaceState(null, '', '/'); $('joinCode').value = ''; show('home'); };

$('chatForm').onsubmit = (e) => {
  e.preventDefault();
  const text = $('chatInput').value.trim();
  if (!text) return;
  state.socket?.emit('chat', text);
  $('chatInput').value = '';
};

const emojiBar = $('emojiBar');
for (const em of EMOJIS) {
  const b = document.createElement('button');
  b.textContent = em;
  b.onclick = () => state.socket?.emit('reaction', em);
  emojiBar.append(b);
}
$('emojiBtn').onclick = (e) => {
  e.stopPropagation();
  emojiBar.classList.toggle('hidden');
  $('emojiBtn').classList.toggle('on', !emojiBar.classList.contains('hidden'));
};
document.addEventListener('click', (e) => {
  if (!emojiBar.contains(e.target)) { emojiBar.classList.add('hidden'); $('emojiBtn').classList.remove('on'); }
});

document.addEventListener('keydown', (e) => {
  if (!state.joined) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); toggleMic(); }
  else if ((e.ctrlKey || e.metaKey) && k === 'e') { e.preventDefault(); toggleCam(); }
  else if (e.ctrlKey && e.altKey && k === 'h') { e.preventDefault(); toggleHand(); }
});

window.addEventListener('beforeunload', () => state.socket?.disconnect());

boot();
