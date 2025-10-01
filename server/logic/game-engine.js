const { randomUUID } = require('crypto');

const READY_TIMEOUT_MS = 60_000;

class GameEngine {
  constructor({ mode, broadcastState, broadcastEvent }) {
    this.mode = mode;
    this.broadcastState = broadcastState;
    this.broadcastEvent = broadcastEvent;
    this.timerInterval = null;
    this.reset();
  }

  reset() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
    this.state = {
      mode: this.mode,
      queue: [],
      players: {
        left: this._createEmptySlot('left'),
        right: this._createEmptySlot('right')
      },
      round: {
        active: false,
        startedAt: null,
        wordId: null,
        scrambled: '',
        solution: null
      },
      champion: {
        username: null,
        displayName: null,
        streak: 0,
        requiredToDethrone: 4
      },
      banner: {
        text: '',
        speed: 30
      },
      settings: {
        baseRoundDuration: 120,
        winBonusSeconds: 30,
        losePenaltySeconds: 20,
        layout: '16:9',
        theme: {
          background: '#0f172a',
          accent: '#22d3ee',
          text: '#f8fafc',
          fontFamily: 'Inter, "Segoe UI", sans-serif'
        }
      },
      wordList: [],
      statistics: {
        totalRounds: 0,
        lastWinner: null
      }
    };
    this._winStreaks = new Map();
    this._readyTimers = new Map();
    this.timerInterval = setInterval(() => this._tick(), 1000);
    this._emitState();
  }

  setMode(mode) {
    this.mode = mode;
    this.state.mode = mode;
    this._emitState();
  }

  updateSettings(partialSettings = {}) {
    const next = { ...this.state.settings };
    ['baseRoundDuration', 'winBonusSeconds', 'losePenaltySeconds'].forEach((key) => {
      const value = partialSettings[key];
      if (Number.isFinite(value) && value > 0) {
        next[key] = value;
      }
    });
    this.state.settings = next;
    if (!this.state.round.active) {
      ['left', 'right'].forEach((key) => {
        const slot = this.state.players[key];
        if (slot.username) {
          slot.timeLeft = next.baseRoundDuration;
        }
      });
    }
    this._emitState();
  }

  updateTheme(theme) {
    this.state.settings.theme = {
      ...this.state.settings.theme,
      ...theme
    };
    this._emitState();
  }

  updateLayout(layout) {
    if (layout !== '16:9' && layout !== '9:16') return;
    this.state.settings.layout = layout;
    this._emitState();
  }

  updateBanner({ text, speed }) {
    if (typeof text === 'string') {
      this.state.banner.text = text;
    }
    if (speed && Number.isFinite(speed)) {
      this.state.banner.speed = Math.max(10, Math.min(speed, 120));
    }
    this._emitState();
  }

  loadWords(words) {
    const sanitized = Array.isArray(words)
      ? words.map((word) => word.trim()).filter((word) => word.length > 0)
      : [];
    this.state.wordList = sanitized;
    if (!this.state.round.active && this.state.round.solution === null) {
      this._prepareNextWord();
    }
    this._emitState();
  }

  enqueueViewer({ username, displayName, priorityBoost = false }) {
    if (!username) return;
    if (this._isActivePlayer(username)) {
      return;
    }
    const alreadyInQueue = this.state.queue.find((item) => item.username === username);
    if (alreadyInQueue) {
      if (priorityBoost) {
        alreadyInQueue.priorityBoostedAt = Date.now();
        this._sortQueue();
        this._emitState();
      }
      return;
    }
    const entry = {
      id: randomUUID(),
      username,
      displayName: displayName || username,
      joinedAt: Date.now(),
      priorityBoostedAt: priorityBoost ? Date.now() : null
    };
    this.state.queue.push(entry);
    this._sortQueue();
    this._emitState();
    this._fillEmptySlots();
  }

  markReady(username) {
    const slot = this._findSlotByUsername(username);
    if (!slot) return;
    this._clearReadyTimer(slot);
    slot.ready = true;
    this._emitState();
    if (!this.state.round.active) {
      this._maybeStartRound();
    }
  }

  unreadyPlayer(username, reason = 'not-ready-timeout') {
    const slotKey = this._findSlotKeyByUsername(username);
    if (!slotKey) return;
    const slot = this.state.players[slotKey];
    this._clearReadyTimer(slot);
    const spectatorName = slot.displayName || username;
    const reasonLabel =
      {
        'not-ready-timeout': "absence de confirmation",
        kick: 'disponibilité insuffisante'
      }[reason] || reason;
    this._pushVoice(`${spectatorName} a été retiré pour ${reasonLabel}.`);
    this.state.players[slotKey] = this._createEmptySlot(slotKey);
    this._emitState();
    this._fillEmptySlots();
  }

  handleGuess({ username, message }) {
    const slotKey = this._findSlotKeyByUsername(username);
    if (!slotKey || !this.state.round.active) return;
    const normalized = message.trim().toLowerCase();
    if (normalized !== this.state.round.solution?.toLowerCase()) {
      return;
    }
    const opponentKey = slotKey === 'left' ? 'right' : 'left';
    const playerSlot = this.state.players[slotKey];
    const opponentSlot = this.state.players[opponentKey];
    const { winBonusSeconds, losePenaltySeconds, baseRoundDuration } = this.state.settings;
    playerSlot.timeLeft = Math.min(
      playerSlot.timeLeft + winBonusSeconds,
      baseRoundDuration + winBonusSeconds
    );
    opponentSlot.timeLeft = Math.max(opponentSlot.timeLeft - losePenaltySeconds, 0);
    playerSlot.score += 1;
    this._pushVoice(`Bravo ${playerSlot.displayName}, c'était bien ${this.state.round.solution}.`);
    this._prepareNextWord();
    this._emitState();
    if (opponentSlot.timeLeft === 0) {
      this._endRound(playerSlot, opponentSlot);
    }
  }

  handleGift({ username, displayName, diamonds, giftName }) {
    if (!username) return;
    this.enqueueViewer({ username, displayName, priorityBoost: true });
    const mention = giftName ? `${giftName}` : 'le cadeau';
    this._pushVoice(`Merci ${displayName || username} pour ${mention}!`);
  }

  handleViewerLeave(username) {
    if (!username) return;
    const slotKey = this._findSlotKeyByUsername(username);
    if (slotKey) {
      this._clearReadyTimerByKey(username);
      this.state.players[slotKey] = this._createEmptySlot(slotKey);
      this._emitState();
      this._fillEmptySlots();
      return;
    }
    const beforeLength = this.state.queue.length;
    this.state.queue = this.state.queue.filter((item) => item.username !== username);
    if (beforeLength !== this.state.queue.length) {
      this._emitState();
    }
  }

  forceSwap() {
    const left = this.state.players.left;
    this.state.players.left = this.state.players.right;
    this.state.players.right = left;
    this._emitState();
  }

  forceStopRound() {
    if (!this.state.round.active) return;
    this._endRound(null, null, 'manual-stop');
  }

  simulateWin(username) {
    const slotKey = this._findSlotKeyByUsername(username);
    if (!slotKey) return;
    const winner = this.state.players[slotKey];
    const loser = this.state.players[slotKey === 'left' ? 'right' : 'left'];
    this._endRound(winner, loser, 'manual');
  }

  getState() {
    return this.state;
  }

  /*** PRIVATE METHODS ***/

  _createEmptySlot(position) {
    const duration = this.state?.settings?.baseRoundDuration || 120;
    return {
      position,
      username: null,
      displayName: null,
      ready: false,
      score: 0,
      timeLeft: duration,
      readyRequestedAt: null
    };
  }

  _fillEmptySlots() {
    ['left', 'right'].forEach((key) => {
      const slot = this.state.players[key];
      if (!slot.username && this.state.queue.length > 0) {
        const next = this.state.queue.shift();
        this.state.players[key] = {
          ...this._createEmptySlot(key),
          username: next.username,
          displayName: next.displayName,
          readyRequestedAt: Date.now()
        };
        this._pushVoice(`${next.displayName} entre dans l'arène côté ${key === 'left' ? 'gauche' : 'droit'}.`);
        this._startReadyTimer(this.state.players[key]);
      }
    });
    this._emitState();
  }

  _startReadyTimer(slot) {
    if (!slot?.username) return;
    this._clearReadyTimer(slot);
    const timer = setTimeout(() => {
      if (!slot.ready) {
        this.unreadyPlayer(slot.username, 'not-ready-timeout');
      }
    }, READY_TIMEOUT_MS);
    this._readyTimers.set(slot.username, timer);
  }

  _clearReadyTimer(slot) {
    if (slot?.username) {
      this._clearReadyTimerByKey(slot.username);
    }
  }

  _clearReadyTimerByKey(username) {
    if (!username) return;
    const timer = this._readyTimers.get(username);
    if (timer) {
      clearTimeout(timer);
      this._readyTimers.delete(username);
    }
  }

  _maybeStartRound() {
    const left = this.state.players.left;
    const right = this.state.players.right;
    if (!left.username || !right.username) return;
    if (!left.ready || !right.ready) return;
    if (this.state.wordList.length === 0) return;

    this.state.round.active = true;
    this.state.round.startedAt = Date.now();
    left.timeLeft = this.state.settings.baseRoundDuration;
    right.timeLeft = this.state.settings.baseRoundDuration;
    left.score = 0;
    right.score = 0;
    this._prepareNextWord();
    this._pushVoice('La manche commence, bonne chance à nos deux joueurs!');
    this._emitState();
  }

  _prepareNextWord() {
    if (!this.state.wordList.length) {
      this.state.round.wordId = null;
      this.state.round.solution = null;
      this.state.round.scrambled = '';
      return;
    }
    const index = Math.floor(Math.random() * this.state.wordList.length);
    const word = this.state.wordList[index];
    const letters = word.split('');
    for (let i = letters.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    this.state.round.wordId = index;
    this.state.round.solution = word;
    this.state.round.scrambled = letters.join(' ');
  }

  _tick() {
    if (!this.state.round.active) return;
    ['left', 'right'].forEach((side) => {
      const slot = this.state.players[side];
      if (slot.timeLeft > 0) {
        slot.timeLeft = Math.max(0, slot.timeLeft - 1);
      }
    });
    this._emitState();
    const left = this.state.players.left;
    const right = this.state.players.right;
    if (left.timeLeft <= 0 || right.timeLeft <= 0) {
      const winner = left.timeLeft > right.timeLeft ? left : right;
      const loser = winner === left ? right : left;
      this._endRound(winner.timeLeft === 0 && loser.timeLeft === 0 ? null : winner, loser);
    }
  }

  _endRound(winner, loser, reason = 'timer') {
    if (!this.state.round.active) return;
    this.state.round.active = false;
    this.state.statistics.totalRounds += 1;
    if (winner && winner.username) {
      this.state.statistics.lastWinner = winner.displayName;
      const winnerKey = this._findSlotKeyByUsername(winner.username);
      const loserKey = this._findSlotKeyByUsername(loser?.username);
      this._pushVoice(`${winner.displayName} remporte la manche!`);
      this._updateChampion(winner.username, winner.displayName);
      this._announceChampion();
      this._rotateWinner(winnerKey, loserKey);
    } else {
      this._pushVoice('Manche terminée sans vainqueur.');
      this._resetPlayers();
      this._announceChampion();
    }
    this._emitState();
    this._fillEmptySlots();
  }

  _updateChampion(username, displayName) {
    const currentStreak = (this._winStreaks.get(username) || 0) + 1;
    this._winStreaks.set(username, currentStreak);
    Array.from(this._winStreaks.keys()).forEach((key) => {
      if (key !== username) {
        this._winStreaks.set(key, 0);
      }
    });
    if (!this.state.champion.username) {
      if (currentStreak >= this.state.champion.requiredToDethrone) {
        this.state.champion = {
          username,
          displayName,
          streak: currentStreak,
          requiredToDethrone: currentStreak + 1
        };
        this._pushVoice(`${displayName} devient le nouveau champion!`);
      }
      return;
    }
    if (this.state.champion.username === username) {
      this.state.champion.streak = currentStreak;
      this.state.champion.requiredToDethrone = currentStreak + 1;
      this._pushVoice(`Champion ${displayName} poursuit sa série à ${currentStreak} victoires.`);
      return;
    }
    if (currentStreak >= this.state.champion.requiredToDethrone) {
      this.state.champion = {
        username,
        displayName,
        streak: currentStreak,
        requiredToDethrone: currentStreak + 1
      };
      this._pushVoice(`${displayName} détrône le champion!`);
    }
  }

  _rotateWinner(winnerKey, loserKey) {
    if (winnerKey) {
      const winnerSlot = this.state.players[winnerKey];
      winnerSlot.ready = false;
      winnerSlot.score = 0;
      winnerSlot.timeLeft = this.state.settings.baseRoundDuration;
      this._startReadyTimer(winnerSlot);
    }
    if (loserKey) {
      const loserSlot = this.state.players[loserKey];
      if (loserSlot?.username) {
        this._clearReadyTimerByKey(loserSlot.username);
        this.state.queue.push({
          id: randomUUID(),
          username: loserSlot.username,
          displayName: loserSlot.displayName,
          joinedAt: Date.now(),
          priorityBoostedAt: null
        });
      }
      this.state.players[loserKey] = this._createEmptySlot(loserKey);
    }
    this._sortQueue();
  }

  _resetPlayers() {
    ['left', 'right'].forEach((key) => {
      const slot = this.state.players[key];
      if (slot?.username) {
        this._clearReadyTimerByKey(slot.username);
      }
      this.state.players[key] = this._createEmptySlot(key);
    });
  }

  _sortQueue() {
    this.state.queue.sort((a, b) => {
      const boostA = a.priorityBoostedAt || 0;
      const boostB = b.priorityBoostedAt || 0;
      if (boostA !== boostB) {
        return boostB - boostA;
      }
      return a.joinedAt - b.joinedAt;
    });
  }

  _isActivePlayer(username) {
    return (
      this.state.players.left.username === username ||
      this.state.players.right.username === username
    );
  }

  _findSlotByUsername(username) {
    if (!username) return null;
    if (this.state.players.left.username === username) {
      return this.state.players.left;
    }
    if (this.state.players.right.username === username) {
      return this.state.players.right;
    }
    return null;
  }

  _findSlotKeyByUsername(username) {
    if (!username) return null;
    if (this.state.players.left.username === username) return 'left';
    if (this.state.players.right.username === username) return 'right';
    return null;
  }

  _emitState() {
    if (typeof this.broadcastState === 'function') {
      this.broadcastState(this.state);
    }
  }

  _pushVoice(message) {
    if (!message) return;
    if (typeof this.broadcastEvent === 'function') {
      this.broadcastEvent({ type: 'voice', payload: { message } });
    }
  }

  _announceChampion() {
    const champion = this.state.champion;
    if (champion?.username) {
      this._pushVoice(
        `Champion actuel: ${champion.displayName} avec ${champion.streak} victoire${
          champion.streak > 1 ? 's' : ''
        }. Qui pourra le détrôner?`
      );
    } else {
      this._pushVoice('Pas encore de champion. Qui sera le premier à inscrire son nom au mur?');
    }
  }
}

module.exports = { GameEngine };
