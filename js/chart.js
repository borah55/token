/* ============================================
   chart.js — TradingView Lightweight chart wrapper
   exposes window.OTCChart
============================================ */

(function () {
  'use strict';

  let chart, series, host;

  function ensureChart() {
    if (!window.LightweightCharts) return null;
    if (chart) return { chart, series };

    host = document.getElementById('chartHost');
    if (!host) return null;

    chart = LightweightCharts.createChart(host, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#7d96b3',
        fontSize: 11,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      },
      grid: {
        vertLines: { color: 'rgba(0, 229, 209, 0.05)' },
        horzLines: { color: 'rgba(0, 229, 209, 0.05)' }
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: 'rgba(0, 229, 209, 0.15)'
      },
      rightPriceScale: { borderColor: 'rgba(0, 229, 209, 0.15)' },
      crosshair: { mode: 0 },
      width: host.clientWidth,
      height: host.clientHeight || 180,
      handleScroll: false,
      handleScale: false
    });

    series = chart.addCandlestickSeries({
      upColor: '#00e676',
      downColor: '#ff3b5c',
      wickUpColor: '#00e676',
      wickDownColor: '#ff3b5c',
      borderVisible: false
    });

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (host && chart) chart.applyOptions({ width: host.clientWidth });
    });
    ro.observe(host);

    return { chart, series };
  }

  function render(candles) {
    const ctx = ensureChart();
    if (!ctx) return;
    const data = candles.map(c => ({
      time: c.time,
      open: c.open, high: c.high, low: c.low, close: c.close
    }));
    ctx.series.setData(data);
    ctx.chart.timeScale().fitContent();
  }

  function clear() {
    if (series) series.setData([]);
  }

  window.OTCChart = { render, clear };
})();
