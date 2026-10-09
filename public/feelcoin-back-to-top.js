/* Feelcoin floating back-to-top control: keyboard accessible, print-safe. */
(() => {
  'use strict';
  if (document.getElementById('feelcoin-back-to-top')) return;

  const css = document.createElement('style');
  css.textContent = `
    #feelcoin-back-to-top {
      position: fixed; right: max(20px, env(safe-area-inset-right));
      bottom: max(20px, env(safe-area-inset-bottom));
      z-index: 900; display: grid; place-items: center;
      width: 46px; height: 46px; padding: 0; cursor: pointer;
      color: #e6bd68; background: rgba(20, 18, 15, .94);
      border: 1px solid rgba(214, 166, 71, .75); border-radius: 13px;
      box-shadow: 0 6px 24px rgba(0,0,0,.3), 0 0 14px rgba(206,157,60,.10);
      opacity: 0; visibility: hidden; transform: translateY(10px);
      transition: opacity .2s ease, transform .2s ease, visibility .2s ease,
                  background .2s ease, box-shadow .2s ease;
      -webkit-tap-highlight-color: transparent;
    }
    #feelcoin-back-to-top.is-visible {
      opacity: 1; visibility: visible; transform: translateY(0);
    }
    #feelcoin-back-to-top:hover {
      background: #30271a; box-shadow: 0 8px 26px rgba(0,0,0,.34), 0 0 20px rgba(214,166,71,.22);
    }
    #feelcoin-back-to-top:focus-visible {
      outline: 2px solid #f5d38f; outline-offset: 4px;
    }
    #feelcoin-back-to-top svg { width: 21px; height: 21px; }
    @media (max-width: 600px) {
      #feelcoin-back-to-top { width: 42px; height: 42px; right: 16px; bottom: max(16px, env(safe-area-inset-bottom)); }
    }
    @media (prefers-reduced-motion: reduce) {
      #feelcoin-back-to-top { transition: none; }
    }
    @media print { #feelcoin-back-to-top { display: none !important; } }
  `;

  const button = document.createElement('button');
  button.id = 'feelcoin-back-to-top';
  button.type = 'button';
  button.setAttribute('aria-label', 'Back to top');
  button.title = 'Back to top';
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 6-6 6 6"/></svg>';

  function init() {
    document.head.appendChild(css);
    document.body.appendChild(button);
    let ticking = false;
    const update = () => {
      button.classList.toggle('is-visible', window.scrollY > 400);
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    }, { passive: true });
    button.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
    update();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
