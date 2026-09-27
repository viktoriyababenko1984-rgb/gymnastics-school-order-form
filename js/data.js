/* Каталог, филиалы и настройки магазина.
 * Цены и размеры меняются ТОЛЬКО здесь и в копии CATALOG в apps-script/Code.gs (ТЗ, NFR-19). */
(function () {
  'use strict';

  // URL веб-приложения Apps Script (ТЗ, раздел 6.6, шаг 5).
  const API_URL = 'https://script.google.com/macros/s/PASTE_DEPLOYMENT_ID_HERE/exec';

  // Ссылка на политику обработки персональных данных (ТЗ, раздел 12). Пусто — выводится текст без ссылки.
  const POLICY_URL = '';

  const PRODUCTS = [
    { id: 1, name: 'Лонгслив детский черный «Сказка»', price: 1950,
      sizes: ['104-110', '116-122', '128-134', '140-146', '152-158'] },
    { id: 2, name: 'Леггинсы детские черные «Solo»', price: 1500,
      sizes: ['26 (110-116)', '28 (116-122)', '30 (122-128)', '32 (128-134)', '34 (134-140)',
        '36 (140-146)', '38 (146-152)', '40 (152-158)', '42 (158-164)'] },
    { id: 3, name: 'Получешки бежевые «Solo»', price: 700,
      sizes: ['28,5-29', '30-31', '31,5-32', '33-34', '34,5-35', '36-37'] },
    { id: 4, name: 'Костюм детский синий «Love gymnastics» (бомбер + брюки)', price: 4900,
      sizes: ['104', '110', '116', '122', '128', '134', '140', '146', '152', '158', '164'] },
    { id: 5, name: 'Футболка детская белая «Love gymnastics»', price: 1000,
      sizes: ['104-110', '116-122', '128-134', '152'] },
    { id: 6, name: 'Шорты черные «Solo»', price: 950,
      sizes: ['32 (128-134)', '34 (134-140)', '36 (140-146)', '38 (146-152)', '40 (152-158)', '42 (158-164)'] },
    { id: 7, name: 'Стартовый набор (рюкзак, бутылочка для воды, скакалка, «лист успеха»)', price: 2490, sizes: [] },
    { id: 8, name: 'Рюкзак «Сказка»', price: 1590, sizes: [] },
    { id: 9, name: 'Бутылочка для воды «Сказка» 400 мл', price: 790, sizes: [] },
    { id: 10, name: 'Скакалка 3 метра', price: 590, sizes: [] },
    { id: 11, name: 'Футболка белая оверсайз «Love gymnastics»', price: 2000, sizes: ['L (48-50)'] },
    { id: 12, name: 'Худи синий «Love gymnastics»', price: 4850, sizes: ['Мини-оверсайз', 'Макси-оверсайз'] },
    { id: 13, name: 'Брюки женские синие «Love gymnastics»', price: 3300, sizes: ['S', 'M', 'L'] },
  ].map((p) => Object.freeze({ ...p, sizes: Object.freeze(p.sizes), image: `images/${p.id}.jpg` }));

  const BRANCHES = [
    'ЦСП Мустафина', 'Затон', 'Садик 144', 'Дёма', 'ШВСМ', 'Башлицей 2',
    'Кузнецовский Затон', 'Медунивер', 'Новошкола', 'Динамо',
    'Центр гимнастики', 'Дворец борьбы', 'Нефтяник',
  ];

  const byId = new Map(PRODUCTS.map((p) => [p.id, p]));

  window.Shop = window.Shop || {};
  Object.assign(window.Shop, {
    API_URL,
    POLICY_URL,
    PRODUCTS,
    BRANCHES,
    MAX_QTY: 10,
    REQUEST_TIMEOUT_MS: 15000,
    getProduct: (id) => byId.get(Number(id)),
    formatPrice: (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₽`,
  });
})();
