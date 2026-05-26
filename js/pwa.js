/* pwa.js — register service worker + handle install prompt */
(function () {
  'use strict';

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {
        // Service workers require https or localhost — fail silently otherwise.
      });
    });
  }

  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (window.OTCNotify) {
      window.OTCNotify.toast({
        type: 'info',
        title: 'Install OTC Signal Generator',
        desc: 'Tap here to install as a mobile app',
        timeout: 8000
      });
      // Wire the toast click to trigger install
      setTimeout(() => {
        const t = document.querySelector('.toast.info:last-child');
        if (t) {
          t.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            try { await deferredPrompt.userChoice; } catch (e) {}
            deferredPrompt = null;
          });
        }
      }, 50);
    }
  });

  window.addEventListener('appinstalled', () => {
    if (window.OTCNotify) {
      window.OTCNotify.toast({
        type: 'buy', title: 'App installed', desc: 'Launch from your home screen'
      });
    }
  });
})();
