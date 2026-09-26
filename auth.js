(() => {
  'use strict';

  const page = document.body.dataset.authPage;
  const form = document.getElementById('authForm');
  const submitButton = document.getElementById('submitButton');
  const formStatus = document.getElementById('formStatus');
  if (!page || !form || !submitButton || !formStatus) return;

  const field = name => form.elements.namedItem(name);
  const errorElement = name => document.querySelector(`[data-error-for="${name}"]`);
  let referralReady = page !== 'register';

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

  function landingForRole(role) {
    return '/app';
  }

  function status(message, type = 'error') {
    formStatus.textContent = message;
    formStatus.className = `form-status show ${type}`;
  }

  function setBusy(busy) {
    submitButton.disabled = busy || !referralReady;
    submitButton.textContent = busy
      ? 'SEDANG DIPROSES...'
      : page === 'register' ? 'DAFTAR CLIENT' : 'MASUK KE ZENCORE';
  }

  function normalizePhone(value) {
    return String(value || '').trim().replace(/[\s()-]/g, '');
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
      if (!/^\+?\d{8,15}$/.test(payload.phone)) {
        errors.phone = 'Masukkan nombor telefon yang sah.';
      }
      if (!payload.ibCode) {
        errors.ibCode = 'Maklumat IB belum disahkan.';
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

  async function resolveIbAssignment() {
    if (page !== 'register') return;
    referralReady = false;
    setBusy(false);

    const params = new URLSearchParams(window.location.search);
    const raw = String(params.get('ib') || '').trim().toLowerCase();
    const requested = /^[a-z0-9][a-z0-9_-]{0,47}$/.test(raw) ? raw : '';
    const container = document.getElementById('ibAssignment');
    const name = document.getElementById('ibName');
    const notice = document.getElementById('ibNotice');

    try {
      if (!requested) {
        throw new Error('Link pendaftaran rasmi diperlukan.');
      }
      const response = await fetch(`/auth/referrer/${encodeURIComponent(requested)}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.referrer?.code ||
          body.referrer.fallback === true ||
          String(body.referrer.code).toLowerCase() !== requested) {
        throw new Error(body.error || 'Link pendaftaran tidak sah atau tidak aktif.');
      }
      field('ibCode').value = body.referrer.code;
      if (name) name.textContent = body.referrer.displayName;
      if (notice) {
        notice.textContent = `Kod IB: ${String(body.referrer.code).toUpperCase()} • Assignment ini tidak boleh diubah selepas daftar.`;
      }
      container?.classList.remove('loading');
      container?.classList.remove('fallback');
      referralReady = true;
      setBusy(false);
    } catch (_) {
      if (name) name.textContent = 'Link pendaftaran tidak sah';
      if (notice) notice.textContent = 'Minta link pendaftaran baharu daripada Admin atau IB anda.';
      container?.classList.remove('loading');
      container?.classList.add('error');
      status('Pendaftaran hanya melalui link rasmi Admin atau IB yang aktif.');
      referralReady = false;
      setBusy(false);
    }
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

    if (!referralReady) {
      status('Tunggu sehingga maklumat IB disahkan.');
      return;
    }

    const payload = {
      email: String(field('email')?.value || '').trim(),
      password: String(field('password')?.value || '')
    };
    if (page === 'register') {
      payload.displayName = String(field('displayName')?.value || '').trim();
      payload.phone = normalizePhone(field('phone')?.value);
      payload.ibCode = String(field('ibCode')?.value || '').trim().toLowerCase();
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
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        Object.entries(body.fields || {}).forEach(([name, message]) => fieldError(name, message));
        status(body.error || 'Permintaan tidak berjaya. Cuba semula.');
        return;
      }
      status(page === 'register' ? 'Pendaftaran client berjaya. Membuka ZenCore...' : 'Login berjaya.', 'success');
      window.setTimeout(() => { window.location.replace(landingForRole(body.user?.role)); }, 350);
    } catch (_) {
      status('Tidak dapat menghubungi ZenCore. Semak internet dan cuba semula.');
    } finally {
      setBusy(false);
    }
  });

  if (page === 'register') resolveIbAssignment();

  fetch('/auth/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(response => response.ok ? response.json() : null)
    .then(body => { if (body?.authenticated) window.location.replace(landingForRole(body.user?.role)); })
    .catch(() => {});
})();
