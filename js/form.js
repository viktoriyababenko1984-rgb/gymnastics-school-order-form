/* Форма заказа: маска телефона, валидация, черновик, отправка в Apps Script
 * (ТЗ, FR-18 – FR-27, EC-05 – EC-08, EC-12 – EC-17, EC-24). */
(function () {
  'use strict';

  const Shop = window.Shop;
  const { storage, cart, BRANCHES } = Shop;
  const DRAFT_KEY = 'skazka_form_v1';
  const NAME_RE = /^[A-Za-zА-Яа-яЁё]+(?:[ -][A-Za-zА-Яа-яЁё]+)*$/;

  /* ---------- Телефон ---------- */

  function phoneDigits(value) {
    let d = String(value).replace(/\D/g, '');
    if (d.startsWith('8')) d = '7' + d.slice(1);
    else if (d.startsWith('9')) d = '7' + d;
    return d.slice(0, 11);
  }

  function formatPhone(value) {
    const d = phoneDigits(value);
    if (!d) return '';
    const p = d.slice(1);
    let out = '+7';
    if (p.length) out += ' (' + p.slice(0, 3);
    if (p.length > 3) out += ') ' + p.slice(3, 6);
    if (p.length > 6) out += '-' + p.slice(6, 8);
    if (p.length > 8) out += '-' + p.slice(8, 10);
    return out;
  }

  const normalizeName = (v) => String(v).trim().replace(/\s+/g, ' ');

  /* ---------- Валидация ---------- */

  const validators = {
    childName(v) {
      const s = normalizeName(v);
      if (!s) return 'Укажите фамилию и имя ребёнка';
      if (s.length < 2 || s.length > 100 || !NAME_RE.test(s)) return 'Введите фамилию и имя буквами';
      return '';
    },
    phone(v) {
      const d = phoneDigits(v);
      return d.length === 11 && d[0] === '7' ? '' : 'Введите номер в формате +7 (XXX) XXX-XX-XX';
    },
    branch(v) {
      return BRANCHES.includes(v) ? '' : 'Выберите филиал';
    },
    consent(_v, el) {
      return el.checked ? '' : 'Необходимо согласие на обработку персональных данных';
    },
  };

  let form;
  let fields;
  let submitBtn;
  let errorBox;
  let sending = false;
  let pending = null; // { fingerprint, clientOrderId } — для повторной отправки того же заказа (EC-14)

  function setFieldError(name, message) {
    const el = fields[name];
    const err = form.querySelector(`[data-error-for="${name}"]`);
    el.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (err) err.textContent = message;
  }

  function validateField(name) {
    const el = fields[name];
    const message = validators[name](el.value, el);
    setFieldError(name, message);
    return !message;
  }

  function validateAll() {
    let firstInvalid = null;
    Object.keys(validators).forEach((name) => {
      if (!validateField(name) && !firstInvalid) firstInvalid = fields[name];
    });
    if (firstInvalid) {
      firstInvalid.focus({ preventScroll: true });
      firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return !firstInvalid;
  }

  /* ---------- Черновик ---------- */

  function saveDraft() {
    storage.write(DRAFT_KEY, {
      childName: fields.childName.value,
      phone: fields.phone.value,
      branch: fields.branch.value,
    });
  }

  function restoreDraft() {
    const d = storage.read(DRAFT_KEY);
    if (!d) return;
    if (typeof d.childName === 'string') fields.childName.value = d.childName.slice(0, 100);
    if (typeof d.phone === 'string') fields.phone.value = formatPhone(d.phone);
    if (BRANCHES.includes(d.branch)) fields.branch.value = d.branch;
  }

  /* ---------- Отправка ---------- */

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  }

  function buildPayload() {
    const customer = {
      childName: normalizeName(fields.childName.value),
      phone: '+' + phoneDigits(fields.phone.value),
      branch: fields.branch.value,
    };
    const items = cart.payloadItems();
    const fingerprint = JSON.stringify([customer, items]);
    if (!pending || pending.fingerprint !== fingerprint) pending = { fingerprint, clientOrderId: uuid() };
    return {
      clientOrderId: pending.clientOrderId,
      customer,
      items,
      clientTotal: cart.total(),
      website: form.elements.website.value,
    };
  }

  async function postOrder(payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Shop.REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(Shop.API_URL, {
        method: 'POST',
        // text/plain — «простой» запрос без CORS preflight (Apps Script не отвечает на OPTIONS)
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
        redirect: 'follow',
      });
      let data;
      try {
        data = await res.json();
      } catch (e) {
        throw Object.assign(new Error('bad json'), { kind: 'unavailable' });
      }
      return data;
    } catch (e) {
      if (e.kind) throw e;
      if (e.name === 'AbortError') throw Object.assign(e, { kind: 'timeout' });
      throw Object.assign(e, { kind: navigator.onLine === false ? 'offline' : 'network' });
    } finally {
      clearTimeout(timer);
    }
  }

  const ERROR_TEXT = {
    offline: 'Нет соединения с интернетом. Проверьте сеть и нажмите «Повторить».',
    network: 'Не удалось связаться с сервером. Проверьте интернет и нажмите «Повторить».',
    timeout: 'Сервер не отвечает. Попробуйте ещё раз.',
    unavailable: 'Сервис заказов временно недоступен. Попробуйте позже или позвоните администратору клуба.',
    LOCK_TIMEOUT: 'Сервер сейчас занят. Нажмите «Повторить».',
    SERVER_ERROR: 'Не удалось оформить заказ. Попробуйте позже или позвоните администратору клуба.',
    EMPTY_CART: 'Корзина пуста. Добавьте товары из каталога.',
  };

  function showError(text) {
    errorBox.querySelector('[data-error-text]').textContent = text;
    errorBox.hidden = false;
    Shop.ui.announce(text);
  }

  function setSending(state) {
    sending = state;
    submitBtn.classList.toggle('is-loading', state);
    submitBtn.setAttribute('aria-busy', String(state));
    updateSubmit();
  }

  function updateSubmit() {
    const empty = cart.isEmpty();
    submitBtn.disabled = empty || sending;
    submitBtn.querySelector('[data-submit-label]').textContent = sending
      ? 'Отправляем...'
      : empty
        ? 'Оформить заказ'
        : `Оформить заказ · ${Shop.formatPrice(cart.total())}`;
  }

  async function submit(e) {
    if (e) e.preventDefault();
    if (sending) return;
    errorBox.hidden = true;
    if (cart.isEmpty()) {
      showError(ERROR_TEXT.EMPTY_CART);
      return;
    }
    if (!validateAll()) return;

    const payload = buildPayload();
    const summary = {
      childName: payload.customer.childName,
      phone: formatPhone(payload.customer.phone),
      branch: payload.customer.branch,
      lines: cart.lines(),
      clientTotal: payload.clientTotal,
    };

    setSending(true);
    try {
      const res = await postOrder(payload);
      if (res && res.ok) {
        pending = null;
        cart.clear();
        form.reset();
        storage.remove(DRAFT_KEY);
        Object.keys(validators).forEach((n) => fields[n].removeAttribute('aria-invalid'));
        Shop.ui.showConfirmation({ ...summary, total: typeof res.total === 'number' ? res.total : summary.clientTotal });
      } else {
        const code = res && res.error;
        showError(
          code === 'VALIDATION_ERROR'
            ? `Не удалось оформить заказ. ${res.message || 'Проверьте данные.'}`
            : ERROR_TEXT[code] || ERROR_TEXT.SERVER_ERROR,
        );
      }
    } catch (err) {
      showError(ERROR_TEXT[err.kind] || ERROR_TEXT.network);
    } finally {
      setSending(false);
    }
  }

  /* ---------- Инициализация ---------- */

  function init() {
    form = document.getElementById('order-form');
    submitBtn = document.getElementById('submit-btn');
    errorBox = document.getElementById('submit-error');
    fields = {
      childName: form.elements.childName,
      phone: form.elements.phone,
      branch: form.elements.branch,
      consent: form.elements.consent,
    };

    BRANCHES.forEach((b) => fields.branch.add(new Option(b, b)));

    const policy = form.querySelector('[data-policy-link]');
    if (Shop.POLICY_URL) {
      policy.href = Shop.POLICY_URL;
      policy.target = '_blank';
      policy.rel = 'noopener';
    } else {
      policy.replaceWith(document.createTextNode(policy.textContent));
    }
    restoreDraft();

    fields.phone.addEventListener('input', () => {
      fields.phone.value = formatPhone(fields.phone.value);
    });

    Object.keys(validators).forEach((name) => {
      const el = fields[name];
      const evt = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'blur';
      el.addEventListener(evt, () => {
        validateField(name);
      });
      el.addEventListener('input', () => {
        if (el.getAttribute('aria-invalid') === 'true') validateField(name);
      });
    });

    form.addEventListener('input', saveDraft);
    form.addEventListener('change', saveDraft);
    form.addEventListener('submit', submit);
    document.getElementById('retry-btn').addEventListener('click', () => submit());

    cart.onChange(updateSubmit);
    updateSubmit();
  }

  Shop.form = { init, formatPhone, phoneDigits };
})();
