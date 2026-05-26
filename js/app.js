/* ============================================
   app.js — main controller
   - screen routing
   - generate-signal flow
   - live scanner / auto-refresh
   - history / watchlist / settings UI
============================================ */

(function () {
  'use strict';

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  const Store = window.OTCStore;
  const Notify = window.OTCNotify;
  const Api = window.OTCApi;
  const Strategy = window.OTCStrategy;

  /* =================================================================
     STATE
  ================================================================= */
  const state = {
    timeframe: '5m',
    activeSignal: null,
    countdownTimer: null,
    autoTimer: null,
    liveFilter: 'all',
    chartTimer: null
  };

  /* =================================================================
     INIT
  ================================================================= */
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    // Hide splash after a short delay (gives CSS/scripts a tick)
    setTimeout(() => {
      const splash = $('#splash');
      if (splash) splash.remove();
      $('#app').hidden = false;
    }, 600);

    bindNavigation();
    bindHomeScreen();
    bindLiveScreen();
    bindHistoryScreen();
    bindWatchlistScreen();
    bindSettingsScreen();

    // Initial renders
    renderHistory();
    renderWatchlist();
    loadSettings();

    // Start live scanner & watchlist auto-refresh
    startAutoRefresh();
  }

  /* =================================================================
     NAVIGATION
  ================================================================= */
  function bindNavigation() {
    $$('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        switchScreen(target);
      });
    });
  }

  function switchScreen(name) {
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.target === name));
    $$('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === name));
    // Lazy-refresh certain screens
    if (name === 'live') refreshLiveList();
    if (name === 'watch') renderWatchlist();
    if (name === 'history') renderHistory();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* =================================================================
     HOME (signal generator)
  ================================================================= */
  function bindHomeScreen() {
    // TF pills
    $$('.tf-pill').forEach(p => {
      p.addEventListener('click', () => {
        $$('.tf-pill').forEach(x => x.classList.remove('active'));
        p.classList.add('active');
        state.timeframe = p.dataset.tf;
      });
    });

    $('#generateBtn').addEventListener('click', onGenerate);

    // Update mini chart whenever asset is changed
    $('#asset').addEventListener('change', () => {
      if (state.activeSignal) renderMiniChart($('#asset').value);
    });
  }

  async function onGenerate() {
    Notify.primeAudio(); // unlock audio context on user gesture

    const symbol = $('#asset').value;
    const broker = $('#broker').selectedOptions[0].textContent.trim();
    const tf = state.timeframe;

    const btn = $('#generateBtn');
    btn.disabled = true;
    btn.classList.add('loading');
    btn.querySelector('span').textContent = 'ANALYZING MARKET…';

    showSkeletonResult();

    try {
      const sig = await Strategy.analyze(symbol, tf);
      sig.broker = broker;

      // Filter weak signals if enabled
      const settings = Store.getSettings();
      if (settings.filterWeak && sig.direction !== 'NEUTRAL' && sig.strength < 65) {
        sig.direction = 'NEUTRAL';
        sig.confluences.unshift('Weak signal filtered (<65%)');
      }

      state.activeSignal = sig;
      renderSignalResult(sig);
      startCountdown(sig);
      renderMiniChart(symbol);
      Notify.push(sig);

      // Persist to history (pending)
      Store.addHistory({
        id: sig.id,
        symbol: sig.symbol,
        pairLabel: sig.pairLabel,
        broker: sig.broker,
        timeframe: sig.timeframe,
        direction: sig.direction,
        strength: sig.strength,
        winProb: sig.winProb,
        trend: sig.trend,
        entryPrice: sig.entryPrice,
        entryRaw: sig.entryRaw,
        ts: Date.now(),
        result: sig.direction === 'NEUTRAL' ? 'skipped' : 'pending'
      });
      renderHistory();
    } catch (e) {
      console.error(e);
      Notify.toast({ type: 'sell', title: 'Analysis failed', desc: e.message || 'Try a different pair' });
      $('#signalResult').hidden = true;
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.querySelector('span').textContent = 'GENERATE SIGNAL';
    }
  }

  function showSkeletonResult() {
    const host = $('#signalResult');
    host.hidden = false;
    host.className = 'signal-result';
    host.innerHTML = `
      <div class="skel" style="height:46px;margin-bottom:12px"></div>
      <div class="sig-meta">
        <div class="skel" style="height:60px"></div>
        <div class="skel" style="height:60px"></div>
        <div class="skel" style="height:60px"></div>
        <div class="skel" style="height:60px"></div>
      </div>
      <div class="skel" style="height:48px"></div>
    `;
  }

  function renderSignalResult(sig) {
    const host = $('#signalResult');
    host.hidden = false;
    const isBuy = sig.direction === 'BUY';
    const isSell = sig.direction === 'SELL';
    const isNeutral = sig.direction === 'NEUTRAL';

    host.className = 'signal-result ' + (isBuy ? 'buy pop glow-ring' : isSell ? 'sell pop glow-ring' : 'skip pop');

    const actionClass = isBuy ? 'buy' : isSell ? 'sell' : 'skip';
    const actionLabel = isBuy ? 'BUY / CALL ▲' : isSell ? 'SELL / PUT ▼' : 'NO TRADE';

    const trendCls = sig.trend === 'Bullish' ? 'up' : sig.trend === 'Bearish' ? 'down' : '';
    const rsiCls = sig.rsi == null ? '' : sig.rsi < 30 ? 'up' : sig.rsi > 70 ? 'down' : '';

    host.innerHTML = `
      <div class="sig-head">
        <div class="sig-pair">${sig.broker || ''} • ${sig.timeframe}<strong>${escapeHtml(sig.pairLabel)}</strong></div>
        <div class="sig-action ${actionClass}">${actionLabel}</div>
      </div>

      <div class="sig-meta">
        <div class="m">
          <div class="m-lbl">Entry price</div>
          <div class="m-val">${escapeHtml(sig.entryPrice)}</div>
        </div>
        <div class="m">
          <div class="m-lbl">Trend</div>
          <div class="m-val ${trendCls}">${escapeHtml(sig.trend)}</div>
        </div>
        <div class="m">
          <div class="m-lbl">Win probability</div>
          <div class="m-val">${isNeutral ? '—' : sig.winProb + '%'}</div>
        </div>
        <div class="m">
          <div class="m-lbl">RSI</div>
          <div class="m-val ${rsiCls}">${sig.rsi != null ? sig.rsi : '—'}</div>
        </div>
      </div>

      <div>
        <div class="m-lbl" style="color:var(--text-dim);font-size:11px;letter-spacing:1px;text-transform:uppercase">Signal strength</div>
        <div class="sig-bar ${actionClass}"><i style="width:${sig.strength}%"></i></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-dim);margin-top:4px">
          <span>0%</span><strong style="color:var(--text)">${sig.strength}%</strong><span>100%</span>
        </div>
      </div>

      <div class="sig-confluence" style="margin-top:14px">
        <div class="conf-title">Confluences (${sig.confluences.length})</div>
        <ul>
          ${(sig.confluenceObjs || []).slice(0, 10).map(c =>
            `<li class="${c.dir < 0 ? 'neg' : ''}">${escapeHtml(c.text)}</li>`
          ).join('')}
        </ul>
      </div>

      <div class="sig-countdown">
        <div>
          <div class="cd-lbl">Candle expires in</div>
          <div class="cd-lbl" style="font-size:11px;margin-top:2px">Trade expiry: ${sig.timeframe}</div>
        </div>
        <div class="cd-val" id="cdVal">--:--</div>
      </div>

      ${isNeutral ? '' : `
      <div class="sig-actions">
        <button data-r="win" class="win">Mark Win</button>
        <button data-r="loss" class="loss">Mark Loss</button>
        <button data-r="skip">Cancel</button>
      </div>`}
    `;

    // Wire mark win/loss
    $$('.sig-actions button', host).forEach(b => {
      b.addEventListener('click', () => {
        const r = b.dataset.r;
        Store.updateHistory(sig.id, { result: r === 'skip' ? 'skipped' : r });
        renderHistory();
        Notify.toast({
          type: r === 'win' ? 'buy' : r === 'loss' ? 'sell' : 'info',
          title: r === 'skip' ? 'Trade cancelled' : `Marked as ${r.toUpperCase()}`,
          desc: sig.pairLabel
        });
      });
    });
  }

  function startCountdown(sig) {
    if (state.countdownTimer) { clearInterval(state.countdownTimer); state.countdownTimer = null; }
    const start = Date.now();
    const totalMs = sig.candleSecRemaining * 1000;

    function tick() {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, totalMs - elapsed);
      const s = Math.ceil(remaining / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      const el = $('#cdVal');
      if (el) {
        el.textContent = `${mm}:${ss}`;
        if (remaining <= 0) {
          el.classList.add('expired');
          el.textContent = 'EXPIRED';
          clearInterval(state.countdownTimer);
        }
      } else {
        clearInterval(state.countdownTimer);
      }
    }
    tick();
    state.countdownTimer = setInterval(tick, 250);
  }

  /* ----- mini chart ----- */
  async function renderMiniChart(symbol) {
    const card = $('#chartCard');
    card.hidden = false;

    $('#chartPair').textContent = Api.formatSymbol(symbol);

    try {
      const { candles } = await Api.getCandles(symbol, state.timeframe, 80);
      window.OTCChart.render(candles);

      const last = candles[candles.length - 1];
      const first = candles[0];
      const changePct = ((last.close - first.open) / first.open) * 100;

      $('#chartPrice').textContent = Api.fmtPrice(symbol, last.close);
      const ch = $('#chartChange');
      ch.textContent = (changePct >= 0 ? '▲ ' : '▼ ') + Math.abs(changePct).toFixed(2) + '%';
      ch.className = 'chart-change ' + (changePct >= 0 ? 'up' : 'down');
    } catch (e) {
      console.warn('chart render failed', e);
    }
  }

  /* =================================================================
     LIVE SCANNER
  ================================================================= */
  function bindLiveScreen() {
    $$('.scanner-controls .chip[data-filter]').forEach(c => {
      c.addEventListener('click', () => {
        $$('.scanner-controls .chip').forEach(x => x.classList.remove('chip-active'));
        c.classList.add('chip-active');
        state.liveFilter = c.dataset.filter;
        refreshLiveList();
      });
    });
    $('#rescanBtn').addEventListener('click', () => refreshLiveList(true));
  }

  function pairsForFilter(f) {
    if (f === 'crypto') return Api.ALL_PAIRS.crypto;
    if (f === 'forex') return Api.ALL_PAIRS.forex;
    if (f === 'synthetic') return Api.ALL_PAIRS.synthetic;
    return [...Api.ALL_PAIRS.crypto.slice(0, 8), ...Api.ALL_PAIRS.forex.slice(0, 5), ...Api.ALL_PAIRS.synthetic.slice(0, 3)];
  }

  async function refreshLiveList(force) {
    const host = $('#liveList');
    if (!host) return;
    if (!host.children.length || force) {
      host.innerHTML = Array(6).fill(0).map(() => '<div class="skel"></div>').join('');
    }

    const pairs = pairsForFilter(state.liveFilter);
    const tf = state.timeframe;
    const settings = Store.getSettings();

    const results = [];
    // Throttled parallel: chunks of 4
    for (let i = 0; i < pairs.length; i += 4) {
      const chunk = pairs.slice(i, i + 4);
      const part = await Promise.all(chunk.map(p =>
        Strategy.analyze(p, tf).catch(e => null)
      ));
      part.forEach(r => { if (r) results.push(r); });
    }

    // Sort: BUY/SELL first by strength desc, NEUTRAL last
    results.sort((a, b) => {
      const av = a.direction === 'NEUTRAL' ? -1 : a.strength;
      const bv = b.direction === 'NEUTRAL' ? -1 : b.strength;
      return bv - av;
    });

    if (settings.filterWeak) {
      results.forEach(r => {
        if (r.direction !== 'NEUTRAL' && r.strength < 65) r.direction = 'NEUTRAL';
      });
    }

    host.innerHTML = '';
    if (!results.length) {
      host.innerHTML = '<div class="empty"><span class="emoji">📡</span>No data available</div>';
      return;
    }

    results.forEach(r => host.appendChild(renderLiveRow(r)));
  }

  function renderLiveRow(sig) {
    const row = document.createElement('div');
    const cls = sig.direction === 'BUY' ? 'buy' : sig.direction === 'SELL' ? 'sell' : 'skip';
    row.className = `live-row ${cls} pop`;
    const fav = Store.isWatched(sig.symbol);
    row.innerHTML = `
      <div>
        <div class="lr-pair">${escapeHtml(sig.pairLabel)}</div>
        <div class="lr-sub">${sig.timeframe} • ${escapeHtml(sig.trend)} • ${sig.confluences.length} confluences</div>
      </div>
      <div class="lr-action ${cls}">${sig.direction === 'BUY' ? '▲ BUY' : sig.direction === 'SELL' ? '▼ SELL' : 'WAIT'}</div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="lr-strength">${sig.direction === 'NEUTRAL' ? '—' : sig.strength + '%'}</div>
        <button class="lr-fav ${fav ? 'on' : ''}" title="Watchlist" data-sym="${sig.symbol}">${fav ? '★' : '☆'}</button>
      </div>
    `;
    // Click row → open this pair on home screen
    row.addEventListener('click', (e) => {
      if (e.target.closest('.lr-fav')) return;
      $('#asset').value = sig.symbol;
      // ensure dropdown reflects choice (option may be in optgroup)
      switchScreen('home');
      onGenerate();
    });
    // Watchlist toggle
    row.querySelector('.lr-fav').addEventListener('click', (e) => {
      e.stopPropagation();
      Store.toggleWatch(sig.symbol);
      refreshLiveList();
      renderWatchlist();
    });
    return row;
  }

  /* ===== Auto-refresh ===== */
  function startAutoRefresh() {
    stopAutoRefresh();
    const settings = Store.getSettings();
    if (!settings.auto) return;
    state.autoTimer = setInterval(() => {
      const activeScreen = $('.screen.active');
      if (!activeScreen) return;
      const name = activeScreen.dataset.screen;
      if (name === 'live') refreshLiveList();
      else if (name === 'watch') renderWatchlist();
    }, 30000);
  }
  function stopAutoRefresh() {
    if (state.autoTimer) { clearInterval(state.autoTimer); state.autoTimer = null; }
  }

  /* =================================================================
     HISTORY
  ================================================================= */
  function bindHistoryScreen() {
    $('#clearHistoryBtn').addEventListener('click', () => {
      if (!confirm('Clear all signal history?')) return;
      Store.clearHistory();
      renderHistory();
      Notify.toast({ type: 'info', title: 'History cleared', desc: 'All signals removed' });
    });
  }

  function renderHistory() {
    const list = Store.getHistory();
    const stats = Store.historyStats();
    $('#statWins').textContent = stats.wins;
    $('#statLosses').textContent = stats.losses;
    $('#statTotal').textContent = stats.all;
    $('#statRate').textContent = stats.rate + '%';

    const host = $('#historyList');
    if (!list.length) {
      host.innerHTML = '<div class="empty"><span class="emoji">📭</span>No signals yet. Generate one!</div>';
      return;
    }

    host.innerHTML = '';
    list.forEach(item => {
      const row = document.createElement('div');
      const cls = item.result === 'win' ? 'win' : item.result === 'loss' ? 'loss' : 'pending';
      row.className = `hist-row ${cls}`;
      const dirCls = item.direction === 'BUY' ? 'buy' : 'sell';
      const dirLabel = item.direction === 'BUY' ? '▲' : item.direction === 'SELL' ? '▼' : '–';
      const date = new Date(item.ts);
      const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' • ' +
                   date.toLocaleDateString();
      const resultLabel =
        item.result === 'win' ? 'WIN' :
        item.result === 'loss' ? 'LOSS' :
        item.result === 'skipped' ? 'SKIP' : 'PENDING';

      row.innerHTML = `
        <div class="hist-icon ${dirCls}">${dirLabel}</div>
        <div>
          <div class="hist-pair">${escapeHtml(item.pairLabel)}</div>
          <div class="hist-meta">${escapeHtml(item.broker || '')} • ${item.timeframe} • ${item.entryPrice} • ${time}</div>
        </div>
        <div class="hist-result ${cls}">${resultLabel}</div>
      `;
      row.addEventListener('click', () => {
        if (item.result !== 'pending') return;
        const r = prompt('Mark this signal as: win / loss / skip', 'win');
        if (!r) return;
        const v = r.trim().toLowerCase();
        if (!['win', 'loss', 'skip', 'skipped'].includes(v)) return;
        Store.updateHistory(item.id, { result: v === 'skip' ? 'skipped' : v });
        renderHistory();
      });
      host.appendChild(row);
    });
  }

  /* =================================================================
     WATCHLIST
  ================================================================= */
  function bindWatchlistScreen() { /* nothing extra */ }

  async function renderWatchlist() {
    const host = $('#watchList');
    const list = Store.getWatchlist();
    if (!list.length) {
      host.innerHTML = '<div class="empty"><span class="emoji">⭐</span>Add pairs from the Live tab to track them here.</div>';
      return;
    }
    host.innerHTML = list.map(() => '<div class="skel"></div>').join('');
    const tf = state.timeframe;
    const results = [];
    for (const sym of list) {
      try { results.push(await Strategy.analyze(sym, tf)); } catch (e) {}
    }
    host.innerHTML = '';
    results.forEach(r => host.appendChild(renderLiveRow(r)));
  }

  /* =================================================================
     SETTINGS
  ================================================================= */
  function bindSettingsScreen() {
    const map = {
      sound: '#setSound', push: '#setPush', auto: '#setAuto',
      filterWeak: '#setFilter', tg: '#setTg'
    };
    Object.keys(map).forEach(k => {
      const el = $(map[k]);
      if (!el) return;
      el.addEventListener('change', () => {
        Store.saveSettings({ [k]: el.checked });
        if (k === 'auto') startAutoRefresh();
        if (k === 'sound' && el.checked) {
          Notify.primeAudio();
          Notify.playChime('buy');
        }
      });
    });

    ['tgToken', 'tgChat'].forEach(k => {
      const el = $('#' + k);
      el.addEventListener('change', () => Store.saveSettings({ [k]: el.value.trim() }));
    });

    $('#tgTestBtn').addEventListener('click', async () => {
      const r = await Notify.sendTelegram('✅ Test message from OTC Signal Generator');
      if (r.ok) Notify.toast({ type: 'buy', title: 'Telegram OK', desc: 'Test message delivered' });
      else if (r.skipped) Notify.toast({ type: 'sell', title: 'Telegram off', desc: 'Enable it and add bot token + chat ID' });
      else Notify.toast({ type: 'sell', title: 'Telegram failed', desc: r.error || 'Check token / chat ID' });
    });
  }

  function loadSettings() {
    const s = Store.getSettings();
    $('#setSound').checked = !!s.sound;
    $('#setPush').checked = !!s.push;
    $('#setAuto').checked = !!s.auto;
    $('#setFilter').checked = !!s.filterWeak;
    $('#setTg').checked = !!s.tg;
    $('#tgToken').value = s.tgToken || '';
    $('#tgChat').value = s.tgChat || '';
  }

  /* =================================================================
     util
  ================================================================= */
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
})();
