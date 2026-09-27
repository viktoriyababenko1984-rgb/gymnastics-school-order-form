/* Безопасная обёртка над localStorage (ТЗ, EC-11): приватный режим, квота, битый JSON. */
(function () {
  'use strict';

  function read(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      remove(key);
      return null;
    }
  }

  function write(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* хранилище недоступно — работаем в памяти */
    }
  }

  function remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      /* ignore */
    }
  }

  window.Shop.storage = { read, write, remove };
})();
