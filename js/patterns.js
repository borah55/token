/* ============================================
   patterns.js — candlestick patterns, SMC primitives,
   breakout / liquidity sweep / fake breakout detection
   exposes window.OTCPatterns
============================================ */

(function () {
  'use strict';

  function body(c) { return Math.abs(c.close - c.open); }
  function range(c) { return Math.max(0.0000001, c.high - c.low); }
  function isBull(c) { return c.close > c.open; }
  function isBear(c) { return c.close < c.open; }
  function upperWick(c) { return c.high - Math.max(c.open, c.close); }
  function lowerWick(c) { return Math.min(c.open, c.close) - c.low; }

  /* ============= Single / pair candlestick patterns ============= */

  function detectCandlePatterns(candles) {
    const n = candles.length;
    if (n < 3) return [];
    const c = candles[n - 1];
    const p = candles[n - 2];

    const found = [];
    const r = range(c), b = body(c);

    // Doji — body < 10% of range. Indecision.
    if (b / r < 0.1) found.push({ name: 'Doji', bias: 'neutral', weight: 0.4 });

    // Hammer — long lower wick, small body near top, bullish reversal
    if (lowerWick(c) > 2 * b && upperWick(c) < b * 0.7 && b / r > 0.05 && b / r < 0.4) {
      found.push({ name: 'Hammer', bias: 'bull', weight: 1.0 });
    }

    // Shooting star — long upper wick near top of move, bearish reversal
    if (upperWick(c) > 2 * b && lowerWick(c) < b * 0.7 && b / r > 0.05 && b / r < 0.4) {
      found.push({ name: 'Shooting Star', bias: 'bear', weight: 1.0 });
    }

    // Bullish engulfing
    if (isBear(p) && isBull(c) && c.close > p.open && c.open < p.close && body(c) > body(p) * 1.05) {
      found.push({ name: 'Bull Engulfing', bias: 'bull', weight: 1.2 });
    }

    // Bearish engulfing
    if (isBull(p) && isBear(c) && c.close < p.open && c.open > p.close && body(c) > body(p) * 1.05) {
      found.push({ name: 'Bear Engulfing', bias: 'bear', weight: 1.2 });
    }

    // Marubozu — strong directional close, no significant wicks
    if (b / r > 0.85 && isBull(c)) found.push({ name: 'Bull Marubozu', bias: 'bull', weight: 0.9 });
    if (b / r > 0.85 && isBear(c)) found.push({ name: 'Bear Marubozu', bias: 'bear', weight: 0.9 });

    // Pinbar — wick on one side >= 60% of range
    if (lowerWick(c) / r > 0.6 && b / r < 0.35) {
      found.push({ name: 'Bullish Pinbar', bias: 'bull', weight: 0.9 });
    }
    if (upperWick(c) / r > 0.6 && b / r < 0.35) {
      found.push({ name: 'Bearish Pinbar', bias: 'bear', weight: 0.9 });
    }

    // Inside bar — consolidation, neutral
    if (c.high < p.high && c.low > p.low) {
      found.push({ name: 'Inside Bar', bias: 'neutral', weight: 0.3 });
    }

    return found;
  }

  /* ============= Breakout / fake breakout / liquidity sweep ============= */

  /**
   * Detect breakout above resistance or below support on the latest closed
   * candle. Returns { type, level } or null.
   */
  function detectBreakout(candles, sr) {
    if (!sr || (sr.support == null && sr.resistance == null)) return null;
    const n = candles.length;
    if (n < 5) return null;
    const c = candles[n - 1];
    const p = candles[n - 2];

    if (sr.resistance != null && p.close <= sr.resistance && c.close > sr.resistance) {
      return { type: 'breakout-up', level: sr.resistance };
    }
    if (sr.support != null && p.close >= sr.support && c.close < sr.support) {
      return { type: 'breakout-down', level: sr.support };
    }
    return null;
  }

  /**
   * Fake breakout — wick pierces the level but body closes back.
   * Strong reversal signal.
   */
  function detectFakeBreakout(candles, sr) {
    if (!sr) return null;
    const n = candles.length;
    if (n < 3) return null;
    const c = candles[n - 1];

    if (sr.resistance != null && c.high > sr.resistance && c.close < sr.resistance) {
      // pierced resistance and closed back below → bearish trap
      const piercePct = (c.high - sr.resistance) / sr.resistance;
      if (piercePct > 0.0003) return { type: 'fake-up', level: sr.resistance };
    }
    if (sr.support != null && c.low < sr.support && c.close > sr.support) {
      const piercePct = (sr.support - c.low) / sr.support;
      if (piercePct > 0.0003) return { type: 'fake-down', level: sr.support };
    }
    return null;
  }

  /**
   * Liquidity sweep (SMC): a candle takes out the recent swing high/low
   * and reverses. We look at the highest high / lowest low of the last
   * `lookback` candles (excluding the latest).
   */
  function detectLiquiditySweep(candles, lookback) {
    lookback = lookback || 12;
    const n = candles.length;
    if (n < lookback + 2) return null;
    const c = candles[n - 1];
    let hh = -Infinity, ll = Infinity;
    for (let i = n - 1 - lookback; i < n - 1; i++) {
      if (candles[i].high > hh) hh = candles[i].high;
      if (candles[i].low < ll) ll = candles[i].low;
    }
    // Sweep high then close back below → bearish
    if (c.high > hh && c.close < hh && (c.close < c.open || (c.high - c.close) / range(c) > 0.5)) {
      return { type: 'sweep-high', level: hh };
    }
    // Sweep low then close back above → bullish
    if (c.low < ll && c.close > ll && (c.close > c.open || (c.close - c.low) / range(c) > 0.5)) {
      return { type: 'sweep-low', level: ll };
    }
    return null;
  }

  /**
   * Trend continuation pattern — recent pullback into EMA followed by
   * strong continuation candle in the trend direction.
   */
  function detectTrendContinuation(candles, trend) {
    if (!trend || trend.dir === 'flat') return null;
    const n = candles.length;
    if (n < 5) return null;
    const c = candles[n - 1];
    const p = candles[n - 2];

    if (trend.dir === 'up' && isBull(c) && c.low <= trend.fast && c.close > Math.max(p.high, p.open)) {
      return { type: 'continuation-up' };
    }
    if (trend.dir === 'down' && isBear(c) && c.high >= trend.fast && c.close < Math.min(p.low, p.open)) {
      return { type: 'continuation-down' };
    }
    return null;
  }

  /**
   * Reversal confirmation — pattern + price reaction off support/resistance.
   */
  function detectReversal(candles, sr, patterns) {
    if (!sr || !patterns || !patterns.length) return null;
    const n = candles.length;
    const c = candles[n - 1];
    const bull = patterns.find(p => p.bias === 'bull');
    const bear = patterns.find(p => p.bias === 'bear');

    if (bull && sr.support != null) {
      const dist = Math.abs(c.low - sr.support) / sr.support;
      if (dist < 0.0015) return { type: 'reversal-up', pattern: bull.name };
    }
    if (bear && sr.resistance != null) {
      const dist = Math.abs(c.high - sr.resistance) / sr.resistance;
      if (dist < 0.0015) return { type: 'reversal-down', pattern: bear.name };
    }
    return null;
  }

  window.OTCPatterns = {
    detectCandlePatterns,
    detectBreakout,
    detectFakeBreakout,
    detectLiquiditySweep,
    detectTrendContinuation,
    detectReversal
  };
})();
