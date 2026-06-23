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

  /* ----- Telegram forwarding -----
     Telegram Bot API is CORS-friendly so we hit it directly from the
     browser. We surface clear error messages so users can debug bad
     tokens / chat IDs without inspecting devtools.
  */
  async function sendTelegram(text, opts) {
    opts = opts || {};
    const s = window.OTCStore.getSettings();

    const token = (opts.token || s.tgToken || '').trim();
    const chat  = (opts.chat  || s.tgChat  || '').trim();

    if (!opts.force) {
      // master toggle off → silent skip
      if (!s.tg) return { ok: false, skipped: true, reason: 'tg-disabled' };
    }
    if (!token) {
      window.OTCStore.saveSettings({ tgLastError: 'Bot token missing' });
      return { ok: false, error: 'Bot token missing' };
    }
    if (!chat) {
      window.OTCStore.saveSettings({ tgLastError: 'Chat ID missing' });
      return { ok: false, error: 'Chat ID missing' };
    }
    // Token format: <number>:<base64-ish>
    if (!/^\d+:[A-Za-z0-9_\-]{20,}$/.test(token)) {
      window.OTCStore.saveSettings({ tgLastError: 'Bot token format looks invalid' });
      return { ok: false, error: 'Bot token format looks invalid' };
    }

    const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        })
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.ok) {
        window.OTCStore.saveSettings({ tgLastError: '' });
        return { ok: true, data };
      }
      // Telegram returned an error. Common cases:
      //   401 Unauthorized   -> bad token
      //   400 Bad Request    -> chat not found, bot blocked, parse error
      //   403 Forbidden      -> bot kicked from chat
      //   429 Too Many       -> rate limited
      let err = (data && (data.description || data.error_code)) || ('HTTP ' + res.status);
      if (res.status === 401) err = 'Unauthorized — check the bot token';
      else if (res.status === 403) err = 'Forbidden — add the bot to the chat first';
      else if (res.status === 404) err = 'Bot not found — token may be revoked';
      else if (data && data.description && /chat not found/i.test(data.description)) {
        err = 'Chat not found — verify the chat ID (use a numeric ID, e.g. -100…)';
      }
      window.OTCStore.saveSettings({ tgLastError: err });
      return { ok: false, error: err, data };
    } catch (e) {
      const err = (e && e.message) || 'Network error';
      window.OTCStore.saveSettings({ tgLastError: err });
      return { ok: false, error: err };
    }
  }

  function formatTelegram(sig) {
    const dir = sig.direction === 'BUY' ? '🟢 *BUY / CALL*' :
                sig.direction === 'SELL' ? '🔴 *SELL / PUT*' : '⚠️ *NO TRADE*';
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const lines = [
      '📡 *OTC Signal Generator*',
      '',
      `*Pair:* ${escapeMd(sig.pairLabel)}`,
      `*Broker:* ${escapeMd(sig.broker || '—')}`,
      `*Timeframe:* ${escapeMd(sig.timeframe)}`,
      `*Action:* ${dir}`,
      `*Strength:* ${sig.strength}%`,
      `*Win probability:* ${sig.winProb}%`,
      `*Trend:* ${escapeMd(sig.trend)}`,
      `*RSI:* ${sig.rsi != null ? sig.rsi : '—'}`,
      `*Entry price:* ${escapeMd(sig.entryPrice)}`,
      `*Time:* ${time}`
    ];

    if (sig.smc) {
      const smcBits = [];
      if (sig.smc.bos)         smcBits.push(`BOS ${sig.smc.bos === 'bos-up' ? '▲' : '▼'}`);
      if (sig.smc.choch)       smcBits.push(`CHoCH ${sig.smc.choch === 'choch-up' ? '▲' : '▼'}`);
      if (sig.smc.sweep)       smcBits.push(`Sweep ${sig.smc.sweep === 'sweep-low' ? '▲' : '▼'}`);
      if (sig.smc.orderBlock)  smcBits.push(`OB ${sig.smc.orderBlock === 'bullish' ? '▲' : '▼'}`);
      if (sig.smc.fvg)         smcBits.push(`FVG ${sig.smc.fvg === 'bullish' ? '▲' : '▼'}`);
      if (sig.smc.zone)        smcBits.push(`Zone ${sig.smc.zone}`);
      if (smcBits.length) lines.push('', `*SMC:* ${escapeMd(smcBits.join(' • '))}`);
    }

    if (sig.confluences && sig.confluences.length) {
      lines.push('', `*Confluences:* ${escapeMd(sig.confluences.slice(0, 6).join(', '))}`);
    }

    return lines.join('\n');
  }

  // Telegram Markdown reserves: _ * ` [
  // Escape them so user-supplied symbol names don't break formatting.
  function escapeMd(s) {
    return String(s == null ? '' : s).replace(/([_*`\[])/g, '\\$1');
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
