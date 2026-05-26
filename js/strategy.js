/* ============================================
   strategy.js — combines indicators, patterns, SMC
   into a single weighted BUY/SELL/NEUTRAL signal.
   exposes window.OTCStrategy.analyze(symbol, timeframe)
============================================ */

(function () {
  'use strict';

  const I = window.OTCIndicators;
  const P = window.OTCPatterns;
  const Api = window.OTCApi;

  /* Confluence scoring:
     - Each fired confluence contributes a signed weight to a directional score.
     - Final strength = clamp(|score| / maxScore * 100, 0, 100).
     - Win probability = 50 + 0.42 * strength (capped 60..95).
     - We only emit BUY / SELL when:
        a) sideways filter passes (market not too choppy)
        b) directional score >= MIN_SCORE
        c) RSI doesn't strongly contradict the direction
  */

  const MIN_SCORE_BASE = 2.0;     // minimum absolute score to emit a signal
  const MAX_SCORE = 6.0;          // theoretical upper bound for normalisation

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  async function analyze(symbol, timeframe, opts) {
    const { candles, source, interval } = await Api.getCandles(symbol, timeframe, 150);
    if (!candles || candles.length < 40) {
      return makeNeutral(symbol, timeframe, candles, ['Not enough data']);
    }

    const closes = candles.map(c => c.close);
    const last = candles[candles.length - 1];

    /* ---- core indicators ---- */
    const rsiArr = I.rsi(closes, 14);
    const ema9 = I.ema(closes, 9);
    const ema21 = I.ema(closes, 21);
    const ema50 = I.ema(closes, 50);
    const vwapArr = I.vwap(candles);
    const trend = I.trendDirection(closes, 9, 21);
    const sr = I.supportResistance(candles, 60);
    const sideways = I.isSideways(candles);
    const volSpike = I.volumeSpike(candles, 20);

    const rsiVal = rsiArr[rsiArr.length - 1];
    const vwapVal = vwapArr[vwapArr.length - 1];
    const ema50Val = ema50[ema50.length - 1];

    const cps = P.detectCandlePatterns(candles);
    const breakout = P.detectBreakout(candles, sr);
    const fakeBO = P.detectFakeBreakout(candles, sr);
    const sweep = P.detectLiquiditySweep(candles, 12);
    const continuation = P.detectTrendContinuation(candles, trend);
    const reversal = P.detectReversal(candles, sr, cps);

    /* ---- sideways filter ---- */
    if (sideways) {
      return makeNeutral(symbol, timeframe, candles, ['Sideways market — filter active'], {
        rsi: rsiVal, trend: trend.dir, source
      });
    }

    /* ---- accumulate confluences ---- */
    let score = 0;
    const conf = [];

    // 1) EMA trend filter
    if (trend.dir === 'up') {
      score += 1.0 + trend.strength * 0.5;
      conf.push({ text: 'EMA9 > EMA21 (uptrend)', dir: +1 });
    } else if (trend.dir === 'down') {
      score -= 1.0 + trend.strength * 0.5;
      conf.push({ text: 'EMA9 < EMA21 (downtrend)', dir: -1 });
    }

    // 2) Long-term EMA50 alignment
    if (ema50Val != null) {
      if (last.close > ema50Val && trend.dir === 'up') {
        score += 0.4; conf.push({ text: 'Price above EMA50', dir: +1 });
      } else if (last.close < ema50Val && trend.dir === 'down') {
        score -= 0.4; conf.push({ text: 'Price below EMA50', dir: -1 });
      }
    }

    // 3) VWAP confirmation
    if (vwapVal != null) {
      if (last.close > vwapVal) {
        score += 0.5; conf.push({ text: 'Price above VWAP', dir: +1 });
      } else {
        score -= 0.5; conf.push({ text: 'Price below VWAP', dir: -1 });
      }
    }

    // 4) RSI confirmation / contradiction
    if (rsiVal != null) {
      if (rsiVal < 30) {
        score += 0.8; conf.push({ text: `RSI ${rsiVal.toFixed(1)} oversold`, dir: +1 });
      } else if (rsiVal > 70) {
        score -= 0.8; conf.push({ text: `RSI ${rsiVal.toFixed(1)} overbought`, dir: -1 });
      } else if (rsiVal > 55 && trend.dir === 'up') {
        score += 0.3; conf.push({ text: `RSI ${rsiVal.toFixed(1)} bullish`, dir: +1 });
      } else if (rsiVal < 45 && trend.dir === 'down') {
        score -= 0.3; conf.push({ text: `RSI ${rsiVal.toFixed(1)} bearish`, dir: -1 });
      }
    }

    // 5) Candlestick patterns
    cps.forEach(c => {
      if (c.bias === 'bull') { score += c.weight * 0.7; conf.push({ text: c.name, dir: +1 }); }
      else if (c.bias === 'bear') { score -= c.weight * 0.7; conf.push({ text: c.name, dir: -1 }); }
    });

    // 6) Breakout
    if (breakout) {
      if (breakout.type === 'breakout-up')  { score += 1.0; conf.push({ text: 'Breakout above resistance', dir: +1 }); }
      if (breakout.type === 'breakout-down'){ score -= 1.0; conf.push({ text: 'Breakout below support', dir: -1 }); }
    }

    // 7) Fake breakout (reversal trap)
    if (fakeBO) {
      if (fakeBO.type === 'fake-up')   { score -= 1.2; conf.push({ text: 'Fake breakout (bull trap)', dir: -1 }); }
      if (fakeBO.type === 'fake-down') { score += 1.2; conf.push({ text: 'Fake breakdown (bear trap)', dir: +1 }); }
    }

    // 8) SMC liquidity sweep
    if (sweep) {
      if (sweep.type === 'sweep-high') { score -= 1.4; conf.push({ text: 'Liquidity sweep — sell-side', dir: -1 }); }
      if (sweep.type === 'sweep-low')  { score += 1.4; conf.push({ text: 'Liquidity sweep — buy-side', dir: +1 }); }
    }

    // 9) Trend continuation
    if (continuation) {
      if (continuation.type === 'continuation-up')  { score += 0.8; conf.push({ text: 'Trend continuation up', dir: +1 }); }
      if (continuation.type === 'continuation-down'){ score -= 0.8; conf.push({ text: 'Trend continuation down', dir: -1 }); }
    }

    // 10) Reversal at S/R
    if (reversal) {
      if (reversal.type === 'reversal-up')   { score += 0.9; conf.push({ text: `Reversal at support (${reversal.pattern})`, dir: +1 }); }
      if (reversal.type === 'reversal-down') { score -= 0.9; conf.push({ text: `Reversal at resistance (${reversal.pattern})`, dir: -1 }); }
    }

    // 11) Volume spike confirms direction of latest candle
    if (volSpike >= 1.6) {
      if (last.close > last.open) { score += 0.5; conf.push({ text: `Volume spike ×${volSpike.toFixed(1)} (bull)`, dir: +1 }); }
      else if (last.close < last.open) { score -= 0.5; conf.push({ text: `Volume spike ×${volSpike.toFixed(1)} (bear)`, dir: -1 }); }
    }

    /* ---- decide ---- */
    const absScore = Math.abs(score);
    const minScore = MIN_SCORE_BASE;
    let direction = 'NEUTRAL';

    if (absScore >= minScore) {
      direction = score > 0 ? 'BUY' : 'SELL';
    }

    // RSI veto: don't BUY when extremely overbought, don't SELL when extremely oversold
    if (direction === 'BUY' && rsiVal > 78) {
      direction = 'NEUTRAL';
      conf.push({ text: 'Veto: RSI extreme overbought', dir: 0 });
    }
    if (direction === 'SELL' && rsiVal < 22) {
      direction = 'NEUTRAL';
      conf.push({ text: 'Veto: RSI extreme oversold', dir: 0 });
    }

    const strength = Math.round(clamp(absScore / MAX_SCORE * 100, 0, 100));
    const winProb = direction === 'NEUTRAL'
      ? Math.round(40 + strength * 0.2)                    // low confidence
      : Math.round(clamp(50 + strength * 0.42, 60, 95));   // calibrated

    const trendLabel = trend.dir === 'up' ? 'Bullish'
      : trend.dir === 'down' ? 'Bearish' : 'Sideways';

    return {
      id: 'sig_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
      symbol,
      pairLabel: Api.formatSymbol(symbol),
      timeframe,
      interval,
      direction,
      strength,
      winProb,
      trend: trendLabel,
      rsi: rsiVal != null ? +rsiVal.toFixed(1) : null,
      entryPrice: Api.fmtPrice(symbol, last.close),
      entryRaw: last.close,
      candleTime: last.time,
      expirySec: Api.expirySecondsFor(timeframe),
      candleSecRemaining: Api.candleSecondsRemaining(timeframe),
      confluences: conf.map(c => c.text),
      confluenceObjs: conf,
      source,
      sideways: false,
      sr,
      generatedAt: Date.now()
    };
  }

  function makeNeutral(symbol, timeframe, candles, reasons, extra) {
    const last = candles && candles.length ? candles[candles.length - 1] : null;
    return {
      id: 'sig_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
      symbol,
      pairLabel: Api.formatSymbol(symbol),
      timeframe,
      direction: 'NEUTRAL',
      strength: 0,
      winProb: 0,
      trend: extra && extra.trend ? extra.trend : '—',
      rsi: extra && extra.rsi != null ? +extra.rsi.toFixed(1) : null,
      entryPrice: last ? Api.fmtPrice(symbol, last.close) : '—',
      entryRaw: last ? last.close : null,
      candleTime: last ? last.time : null,
      expirySec: Api.expirySecondsFor(timeframe),
      candleSecRemaining: Api.candleSecondsRemaining(timeframe),
      confluences: reasons || [],
      confluenceObjs: (reasons || []).map(t => ({ text: t, dir: 0 })),
      source: extra && extra.source,
      sideways: true,
      generatedAt: Date.now()
    };
  }

  window.OTCStrategy = { analyze };
})();
