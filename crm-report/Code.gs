/**
 * СКАЗКА — ежемесячный отчёт по спортсменам из SportCRM (skazka.start123.ru) в Google Таблицу.
 * Вставляется в «Расширения → Apps Script» отдельной таблицы «Отчёт CRM».
 *
 * Менеджеры работают только в CRM. Скрипт собирает отчёт за месяц в структуре
 * ручного отчёта менеджеров + колонки контроля и помечает подозрительные строки («Флаги»).
 * Исправления вносятся в CRM, после чего отчёт пересобирается.
 * Колонки «Проверено» и «Комментарий» заполняют люди — при пересборке они сохраняются.
 *
 * Настройка: меню «CRM-отчёт → Ввести ключ API» (ключ хранится в свойствах скрипта, не в коде),
 * затем «Проверка API» — лист «Тест API» покажет реальные поля и значения статусов.
 *
 * ВНИМАНИЕ: написано по документации API (OpenAPI 0.0.2), на живой CRM ещё не проверялось.
 * Значения, помеченные «ПРОВЕРИТЬ», — предположения; уточнить по листу «Тест API».
 */

const CFG = {
  BASE_URL: 'https://skazka.start123.ru',
  TIME_ZONE: 'Asia/Yekaterinburg', // Уфа, GMT+5
  ID_CHUNK: 100,                   // сколько ID передавать в одном фильтре
  // ПРОВЕРИТЬ: статусы посещения idLesson в документации не расшифрованы (y / n / t)
  ATTENDED_STATUSES: ['y'],
  // Если пробное занятие отмечается отдельным статусом — указать его (например 't').
  // Пусто: пробным считается самое первое посещение спортсмена.
  TRIAL_STATUS: '',
  // Какие занятия расписания считать при расчёте неполного месяца (cancel и repeat не считаются)
  SCHEDULE_COUNTED_STATUSES: ['plan', 'fact'],
  DEFAULT_LESSONS_PER_MONTH: 8,    // если у тарифа не заполнены priceamount / amount
  MONEY_TOLERANCE: 1,              // расхождение до 1 ₽ не считаем ошибкой
};

const API_KEY_PROP = 'CRM_API_KEY';
const MANUAL_COLS = ['Проверено', 'Комментарий'];
const HEADERS = [
  // структура ручного отчёта менеджеров
  'Дата', 'ФИО занимающегося', 'Выручка (сумма оказанных услуг)', 'Тип абонемента', 'Месяц',
  'Дата оплаты', 'Сумма оплаты', 'Номер заказа', 'Филиал', 'ФИО тренера', 'Команда/группа',
  'Сумма по договору', 'Отклонение',
  // контроль
  'Скидка', 'Статус спортсмена', 'Посещено в месяце', 'Дата пробного', 'Дата старта',
  'Занятий с даты старта', 'Ожидаемая выручка', 'Оплачено по начислению', 'Флаги',
  'Проверено', 'Комментарий', 'ID спортсмена', 'ID начисления', 'Ключ',
];
const DATE_COLS = ['Дата', 'Дата пробного', 'Дата старта'];
const MONEY_COLS = ['Выручка (сумма оказанных услуг)', 'Сумма оплаты', 'Сумма по договору', 'Отклонение',
  'Ожидаемая выручка', 'Оплачено по начислению'];

// ───────────────────────────── Меню ─────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi().createMenu('CRM-отчёт')
    .addItem('Собрать отчёт за месяц…', 'menuBuildReport')
    .addItem('Закрыть месяц…', 'menuCloseMonth')
    .addSeparator()
    .addItem('Включить ежедневную пересборку текущего месяца', 'installNightlyTrigger')
    .addItem('Проверка API', 'testApi')
    .addItem('Ввести ключ API', 'menuSetApiKey')
    .addToUi();
}

function menuSetApiKey() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Ключ API SportCRM',
    'Настройки CRM → блок «API». Ключ показывается один раз; он сохранится в свойствах скрипта.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = res.getResponseText().trim();
  if (!key) return;
  PropertiesService.getScriptProperties().setProperty(API_KEY_PROP, key);
  ui.alert('Ключ сохранён.');
}

function menuBuildReport() {
  const ym = askMonth_('Собрать отчёт', currentMonth_());
  if (!ym) return;
  const n = buildReport(ym);
  SpreadsheetApp.getUi().alert('Отчёт за ' + ym + ' собран: строк ' + n + '.');
}

