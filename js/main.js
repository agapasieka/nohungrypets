(() => {
  function ensureToastWrap() {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    return wrap;
  }

  window.showToast = function showToast(message, type = 'success') {
    try {
      const wrap = ensureToastWrap();
      const el = document.createElement('div');
      el.className = `toast ${type || ''}`.trim();
      el.textContent = message || '';
      wrap.appendChild(el);
      setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(4px)';
        el.style.transition = 'opacity 220ms ease, transform 220ms ease';
      }, 2200);
      setTimeout(() => el.remove(), 2600);
    } catch (e) {
      /* no-op */
    }
  };
})();

