const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const dotenv = require('dotenv');
const { GameEngine } = require('./logic/game-engine');
const { TikTokBridge } = require('./tiktok-bridge');

const args = process.argv.slice(2);
const modeArg = args.find((item) => item.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : 'test';

dotenv.config();

const PORT = process.env.PORT || 5173;
const app = express();
app.use(express.json({ limit: '5mb' }));

const staticDir = path.join(__dirname, '..', 'public');
app.use(express.static(staticDir));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const overlayClients = new Set();
const controlClients = new Set();

const game = new GameEngine({
  mode,
  broadcastState: (state) => broadcast({ type: 'state', payload: state }),
  broadcastEvent: (event) => broadcast(event)
});

let tiktokBridge = null;

if (mode === 'prod') {
  const username = process.env.TIKTOK_USERNAME;
  if (!username) {
    console.error('MODE=prod mais TIKTOK_USERNAME non défini.');
  } else {
    const sessionId = process.env.TIKTOK_SESSION_ID || undefined;
    const { TikTokLiveConnection } = require('tiktok-live-connector');
    tiktokBridge = new TikTokBridge({
      username,
      sessionId,
      enableLogs: true,
      TikTokLiveConnection
    });
    tiktokBridge.on('chat', handleIncomingChat);
    tiktokBridge.on('gift', handleIncomingGift);
    tiktokBridge.on('follow', (data) => handleIncomingGift({ ...data, giftName: 'le follow', diamonds: 0 }));
    tiktokBridge.on('log', (msg) => console.log(`[TikTok] ${msg}`));
    tiktokBridge.on('error', (err) => console.error('[TikTok] error', err));
    tiktokBridge.connect().catch((error) => {
      console.error('Impossible de se connecter au live TikTok:', error.message);
    });
  }
}

app.get('/api/state', (req, res) => {
  res.json(game.getState());
});

app.post('/api/words', (req, res) => {
  const { words } = req.body;
  game.loadWords(Array.isArray(words) ? words : []);
  res.json({ success: true, count: game.getState().wordList.length });
});

app.post('/api/banner', (req, res) => {
  const { text, speed } = req.body || {};
  game.updateBanner({ text, speed });
  res.json({ success: true });
});

app.post('/api/settings/layout', (req, res) => {
  const { layout } = req.body || {};
  if (layout === '16:9' || layout === '9:16') {
    game.updateLayout(layout);
  }
  res.json({ success: true, layout: game.getState().settings.layout });
});

app.post('/api/settings/theme', (req, res) => {
  const { theme } = req.body || {};
  if (theme) {
    game.updateTheme(theme);
  }
  res.json({ success: true });
});

app.post('/api/settings/timers', (req, res) => {
  const { baseRoundDuration, winBonusSeconds, losePenaltySeconds } = req.body || {};
  game.updateSettings({ baseRoundDuration, winBonusSeconds, losePenaltySeconds });
  res.json({ success: true, settings: game.getState().settings });
});

wss.on('connection', (socket, request) => {
  socket.isAlive = true;
  socket.role = null;

  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('message', (message) => {
    try {
      const parsed = JSON.parse(message.toString());
      if (parsed.type === 'register') {
        if (parsed.role === 'overlay') {
          overlayClients.add(socket);
          socket.role = 'overlay';
        } else {
          controlClients.add(socket);
          socket.role = 'control';
        }
        send(socket, { type: 'state', payload: game.getState() });
        return;
      }
      if (socket.role === 'control') {
        handleControlMessage(parsed, socket);
      }
    } catch (error) {
      console.error('WS message error', error);
    }
  });

  socket.on('close', () => {
    overlayClients.delete(socket);
    controlClients.delete(socket);
  });
});

const heartbeat = setInterval(() => {
  wss.clients.forEach((socket) => {
    if (!socket.isAlive) {
      socket.terminate();
      return;
    }
    socket.isAlive = false;
    socket.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeat);
});

function broadcast(payload) {
  overlayClients.forEach((client) => send(client, payload));
  controlClients.forEach((client) => send(client, payload));
}

function send(socket, payload) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
  }
}

function handleControlMessage(message, socket) {
  switch (message.type) {
    case 'control:loadWords':
      game.loadWords(message.payload?.words || []);
      break;
    case 'control:banner':
      game.updateBanner(message.payload || {});
      break;
    case 'control:theme':
      game.updateTheme(message.payload || {});
      break;
    case 'control:layout':
      game.updateLayout(message.payload?.layout);
      break;
    case 'control:timers':
      game.updateSettings(message.payload || {});
      break;
    case 'control:simulate:chat':
      if (mode === 'test') {
        handleIncomingChat({
          username: message.payload?.username,
          displayName: message.payload?.displayName || message.payload?.username,
          comment: message.payload?.comment || ''
        });
      }
      break;
    case 'control:simulate:gift':
      if (mode === 'test') {
        handleIncomingGift({
          username: message.payload?.username,
          displayName: message.payload?.displayName || message.payload?.username,
          giftName: message.payload?.giftName || 'cadeau test',
          diamonds: message.payload?.diamonds || 1
        });
      }
      break;
    case 'control:queue:remove':
      game.handleViewerLeave(message.payload?.username);
      break;
    case 'control:queue:promote':
      if (message.payload?.username) {
        game.enqueueViewer({
          username: message.payload.username,
          displayName: message.payload.displayName,
          priorityBoost: true
        });
      }
      break;
    case 'control:player:kick':
      if (message.payload?.username) {
        game.unreadyPlayer(message.payload.username, 'kick');
      }
      break;
    case 'control:player:ready':
      if (message.payload?.username) {
        game.markReady(message.payload.username);
      }
      break;
    case 'control:forceSwap':
      game.forceSwap();
      break;
    case 'control:forceStop':
      game.forceStopRound();
      break;
    case 'control:forceWin':
      if (message.payload?.username) {
        game.simulateWin(message.payload.username);
      }
      break;
    default:
      break;
  }
}

function handleIncomingChat({ username, displayName, comment }) {
  if (!username || !comment) return;
  const trimmed = comment.trim();
  const normalized = trimmed.toLowerCase();
  const collapsed = normalized.replace(/\s+/g, '');
  if (collapsed === '+join' || collapsed === '+rejoindre' || collapsed === '+jouer') {
    game.enqueueViewer({ username, displayName });
    return;
  }
  if (collapsed === '+pret' || collapsed === '+prêt') {
    game.markReady(username);
    return;
  }
  game.handleGuess({ username, message: trimmed });
}

function handleIncomingGift({ username, displayName, giftName, diamonds }) {
  game.handleGift({ username, displayName, giftName, diamonds });
}

server.listen(PORT, () => {
  console.log(`Battle Anagram server running in ${mode} mode on http://localhost:${PORT}`);
  console.log(`Overlay: http://localhost:${PORT}/overlay.html`);
  console.log(`Panneau de contrôle: http://localhost:${PORT}/control.html`);
});

function shutdown() {
  console.log('Fermeture du serveur Battle Anagram...');
  if (tiktokBridge) {
    try {
      tiktokBridge.disconnect();
    } catch (error) {
      console.error('Erreur lors de la fermeture TikTok', error);
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
