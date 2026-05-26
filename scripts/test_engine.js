/* Smoke-test the indicator + strategy engine in Node.
 * Loads the browser scripts, stubs window/localStorage, and runs analyze()
 * on synthetic data (no network).
 *
 * Run: node scripts/test_engine.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Build a minimal browser-ish global object
function makeWindow() {
  const win = {};
  win.window = win;
  win.self = win;
  win.console = console;
  win.Date = Date;
  win.localStorage = (function () {
    const data = {};
    return {
      getItem: k => (k in data ? data[k] : null),
      setItem: (k, v) => { data[k] = String(v); },
      removeItem: k => { delete data[k]; }
    };
  })();
  win.fetch = () => Promise.reject(new Error('offline'));
  win.document = {
    getElementById: () => null,
    createElement: () => ({ className: '', appendChild() {}, querySelector() { return { textContent: '' }; }, addEventListener() {}, classList: { add(){}, remove(){} }, remove() {} })
  };
  vm.createContext(win);
  const files = [
    'js/storage.js',
    'js/notifications.js',
    'js/indicators.js',
    'js/patterns.js',
    'js/api.js',
    'js/strategy.js'
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    vm.runInContext(src, win, { filename: f });
  }
  return win;
}

(async () => {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'FX:EURUSD', 'SY:VOL75', 'FX:USDJPY', 'SY:BOOM1000'];
  const tfs = ['1m', '5m'];

  let buy = 0, sell = 0, neutral = 0, total = 0;
  const samples = [];
  // Run multiple iterations — each has a different synthetic seed because
  // api.js seeds RNG by Date.now() / candleSec.
  // We use vm.createContext per iteration so module-level state resets.
  for (let iter = 0; iter < 8; iter++) {
    const win = makeWindow();
    // override Date to shift the seed
    const baseTime = Date.now() + iter * 60_000_000;
    win.Date = class extends Date {
      constructor(...args) { super(...args.length ? args : [baseTime]); }
      static now() { return baseTime; }
    };
    // Re-run api.js so it picks up the new Date
    const apiSrc = fs.readFileSync(path.join(__dirname, '..', 'js/api.js'), 'utf8');
    vm.runInContext(apiSrc, win, { filename: 'js/api.js' });
    const stratSrc = fs.readFileSync(path.join(__dirname, '..', 'js/strategy.js'), 'utf8');
    vm.runInContext(stratSrc, win, { filename: 'js/strategy.js' });

    for (const sym of symbols) {
      for (const tf of tfs) {
        const sig = await win.OTCStrategy.analyze(sym, tf);
        total++;
        if (sig.direction === 'BUY') buy++;
        else if (sig.direction === 'SELL') sell++;
        else neutral++;
        if (sig.direction !== 'NEUTRAL') samples.push(sig);
      }
    }
  }

  console.log('\n=== Signal distribution across 8 seeds × 6 symbols × 2 timeframes ===');
  console.log(`Total: ${total}   BUY: ${buy}   SELL: ${sell}   NEUTRAL: ${neutral}`);
  console.log(`Trade rate: ${((buy + sell) / total * 100).toFixed(1)}%`);

  console.log('\n=== Sample non-neutral signals ===');
  samples.slice(0, 10).forEach(s => {
    console.log(`${s.pairLabel.padEnd(22)} ${s.timeframe.padEnd(4)} ${s.direction.padEnd(6)} `+
                `strength=${String(s.strength + '%').padStart(4)} winProb=${String(s.winProb + '%').padStart(4)} `+
                `trend=${s.trend.padEnd(8)} RSI=${String(s.rsi).padStart(5)}`);
    console.log('   ' + s.confluences.slice(0, 6).join(' • '));
  });
})();
