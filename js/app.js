/* Сынақ — приложение (без сервера: всё хранится в браузере пользователя). */
(function () {
  'use strict';
  const C = window.SYNAQ_CONFIG, G = window.SynaqGen;
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app');
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } },
  };
  const K = { access: 'synaq_access', run: 'synaq_run', hist: 'synaq_history', subj: 'synaq_subject', pay: 'synaq_pay' };
  const ORDER = ['math', 'physics', 'informatics', 'chemistry', 'biology', 'geography'];
  const SUBJ = {}; ORDER.concat(Object.keys(G.SUBJECTS)).forEach((k) => { if (G.SUBJECTS[k] && !SUBJ[k]) SUBJ[k] = G.SUBJECTS[k].name; });
  const NS = Object.keys(SUBJ).length, ALLV = NS * C.variantsCount;
  const subjList = Object.values(SUBJ).map((n) => n.toLowerCase()).join(', ');
  const TYPE = { single: 'Один ответ', context: 'Контекстное', match: 'Соответствие', multi: 'Несколько ответов' };
  const L = ['A', 'B', 'C', 'D', 'E', 'F'];
  const money = (n) => n.toLocaleString('ru-RU').replace(/,/g, ' ') + ' ₸';
  const waLink = (text) => `https://wa.me/${C.whatsapp}?text=${encodeURIComponent(text)}`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let timerId = null;

  // ---------- доступ ----------
  const hasAccess = () => !!LS.get(K.access, null);
  const isFree = (v) => C.freeVariants.includes(Number(v));
  const canOpen = (v) => isFree(v) || hasAccess();
  async function sha(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  function normCode(s) {
    let c = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.startsWith('SNQ')) c = c.slice(3);
    return c.length === 8 ? `SNQ-${c.slice(0, 4)}-${c.slice(4)}` : null;
  }
  async function activate(raw) {
    const code = normCode(raw); if (!code) return false;
    const h = (await sha(C.salt + code)).slice(0, 24);
    if (C.accessHashes.includes(h)) { LS.set(K.access, { code, at: Date.now() }); return true; }
    if (!C.payApi) return false;
    const r = await api({ action: 'code', code });
    if (r.ok) { LS.set(K.access, { code, at: Date.now(), via: 'kaspi' }); return true; }
    if (r.reason === 'limit') throw new Error('limit');
    return false;
  }

  // ---------- оплата: заявка -> подтверждение владельцем в Telegram -> доступ ----------
  async function api(body) {
    const r = await fetch(C.payApi, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json().catch(() => ({}));
  }
  const rnd = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : rnd(16).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'));
  const pending = () => LS.get(K.pay, null);

  // ---------- анонимная статистика заходов (случайный id в браузере, без имён и IP) ----------
  const DNT = navigator.doNotTrack === '1' || window.doNotTrack === '1';
  function vid() { let v = LS.get('synaq_vid', null); if (!v) { v = rnd(12); LS.set('synaq_vid', v); } return v; }
  function source() {
    const q = (new URLSearchParams(location.search).get('s') || '').toLowerCase();
    if (q) return q;
    let h = ''; try { h = new URL(document.referrer).hostname; } catch (e) { /* пусто */ }
    if (!h || h === location.hostname) return 'direct';
    if (/tiktok/.test(h)) return 'tt'; if (/instagram/.test(h)) return 'ig'; if (/(^|\.)t\.me$|telegram/.test(h)) return 'tg';
    if (/whatsapp|wa\.me/.test(h)) return 'wa'; if (/google/.test(h)) return 'google'; if (/youtube|youtu\.be/.test(h)) return 'yt';
    return 'other';
  }
  const SRC0 = source();
  const sent = {};
  function track(ev) {
    if (DNT || !C.payApi || sent[ev]) return; sent[ev] = 1;
    try { fetch(C.payApi, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'hit', vid: vid(), src: SRC0, ev }) }).catch(() => {}); } catch (e) { /* не мешаем сайту */ }
  }

  let payTimer = null;
  async function checkPay(silent) {
    const p = pending(); if (!p || hasAccess()) return;
    let r; try { r = await api({ action: 'status', id: p.id, secret: p.secret }); } catch (e) { return; }
    if (r.status === 'approved') {
      LS.set(K.access, { code: r.code, at: Date.now(), via: 'kaspi' }); LS.del(K.pay);
      refreshHeader(); route();
      openModal(`<h3>✅ Доступ открыт!</h3><p>Оплата подтверждена. Все ${ALLV} вариантов по ${NS} предметам открыты.</p>
        <p class="muted" style="margin-bottom:4px">Ваш код — сохраните его, чтобы открыть доступ на другом телефоне:</p>
        <div class="kaspi"><span>${esc(r.code)}</span><button class="btn btn-sm btn-ghost" id="copyCode">Копировать</button></div>
        <a class="btn btn-block mt" href="#/tests" data-close>К тестам</a>`);
      $('#copyCode').onclick = () => navigator.clipboard?.writeText(r.code).then(() => toast('Код скопирован'));
    } else if (r.status === 'rejected' || r.status === 'unknown') {
      LS.del(K.pay); refreshHeader();
      if (!silent || r.status === 'rejected') openModal(`<h3>Оплата не найдена</h3><p class="muted">Мы не нашли перевод от «${esc(p.name)}». Проверьте, что перевели ${money(C.price)} на ${esc(C.kaspiPhone)}, и отправьте заявку ещё раз. Если деньги списались — напишите нам в WhatsApp, разберёмся.</p>
        <a class="btn btn-ok btn-block mt" href="${waLink(`Здравствуйте! Оплатил(а) «Сынақ» ${C.price} ₸ от имени «${p.name}», но доступ не открылся.`)}" target="_blank" rel="noopener">Написать в WhatsApp</a>
        <button class="btn btn-ghost btn-block mt" data-pay>Отправить заявку ещё раз</button>`);
      $('#modalBody [data-pay]')?.addEventListener('click', () => paywall());
    }
  }
  function waitScreen() {
    const p = pending();
    openModal(`<h3>⏳ Проверяем оплату</h3><p>Заявка от <b>${esc(p.name)}</b> на ${money(C.price)} отправлена. Обычно проверка занимает несколько минут, иногда дольше — например, ночью.</p>
      <p class="muted">Можно закрыть это окно и решать бесплатный вариант: доступ откроется сам, как только оплату подтвердят.</p>
      <div class="spin"></div>
      <a class="btn btn-ghost btn-block mt" href="${waLink(`Здравствуйте! Оплатил(а) «Сынақ» ${C.price} ₸ от имени «${p.name}». Жду доступ.`)}" target="_blank" rel="noopener">Долго? Написать в WhatsApp</a>`);
  }
  function startPayWatch() {
    clearInterval(payTimer);
    if (!pending() || hasAccess()) return;
    checkPay(true);
    payTimer = setInterval(() => { if (!pending() || hasAccess()) return clearInterval(payTimer); checkPay(true); }, 6000);
  }

  // ---------- UI helpers ----------
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600); }
  function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').hidden = false; }
  function closeModal() { $('#modal').hidden = true; }
  $('#modal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  function refreshHeader() {
    const b = $('#accessBtn');
    if (hasAccess()) { b.textContent = '✓ Доступ открыт'; b.className = 'btn btn-sm btn-ghost'; }
    else if (pending()) { b.textContent = '⏳ Проверяем оплату'; b.className = 'btn btn-sm btn-ghost'; }
    else { b.textContent = 'Полный доступ'; b.className = 'btn btn-sm btn-accent'; }
  }
  $('#accessBtn').addEventListener('click', () => (hasAccess() ? accessInfo() : pending() ? waitScreen() : paywall()));
  $('#footerWa').href = waLink('Здравствуйте! Вопрос по тренажёру «Сынақ».');

  function accessInfo() {
    const a = LS.get(K.access, {});
    openModal(`<h3>Полный доступ открыт</h3><p class="muted">Код ${esc(a.code || '')} активирован на этом устройстве. Доступны все ${ALLV} вариантов (${C.variantsCount} по каждому из ${NS} предметов) и случайные варианты.</p>
      <p class="muted">Сменили телефон или браузер? Просто введите тот же код ещё раз.</p><a class="btn btn-block mt" href="#/tests" data-close>К тестам</a>`);
  }

  function paywall(reason) {
    track('paywall');
    if (pending() && !hasAccess()) return waitScreen();
    openModal(`
      <h3>Полный доступ — ${money(C.price)}${C.priceOld ? ` <s class="muted" style="font-size:16px;font-weight:500">${money(C.priceOld)}</s>` : ''}</h3>
      <p class="muted" style="margin:0">${reason ? esc(reason) + ' ' : ''}Разовая оплата, без подписки. Действует до ЕНТ-2027.</p>
      <ul class="ticks">
        <li>${NS} предметов: ${subjList}</li>
        <li>${ALLV} вариантов — по ${C.variantsCount} на каждый предмет, по 40 заданий</li>
        <li>Безлимитные случайные варианты: каждый раз новый набор заданий</li>
        <li>Разбор каждого задания с решением</li>
        <li>История результатов и прогресс</li>
      </ul>
      <ol class="steps">
        <li>Переведите <b>${money(C.price)}</b> через Kaspi по номеру:
          <div class="kaspi"><span>${esc(C.kaspiPhone)}</span><button class="btn btn-sm btn-ghost" id="copyPhone">Копировать</button></div></li>
        <li>Напишите имя, с которого переводили — как в Kaspi (например, «Айдана С.»):
          <input class="input mt" id="payName" style="text-transform:none" placeholder="Имя и первая буква фамилии" autocomplete="name" maxlength="40">
          <div class="err" id="payErr"></div>
          <button class="btn btn-ok btn-block" id="payBtn">Я оплатил(а)</button>
          <div class="muted" style="font-size:14px;margin-top:6px">Доступ откроется на этом устройстве автоматически, как только оплату подтвердят.</div></li>
      </ol>
      <details class="faq"><summary>У меня уже есть код</summary>
        <input class="input mt" id="codeIn" placeholder="SNQ-XXXX-XXXX" autocomplete="off" inputmode="latin">
        <div class="err" id="codeErr"></div>
        <button class="btn btn-block" id="codeBtn">Активировать</button></details>
      <p class="muted" style="font-size:14px;margin:10px 0 0">Вопросы — <a href="${waLink('Здравствуйте! Вопрос по оплате «Сынақ».')}" target="_blank" rel="noopener">WhatsApp</a></p>`);
    $('#copyPhone').onclick = () => { navigator.clipboard?.writeText(C.kaspiPhone.replace(/\s/g, '')).then(() => toast('Номер скопирован'), () => toast(C.kaspiPhone)); };
    $('#payBtn').onclick = async () => {
      const name = $('#payName').value.replace(/\s+/g, ' ').trim();
      if (name.length < 2) { $('#payErr').textContent = 'Напишите имя отправителя, как оно видно в Kaspi.'; return; }
      const btn = $('#payBtn'); btn.disabled = true; $('#payErr').textContent = '';
      const p = { id: uuid(), secret: rnd(16), name, at: Date.now() };
      try {
        const r = await api({ action: 'request', id: p.id, secret: p.secret, name });
        if (!r.ok) throw new Error(r.error || 'fail');
      } catch (e) {
        btn.disabled = false;
        $('#payErr').innerHTML = `Не получилось отправить заявку. Проверьте интернет или <a href="${waLink(`Здравствуйте! Оплатил(а) «Сынақ» ${C.price} ₸ от имени «${name}».`)}" target="_blank" rel="noopener">напишите в WhatsApp</a>.`;
        return;
      }
      LS.set(K.pay, p); track('pay'); refreshHeader(); waitScreen(); startPayWatch();
    };
    const go = async () => {
      const btn = $('#codeBtn'); btn.disabled = true; $('#codeErr').textContent = '';
      let ok = false;
      try { ok = await activate($('#codeIn').value); }
      catch (e) { $('#codeErr').textContent = e.message === 'limit' ? 'Этот код уже активирован на нескольких устройствах. Напишите нам в WhatsApp.' : 'Не получилось проверить код. Проверьте интернет и попробуйте ещё раз.'; btn.disabled = false; return; }
      btn.disabled = false;
      if (!ok) { $('#codeErr').textContent = 'Код не найден. Проверьте, что ввели его без ошибок.'; return; }
      closeModal(); refreshHeader(); toast('Готово! Все варианты открыты'); route();
    };
    $('#codeBtn').onclick = go;
    $('#codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  // ---------- история ----------
  const history = () => LS.get(K.hist, []);
  function bestFor(subject, variant) {
    const h = history().filter((x) => x.subject === subject && String(x.variant) === String(variant));
    return h.length ? Math.max(...h.map((x) => x.score)) : null;
  }

  // ---------- страницы ----------
  function pageHome() {
    const ex = G.buildVariant('math', 1).questions[0];
    app.innerHTML = `
    <section class="hero"><div class="wrap hero-grid">
      <div>
        <h1>Пробный ЕНТ по <em>профильным предметам</em> — как на настоящем</h1>
        <p class="lead">${Object.values(SUBJ).join(', ')}. 40 заданий в формате ЕНТ, баллы из 50, таймер и разбор каждой ошибки. Узнайте свой балл сегодня, а не в день экзамена.</p>
        <div class="cta-row">
          <a class="btn btn-lg" href="#/tests">Пройти бесплатно</a>
          <button class="btn btn-lg btn-ghost" data-pay>Полный доступ — ${money(C.price)}</button>
        </div>
        <div class="chips"><span class="chip">${NS} предметов</span><span class="chip">25 + 5 + 5 + 5 заданий</span><span class="chip">Максимум 50 баллов</span><span class="chip">Таймер ${C.durationMin} мин</span><span class="chip">Работает с телефона</span></div>
      </div>
      <div class="mock" aria-hidden="true">
        <div class="mock-top"><span>Математика · Вариант 1</span><span>⏱ 68:12</span></div>
        <div class="mock-q">1. ${ex.text}</div>
        ${ex.options.map((o, i) => `<div class="mock-opt ${i === ex.answer ? 'sel' : ''}">${L[i]}) ${o}</div>`).join('')}
        <div class="mock-exp"><b>Разбор:</b> ${ex.explain}</div>
      </div>
    </div></section>

    <section class="section"><div class="wrap">
      <h2>Почему «Сынақ»</h2><p class="sub">Тренируйтесь в том же формате, что и на экзамене. Тогда в день ЕНТ ничего не застанет врасплох.</p>
      <div class="grid3">
        <div class="card"><div class="icon">🎯</div><h3>Формат ЕНТ</h3><p>Задания с одним ответом, контекстные, на соответствие и с несколькими ответами. Баллы считаются по правилам ЕНТ.</p></div>
        <div class="card"><div class="icon">⏱</div><h3>Реальный таймер</h3><p>${C.durationMin} минут на предмет. Тренируйте темп: на ЕНТ время решает так же, как знания.</p></div>
        <div class="card"><div class="icon">🧠</div><h3>Разбор ошибок</h3><p>После теста показываем решение каждого задания. Понимаете, где ошиблись, а не просто видите балл.</p></div>
        <div class="card"><div class="icon">🔁</div><h3>Варианты не заканчиваются</h3><p>Кроме ${C.variantsCount} вариантов по каждому предмету есть «Случайный вариант»: каждый раз новый набор заданий.</p></div>
        <div class="card"><div class="icon">📈</div><h3>Прогресс</h3><p>Все попытки сохраняются. Видно, как растёт балл от варианта к варианту.</p></div>
        <div class="card"><div class="icon">📱</div><h3>С телефона</h3><p>Без установки и регистрации. Открыли ссылку и решаете.</p></div>
      </div>
    </div></section>

    <section class="section" style="padding-top:0"><div class="wrap">
      <h2>Как считаются баллы</h2><p class="sub">Профильный предмет ЕНТ: 40 заданий, максимум 50 баллов.</p>
      <table class="format-table">
        <tr><th>Задания</th><th>Тип</th><th>Баллы</th></tr>
        <tr><td>1–25</td><td>Один правильный ответ из 4</td><td>по 1</td></tr>
        <tr><td>26–30</td><td>Контекстные (задача из жизни)</td><td>по 1</td></tr>
        <tr><td>31–35</td><td>На соответствие: 2 балла, если всё верно, 1 балл за одну пару</td><td>по 2</td></tr>
        <tr><td>36–40</td><td>Несколько ответов из 6: 2 балла без ошибок, 1 балл при одной ошибке</td><td>по 2</td></tr>
        <tr><td>Итого</td><td>40 заданий</td><td>50</td></tr>
      </table>
    </div></section>

    <section class="section" id="price"><div class="wrap">
      <h2>Тарифы</h2><p class="sub">Начните бесплатно. Платите, только если понравится.</p>
      <div class="grid2">
        <div class="card price-card"><h3>Бесплатно</h3><div class="price">0 ₸</div>
          <ul class="ticks"><li>Вариант 1 по каждому из ${NS} предметов</li><li>Полный разбор ответов</li><li class="no">Варианты 2–${C.variantsCount}</li><li class="no">Случайные варианты</li></ul>
          <a class="btn btn-ghost btn-block" href="#/tests">Начать</a></div>
        <div class="card price-card best"><span class="badge">Выгодно</span><h3>Полный доступ</h3><div class="price">${money(C.price)}${C.priceOld ? `<s>${money(C.priceOld)}</s>` : ''}</div>
          <ul class="ticks"><li>${ALLV} вариантов по ${NS} предметам</li><li>Безлимитные случайные варианты</li><li>Разборы и история результатов</li><li>Разовая оплата через Kaspi</li><li>Доступ до ЕНТ-2027</li></ul>
          <button class="btn btn-block" data-pay>Получить доступ</button></div>
      </div>
    </div></section>

    <section class="section" style="padding-top:0"><div class="wrap">
      <h2>Вопросы</h2>
      <details class="faq"><summary>Это официальный тест НЦТ?</summary><p>Нет. «Сынақ» — независимый тренажёр. Формат и система баллов повторяют профильный предмет ЕНТ, задания составлены нами.</p></details>
      <details class="faq"><summary>Как оплатить?</summary><p>Переводом через Kaspi на ${esc(C.kaspiPhone)}. Пришлите чек в WhatsApp, и мы отправим код. Вводите его в «Полный доступ», и все варианты откроются.</p></details>
      <details class="faq"><summary>Нужна регистрация?</summary><p>Нет. Код и результаты хранятся в вашем браузере. На новом устройстве введите тот же код ещё раз.</p></details>
      <details class="faq"><summary>Что такое «Случайный вариант»?</summary><p>Те же типы заданий, но с новыми числами и новым набором вопросов при каждом запуске. Так тренируется навык решать, а не память на ответы.</p></details>
      <details class="faq"><summary>Какие предметы есть?</summary><p>${Object.values(SUBJ).join(', ')} — по ${C.variantsCount} вариантов на каждый. Нужен другой предмет? Напишите в WhatsApp, и мы учтём.</p></details>
    </div></section>`;
    app.querySelectorAll('[data-pay]').forEach((b) => (b.onclick = () => paywall()));
  }

  function pageTests(subject) {
    track('tests');
    subject = SUBJ[subject] ? subject : (SUBJ[LS.get(K.subj, '')] ? LS.get(K.subj, '') : 'math');
    LS.set(K.subj, subject);
    const run = LS.get(K.run, null);
    let cards = '';
    for (let v = 1; v <= C.variantsCount; v++) {
      const open = canOpen(v), best = bestFor(subject, v);
      cards += `<button class="vcard ${open ? '' : 'locked'}" data-v="${v}">
        <span class="vt">Вариант ${v}</span><span class="vs">40 заданий · ${C.durationMin} мин</span>
        ${best !== null ? `<span class="tag done">Лучший: ${best}/50</span>` : isFree(v) ? '<span class="tag free">Бесплатно</span>' : open ? '<span class="tag free">Открыт</span>' : '<span class="tag lock">🔒 Платный</span>'}
      </button>`;
    }
    cards += `<button class="vcard random" data-v="random"><span class="vt">🎲 Случайный</span><span class="vs">Новые числа каждый раз</span>${hasAccess() ? '' : '<span class="tag lock" style="background:rgba(255,255,255,.2);color:#fff">🔒 Платный</span>'}</button>`;
    app.innerHTML = `<div class="wrap">
      <div class="page-head"><h1>Пробные тесты</h1><p>Выберите предмет и вариант. Тест можно прервать: прогресс сохранится.</p></div>
      ${run ? `<div class="notice row-between"><span>Есть незавершённый тест: ${SUBJ[run.subject]}, ${run.variant === 'random' || String(run.variant).startsWith('R') ? 'случайный вариант' : 'вариант ' + run.variant}.</span><a class="btn btn-sm" href="#/run">Продолжить</a></div>` : ''}
      <div class="tabs" role="tablist">${Object.entries(SUBJ).map(([k, n]) => `<button class="${k === subject ? 'on' : ''}" data-s="${k}">${n}</button>`).join('')}</div>
      <div class="variants">${cards}</div>
      ${hasAccess() ? '' : `<div class="card mt row-between"><div><b>Откройте все ${ALLV} вариантов по ${NS} предметам</b><div class="muted" style="font-size:15px">Разовая оплата ${money(C.price)} через Kaspi</div></div><button class="btn btn-accent" data-pay>Полный доступ</button></div>`}
    </div>`;
    app.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => (location.hash = '#/tests/' + b.dataset.s)));
    app.querySelectorAll('[data-pay]').forEach((b) => (b.onclick = () => paywall()));
    app.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => {
      const v = b.dataset.v;
      if (v === 'random') { if (!hasAccess()) return paywall('Случайные варианты входят в полный доступ.'); return startTest(subject, 'R' + Math.floor(Math.random() * 1e9)); }
      if (!canOpen(v)) return paywall(`Вариант ${v} входит в полный доступ.`);
      startTest(subject, Number(v));
    }));
  }

  function startTest(subject, variant) {
    track('start'); track('subj:' + subject);
    const cur = LS.get(K.run, null);
    if (cur && !confirm('Начать новый тест? Незавершённый тест будет сброшен.')) return;
    LS.set(K.run, { subject, variant, answers: {}, flags: {}, cur: 0, startedAt: Date.now(), duration: C.durationMin * 60000 });
    location.hash = '#/run';
  }

  // ---------- прохождение ----------
  function pageRun() {
    const run = LS.get(K.run, null);
    if (!run) { location.hash = '#/tests'; return; }
    const V = G.buildVariant(run.subject, run.variant);
    const qs = V.questions;
    document.body.classList.add('testing');
    const vname = String(run.variant).startsWith('R') ? 'Случайный вариант' : 'Вариант ' + run.variant;
    app.innerHTML = `
      <div class="runbar"><div class="wrap"><span class="ttl">${SUBJ[run.subject]} · ${vname}</span>
        <span class="timer" id="timer">--:--</span><button class="btn btn-sm btn-ok" id="finish">Завершить</button></div>
        <div class="progress"><i id="prog"></i></div></div>
      <div class="wrap run"><div><div class="qcard" id="q"></div></div><aside class="side"><div class="palette" id="pal"></div></aside></div>`;
    const save = () => LS.set(K.run, run);
    const answered = (i) => { const a = run.answers[i]; return a !== undefined && a !== null && !(Array.isArray(a) && (a.length === 0 || a.every((x) => x === null || x === undefined))); };

    function renderPalette() {
      const sec = [[0, 25, 'Один ответ'], [25, 30, 'Контекстные'], [30, 35, 'Соответствие'], [35, 40, 'Несколько ответов']];
      $('#pal').innerHTML = `<h4>Задания · отвечено ${qs.filter((_, i) => answered(i)).length} из 40</h4>` + sec.map(([a, b, n]) =>
        `<div class="psec">${n}</div><div class="pgrid">${qs.slice(a, b).map((_, k) => { const i = a + k; return `<button data-i="${i}" class="${answered(i) ? 'ans' : ''} ${i === run.cur ? 'cur' : ''} ${run.flags[i] ? 'flg' : ''}">${i + 1}</button>`; }).join('')}</div>`).join('')
        + '<div class="legend"><span><i style="background:var(--ok-soft);border:1px solid #a9dcbc"></i>отвечено</span><span><i style="background:var(--accent)"></i>отмечено</span></div>';
      $('#pal').querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => go(+b.dataset.i)));
      $('#prog').style.width = (qs.filter((_, i) => answered(i)).length / 40 * 100) + '%';
    }

    function renderQ() {
      const i = run.cur, q = qs[i], a = run.answers[i];
      let body = '';
      if (q.type === 'single' || q.type === 'context') {
        body = q.options.map((o, j) => `<button class="opt ${a === j ? 'on' : ''}" data-o="${j}"><span class="key">${L[j]}</span><span>${o}</span></button>`).join('');
      } else if (q.type === 'multi') {
        const sel = a || [];
        body = `<div class="hint">Выберите один или несколько правильных ответов</div>` + q.options.map((o, j) => `<button class="opt multi ${sel.includes(j) ? 'on' : ''}" data-m="${j}"><span class="key">${sel.includes(j) ? '✓' : L[j]}</span><span>${o}</span></button>`).join('');
      } else {
        const sel = a || [null, null];
        body = `<div class="hint">Для каждого пункта слева выберите номер из списка</div>
          <div class="mright">${q.right.map((r, j) => `<div><b>${j + 1})</b> ${r}</div>`).join('')}</div>`
          + q.left.map((l, li) => `<div class="mrow"><span class="ml">${L[li]}) ${l}</span><span class="mbtns">${q.right.map((_, j) => `<button class="mbtn ${sel[li] === j ? 'on' : ''}" data-l="${li}" data-r="${j}">${j + 1}</button>`).join('')}</span></div>`).join('');
      }
      $('#q').innerHTML = `
        <div class="qmeta"><span class="num">Задание ${i + 1} из 40</span><span class="pill">${TYPE[q.type]}</span><span class="pill">${q.max} ${q.max === 1 ? 'балл' : 'балла'}</span>
          <button class="flag ${run.flags[i] ? 'on' : ''}" id="flag">${run.flags[i] ? '★ Отмечено' : '☆ Вернуться позже'}</button></div>
        ${q.context ? `<div class="context">${q.context}</div>` : ''}
        <div class="qtext">${q.text}</div>${body}
        <div class="qnav"><button class="btn btn-ghost" id="prev" ${i === 0 ? 'disabled' : ''}>← Назад</button>
          ${i < 39 ? '<button class="btn" id="next">Далее →</button>' : '<button class="btn btn-ok" id="fin2">Завершить тест</button>'}</div>`;
      $('#q').querySelectorAll('[data-o]').forEach((b) => (b.onclick = () => { const j = +b.dataset.o; run.answers[i] = run.answers[i] === j ? null : j; save(); renderQ(); renderPalette(); }));
      $('#q').querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { const j = +b.dataset.m; const s = new Set(run.answers[i] || []); s.has(j) ? s.delete(j) : s.add(j); run.answers[i] = [...s].sort(); save(); renderQ(); renderPalette(); }));
      $('#q').querySelectorAll('[data-l]').forEach((b) => (b.onclick = () => { const s = (run.answers[i] || [null, null]).slice(); const li = +b.dataset.l, j = +b.dataset.r; s[li] = s[li] === j ? null : j; run.answers[i] = s; save(); renderQ(); renderPalette(); }));
      $('#flag').onclick = () => { run.flags[i] = !run.flags[i]; save(); renderQ(); renderPalette(); };
      $('#prev').onclick = () => go(i - 1);
      if ($('#next')) $('#next').onclick = () => go(i + 1);
      if ($('#fin2')) $('#fin2').onclick = askFinish;
    }
    function go(i) { run.cur = Math.max(0, Math.min(39, i)); save(); renderQ(); renderPalette(); if (window.innerWidth < 860) window.scrollTo({ top: 0, behavior: 'smooth' }); }
    function askFinish() {
      const left = 40 - qs.filter((_, i) => answered(i)).length;
      openModal(`<h3>Завершить тест?</h3><p class="muted">${left ? `Без ответа осталось заданий: <b>${left}</b>. За них будет 0 баллов.` : 'Вы ответили на все задания.'}</p>
        <div class="cta-row mt"><button class="btn btn-ok" id="yes">Завершить и посмотреть результат</button><button class="btn btn-ghost" data-close>Продолжить решать</button></div>`);
      $('#yes').onclick = () => { closeModal(); finish(run, qs); };
    }
    $('#finish').onclick = askFinish;

    function tick() {
      const left = run.startedAt + run.duration - Date.now();
      if (left <= 0) { toast('Время вышло. Тест завершён.'); finish(run, qs); return; }
      const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
      const t = $('#timer'); if (!t) return;
      t.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      t.classList.toggle('low', left < 5 * 60000);
    }
    clearInterval(timerId); timerId = setInterval(tick, 1000); tick();
    renderQ(); renderPalette();
  }

  function finish(run, qs) {
    clearInterval(timerId); track('finish');
    const per = qs.map((q, i) => G.scoreQuestion(q, run.answers[i]));
    const score = per.reduce((a, b) => a + b, 0);
    const rec = { id: 'a' + Date.now(), subject: run.subject, variant: run.variant, answers: run.answers, score, per,
      spent: Math.min(Date.now() - run.startedAt, run.duration), date: Date.now() };
    const h = history(); h.unshift(rec); LS.set(K.hist, h.slice(0, 200));
    LS.del(K.run);
    location.hash = '#/result/' + rec.id;
  }

  // ---------- результат ----------
  function pageResult(id) {
    const rec = history().find((x) => x.id === id);
    if (!rec) { location.hash = '#/stats'; return; }
    const V = G.buildVariant(rec.subject, rec.variant), qs = V.questions;
    const per = qs.map((q, i) => G.scoreQuestion(q, rec.answers[i]));
    const pct = Math.round(rec.score / 50 * 100);
    const color = pct >= 70 ? 'var(--ok)' : pct >= 40 ? 'var(--mid)' : 'var(--bad)';
    const verdict = pct >= 80 ? 'Отличный результат!' : pct >= 60 ? 'Хороший результат' : pct >= 40 ? 'Неплохо, но есть над чем поработать' : 'Нужно подтянуть темы';
    const secs = [[0, 25, 'Один ответ'], [25, 30, 'Контекстные'], [30, 35, 'Соответствие'], [35, 40, 'Несколько ответов']]
      .map(([a, b, n]) => { const got = per.slice(a, b).reduce((x, y) => x + y, 0), max = qs.slice(a, b).reduce((x, q) => x + q.max, 0); return `<div class="kpi"><b>${got}/${max}</b><span>${n}</span></div>`; }).join('');
    const mm = Math.floor(rec.spent / 60000), ss = Math.floor(rec.spent / 1000) % 60;
    const vname = String(rec.variant).startsWith('R') ? 'случайный вариант' : 'вариант ' + rec.variant;
    const status = (i) => { const q = qs[i], p = per[i], a = rec.answers[i]; const empty = a === undefined || a === null || (Array.isArray(a) && !a.some((x) => x !== null && x !== undefined));
      return empty ? 'skip' : p === q.max ? 'ok' : p > 0 ? 'mid' : 'bad'; };
    const stText = { ok: '✓ Верно', mid: '◐ Частично', bad: '✗ Неверно', skip: '— Без ответа' };

    function review(i) {
      const q = qs[i], a = rec.answers[i], st = status(i);
      let body = '';
      if (q.type === 'single' || q.type === 'context') {
        body = `<ul class="rv-opts">${q.options.map((o, j) => `<li class="${j === q.answer ? 'c' : a === j ? 'w' : ''}">${L[j]}) ${o}${a === j ? '<span class="me">← ваш ответ</span>' : ''}</li>`).join('')}</ul>`;
      } else if (q.type === 'multi') {
        const sel = a || [];
        body = `<ul class="rv-opts">${q.options.map((o, j) => { const c = q.answer.includes(j), me = sel.includes(j); return `<li class="${c ? 'c' : me ? 'w' : ''}">${L[j]}) ${o}${me ? '<span class="me">← выбрано</span>' : ''}</li>`; }).join('')}</ul>`;
      } else {
        const sel = a || [];
        body = `<ul class="rv-opts">${q.left.map((l, li) => { const ok = sel[li] === q.answer[li]; return `<li class="c">${L[li]}) ${l} → ${q.answer[li] + 1}) ${q.right[q.answer[li]]}</li>${!ok && sel[li] !== null && sel[li] !== undefined ? `<li class="w">Ваш ответ для ${L[li]}: ${sel[li] + 1}) ${q.right[sel[li]]}</li>` : ''}`; }).join('')}</ul>`;
      }
      return `<div class="rv ${st}" data-st="${st}"><div class="rv-head"><span><b>№${i + 1}</b> · ${TYPE[q.type]}</span><span class="st ${st}">${stText[st]} · ${per[i]}/${q.max}</span></div>
        ${q.context ? `<div class="context">${q.context}</div>` : ''}<div class="qtext">${q.text}</div>${body}<div class="explain"><b>Решение</b>${q.explain}</div></div>`;
    }

    const wrong = qs.map((_, i) => status(i)).filter((s) => s !== 'ok').length;
    app.innerHTML = `<div class="wrap">
      <div class="score-hero">
        <div class="ring" style="--p:${pct};--c:${color}"><div><div><b>${rec.score}</b><span>из 50</span></div></div></div>
        <div><p class="verdict">${verdict}</p><div class="muted">${SUBJ[rec.subject]} · ${vname} · время ${mm} мин ${ss} с · ${pct}%</div>
          <div class="kpis">${secs}</div>
          <div class="cta-row mt"><a class="btn" href="#/tests/${rec.subject}">Следующий вариант</a><a class="btn btn-ghost" href="#/stats">Все результаты</a></div></div>
      </div>
      ${hasAccess() ? '' : `<div class="card row-between" style="margin-bottom:14px"><div><b>Хотите тренироваться дальше?</b><div class="muted" style="font-size:15px">Ещё ${ALLV - NS * C.freeVariants.length} вариантов по ${NS} предметам и безлимитные случайные за ${money(C.price)}</div></div><button class="btn btn-accent" data-pay>Открыть всё</button></div>`}
      <h2 style="margin:22px 0 4px">Разбор заданий</h2>
      <div class="filters"><button class="btn btn-sm" data-f="all">Все (40)</button><button class="btn btn-sm btn-ghost" data-f="err">Ошибки и пропуски (${wrong})</button></div>
      <div id="rvlist">${qs.map((_, i) => review(i)).join('')}</div>
    </div>`;
    app.querySelectorAll('[data-pay]').forEach((b) => (b.onclick = () => paywall()));
    app.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => {
      app.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('btn-ghost', x !== b));
      app.querySelectorAll('.rv').forEach((r) => (r.hidden = b.dataset.f === 'err' && r.dataset.st === 'ok'));
    }));
    window.scrollTo(0, 0);
  }

  // ---------- статистика ----------
  function pageStats() {
    const h = history();
    const avg = (arr) => (arr.length ? String(Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10).replace('.', ',') : '—');
    const by = (s) => h.filter((x) => x.subject === s).map((x) => x.score);
    app.innerHTML = `<div class="wrap"><div class="page-head"><h1>Мои результаты</h1><p>Результаты хранятся в этом браузере.</p></div>
      ${h.length ? `<div class="kpis" style="margin:16px 0">
        <div class="kpi"><b>${h.length}</b><span>попыток</span></div>
        <div class="kpi"><b>${avg(h.map((x) => x.score))}</b><span>средний балл</span></div>
        ${Object.keys(SUBJ).filter((k) => by(k).length).map((k) => `<div class="kpi"><b>${Math.max(...by(k))}</b><span>лучший · ${SUBJ[k].toLowerCase()}</span></div>`).join('')}</div>
      <table class="hist"><tr><th>Дата</th><th>Тест</th><th>Балл</th><th></th></tr>
        ${h.map((x) => `<tr><td>${new Date(x.date).toLocaleDateString('ru-RU')}</td><td>${SUBJ[x.subject] || x.subject}<div class="muted" style="font-size:13px">${String(x.variant).startsWith('R') ? 'случайный' : 'вариант ' + x.variant}</div></td>
          <td><b>${x.score}</b>/50<div class="bar"><i style="width:${x.score * 2}%"></i></div></td><td><a href="#/result/${x.id}">Разбор</a></td></tr>`).join('')}
      </table>` : `<div class="card empty"><p>Пока нет пройденных тестов.</p><a class="btn" href="#/tests">Пройти первый тест</a></div>`}
    </div>`;
  }

  // ---------- роутер ----------
  function route() {
    clearInterval(timerId);
    document.body.classList.remove('testing');
    const parts = (location.hash || '#/').slice(2).split('/');
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === parts[0] || (parts[0] === 'run' && a.dataset.nav === 'tests')));
    refreshHeader();
    switch (parts[0]) {
      case 'tests': pageTests(parts[1]); break;
      case 'run': pageRun(); break;
      case 'result': pageResult(parts[1]); break;
      case 'stats': pageStats(); break;
      default: pageHome();
    }
    if (parts[0] !== 'run') window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  route();
  track('visit');
  startPayWatch();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && pending()) checkPay(true); });
})();
