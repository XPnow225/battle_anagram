const statusEl = document.getElementById('connection-status');
const playersEl = document.getElementById('players');
const queueList = document.getElementById('queue-list');
const bannerText = document.getElementById('banner-text');
const bannerSpeed = document.getElementById('banner-speed');
const bannerApply = document.getElementById('banner-apply');
const themeBackground = document.getElementById('theme-background');
const themeAccent = document.getElementById('theme-accent');
const themeText = document.getElementById('theme-text');
const themeFont = document.getElementById('theme-font');
const layoutSelect = document.getElementById('layout-select');
const themeApply = document.getElementById('theme-apply');
const durationInput = document.getElementById('duration');
const bonusInput = document.getElementById('bonus');
const penaltyInput = document.getElementById('penalty');
const timersApply = document.getElementById('timers-apply');
const wordsFile = document.getElementById('words-file');
const wordsManual = document.getElementById('words-manual');
const wordsUpload = document.getElementById('words-upload');
const wordsCount = document.getElementById('words-count');
const testTools = document.getElementById('test-tools');
const testUsername = document.getElementById('test-username');
const testDisplay = document.getElementById('test-display');
const testMessage = document.getElementById('test-message');
const testSend = document.getElementById('test-send');
const giftUsername = document.getElementById('gift-username');
const giftDisplay = document.getElementById('gift-display');
const giftName = document.getElementById('gift-name');
const giftValue = document.getElementById('gift-value');
const giftSend = document.getElementById('gift-send');

let socket;
let currentState = null;

