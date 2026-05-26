# OTC Signal Generator

A mobile-first, dark-theme web app that generates OTC trading signals (BUY/CALL or SELL/PUT) for short-expiry binary brokers like **Quotex, Binomo, Pocket Option, IQ Option, Olymp Trade**, and similar platforms.

Built with **pure HTML, CSS, and JavaScript** — no build step, no frameworks. Drop the folder into a cPanel `public_html` and it runs.

## What's covered (80+ OTC pairs)

| Group | Examples | Data source |
|---|---|---|
| **Crypto OTC** (22 pairs) | BTC, ETH, BNB, SOL, XRP, DOGE, ADA, LTC, AVAX, LINK, DOT, MATIC, TRX, BCH, ATOM, FIL, NEAR, UNI, ETC, XLM, SHIB, VET | Binance public API (real-time, 1m granularity) |
| **Forex Majors OTC** | EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD, USD/CHF, NZD/USD | Yahoo Finance |
| **Forex Crosses OTC** (18 pairs) | EUR/GBP, EUR/JPY, GBP/JPY, EUR/AUD, EUR/CAD, EUR/CHF, EUR/NZD, GBP/AUD, GBP/CAD, GBP/CHF, GBP/NZD, AUD/CAD, AUD/CHF, AUD/JPY, AUD/NZD, CAD/JPY, CHF/JPY, NZD/CAD, NZD/CHF, NZD/JPY | Yahoo Finance |
| **Forex Exotics OTC** | USD/SGD, USD/TRY, USD/MXN, USD/ZAR, USD/HKD, USD/NOK, USD/SEK, USD/CNH | Yahoo Finance |
| **Commodities OTC** | Gold, Silver, WTI, Brent, Natural Gas, Platinum, Palladium, Copper | Yahoo Finance |
| **Indices OTC** | S&P 500, Dow 30, NASDAQ 100, FTSE 100, DAX 40, Nikkei 225 | Yahoo Finance |
| **Stocks OTC** | AAPL, TSLA, AMZN, MSFT, GOOGL, META, NFLX, NVDA, AMD, BA, MCD, KO | Yahoo Finance |
| **Synthetic OTC** (Deriv-style) | Volatility 10/25/50/75/100, Boom 300/500/1000, Crash 300/500/1000, Step Index, Range Break | Programmatic (no public API) |

Yahoo's `query1.finance.yahoo.com/v8/finance/chart` endpoint is hit through public CORS proxies (`corsproxy.io`, `allorigins.win`, `codetabs.com`, `thingproxy`) with automatic fallback. No API key needed for any source.

## Strategy — SMC-first signal engine

Smart Money Concepts are the headline logic, with classical indicators acting as confirmation:

**Smart Money Concepts (heavy weights)**
- **CHoCH** — Change of Character (trend reversal)
- **BOS** — Break of Structure (trend continuation)
- **Liquidity Sweep** — buy-side / sell-side liquidity grab
- **Order Block mitigation** (bullish + bearish OBs)
- **Fair Value Gap (FVG / Imbalance)** entry
- **Equal Highs / Equal Lows** (liquidity pool detection)
- **Premium / Discount zones** (50% equilibrium model)
- **Bull trap / Bear trap** (fake breakouts)
- **Breakout** above resistance / below support
- **Reversal at S/R** with candlestick confirmation

**Classical confirmation**
- EMA9 / EMA21 / EMA50 trend filter
- RSI(14) overbought/oversold + extreme veto
- VWAP confirmation
- ATR + Bollinger bandwidth + flip-rate **sideways-market filter**
- Volume spike confirmation
- Candlestick patterns: Hammer, Shooting Star, Engulfing, Marubozu, Pinbar, Doji, Inside Bar
- Trend continuation, S/R reversal

**Output per signal**
- BUY/CALL or SELL/PUT (or "no trade")
- Signal strength %
- Win probability %
- Trend direction (bullish / bearish / sideways)
- Live SMC summary block (BOS / CHoCH / Sweep / OB / FVG / Zone)
- 12 confluences, color-coded
- Candle expiry countdown timer
- Telegram-ready alert format

## UI

- Dark navy / cyan-teal theme with glassmorphism cards (matches the Quotex/Binomo style)
- Bottom navigation: **Signals · Live · History · Watchlist · Settings**
- Live scanner with filters: All / Crypto / Forex / Metals & Oil / Indices / Stocks / Synthetic
- Mini live chart (TradingView Lightweight Charts)
- Push-style toast popups, candle-expiry countdown
- Skeleton loaders, smooth animations, glow rings on strong signals
- Win/loss tracking dashboard, signal history (200 cap), favourite watchlist
- Synthesized chime via WebAudio (no audio asset needed)
- Telegram bot forwarding (optional)
- **PWA** — installable as a mobile app, works offline (app shell)
- SEO meta tags + `robots.txt`

## File structure

```
.
├── index.html
├── manifest.webmanifest
├── service-worker.js
├── robots.txt
├── css/
│   ├── style.css
│   └── animations.css
├── js/
│   ├── storage.js          # localStorage wrapper
│   ├── notifications.js    # toast + WebAudio chime + Telegram
│   ├── indicators.js       # SMA, EMA, RSI, VWAP, ATR, BB, swings
│   ├── patterns.js         # SMC primitives + candlestick patterns
│   ├── api.js              # Binance + Yahoo Finance + synthetic
│   ├── strategy.js         # SMC-first signal engine
│   ├── chart.js            # TradingView Lightweight chart
│   ├── app.js              # screen routing + UI
│   └── pwa.js              # service worker registration
├── assets/
│   ├── icon.svg
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
└── scripts/
    ├── make_icons.py       # regenerate PNG icons (Python stdlib only)
    └── test_engine.js      # Node smoke test for the strategy
```

## Deployment (cPanel)

1. Upload everything inside this folder to `public_html/` (or any subdirectory).
2. Make sure your hosting serves `.webmanifest` with MIME `application/manifest+json` (most cPanel hosts do by default).
3. Visit the site over HTTPS. PWA install will be offered on supported browsers.
4. Service worker requires HTTPS — most cPanel hosts include free Let's Encrypt SSL.

If `corsproxy.io` ever rate-limits you on a popular site, the app silently rotates through additional public CORS proxies and falls back to synthetic data as a last resort, so the UI never shows an empty state.

## Telegram alerts

1. Create a bot with [@BotFather](https://t.me/BotFather) and grab the token.
2. Get your channel/chat ID (e.g. via [@userinfobot](https://t.me/userinfobot) or by adding the bot to a channel).
3. Open **Settings** in the app, paste both values, toggle "Enable Telegram forwarding", tap **Send Test Message**.

## Smoke test

```
node scripts/test_engine.js
```

Runs the engine against synthetic data (no network) across 96 symbol/timeframe combinations to verify that BUY/SELL signals fire only when a clean confluence stack is present.

## Risk warning

Trading binary options and OTC instruments involves substantial risk and you can lose your capital. This app is a technical-analysis tool for **educational purposes** and does **not** constitute financial advice.
