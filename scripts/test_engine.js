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
  // ---- 1. Asset registry sanity check ----
  const win0 = makeWindow();
  const allIds = win0.OTCApi.ASSETS.map(a => a.id);
  const groups = {};
  win0.OTCApi.ASSETS.forEach(a => { groups[a.group] = (groups[a.group] || 0) + 1; });

  console.log('=== Asset registry ===');
  console.log(`Total assets: ${allIds.length}`);
  for (const g of Object.keys(groups).sort()) console.log(`  ${g}: ${groups[g]}`);

  const newEmerging = ['FX:USDINR', 'FX:USDBRL', 'FX:USDIDR', 'FX:USDPKR', 'FX:USDBDT'];
  console.log('\nUser-requested currencies registered?');
  for (const id of newEmerging) {
    const a = win0.OTCApi.ASSET_BY_ID[id];
    console.log(`  ${id}: ${a ? '✓ ' + a.label : '✗ MISSING'}`);
  }

  // ---- 2. Strategy distribution across symbols (incl. emerging) ----
  const symbols = [
    'BTCUSDT', 'ETHUSDT',
    'FX:EURUSD', 'FX:USDJPY',
    'FX:USDINR', 'FX:USDBRL', 'FX:USDIDR', 'FX:USDPKR', 'FX:USDBDT',
    'FX:USDPHP', 'FX:USDTHB', 'FX:USDVND',
    'CM:XAUUSD', 'IX:SP500', 'ST:AAPL', 'SY:VOL75'
  ];
  const tfs = ['1m', '5m'];

  let buy = 0, sell = 0, neutral = 0, total = 0;
  const samples = [];
  for (let iter = 0; iter < 6; iter++) {
    const win = makeWindow();
    const baseTime = Date.now() + iter * 60_000_000;
    win.Date = class extends Date {
      constructor(...args) { super(...args.length ? args : [baseTime]); }
      static now() { return baseTime; }
    };
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
  console.log('\n=== Signal distribution ===');
  console.log(`6 seeds × ${symbols.length} symbols × ${tfs.length} timeframes`);
  console.log(`Total: ${total}   BUY: ${buy}   SELL: ${sell}   NEUTRAL: ${neutral}`);
  console.log(`Trade rate: ${((buy + sell) / total * 100).toFixed(1)}%`);

  // pick a few samples featuring emerging-market currencies
  const fxSamples = samples.filter(s => s.symbol.startsWith('FX:USD') &&
    !['FX:USDJPY','FX:USDCAD','FX:USDCHF'].includes(s.symbol)).slice(0, 5);
  if (fxSamples.length) {
    console.log('\n=== Sample emerging-market signals ===');
    fxSamples.forEach(s => {
      console.log(`${s.pairLabel.padEnd(40)} ${s.timeframe.padEnd(3)} ${s.direction.padEnd(5)} `+
                  `str=${String(s.strength + '%').padStart(4)} win=${String(s.winProb + '%').padStart(4)} ` +
                  `entry=${s.entryPrice}`);
      console.log('   ' + s.confluences.slice(0, 4).join(' • '));
    });
  }

  // ---- 3. Telegram helpers ----
  console.log('\n=== Telegram helpers ===');
  const winT = makeWindow();

  // Save settings
  winT.OTCStore.saveSettings({
    tg: true, tgAuto: true, tgToken: '123456:abc', tgChat: '12345',
    tgMinStrength: 80, tgIntervalSec: 45
  });
  const s = winT.OTCStore.getSettings();
  console.log('Settings round-trip:',
    s.tg, s.tgAuto, s.tgMinStrength, s.tgIntervalSec, s.tgScanGroup, s.tgTimeframe);

  // Dedupe cache
  const key = 'BTCUSDT|1m|BUY|123456';
  console.log('isTgSent before mark:', winT.OTCStore.isTgSent(key));
  winT.OTCStore.markTgSent(key);
  console.log('isTgSent after mark:', winT.OTCStore.isTgSent(key));

  // Daily counter
  let r = winT.OTCStore.bumpTgSentCount();
  console.log('After 1st bump:', { sentToday: r.tgSentToday, total: r.tgSentTotal });
  r = winT.OTCStore.bumpTgSentCount();
  console.log('After 2nd bump:', { sentToday: r.tgSentToday, total: r.tgSentTotal });

  // Format a Telegram message
  const sample = samples[0];
  if (sample) {
    const msg = winT.OTCNotify.formatTelegram({ ...sample, broker: 'Quotex' });
    console.log('\nFormatted Telegram message:\n----------\n' + msg + '\n----------');
  }

  // Token-format validation
  const r1 = await winT.OTCNotify.sendTelegram('test', { force: true, token: 'bogus', chat: '1' });
  console.log('\nInvalid token rejected:', r1.error);
})();