function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${window.location.host}`);
  socket.addEventListener('open', () => {
    statusEl.textContent = 'Connecté';
    statusEl.dataset.state = 'online';
    socket.send(JSON.stringify({ type: 'register', role: 'control' }));
  });
  socket.addEventListener('close', () => {
    statusEl.textContent = 'Déconnecté';
    statusEl.dataset.state = 'offline';
    setTimeout(connect, 1500);
  });
  socket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'state') {
        currentState = payload.payload;
        renderState(currentState);
      } else if (payload.type === 'voice') {
        // Optionally show logs
        console.info('[Voix]', payload.payload?.message);
      }
    } catch (error) {
      console.error('Console parse error', error);
    }
  });
}

function send(type, payload) {
  if (socket?.readyState === 1) {
    socket.send(JSON.stringify({ type, payload }));
  }
}

function renderState(state) {
  renderPlayers(state.players);
  renderQueue(state.queue);
  bannerText.value = state.banner?.text || '';
  bannerSpeed.value = state.banner?.speed || 30;
  themeBackground.value = toColor(state.settings?.theme?.background || '#0f172a');
  themeAccent.value = toColor(state.settings?.theme?.accent || '#22d3ee');
  themeText.value = toColor(state.settings?.theme?.text || '#f8fafc');
  themeFont.value = state.settings?.theme?.fontFamily || '';
  layoutSelect.value = state.settings?.layout || '16:9';
  durationInput.value = state.settings?.baseRoundDuration || 120;
  bonusInput.value = state.settings?.winBonusSeconds || 30;
  penaltyInput.value = state.settings?.losePenaltySeconds || 20;
  wordsCount.textContent = `${state.wordList?.length || 0} mots chargés`;
  if (state.mode === 'test') {
    testTools.style.display = 'block';
  } else {
    testTools.style.display = 'none';
  }
}

function renderPlayers(players) {
  playersEl.innerHTML = '';
  ['left', 'right'].forEach((side, index) => {
    const slot = players[side];
    const card = document.createElement('div');
    card.className = 'card';
    const title = side === 'left' ? 'Joueur 1' : 'Joueur 2';
    const content = document.createElement('div');
    const name = slot.username ? (slot.displayName || slot.username) : 'En attente';
    const ready = slot.ready ? '✅ Prêt' : '⏳ Pas prêt';
    const timer = slot.username ? `${Math.round(slot.timeLeft)}s restantes` : '--';
    const score = slot.username ? `${slot.score} point(s)` : '';
    content.innerHTML = `
      <h3>${title}</h3>
      <div class="meta">${name}</div>
      <div class="meta">${ready}</div>
      <div class="meta">${timer}</div>
      <div class="meta">${score}</div>
    `;
    card.appendChild(content);
    if (slot.username) {
      const actions = document.createElement('div');
      const readyBtn = document.createElement('button');
      readyBtn.textContent = 'Forcer prêt';
      readyBtn.addEventListener('click', () => send('control:player:ready', { username: slot.username }));
      const winBtn = document.createElement('button');
      winBtn.textContent = 'Forcer victoire';
      winBtn.addEventListener('click', () => send('control:forceWin', { username: slot.username }));
      const kickBtn = document.createElement('button');
      kickBtn.textContent = 'Retirer';
      kickBtn.addEventListener('click', () => send('control:player:kick', { username: slot.username }));
      actions.style.display = 'flex';
      actions.style.gap = '0.5rem';
      actions.style.flexWrap = 'wrap';
      actions.appendChild(readyBtn);
      actions.appendChild(winBtn);
      actions.appendChild(kickBtn);
      card.appendChild(actions);
    }
    playersEl.appendChild(card);
  });
  const toolsRow = document.createElement('div');
  toolsRow.className = 'card';
  toolsRow.innerHTML = `
    <h3>Actions générales</h3>
    <div class="meta">Swapper les joueurs ou arrêter la manche en cours.</div>
  `;
  const buttons = document.createElement('div');
  buttons.style.display = 'flex';
  buttons.style.gap = '0.5rem';
  const swapBtn = document.createElement('button');
  swapBtn.textContent = 'Inverser les côtés';
  swapBtn.addEventListener('click', () => send('control:forceSwap'));
  const stopBtn = document.createElement('button');
  stopBtn.textContent = 'Arrêter la manche';
  stopBtn.addEventListener('click', () => send('control:forceStop'));
  buttons.appendChild(swapBtn);
  buttons.appendChild(stopBtn);
  toolsRow.appendChild(buttons);
  playersEl.appendChild(toolsRow);
}

function renderQueue(queue) {
  queueList.innerHTML = '';
  if (!queue.length) {
    const empty = document.createElement('li');
    empty.textContent = 'File vide';
    queueList.appendChild(empty);
    return;
  }
  queue.forEach((viewer, index) => {
    const item = document.createElement('li');
    const info = document.createElement('div');
    info.textContent = `${index + 1}. ${viewer.displayName || viewer.username}`;
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '0.4rem';
    const promote = document.createElement('button');
    promote.textContent = 'Priorité';
    promote.addEventListener('click', () => send('control:queue:promote', viewer));
    const remove = document.createElement('button');
    remove.textContent = 'Retirer';
    remove.addEventListener('click', () => send('control:queue:remove', { username: viewer.username }));
    actions.appendChild(promote);
    actions.appendChild(remove);
    item.appendChild(info);
    item.appendChild(actions);
    queueList.appendChild(item);
  });
}

function toColor(value) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = value;
  return ctx.fillStyle;
}

bannerApply.addEventListener('click', () => {
  send('control:banner', { text: bannerText.value, speed: Number(bannerSpeed.value) || 30 });
});

themeApply.addEventListener('click', () => {
  send('control:theme', {
    background: themeBackground.value,
    accent: themeAccent.value,
    text: themeText.value,
    fontFamily: themeFont.value
  });
  send('control:layout', { layout: layoutSelect.value });
});

timersApply.addEventListener('click', () => {
  send('control:timers', {
    baseRoundDuration: Number(durationInput.value),
    winBonusSeconds: Number(bonusInput.value),
    losePenaltySeconds: Number(penaltyInput.value)
  });
});

wordsUpload.addEventListener('click', async () => {
  let words = [];
  if (wordsFile.files.length) {
    const text = await wordsFile.files[0].text();
    words = words.concat(parseWords(text));
  }
  words = words.concat(parseWords(wordsManual.value));
  const uniqueWords = Array.from(new Set(words));
  send('control:loadWords', { words: uniqueWords });
  wordsManual.value = '';
  wordsFile.value = '';
});

function parseWords(raw = '') {
  return raw
    .split(/\r?\n|,|;/)
    .map((word) => word.trim())
    .filter(Boolean);
}

testSend.addEventListener('click', () => {
  if (currentState?.mode !== 'test') return;
  const username = testUsername.value.trim();
  if (!username) return;
  send('control:simulate:chat', {
    username,
    displayName: testDisplay.value.trim() || username,
    comment: testMessage.value.trim()
  });
});

giftSend.addEventListener('click', () => {
  if (currentState?.mode !== 'test') return;
  const username = giftUsername.value.trim();
  if (!username) return;
  send('control:simulate:gift', {
    username,
    displayName: giftDisplay.value.trim() || username,
    giftName: giftName.value.trim() || 'cadeau',
    diamonds: Number(giftValue.value) || 1
  });
});

connect();
