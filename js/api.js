/* ============================================
   api.js — multi-source market data layer
   - Binance public API for crypto OTC (real-time, 1m granularity)
   - Yahoo Finance v8 chart API for forex / commodities / indices / stocks
     (routed through CORS proxies because Yahoo blocks browser CORS)
   - Deterministic synthetic candles for Deriv-style synthetic indices
   exposes window.OTCApi
============================================ */

(function () {
  'use strict';

  /* ====================================================================
     BINANCE — primary for crypto OTC (best 1m granularity, real-time)
  ==================================================================== */
  const BINANCE_BASES = [
    'https://api.binance.com',
    'https://api1.binance.com',
    'https://api2.binance.com',
    'https://api3.binance.com',
    'https://data-api.binance.vision'
  ];

  /* ====================================================================
     CORS PROXIES — Yahoo Finance blocks browser CORS, so we proxy
     through these public free services. Multiple fallbacks included
     for reliability.
  ==================================================================== */
  const CORS_PROXIES = [
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
    (url) => `https://thingproxy.freeboard.io/fetch/${url}`
  ];

  // Map our timeframe IDs → upstream interval + candle period (seconds)
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

  /* ====================================================================
     ASSET REGISTRY — every supported OTC pair, classified by data source
     Format: { id, label, group, source, ymb (Yahoo), bnb (Binance),
              base (synthetic price), vol (synthetic vol) }
  ==================================================================== */
  const ASSETS = [
    // === Crypto OTC (Binance primary, Yahoo fallback) ===
    { id: 'BTCUSDT',   label: 'BTC/USD (OTC)',     group: 'crypto', source: 'binance', bnb: 'BTCUSDT', ymb: 'BTC-USD' },
    { id: 'ETHUSDT',   label: 'ETH/USD (OTC)',     group: 'crypto', source: 'binance', bnb: 'ETHUSDT', ymb: 'ETH-USD' },
    { id: 'BNBUSDT',   label: 'BNB/USD (OTC)',     group: 'crypto', source: 'binance', bnb: 'BNBUSDT', ymb: 'BNB-USD' },
    { id: 'SOLUSDT',   label: 'SOL/USD (OTC)',     group: 'crypto', source: 'binance', bnb: 'SOLUSDT', ymb: 'SOL-USD' },
    { id: 'XRPUSDT',   label: 'XRP/USD (OTC)',     group: 'crypto', source: 'binance', bnb: 'XRPUSDT', ymb: 'XRP-USD' },
    { id: 'DOGEUSDT',  label: 'DOGE/USD (OTC)',    group: 'crypto', source: 'binance', bnb: 'DOGEUSDT', ymb: 'DOGE-USD' },
    { id: 'ADAUSDT',   label: 'ADA/USD (OTC)',     group: 'crypto', source: 'binance', bnb: 'ADAUSDT', ymb: 'ADA-USD' },
    { id: 'LTCUSDT',   label: 'LTC/USD (OTC)',     group: 'crypto', source: 'binance', bnb: 'LTCUSDT', ymb: 'LTC-USD' },
    { id: 'AVAXUSDT',  label: 'AVAX/USD (OTC)',    group: 'crypto', source: 'binance', bnb: 'AVAXUSDT', ymb: 'AVAX-USD' },
    { id: 'LINKUSDT',  label: 'LINK/USD (OTC)',    group: 'crypto', source: 'binance', bnb: 'LINKUSDT', ymb: 'LINK-USD' },
    { id: 'DOTUSDT',   label: 'DOT/USD (OTC)',     group: 'crypto', source: 'binance', bnb: 'DOTUSDT', ymb: 'DOT-USD' },
    { id: 'TRXUSDT',   label: 'TRX/USD (OTC)',     group: 'crypto', source: 'binance', bnb: 'TRXUSDT', ymb: 'TRX-USD' },
    { id: 'MATICUSDT', label: 'MATIC/USD (OTC)',   group: 'crypto', source: 'binance', bnb: 'MATICUSDT', ymb: 'MATIC-USD' },
    { id: 'BCHUSDT',   label: 'BCH/USD (OTC)',     group: 'crypto', source: 'binance', bnb: 'BCHUSDT', ymb: 'BCH-USD' },
    { id: 'ATOMUSDT',  label: 'ATOM/USD (OTC)',    group: 'crypto', source: 'binance', bnb: 'ATOMUSDT', ymb: 'ATOM-USD' },
    { id: 'FILUSDT',   label: 'FIL/USD (OTC)',     group: 'crypto', source: 'binance', bnb: 'FILUSDT', ymb: 'FIL-USD' },
    { id: 'NEARUSDT',  label: 'NEAR/USD (OTC)',    group: 'crypto', source: 'binance', bnb: 'NEARUSDT', ymb: 'NEAR-USD' },
    { id: 'UNIUSDT',   label: 'UNI/USD (OTC)',     group: 'crypto', source: 'binance', bnb: 'UNIUSDT', ymb: 'UNI-USD' },
    { id: 'ETCUSDT',   label: 'ETC/USD (OTC)',     group: 'crypto', source: 'binance', bnb: 'ETCUSDT', ymb: 'ETC-USD' },
    { id: 'XLMUSDT',   label: 'XLM/USD (OTC)',     group: 'crypto', source: 'binance', bnb: 'XLMUSDT', ymb: 'XLM-USD' },
    { id: 'SHIBUSDT',  label: 'SHIB/USD (OTC)',    group: 'crypto', source: 'binance', bnb: 'SHIBUSDT', ymb: 'SHIB-USD' },
    { id: 'VETUSDT',   label: 'VET/USD (OTC)',     group: 'crypto', source: 'binance', bnb: 'VETUSDT', ymb: 'VET-USD' },

    // === Forex Major OTC (Yahoo Finance) ===
    { id: 'FX:EURUSD', label: 'EUR/USD (OTC)',     group: 'forex_major', source: 'yahoo', ymb: 'EURUSD=X', base: 1.082, vol: 0.00018 },
    { id: 'FX:GBPUSD', label: 'GBP/USD (OTC)',     group: 'forex_major', source: 'yahoo', ymb: 'GBPUSD=X', base: 1.265, vol: 0.00022 },
    { id: 'FX:USDJPY', label: 'USD/JPY (OTC)',     group: 'forex_major', source: 'yahoo', ymb: 'JPY=X',    base: 156.4, vol: 0.018 },
    { id: 'FX:AUDUSD', label: 'AUD/USD (OTC)',     group: 'forex_major', source: 'yahoo', ymb: 'AUDUSD=X', base: 0.658, vol: 0.00020 },
    { id: 'FX:USDCAD', label: 'USD/CAD (OTC)',     group: 'forex_major', source: 'yahoo', ymb: 'CAD=X',    base: 1.365, vol: 0.00018 },
    { id: 'FX:USDCHF', label: 'USD/CHF (OTC)',     group: 'forex_major', source: 'yahoo', ymb: 'CHF=X',    base: 0.898, vol: 0.00020 },
    { id: 'FX:NZDUSD', label: 'NZD/USD (OTC)',     group: 'forex_major', source: 'yahoo', ymb: 'NZDUSD=X', base: 0.602, vol: 0.00020 },

    // === Forex Cross OTC (Yahoo Finance) ===
    { id: 'FX:EURGBP', label: 'EUR/GBP (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'EURGBP=X', base: 0.855, vol: 0.00016 },
    { id: 'FX:EURJPY', label: 'EUR/JPY (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'EURJPY=X', base: 169.2, vol: 0.020 },
    { id: 'FX:GBPJPY', label: 'GBP/JPY (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'GBPJPY=X', base: 197.8, vol: 0.024 },
    { id: 'FX:EURAUD', label: 'EUR/AUD (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'EURAUD=X', base: 1.645, vol: 0.00025 },
    { id: 'FX:EURCAD', label: 'EUR/CAD (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'EURCAD=X', base: 1.477, vol: 0.00022 },
    { id: 'FX:EURCHF', label: 'EUR/CHF (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'EURCHF=X', base: 0.971, vol: 0.00018 },
    { id: 'FX:EURNZD', label: 'EUR/NZD (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'EURNZD=X', base: 1.797, vol: 0.00026 },
    { id: 'FX:GBPAUD', label: 'GBP/AUD (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'GBPAUD=X', base: 1.923, vol: 0.00028 },
    { id: 'FX:GBPCAD', label: 'GBP/CAD (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'GBPCAD=X', base: 1.726, vol: 0.00026 },
    { id: 'FX:GBPCHF', label: 'GBP/CHF (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'GBPCHF=X', base: 1.135, vol: 0.00022 },
    { id: 'FX:GBPNZD', label: 'GBP/NZD (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'GBPNZD=X', base: 2.101, vol: 0.00030 },
    { id: 'FX:AUDCAD', label: 'AUD/CAD (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'AUDCAD=X', base: 0.898, vol: 0.00018 },
    { id: 'FX:AUDCHF', label: 'AUD/CHF (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'AUDCHF=X', base: 0.591, vol: 0.00018 },
    { id: 'FX:AUDJPY', label: 'AUD/JPY (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'AUDJPY=X', base: 102.9, vol: 0.018 },
    { id: 'FX:AUDNZD', label: 'AUD/NZD (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'AUDNZD=X', base: 1.093, vol: 0.00018 },
    { id: 'FX:CADJPY', label: 'CAD/JPY (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'CADJPY=X', base: 114.6, vol: 0.018 },
    { id: 'FX:CHFJPY', label: 'CHF/JPY (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'CHFJPY=X', base: 174.2, vol: 0.020 },
    { id: 'FX:NZDCAD', label: 'NZD/CAD (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'NZDCAD=X', base: 0.821, vol: 0.00018 },
    { id: 'FX:NZDCHF', label: 'NZD/CHF (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'NZDCHF=X', base: 0.541, vol: 0.00017 },
    { id: 'FX:NZDJPY', label: 'NZD/JPY (OTC)',     group: 'forex_cross', source: 'yahoo', ymb: 'NZDJPY=X', base: 94.20, vol: 0.018 },

    // === Forex Exotic OTC (Yahoo Finance) ===
    { id: 'FX:USDSGD', label: 'USD/SGD (OTC)',     group: 'forex_exotic', source: 'yahoo', ymb: 'SGD=X',  base: 1.345, vol: 0.00020 },
    { id: 'FX:USDTRY', label: 'USD/TRY (OTC)',     group: 'forex_exotic', source: 'yahoo', ymb: 'TRY=X',  base: 32.50, vol: 0.05 },
    { id: 'FX:USDMXN', label: 'USD/MXN (OTC)',     group: 'forex_exotic', source: 'yahoo', ymb: 'MXN=X',  base: 17.20, vol: 0.022 },
    { id: 'FX:USDZAR', label: 'USD/ZAR (OTC)',     group: 'forex_exotic', source: 'yahoo', ymb: 'ZAR=X',  base: 18.40, vol: 0.025 },
    { id: 'FX:USDHKD', label: 'USD/HKD (OTC)',     group: 'forex_exotic', source: 'yahoo', ymb: 'HKD=X',  base: 7.820, vol: 0.0008 },
    { id: 'FX:USDNOK', label: 'USD/NOK (OTC)',     group: 'forex_exotic', source: 'yahoo', ymb: 'NOK=X',  base: 10.65, vol: 0.0080 },
    { id: 'FX:USDSEK', label: 'USD/SEK (OTC)',     group: 'forex_exotic', source: 'yahoo', ymb: 'SEK=X',  base: 10.90, vol: 0.0080 },
    { id: 'FX:USDCNH', label: 'USD/CNH (OTC)',     group: 'forex_exotic', source: 'yahoo', ymb: 'CNH=X',  base: 7.250, vol: 0.0030 },

    // === Emerging-market currencies — Asia (Yahoo Finance) ===
    { id: 'FX:USDINR', label: 'USD/INR (OTC) — India',         group: 'forex_emerging', source: 'yahoo', ymb: 'INR=X', base: 83.50,    vol: 0.060 },
    { id: 'FX:USDIDR', label: 'USD/IDR (OTC) — Indonesia',     group: 'forex_emerging', source: 'yahoo', ymb: 'IDR=X', base: 16200,    vol: 25 },
    { id: 'FX:USDPKR', label: 'USD/PKR (OTC) — Pakistan',      group: 'forex_emerging', source: 'yahoo', ymb: 'PKR=X', base: 280.0,    vol: 0.40 },
    { id: 'FX:USDBDT', label: 'USD/BDT (OTC) — Bangladesh',    group: 'forex_emerging', source: 'yahoo', ymb: 'BDT=X', base: 118.0,    vol: 0.18 },
    { id: 'FX:USDPHP', label: 'USD/PHP (OTC) — Philippines',   group: 'forex_emerging', source: 'yahoo', ymb: 'PHP=X', base: 57.20,    vol: 0.060 },
    { id: 'FX:USDTHB', label: 'USD/THB (OTC) — Thailand',      group: 'forex_emerging', source: 'yahoo', ymb: 'THB=X', base: 35.50,    vol: 0.040 },
    { id: 'FX:USDVND', label: 'USD/VND (OTC) — Vietnam',       group: 'forex_emerging', source: 'yahoo', ymb: 'VND=X', base: 25400,    vol: 18 },
    { id: 'FX:USDMYR', label: 'USD/MYR (OTC) — Malaysia',      group: 'forex_emerging', source: 'yahoo', ymb: 'MYR=X', base: 4.450,    vol: 0.0060 },
    { id: 'FX:USDTWD', label: 'USD/TWD (OTC) — Taiwan',        group: 'forex_emerging', source: 'yahoo', ymb: 'TWD=X', base: 32.10,    vol: 0.040 },
    { id: 'FX:USDKRW', label: 'USD/KRW (OTC) — South Korea',   group: 'forex_emerging', source: 'yahoo', ymb: 'KRW=X', base: 1380,     vol: 1.6 },

    // === Emerging-market currencies — Latin America (Yahoo Finance) ===
    { id: 'FX:USDBRL', label: 'USD/BRL (OTC) — Brazil',        group: 'forex_emerging', source: 'yahoo', ymb: 'BRL=X', base: 5.200,    vol: 0.0080 },
    { id: 'FX:USDARS', label: 'USD/ARS (OTC) — Argentina',     group: 'forex_emerging', source: 'yahoo', ymb: 'ARS=X', base: 950,      vol: 1.5 },
    { id: 'FX:USDCOP', label: 'USD/COP (OTC) — Colombia',      group: 'forex_emerging', source: 'yahoo', ymb: 'COP=X', base: 3950,     vol: 5.2 },
    { id: 'FX:USDCLP', label: 'USD/CLP (OTC) — Chile',         group: 'forex_emerging', source: 'yahoo', ymb: 'CLP=X', base: 960,      vol: 1.4 },
    { id: 'FX:USDPEN', label: 'USD/PEN (OTC) — Peru',          group: 'forex_emerging', source: 'yahoo', ymb: 'PEN=X', base: 3.750,    vol: 0.0050 },

    // === Emerging-market currencies — EMEA (Yahoo Finance) ===
    { id: 'FX:USDRUB', label: 'USD/RUB (OTC) — Russia',        group: 'forex_emerging', source: 'yahoo', ymb: 'RUB=X', base: 92.0,     vol: 0.18 },
    { id: 'FX:USDUAH', label: 'USD/UAH (OTC) — Ukraine',       group: 'forex_emerging', source: 'yahoo', ymb: 'UAH=X', base: 41.50,    vol: 0.080 },
    { id: 'FX:USDPLN', label: 'USD/PLN (OTC) — Poland',        group: 'forex_emerging', source: 'yahoo', ymb: 'PLN=X', base: 4.050,    vol: 0.0070 },
    { id: 'FX:USDCZK', label: 'USD/CZK (OTC) — Czechia',       group: 'forex_emerging', source: 'yahoo', ymb: 'CZK=X', base: 23.20,    vol: 0.040 },
    { id: 'FX:USDHUF', label: 'USD/HUF (OTC) — Hungary',       group: 'forex_emerging', source: 'yahoo', ymb: 'HUF=X', base: 360,      vol: 0.60 },
    { id: 'FX:USDRON', label: 'USD/RON (OTC) — Romania',       group: 'forex_emerging', source: 'yahoo', ymb: 'RON=X', base: 4.650,    vol: 0.0080 },
    { id: 'FX:USDILS', label: 'USD/ILS (OTC) — Israel',        group: 'forex_emerging', source: 'yahoo', ymb: 'ILS=X', base: 3.650,    vol: 0.0060 },
    { id: 'FX:USDSAR', label: 'USD/SAR (OTC) — Saudi Arabia',  group: 'forex_emerging', source: 'yahoo', ymb: 'SAR=X', base: 3.750,    vol: 0.0010 },
    { id: 'FX:USDAED', label: 'USD/AED (OTC) — UAE',           group: 'forex_emerging', source: 'yahoo', ymb: 'AED=X', base: 3.673,    vol: 0.0010 },
    { id: 'FX:USDQAR', label: 'USD/QAR (OTC) — Qatar',         group: 'forex_emerging', source: 'yahoo', ymb: 'QAR=X', base: 3.640,    vol: 0.0010 },
    { id: 'FX:USDEGP', label: 'USD/EGP (OTC) — Egypt',         group: 'forex_emerging', source: 'yahoo', ymb: 'EGP=X', base: 48.50,    vol: 0.080 },
    { id: 'FX:USDNGN', label: 'USD/NGN (OTC) — Nigeria',       group: 'forex_emerging', source: 'yahoo', ymb: 'NGN=X', base: 1480,     vol: 3.2 },
    { id: 'FX:USDKES', label: 'USD/KES (OTC) — Kenya',         group: 'forex_emerging', source: 'yahoo', ymb: 'KES=X', base: 129.0,    vol: 0.20 },

    // === Additional emerging-market currencies — South Asia ===
    { id: 'FX:USDLKR', label: 'USD/LKR (OTC) — Sri Lanka',     group: 'forex_emerging', source: 'yahoo', ymb: 'LKR=X', base: 295.0,    vol: 0.40 },
    { id: 'FX:USDNPR', label: 'USD/NPR (OTC) — Nepal',         group: 'forex_emerging', source: 'yahoo', ymb: 'NPR=X', base: 133.0,    vol: 0.10 },

    // === Additional emerging-market currencies — Central Asia / Caucasus ===
    { id: 'FX:USDKZT', label: 'USD/KZT (OTC) — Kazakhstan',    group: 'forex_emerging', source: 'yahoo', ymb: 'KZT=X', base: 470.0,    vol: 0.80 },
    { id: 'FX:USDUZS', label: 'USD/UZS (OTC) — Uzbekistan',    group: 'forex_emerging', source: 'yahoo', ymb: 'UZS=X', base: 12500,    vol: 18 },
    { id: 'FX:USDAZN', label: 'USD/AZN (OTC) — Azerbaijan',    group: 'forex_emerging', source: 'yahoo', ymb: 'AZN=X', base: 1.700,    vol: 0.0010 },
    { id: 'FX:USDGEL', label: 'USD/GEL (OTC) — Georgia',       group: 'forex_emerging', source: 'yahoo', ymb: 'GEL=X', base: 2.730,    vol: 0.0040 },

    // === Additional emerging-market currencies — Gulf / Middle East ===
    { id: 'FX:USDKWD', label: 'USD/KWD (OTC) — Kuwait',        group: 'forex_emerging', source: 'yahoo', ymb: 'KWD=X', base: 0.308,    vol: 0.00010 },
    { id: 'FX:USDBHD', label: 'USD/BHD (OTC) — Bahrain',       group: 'forex_emerging', source: 'yahoo', ymb: 'BHD=X', base: 0.376,    vol: 0.00010 },
    { id: 'FX:USDOMR', label: 'USD/OMR (OTC) — Oman',          group: 'forex_emerging', source: 'yahoo', ymb: 'OMR=X', base: 0.385,    vol: 0.00010 },
    { id: 'FX:USDJOD', label: 'USD/JOD (OTC) — Jordan',        group: 'forex_emerging', source: 'yahoo', ymb: 'JOD=X', base: 0.709,    vol: 0.00010 },
    { id: 'FX:USDLBP', label: 'USD/LBP (OTC) — Lebanon',       group: 'forex_emerging', source: 'yahoo', ymb: 'LBP=X', base: 89500,    vol: 30 },

    // === Additional emerging-market currencies — North Africa ===
    { id: 'FX:USDMAD', label: 'USD/MAD (OTC) — Morocco',       group: 'forex_emerging', source: 'yahoo', ymb: 'MAD=X', base: 9.950,    vol: 0.020 },
    { id: 'FX:USDTND', label: 'USD/TND (OTC) — Tunisia',       group: 'forex_emerging', source: 'yahoo', ymb: 'TND=X', base: 3.130,    vol: 0.0060 },
    { id: 'FX:USDDZD', label: 'USD/DZD (OTC) — Algeria',       group: 'forex_emerging', source: 'yahoo', ymb: 'DZD=X', base: 134.5,    vol: 0.20 },

    // === Additional emerging-market currencies — Sub-Saharan Africa ===
    { id: 'FX:USDGHS', label: 'USD/GHS (OTC) — Ghana',         group: 'forex_emerging', source: 'yahoo', ymb: 'GHS=X', base: 14.80,    vol: 0.080 },
    { id: 'FX:USDUGX', label: 'USD/UGX (OTC) — Uganda',        group: 'forex_emerging', source: 'yahoo', ymb: 'UGX=X', base: 3760,     vol: 6.0 },
    { id: 'FX:USDTZS', label: 'USD/TZS (OTC) — Tanzania',      group: 'forex_emerging', source: 'yahoo', ymb: 'TZS=X', base: 2580,     vol: 4.0 },
    { id: 'FX:USDETB', label: 'USD/ETB (OTC) — Ethiopia',      group: 'forex_emerging', source: 'yahoo', ymb: 'ETB=X', base: 124.0,    vol: 0.20 },
    { id: 'FX:USDMZN', label: 'USD/MZN (OTC) — Mozambique',    group: 'forex_emerging', source: 'yahoo', ymb: 'MZN=X', base: 63.85,    vol: 0.040 },

    // === Additional emerging-market currencies — Eastern Europe ===
    { id: 'FX:USDBYN', label: 'USD/BYN (OTC) — Belarus',       group: 'forex_emerging', source: 'yahoo', ymb: 'BYN=X', base: 3.330,    vol: 0.0040 },
    { id: 'FX:USDMDL', label: 'USD/MDL (OTC) — Moldova',       group: 'forex_emerging', source: 'yahoo', ymb: 'MDL=X', base: 17.85,    vol: 0.040 },
    { id: 'FX:USDRSD', label: 'USD/RSD (OTC) — Serbia',        group: 'forex_emerging', source: 'yahoo', ymb: 'RSD=X', base: 108.7,    vol: 0.20 },

    // === Additional emerging-market currencies — Caribbean / Latin America ===
    { id: 'FX:USDDOP', label: 'USD/DOP (OTC) — Dominican Rep.', group: 'forex_emerging', source: 'yahoo', ymb: 'DOP=X', base: 60.20,    vol: 0.060 },
    { id: 'FX:USDJMD', label: 'USD/JMD (OTC) — Jamaica',       group: 'forex_emerging', source: 'yahoo', ymb: 'JMD=X', base: 158.0,    vol: 0.30 },
    { id: 'FX:USDUYU', label: 'USD/UYU (OTC) — Uruguay',       group: 'forex_emerging', source: 'yahoo', ymb: 'UYU=X', base: 41.20,    vol: 0.080 },
    { id: 'FX:USDPYG', label: 'USD/PYG (OTC) — Paraguay',      group: 'forex_emerging', source: 'yahoo', ymb: 'PYG=X', base: 7720,     vol: 8.0 },
    { id: 'FX:USDBOB', label: 'USD/BOB (OTC) — Bolivia',       group: 'forex_emerging', source: 'yahoo', ymb: 'BOB=X', base: 6.910,    vol: 0.0070 },

    // === Commodities OTC (Yahoo Finance) ===
    { id: 'CM:XAUUSD', label: 'Gold (XAU/USD)',    group: 'commodity', source: 'yahoo', ymb: 'GC=F',   base: 2380, vol: 1.6 },
    { id: 'CM:XAGUSD', label: 'Silver (XAG/USD)',  group: 'commodity', source: 'yahoo', ymb: 'SI=F',   base: 28.6, vol: 0.05 },
    { id: 'CM:WTI',    label: 'WTI Crude Oil',     group: 'commodity', source: 'yahoo', ymb: 'CL=F',   base: 78.3, vol: 0.18 },
    { id: 'CM:BRENT',  label: 'Brent Crude Oil',   group: 'commodity', source: 'yahoo', ymb: 'BZ=F',   base: 82.5, vol: 0.18 },
    { id: 'CM:NATGAS', label: 'Natural Gas',       group: 'commodity', source: 'yahoo', ymb: 'NG=F',   base: 2.68, vol: 0.025 },
    { id: 'CM:PLAT',   label: 'Platinum',          group: 'commodity', source: 'yahoo', ymb: 'PL=F',   base: 985,  vol: 1.4 },
    { id: 'CM:PALL',   label: 'Palladium',         group: 'commodity', source: 'yahoo', ymb: 'PA=F',   base: 1040, vol: 4.0 },
    { id: 'CM:COPPER', label: 'Copper',            group: 'commodity', source: 'yahoo', ymb: 'HG=F',   base: 4.55, vol: 0.012 },

    // === Indices OTC (Yahoo Finance) ===
    { id: 'IX:SP500',  label: 'S&P 500',           group: 'index', source: 'yahoo', ymb: '^GSPC',  base: 5300, vol: 3.5 },
    { id: 'IX:DJI',    label: 'Dow Jones 30',      group: 'index', source: 'yahoo', ymb: '^DJI',   base: 39800, vol: 25 },
    { id: 'IX:NDX',    label: 'NASDAQ 100',        group: 'index', source: 'yahoo', ymb: '^NDX',   base: 18600, vol: 18 },
    { id: 'IX:FTSE',   label: 'FTSE 100',          group: 'index', source: 'yahoo', ymb: '^FTSE',  base: 8200, vol: 8 },
    { id: 'IX:DAX',    label: 'DAX 40',            group: 'index', source: 'yahoo', ymb: '^GDAXI', base: 18500, vol: 22 },
    { id: 'IX:N225',   label: 'Nikkei 225',        group: 'index', source: 'yahoo', ymb: '^N225',  base: 39200, vol: 60 },

    // === Stocks OTC (Yahoo Finance) ===
    { id: 'ST:AAPL',   label: 'Apple (AAPL)',      group: 'stock', source: 'yahoo', ymb: 'AAPL', base: 195,  vol: 0.6 },
    { id: 'ST:TSLA',   label: 'Tesla (TSLA)',      group: 'stock', source: 'yahoo', ymb: 'TSLA', base: 215,  vol: 1.4 },
    { id: 'ST:AMZN',   label: 'Amazon (AMZN)',     group: 'stock', source: 'yahoo', ymb: 'AMZN', base: 185,  vol: 0.8 },
    { id: 'ST:MSFT',   label: 'Microsoft (MSFT)',  group: 'stock', source: 'yahoo', ymb: 'MSFT', base: 415,  vol: 1.2 },
    { id: 'ST:GOOGL',  label: 'Alphabet (GOOGL)',  group: 'stock', source: 'yahoo', ymb: 'GOOGL', base: 175, vol: 0.7 },
    { id: 'ST:META',   label: 'Meta (META)',       group: 'stock', source: 'yahoo', ymb: 'META', base: 480,  vol: 1.6 },
    { id: 'ST:NFLX',   label: 'Netflix (NFLX)',    group: 'stock', source: 'yahoo', ymb: 'NFLX', base: 645,  vol: 1.8 },
    { id: 'ST:NVDA',   label: 'NVIDIA (NVDA)',     group: 'stock', source: 'yahoo', ymb: 'NVDA', base: 920,  vol: 4.5 },
    { id: 'ST:AMD',    label: 'AMD (AMD)',         group: 'stock', source: 'yahoo', ymb: 'AMD',  base: 165,  vol: 0.9 },
    { id: 'ST:BA',     label: 'Boeing (BA)',       group: 'stock', source: 'yahoo', ymb: 'BA',   base: 175,  vol: 0.7 },
    { id: 'ST:MCD',    label: 'McDonald\'s (MCD)', group: 'stock', source: 'yahoo', ymb: 'MCD',  base: 270,  vol: 0.6 },
    { id: 'ST:KO',     label: 'Coca-Cola (KO)',    group: 'stock', source: 'yahoo', ymb: 'KO',   base: 62,   vol: 0.15 },

    // === Synthetic OTC (Deriv-style — programmatic only) ===
    { id: 'SY:VOL10',     label: 'Volatility 10',  group: 'synthetic', source: 'synthetic', base: 12500,  vol: 18 },
    { id: 'SY:VOL25',     label: 'Volatility 25',  group: 'synthetic', source: 'synthetic', base: 145000, vol: 42 },
    { id: 'SY:VOL50',     label: 'Volatility 50',  group: 'synthetic', source: 'synthetic', base: 230000, vol: 70 },
    { id: 'SY:VOL75',     label: 'Volatility 75',  group: 'synthetic', source: 'synthetic', base: 215000, vol: 130 },
    { id: 'SY:VOL100',    label: 'Volatility 100', group: 'synthetic', source: 'synthetic', base: 410000, vol: 280 },
    { id: 'SY:BOOM300',   label: 'Boom 300',       group: 'synthetic', source: 'synthetic', base: 1280,   vol: 1.2 },
    { id: 'SY:BOOM500',   label: 'Boom 500',       group: 'synthetic', source: 'synthetic', base: 4570,   vol: 2.6 },
    { id: 'SY:BOOM1000',  label: 'Boom 1000',      group: 'synthetic', source: 'synthetic', base: 8842,   vol: 4 },
    { id: 'SY:CRASH300',  label: 'Crash 300',      group: 'synthetic', source: 'synthetic', base: 870,    vol: 1.0 },
    { id: 'SY:CRASH500',  label: 'Crash 500',      group: 'synthetic', source: 'synthetic', base: 2950,   vol: 2.0 },
    { id: 'SY:CRASH1000', label: 'Crash 1000',     group: 'synthetic', source: 'synthetic', base: 4720,   vol: 4 },
    { id: 'SY:STEP',      label: 'Step Index',     group: 'synthetic', source: 'synthetic', base: 19250,  vol: 6 },
    { id: 'SY:RANGE',     label: 'Range Break',    group: 'synthetic', source: 'synthetic', base: 7800,   vol: 3 }
  ];

  const ASSET_BY_ID = Object.fromEntries(ASSETS.map(a => [a.id, a]));

  /* ====================================================================
     BINANCE FETCHER
  ==================================================================== */
  async function fetchBinanceKlines(symbol, interval, limit) {
    limit = limit || 150;
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

  /* ====================================================================
     YAHOO FINANCE FETCHER (via CORS proxies)
     v8 chart endpoint:
       https://query1.finance.yahoo.com/v8/finance/chart/{symbol}
         ?interval={1m|5m}&range={1d|5d}
  ==================================================================== */
  function yahooRangeFor(interval) {
    return interval === '5m' ? '5d' : '1d';
  }

  async function fetchYahooChart(ymbSymbol, interval, limit) {
    limit = limit || 150;
    const range = yahooRangeFor(interval);
    const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ymbSymbol)}?interval=${interval}&range=${range}&includePrePost=false`;

    let lastErr;
    // Try direct first (in case running server-side or with CORS extension)
    const candidates = [target, ...CORS_PROXIES.map(p => p(target))];

    for (const url of candidates) {
      try {
        const res = await fetch(url, { cache: 'no-store', headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        const data = JSON.parse(text);
        const result = data && data.chart && data.chart.result && data.chart.result[0];
        if (!result) throw new Error('Empty response');

        const ts = result.timestamp || [];
        const q = result.indicators && result.indicators.quote && result.indicators.quote[0];
        if (!ts.length || !q) throw new Error('No quote data');

        const candles = [];
        for (let i = 0; i < ts.length; i++) {
          const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
          // Skip null entries (Yahoo returns nulls for closed-market periods)
          if (o == null || h == null || l == null || c == null) continue;
          candles.push({
            time: ts[i],
            open: +o, high: +h, low: +l, close: +c,
            volume: +(q.volume && q.volume[i]) || 0
          });
        }
        // Take last `limit` candles
        return candles.slice(-limit);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('All Yahoo endpoints failed');
  }

  /* ====================================================================
     SYNTHETIC CANDLES (fallback + Deriv-style indices)
  ==================================================================== */
  function syntheticCandles(asset, interval, limit) {
    limit = limit || 150;
    const candleSec = (TF_TO_INTERVAL[interval] && TF_TO_INTERVAL[interval].candleSec) ||
                      (interval === '5m' ? 300 : 60);

    const base = asset.base || 1;
    const vol = asset.vol || base * 0.0005;

    // Seed RNG by symbol so each session is consistent.
    const seedStr = asset.id + Math.floor(Date.now() / (candleSec * 1000));
    let seed = 0;
    for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
    function rand() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 4294967295);
    }

    const now = Math.floor(Date.now() / 1000);
    const startTime = now - (limit - 1) * candleSec;

    let price = base;
    let trend = (rand() - 0.5) * 0.0014;
    let momentum = 0;
    let trendDuration = 0;
    let regimeLength = 8 + Math.floor(rand() * 18);

    // Boom/Crash indices have asymmetric spike behavior
    const isBoom = asset.id && asset.id.startsWith('SY:BOOM');
    const isCrash = asset.id && asset.id.startsWith('SY:CRASH');
    const spikeEvery = asset.id && asset.id.includes('1000') ? 1000
                     : asset.id && asset.id.includes('500')  ? 500
                     : asset.id && asset.id.includes('300')  ? 300
                     : 0;

    const out = [];
    for (let i = 0; i < limit; i++) {
      trendDuration++;
      if (trendDuration >= regimeLength) {
        trend = (rand() - 0.5) * 0.0022;
        regimeLength = 8 + Math.floor(rand() * 18);
        trendDuration = 0;
      }
      momentum = momentum * 0.65 + (rand() - 0.5) * vol * 1.4;

      const open = price;
      let drift = trend * base + momentum;
      let noise = (rand() - 0.5) * vol * 2.4;

      // Inject spikes for Boom/Crash indices
      if (spikeEvery && rand() < 1 / spikeEvery * 60) {
        if (isBoom) drift += vol * 6;
        if (isCrash) drift -= vol * 6;
      }

      const close = open + drift + noise;
      const wickStretch = rand() < 0.12 ? 3.5 : 1;
      const wickUp = Math.abs((rand() - 0.3) * vol * 2 * wickStretch);
      const wickDown = Math.abs((rand() - 0.3) * vol * 2 * wickStretch);
      const high = Math.max(open, close) + wickUp;
      const low = Math.min(open, close) - wickDown;

      const volRange = (high - low) / Math.max(0.0000001, vol);
      const v = 800 + volRange * (200 + rand() * 800);

      out.push({ time: startTime + i * candleSec, open, high, low, close, volume: v });
      price = close;
    }
    return out;
  }

  /* ====================================================================
     PUBLIC: getCandles — routes to the right data source
  ==================================================================== */
  async function getCandles(symbolId, timeframe, limit) {
    const tfDef = TF_TO_INTERVAL[timeframe] || TF_TO_INTERVAL['1m'];
    const interval = tfDef.interval;
    const asset = ASSET_BY_ID[symbolId];

    if (!asset) {
      // Unknown symbol — generate synthetic from a default
      return {
        candles: syntheticCandles({ id: symbolId, base: 100, vol: 0.5 }, interval, limit),
        source: 'synthetic-unknown', interval
      };
    }

    // 1) Try the primary configured source
    if (asset.source === 'binance' && asset.bnb) {
      try {
        const candles = await fetchBinanceKlines(asset.bnb, interval, limit || 150);
        return { candles, source: 'binance', interval };
      } catch (e) {
        // 1a) Fallback to Yahoo for crypto if available
        if (asset.ymb) {
          try {
            const candles = await fetchYahooChart(asset.ymb, interval, limit || 150);
            return { candles, source: 'yahoo-fallback', interval };
          } catch (e2) {}
        }
        // 1b) Final synthetic fallback
        return { candles: syntheticCandles(asset, interval, limit || 150), source: 'synthetic-fallback', interval, error: e.message };
      }
    }

    if (asset.source === 'yahoo' && asset.ymb) {
      try {
        const candles = await fetchYahooChart(asset.ymb, interval, limit || 150);
        return { candles, source: 'yahoo', interval };
      } catch (e) {
        return { candles: syntheticCandles(asset, interval, limit || 150), source: 'synthetic-fallback', interval, error: e.message };
      }
    }

    // Synthetic-only assets (Deriv indices)
    return { candles: syntheticCandles(asset, interval, limit || 150), source: 'synthetic', interval };
  }

  async function getTicker(symbolId) {
    const { candles } = await getCandles(symbolId, '1m', 30);
    if (!candles || !candles.length) return null;
    const last = candles[candles.length - 1];
    const first = candles[0];
    return {
      price: last.close,
      changePct: ((last.close - first.open) / first.open) * 100
    };
  }

  /* ====================================================================
     UI HELPERS
  ==================================================================== */
  function expirySecondsFor(timeframe) { return TF_TO_EXPIRY_SEC[timeframe] || 60; }

  function candleSecondsRemaining(timeframe) {
    const tfDef = TF_TO_INTERVAL[timeframe] || TF_TO_INTERVAL['1m'];
    const period = tfDef.candleSec;
    const now = Math.floor(Date.now() / 1000);
    return period - (now % period);
  }

  function formatSymbol(symbolId) {
    const a = ASSET_BY_ID[symbolId];
    return a ? a.label : symbolId;
  }

  function priceDecimals(symbolId) {
    const a = ASSET_BY_ID[symbolId];
    if (!a) return 4;
    if (a.group === 'forex_major' || a.group === 'forex_cross' || a.group === 'forex_exotic' || a.group === 'forex_emerging') {
      // JPY pairs use 3 decimals
      if (a.id.includes('JPY')) return 3;
      // Heuristic by base value for emerging-market currencies that span
      // very different orders of magnitude
      const base = a.base || 1;
      if (base >= 5000) return 1;        // VND, IDR
      if (base >= 500)  return 2;        // KRW, COP, CLP, ARS, NGN, HUF, KES
      if (base >= 100)  return 3;        // PKR, BDT, INR, EGP, RUB, TWD, etc.
      if (base >= 10)   return 4;        // TRY, MXN, NOK, SEK, ZAR, HKD, etc.
      return 5;                          // EUR/USD, GBP/USD, USD/CAD, USD/CHF, BRL, MYR, etc.
    }
    if (a.group === 'commodity') {
      if (a.id === 'CM:NATGAS') return 3;
      if (a.id === 'CM:COPPER') return 3;
      return 2;
    }
    if (a.group === 'index') return 2;
    if (a.group === 'stock') return 2;
    if (a.group === 'synthetic') return 2;
    if (a.group === 'crypto') {
      if (['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','AVAXUSDT','LTCUSDT','BCHUSDT','LINKUSDT','UNIUSDT','ATOMUSDT','NEARUSDT','FILUSDT','ETCUSDT','DOTUSDT'].includes(a.id)) return 2;
      if (['DOGEUSDT','TRXUSDT','XRPUSDT','ADAUSDT','MATICUSDT','XLMUSDT','VETUSDT'].includes(a.id)) return 5;
      if (a.id === 'SHIBUSDT') return 8;
      return 4;
    }
    return 4;
  }

  function fmtPrice(symbolId, value) {
    if (value == null || isNaN(value)) return '—';
    const d = priceDecimals(symbolId);
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: d, maximumFractionDigits: d
    });
  }

  // Pair groups for the live scanner & filters
  const PAIRS_BY_GROUP = ASSETS.reduce((acc, a) => {
    (acc[a.group] = acc[a.group] || []).push(a.id);
    return acc;
  }, {});

  // Convenience aggregations used by the Live screen filter chips
  const PAIRS_FILTER = {
    crypto:    PAIRS_BY_GROUP.crypto || [],
    forex:     [
      ...(PAIRS_BY_GROUP.forex_major || []),
      ...(PAIRS_BY_GROUP.forex_cross || []),
      ...(PAIRS_BY_GROUP.forex_exotic || []),
      ...(PAIRS_BY_GROUP.forex_emerging || [])
    ],
    forex_emerging: PAIRS_BY_GROUP.forex_emerging || [],
    commodity: PAIRS_BY_GROUP.commodity || [],
    index:     PAIRS_BY_GROUP.index || [],
    stock:     PAIRS_BY_GROUP.stock || [],
    synthetic: PAIRS_BY_GROUP.synthetic || []
  };

  // Top picks for the "All" scanner so we don't blast 100+ calls at once
  PAIRS_FILTER.all = [
    ...PAIRS_FILTER.crypto.slice(0, 6),
    ...(PAIRS_BY_GROUP.forex_major || []).slice(0, 5),
    ...(PAIRS_BY_GROUP.forex_cross || []).slice(0, 4),
    ...(PAIRS_BY_GROUP.forex_emerging || []).slice(0, 5),
    ...(PAIRS_BY_GROUP.forex_exotic || []).slice(0, 2),
    ...PAIRS_FILTER.commodity.slice(0, 3),
    ...PAIRS_FILTER.index.slice(0, 3),
    ...PAIRS_FILTER.stock.slice(0, 3),
    ...PAIRS_FILTER.synthetic.slice(0, 3)
  ];

  window.OTCApi = {
    ASSETS, ASSET_BY_ID,
    PAIRS_FILTER, PAIRS_BY_GROUP,
    getCandles, getTicker,
    expirySecondsFor, candleSecondsRemaining,
    formatSymbol, fmtPrice, priceDecimals
  };
})();
