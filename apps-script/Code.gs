/**
 * СКАЗКА — приём заказов магазина в Google Таблицу «Форма заявки».
 * ТЗ, раздел 6. Вставляется в «Расширения → Apps Script» этой таблицы.
 *
 * Лист «Лист1», СТРОГИЙ порядок колонок A–I:
 *   A Дата | B Филиал | C ФИ ребенка | D Наименование товара | E Размер |
 *   F Кол-во | G Цена | H Номер телефона родителя | I Сумма
 * Одна строка = одна позиция заказа.
 *
 * Настройка: один раз запустить setup() из редактора, затем
 * «Развернуть → Новое развертывание → Веб-приложение» (Выполнять от имени: Я; Доступ: Все).
 */

const SPREADSHEET_ID = '1CWMFQgbCeBuL-IMDX9UCMELKZDcZUhWJ-qAF3TAyaqA'; // «Форма заявки»
const SHEET_NAME = 'Лист1';
const TIME_ZONE = 'Asia/Yekaterinburg'; // Уфа, GMT+5
const DATE_FORMAT = 'dd.MM.yyyy HH:mm:ss';
const HEADERS = ['Дата', 'Филиал', 'ФИ ребенка', 'Наименование товара', 'Размер',
  'Кол-во', 'Цена', 'Номер телефона родителя', 'Сумма'];
const MAX_QTY = 10;
const MAX_ITEMS = 50;
const DEDUP_TTL_SEC = 21600; // 6 часов — максимум CacheService

// Серверная копия каталога: источник истины для названий, цен и размеров.
// Должна совпадать с js/data.js.
const CATALOG = {
  1: { name: 'Лонгслив детский черный «Сказка»', price: 1950,
    sizes: ['104-110', '116-122', '128-134', '140-146', '152-158'] },
  2: { name: 'Леггинсы детские черные «Solo»', price: 1500,
    sizes: ['26 (110-116)', '28 (116-122)', '30 (122-128)', '32 (128-134)', '34 (134-140)',
      '36 (140-146)', '38 (146-152)', '40 (152-158)', '42 (158-164)'] },
  3: { name: 'Получешки бежевые «Solo»', price: 700,
    sizes: ['28,5-29', '30-31', '31,5-32', '33-34', '34,5-35', '36-37'] },
  4: { name: 'Костюм детский синий «Love gymnastics» (бомбер + брюки)', price: 4900,
    sizes: ['104', '110', '116', '122', '128', '134', '140', '146', '152', '158', '164'] },
  5: { name: 'Футболка детская белая «Love gymnastics»', price: 1000,
    sizes: ['104-110', '116-122', '128-134', '152'] },
  6: { name: 'Шорты черные «Solo»', price: 950,
    sizes: ['32 (128-134)', '34 (134-140)', '36 (140-146)', '38 (146-152)', '40 (152-158)', '42 (158-164)'] },
  7: { name: 'Стартовый набор (рюкзак, бутылочка для воды, скакалка, «лист успеха»)', price: 2490, sizes: [],
    // Льготная цена при заказе в первую неделю занятий; в колонку «Размер» пишется пометка label
    discount: { price: 2190, label: 'Первая неделя занятий' } },
  8: { name: 'Рюкзак «Сказка»', price: 1590, sizes: [] },
  9: { name: 'Бутылочка для воды «Сказка» 400 мл', price: 790, sizes: [] },
  10: { name: 'Скакалка 3 метра', price: 590, sizes: [] },
  11: { name: 'Футболка белая оверсайз «Love gymnastics»', price: 2000, sizes: ['L (48-50)'] },
  12: { name: 'Худи синий «Love gymnastics»', price: 4850, sizes: ['Мини-оверсайз', 'Макси-оверсайз'] },
  13: { name: 'Брюки женские синие «Love gymnastics»', price: 3300, sizes: ['S', 'M', 'L'] },
};

const BRANCHES = ['ЦСП Мустафина', 'Затон', 'Садик 144', 'Дёма', 'ШВСМ', 'Башлицей 2',
  'Кузнецовский Затон', 'Медунивер', 'Новошкола', 'Динамо', 'Центр гимнастики', 'Дворец борьбы', 'Нефтяник'];

const NAME_RE = /^[A-Za-zА-Яа-яЁё]+(?:[ -][A-Za-zА-Яа-яЁё]+)*$/;
const PHONE_RE = /^\+7\d{10}$/;
const ORDER_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

