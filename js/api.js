/* ============================================
   api.js — market data layer
   - Real klines from Binance for crypto OTC
   - Deterministic synthetic candles for forex / synthetic OTC
   exposes window.OTCApi
============================================ */

(function () {
  'use strict';

  const BINANCE_BASES = [
    'https://api.binance.com',
    'https://api1.binance.com',
    'https://api2.binance.com',
    'https://api3.binance.com'
  ];

  // Map short timeframe expiries to actual analysis intervals.
  // Binance smallest candle is 1m, so sub-minute expiries use 1m candles.
  const TF_TO_INTERVAL = {
    '5s':  { interval: '1m', candleSec: 60 },
    '15s': { interval: '1m', candleSec: 60 },
    '30s': { interval: '1m', candleSec: 60 },
    '1m':  { interval: '1m', candleSec: 60 },
    '5m':  { interval: '5m', candleSec: 300 }
  };

  const TF_TO_EXPIRY_SEC = {
    '5s': 5, '15s': 15, '30s': 30, '1m': 60, '5m': 300
  };

  // Approx base prices for synthetic generation (kept in module scope).
  const SYNTH_BASE = {
    'FX:EURUSD': 1.0820, 'FX:GBPUSD': 1.2650, 'FX:USDJPY': 156.40,
    'FX:AUDUSD': 0.6580, 'FX:USDCAD': 1.3650, 'FX:USDCHF': 0.8980,
    'FX:NZDUSD': 0.6020, 'FX:EURJPY': 169.20, 'FX:GBPJPY': 197.80,
    'SY:VOL75': 215000, 'SY:VOL100': 410000,
    'SY:BOOM1000': 8842, 'SY:CRASH1000': 4720,
    'SY:STEP': 19250
  };

  const SYNTH_VOL = {
    'FX:EURUSD': 0.00018, 'FX:GBPUSD': 0.00022, 'FX:USDJPY': 0.018,
    'FX:AUDUSD': 0.00020, 'FX:USDCAD': 0.00018, 'FX:USDCHF': 0.00020,
    'FX:NZDUSD': 0.00020, 'FX:EURJPY': 0.020, 'FX:GBPJPY': 0.024,
    'SY:VOL75': 130, 'SY:VOL100': 280,
    'SY:BOOM1000': 4, 'SY:CRASH1000': 4, 'SY:STEP': 6
  };

  /* ---------- Binance ---------- */
  async function fetchBinanceKlines(symbol, interval, limit) {
    limit = limit || 120;
    const path = `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
    let lastErr;
    for (const base of BINANCE_BASES) {
      try {
        const res = await fetch(base + path, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const raw = await res.json();
        return raw.map(k => ({
          time: Math.floor(k[0] / 1000),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5])
        }));
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('All Binance endpoints failed');
  }

  async function fetchBinanceTicker(symbol) {
    const path = `/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
    for (const base of BINANCE_BASES) {
      try {
        const res = await fetch(base + path, { cache: 'no-store' });
        if (!res.ok) continue;
        const data = await res.json();
        return {
          price: parseFloat(data.lastPrice),
          changePct: parseFloat(data.priceChangePercent)
        };
      } catch (e) { /* try next */ }
    }
    return null;
  }

  /* ---------- Synthetic candles (deterministic-ish) ----------
     Produces realistic OHLC time-series with trend regimes, momentum
     and noise — purely for forex / synthetic OTC pairs which we cannot
     fetch from a free public API without auth.
  */
  function syntheticCandles(symbol, interval, limit) {
    limit = limit || 120;
    const candleSec = (TF_TO_INTERVAL[interval] && TF_TO_INTERVAL[interval].candleSec) ||
                      (interval === '5m' ? 300 : 60);

    const base = SYNTH_BASE[symbol] || 1.0;
    const vol = SYNTH_VOL[symbol] || base * 0.0005;

    // Seed RNG by symbol so the chart is consistent within a session
    // but evolves over real wall-clock time.
    const seedStr = symbol + Math.floor(Date.now() / (candleSec * 1000));
    let seed = 0;
    for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
    function rand() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 4294967295);
    }

    const now = Math.floor(Date.now() / 1000);
    const startTime = now - (limit - 1) * candleSec;

    let price = base;
    // Initial trend regime
    let trend = (rand() - 0.5) * 0.0014;
    let momentum = 0;
    let trendDuration = 0;
    let regimeLength = 8 + Math.floor(rand() * 18);

    const out = [];
    for (let i = 0; i < limit; i++) {
      // Switch regime periodically — creates persistent trends, breakouts, reversals
      trendDuration++;
      if (trendDuration >= regimeLength) {
        trend = (rand() - 0.5) * 0.0022;
        regimeLength = 8 + Math.floor(rand() * 18);
        trendDuration = 0;
      }
      // Momentum drag
      momentum = momentum * 0.65 + (rand() - 0.5) * vol * 1.4;

      const open = price;
      const drift = trend * base + momentum;
      const noise = (rand() - 0.5) * vol * 2.4;
      const close = open + drift + noise;

      // Wicks: occasionally produce long wicks (liquidity sweeps / pinbars)
      const wickStretch = rand() < 0.12 ? 3.5 : 1;
      const wickUp = Math.abs((rand() - 0.3) * vol * 2 * wickStretch);
      const wickDown = Math.abs((rand() - 0.3) * vol * 2 * wickStretch);
      const high = Math.max(open, close) + wickUp;
      const low = Math.min(open, close) - wickDown;

      // Synthetic volume — proportional to candle range so spikes appear
      // on volatile candles.
      const volRange = (high - low) / Math.max(0.0000001, vol);
      const v = 800 + volRange * (200 + rand() * 800);

      out.push({
        time: startTime + i * candleSec,
        open, high, low, close,
        volume: v
      });
      price = close;
    }
    return out;
  }

  /* ---------- Public API ---------- */

  function isCryptoSymbol(symbol) {
    return !symbol.includes(':');
  }

  async function getCandles(symbol, timeframe, limit) {
    const tfDef = TF_TO_INTERVAL[timeframe] || TF_TO_INTERVAL['1m'];
    const interval = tfDef.interval;

    if (isCryptoSymbol(symbol)) {
      try {
        const candles = await fetchBinanceKlines(symbol, interval, limit || 120);
        return { candles, source: 'binance', interval };
      } catch (e) {
        // Fall back to synthetic if Binance is unreachable so the app
        // remains usable offline / on restricted networks.
        return { candles: syntheticCandles(symbol, interval, limit || 120), source: 'synthetic-fallback', interval, error: e.message };
      }
    }
    return { candles: syntheticCandles(symbol, interval, limit || 120), source: 'synthetic', interval };
  }

  async function getTicker(symbol) {
    if (isCryptoSymbol(symbol)) {
      const t = await fetchBinanceTicker(symbol);
      if (t) return t;
    }
    // Synthetic: derive from latest candle
    const { candles } = await getCandles(symbol, '1m', 30);
    const last = candles[candles.length - 1];
    const first = candles[0];
    return {
      price: last.close,
      changePct: ((last.close - first.open) / first.open) * 100
    };
  }

  function expirySecondsFor(timeframe) {
    return TF_TO_EXPIRY_SEC[timeframe] || 60;
  }

  /**
   * For UI countdown: seconds remaining in the current candle of the
   * analysis interval.
   */
  function candleSecondsRemaining(timeframe) {
    const tfDef = TF_TO_INTERVAL[timeframe] || TF_TO_INTERVAL['1m'];
    const period = tfDef.candleSec;
    const now = Math.floor(Date.now() / 1000);
    return period - (now % period);
  }

  function formatSymbol(symbol) {
    if (symbol.startsWith('FX:')) {
      const s = symbol.slice(3);
      return `${s.slice(0, 3)}/${s.slice(3)} (OTC)`;
    }
    if (symbol.startsWith('SY:')) {
      const s = symbol.slice(3);
      const map = {
        'VOL75': 'Volatility 75',
        'VOL100': 'Volatility 100',
        'BOOM1000': 'Boom 1000',
        'CRASH1000': 'Crash 1000',
        'STEP': 'Step Index'
      };
      return map[s] || s;
    }
    if (symbol.endsWith('USDT')) {
      return symbol.replace('USDT', '') + '/USD (OTC)';
    }
    return symbol;
  }

  function priceDecimals(symbol) {
    if (symbol.startsWith('FX:USDJPY') || symbol.startsWith('FX:EURJPY') || symbol.startsWith('FX:GBPJPY')) return 3;
    if (symbol.startsWith('FX:')) return 5;
    if (symbol.startsWith('SY:')) return 2;
    // Crypto — heuristic
    const ticker = symbol.replace('USDT', '');
    if (['BTC', 'ETH', 'BNB', 'SOL', 'AVAX', 'LTC', 'BCH'].includes(ticker)) return 2;
    if (['DOGE', 'TRX', 'XRP', 'ADA', 'MATIC'].includes(ticker)) return 5;
    return 4;
  }

  function fmtPrice(symbol, value) {
    if (value == null || isNaN(value)) return '—';
    const d = priceDecimals(symbol);
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: d, maximumFractionDigits: d
    });
  }

  // Pair groups for the live scanner
  const ALL_PAIRS = {
    crypto: [
      'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
      'DOGEUSDT', 'ADAUSDT', 'LTCUSDT', 'AVAXUSDT', 'LINKUSDT',
      'TRXUSDT', 'MATICUSDT'
    ],
    forex: [
      'FX:EURUSD', 'FX:GBPUSD', 'FX:USDJPY', 'FX:AUDUSD',
      'FX:USDCAD', 'FX:USDCHF', 'FX:NZDUSD', 'FX:EURJPY', 'FX:GBPJPY'
    ],
    synthetic: [
      'SY:VOL75', 'SY:VOL100', 'SY:BOOM1000', 'SY:CRASH1000', 'SY:STEP'
    ]
  };

  window.OTCApi = {
    getCandles, getTicker,
    expirySecondsFor, candleSecondsRemaining,
    formatSymbol, fmtPrice, priceDecimals,
    ALL_PAIRS,
    isCrypto: isCryptoSymbol
  };
})();
