/*
 * Hide / show the ribbon. One button (or Ctrl+F1) hides the tabs and every tool,
 * leaving only the slim blue title bar so the sheet gets the whole screen.
 */
(function () {
  'use strict';

  const KEY = 'tally.ribbonHidden';
  const btn = document.getElementById('btn-ribbon-toggle');
  if (!btn) return;

  function set(hidden, save) {
    document.body.classList.toggle('ribbon-hidden', hidden);
    btn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
    const label = hidden ? 'Show ribbon (Ctrl+F1)' : 'Hide ribbon (Ctrl+F1)';
    btn.title = label;
    btn.setAttribute('aria-label', hidden ? 'Show ribbon' : 'Hide ribbon');
    if (save) {
      try { localStorage.setItem(KEY, hidden ? '1' : '0'); } catch (e) { /* storage may be unavailable */ }
    }
    // the sheet area just changed size; let the grid redraw to fill it
    window.dispatchEvent(new Event('resize'));
  }

  btn.addEventListener('click', () => set(!document.body.classList.contains('ribbon-hidden'), true));
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === 'F1') {
      e.preventDefault();
      set(!document.body.classList.contains('ribbon-hidden'), true);
    }
  });

  let saved = false;
  try { saved = localStorage.getItem(KEY) === '1'; } catch (e) { /* ignore */ }
  if (saved) set(true, false);
})();
