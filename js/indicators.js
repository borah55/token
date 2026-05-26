/* ============================================
   indicators.js — pure technical indicators
   exposes window.OTCIndicators
============================================ */

(function () {
  'use strict';

  /**
   * Simple moving average over the last `period` closes.
   */
  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    if (values.length < period) return out;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    out[period - 1] = sum / period;
    for (let i = period; i < values.length; i++) {
      sum += values[i] - values[i - period];
      out[i] = sum / period;
    }
    return out;
  }

  /**
   * Exponential moving average. Returns array aligned with `values`.
   */
  function ema(values, period) {
    const out = new Array(values.length).fill(null);
    if (values.length < period) return out;
    const k = 2 / (period + 1);
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    let prev = sum / period;
    out[period - 1] = prev;
    for (let i = period; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  /**
   * Relative Strength Index (Wilder's smoothing).
   */
  function rsi(values, period) {
    period = period || 14;
    const out = new Array(values.length).fill(null);
    if (values.length <= period) return out;

    let gainSum = 0, lossSum = 0;
    for (let i = 1; i <= period; i++) {
      const ch = values[i] - values[i - 1];
      if (ch >= 0) gainSum += ch; else lossSum -= ch;
    }
    let avgGain = gainSum / period;
    let avgLoss = lossSum / period;
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + (avgGain / avgLoss));

    for (let i = period + 1; i < values.length; i++) {
      const ch = values[i] - values[i - 1];
      const gain = ch > 0 ? ch : 0;
      const loss = ch < 0 ? -ch : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + (avgGain / avgLoss));
    }
    return out;
  }

  /**
   * VWAP — volume weighted average price (running).
   * candles: [{high, low, close, volume}]
   */
  function vwap(candles) {
    const out = new Array(candles.length).fill(null);
    let cumPV = 0, cumV = 0;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const tp = (c.high + c.low + c.close) / 3;
      const v = c.volume || 0;
      cumPV += tp * v;
      cumV += v;
      out[i] = cumV > 0 ? cumPV / cumV : tp;
    }
    return out;
  }

  /**
   * ATR (Average True Range).
   */
  function atr(candles, period) {
    period = period || 14;
    const tr = new Array(candles.length).fill(0);
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (i === 0) { tr[i] = c.high - c.low; continue; }
      const p = candles[i - 1];
      tr[i] = Math.max(
        c.high - c.low,
        Math.abs(c.high - p.close),
        Math.abs(c.low - p.close)
      );
    }
    const out = new Array(candles.length).fill(null);
    if (candles.length < period) return out;
    let sum = 0;
    for (let i = 0; i < period; i++) sum += tr[i];
    out[period - 1] = sum / period;
    for (let i = period; i < candles.length; i++) {
      out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
    }
    return out;
  }

  /**
   * Bollinger Bands — used here just for the bandwidth (sideways filter).
   */
  function bollinger(values, period, mult) {
    period = period || 20;
    mult = mult || 2;
    const middle = sma(values, period);
    const upper = new Array(values.length).fill(null);
    const lower = new Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      let mean = middle[i];
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += (values[j] - mean) ** 2;
      const sd = Math.sqrt(s / period);
      upper[i] = mean + mult * sd;
      lower[i] = mean - mult * sd;
    }
    return { upper, middle, lower };
  }

  /**
   * Volume spike: returns ratio of latest volume vs average of last `period`.
   * >= 1.6 is generally a meaningful spike.
   */
  function volumeSpike(candles, period) {
    period = period || 20;
    if (candles.length < period + 1) return 1;
    const last = candles[candles.length - 1].volume || 0;
    let sum = 0;
    for (let i = candles.length - 1 - period; i < candles.length - 1; i++) {
      sum += candles[i].volume || 0;
    }
    const avg = sum / period;
    return avg > 0 ? last / avg : 1;
  }

  /**
   * Returns dominant trend direction from EMA fast vs slow with slope check.
   */
  function trendDirection(closes, fast, slow) {
    fast = fast || 9; slow = slow || 21;
    const ef = ema(closes, fast);
    const es = ema(closes, slow);
    const i = closes.length - 1;
    if (ef[i] == null || es[i] == null) return { dir: 'flat', strength: 0 };

    const diff = (ef[i] - es[i]) / es[i];     // relative gap
    const slopeF = i >= 3 && ef[i - 3] != null ? (ef[i] - ef[i - 3]) / ef[i - 3] : 0;
    const dir = diff > 0 && slopeF > 0 ? 'up'
              : diff < 0 && slopeF < 0 ? 'down' : 'flat';
    const strength = Math.min(1, Math.abs(diff) * 200 + Math.abs(slopeF) * 200);
    return { dir, strength, fast: ef[i], slow: es[i] };
  }

  /**
   * Sideways-market filter: compares the current Bollinger bandwidth and
   * candle-direction agreement against their recent history. A market is
   * considered sideways when bandwidth has compressed AND recent candles
   * keep flipping direction (no follow-through).
   */
  function isSideways(candles) {
    if (candles.length < 40) return true;
    const closes = candles.map(c => c.close);
    const i = candles.length - 1;

    // Bollinger bandwidth, current vs avg of last 30 candles
    const bb = bollinger(closes, 20, 2);
    const bw = (bb.upper[i] - bb.lower[i]) / bb.middle[i];
    let bwSum = 0, bwN = 0;
    for (let j = i - 30; j < i; j++) {
      if (bb.upper[j] != null && bb.middle[j]) {
        bwSum += (bb.upper[j] - bb.lower[j]) / bb.middle[j];
        bwN++;
      }
    }
    const bwAvg = bwN > 0 ? bwSum / bwN : bw;
    const compressed = bw < bwAvg * 0.75;

    // Direction-flip rate over last 10 candles
    let flips = 0;
    for (let j = i - 10; j < i; j++) {
      const a = candles[j].close > candles[j].open;
      const b = candles[j + 1].close > candles[j + 1].open;
      if (a !== b) flips++;
    }
    const choppy = flips >= 7;   // 7+ direction changes in 10 candles

    return compressed && choppy;
  }

  /**
   * Support / resistance: return the two strongest local levels near the
   * current price using simple swing-point clustering.
   */
  function supportResistance(candles, lookback) {
    lookback = lookback || 60;
    const slice = candles.slice(-lookback);
    if (slice.length < 10) return { support: null, resistance: null };

    const swings = [];
    for (let i = 2; i < slice.length - 2; i++) {
      const c = slice[i];
      const l1 = slice[i - 1], l2 = slice[i - 2], r1 = slice[i + 1], r2 = slice[i + 2];
      if (c.high > l1.high && c.high > l2.high && c.high > r1.high && c.high > r2.high) {
        swings.push({ price: c.high, type: 'high' });
      }
      if (c.low < l1.low && c.low < l2.low && c.low < r1.low && c.low < r2.low) {
        swings.push({ price: c.low, type: 'low' });
      }
    }

    const last = slice[slice.length - 1].close;
    const above = swings.filter(s => s.price > last).sort((a, b) => a.price - b.price);
    const below = swings.filter(s => s.price < last).sort((a, b) => b.price - a.price);
    return {
      resistance: above[0] ? above[0].price : null,
      support: below[0] ? below[0].price : null
    };
  }

  window.OTCIndicators = {
    sma, ema, rsi, vwap, atr, bollinger,
    volumeSpike, trendDirection, isSideways, supportResistance
  };
})();
