/* ============================================
   notifications.js — toast popups, sound, Telegram
   exposes window.OTCNotify
============================================ */

(function () {
  'use strict';

  let host;
  function getHost() {
    if (!host) host = document.getElementById('toastHost');
    return host;
  }

  /* ----- Toast popups ----- */
  function toast({ type = 'info', title = '', desc = '', timeout = 4200, icon }) {
    const h = getHost();
    if (!h) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `
      <div class="toast-icon">${icon || (type === 'buy' ? '▲' : type === 'sell' ? '▼' : 'ℹ')}</div>
      <div class="toast-body">
        <div class="toast-title"></div>
        <div class="toast-desc"></div>
      </div>
    `;
    el.querySelector('.toast-title').textContent = title;
    el.querySelector('.toast-desc').textContent = desc;
    h.appendChild(el);

    const remove = () => {
      el.classList.add('exit');
      setTimeout(() => el.remove(), 260);
    };
    setTimeout(remove, timeout);
    el.addEventListener('click', remove);
  }

  /* ----- Sound: WebAudio synthesized chime, no asset needed ----- */
  let audioCtx;
  function ensureCtx() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    return audioCtx;
  }

  function playChime(direction) {
    const ctx = ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const notes = direction === 'sell'
      ? [659.25, 523.25]   // E5 -> C5 (descending)
      : [523.25, 659.25];  // C5 -> E5 (ascending)

    notes.forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      o.connect(g);
      g.connect(ctx.destination);

      const t0 = now + i * 0.14;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
      o.start(t0);
      o.stop(t0 + 0.34);
    });
  }

  /* ----- Telegram forwarding ----- */
  async function sendTelegram(text) {
    const s = window.OTCStore.getSettings();
    if (!s.tg || !s.tgToken || !s.tgChat) return { ok: false, skipped: true };
    const url = `https://api.telegram.org/bot${encodeURIComponent(s.tgToken)}/sendMessage`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: s.tgChat,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        })
      });
      const data = await res.json().catch(() => ({}));
      return { ok: !!data.ok, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function formatTelegram(sig) {
    const dir = sig.direction === 'BUY' ? '🟢 *BUY / CALL*' :
                sig.direction === 'SELL' ? '🔴 *SELL / PUT*' : '⚠️ *NO TRADE*';
    return [
      '📡 *OTC Signal Generator*',
      '',
      `*Pair:* ${sig.pairLabel}`,
      `*Broker:* ${sig.broker}`,
      `*Timeframe:* ${sig.timeframe}`,
      `*Action:* ${dir}`,
      `*Strength:* ${sig.strength}%`,
      `*Win probability:* ${sig.winProb}%`,
      `*Trend:* ${sig.trend}`,
      `*Entry price:* ${sig.entryPrice}`,
      sig.confluences && sig.confluences.length
        ? `\n*Confluences:* ${sig.confluences.slice(0, 6).join(', ')}`
        : ''
    ].filter(Boolean).join('\n');
  }

  /* ----- Public push() — combines toast + sound + telegram ----- */
  function push(sig, options) {
    const opt = options || {};
    const settings = window.OTCStore.getSettings();
    const type = sig.direction === 'BUY' ? 'buy' : sig.direction === 'SELL' ? 'sell' : 'info';
    const title = sig.direction === 'NEUTRAL'
      ? `${sig.pairLabel} — wait`
      : `${sig.direction} ${sig.pairLabel}`;
    const desc = sig.direction === 'NEUTRAL'
      ? `Market not aligned. Strength ${sig.strength}%`
      : `${sig.timeframe} • Strength ${sig.strength}% • Win ${sig.winProb}%`;

    if (settings.push && !opt.silent) toast({ type, title, desc });
    if (settings.sound && !opt.silent) playChime(type);
    if (settings.tg && !opt.silentTg && sig.direction !== 'NEUTRAL') {
      sendTelegram(formatTelegram(sig));
    }
  }

  window.OTCNotify = {
    toast,
    push,
    playChime,
    sendTelegram,
    formatTelegram,
    primeAudio() { ensureCtx(); }
  };
})();
