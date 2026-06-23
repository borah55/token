/* ============================================
   patterns.js — candlestick patterns + Smart Money Concepts (SMC)
   exposes window.OTCPatterns

   SMC primitives implemented:
     • Liquidity sweep (high/low)
     • Fake breakout / breakout
     • Order blocks (bullish + bearish)
     • Fair value gaps (FVG / imbalance)
     • Break of structure (BOS) — trend continuation
     • Change of character (CHoCH) — trend reversal
     • Equal highs / equal lows (liquidity pools)
     • Premium / discount zones
     • Trend continuation, reversal at S/R
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

    if (b / r < 0.1) found.push({ name: 'Doji', bias: 'neutral', weight: 0.4 });

    if (lowerWick(c) > 2 * b && upperWick(c) < b * 0.7 && b / r > 0.05 && b / r < 0.4) {
      found.push({ name: 'Hammer', bias: 'bull', weight: 1.0 });
    }
    if (upperWick(c) > 2 * b && lowerWick(c) < b * 0.7 && b / r > 0.05 && b / r < 0.4) {
      found.push({ name: 'Shooting Star', bias: 'bear', weight: 1.0 });
    }
    if (isBear(p) && isBull(c) && c.close > p.open && c.open < p.close && body(c) > body(p) * 1.05) {
      found.push({ name: 'Bull Engulfing', bias: 'bull', weight: 1.2 });
    }
    if (isBull(p) && isBear(c) && c.close < p.open && c.open > p.close && body(c) > body(p) * 1.05) {
      found.push({ name: 'Bear Engulfing', bias: 'bear', weight: 1.2 });
    }
    if (b / r > 0.85 && isBull(c)) found.push({ name: 'Bull Marubozu', bias: 'bull', weight: 0.9 });
    if (b / r > 0.85 && isBear(c)) found.push({ name: 'Bear Marubozu', bias: 'bear', weight: 0.9 });
    if (lowerWick(c) / r > 0.6 && b / r < 0.35) {
      found.push({ name: 'Bullish Pinbar', bias: 'bull', weight: 0.9 });
    }
    if (upperWick(c) / r > 0.6 && b / r < 0.35) {
      found.push({ name: 'Bearish Pinbar', bias: 'bear', weight: 0.9 });
    }
    if (c.high < p.high && c.low > p.low) {
      found.push({ name: 'Inside Bar', bias: 'neutral', weight: 0.3 });
    }
    return found;
  }

  /* ============= Swing point helper ============= */
  // A swing high needs N candles on each side with strictly lower highs.
  // For binary trading we use a small N=2 to react fast.
  function findSwings(candles, n) {
    n = n || 2;
    const swings = [];
    for (let i = n; i < candles.length - n; i++) {
      const c = candles[i];
      let isHigh = true, isLow = true;
      for (let j = 1; j <= n; j++) {
        if (candles[i - j].high >= c.high || candles[i + j].high >= c.high) isHigh = false;
        if (candles[i - j].low <= c.low || candles[i + j].low <= c.low) isLow = false;
      }
      if (isHigh) swings.push({ idx: i, type: 'high', price: c.high, time: c.time });
      if (isLow) swings.push({ idx: i, type: 'low', price: c.low, time: c.time });
    }
    return swings;
  }

  /* ============= Breakout / fake breakout / liquidity sweep ============= */
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

  function detectFakeBreakout(candles, sr) {
    if (!sr) return null;
    const n = candles.length;
    if (n < 3) return null;
    const c = candles[n - 1];

    if (sr.resistance != null && c.high > sr.resistance && c.close < sr.resistance) {
      const piercePct = (c.high - sr.resistance) / sr.resistance;
      if (piercePct > 0.0003) return { type: 'fake-up', level: sr.resistance };
    }
    if (sr.support != null && c.low < sr.support && c.close > sr.support) {
      const piercePct = (sr.support - c.low) / sr.support;
      if (piercePct > 0.0003) return { type: 'fake-down', level: sr.support };
    }
    return null;
  }

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
    if (c.high > hh && c.close < hh && (c.close < c.open || (c.high - c.close) / range(c) > 0.5)) {
      return { type: 'sweep-high', level: hh };
    }
    if (c.low < ll && c.close > ll && (c.close > c.open || (c.close - c.low) / range(c) > 0.5)) {
      return { type: 'sweep-low', level: ll };
    }
    return null;
  }

  /* ============= ORDER BLOCKS (SMC) =============
     A bullish order block is the last bearish candle before a strong
     bullish impulse (3+ candles up where the closing range exceeds
     ~1.8x the avg body of the prior 10 candles). Bearish OB is the
     mirror image. We return the most recent active OB on each side
     that price is currently approaching.
  */
  function detectOrderBlocks(candles, lookback) {
    lookback = lookback || 40;
    const n = candles.length;
    if (n < lookback + 5) return { bullish: null, bearish: null };

    // Average body across the lookback window for impulse threshold
    let bodySum = 0;
    for (let i = n - lookback; i < n; i++) bodySum += body(candles[i]);
    const avgBody = bodySum / lookback;
    const impulseThreshold = avgBody * 1.8;

    const last = candles[n - 1];
    let bullish = null, bearish = null;

    // Walk recent candles backwards looking for impulses
    for (let i = n - 4; i >= n - lookback; i--) {
      // Bullish impulse: candle[i+1..i+3] all bullish + total close - i.open > impulseThreshold
      const c1 = candles[i + 1], c2 = candles[i + 2], c3 = candles[i + 3];
      if (!c1 || !c2 || !c3) continue;

      const impulseUp = isBull(c1) && isBull(c2) && (c3.close - c1.open) > impulseThreshold;
      if (impulseUp && isBear(candles[i]) && !bullish) {
        const ob = candles[i];
        // Active only if price hasn't fully traded back below the OB low
        if (last.close > ob.low * 0.9999) {
          bullish = { idx: i, low: ob.low, high: ob.high, mid: (ob.low + ob.high) / 2 };
        }
      }

      const impulseDown = isBear(c1) && isBear(c2) && (c1.open - c3.close) > impulseThreshold;
      if (impulseDown && isBull(candles[i]) && !bearish) {
        const ob = candles[i];
        if (last.close < ob.high * 1.0001) {
          bearish = { idx: i, low: ob.low, high: ob.high, mid: (ob.low + ob.high) / 2 };
        }
      }

      if (bullish && bearish) break;
    }

    // Determine if price is currently inside / mitigating an OB
    const inBull = bullish && last.low <= bullish.high && last.high >= bullish.low;
    const inBear = bearish && last.low <= bearish.high && last.high >= bearish.low;

    return {
      bullish, bearish,
      mitigating: inBull ? 'bullish' : inBear ? 'bearish' : null
    };
  }

  /* ============= FAIR VALUE GAPS (FVG / Imbalance) =============
     3-candle pattern:
       Bullish FVG: candle[i-1].high < candle[i+1].low → unfilled gap up
       Bearish FVG: candle[i-1].low  > candle[i+1].high → unfilled gap down
     We return the most recent unfilled FVG that price is approaching.
  */
  function detectFVG(candles, lookback) {
    lookback = lookback || 30;
    const n = candles.length;
    if (n < 4) return { bullish: null, bearish: null, entering: null };

    const last = candles[n - 1];
    let bullish = null, bearish = null;

    for (let i = n - 2; i >= Math.max(2, n - lookback); i--) {
      const a = candles[i - 1];
      const b = candles[i];
      const c = candles[i + 1];
      if (!a || !c) continue;

      // Bullish FVG: upper wick of a < lower wick of c
      if (a.high < c.low) {
        const top = c.low, bot = a.high;
        // unfilled if no candle since closed inside the gap
        let filled = false;
        for (let j = i + 2; j < n; j++) {
          if (candles[j].low < top && candles[j].high > bot) {
            const closeInside = candles[j].close >= bot && candles[j].close <= top;
            if (closeInside) { filled = true; break; }
          }
        }
        if (!filled && !bullish) bullish = { top, bot, idx: i };
      }
      // Bearish FVG
      if (a.low > c.high) {
        const top = a.low, bot = c.high;
        let filled = false;
        for (let j = i + 2; j < n; j++) {
          if (candles[j].low < top && candles[j].high > bot) {
            const closeInside = candles[j].close >= bot && candles[j].close <= top;
            if (closeInside) { filled = true; break; }
          }
        }
        if (!filled && !bearish) bearish = { top, bot, idx: i };
      }
      if (bullish && bearish) break;
    }

    let entering = null;
    if (bullish && last.low <= bullish.top && last.high >= bullish.bot) entering = 'bullish';
    if (bearish && last.low <= bearish.top && last.high >= bearish.bot) entering = 'bearish';

    return { bullish, bearish, entering };
  }

  /* ============= BREAK OF STRUCTURE (BOS) =============
     In an uptrend, BOS = the latest closed candle closes above the
     most recent swing high. Confirms trend continuation up. Mirror
     for downtrend.
  */
  function detectBOS(candles, trend) {
    if (!trend || trend.dir === 'flat') return null;
    const n = candles.length;
    if (n < 8) return null;

    const swings = findSwings(candles.slice(0, n - 1), 2); // exclude latest
    if (!swings.length) return null;
    const lastSwingHigh = [...swings].reverse().find(s => s.type === 'high');
    const lastSwingLow = [...swings].reverse().find(s => s.type === 'low');
    const last = candles[n - 1];
    const prev = candles[n - 2];

    if (trend.dir === 'up' && lastSwingHigh && prev.close <= lastSwingHigh.price && last.close > lastSwingHigh.price) {
      return { type: 'bos-up', level: lastSwingHigh.price };
    }
    if (trend.dir === 'down' && lastSwingLow && prev.close >= lastSwingLow.price && last.close < lastSwingLow.price) {
      return { type: 'bos-down', level: lastSwingLow.price };
    }
    return null;
  }

  /* ============= CHANGE OF CHARACTER (CHoCH) =============
     In an uptrend, CHoCH = price closes below the most recent swing
     low (first sign of trend reversal). Mirror for downtrend.
  */
  function detectCHoCH(candles, trend) {
    if (!trend || trend.dir === 'flat') return null;
    const n = candles.length;
    if (n < 8) return null;

    const swings = findSwings(candles.slice(0, n - 1), 2);
    const lastSwingHigh = [...swings].reverse().find(s => s.type === 'high');
    const lastSwingLow = [...swings].reverse().find(s => s.type === 'low');
    const last = candles[n - 1];
    const prev = candles[n - 2];

    if (trend.dir === 'up' && lastSwingLow && prev.close >= lastSwingLow.price && last.close < lastSwingLow.price) {
      return { type: 'choch-down', level: lastSwingLow.price };
    }
    if (trend.dir === 'down' && lastSwingHigh && prev.close <= lastSwingHigh.price && last.close > lastSwingHigh.price) {
      return { type: 'choch-up', level: lastSwingHigh.price };
    }
    return null;
  }

  /* ============= EQUAL HIGHS / EQUAL LOWS (liquidity pools) =============
     2+ swing highs (or lows) within ~0.08% of each other indicate a
     liquidity pool that's likely to be swept. We return whichever side
     has equal levels above/below current price.
  */
  function detectEqualLevels(candles, lookback) {
    lookback = lookback || 50;
    const slice = candles.slice(-lookback);
    if (slice.length < 10) return { eqHigh: null, eqLow: null };

    const swings = findSwings(slice, 2);
    const highs = swings.filter(s => s.type === 'high').map(s => s.price);
    const lows = swings.filter(s => s.type === 'low').map(s => s.price);

    function findEqual(arr) {
      if (arr.length < 2) return null;
      // Cluster within tolerance
      for (let i = arr.length - 1; i >= 1; i--) {
        for (let j = i - 1; j >= 0; j--) {
          const a = arr[i], b = arr[j];
          const tol = (a + b) / 2 * 0.0008; // 0.08%
          if (Math.abs(a - b) < tol) {
            return { price: (a + b) / 2, count: 2 };
          }
        }
      }
      return null;
    }

    return {
      eqHigh: findEqual(highs),
      eqLow: findEqual(lows)
    };
  }

  /* ============= PREMIUM / DISCOUNT zones =============
     Take recent dealing range. Upper 50% is "premium" (look for sells),
     lower 50% is "discount" (look for buys). Equilibrium = 50%.
  */
  function detectPremiumDiscount(candles, lookback) {
    lookback = lookback || 50;
    const slice = candles.slice(-lookback);
    if (slice.length < 10) return null;
    let hi = -Infinity, lo = Infinity;
    for (const c of slice) { if (c.high > hi) hi = c.high; if (c.low < lo) lo = c.low; }
    if (hi <= lo) return null;
    const last = candles[candles.length - 1].close;
    const pos = (last - lo) / (hi - lo);  // 0..1
    let zone;
    if (pos > 0.62) zone = 'premium';
    else if (pos < 0.38) zone = 'discount';
    else zone = 'equilibrium';
    return { zone, pos: +pos.toFixed(3), high: hi, low: lo };
  }

  /* ============= Trend continuation & Reversal at S/R ============= */
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
    detectOrderBlocks,
    detectFVG,
    detectBOS,
    detectCHoCH,
    detectEqualLevels,
    detectPremiumDiscount,
    detectTrendContinuation,
    detectReversal,
    findSwings
  };
})();
