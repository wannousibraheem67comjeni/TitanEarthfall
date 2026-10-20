# Titan Meet

A Google Meet-style video conferencing app: real-time video and audio, screen sharing, chat, reactions and raise hand, all in the browser.

## How it works

1. Click **اجتماع جديد** (New meeting), or paste a meeting link or code and click **انضمام** (Join).
2. Google's account chooser opens. Pick your account.
3. The camera and mic turn on and you go straight into the meeting, with no lobby.

The control bar has: mic, camera, reactions (emoji), screen sharing (one click), raise hand, and leave. On the side you'll find chat, the participant list and copy link.

Shortcuts: `Ctrl+D` mic, `Ctrl+E` camera, `Ctrl+Alt+H` raise hand.

## Run

```bash
cd meet-app
npm install
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com npm start
# http://localhost:3000
```

If you don't set `GOOGLE_CLIENT_ID`, the app runs in guest mode: it asks for a name instead of a Google account. This is useful for local testing.

### Setting up Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type *Web application*.
2. Under **Authorized JavaScript origins**, add your app's address (for example `https://meet.example.com` and `http://localhost:3000`).
3. Pass the Client ID as `GOOGLE_CLIENT_ID`. The server verifies every Google token before it lets anyone into the meeting.

### Environment variables

| Variable | Description |
| --- | --- |
| `PORT` | Server port (default 3000) |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID. Without it, guest mode is on |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | TURN server (strongly recommended in production so people behind strict networks can connect). Several URLs can be separated with commas |
| `MAX_PARTICIPANTS` | Maximum participants per meeting (default 16) |

## Deployment

- Browsers only allow the camera, mic and screen sharing over **HTTPS** (or `localhost`). Put the server behind a reverse proxy with TLS that supports WebSocket.
- Architecture: a Node.js server (Express + Socket.IO) handles signaling, chat and state only. Video and audio travel directly between participants over WebRTC (mesh). Every connection has three fixed channels (mic, camera, screen), so toggling devices or screen sharing works instantly without renegotiating.
- The mesh design works well for small and medium meetings (about 8 to 10 people with video). For bigger meetings, add an SFU such as mediasoup or LiveKit.