function menuCloseMonth() {
  const ym = askMonth_('Закрыть месяц (сохранить итоговую копию)', previousMonth_(currentMonth_()));
  if (!ym) return;
  closeMonth(ym);
  SpreadsheetApp.getUi().alert('Создан лист «' + finalSheetName_(ym) + '».');
}

function askMonth_(title, def) {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(title, 'Месяц в формате ГГГГ-ММ (пусто — ' + def + ')', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return null;
  const ym = res.getResponseText().trim() || def;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) {
    ui.alert('Неверный формат: ' + ym);
    return null;
  }
  return ym;
}

/** Ежедневная пересборка текущего месяца в 06:xx — чтобы менеджеры видели флаги по ходу месяца. */
function installNightlyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'nightlyBuild'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('nightlyBuild').timeBased().everyDays(1).atHour(6).create();
  SpreadsheetApp.getUi().alert('Отчёт за текущий месяц будет пересобираться каждый день около 6 утра.');
}

function nightlyBuild() {
  buildReport(currentMonth_());
}

// ───────────────────────────── API ─────────────────────────────

/** Одна страница POST /rows (не более 200 строк). */
function fetchPage_(table, where, page, sord) {
  const key = PropertiesService.getScriptProperties().getProperty(API_KEY_PROP);
  if (!key) throw new Error('Не задан ключ API: меню «CRM-отчёт → Ввести ключ API»');
  const params = { table: table, page: page || 1 };
  if (where) params._where = JSON.stringify(where);
  if (sord) params.sord = sord;
  const url = CFG.BASE_URL + '/rows?' + Object.keys(params).map(function (k) {
    return k + '=' + encodeURIComponent(params[k]);
  }).join('&');
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + key },
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code !== 200) throw new Error('CRM ' + table + ': HTTP ' + code + ': ' + text.slice(0, 300));
  const data = JSON.parse(text);
  if (data.error) throw new Error('CRM ' + table + ': ' + data.error);
  return data;
}

/** Все строки таблицы по фильтру, со всех страниц. */
function apiRows_(table, where) {
  const rows = [];
  let page = 1;
  let total = 1;
  do {
    const data = fetchPage_(table, where, page);
    Array.prototype.push.apply(rows, data.rows || []);
    total = Number(data.total) || 1;
    page++;
  } while (page <= total);
  return rows;
}

/** Строки, у которых поле field входит в список ids (запросы порциями по CFG.ID_CHUNK). */
function apiRowsIn_(table, field, ids, extraWhere) {
  const uniq = unique_(ids).filter(function (x) { return x; });
  const rows = [];
  for (let i = 0; i < uniq.length; i += CFG.ID_CHUNK) {
    const where = Object.assign({}, extraWhere || {});
    where[field] = uniq.slice(i, i + CFG.ID_CHUNK);
    Array.prototype.push.apply(rows, apiRows_(table, where));
  }
  return rows;
}

function byId_(rows) {
  const m = {};
  rows.forEach(function (r) { m[r.id] = r; });
  return m;
}

// ───────────────────────────── Проверка API ─────────────────────────────

/**
 * Делает по одному запросу к каждой нужной таблице (последние записи) и пишет на лист «Тест API»:
 * число записей, список полей, примеры строк и встреченные значения статусов.
 */
function testApi() {
  const tables = ['idCity', 'idClub', 'idTrainer', 'idSquad', 'idInvoiceType', 'idSportsmen',
    'idSportsmenSquad', 'idInvoice', 'idPay', 'idSchedule', 'idLesson'];
  const statusFields = {
    idInvoice: ['status'], idPay: ['ptype'], idLesson: ['status'],
    idSchedule: ['status', 'stype'], idSportsmen: ['status', 'discount'],
  };
  const out = [['Таблица', 'Записей', 'Поля', 'Значения статусов (на последних 200 записях)', 'Пример 1', 'Пример 2', 'Пример 3']];
  tables.forEach(function (t) {
    try {
      const d = fetchPage_(t, null, 1, 'DESC');
      const rows = d.rows || [];
      const st = (statusFields[t] || []).map(function (f) {
        return f + ': ' + unique_(rows.map(function (r) { return String(r[f]); })).join(', ');
      }).join(' | ');
      out.push([t, d.records, d.field_names || Object.keys(rows[0] || {}).join(','), st]
        .concat([0, 1, 2].map(function (i) { return rows[i] ? JSON.stringify(rows[i]) : ''; })));
    } catch (err) {
      out.push([t, 'ОШИБКА', String(err.message || err), '', '', '', '']);
    }
  });
  const sh = getOrCreateSheet_('Тест API');
  sh.clear();
  sh.getRange(1, 1, out.length, out[0].length).setValues(out).setWrap(true).setVerticalAlignment('top');
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, out[0].length).setFontWeight('bold');
}

