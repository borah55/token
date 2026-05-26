/* ============================================
   strategy.js — SMC-first signal engine
   Combines indicators + Smart Money Concepts into a single
   weighted BUY/SELL/NEUTRAL signal.
   exposes window.OTCStrategy.analyze(symbol, timeframe)

   Confluence score is the sum of signed weights:
     • SMC primitives carry the heaviest weights (BOS, CHoCH,
       liquidity sweep, order block mitigation, FVG entry).
     • Indicator confluences (EMA trend, VWAP, RSI, volume) play
       a supporting role.
     • Premium/discount zone acts as a side-of-trade filter.

   strength = clamp(|score| / MAX_SCORE * 100, 0, 100)
   winProb  = clamp(50 + strength * 0.42, 60, 95)
============================================ */

(function () {
  'use strict';

  const I = window.OTCIndicators;
  const P = window.OTCPatterns;
  const Api = window.OTCApi;

  const MIN_SCORE = 2.2;
  const MAX_SCORE = 7.5;

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  async function analyze(symbol, timeframe) {
    const { candles, source, interval } = await Api.getCandles(symbol, timeframe, 150);
    if (!candles || candles.length < 40) {
      return makeNeutral(symbol, timeframe, candles, ['Not enough data'], { source });
    }

    const closes = candles.map(c => c.close);
    const last = candles[candles.length - 1];

    /* ---- core indicators ---- */
    const rsiArr = I.rsi(closes, 14);
    const ema50 = I.ema(closes, 50);
    const vwapArr = I.vwap(candles);
    const trend = I.trendDirection(closes, 9, 21);
    const sr = I.supportResistance(candles, 60);
    const sideways = I.isSideways(candles);
    const volSpike = I.volumeSpike(candles, 20);

    const rsiVal = rsiArr[rsiArr.length - 1];
    const vwapVal = vwapArr[vwapArr.length - 1];
    const ema50Val = ema50[ema50.length - 1];

    /* ---- candlestick + classic SMC ---- */
    const cps = P.detectCandlePatterns(candles);
    const breakout = P.detectBreakout(candles, sr);
    const fakeBO = P.detectFakeBreakout(candles, sr);
    const sweep = P.detectLiquiditySweep(candles, 12);
    const continuation = P.detectTrendContinuation(candles, trend);
    const reversal = P.detectReversal(candles, sr, cps);

    /* ---- advanced SMC ---- */
    const ob = P.detectOrderBlocks(candles, 40);
    const fvg = P.detectFVG(candles, 30);
    const bos = P.detectBOS(candles, trend);
    const choch = P.detectCHoCH(candles, trend);
    const eq = P.detectEqualLevels(candles, 50);
    const pd = P.detectPremiumDiscount(candles, 50);

    /* ---- sideways filter ---- */
    if (sideways) {
      return makeNeutral(symbol, timeframe, candles, ['Sideways market — filter active'], {
        rsi: rsiVal, trend: trend.dir, source
      });
    }

    /* ---- accumulate confluences ---- */
    let score = 0;
    const conf = [];
    function add(text, weight, dir) {
      score += weight;
      conf.push({ text, dir: dir || (weight > 0 ? +1 : weight < 0 ? -1 : 0) });
    }

    /* === SMC primary engine (heavy weights) === */
    if (choch) {
      // CHoCH = trend reversal — strongest reversal signal in SMC
      if (choch.type === 'choch-up')   add('SMC: CHoCH up — trend reversal', +1.6, +1);
      if (choch.type === 'choch-down') add('SMC: CHoCH down — trend reversal', -1.6, -1);
    }
    if (bos) {
      // BOS = trend continuation
      if (bos.type === 'bos-up')   add('SMC: BOS up — continuation', +1.4, +1);
      if (bos.type === 'bos-down') add('SMC: BOS down — continuation', -1.4, -1);
    }
    if (sweep) {
      if (sweep.type === 'sweep-low')  add('SMC: Buy-side liquidity swept', +1.3, +1);
      if (sweep.type === 'sweep-high') add('SMC: Sell-side liquidity swept', -1.3, -1);
    }
    if (ob.mitigating === 'bullish') add('SMC: Mitigating bullish order block', +1.1, +1);
    if (ob.mitigating === 'bearish') add('SMC: Mitigating bearish order block', -1.1, -1);

    if (fvg.entering === 'bullish')  add('SMC: Entering bullish FVG', +0.8, +1);
    if (fvg.entering === 'bearish')  add('SMC: Entering bearish FVG', -0.8, -1);

    // Equal levels recently swept add extra weight to sweep/CHoCH
    if (eq.eqHigh && sweep && sweep.type === 'sweep-high') {
      add('SMC: Equal highs liquidity grabbed', -0.7, -1);
    }
    if (eq.eqLow && sweep && sweep.type === 'sweep-low') {
      add('SMC: Equal lows liquidity grabbed', +0.7, +1);
    }

    // Premium/Discount filter — modest weight, biases the trade direction
    if (pd) {
      if (pd.zone === 'discount') add(`SMC: Price in discount (${(pd.pos*100).toFixed(0)}%)`, +0.4, +1);
      if (pd.zone === 'premium')  add(`SMC: Price in premium (${(pd.pos*100).toFixed(0)}%)`, -0.4, -1);
    }

    if (fakeBO) {
      if (fakeBO.type === 'fake-down') add('SMC: Bear trap (fake breakdown)', +1.2, +1);
      if (fakeBO.type === 'fake-up')   add('SMC: Bull trap (fake breakout)', -1.2, -1);
    }

    if (breakout) {
      if (breakout.type === 'breakout-up')   add('Break above resistance', +0.9, +1);
      if (breakout.type === 'breakout-down') add('Break below support', -0.9, -1);
    }
    if (continuation) {
      if (continuation.type === 'continuation-up')   add('Trend continuation up', +0.7, +1);
      if (continuation.type === 'continuation-down') add('Trend continuation down', -0.7, -1);
    }
    if (reversal) {
      if (reversal.type === 'reversal-up')   add(`Reversal at support (${reversal.pattern})`, +0.8, +1);
      if (reversal.type === 'reversal-down') add(`Reversal at resistance (${reversal.pattern})`, -0.8, -1);
    }

    /* === Indicator confluences (supporting weights) === */
    if (trend.dir === 'up') {
      add('EMA9 > EMA21 (uptrend)', +0.7 + trend.strength * 0.4, +1);
    } else if (trend.dir === 'down') {
      add('EMA9 < EMA21 (downtrend)', -(0.7 + trend.strength * 0.4), -1);
    }

    if (ema50Val != null) {
      if (last.close > ema50Val && trend.dir === 'up') add('Price above EMA50', +0.3, +1);
      else if (last.close < ema50Val && trend.dir === 'down') add('Price below EMA50', -0.3, -1);
    }

    if (vwapVal != null) {
      if (last.close > vwapVal) add('Price above VWAP', +0.4, +1);
      else add('Price below VWAP', -0.4, -1);
    }

    if (rsiVal != null) {
      if (rsiVal < 30) add(`RSI ${rsiVal.toFixed(1)} oversold`, +0.7, +1);
      else if (rsiVal > 70) add(`RSI ${rsiVal.toFixed(1)} overbought`, -0.7, -1);
      else if (rsiVal > 55 && trend.dir === 'up') add(`RSI ${rsiVal.toFixed(1)} bullish`, +0.25, +1);
      else if (rsiVal < 45 && trend.dir === 'down') add(`RSI ${rsiVal.toFixed(1)} bearish`, -0.25, -1);
    }

    cps.forEach(c => {
      if (c.bias === 'bull') add(c.name, c.weight * 0.5, +1);
      else if (c.bias === 'bear') add(c.name, -c.weight * 0.5, -1);
    });

    if (volSpike >= 1.6) {
      if (last.close > last.open) add(`Volume spike ×${volSpike.toFixed(1)} (bull)`, +0.4, +1);
      else if (last.close < last.open) add(`Volume spike ×${volSpike.toFixed(1)} (bear)`, -0.4, -1);
    }

    /* ---- decide ---- */
    const absScore = Math.abs(score);
    let direction = 'NEUTRAL';
    if (absScore >= MIN_SCORE) direction = score > 0 ? 'BUY' : 'SELL';

    // RSI veto: never go against extreme conditions
    if (direction === 'BUY' && rsiVal != null && rsiVal > 78) {
      direction = 'NEUTRAL';
      conf.push({ text: 'Veto: RSI extreme overbought', dir: 0 });
    }
    if (direction === 'SELL' && rsiVal != null && rsiVal < 22) {
      direction = 'NEUTRAL';
      conf.push({ text: 'Veto: RSI extreme oversold', dir: 0 });
    }

    // Premium/Discount filter — don't BUY in premium / don't SELL in discount
    if (direction === 'BUY' && pd && pd.zone === 'premium' && pd.pos > 0.85) {
      direction = 'NEUTRAL';
      conf.push({ text: 'Veto: BUY rejected in deep premium', dir: 0 });
    }
    if (direction === 'SELL' && pd && pd.zone === 'discount' && pd.pos < 0.15) {
      direction = 'NEUTRAL';
      conf.push({ text: 'Veto: SELL rejected in deep discount', dir: 0 });
    }

    const strength = Math.round(clamp(absScore / MAX_SCORE * 100, 0, 100));
    const winProb = direction === 'NEUTRAL'
      ? Math.round(40 + strength * 0.2)
      : Math.round(clamp(50 + strength * 0.42, 60, 95));

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
      smc: {
        bos: bos ? bos.type : null,
        choch: choch ? choch.type : null,
        sweep: sweep ? sweep.type : null,
        orderBlock: ob.mitigating,
        fvg: fvg.entering,
        zone: pd ? pd.zone : null
      },
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
