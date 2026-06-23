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
    chartTimer: null,

    // Auto-Telegram scanner state
    tgTimer: null,            // setInterval id for the scanner
    tgRunning: false,         // true while a scan pass is in flight
    tgLastScanAt: null,       // ms timestamp of last completed scan
    tgStatusTimer: null,      // ticks the "X seconds ago" line in the UI

    // Diagnostic counters from the most recent scan pass
    tgDiag: {
      pairs: 0,         // total pairs analyzed
      found: 0,         // non-NEUTRAL signals returned by the engine
      skippedWeak: 0,   // signals dropped because strength < threshold
      deduped: 0,       // signals already sent (dedupe cache hit)
      sent: 0,          // newly forwarded this scan
      failed: 0,        // Telegram send failures this scan
      hint: ''          // human-readable summary
    }
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

    populateAssetDropdown();
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

    // Start the Telegram auto-scanner if it's enabled
    startTelegramScanner();
    startTelegramStatusTicker();
  }

  /* =================================================================
     ASSET DROPDOWN — built from window.OTCApi.ASSETS registry
  ================================================================= */
  const GROUP_LABELS = {
    crypto:         'Crypto OTC',
    forex_major:    'Forex Majors (OTC)',
    forex_cross:    'Forex Crosses (OTC)',
    forex_exotic:   'Forex Exotics (OTC)',
    forex_emerging: 'Emerging Markets (INR · BRL · IDR · PKR · BDT…)',
    commodity:      'Commodities (Gold, Oil, etc.)',
    index:          'Indices (S&P, Nasdaq, etc.)',
    stock:          'Stocks (OTC)',
    synthetic:      'Synthetic (Volatility, Boom, Crash)'
  };
  const GROUP_ORDER = ['crypto', 'forex_major', 'forex_cross', 'forex_exotic', 'forex_emerging', 'commodity', 'index', 'stock', 'synthetic'];

  function populateAssetDropdown() {
    const sel = $('#asset');
    if (!sel) return;
    const byGroup = {};
    Api.ASSETS.forEach(a => { (byGroup[a.group] = byGroup[a.group] || []).push(a); });

    sel.innerHTML = '';
    GROUP_ORDER.forEach(g => {
      if (!byGroup[g]) return;
      const og = document.createElement('optgroup');
      og.label = GROUP_LABELS[g] || g;
      byGroup[g].forEach(a => {
        const o = document.createElement('option');
        o.value = a.id;
        o.textContent = a.label;
        if (a.id === 'ETHUSDT') o.selected = true;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
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

      ${renderSmcSummary(sig)}

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
          ${(sig.confluenceObjs || []).slice(0, 12).map(c =>
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

  /* ----- SMC summary block (shown above the strength bar) ----- */
  function renderSmcSummary(sig) {
    if (!sig || !sig.smc) return '';
    const s = sig.smc;
    const items = [];
    function pill(label, value, cls) {
      items.push(`<span class="smc-pill ${cls || ''}">${escapeHtml(label)}: <strong>${escapeHtml(value)}</strong></span>`);
    }
    if (s.bos)   pill('BOS', s.bos === 'bos-up' ? '▲ Up' : '▼ Down', s.bos === 'bos-up' ? 'bull' : 'bear');
    if (s.choch) pill('CHoCH', s.choch === 'choch-up' ? '▲ Up' : '▼ Down', s.choch === 'choch-up' ? 'bull' : 'bear');
    if (s.sweep) pill('Sweep', s.sweep === 'sweep-low' ? 'Buy-side ▲' : 'Sell-side ▼', s.sweep === 'sweep-low' ? 'bull' : 'bear');
    if (s.orderBlock) pill('OB', s.orderBlock === 'bullish' ? '▲ Bullish' : '▼ Bearish', s.orderBlock === 'bullish' ? 'bull' : 'bear');
    if (s.fvg)        pill('FVG', s.fvg === 'bullish' ? '▲ Bullish' : '▼ Bearish', s.fvg === 'bullish' ? 'bull' : 'bear');
    if (s.zone)       pill('Zone', s.zone[0].toUpperCase() + s.zone.slice(1));

    if (!items.length) return '';
    return `
      <div class="smc-block">
        <div class="conf-title">Smart Money Concepts</div>
        <div class="smc-pills">${items.join('')}</div>
      </div>
    `;
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
    return Api.PAIRS_FILTER[f] || Api.PAIRS_FILTER.all;
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
    // Throttled parallel: chunks of 5
    for (let i = 0; i < pairs.length; i += 5) {
      const chunk = pairs.slice(i, i + 5);
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
    // Generic toggle settings
    const toggleMap = {
      sound: '#setSound', push: '#setPush', auto: '#setAuto',
      filterWeak: '#setFilter', tg: '#setTg', tgAuto: '#setTgAuto'
    };
    Object.keys(toggleMap).forEach(k => {
      const el = $(toggleMap[k]);
      if (!el) return;
      el.addEventListener('change', () => {
        const patch = { [k]: el.checked };

        // === Telegram setup convenience ===
        // If the user enables the auto-scanner, automatically enable
        // forwarding too — having "auto on" + "forwarding off" was the
        // most common cause of "scanner does nothing" reports.
        if (k === 'tgAuto' && el.checked) {
          patch.tg = true;
          if ($('#setTg')) $('#setTg').checked = true;
        }
        // Disabling forwarding should also stop the auto scanner so
        // the status line reflects reality.
        if (k === 'tg' && !el.checked) {
          patch.tgAuto = false;
          if ($('#setTgAuto')) $('#setTgAuto').checked = false;
        }

        Store.saveSettings(patch);

        if (k === 'auto') startAutoRefresh();
        if (k === 'sound' && el.checked) {
          Notify.primeAudio();
          Notify.playChime('buy');
        }
        if (k === 'tg' || k === 'tgAuto') {
          startTelegramScanner();
          updateTgStatusUI();
        }
      });
    });

    // Text inputs
    ['tgToken', 'tgChat'].forEach(k => {
      const el = $('#' + k);
      el.addEventListener('change', () => {
        Store.saveSettings({ [k]: el.value.trim() });
        startTelegramScanner();
      });
    });

    // Strength slider
    const minEl = $('#tgMinStrength');
    const minOut = $('#tgMinStrengthOut');
    if (minEl) {
      minEl.addEventListener('input', () => {
        if (minOut) minOut.textContent = minEl.value + '%';
      });
      minEl.addEventListener('change', () => {
        Store.saveSettings({ tgMinStrength: +minEl.value });
      });
    }

    // Interval input
    const intEl = $('#tgInterval');
    if (intEl) {
      intEl.addEventListener('change', () => {
        const n = Math.max(20, Math.min(900, +intEl.value || 60));
        intEl.value = n;
        Store.saveSettings({ tgIntervalSec: n });
        startTelegramScanner();
      });
    }

    // Scan group + timeframe
    const grpEl = $('#tgScanGroup');
    if (grpEl) grpEl.addEventListener('change', () => Store.saveSettings({ tgScanGroup: grpEl.value }));
    const tfEl = $('#tgTimeframe');
    if (tfEl) tfEl.addEventListener('change', () => Store.saveSettings({ tgTimeframe: tfEl.value }));

    // Test button
    $('#tgTestBtn').addEventListener('click', async () => {
      const r = await Notify.sendTelegram(
        '✅ *OTC Signal Generator — test message*\n\nIf you see this, your bot token and chat ID are correctly configured.',
        { force: true }
      );
      if (r.ok) Notify.toast({ type: 'buy', title: 'Telegram OK', desc: 'Test message delivered' });
      else Notify.toast({ type: 'sell', title: 'Telegram failed', desc: r.error || 'Check token / chat ID' });
      updateTgStatusUI();
    });

    // Force-scan button
    const forceBtn = $('#tgScanNowBtn');
    if (forceBtn) {
      forceBtn.addEventListener('click', () => runTelegramScan(true));
    }

    // Reset counter button
    const resetBtn = $('#tgResetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (!confirm('Reset Telegram signal counter and dedupe cache?')) return;
        Store.resetTgSentCount();
        updateTgStatusUI();
        Notify.toast({ type: 'info', title: 'Counter reset', desc: 'Daily Telegram counter cleared' });
      });
    }

    // Setup diagnostic — runs the full pipeline against a known-good
    // pair and shows where any failure occurs (token / chat / network /
    // signal threshold / dedupe).
    const diagBtn = $('#tgDiagBtn');
    if (diagBtn) {
      diagBtn.addEventListener('click', runSetupDiagnostic);
    }
  }

  async function runSetupDiagnostic() {
    const s = Store.getSettings();
    const lines = [];
    let ok = true;

    function step(label, passed, detail) {
      lines.push(`${passed ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
      if (!passed) ok = false;
    }

    // 1) Token + chat ID present?
    step('Bot token entered', !!s.tgToken, s.tgToken ? '' : 'paste a token from @BotFather');
    step('Chat ID entered',   !!s.tgChat,  s.tgChat ? '' : 'paste your chat / channel ID');

    // 2) Token format
    const tokOk = /^\d+:[A-Za-z0-9_\-]{20,}$/.test((s.tgToken || '').trim());
    step('Token format looks valid', tokOk, tokOk ? '' : 'expected NUMBER:LETTERS form');

    // 3) Forwarding switch on
    step('Forwarding enabled', !!s.tg, s.tg ? '' : 'toggle "Enable Telegram forwarding"');

    // 4) Try sending a test message right now
    if (s.tgToken && s.tgChat && tokOk) {
      const r = await Notify.sendTelegram(
        '🔧 *Setup Diagnostic*\n\nIf you see this, your Telegram pipeline works end-to-end. The auto-scanner will now forward every qualifying signal.',
        { force: true }
      );
      step('Telegram API responded OK', r.ok, r.ok ? 'message delivered' : (r.error || 'unknown error'));
    } else {
      step('Telegram API responded OK', false, 'skipped (missing credentials)');
    }

    // 5) Auto-scanner state
    step('Auto-scanner enabled', !!s.tgAuto, s.tgAuto ? '' : 'toggle "Forward strong signals automatically"');

    // 6) Threshold sanity
    const minS = +s.tgMinStrength || 75;
    if (minS > 85) {
      step('Threshold is reachable', false, `${minS}% is very high — try 65–75%`);
    } else {
      step('Threshold is reachable', true, `${minS}% is reasonable`);
    }

    // 7) Run a one-shot live scan and show counts
    Notify.toast({ type: 'info', title: 'Diagnostic running…', desc: 'Scanning the market once' });
    await runTelegramScan(true, /*diagnostic*/ true);
    const d = state.tgDiag;
    step(
      'Scan completed',
      d.pairs > 0,
      `analysed ${d.pairs} pair(s), found ${d.found} signal(s), forwarded ${d.sent}`
    );

    Notify.toast({
      type: ok ? 'buy' : 'sell',
      title: ok ? 'Setup looks healthy ✓' : 'Setup needs attention',
      desc: lines.slice(-1)[0],
      timeout: 5000
    });

    // Render full results inside the diagnostic box
    const box = $('#tgDiagBox');
    const hint = $('#tgDiagHint');
    if (box && hint) {
      box.style.display = 'block';
      hint.innerHTML = lines.map(l => `<div class="tg-diag-line ${l.startsWith('✓') ? 'pass' : 'fail'}">${escapeHtml(l)}</div>`).join('');
    }
  }

  function loadSettings() {
    const s = Store.getSettings();
    $('#setSound').checked = !!s.sound;
    $('#setPush').checked = !!s.push;
    $('#setAuto').checked = !!s.auto;
    $('#setFilter').checked = !!s.filterWeak;
    $('#setTg').checked = !!s.tg;
    $('#setTgAuto').checked = !!s.tgAuto;
    $('#tgToken').value = s.tgToken || '';
    $('#tgChat').value = s.tgChat || '';

    if ($('#tgMinStrength')) {
      $('#tgMinStrength').value = s.tgMinStrength;
      if ($('#tgMinStrengthOut')) $('#tgMinStrengthOut').textContent = s.tgMinStrength + '%';
    }
    if ($('#tgInterval')) $('#tgInterval').value = s.tgIntervalSec;
    if ($('#tgScanGroup')) $('#tgScanGroup').value = s.tgScanGroup;
    if ($('#tgTimeframe')) $('#tgTimeframe').value = s.tgTimeframe;

    updateTgStatusUI();
  }

  /* =================================================================
     AUTO-TELEGRAM SCANNER
     - Runs on a configurable interval in the background
     - Scans the user's chosen pair group for high-strength signals
     - Dedupes via OTCStore.markTgSent so the same setup isn't forwarded
       multiple times within the candle's lifetime
     - Tracks daily / total counters and exposes status to the UI
  ================================================================= */
  function startTelegramScanner() {
    stopTelegramScanner();
    const s = Store.getSettings();
    if (!s.tg || !s.tgAuto || !s.tgToken || !s.tgChat) {
      updateTgStatusUI();
      return;
    }
    const intervalMs = Math.max(20, +s.tgIntervalSec || 60) * 1000;
    state.tgTimer = setInterval(runTelegramScan, intervalMs);
    // Kick off an immediate scan so the user sees activity right away
    runTelegramScan();
    updateTgStatusUI();
  }

  function stopTelegramScanner() {
    if (state.tgTimer) {
      clearInterval(state.tgTimer);
      state.tgTimer = null;
    }
  }

  function pairsForScanGroup(g) {
    if (g === 'watchlist') return Store.getWatchlist();
    return Api.PAIRS_FILTER[g] || Api.PAIRS_FILTER.all;
  }

  async function runTelegramScan(forced, diagnostic) {
    const s = Store.getSettings();
    if (!s.tg || !s.tgToken || !s.tgChat) {
      // Surface a clear hint so users know why nothing fires.
      if (forced) {
        Notify.toast({
          type: 'sell',
          title: 'Cannot scan yet',
          desc: !s.tgToken ? 'Bot token is missing'
              : !s.tgChat ? 'Chat ID is missing'
              : 'Enable Telegram forwarding first'
        });
      }
      return;
    }
    if (!forced && !s.tgAuto) return;
    if (state.tgRunning) return;     // skip if previous scan still running

    state.tgRunning = true;
    // Reset diagnostic counters for this scan
    const diag = state.tgDiag = {
      pairs: 0, found: 0, skippedWeak: 0, deduped: 0, sent: 0, failed: 0, hint: ''
    };
    updateTgStatusUI();

    try {
      const pairs = pairsForScanGroup(s.tgScanGroup);
      if (!pairs.length) {
        diag.hint = 'No pairs in selected group';
        return;
      }

      const tf = s.tgTimeframe || '1m';
      const minStrength = Math.max(50, +s.tgMinStrength || 75);
      const broker = $('#broker') ? $('#broker').selectedOptions[0].textContent.trim() : 'Auto-Scan';
      let stoppedDueToAuth = false;

      // Throttled parallel: chunks of 5
      for (let i = 0; i < pairs.length; i += 5) {
        if (stoppedDueToAuth) break;
        const chunk = pairs.slice(i, i + 5);
        const results = await Promise.all(chunk.map(p =>
          Strategy.analyze(p, tf).catch(() => null)
        ));

        for (const sig of results) {
          if (!sig) continue;
          diag.pairs++;
          if (sig.direction === 'NEUTRAL') continue;
          diag.found++;

          if (sig.strength < minStrength) {
            diag.skippedWeak++;
            continue;
          }

          const key = `${sig.symbol}|${sig.timeframe}|${sig.direction}|${sig.candleTime}`;
          if (Store.isTgSent(key)) {
            diag.deduped++;
            continue;
          }

          // Reserve immediately so concurrent scans don't double-send
          Store.markTgSent(key);

          const msg = Notify.formatTelegram({ ...sig, broker });
          const r = await Notify.sendTelegram(msg, { force: true });
          if (r.ok) {
            diag.sent++;
            Store.bumpTgSentCount();
            if (s.push && !diagnostic) {
              Notify.toast({
                type: sig.direction === 'BUY' ? 'buy' : 'sell',
                title: `Telegram → ${sig.direction} ${sig.pairLabel}`,
                desc: `Strength ${sig.strength}% · Win ${sig.winProb}%`
              });
            }
          } else {
            diag.failed++;
            // Stop the scanner if the API rejected our credentials.
            if (r.error && /Unauthorized|Bot token|Chat ID|Chat not found|Bot not found/i.test(r.error)) {
              stoppedDueToAuth = true;
              stopTelegramScanner();
              Notify.toast({ type: 'sell', title: 'Auto-scanner stopped', desc: r.error });
              break;
            }
          }
        }
      }

      // Build a short human-readable hint summarizing the scan
      if (diag.pairs === 0) diag.hint = 'No pairs analysed (data sources offline?)';
      else if (diag.found === 0) diag.hint = 'No directional signals on this scan — wait or relax the filter';
      else if (diag.sent > 0) diag.hint = `Forwarded ${diag.sent} signal(s) ✓`;
      else if (diag.skippedWeak > 0 && diag.deduped === 0) diag.hint = `All signals below ${minStrength}% — lower the threshold`;
      else if (diag.deduped > 0 && diag.sent === 0) diag.hint = 'All eligible signals already sent in the last hour';
      else if (diag.failed > 0) diag.hint = `${diag.failed} send(s) failed — check Telegram error above`;

      state.tgLastScanAt = Date.now();
    } finally {
      state.tgRunning = false;
      updateTgStatusUI();
    }
  }

  function startTelegramStatusTicker() {
    if (state.tgStatusTimer) clearInterval(state.tgStatusTimer);
    state.tgStatusTimer = setInterval(updateTgStatusUI, 1000);
  }

  function updateTgStatusUI() {
    const lineEl = $('#tgStatusLine');
    const dotEl  = $('#tgStatusDot');
    const countEl = $('#tgSentCount');
    const totalEl = $('#tgSentTotal');
    const errEl  = $('#tgErrorLine');
    if (!lineEl) return;

    const s = Store.getSettings();
    const today = Store.todayKey();
    const sentToday = s.tgSentDate === today ? (s.tgSentToday || 0) : 0;

    if (countEl) countEl.textContent = sentToday;
    if (totalEl) totalEl.textContent = s.tgSentTotal || 0;

    let label, on = false;
    if (!s.tg) {
      label = 'Telegram forwarding is OFF';
    } else if (!s.tgToken || !s.tgChat) {
      label = 'Telegram: bot token / chat ID required';
    } else if (!s.tgAuto) {
      label = 'Auto-scanner OFF (manual signals will still forward)';
    } else if (state.tgRunning) {
      label = 'Auto-scanner: scanning…';
      on = true;
    } else if (state.tgLastScanAt) {
      const sec = Math.round((Date.now() - state.tgLastScanAt) / 1000);
      const next = Math.max(0, Math.round((+s.tgIntervalSec || 60) - sec));
      label = `Auto-scanner ON • last scan ${sec}s ago • next in ${next}s`;
      on = true;
    } else {
      label = 'Auto-scanner ON • starting…';
      on = true;
    }
    lineEl.textContent = label;
    if (dotEl) dotEl.className = 'tg-dot ' + (on ? 'on' : 'off');

    if (errEl) {
      if (s.tgLastError) {
        errEl.textContent = '⚠ ' + s.tgLastError;
        errEl.style.display = 'block';
      } else {
        errEl.style.display = 'none';
      }
    }

    // ----- Diagnostic counters from the most recent scan -----
    const d = state.tgDiag;
    const box = $('#tgDiagBox');
    if (d && (d.pairs > 0 || d.hint)) {
      if (box) box.style.display = 'block';
      const map = {
        '#tgDiagPairs':   d.pairs,
        '#tgDiagFound':   d.found,
        '#tgDiagSkipped': d.skippedWeak,
        '#tgDiagDeduped': d.deduped,
        '#tgDiagSent':    d.sent,
        '#tgDiagFailed':  d.failed
      };
      Object.keys(map).forEach(sel => { const el = $(sel); if (el) el.textContent = map[sel]; });
      const hintEl = $('#tgDiagHint');
      if (hintEl && d.hint) hintEl.textContent = d.hint;
    }
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
