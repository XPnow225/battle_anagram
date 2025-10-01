const overlay = document.getElementById('overlay');
const playerLeft = document.getElementById('player-left');
const playerRight = document.getElementById('player-right');
const letters = document.getElementById('letters');
const queueEl = document.getElementById('queue');
const roundTimer = document.getElementById('round-timer');
const championEl = document.getElementById('champion');
const statsEl = document.getElementById('stats');
const bannerContent = document.getElementById('banner-content');

const voiceQueue = [];
let speaking = false;
const speechEnabled = 'speechSynthesis' in window;

function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${window.location.host}`);
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'register', role: 'overlay' }));
  });
  ws.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'state') {
        render(data.payload);
      } else if (data.type === 'voice') {
        queueSpeech(data.payload?.message);
      }
    } catch (error) {
      console.error('Overlay parse error', error);
    }
  });
  ws.addEventListener('close', () => {
    setTimeout(connect, 1500);
  });
}

function render(state) {
  applyTheme(state.settings?.theme);
  applyLayout(state.settings?.layout);
  updatePlayer(playerLeft, state.players.left);
  updatePlayer(playerRight, state.players.right);
  updateRound(state);
  updateQueue(state.queue);
  updateChampion(state.champion);
  updateStats(state.statistics);
  updateBanner(state.banner);
}

function applyTheme(theme = {}) {
  if (!theme) return;
  const root = document.documentElement;
  if (theme.background) root.style.setProperty('--bg-color', theme.background);
  if (theme.accent) root.style.setProperty('--accent-color', theme.accent);
  if (theme.text) root.style.setProperty('--text-color', theme.text);
  if (theme.fontFamily) root.style.setProperty('--font-family', theme.fontFamily);
}

function applyLayout(layout) {
  if (layout === '9:16') {
    overlay.dataset.layout = 'portrait';
  } else {
    overlay.dataset.layout = 'landscape';
  }
}

function updatePlayer(element, slot) {
  const nameEl = element.querySelector('.player__name');
  const statusEl = element.querySelector('.player__status');
  const timerEl = element.querySelector('.player__timer');
  const scoreEl = element.querySelector('.player__score span');

  if (!slot?.username) {
    nameEl.textContent = nameEl.dataset.label || 'Joueur';
    statusEl.textContent = 'En attente';
    statusEl.dataset.status = 'waiting';
    timerEl.textContent = '--';
    scoreEl.textContent = '0';
    return;
  }

  nameEl.textContent = slot.displayName || slot.username;
  statusEl.textContent = slot.ready ? 'Prêt' : 'Pas prêt';
  statusEl.dataset.status = slot.ready ? 'ready' : 'waiting';
  timerEl.textContent = formatSeconds(slot.timeLeft ?? 0);
  scoreEl.textContent = slot.score ?? 0;
}

function updateRound(state) {
  const { round, settings, players } = state;
  if (!round?.active) {
    roundTimer.textContent = '--:--';
    letters.textContent = state.round.scrambled || '---';
    return;
  }
  const highestTime = Math.max(players.left.timeLeft ?? 0, players.right.timeLeft ?? 0);
  roundTimer.textContent = formatSeconds(highestTime);
  letters.textContent = round.scrambled || '---';
}

function updateQueue(queue = []) {
  if (!queue.length) {
    queueEl.innerHTML = '<em>File d\'attente vide</em>';
    return;
  }
  queueEl.innerHTML = queue
    .slice(0, 6)
    .map((item, index) => `<span>${index + 1}. ${item.displayName || item.username}</span>`)
    .join('');
}

function updateChampion(champion) {
  if (!champion?.username) {
    championEl.textContent = 'Aucun champion actuellement';
    return;
  }
  championEl.textContent = `Champion: ${champion.displayName} · Série ${champion.streak} · Il faut ${champion.requiredToDethrone} victoires pour le détrôner`;
}

function updateStats(stats = {}) {
  const total = stats.totalRounds ?? 0;
  const last = stats.lastWinner ? `Dernier vainqueur: ${stats.lastWinner}` : 'Pas de vainqueur pour le moment';
  statsEl.textContent = `Manches jouées: ${total} · ${last}`;
}

function updateBanner(banner = {}) {
  bannerContent.textContent = banner.text || '';
  const speed = Number(banner.speed) || 30;
  document.documentElement.style.setProperty('--banner-speed', `${speed}s`);
  bannerContent.style.display = banner.text ? 'flex' : 'none';
}

function formatSeconds(value) {
  const seconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function queueSpeech(message) {
  if (!message || !speechEnabled) return;
  voiceQueue.push(message);
  processSpeechQueue();
}

function processSpeechQueue() {
  if (!speechEnabled || speaking || !voiceQueue.length) return;
  const utterance = new SpeechSynthesisUtterance(voiceQueue.shift());
  utterance.lang = 'fr-FR';
  utterance.rate = 1;
  utterance.onstart = () => {
    speaking = true;
  };
  utterance.onend = () => {
    speaking = false;
    processSpeechQueue();
  };
  utterance.onerror = () => {
    speaking = false;
    processSpeechQueue();
  };
  window.speechSynthesis.speak(utterance);
}

connect();