// ───────────────────────────── Отчёт ─────────────────────────────

/** Собирает лист «Отчёт ГГГГ-ММ». Возвращает число строк. */
function buildReport(ym) {
  const mr = monthRange_(ym);

  // Справочники
  const clubs = byId_(apiRows_('idClub'));
  const cities = byId_(apiRows_('idCity'));
  const trainers = byId_(apiRows_('idTrainer'));
  const squads = byId_(apiRows_('idSquad'));
  const invTypes = byId_(apiRows_('idInvoiceType'));

  // Начисления и платежи месяца
  const invoices = apiRows_('idInvoice', { 'dateinvoice:>=': mr.from, 'dateinvoice:<=': mr.to });
  const paysInMonth = apiRows_('idPay', { 'datepay:>=': mr.from, 'datepay:<=': mr.to });
  const paysByInvoice = groupBy_(apiRowsIn_('idPay', 'idinvoice', invoices.map(function (r) { return r.id; })), 'idinvoice');

  // Расписание и посещения месяца
  const schedMonth = apiRows_('idSchedule', schedRangeWhere_(mr));
  const schedules = byId_(schedMonth);
  const lessonsMonth = apiRowsIn_('idLesson', 'schedule', schedMonth.map(function (r) { return r.id; }));

  const sportsmenIds = unique_([].concat(
    invoices.map(function (r) { return r.sportsmen; }),
    paysInMonth.map(function (r) { return r.sportsmen; }),
    lessonsMonth.filter(isVisit_).map(function (r) { return r.sportsmen; })
  ).filter(function (x) { return x; }).map(String));
  const sportsmen = byId_(apiRowsIn_('idSportsmen', 'id', sportsmenIds));

  // История посещений — чтобы найти пробное занятие и дату старта
  const history = apiRowsIn_('idLesson', 'sportsmen', sportsmenIds).filter(isVisit_);
  const missingSched = history.map(function (l) { return l.schedule; }).filter(function (id) { return !schedules[id]; });
  apiRowsIn_('idSchedule', 'id', missingSched).forEach(function (s) { schedules[s.id] = s; });
  const visitsBySportsman = groupBy_(history.filter(function (l) { return schedules[l.schedule]; }), 'sportsmen');
  Object.keys(visitsBySportsman).forEach(function (sid) {
    visitsBySportsman[sid].sort(function (a, b) {
      return schedules[a.schedule].datestart < schedules[b.schedule].datestart ? -1 : 1;
    });
  });

  // Прошлый месяц — для тех, у кого старт был в прошлом месяце (проверка «перепутаны месяцы»)
  const pr = monthRange_(previousMonth_(ym));
  const starts = {};
  sportsmenIds.forEach(function (sid) { starts[sid] = trialAndStart_(visitsBySportsman[sid] || [], schedules); });
  const startedPrev = sportsmenIds.filter(function (sid) {
    const st = starts[sid].start;
    return st && inRange_(day_(schedules[st.schedule].datestart), pr);
  });
  let prevInvoices = {};
  let prevSched = [];
  if (startedPrev.length) {
    prevInvoices = groupBy_(apiRowsIn_('idInvoice', 'sportsmen', startedPrev,
      { 'dateinvoice:>=': pr.from, 'dateinvoice:<=': pr.to }), 'sportsmen');
    const prevSquads = startedPrev.map(function (sid) { return schedules[starts[sid].start.schedule].squad; });
    prevSched = apiRowsIn_('idSchedule', 'squad', prevSquads, schedRangeWhere_(pr));
  }

  const invBySportsman = groupBy_(invoices, 'sportsmen');
  const paysMonthBySportsman = groupBy_(paysInMonth, 'sportsmen');
  const lessonsMonthBySportsman = groupBy_(lessonsMonth.filter(isVisit_), 'sportsmen');

  const out = [];
  sportsmenIds.forEach(function (sid) {
    const sp = sportsmen[sid] || { id: sid, name: '(спортсмен ' + sid + ' не найден)' };
    const invs = invBySportsman[sid] || [];
    const monthVisits = lessonsMonthBySportsman[sid] || [];
    const ts = starts[sid];
    const trialDay = ts.trial ? day_(schedules[ts.trial.schedule].datestart) : '';
    const startDay = ts.start ? day_(schedules[ts.start.schedule].datestart) : '';
    const paidVisits = monthVisits.filter(function (l) { return !ts.trial || l.id !== ts.trial.id; });

    // Группа / тренер / зал — по занятиям месяца, иначе по карточке спортсмена
    const sched = mostFrequent_(monthVisits.map(function (l) { return schedules[l.schedule]; }), 'squad');
    const squadId = (sched && sched.squad) || sp.squad;
    const squad = squads[squadId] || {};
    const trainerId = (sched && sched.trainer) || squad.trainer || sp.trainer;
    const clubId = (sched && sched.club) || squad.club;
    // ПРОВЕРИТЬ: «Филиал» в отчёте менеджеров — это зал (idClub) или филиал (idCity)
    const branch = clubs[clubId] ? clubs[clubId].name : (cities[sp.city] ? cities[sp.city].name : '');

    const pm = paysMonthBySportsman[sid] || [];
    const rowsForSp = invs.length ? invs : [null];
    rowsForSp.forEach(function (inv, idx) {
      const flags = [];
      const type = inv ? (invTypes[inv.typeinvoice] || {}) : {};
      const price = num_(type.price);
      const sum = inv ? num_(inv.sum) : 0;
      const pays = idx === 0 ? pm : []; // платежи месяца показываем один раз на спортсмена
      const paidByInv = inv ? sumOf_(paysByInvoice[inv.id] || []) : 0;

      // Новичок: старт (первое посещение после пробного) в этом месяце
      let lessonsFromStart = '';
      let expected = '';
      if (inv && startDay && inRange_(startDay, mr) && price) {
        const n = countLessonsFrom_(schedMonth, schedules[ts.start.schedule].squad, startDay);
        lessonsFromStart = n;
        expected = expectedSum_(price, lessonsPerMonth_(type), n);
        if (Math.abs(expected - sum) > CFG.MONEY_TOLERANCE) {
          flags.push('Новичок с ' + fmtDay_(startDay) + ': ожидается ' + money_(expected) + ' (' + n +
            ' зан.), начислено ' + money_(sum));
        }
      }
      // Старт в прошлом месяце: проверяем начисление прошлого месяца и «перепутанные» месяцы
      if (inv && startedPrev.indexOf(sid) !== -1 && price) {
        const prevInv = (prevInvoices[sid] || [])[0];
        const nPrev = countLessonsFrom_(prevSched, schedules[ts.start.schedule].squad, startDay);
        const expPrev = expectedSum_(price, lessonsPerMonth_(type), nPrev);
        const prevSum = prevInv ? num_(prevInv.sum) : 0;
        if (Math.abs(expPrev - prevSum) > CFG.MONEY_TOLERANCE) {
          flags.push('Первый месяц (старт ' + fmtDay_(startDay) + '): было начислено ' + money_(prevSum) +
            ', ожидалось ' + money_(expPrev));
        }
        if (prevInv && Math.abs(prevSum - price) <= CFG.MONEY_TOLERANCE && sum < price - CFG.MONEY_TOLERANCE) {
          flags.push('Похоже, начисления первого и второго месяца перепутаны местами');
        }
      }
      if (!inv && paidVisits.length) flags.push('Есть посещения (' + paidVisits.length + '), нет начисления');
      if (!inv && pm.length) flags.push('Оплата без начисления в этом месяце (предоплата?)');
      if (inv && !monthVisits.length) flags.push('Начисление без посещений');
      if (invs.length > 1) flags.push('Несколько начислений за месяц (' + invs.length + ')');
      if (inv && sp.status === 'Архив') flags.push('Спортсмен в архиве, но есть начисление');
      if (inv && sum > 0 && !paidByInv) flags.push('Не оплачено');
      else if (inv && paidByInv < sum - CFG.MONEY_TOLERANCE) flags.push('Недоплата ' + money_(sum - paidByInv));
      else if (inv && paidByInv > sum + CFG.MONEY_TOLERANCE) flags.push('Переплата ' + money_(paidByInv - sum));
      if (inv && sp.discount && sp.discount !== '-') flags.push('Скидка ' + sp.discount + ' — проверить сумму');
      if (ts.trial && !ts.start && monthVisits.length) flags.push('Только пробное занятие');

      out.push([
        toDate_(mr.to),
        sp.name,
        inv ? sum : '',
        type.name || '',
        mr.m,
        pays.map(function (p) { return fmtDay_(p.datepay); }).join(', '),
        pays.length ? sumOf_(pays) : '',
        pays.map(function (p) { return p.numpay; }).filter(Boolean).join(', '), // ПРОВЕРИТЬ: «Номер заказа» = numpay?
        branch,
        trainers[trainerId] ? trainers[trainerId].name : '',
        squad.name || '',
        price || '',
        price && inv ? price - sum : '', // ПРОВЕРИТЬ формулу «Отклонения»
        sp.discount || '',
        sp.status || '',
        monthVisits.length,
        trialDay ? toDate_(trialDay) : '',
        startDay ? toDate_(startDay) : '',
        lessonsFromStart,
        expected,
        inv ? paidByInv : '',
        flags.join('; '),
        '', '', // Проверено, Комментарий — заполняют люди
        sid,
        inv ? inv.id : '',
        inv ? 'i' + inv.id : 's' + sid,
      ]);
    });
  });

  out.sort(function (a, b) {
    return String(a[9]).localeCompare(String(b[9]), 'ru') || String(a[10]).localeCompare(String(b[10]), 'ru') ||
      String(a[1]).localeCompare(String(b[1]), 'ru');
  });
  writeReport_(reportSheetName_(ym), out);
  return out.length;
}

