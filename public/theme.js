/* Runs in <head>, before CSS and the app, including on login and in split panes.
   Keep this external: Pocket's CSP deliberately disallows inline scripts. */
(() => {
  'use strict';
  const root = document.documentElement;
  const modes = ['system', 'light', 'dark'];
  const accents = ['clay', 'blue', 'purple'];
  const media = matchMedia('(prefers-color-scheme: dark)');
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* This window still works without storage. */ } };
  const initialMode = () => {
    const saved = read('pc-theme', null);
    if (modes.includes(saved)) return saved;
    // A browser used before appearance modes keeps its dark workbench. New browsers
    // follow the system. Persist once, before the app creates any other pc-* keys.
    let existing = false;
    try { existing = localStorage.getItem('pc-theme') === null && Object.keys(localStorage).some(key => key.startsWith('pc-') && key !== 'pc-theme'); } catch { }
    return existing ? 'dark' : 'system';
  };
  let preference = initialMode();
  let accent = read('pc-accent', 'clay');
  if (!accents.includes(accent)) accent = 'clay';
  write('pc-theme', preference);
  const apply = () => {
    const resolved = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    root.dataset.theme = resolved;
    root.dataset.accent = accent;
    // Matches --bg in app.css; set before the stylesheet loads to avoid chrome flicker.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#131110' : '#FAF8F5');
    window.dispatchEvent(new Event('pocket-appearance-change'));
  };
  window.PocketTheme = Object.freeze({
    get preference() { return preference; },
    get resolved() { return root.dataset.theme; },
    get accent() { return accent; },
    setPreference(value) { if (modes.includes(value)) { preference = value; write('pc-theme', value); apply(); } },
    setAccent(value) { if (accents.includes(value)) { accent = value; write('pc-accent', value); apply(); } },
  });
  media.addEventListener('change', () => { if (preference === 'system') apply(); });
  // localStorage events reach other same-origin tabs, windows and pane iframes.
  // Apply in place: never rebuild a view or disturb its draft, scroll or stream.
  window.addEventListener('storage', event => {
    if (event.storageArea !== localStorage || (event.key !== null && !['pc-theme', 'pc-accent'].includes(event.key))) return;
    const mode = read('pc-theme', 'system'), color = read('pc-accent', 'clay');
    preference = modes.includes(mode) ? mode : 'system';
    accent = accents.includes(color) ? color : 'clay';
    apply();
  });
  window.addEventListener('pageshow', () => apply());
  apply();
})();
