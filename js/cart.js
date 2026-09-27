/* Корзина: состояние, localStorage, подписка на изменения (ТЗ, FR-12 – FR-17, EC-02 – EC-04, EC-09, EC-10). */
(function () {
  'use strict';

  const { storage, getProduct, MAX_QTY } = window.Shop;
  const STORAGE_KEY = 'skazka_cart_v1';

  let items = [];
  const listeners = [];

  const keyOf = (productId, size, discount) => `${productId}|${size ?? ''}|${discount ? 'd' : ''}`;

  /** Цена за единицу: льготная, если позиция добавлена со льготным условием. */
  const unitPrice = (p, discount) => (discount && p.discount ? p.discount.price : p.price);

  function isValidItem(it) {
    const p = it && getProduct(it.productId);
    if (!p) return false;
    if (it.discount && !p.discount) return false;
    if (p.sizes.length) return typeof it.size === 'string' && p.sizes.includes(it.size);
    return it.size === null || it.size === undefined || it.size === '';
  }

  /** Загружает корзину и возвращает true, если какие-то позиции пришлось удалить. */
  function load() {
    const saved = storage.read(STORAGE_KEY);
    const raw = saved && Array.isArray(saved.items) ? saved.items : [];
    const valid = raw.filter(isValidItem).map((it) => {
      const size = getProduct(it.productId).sizes.length ? it.size : null;
      const discount = Boolean(it.discount);
      const qty = Math.min(MAX_QTY, Math.max(1, parseInt(it.qty, 10) || 1));
      return { key: keyOf(it.productId, size, discount), productId: Number(it.productId), size, discount, qty };
    });
    items = valid;
    save();
    return valid.length !== raw.length;
  }

  function save() {
    storage.write(STORAGE_KEY, { version: 1, items });
    listeners.forEach((fn) => fn());
  }

  /** @returns {'added'|'max'} */
  function add(productId, size, discount = false) {
    const key = keyOf(productId, size, discount);
    const existing = items.find((it) => it.key === key);
    if (existing) {
      if (existing.qty >= MAX_QTY) return 'max';
      existing.qty += 1;
    } else {
      items.push({ key, productId, size: size || null, discount: Boolean(discount), qty: 1 });
    }
    save();
    return 'added';
  }

  function setQty(key, qty) {
    const it = items.find((i) => i.key === key);
    if (!it) return;
    it.qty = Math.min(MAX_QTY, Math.max(1, qty));
    save();
  }

  function remove(key) {
    items = items.filter((i) => i.key !== key);
    save();
  }

  function clear() {
    items = [];
    save();
  }

  function lines() {
    return items.map((it) => {
      const p = getProduct(it.productId);
      const price = unitPrice(p, it.discount);
      return { ...it, product: p, price, sum: price * it.qty };
    });
  }

  const count = () => items.reduce((s, i) => s + i.qty, 0);
  const total = () => lines().reduce((s, l) => s + l.sum, 0);

  window.Shop.cart = {
    load,
    add,
    setQty,
    remove,
    clear,
    lines,
    count,
    total,
    isEmpty: () => items.length === 0,
    payloadItems: () =>
      items.map(({ productId, size, discount, qty }) => (discount ? { productId, size, qty, discount } : { productId, size, qty })),
    onChange: (fn) => listeners.push(fn),
  };
})();
