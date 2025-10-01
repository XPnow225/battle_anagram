const EventEmitter = require('events');

class TikTokBridge extends EventEmitter {
  constructor({ username, sessionId, enableLogs = false, TikTokLiveConnection }) {
    super();
    this.username = username;
    this.sessionId = sessionId;
    this.enableLogs = enableLogs;
    this.connection = null;
    this.TikTokLiveConnection = TikTokLiveConnection;
  }

  async connect() {
    if (!this.username) {
      throw new Error('TikTok username is required for production mode.');
    }
    const TikTokLiveConnection = this.TikTokLiveConnection;
    if (!TikTokLiveConnection) {
      throw new Error('TikTokLiveConnection dependency missing.');
    }
    this.connection = new TikTokLiveConnection(this.username, {
      sessionId: this.sessionId || undefined,
      enableExtendedGiftInfo: true,
      requestOptions: {
        timeout: 10000
      }
    });
    this.connection.on('streamEnd', () => this.emit('disconnect'));
    this.connection.on('disconnected', () => this.emit('disconnect'));
    this.connection.on('error', (err) => this.emit('error', err));
    this.connection.on('chat', (data) => {
      this.emit('chat', {
        username: data.uniqueId,
        displayName: data.nickname || data.uniqueId,
        comment: data.comment
      });
    });
    this.connection.on('gift', (data) => {
      this.emit('gift', {
        username: data.uniqueId,
        displayName: data.nickname || data.uniqueId,
        giftName: data.giftName,
        diamonds: data.diamondCount || 0
      });
    });
    this.connection.on('follow', (data) => {
      this.emit('follow', {
        username: data.uniqueId,
        displayName: data.nickname || data.uniqueId
      });
    });
    await this.connection.connect();
    if (this.enableLogs) {
      this.connection.on('connected', (state) => {
        this.emit('log', `Connecté au live ${state.roomId}`);
      });
    }
  }

  disconnect() {
    if (this.connection) {
      this.connection.disconnect();
    }
  }
}

module.exports = { TikTokBridge };