/** Пробное занятие и первое посещение после него (дата старта). Визиты отсортированы по дате. */
function trialAndStart_(visits, schedules) {
  if (!visits.length) return { trial: null, start: null };
  if (CFG.TRIAL_STATUS) {
    const trial = visits.filter(function (l) { return l.status === CFG.TRIAL_STATUS; })[0] || null;
    const start = visits.filter(function (l) {
      return l.status !== CFG.TRIAL_STATUS &&
        (!trial || schedules[l.schedule].datestart > schedules[trial.schedule].datestart);
    })[0] || null;
    return { trial: trial, start: start };
  }
  return { trial: visits[0], start: visits[1] || null };
}

/** Сколько занятий группы squadId по расписанию с дня startDay (включительно) в переданном наборе. */
function countLessonsFrom_(scheds, squadId, startDay) {
  return scheds.filter(function (s) {
    return String(s.squad) === String(squadId) && CFG.SCHEDULE_COUNTED_STATUSES.indexOf(s.status) !== -1 &&
      day_(s.datestart) >= startDay;
  }).length;
}

function lessonsPerMonth_(type) {
  return Number(type.priceamount) || Number(type.amount) || CFG.DEFAULT_LESSONS_PER_MONTH;
}

/** Сумма по договору ÷ занятий в месяц × занятий с даты старта, не больше полной суммы. */
function expectedSum_(price, perMonth, n) {
  return Math.min(price, Math.round(price / perMonth * n));
}

