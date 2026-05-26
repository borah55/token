/* ============================================
   storage.js — typed localStorage wrapper
   exposes window.OTCStore
============================================ */

(function () {
  'use strict';

  const KEYS = {
    history: 'otcsg_history_v1',
    watchlist: 'otcsg_watchlist_v1',
    settings: 'otcsg_settings_v1'
  };

  const DEFAULT_SETTINGS = {
    sound: false,
    push: true,
    auto: true,
    filterWeak: true,
    tg: false,
    tgToken: '',
    tgChat: ''
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
    isWatched(symbol) { return this.getWatchlist().includes(symbol); }
  };

  window.OTCStore = Store;
})();
