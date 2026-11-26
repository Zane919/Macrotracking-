'use strict';
/* MacroTracking - PWA offline-first.
   Dati salvati solo sul telefono (localStorage). Database alimenti: CREA. Codici a barre: Open Food Facts. */
(() => {
  const VERSION = '2.1.1';
  const KEY = 'contacalorie.v1';

  const MEALS = [
    { id: 'colazione', name: 'Colazione', ico: '☕' },
    { id: 'pranzo', name: 'Pranzo', ico: '🍝' },
    { id: 'merenda', name: 'Merenda', ico: '🍎' },
    { id: 'cena', name: 'Cena', ico: '🍽️' },
    { id: 'snack', name: 'Snack', ico: '🍿' },
  ];
  const mealName = (id) => (MEALS.find((m) => m.id === id) || MEALS[0]).name;
  const DEFAULT_GOALS = { k: 1985, p: 100, c: 250, f: 65, auto: true, isDefault: true };

  /* ---------- utilities ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => iso(new Date());
  const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
  // Totali macro: una cifra decimale; se il decimale supera 0,5 si arrotonda all'intero successivo (12,7 -> 13; 12,5 -> 12,5)
  const fmtM = (n) => {
    const t = Math.round((Number.isFinite(n) ? n : 0) * 10), d = ((t % 10) + 10) % 10;
    return d > 5 ? fmt(Math.ceil(t / 10)) : fmt(t / 10, 1);
  };
  const fmt = (n, dec = 0) => (Number.isFinite(n) ? n : 0).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: dec });
  const parseNum = (v) => { const n = parseFloat(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const stem = (t) => (t.length > 3 ? t.replace(/[aeio]$/, '') : t);

  function dayLabel(s) {
    const t = todayISO();
    if (s === t) return 'Oggi';
    if (s === addDays(t, -1)) return 'Ieri';
    if (s === addDays(t, 1)) return 'Domani';
    return parseISO(s).toLocaleDateString('it-IT', { weekday: 'long' });
  }
  const dayFull = (s) => parseISO(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  function autoMeal() {
    const d = new Date(); const h = d.getHours() + d.getMinutes() / 60;
    return h < 10.5 ? 'colazione' : h < 15 ? 'pranzo' : h < 18.5 ? 'merenda' : 'cena';
  }

  /* ---------- obiettivi per giorno della settimana ---------- */
  const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
  const dayIdx = (date) => (parseISO(date).getDay() + 6) % 7;   // 0 = lunedì … 6 = domenica
  // Formato: [{ id, days:[0..6], k, p, c, f, auto }]. I vecchi obiettivi "valido dal" vengono convertiti:
  // l'ultimo in ordine di data vale per tutti i giorni non coperti.
  function normGoals(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    const num = (x) => (Number.isFinite(+x) ? +x : 0);
    for (const g of list) {
      if (!g || !Array.isArray(g.days)) continue;
      const days = [...new Set(g.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort();
      if (days.length) out.push({ id: g.id || uid(), days, k: num(g.k), p: num(g.p), c: num(g.c), f: num(g.f), auto: g.auto !== false });
    }
    const legacy = list.filter((g) => g && !Array.isArray(g.days)).sort((x, y) => (String(x.from) < String(y.from) ? 1 : -1))[0];
    if (legacy) {
      const used = new Set(out.flatMap((g) => g.days));
      const days = ALL_DAYS.filter((d) => !used.has(d));
      if (days.length) out.push({ id: uid(), days, k: num(legacy.k), p: num(legacy.p), c: num(legacy.c), f: num(legacy.f), auto: legacy.auto !== false });
    }
    return out;
  }
  function daysLabel(days) {
    const d = [...days].sort();
    if (d.length === 7) return 'Tutti i giorni';
    const parts = []; let i = 0;
    while (i < d.length) {
      let j = i; while (j + 1 < d.length && d[j + 1] === d[j] + 1) j++;
      if (j - i >= 2) parts.push(DAYS[d[i]] + '–' + DAYS[d[j]]);
      else for (let x = i; x <= j; x++) parts.push(DAYS[d[x]]);
      i = j + 1;
    }
    return parts.join(', ');
  }

  // Pesi: [{ date:'YYYY-MM-DD', kg }], una sola pesata per giorno, in ordine di data
  function normWeights(list) {
    if (!Array.isArray(list)) return [];
    const m = new Map();
    for (const w of list) {
      const kg = Number(w && w.kg);
      if (w && /^\d{4}-\d{2}-\d{2}$/.test(String(w.date)) && Number.isFinite(kg) && kg > 0) m.set(w.date, { date: w.date, kg });
    }
    return [...m.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
  }

  // Acqua: [{ date:'YYYY-MM-DD', l }] litri bevuti nel giorno, una sola voce per giorno, in ordine di data
  function normWater(list) {
    if (!Array.isArray(list)) return [];
    const m = new Map();
    for (const w of list) {
      const l = Number(w && w.l);
      if (w && /^\d{4}-\d{2}-\d{2}$/.test(String(w.date)) && Number.isFinite(l) && l > 0) m.set(w.date, { date: w.date, l });
    }
    return [...m.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
  }

  /* ---------- storage ---------- */
  let S = load();
  function load() {
    try {
      const r = JSON.parse(localStorage.getItem(KEY));
      if (r && Array.isArray(r.entries)) return { entries: r.entries, goals: normGoals(r.goals), foods: r.foods || [], weights: normWeights(r.weights), water: normWater(r.water) };
    } catch (e) { /* dati corrotti: riparto da zero */ }
    return { entries: [], goals: [], foods: [], weights: [], water: [] };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast('Impossibile salvare i dati: spazio esaurito?'); }
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  /* ---------- food database ---------- */
  const CREA = (window.CREA_FOODS || []).map((r) => ({
    key: 'crea:' + r[0], name: r[1], brand: '', src: 'crea',
    per100: { k: r[2], p: r[3], f: r[4], c: r[5] }, _n: norm(r[1]),
  }));
  const foodIndex = new Map(); // key -> food (per ritrovare l'alimento toccato in lista)
  CREA.forEach((f) => foodIndex.set(f.key, f));

  const customToFood = (c) => ({
    key: 'food:' + c.id, id: c.id, name: c.name, brand: c.brand || '', src: c.src || 'custom', barcode: c.barcode || '',
    per100: c.per100, pack: c.pack || null, serving: c.serving || null,
    _n: norm(c.name + ' ' + (c.brand || '') + ' ' + (c.barcode || '')),
  });

  function searchFoods(q) {
    const toks = norm(q).split(' ').filter(Boolean).map(stem);
    if (!toks.length) return [];
    const score = (f) => {
      let s = 0;
      for (const t of toks) {
        const i = f._n.indexOf(t);
        if (i < 0) return -1;
        s += i === 0 ? 0 : f._n.includes(' ' + t) ? 1 : 3;
      }
      return s * 100 + f._n.length;
    };
    const rank = (list) => list.map((f) => [score(f), f]).filter((x) => x[0] >= 0).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const mine = rank(S.foods.map(customToFood));
    const crea = rank(CREA);
    return [...mine, ...crea].slice(0, 60);
  }

  function recentFoods(limit = 12) {
    const seen = new Set(); const out = [];
    const sorted = [...S.entries].sort((a, b) => b.ts - a.ts);
    for (const e of sorted) {
      if (seen.has(e.key)) continue;
      seen.add(e.key);
      out.push({ key: e.key, name: e.name, brand: e.brand || '', src: e.src || 'custom', per100: e.per100, pack: e.pack || null, serving: e.serving || null });
      if (out.length >= limit) break;
    }
    return out;
  }

  /* ---------- calcoli ---------- */
  const scale = (per100, g) => ({ k: (per100.k * g) / 100, p: (per100.p * g) / 100, c: (per100.c * g) / 100, f: (per100.f * g) / 100 });
  const entryVals = (e) => scale(e.per100, e.grams);
  function sum(list) {
    return list.reduce((a, e) => { const v = entryVals(e); return { k: a.k + v.k, p: a.p + v.p, c: a.c + v.c, f: a.f + v.f }; }, { k: 0, p: 0, c: 0, f: 0 });
  }
  function goalsFor(date) {
    const wd = dayIdx(date);
    const g = S.goals.find((x) => x.days.includes(wd));
    if (g) return g;
    return S.goals.length ? { ...DEFAULT_GOALS, noneForDay: true } : DEFAULT_GOALS;
  }

  /* ---------- toast ---------- */
  let toastT;
  function toast(msg, act) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>${act ? `<button type="button">${esc(act.label)}</button>` : ''}`;
    t.classList.add('show');
    if (act) t.querySelector('button').onclick = () => { act.fn(); t.classList.remove('show'); };
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), act ? 5500 : 2400);
  }

  /* ---------- app state ---------- */
  let view = 'diary';
  let curDate = todayISO();

  /* ================== DIARIO ================== */
  function renderDiary() {
    const g = goalsFor(curDate);
    const dayEntries = S.entries.filter((e) => e.date === curDate);
    const tot = sum(dayEntries);
    const remaining = g.k - tot.k;
    const over = remaining < 0;
    const pct = g.k > 0 ? Math.min(tot.k / g.k, 1) : 0;
    const C = 2 * Math.PI * 52;

    const macro = (cls, label, val, goal) => {
      const o = goal > 0 && val > goal + 0.5;
      const w = goal > 0 ? Math.min((val / goal) * 100, 100) : 0;
      const rem = goal - val;
      const left = rem > 0.05 ? `Mancano <b>${fmt(rem, 1)} g</b>` : o ? `Oltre di <b>${fmt(-rem, 1)} g</b>` : 'Obiettivo raggiunto';
      return `<div class="macro ${cls}${o ? ' over' : ''}">
        <div class="mtop"><b>${label}</b><span class="${o ? 'over' : ''}">${fmt(val, 1)} / ${fmt(goal, 0)} g</span></div>
        <div class="bar" role="progressbar" aria-label="${label}" aria-valuenow="${Math.round(val)}" aria-valuemin="0" aria-valuemax="${Math.round(goal)}"><i style="width:${w}%"></i></div>
        <div class="mleft${o ? ' over' : ''}">${left}</div></div>`;
    };

    const mealsHtml = MEALS.map((m) => {
      const list = dayEntries.filter((e) => e.meal === m.id).sort((a, b) => a.ts - b.ts);
      const mt = sum(list);
      const mk = mt.k;
      const totRow = list.length ? `<div class="meal-tot" aria-label="Totale ${m.name}"><b>Totale</b><span><b>${fmt(mt.k, 0)}</b> kcal</span><span>P <b>${fmt(mt.p, 1)}</b></span><span>C <b>${fmt(mt.c, 1)}</b></span><span>G <b>${fmt(mt.f, 1)}</b></span></div>` : '';
      const rows = list.map((e) => {
        const v = entryVals(e);
        return `<button type="button" class="entry" data-act="edit-entry" data-id="${esc(e.id)}">
          <span class="e-main"><b>${esc(e.name)}</b><small>${fmt(e.grams, 1)} g · P ${fmt(v.p, 1)} · C ${fmt(v.c, 1)} · G ${fmt(v.f, 1)}</small></span>
          <span class="e-k">${fmt(v.k, 0)} <small>kcal</small></span></button>`;
      }).join('');
      return `<section class="card meal" aria-label="${m.name}">
        <div class="meal-head"><h2><span class="ico" aria-hidden="true">${m.ico}</span>${m.name}</h2><span class="mk">${list.length ? fmt(mk, 0) + ' kcal' : ''}</span></div>
        ${rows || '<p class="empty-meal">Nessun alimento</p>'}
        ${totRow}
        <button type="button" class="meal-add" data-act="add-meal" data-meal="${m.id}">+ Aggiungi a ${m.name.toLowerCase()}</button>
      </section>`;
    }).join('');

    $('#app').innerHTML = `
      <div class="datebar">
        <button type="button" class="arrow" data-act="prev" aria-label="Giorno precedente">‹</button>
        <label class="date"><b>${dayLabel(curDate)}</b><small>${dayFull(curDate)}</small>
          <input type="date" id="datePick" value="${curDate}" aria-label="Scegli la data"></label>
        <button type="button" class="arrow" data-act="next" aria-label="Giorno successivo">›</button>
      </div>
      ${curDate !== todayISO() ? '<button type="button" class="today-link" data-act="today">Torna a oggi</button>' : ''}
      ${g.isDefault ? `<div class="banner"><span>${g.noneForDay ? 'Nessun obiettivo impostato per questo giorno della settimana.' : 'Stai usando obiettivi di esempio. Imposta i tuoi.'}</span><button type="button" data-act="nav" data-view="goals">Imposta</button></div>` : ''}
      <section class="card summary" aria-label="Riepilogo calorie">
        <div class="ring${over ? ' over' : ''}">
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="bg" cx="60" cy="60" r="52" fill="none" stroke-width="11"/><circle class="fg" cx="60" cy="60" r="52" fill="none" stroke-width="11" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"/></svg>
          <div class="mid"><b>${fmt(Math.abs(remaining), 0)}</b><span>${over ? 'kcal oltre' : 'kcal restanti'}</span></div>
        </div>
        <div class="kstats">
          <div><span>Assunte</span><b>${fmt(tot.k, 0)}</b></div>
          <div><span>Obiettivo</span><b>${fmt(g.k, 0)}</b></div>
        </div>
      </section>
      <section class="card"><div class="macros">
        ${macro('p', 'Proteine', tot.p, g.p)}${macro('c', 'Carboidrati', tot.c, g.c)}${macro('f', 'Grassi', tot.f, g.f)}
      </div></section>
      ${mealsHtml}`;
  }

  /* ================== OBIETTIVI ================== */
  let gDraft = null;   // bozza del modulo obiettivi: { days, k, p, c, f, auto }
  function renderGoals() {
    const t = todayISO();
    const g = goalsFor(t);
    if (!gDraft) gDraft = { days: g.isDefault ? [...ALL_DAYS] : [...g.days], k: g.k, p: g.p, c: g.c, f: g.f, auto: g.auto !== false };
    const d = gDraft;
    const auto = d.auto;
    const list = [...S.goals].sort((x, y) => Math.min(...x.days) - Math.min(...y.days));
    const foods = [...S.foods].sort((a, b) => a.name.localeCompare(b.name, 'it'));
    const todayName = parseISO(t).toLocaleDateString('it-IT', { weekday: 'long' });
    $('#app').innerHTML = `
      <section class="card">
        <h2>Obiettivi giornalieri</h2>
        <p class="hint" style="margin-bottom:12px">${g.isDefault ? 'Valori di esempio: inserisci i tuoi, scegli i giorni e salva.' : 'Oggi (' + todayName + ') vale: ' + fmt(g.k) + ' kcal.'}</p>
        <form id="goalForm" novalidate>
          <div class="field">
            <label id="gdaysLbl">Giorni della settimana</label>
            <div class="days" role="group" aria-labelledby="gdaysLbl">
              ${DAYS.map((n, i) => `<button type="button" class="day${d.days.includes(i) ? ' on' : ''}" data-act="toggle-gday" data-d="${i}" aria-pressed="${d.days.includes(i)}">${n}</button>`).join('')}
            </div>
            <div class="day-quick">
              <button type="button" data-act="gdays-set" data-set="all">Tutti</button>
              <button type="button" data-act="gdays-set" data-set="week">Lun–Ven</button>
              <button type="button" data-act="gdays-set" data-set="weekend">Sab–Dom</button>
            </div>
          </div>
          <div class="field"><label for="gk">Calorie (kcal)</label><input class="in" id="gk" inputmode="numeric" value="${fmt(d.k)}"${auto ? ' readonly' : ''}></div>
          <label class="check"><input type="checkbox" id="gauto"${auto ? ' checked' : ''}> Calcola le kcal dai macro che inserisco</label>
          <div class="grid3">
            <div class="field"><label for="gf">Grassi (g)</label><input class="in" id="gf" inputmode="numeric" value="${fmt(d.f)}"></div>
            <div class="field"><label for="gc">Carboidrati (g)</label><input class="in" id="gc" inputmode="numeric" value="${fmt(d.c)}"></div>
            <div class="field"><label for="gp">Proteine (g)</label><input class="in" id="gp" inputmode="numeric" value="${fmt(d.p)}"></div>
          </div>
          <p class="info-line" id="goalInfo"></p>
          <button type="button" class="btn primary" data-act="save-goals">Salva per i giorni selezionati</button>
          <p class="hint" style="margin-top:8px">Puoi avere un obiettivo diverso per ogni giorno. Valgono anche per i giorni passati corrispondenti.</p>
        </form>
      </section>
      ${list.length ? `<section class="card"><h2>I tuoi obiettivi</h2>${list.map((h) => `
        <div class="list-row"><button type="button" class="lr-main lr-btn" data-act="edit-goal" data-id="${esc(h.id)}" aria-label="Modifica obiettivo ${daysLabel(h.days)}"><b>${daysLabel(h.days)}</b><small>${fmt(h.k)} kcal · G ${fmt(h.f)} · C ${fmt(h.c)} · P ${fmt(h.p)}</small></button>
        <button type="button" class="x" data-act="delete-goal" data-id="${esc(h.id)}" aria-label="Elimina obiettivo">✕</button></div>`).join('')}</section>` : ''}
      <section class="card">
        <h2>I miei alimenti</h2>
        ${foods.length ? foods.map((f) => `<div class="list-row"><div class="lr-main"><b>${esc(f.name)}</b><small>${f.brand ? esc(f.brand) + ' · ' : ''}${fmt(f.per100.k)} kcal/100 g${f.barcode ? ' · ' + esc(f.barcode) : ''}</small></div>
          <button type="button" class="x" data-act="delete-food" data-id="${esc(f.id)}" aria-label="Elimina ${esc(f.name)}">✕</button></div>`).join('')
          : '<p class="hint">Qui compaiono i prodotti che scansioni o inserisci a mano, per ritrovarli subito la prossima volta.</p>'}
      </section>
      <section class="card">
        <h2>I tuoi dati</h2>
        <p class="hint" style="margin-bottom:10px">I dati restano solo su questo telefono. Fai un backup ogni tanto: se cancelli i dati del browser o disinstalli l'app, si perdono.</p>
        <div class="grid2">
          <button type="button" class="btn" data-act="export">Esporta backup</button>
          <button type="button" class="btn" data-act="import">Importa backup</button>
        </div>
        <input type="file" id="importFile" accept="application/json,.json" hidden>
      </section>
      <section class="card about">
        <h2>Informazioni</h2>
        <p><b>Alimenti:</b> valori per 100 g di parte edibile dalle Tabelle di composizione degli alimenti del CREA (Centro di ricerca Alimenti e Nutrizione). I carboidrati sono quelli "disponibili".</p>
        <p><b>Codici a barre:</b> i prodotti confezionati vengono cercati su Open Food Facts, un database collaborativo: confronta sempre con l'etichetta.</p>
        <p style="margin-bottom:0">Versione ${VERSION}</p>
      </section>`;
    updateGoalInfo();
  }
  function syncGoalDays() {
    document.querySelectorAll('#goalForm .day').forEach((b) => {
      const on = gDraft.days.includes(+b.dataset.d);
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
  }
  function readGoalForm() {
    return { k: parseNum($('#gk').value), p: parseNum($('#gp').value), c: parseNum($('#gc').value), f: parseNum($('#gf').value) };
  }
  function updateGoalInfo() {
    const el = $('#goalInfo'); if (!el) return;
    const v = readGoalForm();
    const auto = $('#gauto').checked;
    $('#gk').readOnly = auto;
    if ([v.p, v.c, v.f].some((x) => !Number.isFinite(x))) { el.textContent = auto ? 'Inserisci i macro: le kcal si calcolano da sole.' : ''; return; }
    const kk = 4 * v.p + 4 * v.c + 9 * v.f;
    if (auto) $('#gk').value = Math.round(kk);
    if (kk <= 0) { el.textContent = ''; return; }
    const pc = (x) => Math.round(x / kk * 100);
    el.innerHTML = auto
      ? `Kcal calcolate dai tuoi macro: <b>${fmt(kk)}</b> (P ${pc(4 * v.p)}% · C ${pc(4 * v.c)}% · G ${pc(9 * v.f)}%).`
      : `I macro valgono circa <b>${fmt(kk)} kcal</b> (P ${pc(4 * v.p)}% · C ${pc(4 * v.c)}% · G ${pc(9 * v.f)}%).`;
  }

  /* ================== MODALE: aggiungi ================== */
  const modal = $('#modal');
  let modalOpen = false;
  let screen = null; // 'add' | 'qty'
  const addState = { tab: 'search', q: '', meal: 'pranzo', prefill: null };
  let qtyCtx = null;

  function openModal() {
    if (modalOpen) return;
    modalOpen = true;
    history.pushState({ m: 1 }, '');
    modal.classList.add('open');
    document.body.classList.add('noscroll');
  }
  function closeModal() { if (modalOpen) history.back(); }
  function hideModal() {
    modalOpen = false; screen = null;
    stopScan();
    modal.classList.remove('open');
    document.body.classList.remove('noscroll');
    render();
  }
  window.addEventListener('popstate', () => { if (modalOpen) hideModal(); });

  function openAdd(meal) {
    addState.meal = meal || autoMeal();
    addState.tab = 'search'; addState.q = ''; addState.prefill = null;
    openModal();
    renderAdd();
  }

  function mealChips(active, act) {
    return `<div class="chips${act === 'qty-meal' ? ' meals' : ''}" role="group" aria-label="Pasto">${MEALS.map((m) => `<button type="button" class="chip${m.id === active ? ' on' : ''}" data-act="${act}" data-meal="${m.id}" aria-pressed="${m.id === active}">${m.name}</button>`).join('')}</div>`;
  }

  function renderAdd() {
    screen = 'add';
    modal.innerHTML = `
      <div class="mhead"><button type="button" class="icon" data-act="close" aria-label="Chiudi">✕</button><h2>Aggiungi a ${mealName(addState.meal).toLowerCase()}</h2></div>
      ${mealChips(addState.meal, 'meal-chip')}
      <div class="tabs" role="tablist">
        ${[['search', 'Cerca'], ['scan', 'Scansiona'], ['manual', 'Manuale']].map(([id, l]) => `<button type="button" role="tab" class="${addState.tab === id ? 'on' : ''}" aria-selected="${addState.tab === id}" data-act="tab" data-tab="${id}">${l}</button>`).join('')}
      </div>
      <div class="mbody" id="tabbody"></div>`;
    renderTab();
  }
  function renderTab() {
    stopScan();
    const body = $('#tabbody');
    if (addState.tab === 'search') renderSearch(body);
    else if (addState.tab === 'scan') renderScan(body);
    else renderManual(body);
  }

  /* ---- ricerca ---- */
  function foodRow(f) {
    foodIndex.set(f.key, f);
    const badge = f.src === 'crea' ? 'CREA' : f.src === 'off' ? 'Scansionato' : 'Mio';
    return `<button type="button" class="row" data-act="pick-food" data-key="${esc(f.key)}">
      <span class="r-main"><b>${esc(f.name)}</b><small>${f.brand ? esc(f.brand) + ' · ' : ''}<i class="badge ${f.src}">${badge}</i></small></span>
      <span class="r-side">${fmt(f.per100.k, 0)}<small> kcal/100 g</small></span></button>`;
  }
  function renderSearch(body) {
    body.innerHTML = `<div class="search-in"><input class="in" id="q" type="search" placeholder="Cerca un alimento (es. pasta, mela, yogurt)" autocomplete="off" autocapitalize="none" enterkeyhint="search" value="${esc(addState.q)}" aria-label="Cerca alimento"></div><div id="results"></div>`;
    const input = $('#q');
    const draw = () => {
      addState.q = input.value;
      const res = $('#results');
      const q = input.value.trim();
      if (!q) {
        const rec = recentFoods();
        const mine = [...S.foods].sort((a, b) => a.name.localeCompare(b.name, 'it')).map(customToFood);
        res.innerHTML = (rec.length ? `<div class="sec-title">Usati di recente</div>${rec.map(foodRow).join('')}` : '')
          + (mine.length ? `<div class="sec-title">I miei alimenti</div>${mine.map(foodRow).join('')}` : '')
          + (!rec.length && !mine.length ? `<div class="empty">Scrivi il nome di un alimento per cercarlo nelle tabelle CREA (${CREA.length} alimenti), oppure scansiona un codice a barre.</div>` : '');
        return;
      }
      const list = searchFoods(q);
      res.innerHTML = list.length ? list.map(foodRow).join('')
        : `<div class="empty">Nessun risultato per "${esc(q)}".<br><br><button type="button" class="btn" data-act="to-manual">Inserisci a mano</button></div>`;
    };
    input.addEventListener('input', draw);
    draw();
    if (!addState.q) setTimeout(() => { if (input.isConnected) input.focus(); }, 320);
  }

  /* ---- scansione codice a barre ---- */
  let stream = null; let scanning = false; let scanTimer = null; let detector = null;
  function stopScan() {
    scanning = false; clearTimeout(scanTimer);
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    const v = $('#cam'); if (v) v.srcObject = null;
  }
  function setScanMsg(html) { const el = $('#scanMsg'); if (el) el.innerHTML = html; }

  function renderScan(body) {
    body.innerHTML = `
      <div class="scanbox"><video id="cam" playsinline muted autoplay></video><div class="reticle"></div><button type="button" class="torch" id="torch" data-act="torch" aria-label="Accendi la torcia" hidden>🔦</button></div>
      <p class="scan-msg hint" id="scanMsg">Avvio della fotocamera…</p>
      <div class="field"><label for="codeIn">Oppure digita il codice a barre</label>
        <div class="inline"><input class="in" id="codeIn" inputmode="numeric" maxlength="14" placeholder="es. 8076800195057" autocomplete="off"><button type="button" class="btn" data-act="scan-code">Cerca</button></div></div>
      <div id="scanResult"></div>`;
    $('#codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleBarcode($('#codeIn').value.trim()); });
    startScan();
  }

  async function startScan() {
    detector = null;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setScanMsg('La fotocamera richiede una connessione protetta (HTTPS). Digita il codice qui sotto.'); return;
    }
    let jsReader = false;
    if ('BarcodeDetector' in window) {
      try {
        detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      } catch (e) {
        try { detector = new window.BarcodeDetector(); } catch (e2) { detector = null; }
      }
    }
    if (!detector) {
      // iPhone/Safari e altri browser senza lettore nativo: uso il lettore EAN integrato (barcode.js)
      if (window.EANScanner) { detector = window.EANScanner.createDetector(); jsReader = true; }
      else { setScanMsg('Scansione non disponibile su questo dispositivo. Digita il codice.'); return; }
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      const v = $('#cam');
      if (!v || screen !== 'add' || addState.tab !== 'scan') { stopScan(); return; }
      v.srcObject = stream; await v.play().catch(() => {});
      const track = stream.getVideoTracks()[0];
      try { const caps = track.getCapabilities ? track.getCapabilities() : {}; if (caps.torch) $('#torch').hidden = false; } catch (e) { /* torcia non disponibile */ }
      scanning = true;
      setScanMsg(jsReader ? 'Inquadra il codice a barre tenendo il telefono fermo, ben illuminato e a circa 10–20 cm.' : 'Inquadra il codice a barre della confezione.');
      tick();
    } catch (e) {
      stopScan();
      if (e && e.name === 'NotAllowedError') setScanMsg('Permesso alla fotocamera negato. Consentilo dalle impostazioni del sito (icona accanto all\'indirizzo) oppure digita il codice.');
      else if (e && e.name === 'NotFoundError') setScanMsg('Nessuna fotocamera trovata. Digita il codice qui sotto.');
      else setScanMsg('Non riesco ad avviare la fotocamera. Digita il codice qui sotto.');
    }
  }
  async function tick() {
    if (!scanning) return;
    const v = $('#cam');
    try {
      if (v && v.readyState >= 2) {
        const codes = await detector.detect(v);
        const hit = codes.find((c) => /^\d{8,14}$/.test(c.rawValue || ''));
        if (hit && scanning) { if (navigator.vibrate) navigator.vibrate(60); stopScan(); handleBarcode(hit.rawValue); return; }
      }
    } catch (e) { /* frame non leggibile, riprovo */ }
    scanTimer = setTimeout(tick, 160);
  }
  async function toggleTorch() {
    const track = stream && stream.getVideoTracks()[0]; const btn = $('#torch'); if (!track || !btn) return;
    const on = !btn.classList.contains('on');
    try { await track.applyConstraints({ advanced: [{ torch: on }] }); btn.classList.toggle('on', on); } catch (e) { toast('Torcia non disponibile'); }
  }

  const OFF_FIELDS = 'code,product_name,product_name_it,brands,nutriments,serving_quantity,product_quantity';
  function parseOFF(j, code) {
    // API v3: { status: 'success' | 'failure', result: { id: 'product_found' | 'product_not_found' }, product: {...} }
    if (!j || !j.product || j.status === 'failure' || j.status === 0) return null;
    const p = j.product; const n = p.nutriments || {};
    const g = (k) => { const x = parseFloat(n[k]); return Number.isFinite(x) ? x : null; };
    let kcal = g('energy-kcal_100g');
    if (kcal == null) { const kj = g('energy_100g'); if (kj != null) kcal = kj / 4.184; }
    const pr = g('proteins_100g'); const c = g('carbohydrates_100g'); const f = g('fat_100g');
    const name = String(p.product_name_it || p.product_name || '').trim();
    const brand = String(p.brands || '').split(',')[0].trim();
    if (kcal == null && pr == null && c == null && f == null) return { incomplete: true, name, brand };
    if (kcal == null) kcal = 4 * (pr || 0) + 4 * (c || 0) + 9 * (f || 0);
    const pack = parseFloat(p.product_quantity); const serving = parseFloat(p.serving_quantity);
    return {
      name: name || 'Prodotto ' + code, brand, barcode: code, src: 'off',
      per100: { k: kcal, p: pr || 0, c: c || 0, f: f || 0 },
      pack: Number.isFinite(pack) && pack > 0 ? pack : null,
      serving: Number.isFinite(serving) && serving > 0 ? serving : null,
    };
  }

  async function handleBarcode(raw) {
    const code = String(raw || '').replace(/\D/g, '');
    const out = $('#scanResult');
    if (code.length < 8) { if (out) out.innerHTML = '<div class="notice">Il codice deve avere almeno 8 cifre.</div>'; return; }
    stopScan();
    const local = S.foods.find((f) => f.barcode === code);
    if (local) { openQty({ mode: 'add', food: customToFood(local), meal: addState.meal, fromScan: true }); return; }
    if (out) out.innerHTML = `<p class="scan-msg">Cerco il prodotto <b>${esc(code)}</b>…</p>`;
    setScanMsg('');
    if (!navigator.onLine) { scanFail(code, 'Sei offline: non posso cercare il prodotto online.'); return; }
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 12000);
      const q = code.length === 12 ? '0' + code : code;
      const res = await fetch(`https://world.openfoodfacts.org/api/v3/product/${q}?fields=${OFF_FIELDS}`, { signal: ctl.signal });
      clearTimeout(to);
      if (res.status === 404) { scanFail(code, 'Prodotto non presente nel database Open Food Facts.'); return; }
      if (!res.ok) throw new Error('http ' + res.status);
      const prod = parseOFF(await res.json(), code);
      if (!prod) { scanFail(code, 'Prodotto non presente nel database Open Food Facts.'); return; }
      if (prod.incomplete) { scanFail(code, 'Il prodotto c\'è, ma senza valori nutrizionali.', prod); return; }
      const rec = { id: uid(), ...prod };
      S.foods = S.foods.filter((f) => f.barcode !== code); S.foods.push(rec); save();
      openQty({ mode: 'add', food: customToFood(rec), meal: addState.meal, fromScan: true });
    } catch (e) {
      scanFail(code, 'Non riesco a contattare il database (connessione assente o lenta).');
    }
  }
  function scanFail(code, why, prod) {
    const out = $('#scanResult'); if (!out) return;
    addState.prefill = { barcode: code, name: prod && prod.name ? prod.name : '' };
    out.innerHTML = `<div class="notice"><b>${esc(why)}</b><br>Codice ${esc(code)}. Puoi inserire i valori dell'etichetta a mano: li salvo e alla prossima scansione li ritrovi.</div>
      <div class="grid2"><button type="button" class="btn primary" data-act="to-manual" style="min-height:50px;font-size:1rem">Inserisci a mano</button><button type="button" class="btn" data-act="rescan">Scansiona ancora</button></div>`;
    setScanMsg('');
  }

  /* ---- inserimento manuale ---- */
  let manualMode = 'per100'; // 'per100' | 'qty'
  function renderManual(body) {
    const pre = addState.prefill || {};
    body.innerHTML = `
      <div class="field"><label for="mName">Nome alimento</label><input class="in" id="mName" autocomplete="off" placeholder="es. Fagioli in scatola" value="${esc(pre.name || '')}"></div>
      <div class="field"><label for="mGrams">Quantità mangiata (g)</label><input class="in" id="mGrams" inputmode="decimal" value="100"></div>
      <div class="seg" role="group" aria-label="I valori sono riferiti a">
        <button type="button" data-act="manual-mode" data-mode="per100" class="${manualMode === 'per100' ? 'on' : ''}">Valori ogni 100 g</button>
        <button type="button" data-act="manual-mode" data-mode="qty" class="${manualMode === 'qty' ? 'on' : ''}">Valori per la quantità</button>
      </div>
      <div class="seg-notes">
        <p data-note="per100" class="${manualMode === 'per100' ? 'on' : ''}"><b>Da etichetta:</b> numeri riferiti a 100 g. Li adatto ai grammi mangiati.</p>
        <p data-note="qty" class="${manualMode === 'qty' ? 'on' : ''}"><b>Totali:</b> numeri di tutto ciò che mangi. Li registro così come sono.</p>
      </div>
      <div class="field"><label for="mK">Calorie (kcal) <small>— se vuoto le calcolo dai macro</small></label><input class="in" id="mK" inputmode="decimal"></div>
      <div class="grid3">
        <div class="field"><label for="mF">Grassi (g)</label><input class="in" id="mF" inputmode="decimal"></div>
        <div class="field"><label for="mC">Carboidrati (g)</label><input class="in" id="mC" inputmode="decimal"></div>
        <div class="field"><label for="mP">Proteine (g)</label><input class="in" id="mP" inputmode="decimal"></div>
      </div>
      <label class="check"><input type="checkbox" id="mSave" checked> Salva tra i miei alimenti</label>
      <div id="manualErr"></div>
      <button type="button" class="btn primary" data-act="save-manual" style="margin-top:10px">Aggiungi al diario</button>`;
  }
  function saveManual() {
    const err = (m) => { $('#manualErr').innerHTML = `<div class="notice"><b>${esc(m)}</b></div>`; };
    const name = $('#mName').value.trim();
    const grams = parseNum($('#mGrams').value);
    const val = (id) => { const raw = $(id).value.trim(); return raw === '' ? 0 : parseNum(raw); };
    const kRaw = $('#mK').value.trim();
    let k = kRaw === '' ? NaN : parseNum(kRaw);
    const p = val('#mP'); const c = val('#mC'); const f = val('#mF');
    if (!name) return err('Scrivi il nome dell\'alimento.');
    if (!(grams > 0)) return err('Indica la quantità in grammi (maggiore di 0).');
    if ([p, c, f].some((x) => !Number.isFinite(x) || x < 0)) return err('I macro devono essere numeri positivi.');
    if (kRaw !== '' && !(k >= 0)) return err('Le calorie devono essere un numero positivo.');
    if (kRaw === '') { if (p + c + f === 0) return err('Inserisci almeno le calorie o i macro.'); k = 4 * p + 4 * c + 9 * f; }
    const factor = manualMode === 'qty' ? 100 / grams : 1;
    const per100 = { k: k * factor, p: p * factor, c: c * factor, f: f * factor };
    const barcode = (addState.prefill && addState.prefill.barcode) || '';  // presente solo se arrivo da una scansione non riconosciuta
    let key = 'tmp:' + uid(); let rec = null;
    if ($('#mSave').checked) {
      rec = { id: uid(), name, brand: '', barcode, src: 'custom', per100, serving: manualMode === 'qty' ? grams : null };
      if (barcode) S.foods = S.foods.filter((x) => x.barcode !== barcode);
      S.foods.push(rec); key = 'food:' + rec.id;
    }
    addEntry({ key, name, brand: '', src: 'custom', per100, grams, pack: null, serving: rec ? rec.serving : null }, addState.meal);
    addState.prefill = null;
    closeModal();
    toast('Aggiunto a ' + mealName(addState.meal).toLowerCase());
  }

  /* ---- quantità ---- */
  function openQty(ctx) {
    stopScan();
    const f = ctx.food;
    const defG = ctx.grams ?? f.serving ?? 100;
    qtyCtx = { ...ctx, grams: defG };
    screen = 'qty';
    renderQty();
  }
  function renderQty() {
    const c = qtyCtx; const f = c.food; const edit = c.mode === 'edit';
    const badge = f.src === 'crea' ? '<i class="badge crea">CREA</i>' : f.src === 'off' ? '<i class="badge off">Open Food Facts</i>' : '<i class="badge custom">Mio</i>';
    const chipsG = [50, 100, 150, 200].map((g) => ({ g, l: g + ' g' }));
    if (f.serving) chipsG.push({ g: f.serving, l: 'Porzione ' + fmt(f.serving, 1) + ' g' });
    if (f.pack) chipsG.push({ g: f.pack, l: 'Confezione ' + fmt(f.pack, 1) + ' g' });
    modal.innerHTML = `
      <div class="mhead"><button type="button" class="icon" data-act="back" aria-label="Indietro">←</button><h2>${edit ? 'Modifica' : 'Quantità'}</h2></div>
      <div class="mbody">
        <div class="food-title"><h3>${esc(f.name)}</h3><p>${f.brand ? esc(f.brand) + ' · ' : ''}${badge}</p></div>
        <p class="per100">Ogni 100 g: <b>${fmt(f.per100.k, 0)} kcal</b> · P ${fmt(f.per100.p, 1)} · C ${fmt(f.per100.c, 1)} · G ${fmt(f.per100.f, 1)}</p>
        <label class="lbl" for="grams">Quanto ne mangi?</label>
        <div class="gram-wrap">
          <button type="button" class="step" data-act="step" data-d="-10" aria-label="Diminuisci di 10 grammi">−</button>
          <div class="gram-box"><input id="grams" inputmode="decimal" value="${fmt(c.grams, 1).replace(/\./g, '')}" aria-label="Grammi"><span>g</span></div>
          <button type="button" class="step" data-act="step" data-d="10" aria-label="Aumenta di 10 grammi">+</button>
        </div>
        <div class="chips wrap" id="gchips">${chipsG.map((x) => `<button type="button" class="chip" data-act="chip-g" data-g="${x.g}">${x.l}</button>`).join('')}</div>
        <div class="card preview" aria-live="polite"><div class="pk" id="pk"></div>
          <div class="pm"><div class="p"><b id="pp"></b><span>Proteine</span></div><div class="c"><b id="pc"></b><span>Carboidrati</span></div><div class="f"><b id="pf"></b><span>Grassi</span></div></div></div>
        ${f.src === 'off' ? '<p class="hint">Valori da Open Food Facts (inseriti dagli utenti): se qualcosa non torna, confrontali con l\'etichetta.</p>' : ''}
        <div class="lbl" style="margin-top:12px">Pasto</div>
        ${mealChips(c.meal, 'qty-meal')}
      </div>
      <div class="mfoot">
        <button type="button" class="btn primary" id="saveBtn" data-act="save-entry"></button>
        ${edit ? '<button type="button" class="btn danger" data-act="delete-entry">Elimina dal diario</button>' : ''}
      </div>`;
    const input = $('#grams');
    input.addEventListener('input', updateQty);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveQty(); });
    updateQty();
    if (!edit) setTimeout(() => { input.focus(); input.select(); }, 300);
  }
  function currentGrams() { return parseNum($('#grams').value); }
  function updateQty() {
    const c = qtyCtx; const g = currentGrams(); const ok = g > 0 && g <= 20000;
    const v = ok ? scale(c.food.per100, g) : { k: 0, p: 0, c: 0, f: 0 };
    $('#pk').innerHTML = `${fmt(v.k, 0)} <small>kcal</small>`;
    $('#pp').textContent = fmt(v.p, 1) + ' g'; $('#pc').textContent = fmt(v.c, 1) + ' g'; $('#pf').textContent = fmt(v.f, 1) + ' g';
    const btn = $('#saveBtn');
    btn.disabled = !ok;
    btn.textContent = c.mode === 'edit' ? 'Salva modifiche' : 'Aggiungi a ' + mealName(c.meal).toLowerCase();
    document.querySelectorAll('#gchips .chip').forEach((el) => el.classList.toggle('on', ok && Math.abs(parseFloat(el.dataset.g) - g) < 0.001));
  }
  function setGrams(g) { const i = $('#grams'); i.value = String(Math.round(g * 10) / 10).replace('.', ','); updateQty(); }

  function addEntry(food, meal) {
    S.entries.push({
      id: uid(), ts: Date.now(), date: curDate, meal, key: food.key, name: food.name, brand: food.brand || '', src: food.src,
      per100: food.per100, grams: food.grams, pack: food.pack || null, serving: food.serving || null,
    });
    save();
  }
  function saveQty() {
    const c = qtyCtx; const g = currentGrams();
    if (!(g > 0 && g <= 20000)) return;
    const f = c.food;
    if (c.mode === 'edit') {
      const e = S.entries.find((x) => x.id === c.entryId);
      if (e) { e.grams = g; e.meal = c.meal; save(); }
      closeModal(); toast('Modifiche salvate');
    } else {
      addEntry({ key: f.key, name: f.name, brand: f.brand, src: f.src, per100: f.per100, grams: g, pack: f.pack, serving: f.serving }, c.meal);
      closeModal(); toast('Aggiunto a ' + mealName(c.meal).toLowerCase());
    }
  }
  function deleteEntry() {
    const idx = S.entries.findIndex((x) => x.id === qtyCtx.entryId);
    if (idx < 0) return;
    const [removed] = S.entries.splice(idx, 1); save();
    closeModal();
    toast('Alimento eliminato', { label: 'Annulla', fn: () => { S.entries.push(removed); save(); render(); } });
  }
  function editEntry(id) {
    const e = S.entries.find((x) => x.id === id); if (!e) return;
    const food = { key: e.key, name: e.name, brand: e.brand, src: e.src, per100: e.per100, pack: e.pack, serving: e.serving };
    openModal();
    openQty({ mode: 'edit', entryId: id, food, grams: e.grams, meal: e.meal });
  }

  /* ---------- backup ---------- */
  function exportData() {
    const blob = new Blob([JSON.stringify({ app: 'contacalorie', version: 1, exportedAt: new Date().toISOString(), data: S }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `contacalorie-backup-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Backup creato');
  }
  function importData(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const j = JSON.parse(rd.result); const d = j && j.data ? j.data : j;
        if (!d || !Array.isArray(d.entries)) throw new Error('formato');
        if (!confirm(`Importare il backup (${d.entries.length} voci)? I dati attuali verranno sostituiti.`)) return;
        S = { entries: d.entries, goals: normGoals(d.goals), foods: d.foods || [], weights: normWeights(d.weights), water: normWater(d.water) }; gDraft = null; save(); render(); toast('Backup importato');
      } catch (e) { toast('File di backup non valido'); }
    };
    rd.readAsText(file);
  }

  /* ---------- obiettivi: azioni ---------- */
  function saveGoals() {
    const v = readGoalForm(); const days = [...gDraft.days].sort();
    const auto = $('#gauto').checked;
    if (!days.length) return toast('Seleziona almeno un giorno');
    if ([v.p, v.c, v.f].some((x) => !Number.isFinite(x) || x < 0)) return toast('Controlla i valori dei macro');
    if (auto) v.k = 4 * v.p + 4 * v.c + 9 * v.f;
    if (!(v.k > 0 && v.k <= 20000)) return toast('Inserisci le calorie giornaliere');
    // i giorni scelti passano al nuovo obiettivo; gli altri obiettivi li perdono
    S.goals = S.goals.map((g) => ({ ...g, days: g.days.filter((x) => !days.includes(x)) })).filter((g) => g.days.length);
    S.goals.push({ id: uid(), days, k: Math.round(v.k), p: Math.round(v.p), c: Math.round(v.c), f: Math.round(v.f), auto });
    gDraft = null;
    save(); render(); toast('Obiettivi salvati: ' + daysLabel(days));
  }

  /* ---------- eventi ---------- */
  const handlers = {
    nav: (el) => { view = el.dataset.view; render(); window.scrollTo(0, 0); },
    'add-global': () => openAdd(),
    'add-meal': (el) => openAdd(el.dataset.meal),
    prev: () => { curDate = addDays(curDate, -1); render(); },
    next: () => { curDate = addDays(curDate, 1); render(); },
    today: () => { curDate = todayISO(); render(); },
    'edit-entry': (el) => editEntry(el.dataset.id),
    close: () => closeModal(),
    back: () => { if (screen === 'qty' && qtyCtx && qtyCtx.mode !== 'edit') renderAdd(); else closeModal(); },
    tab: (el) => { addState.tab = el.dataset.tab; renderAdd(); },
    'meal-chip': (el) => { addState.meal = el.dataset.meal; renderAdd(); },
    'qty-meal': (el) => { qtyCtx.meal = el.dataset.meal; document.querySelectorAll('[data-act="qty-meal"]').forEach((b) => { const on = b.dataset.meal === qtyCtx.meal; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); updateQty(); },
    'pick-food': (el) => { const f = foodIndex.get(el.dataset.key); if (f) openQty({ mode: 'add', food: f, meal: addState.meal }); },
    'to-manual': () => { addState.tab = 'manual'; renderAdd(); },
    rescan: () => { renderTab(); },
    'scan-code': () => handleBarcode($('#codeIn').value.trim()),
    torch: () => toggleTorch(),
    'manual-mode': (el) => { manualMode = el.dataset.mode; document.querySelectorAll('[data-act="manual-mode"]').forEach((b) => b.classList.toggle('on', b.dataset.mode === manualMode)); document.querySelectorAll('.seg-notes p').forEach((p) => p.classList.toggle('on', p.dataset.note === manualMode)); },
    'save-manual': () => saveManual(),
    'chip-g': (el) => setGrams(parseFloat(el.dataset.g)),
    step: (el) => { const g = currentGrams(); setGrams(Math.max(0, (Number.isFinite(g) ? g : 0) + parseFloat(el.dataset.d))); },
    'save-entry': () => saveQty(),
    'delete-entry': () => deleteEntry(),
    'save-goals': () => saveGoals(),
    'save-weight': () => saveWeight(),
    'water-add': (el) => {
      const add = parseFloat(el.dataset.l); const cur = S.water.find((x) => x.date === wtDate); const before = cur ? cur.l : 0;
      setWater(wtDate, before + add); render();
      toast('Aggiunti ' + fmtL(add) + ' l', { label: 'Annulla', fn: () => { setWater(wtDate, before); render(); } });
    },
    'save-water': () => saveWater(),
    'delete-water': (el) => {
      const w = S.water.find((x) => x.date === el.dataset.date); if (!w) return;
      S.water = S.water.filter((x) => x !== w); save(); render();
      toast('Acqua eliminata', { label: 'Annulla', fn: () => { S.water = normWater([...S.water, w]); save(); render(); } });
    },
    'delete-weight': (el) => {
      const w = S.weights.find((x) => x.date === el.dataset.date); if (!w) return;
      S.weights = S.weights.filter((x) => x !== w); save(); render();
      toast('Peso eliminato', { label: 'Annulla', fn: () => { S.weights = normWeights([...S.weights, w]); save(); render(); } });
    },
    'w-point': (el) => {
      const r = $('#wReadout'); if (r) r.innerHTML = `<b>${fmtKg(+el.dataset.kg)} kg</b> · ${longDate(el.dataset.date)}`;
    },
    'delete-goal': (el) => { S.goals = S.goals.filter((g) => g.id !== el.dataset.id); gDraft = null; save(); render(); toast('Obiettivo eliminato'); },
    'edit-goal': (el) => {
      const g = S.goals.find((x) => x.id === el.dataset.id); if (!g) return;
      gDraft = { days: [...g.days], k: g.k, p: g.p, c: g.c, f: g.f, auto: g.auto !== false };
      render(); window.scrollTo(0, 0);
    },
    'toggle-gday': (el) => {
      const i = +el.dataset.d; const d = gDraft.days;
      gDraft.days = d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort();
      syncGoalDays();
    },
    'gdays-set': (el) => {
      gDraft.days = el.dataset.set === 'week' ? [0, 1, 2, 3, 4] : el.dataset.set === 'weekend' ? [5, 6] : [...ALL_DAYS];
      syncGoalDays();
    },
    'delete-food': (el) => {
      const rec = S.foods.find((f) => f.id === el.dataset.id); if (!rec) return;
      S.foods = S.foods.filter((f) => f.id !== rec.id); save(); render();
      toast('Alimento rimosso dai tuoi alimenti', { label: 'Annulla', fn: () => { S.foods.push(rec); save(); render(); } });
    },
    export: () => exportData(),
    import: () => $('#importFile').click(),
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const h = handlers[el.dataset.act]; if (h) h(el, e);
  });
  document.addEventListener('input', (e) => {
    if (e.target.closest('#goalForm')) updateGoalInfo();
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'wdate') {
      const w = S.weights.find((x) => x.date === e.target.value); $('#wkg').value = w ? fmtKg(w.kg) : '';
    }
    if (e.target.id === 'adate' && e.target.value) { wtDate = e.target.value > todayISO() ? todayISO() : e.target.value; render(); }
    if (e.target.id === 'datePick') { if (e.target.value) { curDate = e.target.value; render(); } }
    if (e.target.id === 'importFile' && e.target.files[0]) { importData(e.target.files[0]); e.target.value = ''; }
  });

  /* ---------- render ---------- */
  /* ================== PESO ================== */
  const fmtKg = (n) => (Number.isFinite(n) ? n : 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // differenze esatte (nessun arrotondamento): si elimina solo il rumore dei numeri in virgola mobile
  const dz = (x) => (Math.abs(x) < 1e-9 ? 0 : x);
  const fmtD = (x) => (Math.abs(x) > 0 && Math.abs(x) < 0.005 ? 'meno di 0,01' : fmtKg(Math.abs(x)));
  const dayNum = (s) => Math.round(parseISO(s).getTime() / 86400000);
  const shortDate = (s) => parseISO(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }).replace('.', '');
  const longDate = (s) => parseISO(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
  const weekStart = (s) => addDays(s, -dayIdx(s));
  const sgn = (x) => (x > 0 ? '+' : x < 0 ? '−' : '');
  const dkg = (x) => sgn(x) + fmtD(x) + ' kg';
  function dayWord(date) {
    const n = dayNum(todayISO()) - dayNum(date);
    return n === 0 ? 'oggi' : n === 1 ? 'ieri' : longDate(date);
  }
  function weeklyAverages() {
    const m = new Map();
    for (const w of S.weights) { const k = weekStart(w.date); if (!m.has(k)) m.set(k, []); m.get(k).push(w.kg); }
    return [...m.entries()].map(([start, v]) => ({ start, n: v.length, avg: v.reduce((s, x) => s + x, 0) / v.length })).sort((x, y) => (x.start < y.start ? -1 : 1));
  }
  function weekLabel(start) { return shortDate(start) + ' – ' + shortDate(addDays(start, 6)); }

  function weightChart() {
    const t = todayISO();
    const data = S.weights;
    if (!data.length) return '<p class="hint">Il grafico compare appena inserisci un peso.</p>';
    const W = 360, H = 210, L = 40, R = 16, T = 18, B = 28;
    const kgs = data.map((d) => d.kg); const lo = Math.min(...kgs), hi = Math.max(...kgs);
    const span = Math.max(hi - lo, 1);
    const step = [0.5, 1, 2, 5, 10, 20].find((s) => span / s <= 4) || 20;
    const y0 = Math.floor((lo - 0.1) / step) * step, y1 = Math.max(Math.ceil((hi + 0.1) / step) * step, y0 + step);
    const d0 = dayNum(data[0].date), d1 = dayNum(data[data.length - 1].date);
    const X = (d) => (d1 === d0 ? L + (W - L - R) / 2 : L + ((dayNum(d) - d0) / (d1 - d0)) * (W - L - R));
    const Y = (kg) => T + (1 - (kg - y0) / (y1 - y0)) * (H - T - B);
    let grid = '';
    for (let v = y0; v <= y1 + 1e-9; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="wgrid"/><text x="${L - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${fmtKg(v)}</text>`;
    const pts = data.map((d) => `${X(d.date).toFixed(1)},${Y(d.kg).toFixed(1)}`);
    const dots = data.map((d, i) => `<circle cx="${X(d.date).toFixed(1)}" cy="${Y(d.kg).toFixed(1)}" r="${i === data.length - 1 ? 5 : 3.5}" class="wdot${i === data.length - 1 ? ' last' : ''}"/>
      <circle cx="${X(d.date).toFixed(1)}" cy="${Y(d.kg).toFixed(1)}" r="14" fill="transparent" data-act="w-point" data-i="${i}" data-date="${d.date}" data-kg="${d.kg}"/>`).join('');
    const mid = data.length > 2 ? data[Math.floor((data.length - 1) / 2)] : null;
    const xl = `<text x="${X(data[0].date).toFixed(1)}" y="${H - 8}" text-anchor="${data.length > 1 ? 'start' : 'middle'}">${shortDate(data[0].date)}</text>`
      + (data.length > 1 ? `<text x="${X(data[data.length - 1].date).toFixed(1)}" y="${H - 8}" text-anchor="end">${shortDate(data[data.length - 1].date)}</text>` : '')
      + (mid && X(mid.date) - X(data[0].date) > 60 && X(data[data.length - 1].date) - X(mid.date) > 60 ? `<text x="${X(mid.date).toFixed(1)}" y="${H - 8}" text-anchor="middle">${shortDate(mid.date)}</text>` : '');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafico del peso: ${data.length} pesate, da ${fmtKg(lo)} a ${fmtKg(hi)} kg">
      ${grid}${data.length > 1 ? `<polyline points="${pts.join(' ')}" class="wline"/>` : ''}${dots}${xl}</svg>
      <p class="hint wread" id="wReadout">Ultimo: <b>${fmtKg(data[data.length - 1].kg)} kg</b> · ${longDate(data[data.length - 1].date)}. Tocca un punto per vedere il valore.</p>`;
  }

  function renderWeight() {
    const t = todayISO();
    const ws = S.weights;
    const todayW = ws.find((w) => w.date === t);
    const last = ws[ws.length - 1];
    // confronto con la pesata precedente (giorno prima)
    let cmp = '<p class="hint">Inserisci il tuo primo peso per iniziare a seguire l\'andamento.</p>';
    if (last) {
      const prev = ws[ws.length - 2];
      let line = '<span class="wd flat">Primo peso registrato</span>';
      if (prev) {
        const diff = dz(last.kg - prev.kg);
        const when = dayNum(last.date) - dayNum(prev.date) === 1 ? 'ieri' : 'al ' + longDate(prev.date);
        line = diff > 0 ? `<span class="wd up">▲ Più alto di <b>${fmtD(diff)} kg</b> rispetto a ${when} (${fmtKg(prev.kg)} kg)</span>`
          : diff < 0 ? `<span class="wd down">▼ Più basso di <b>${fmtD(diff)} kg</b> rispetto a ${when} (${fmtKg(prev.kg)} kg)</span>`
          : `<span class="wd flat">= Uguale a ${when} (${fmtKg(prev.kg)} kg)</span>`;
      }
      cmp = `<div class="wbig"><b>${fmtKg(last.kg)}</b><span>kg</span><small>${dayWord(last.date)}</small></div>${line}`;
    }
    // medie settimanali (lun–dom)
    const wk = weeklyAverages();
    const cur = wk.find((x) => x.start === weekStart(t));
    const prevWk = wk.find((x) => x.start === addDays(weekStart(t), -7));
    let weekly;
    if (!cur && !prevWk) weekly = '<p class="hint">La media settimanale compare dopo le prime pesate.</p>';
    else {
      let res = '';
      if (cur && prevWk) {
        const diff = dz(cur.avg - prevWk.avg);
        res = diff > 0 ? `<span class="wd up">▲ Salita di <b>${fmtD(diff)} kg</b> rispetto alla settimana scorsa</span>`
          : diff < 0 ? `<span class="wd down">▼ Scesa di <b>${fmtD(diff)} kg</b> rispetto alla settimana scorsa</span>`
          : '<span class="wd flat">= Invariata rispetto alla settimana scorsa</span>';
      } else if (cur) res = '<span class="wd flat">Nessuna pesata la settimana scorsa: non c\'è un confronto.</span>';
      else res = '<span class="wd flat">Questa settimana non hai ancora inserito pesi.</span>';
      const cell = (lbl, x) => `<div><small>${lbl}</small><b>${x ? fmtKg(x.avg) + ' kg' : '—'}</b><em>${x ? x.n + (x.n === 1 ? ' pesata' : ' pesate') : 'nessuna pesata'}</em></div>`;
      weekly = `<div class="wcols">${cell('Questa settimana', cur)}${cell('Settimana scorsa', prevWk)}</div>${res}`;
    }
    const wkList = [...wk].reverse().slice(0, 8).map((x) => {
      const p = wk.find((y) => y.start === addDays(x.start, -7));
      const d = p ? dz(x.avg - p.avg) : null;
      return `<div class="list-row"><div class="lr-main"><b>${weekLabel(x.start)}</b><small>${x.n} ${x.n === 1 ? 'pesata' : 'pesate'}</small></div>
        <div class="wk-r"><b>${fmtKg(x.avg)} kg</b><small>${d === null ? '—' : d === 0 ? 'invariata' : (d > 0 ? '▲ ' : '▼ ') + fmtD(d) + ' kg'}</small></div></div>`;
    }).join('');
    const hist = [...ws].reverse().slice(0, 30).map((w, i, arr) => {
      const idx = ws.indexOf(w); const p = ws[idx - 1];
      const d = p ? dz(w.kg - p.kg) : null;
      return `<div class="list-row"><div class="lr-main"><b>${fmtKg(w.kg)} kg</b><small>${parseISO(w.date).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}${d === null ? '' : ' · ' + (d === 0 ? 'invariato' : dkg(d))}</small></div>
        <button type="button" class="x" data-act="delete-weight" data-date="${w.date}" aria-label="Elimina peso del ${w.date}">✕</button></div>`;
    }).join('');

    $('#app').innerHTML = `
      <section class="card">
        <h2>${todayW ? 'Peso di oggi (puoi aggiornarlo)' : 'Inserisci il peso di oggi'}</h2>
        <form id="weightForm" novalidate>
          <div class="field"><label for="wkg">Peso (kg)</label><input class="in" id="wkg" inputmode="decimal" placeholder="es. 72,45" value="${todayW ? fmtKg(todayW.kg) : ''}" autocomplete="off"></div>
          <div class="field"><label for="wdate">Data</label><input class="in" type="date" id="wdate" value="${t}" max="${t}"></div>
          <button type="button" class="btn primary" data-act="save-weight">Salva peso</button>
        </form>
      </section>
      <section class="card"><h2>Rispetto al giorno prima</h2>${cmp}</section>
      <section class="card"><h2>Media settimanale</h2>${weekly}<p class="hint" style="margin-top:8px">Le settimane vanno da lunedì a domenica.</p></section>
      <section class="card">
        <h2>Andamento</h2>
        <div class="wchart" id="wChart">${weightChart()}</div>
      </section>
      ${wkList ? `<section class="card"><h2>Medie delle settimane</h2>${wkList}</section>` : ''}
      ${hist ? `<section class="card"><h2>Storico pesi</h2>${hist}</section>` : ''}`;
  }
  function saveWeight() {
    const kg = parseNum($('#wkg').value); const date = $('#wdate').value || todayISO();
    if (!(kg >= 20 && kg <= 400)) return toast('Inserisci un peso valido (kg)');
    if (date > todayISO()) return toast('La data non può essere nel futuro');
    const kg1 = Math.round(kg * 100) / 100;   // si conservano due cifre decimali
    S.weights = normWeights([...S.weights.filter((w) => w.date !== date), { date, kg: kg1 }]);
    save(); render(); toast('Peso salvato: ' + fmtKg(kg1) + ' kg');
  }

  /* ================== ACQUA ================== */
  let wtDate = todayISO();
  const fmtL = (n) => (Number.isFinite(n) ? n : 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function setWater(date, l) {
    l = Math.round(l * 100) / 100;
    S.water = normWater([...S.water.filter((w) => w.date !== date), ...(l > 0 ? [{ date, l }] : [])]);
    save();
  }
  function renderWater() {
    const t = todayISO(); if (wtDate > t) wtDate = t;
    const cur = S.water.find((w) => w.date === wtDate); const lit = cur ? cur.l : 0;
    const recent = [...S.water].reverse().slice(0, 14);
    const mx = Math.max(...recent.map((w) => w.l), 0.01);
    const hist = recent.map((w) => `<div class="list-row lr-water"><div class="lr-main"><b>${fmtL(w.l)} l</b><small>${parseISO(w.date).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</small><div class="wbar"><i style="width:${(w.l / mx * 100).toFixed(1)}%"></i></div></div>
      <button type="button" class="x" data-act="delete-water" data-date="${w.date}" aria-label="Elimina acqua del ${w.date}">✕</button></div>`).join('');
    $('#app').innerHTML = `
      <section class="card">
        <h2>${wtDate === t ? 'Acqua bevuta oggi' : 'Acqua bevuta il ' + longDate(wtDate)}</h2>
        <div class="wbig wcenter"><div class="wnum"><b>${fmtL(lit)}</b><span>l</span></div>${wtDate === t ? '' : `<small>${dayWord(wtDate)}</small>`}</div>
        <div class="wquick" role="group" aria-label="Aggiungi acqua">
          <button type="button" class="btn" data-act="water-add" data-l="0.25">+0,25 l</button>
          <button type="button" class="btn" data-act="water-add" data-l="0.5">+0,5 l</button>
          <button type="button" class="btn" data-act="water-add" data-l="1">+1 l</button>
        </div>
        <form id="waterForm" novalidate>
          <div class="field"><label for="wl">Imposta il totale della giornata (litri)</label><input class="in" id="wl" inputmode="decimal" placeholder="es. 1,5" value="${cur ? fmtL(cur.l) : ''}" autocomplete="off"></div>
          <div class="field"><label for="adate">Data</label><input class="in" type="date" id="adate" value="${wtDate}" max="${t}"></div>
          <button type="button" class="btn primary" data-act="save-water">Salva acqua</button>
        </form>
      </section>
      ${hist ? `<section class="card"><h2>Ultimi giorni</h2>${hist}</section>` : '<section class="card"><p class="hint">Qui compare lo storico dell\'acqua bevuta giorno per giorno.</p></section>'}`;
  }
  function saveWater() {
    const l = parseNum($('#wl').value); const date = $('#adate').value || todayISO();
    if (!(l >= 0 && l <= 20)) return toast('Inserisci una quantità valida (litri)');
    if (date > todayISO()) return toast('La data non può essere nel futuro');
    wtDate = date; setWater(date, l); render();
    toast(l > 0 ? 'Acqua salvata: ' + fmtL(Math.round(l * 100) / 100) + ' l' : 'Acqua azzerata');
  }

  function render() {
    $('#nav-diary').classList.toggle('active', view === 'diary');
    $('#nav-goals').classList.toggle('active', view === 'goals');
    $('#nav-weight').classList.toggle('active', view === 'weight');
    $('#nav-water').classList.toggle('active', view === 'water');
    $('#nav-diary').setAttribute('aria-current', view === 'diary' ? 'page' : 'false');
    $('#nav-goals').setAttribute('aria-current', view === 'goals' ? 'page' : 'false');
    $('#nav-weight').setAttribute('aria-current', view === 'weight' ? 'page' : 'false');
    $('#nav-water').setAttribute('aria-current', view === 'water' ? 'page' : 'false');
    if (view === 'diary') renderDiary(); else if (view === 'weight') renderWeight(); else if (view === 'water') renderWater(); else renderGoals();
  }
  render();

  // il giorno cambia mentre l'app è aperta in background
  let lastDay = todayISO();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const t = todayISO();
      if (t !== lastDay) { if (curDate === lastDay) curDate = t; if (wtDate === lastDay) wtDate = t; lastDay = t; if (!modalOpen) render(); }
      if (modalOpen && screen === 'add' && addState.tab === 'scan' && !stream) startScan();
    } else { stopScan(); }
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
