/* ============================================
   fx-rates.js — fetch live USD spot rates and patch the asset
   registry so synthetic-fallback prices reflect today's market.

   Sources (free, CORS-friendly, no auth required):
     1) fawazahmed0/exchange-api   — 200+ currencies, jsDelivr CDN
     2) open.er-api.com             — 160+ currencies
     3) frankfurter.dev             — ECB rates (fewer currencies)

   Result: every USD/X pair in window.OTCApi.ASSETS gets a fresh
   `base` price within ~0.5% of real spot. The Yahoo Finance fetcher
   still provides full 1m/5m candle history when CORS proxies work;
   this module simply ensures the synthetic fallback is current.
============================================ */

(function () {
  'use strict';

  const ENDPOINTS = [
    {
      url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
      pluck: (data) => data && data.usd ? upperKeys(data.usd) : null
    },
    {
      url: 'https://currency-api.pages.dev/v1/currencies/usd.json',
      pluck: (data) => data && data.usd ? upperKeys(data.usd) : null
    },
    {
      url: 'https://open.er-api.com/v6/latest/USD',
      pluck: (data) => data && data.rates ? data.rates : null
    },
    {
      url: 'https://api.exchangerate-api.com/v4/latest/USD',
      pluck: (data) => data && data.rates ? data.rates : null
    },
    {
      url: 'https://api.frankfurter.dev/latest?base=USD',
      pluck: (data) => data && data.rates ? data.rates : null
    }
  ];

  function upperKeys(obj) {
    const out = {};
    for (const k in obj) out[k.toUpperCase()] = obj[k];
    return out;
  }

  async function fetchRates() {
    let lastErr;
    for (const ep of ENDPOINTS) {
      try {
        const res = await fetch(ep.url, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const rates = ep.pluck(data);
        if (rates && Object.keys(rates).length > 30) {
          return { rates, source: ep.url };
        }
        throw new Error('Insufficient currencies in response');
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('All FX endpoints failed');
  }

  // Pairs whose label encodes "X/USD" rather than "USD/X" — the rate
  // we want is 1 / USD-rate.
  const INVERSE_PAIRS = {
    'FX:EURUSD': 'EUR',
    'FX:GBPUSD': 'GBP',
    'FX:AUDUSD': 'AUD',
    'FX:NZDUSD': 'NZD'
  };

  /**
   * Patch every USD/X and X/USD pair in the asset registry with the
   * live spot rate. Returns the count of patched pairs.
   */
  function applyRates(rates) {
    if (!window.OTCApi || !window.OTCApi.ASSETS) return 0;
    let n = 0;

    for (const asset of window.OTCApi.ASSETS) {
      // X/USD pairs (handful of forex majors)
      if (INVERSE_PAIRS[asset.id]) {
        const r = rates[INVERSE_PAIRS[asset.id]];
        if (r > 0 && isFinite(r)) {
          asset.base = +(1 / r).toFixed(6);
          n++;
        }
        continue;
      }

      // USD/X pairs — extract the X currency code from the asset id
      // (FX:USDINR, FX:USDPKR, FX:USDBDT, etc.)
      const m = /^FX:USD([A-Z]{3})$/.exec(asset.id);
      if (m) {
        const r = rates[m[1]];
        if (r > 0 && isFinite(r)) {
          // Round to a sensible precision; very large rates (VND, IDR)
          // round less aggressively than tight ones (HKD, BRL).
          const dp = r >= 5000 ? 1 : r >= 500 ? 2 : r >= 100 ? 3 : r >= 10 ? 4 : 5;
          asset.base = +Number(r).toFixed(dp);
          n++;
        }
      }
    }

    return n;
  }

  // Public: refreshable on demand from the UI as well
  async function syncFxRates(opts) {
    opts = opts || {};
    try {
      const { rates, source } = await fetchRates();
      const n = applyRates(rates);
      if (!opts.silent && window.OTCNotify) {
        window.OTCNotify.toast({
          type: 'info',
          title: 'Live prices synced',
          desc: `${n} currency pairs updated`,
          timeout: 2200
        });
      }
      return { ok: true, count: n, source };
    } catch (e) {
      if (!opts.silent && window.OTCNotify) {
        window.OTCNotify.toast({
          type: 'sell',
          title: 'FX rate sync failed',
          desc: e.message || 'Network unreachable',
          timeout: 3000
        });
      }
      return { ok: false, error: e.message };
    }
  }

  // Auto-run shortly after load. Wait for OTCApi to be ready.
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => syncFxRates({ silent: true }), 900);
    // Refresh every 30 minutes — emerging-market currencies can move fast
    setInterval(() => syncFxRates({ silent: true }), 30 * 60 * 1000);
  });

  window.OTCFxRates = { syncFxRates };
})();