function doPost(e) {
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    let data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return json({ ok: false, error: 'VALIDATION_ERROR', message: 'Некорректный формат запроса' });
    }
    if (data && data.website) return json({ ok: true, total: 0, rows: 0 }); // honeypot: бот, ничего не пишем

    if (!data || !Array.isArray(data.items) || data.items.length === 0) {
      return json({ ok: false, error: 'EMPTY_CART', message: 'Корзина пуста' });
    }
    const errors = validate(data);
    if (errors.length) return json({ ok: false, error: 'VALIDATION_ERROR', message: errors.join('; ') });

    locked = lock.tryLock(10000);
    if (!locked) return json({ ok: false, error: 'LOCK_TIMEOUT', message: 'Сервер занят, повторите' });

    // Защита от дублей: повторная отправка того же заказа
    const cache = CacheService.getScriptCache();
    const cacheKey = 'order_' + data.clientOrderId;
    const cached = cache.get(cacheKey);
    if (cached) return json(Object.assign(JSON.parse(cached), { duplicate: true }));

    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('Лист «' + SHEET_NAME + '» не найден');

    const now = new Date();
    const c = data.customer;
    const childName = normalizeName(c.childName);

    // СТРОГИЙ ПОРЯДОК КОЛОНОК A–I (ТЗ, раздел 6.3)
    const rows = mergeItems(data.items).map(function (it) {
      const p = CATALOG[it.productId];
      const price = it.discount ? p.discount.price : p.price;
      const sizeCell = it.discount ? p.discount.label : it.size ? "'" + it.size : '—';
      return [
        now,                              // A Дата
        c.branch,                         // B Филиал
        safe(childName),                  // C ФИ ребенка
        p.name,                           // D Наименование товара
        sizeCell,                         // E Размер (текстом, чтобы не стал датой) / пометка льготы
        it.qty,                           // F Кол-во
        price,                            // G Цена (за единицу)
        "'" + c.phone,                    // H Номер телефона родителя
        price * it.qty,                   // I Сумма (Кол-во × Цена)
      ];
    });

    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, HEADERS.length).setValues(rows);
    sheet.getRange(startRow, 1, rows.length, 1).setNumberFormat(DATE_FORMAT);
    SpreadsheetApp.flush();

    const total = rows.reduce(function (s, r) { return s + r[8]; }, 0);
    const result = { ok: true, total: total, rows: rows.length };
    cache.put(cacheKey, JSON.stringify(result), DEDUP_TTL_SEC);
    return json(result);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return json({ ok: false, error: 'SERVER_ERROR', message: 'Внутренняя ошибка сервера' });
  } finally {
    if (locked) lock.releaseLock();
  }
}

/** Проверка сервиса в браузере: открыть URL веб-приложения. */
function doGet() {
  return json({ ok: true, service: 'skazka-shop', message: 'Используйте POST для отправки заказа' });
}

function validate(data) {
  const errors = [];
  if (typeof data.clientOrderId !== 'string' || !ORDER_ID_RE.test(data.clientOrderId)) {
    errors.push('Некорректный идентификатор заказа');
  }
  const c = data.customer || {};
  const childName = normalizeName(c.childName);
  if (childName.length < 2 || childName.length > 100 || !NAME_RE.test(childName)) {
    errors.push('Введите фамилию и имя ребёнка буквами');
  }
  if (typeof c.phone !== 'string' || !PHONE_RE.test(c.phone)) {
    errors.push('Некорректный номер телефона');
  }
  if (BRANCHES.indexOf(c.branch) === -1) errors.push('Выберите филиал из списка');

  if (data.items.length > MAX_ITEMS) errors.push('Слишком много позиций в заказе');
  data.items.forEach(function (it, i) {
    const p = it && CATALOG[it.productId];
    if (!p) {
      errors.push('Позиция ' + (i + 1) + ': неизвестный товар');
      return;
    }
    if (p.sizes.length) {
      if (p.sizes.indexOf(it.size) === -1) errors.push('Неизвестный размер для товара «' + p.name + '»');
    } else if (it.size !== null && it.size !== undefined && it.size !== '') {
      errors.push('У товара «' + p.name + '» нет размеров');
    }
    if (it.discount !== undefined && it.discount !== false && !(it.discount === true && p.discount)) {
      errors.push('Для товара «' + p.name + '» льготная цена не предусмотрена');
    }
    if (!(Number.isInteger(it.qty) && it.qty >= 1 && it.qty <= MAX_QTY)) {
      errors.push('Количество для «' + p.name + '» должно быть от 1 до ' + MAX_QTY);
    }
  });
  return errors;
}

/** Объединяет одинаковые позиции (товар + размер), если клиент прислал их отдельно. */
function mergeItems(items) {
  const map = {};
  const order = [];
  items.forEach(function (it) {
    const size = CATALOG[it.productId].sizes.length ? it.size : null;
    const discount = it.discount === true;
    const key = it.productId + '|' + (size || '') + '|' + (discount ? 'd' : '');
    if (!map[key]) {
      map[key] = { productId: it.productId, size: size, discount: discount, qty: 0 };
      order.push(key);
    }
    map[key].qty = Math.min(MAX_QTY, map[key].qty + it.qty);
  });
  return order.map(function (k) { return map[k]; });
}

/**
 * Запускается ОДИН РАЗ вручную из редактора при настройке (ТЗ, раздел 6.6):
 * часовой пояс таблицы — Уфа, заголовок «Сумма» в I1.
 */
function setup() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Лист «' + SHEET_NAME + '» не найден');

  const current = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  for (let i = 0; i < 8; i++) {
    if (String(current[i]).trim() !== HEADERS[i]) {
      throw new Error('Колонка ' + (i + 1) + ': ожидается «' + HEADERS[i] + '», в таблице «' + current[i] + '». Ничего не изменено.');
    }
  }
  ss.setSpreadsheetTimeZone(TIME_ZONE);
  if (!current[8]) sheet.getRange(1, 9).setValue('Сумма');
  console.log('Готово: часовой пояс ' + ss.getSpreadsheetTimeZone() + ', I1 = «' + sheet.getRange(1, 9).getValue() + '»');
}

function normalizeName(v) {
  return String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
}

/** Защита от formula injection (ТЗ, NFR-14). */
function safe(v) {
  v = String(v).trim();
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
