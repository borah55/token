# OTC Signal Generator

A mobile-first, dark-theme web app that generates OTC trading signals (BUY/CALL or SELL/PUT) for short-expiry binary brokers like **Quotex, Binomo, Pocket Option, IQ Option, Olymp Trade**, and similar platforms.

Built with **pure HTML, CSS, and JavaScript** — no build step, no frameworks. Drop the folder into a cPanel `public_html` and it runs.

## Features

- Dark trading-app UI with cyan/teal accents, glassmorphism, smooth animations
- Mobile-app layout with bottom navigation: **Signals · Live · History · Watchlist · Settings**
- Real-time market data from the **Binance public API** for crypto OTC pairs
- Realistic synthetic candle generation for **forex OTC** and **synthetic OTC** indices (no auth, no key)
- **Strategy engine** combining:
  - EMA9/21/50 trend filter
  - RSI overbought/oversold confirmation
  - VWAP confirmation
  - Volume spike detection
  - ATR + Bollinger sideways-market filter
  - Smart Money Concepts: liquidity sweep, fake breakout, breakout
  - Candlestick patterns: hammer, shooting star, engulfing, marubozu, pinbar, doji, inside bar
  - Trend continuation & reversal at S/R
- Confluence-weighted scoring → **signal strength %**, **win probability %**, **trend direction**
- Live mini chart (TradingView Lightweight Charts)
- Candle expiry **countdown timer**
- **Push popup alerts**, **synthesized sound chime**, **Telegram bot forwarding**
- **Win/Loss tracking** dashboard, signal history, favourite pair watchlist
- **PWA** — installable as a mobile app, works offline (app shell)
- SEO meta tags + clean URL structure

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
│   ├── storage.js
│   ├── notifications.js
│   ├── indicators.js
│   ├── patterns.js
│   ├── api.js
│   ├── strategy.js
│   ├── chart.js
│   ├── app.js
│   └── pwa.js
├── assets/
│   ├── icon.svg
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
└── scripts/
    └── make_icons.py        # regenerate PNG icons (stdlib only)
```

## Deployment (cPanel)

1. Upload everything inside this folder to `public_html/` (or any subdirectory).
2. Make sure your hosting serves `.webmanifest` with MIME `application/manifest+json` (most cPanel hosts do by default).
3. Visit the site. PWA install will be offered on supported browsers.
4. Service worker requires HTTPS — most cPanel hosts include free Let's Encrypt SSL.

## Telegram alerts

1. Create a bot with [@BotFather](https://t.me/BotFather) and grab the token.
2. Get your channel/chat ID (e.g. via [@userinfobot](https://t.me/userinfobot) or by adding the bot to a channel).
3. Open **Settings** in the app, paste both values, toggle "Enable Telegram forwarding", tap **Send Test Message**.

## Risk warning

Trading binary options and OTC instruments involves substantial risk and you can lose your capital. This app is a technical-analysis tool for **educational purposes** and does **not** constitute financial advice. Forex OTC and synthetic OTC charts shown here are simulated for demonstration; only crypto pairs use live market data.
