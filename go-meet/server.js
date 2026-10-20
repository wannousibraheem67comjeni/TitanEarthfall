'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const github = require('./github');

const PORT = Number(process.env.PORT) || 3000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const MAX_PARTICIPANTS = Number(process.env.MAX_PARTICIPANTS) || 16;

// STUN is enough on most networks; set TURN_URL/TURN_USERNAME/TURN_CREDENTIAL
// so participants behind strict NATs or firewalls can still connect.
function iceServers() {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL.split(',').map((u) => u.trim()),
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || '',
    });
  }
  return servers;
}

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/config', (_req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID, iceServers: iceServers(), maxParticipants: MAX_PARTICIPANTS,
    github: { repos: github.repos(), canWrite: github.canWrite() },
  });
});

// Meeting links look like /abc-defg-hij; every such path serves the app shell.
const ROOM_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
app.get('/:room', (req, res, next) => {
  if (!ROOM_RE.test(req.params.room)) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });

// Verifies a Google OAuth access token issued to this app and returns the profile.
async function verifyGoogleToken(accessToken) {
  const info = await fetch(
    'https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(accessToken)
  );
  if (!info.ok) throw new Error('invalid token');
  const tokenInfo = await info.json();
  if (tokenInfo.aud !== GOOGLE_CLIENT_ID && tokenInfo.azp !== GOOGLE_CLIENT_ID) {
    throw new Error('token was issued to another app');
  }
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!res.ok) throw new Error('could not load profile');
  const p = await res.json();
  return { id: 'g:' + p.sub, name: p.name || p.email, email: p.email || '', picture: p.picture || '' };
}

function clean(str, max) {
  return String(str || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
}

// roomId -> Map(socketId -> participant)
const rooms = new Map();

function publicParticipant(p) {
  return {
    socketId: p.socketId, name: p.name, email: p.email, picture: p.picture,
    mic: p.mic, cam: p.cam, screen: p.screen, hand: p.hand, joinedAt: p.joinedAt,
  };
}

io.on('connection', (socket) => {
  let roomId = null;
  let me = null;

  socket.on('join', async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      if (roomId) return reply({ error: 'already joined' });
      const id = clean(payload && payload.roomId, 20);
      if (!ROOM_RE.test(id)) return reply({ error: 'رمز الاجتماع غير صالح' });

      let profile;
      if (GOOGLE_CLIENT_ID) {
        if (!payload.accessToken) return reply({ error: 'يجب تسجيل الدخول بحساب Google' });
        profile = await verifyGoogleToken(payload.accessToken);
      } else {
        const name = clean(payload.name, 40);
        if (!name) return reply({ error: 'الاسم مطلوب' });
        profile = { id: 'guest:' + crypto.randomUUID(), name, email: '', picture: '' };
      }

      if (!rooms.has(id)) rooms.set(id, new Map());
      const room = rooms.get(id);
      if (room.size >= MAX_PARTICIPANTS) return reply({ error: 'الاجتماع ممتلئ' });

      roomId = id;
      me = {
        socketId: socket.id, ...profile,
        mic: !!payload.mic, cam: !!payload.cam, screen: false, hand: false, joinedAt: Date.now(),
      };
      const existing = [...room.values()].map(publicParticipant);
      room.set(socket.id, me);
      socket.join(roomId);
      socket.to(roomId).emit('participant-joined', publicParticipant(me));
      reply({ self: publicParticipant(me), participants: existing });
    } catch (err) {
      reply({ error: 'تعذر التحقق من الحساب: ' + err.message });
    }
  });

  // WebRTC offers/answers/ICE candidates, relayed only between members of the same room.
  socket.on('signal', ({ to, data } = {}) => {
    if (!roomId || !rooms.get(roomId)?.has(to)) return;
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('state', (state = {}) => {
    if (!me) return;
    for (const k of ['mic', 'cam', 'screen', 'hand']) if (k in state) me[k] = !!state[k];
    socket.to(roomId).emit('state', { socketId: socket.id, mic: me.mic, cam: me.cam, screen: me.screen, hand: me.hand });
  });

  socket.on('chat', (text) => {
    if (!me) return;
    const body = clean(text, 2000);
    if (!body) return;
    io.to(roomId).emit('chat', { from: socket.id, name: me.name, picture: me.picture, text: body, at: Date.now() });
  });

  socket.on('reaction', (emoji) => {
    if (!me) return;
    const e = clean(emoji, 8);
    if (e) io.to(roomId).emit('reaction', { from: socket.id, name: me.name, emoji: e });
  });

  // ----- GitHub: browse linked repos, share items into the chat, create issues -----
  socket.on('gh:list', async ({ repo, kind } = {}, ack) => {
    if (!me || typeof ack !== 'function') return;
    try { ack({ items: await github.list(repo, kind) }); } catch (err) { ack({ error: err.message }); }
  });

  socket.on('gh:share', async ({ repo, item } = {}, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!me) return;
    try {
      const card = await github.card(repo, item || {});
      io.to(roomId).emit('chat', { from: socket.id, name: me.name, picture: me.picture, text: '', card, at: Date.now() });
      reply({ ok: true });
    } catch (err) { reply({ error: err.message }); }
  });

  let lastIssueAt = 0;
  socket.on('gh:create-issue', async ({ repo, title, body } = {}, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!me) return;
    const t = clean(title, 200);
    if (!t) return reply({ error: 'العنوان مطلوب' });
    if (Date.now() - lastIssueAt < 10000) return reply({ error: 'انتظر قليلًا قبل إنشاء Issue آخر' });
    lastIssueAt = Date.now();
    try {
      const text = String(body || '').slice(0, 20000) +
        `\n\n---\n_أُنشئ من اجتماع Go Meet \`${roomId}\` بواسطة ${me.name}_`;
      const card = await github.createIssue(repo, t, text);
      io.to(roomId).emit('chat', { from: socket.id, name: me.name, picture: me.picture, text: 'أنشأ Issue جديد', card, at: Date.now() });
      reply({ card });
    } catch (err) { reply({ error: err.message }); }
  });

  socket.on('disconnect', () => {
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (room) {
      room.delete(socket.id);
      if (room.size === 0) rooms.delete(roomId);
    }
    socket.to(roomId).emit('participant-left', { socketId: socket.id });
  });
});

server.listen(PORT, () => {
  console.log(`Go Meet server listening on http://localhost:${PORT}`);
  console.log('Linked GitHub repos: ' + (github.repos().join(', ') || 'none'));
  if (!GOOGLE_CLIENT_ID) console.log('GOOGLE_CLIENT_ID is not set: running in guest mode (name only).');
});