function isVisit_(l) {
  return CFG.ATTENDED_STATUSES.indexOf(l.status) !== -1 || (CFG.TRIAL_STATUS && l.status === CFG.TRIAL_STATUS);
}

function schedRangeWhere_(mr) {
  return { 'datestart:>=': mr.from + ' 00:00:00', 'datestart:<=': mr.to + ' 23:59:59' };
}

// ───────────────────────────── Листы ─────────────────────────────

function reportSheetName_(ym) { return 'Отчёт ' + ym; }
function finalSheetName_(ym) { return 'Итог ' + ym; }

/** Перезаписывает лист отчёта, сохраняя ручные колонки «Проверено» и «Комментарий» по ключу строки. */
function writeReport_(name, rows) {
  const sh = getOrCreateSheet_(name);
  const keyCol = HEADERS.indexOf('Ключ');
  const manualIdx = MANUAL_COLS.map(function (h) { return HEADERS.indexOf(h); });

  const saved = {};
  if (sh.getLastRow() > 1) {
    const old = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    const oh = old[0];
    const ok = oh.indexOf('Ключ');
    const om = MANUAL_COLS.map(function (h) { return oh.indexOf(h); });
    if (ok !== -1) {
      old.slice(1).forEach(function (r) {
        saved[r[ok]] = om.map(function (i) { return i === -1 ? '' : r[i]; });
      });
    }
  }
  rows.forEach(function (r) {
    const s = saved[r[keyCol]];
    if (s) manualIdx.forEach(function (i, j) { r[i] = s[j]; });
  });

  if (sh.getFilter()) sh.getFilter().remove();
  sh.clear();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setWrap(true);
  sh.setFrozenRows(1);
  if (!rows.length) return;
  sh.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  DATE_COLS.forEach(function (h) {
    sh.getRange(2, HEADERS.indexOf(h) + 1, rows.length, 1).setNumberFormat('dd.mm.yyyy');
  });
  MONEY_COLS.forEach(function (h) {
    sh.getRange(2, HEADERS.indexOf(h) + 1, rows.length, 1).setNumberFormat('#,##0.00');
  });
  const flagCol = HEADERS.indexOf('Флаги');
  const bg = rows.map(function (r) { return [r[flagCol] ? '#fde2e1' : null]; });
  sh.getRange(2, flagCol + 1, rows.length, 1).setBackgrounds(bg);
  sh.getRange(1, 1, rows.length + 1, HEADERS.length).createFilter();
}

