// 1.110 intake page: Show/Hide on masked fields, and one send per tap. The form works without this file.
(() => {
  document.querySelectorAll('[data-reveal]').forEach(b => {
    const field = document.getElementById(b.dataset.reveal); if (!field) return;
    const name = (b.getAttribute('aria-label') || '').replace(/^Show /, '');
    b.hidden = false;
    b.addEventListener('click', () => {
      const show = b.getAttribute('aria-pressed') !== 'true';
      field.type = show ? 'text' : 'password';
      b.setAttribute('aria-pressed', String(show)); b.textContent = show ? 'Hide' : 'Show';
      b.setAttribute('aria-label', (show ? 'Hide ' : 'Show ') + name);
    });
  });
  const form = document.querySelector('[data-intake]');
  if (form) form.addEventListener('submit', () => {
    const send = form.querySelector('.send'); if (!send) return;
    // The fields go back to masked before the page leaves, so a value shown on screen is not left in view.
    form.querySelectorAll('[data-reveal]').forEach(b => { const f = document.getElementById(b.dataset.reveal); if (f) f.type = 'password'; });
    setTimeout(() => { send.disabled = true; send.textContent = 'Sending…'; }, 0);
  });
  document.querySelector('[aria-invalid="true"]')?.focus();
})();
