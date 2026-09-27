/* Рендер каталога и корзины, уведомления, окно подтверждения (ТЗ, разделы 3.1 – 3.3, 7). */
(function () {
  'use strict';

  const Shop = window.Shop;
  const { PRODUCTS, cart, formatPrice, MAX_QTY } = Shop;
  // Заглушка встроена в код: показывается, даже если не загрузился и сам файл заглушки (EC-18)
  const PLACEHOLDER =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#E5F7FE"/>' +
        '<g fill="none" stroke="#00B0F5" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity=".7">' +
        '<rect x="110" y="120" width="180" height="150" rx="16"/><circle cx="160" cy="170" r="18"/>' +
        '<path d="m120 255 55-55 40 40 25-25 50 50"/></g>' +
        '<text x="200" y="320" font-family="Arial,sans-serif" font-size="22" fill="#006B95" text-anchor="middle">Фото скоро появится</text></svg>',
    );

  /** Короткий помощник для создания элементов. Текст всегда через textContent (NFR-14). */
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === false) return;
      if (k === 'className') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    });
    children.flat().forEach((c) => c != null && node.append(c));
    return node;
  }

  function productImage(p, className) {
    const img = el('img', {
      className,
      src: p.image,
      alt: p.name,
      loading: 'lazy',
      decoding: 'async',
      width: 400,
      height: 400,
    });
    img.addEventListener('error', function onError() {
      img.removeEventListener('error', onError);
      img.src = PLACEHOLDER; // EC-18
    });
    return img;
  }

  /* ---------- Уведомления ---------- */

  const live = () => document.getElementById('live-region');
  let toastTimer;

  function announce(text) {
    const region = live();
    region.textContent = '';
    requestAnimationFrame(() => {
      region.textContent = text;
    });
  }

  function toast(text) {
    const box = document.getElementById('toast');
    box.textContent = text;
    box.hidden = false;
    box.classList.add('is-visible');
    announce(text);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      box.classList.remove('is-visible');
      setTimeout(() => {
        box.hidden = true;
      }, 250);
    }, 2600);
  }

  /* ---------- Каталог ---------- */

  function renderCard(p) {
    const errId = `size-err-${p.id}`;
    let select = null;
    let selectWrap = null;
    let err = null;

    if (p.sizes.length) {
      select = el(
        'select',
        { className: 'card__select', 'aria-label': `Размер: ${p.name}`, 'aria-describedby': errId },
        el('option', { value: '', disabled: true, selected: true, text: 'Выберите размер...' }),
        p.sizes.map((s) => el('option', { value: s, text: s })),
      );
      // Видимая подсказка поверх списка: на узких карточках переносится на 2 строки,
      // а сам select остаётся 16px (иначе iOS увеличивает страницу при фокусе).
      selectWrap = el(
        'div',
        { className: 'select' },
        select,
        el('span', { className: 'select__ph', 'aria-hidden': 'true', text: 'Выберите размер...' }),
      );
      err = el('p', { className: 'card__error', id: errId, text: '' });
      select.addEventListener('change', () => {
        selectWrap.classList.toggle('has-value', Boolean(select.value));
        select.removeAttribute('aria-invalid');
        err.textContent = '';
      });
    }

    // Цена и (для стартового набора) льготное условие
    const priceEl = el('p', { className: 'card__price' }, el('span', { className: 'card__price-now', text: formatPrice(p.price) }));
    let promo = null;
    let promoBox = null;
    if (p.discount) {
      const oldPrice = el('s', { className: 'card__price-old', text: formatPrice(p.price), hidden: true });
      priceEl.append(oldPrice);
      promo = el('input', { type: 'checkbox', className: 'promo__input' });
      promoBox = el(
        'div',
        { className: 'promo' },
        el(
          'p',
          { className: 'promo__badge' },
          el('strong', { text: formatPrice(p.discount.price) }),
          ` ${p.discount.condition}`,
        ),
        el('label', { className: 'promo__check' }, promo, el('span', { text: 'Первая неделя занятий' })),
      );
      promo.addEventListener('change', () => {
        priceEl.firstChild.textContent = formatPrice(promo.checked ? p.discount.price : p.price);
        priceEl.classList.toggle('is-promo', promo.checked);
        oldPrice.hidden = !promo.checked;
      });
    }

    const btn = el('button', { type: 'button', className: 'btn btn--dark card__btn', text: 'В корзину' });
    let resetTimer;
    btn.addEventListener('click', () => {
      if (select && !select.value) {
        select.setAttribute('aria-invalid', 'true');
        err.textContent = 'Пожалуйста, выберите размер';
        select.focus();
        return;
      }
      const result = cart.add(p.id, select ? select.value : null, Boolean(promo && promo.checked));
      if (result === 'max') {
        toast(`Максимум ${MAX_QTY} шт. одной позиции`);
        return;
      }
      btn.textContent = 'Добавлено ✓';
      btn.classList.add('is-added');
      announce(`${p.name} добавлен в корзину`);
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        btn.textContent = 'В корзину';
        btn.classList.remove('is-added');
      }, 1500);
    });

    return el(
      'article',
      { className: 'card' },
      el('div', { className: 'card__media' }, productImage(p, 'card__img')),
      el(
        'div',
        { className: 'card__body' },
        el('h3', { className: 'card__title', text: p.name }),
        priceEl,
        promoBox,
        selectWrap,
        err,
        btn,
      ),
    );
  }

  function renderCatalog() {
    const grid = document.getElementById('catalog-grid');
    grid.replaceChildren(...PRODUCTS.map(renderCard));
  }

  /* ---------- Корзина ---------- */

  function renderCartLine(line) {
    const { product: p, key, qty, size, sum } = line;
    return el(
      'li',
      { className: 'cart-item' },
      productImage(p, 'cart-item__img'),
      el(
        'div',
        { className: 'cart-item__info' },
        el('p', { className: 'cart-item__name', text: p.name }),
        size ? el('p', { className: 'cart-item__meta', text: `Размер: ${size}` }) : null,
        line.discount ? el('p', { className: 'cart-item__promo', text: `Цена: ${p.discount.condition}` }) : null,
        el('p', { className: 'cart-item__meta', text: `${formatPrice(line.price)} × ${qty}` }),
        el(
          'div',
          { className: 'cart-item__row' },
          el(
            'div',
            { className: 'qty', role: 'group', 'aria-label': `Количество: ${p.name}` },
            el('button', {
              type: 'button',
              className: 'qty__btn',
              'aria-label': 'Уменьшить количество',
              disabled: qty <= 1,
              text: '−',
              onclick: () => cart.setQty(key, qty - 1),
            }),
            el('span', { className: 'qty__value', 'aria-live': 'polite', text: String(qty) }),
            el('button', {
              type: 'button',
              className: 'qty__btn',
              'aria-label': 'Увеличить количество',
              disabled: qty >= MAX_QTY,
              text: '+',
              onclick: () => cart.setQty(key, qty + 1),
            }),
          ),
          el('span', { className: 'cart-item__sum', text: formatPrice(sum) }),
        ),
      ),
      el('button', {
        type: 'button',
        className: 'cart-item__remove',
        'aria-label': `Удалить: ${p.name}${size ? `, размер ${size}` : ''}`,
        text: '×',
        onclick: () => {
          cart.remove(key);
          announce(`${p.name} удалён из корзины`);
        },
      }),
    );
  }

  function pluralItems(n) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'товар';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'товара';
    return 'товаров';
  }

  function renderCart() {
    const list = document.getElementById('cart-list');
    const empty = document.getElementById('cart-empty');
    const footer = document.getElementById('cart-footer');
    const count = cart.count();

    list.replaceChildren(...cart.lines().map(renderCartLine));
    empty.hidden = count > 0;
    footer.hidden = count === 0;
    document.getElementById('cart-count').textContent = count ? `· ${count} ${pluralItems(count)}` : '';
    document.getElementById('cart-total').textContent = formatPrice(cart.total());

    const badge = document.getElementById('header-cart-badge');
    if (count > Number(badge.textContent)) {
      badge.classList.remove('is-bump');
      void badge.offsetWidth; // перезапуск анимации
      badge.classList.add('is-bump');
    }
    badge.textContent = String(count);
    badge.hidden = count === 0;
    document
      .getElementById('header-cart')
      .setAttribute('aria-label', count ? `Корзина: ${count} ${pluralItems(count)}` : 'Корзина пуста');
  }

  /* ---------- Окно подтверждения ---------- */

  let lastFocus = null;

  function showConfirmation(s) {
    const modal = document.getElementById('confirm-modal');
    const body = document.getElementById('confirm-body');
    const rows = s.lines.map((l) =>
      el('li', {
        text: `${l.product.name}${l.size ? `, ${l.size}` : ''}${l.discount ? ` (${l.product.discount.label.toLowerCase()})` : ''} — ${l.qty} шт.`,
      }),
    );
    const parts = [
      el('p', {}, el('span', { className: 'muted', text: 'Ребёнок: ' }), s.childName),
      el('p', {}, el('span', { className: 'muted', text: 'Филиал: ' }), s.branch),
      el('ul', { className: 'confirm__list' }, rows),
      el('p', { className: 'confirm__total' }, 'Итого: ', el('strong', { text: formatPrice(s.total) })),
      s.total !== s.clientTotal
        ? el('p', { className: 'confirm__note', text: 'Сумма пересчитана по актуальным ценам' })
        : null,
      el('p', { text: `Администратор клуба свяжется с вами по телефону ${s.phone}` }),
    ];
    body.replaceChildren(...parts.filter(Boolean));
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('no-scroll');
    document.getElementById('confirm-close').focus();
    announce('Спасибо! Заказ принят');
  }

  function closeConfirmation() {
    const modal = document.getElementById('confirm-modal');
    if (modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('no-scroll');
    document.getElementById('catalog').scrollIntoView({ behavior: 'smooth' });
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }

  function trapFocus(e) {
    const modal = document.getElementById('confirm-modal');
    if (modal.hidden) return;
    if (e.key === 'Escape') {
      closeConfirmation();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = modal.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* ---------- Старт ---------- */

  Shop.ui = { announce, toast, showConfirmation };

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('year').textContent = String(new Date().getFullYear());
    renderCatalog();

    cart.onChange(renderCart);
    const dropped = cart.load();
    renderCart();
    if (dropped) toast('Некоторые товары больше недоступны и удалены из корзины');

    Shop.form.init();

    document.getElementById('header-cart').addEventListener('click', () => {
      document.getElementById('checkout').scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('confirm-close').addEventListener('click', closeConfirmation);
    document.getElementById('confirm-modal').addEventListener('click', (e) => {
      if (e.target.id === 'confirm-modal') closeConfirmation();
    });
    document.addEventListener('keydown', trapFocus);

    // Шапка сливается с голубым блоком вверху страницы и отделяется при прокрутке
    const header = document.querySelector('.header');
    let ticking = false;
    const syncHeader = () => {
      header.classList.toggle('is-scrolled', window.scrollY > 8);
      ticking = false;
    };
    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(syncHeader);
        }
      },
      { passive: true },
    );
    syncHeader();
  });
})();
