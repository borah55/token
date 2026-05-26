/* ============================================
   storage.js — typed localStorage wrapper
   exposes window.OTCStore
============================================ */

(function () {
  'use strict';

  const KEYS = {
    history: 'otcsg_history_v1',
    watchlist: 'otcsg_watchlist_v1',
    settings: 'otcsg_settings_v1',
    tgSent:   'otcsg_tg_sent_v1'    // dedupe cache for Telegram auto-scan
  };

  const DEFAULT_SETTINGS = {
    sound: false,
    push: true,
    auto: true,
    filterWeak: true,

    // ----- Telegram -----
    tg: false,                  // master "enable Telegram forwarding" toggle
    tgToken: '',                // bot token from @BotFather
    tgChat: '',                 // chat / channel ID
    tgAuto: false,              // automatic background scanner
    tgMinStrength: 75,          // minimum signal strength % to forward
    tgIntervalSec: 60,          // how often (seconds) the scanner runs
    tgScanGroup: 'forex',       // 'all' | 'crypto' | 'forex' | 'forex_emerging'
                                // | 'commodity' | 'index' | 'stock' | 'synthetic'
                                // | 'watchlist'
    tgTimeframe: '1m',          // analysis timeframe used by the scanner
    tgSentDate: '',             // YYYY-MM-DD of the last counted day
    tgSentToday: 0,             // signals sent today
    tgSentTotal: 0,             // signals sent total
    tgLastError: ''             // human-readable last error, if any
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  const Store = {
    /* ===== Settings ===== */
    getSettings() {
      return Object.assign({}, DEFAULT_SETTINGS, read(KEYS.settings, {}));
    },
    saveSettings(patch) {
      const merged = Object.assign({}, this.getSettings(), patch || {});
      write(KEYS.settings, merged);
      return merged;
    },

    /* ===== History ===== */
    getHistory() { return read(KEYS.history, []); },
    addHistory(entry) {
      const list = this.getHistory();
      list.unshift(entry);
      // cap to last 200 signals
      if (list.length > 200) list.length = 200;
      write(KEYS.history, list);
      return entry;
    },
    updateHistory(id, patch) {
      const list = this.getHistory();
      const idx = list.findIndex(x => x.id === id);
      if (idx >= 0) {
        list[idx] = Object.assign({}, list[idx], patch);
        write(KEYS.history, list);
        return list[idx];
      }
      return null;
    },
    clearHistory() { write(KEYS.history, []); },
    historyStats() {
      const list = this.getHistory();
      const wins = list.filter(x => x.result === 'win').length;
      const losses = list.filter(x => x.result === 'loss').length;
      const total = wins + losses;
      const rate = total > 0 ? Math.round((wins / total) * 100) : 0;
      return { wins, losses, total, all: list.length, rate };
    },

    /* ===== Watchlist ===== */
    getWatchlist() { return read(KEYS.watchlist, ['BTCUSDT', 'ETHUSDT']); },
    toggleWatch(symbol) {
      const list = this.getWatchlist();
      const i = list.indexOf(symbol);
      if (i >= 0) list.splice(i, 1); else list.push(symbol);
      write(KEYS.watchlist, list);
      return list;
    },
    isWatched(symbol) { return this.getWatchlist().includes(symbol); },

    /* ===== Telegram dedupe cache =====
       Stores recently-sent signal keys (symbol|timeframe|direction|candleTime)
       so the auto-scanner doesn't send the same signal twice within an hour. */
    getTgSentCache() { return read(KEYS.tgSent, {}); },
    pruneTgSentCache(maxAgeMs) {
      maxAgeMs = maxAgeMs || 3600000; // 1 hour
      const now = Date.now();
      const cache = this.getTgSentCache();
      let changed = false;
      for (const k in cache) {
        if (now - cache[k] > maxAgeMs) { delete cache[k]; changed = true; }
      }
      if (changed) write(KEYS.tgSent, cache);
      return cache;
    },
    isTgSent(key) {
      const cache = this.pruneTgSentCache();
      return !!cache[key];
    },
    markTgSent(key) {
      const cache = this.pruneTgSentCache();
      cache[key] = Date.now();
      write(KEYS.tgSent, cache);
    },
    clearTgSentCache() { write(KEYS.tgSent, {}); },

    /* ===== Telegram daily counter ===== */
    todayKey() {
      const d = new Date();
      return d.getFullYear() + '-' +
             String(d.getMonth() + 1).padStart(2, '0') + '-' +
             String(d.getDate()).padStart(2, '0');
    },
    bumpTgSentCount() {
      const s = this.getSettings();
      const today = this.todayKey();
      let sentToday = s.tgSentToday || 0;
      if (s.tgSentDate !== today) sentToday = 0;
      sentToday++;
      const total = (s.tgSentTotal || 0) + 1;
      return this.saveSettings({
        tgSentDate: today,
        tgSentToday: sentToday,
        tgSentTotal: total
      });
    },
    resetTgSentCount() {
      this.saveSettings({ tgSentToday: 0, tgSentTotal: 0, tgSentDate: this.todayKey() });
      this.clearTgSentCache();
    }
  };

  window.OTCStore = Store;
})();
