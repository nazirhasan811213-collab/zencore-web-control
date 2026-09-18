(() => {
  'use strict';

  const page = document.body.dataset.authPage;
  const form = document.getElementById('authForm');
  const submitButton = document.getElementById('submitButton');
  const formStatus = document.getElementById('formStatus');
  if (!page || !form || !submitButton || !formStatus) return;

  const field = name => form.elements.namedItem(name);
  const errorElement = name => document.querySelector(`[data-error-for="${name}"]`);

  function clearErrors() {
    document.querySelectorAll('.field-error').forEach(node => { node.textContent = ''; });
    form.querySelectorAll('.invalid').forEach(node => node.classList.remove('invalid'));
    formStatus.className = 'form-status';
    formStatus.textContent = '';
  }

  function fieldError(name, message) {
    const input = field(name);
    const target = errorElement(name);
    if (input?.classList) input.classList.add('invalid');
    if (target) target.textContent = message || '';
  }

  function status(message, type = 'error') {
    formStatus.textContent = message;
    formStatus.className = `form-status show ${type}`;
  }

  function setBusy(busy) {
    submitButton.disabled = busy;
    submitButton.textContent = busy
      ? 'SEDANG DIPROSES...'
      : page === 'register' ? 'DAFTAR & TERUSKAN' : 'MASUK KE ZENCORE';
  }

  function clientValidation(payload) {
    const errors = {};
    if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(payload.email)) {
      errors.email = 'Masukkan alamat e-mel yang sah.';
    }
    if (!payload.password) errors.password = 'Masukkan password.';

    if (page === 'register') {
      if (!payload.displayName || payload.displayName.trim().length < 2) {
        errors.displayName = 'Masukkan nama sekurang-kurangnya 2 aksara.';
      }
      if (payload.password.length < 10 || !/[A-Za-z]/.test(payload.password) || !/\d/.test(payload.password)) {
        errors.password = 'Gunakan minimum 10 aksara dengan sekurang-kurangnya satu huruf dan satu nombor.';
      }
      if (payload.confirmPassword !== payload.password) {
        errors.confirmPassword = 'Password tidak sepadan.';
      }
      if (!field('riskAck')?.checked) {
        errors.riskAck = 'Tandakan pengesahan ini untuk meneruskan.';
      }
    }
    return errors;
  }

  document.querySelectorAll('[data-password-toggle]').forEach(button => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? 'SOROK' : 'LIHAT';
      button.setAttribute('aria-label', show ? 'Sorokkan password' : 'Tunjukkan password');
    });
  });

  const passwordInput = field('password');
  const passwordMeter = document.getElementById('passwordMeter');
  if (passwordInput && passwordMeter) {
    passwordInput.addEventListener('input', () => {
      const value = passwordInput.value;
      let score = 0;
      if (value.length >= 10) score++;
      if (value.length >= 14) score++;
      if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
      if (/\d/.test(value)) score++;
      if (/[^A-Za-z0-9]/.test(value)) score++;
      const width = Math.min(100, score * 20);
      passwordMeter.style.width = `${width}%`;
      passwordMeter.style.background = score >= 4 ? '#43e5ad' : score >= 3 ? '#ffc767' : '#ff6f7f';
    });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    clearErrors();

    const payload = {
      email: String(field('email')?.value || '').trim(),
      password: String(field('password')?.value || '')
    };
    if (page === 'register') {
      payload.displayName = String(field('displayName')?.value || '').trim();
      payload.confirmPassword = String(field('confirmPassword')?.value || '');
      payload.riskAccepted = field('riskAck')?.checked === true;
    }

    const errors = clientValidation(payload);
    if (Object.keys(errors).length) {
      Object.entries(errors).forEach(([name, message]) => fieldError(name, message));
      status('Semak semula maklumat yang ditandakan.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/auth/${page}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        Object.entries(body.fields || {}).forEach(([name, message]) => fieldError(name, message));
        status(body.error || 'Permintaan tidak berjaya. Cuba semula.');
        return;
      }
      status(page === 'register' ? 'Akaun berjaya didaftarkan.' : 'Login berjaya.', 'success');
      window.setTimeout(() => { window.location.replace('/app'); }, 350);
    } catch (_) {
      status('Tidak dapat menghubungi ZenCore. Semak internet dan cuba semula.');
    } finally {
      setBusy(false);
    }
  });

  fetch('/auth/me', { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
    .then(response => response.ok ? response.json() : null)
    .then(body => { if (body?.authenticated) window.location.replace('/app'); })
    .catch(() => {});
})();