/** Сохраняет итоговую копию отчёта за месяц (значения) и защищает её от правок. */
function closeMonth(ym) {
  const ss = SpreadsheetApp.getActive();
  const src = ss.getSheetByName(reportSheetName_(ym));
  if (!src) throw new Error('Нет листа «' + reportSheetName_(ym) + '» — сначала соберите отчёт');
  const old = ss.getSheetByName(finalSheetName_(ym));
  if (old) throw new Error('Лист «' + finalSheetName_(ym) + '» уже есть. Удалите его вручную, если нужно закрыть месяц заново.');
  const copy = src.copyTo(ss).setName(finalSheetName_(ym));
  copy.protect().setDescription('Итог ' + ym + ' (закрыт ' +
    Utilities.formatDate(new Date(), CFG.TIME_ZONE, 'dd.MM.yyyy HH:mm') + ')').setWarningOnly(true);
}

function getOrCreateSheet_(name) {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// ───────────────────────────── Даты и мелочи ─────────────────────────────

function currentMonth_() {
  return Utilities.formatDate(new Date(), CFG.TIME_ZONE, 'yyyy-MM');
}

function previousMonth_(ym) {
  const p = ym.split('-').map(Number);
  const d = new Date(p[0], p[1] - 2, 1);
  return d.getFullYear() + '-' + pad_(d.getMonth() + 1);
}

function monthRange_(ym) {
  const p = ym.split('-').map(Number);
  const last = new Date(p[0], p[1], 0).getDate();
  return { y: p[0], m: p[1], from: ym + '-01', to: ym + '-' + pad_(last) };
}

function inRange_(day, mr) { return day >= mr.from && day <= mr.to; }
function day_(s) { return String(s || '').slice(0, 10); }
function pad_(n) { return (n < 10 ? '0' : '') + n; }

function toDate_(day) {
  const p = day.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function fmtDay_(s) {
  const d = day_(s);
  return d ? d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) : '';
}

function num_(s) {
  const n = parseFloat(String(s == null ? '' : s).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function money_(n) { return Math.round(n) + ' ₽'; }

function sumOf_(rows) {
  return rows.reduce(function (s, r) { return s + num_(r.sum); }, 0);
}

function unique_(arr) {
  const seen = {};
  return arr.filter(function (x) {
    const k = String(x);
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
}

function groupBy_(rows, field) {
  const m = {};
  rows.forEach(function (r) { (m[r[field]] = m[r[field]] || []).push(r); });
  return m;
}

/** Строка с самым частым значением поля field (например, основная группа за месяц). */
function mostFrequent_(rows, field) {
  const cnt = {};
  let best = null;
  rows.filter(Boolean).forEach(function (r) {
    cnt[r[field]] = (cnt[r[field]] || 0) + 1;
    if (!best || cnt[r[field]] > cnt[best[field]]) best = r;
  });
  return best;
}
