// app.js — skjermer og logikk for Lurt?
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const { kr } = Verdict;

const state = {
  mode: 'barcode',
  chain: null, storeLabel: null,
  loc: null,
  product: null, shelfPrice: null, claimedBefore: null,
  period: 30,
  busy: false,
};

// ---------- Lagring ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('lurt.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lurt.' + k, JSON.stringify(v)); } catch { /* full */ } },
};
const settings = () => store.get('settings', {});
const saveSettings = (patch) => store.set('settings', { ...settings(), ...patch });

// ---------- Navigasjon ----------
function go(name) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'scr-' + name));
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.go === name || (name !== 'saved' && name !== 'settings' && b.dataset.go === 'scan')));
  if (name !== 'scan') Scan.stop(), camIdle();
  if (name === 'saved') renderSaved();
  if (name === 'settings') loadSettingsForm();
  window.scrollTo(0, 0);
}
$$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));

function status(msg, kind = '') {
  const el = $('#status');
  if (!msg) { el.classList.add('hidden'); return; }
  el.className = 'status ' + kind;
  el.innerHTML = msg;
}

function apiErrorText(e) {
  switch (e.code) {
    case 'nokey': return 'Du må legge inn en gratis API-nøkkel først. <a href="#" data-go-settings>Gå til innstillinger</a>';
    case 'auth': return 'API-nøkkelen ble avvist. Sjekk den i <a href="#" data-go-settings>innstillinger</a>.';
    case 'offline': return 'Du er uten nett. Varer du har sett før vises fortsatt.';
    case 'network': return 'Fikk ikke kontakt med Kassalapp. Prøv igjen – hvis det fortsetter, se «Avansert: proxy» i <a href="#" data-go-settings>innstillinger</a>.';
    default: return esc(e.message || 'Noe gikk galt');
  }
}
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-go-settings]')) { e.preventDefault(); go('settings'); }
});

// ---------- Butikk ----------
function setChain(chain, label) {
  state.chain = chain;
  state.storeLabel = label || API.chainName(chain) || chain;
  $('#storeName').textContent = state.storeLabel || 'Velg butikk';
  sessionStorage.setItem('lurt.chain', JSON.stringify({ chain, label: state.storeLabel }));
  if (state.product) renderResult();
}

function getLocation() {
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => res(null), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}

async function autoStore() {
  const saved = JSON.parse(sessionStorage.getItem('lurt.chain') || 'null');
  if (saved) { setChain(saved.chain, saved.label); }
  if (settings().autoStore === false || !settings().apiKey) return;
  const loc = await getLocation();
  if (!loc) return;
  state.loc = loc;
  try {
    const near = await API.nearbyStores(loc.lat, loc.lng, 0.4);
    state.near = near;
    const best = near[0];
    if (best && best.dist != null && best.dist < 0.2 && !saved) setChain(best.chain, best.name);
  } catch { /* stille */ }
}

async function openStoreDlg() {
  const dlg = $('#storeDlg');
  $('#chainList').innerHTML = API.CHAINS.map(([k, n]) =>
    `<button class="chip ${k === state.chain ? 'on' : ''}" value="${k}" data-chain="${k}">${esc(n)}</button>`).join('');
  $('#nearList').innerHTML = '<p class="muted small">Finner butikker i nærheten …</p>';
  dlg.showModal();
  if (!settings().apiKey) { $('#nearList').innerHTML = ''; return; }
  const loc = state.loc || await getLocation();
  if (!loc) { $('#nearList').innerHTML = '<p class="muted small">Fikk ikke tak i posisjonen.</p>'; return; }
  state.loc = loc;
  try {
    const near = await API.nearbyStores(loc.lat, loc.lng, 1.5);
    $('#nearList').innerHTML = near.length
      ? '<p class="muted small">I nærheten</p>' + near.slice(0, 6).map(s =>
        `<button class="near" data-chain="${esc(s.chain)}" data-label="${esc(s.name)}"><b>${esc(s.name)}</b><span>${s.dist != null ? fmtKm(s.dist) : ''}</span></button>`).join('')
      : '<p class="muted small">Ingen butikker funnet i nærheten.</p>';
  } catch (e) { $('#nearList').innerHTML = `<p class="muted small">${apiErrorText(e)}</p>`; }
}
$('#storeChip').addEventListener('click', openStoreDlg);
$('#storeDlg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-chain]');
  if (!b) return;
  e.preventDefault();
  setChain(b.dataset.chain, b.dataset.label);
  $('#storeDlg').close();
});
const fmtKm = (d) => d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1).replace('.', ',') + ' km';

// ---------- Skanning ----------
const HINTS = {
  barcode: 'Hold strekkoden inne i rammen – den leses automatisk.',
  label: 'Ta bilde av hyllelappen. Appen leser pris og navn (og strekkoden hvis den finnes).',
  product: 'Ta bilde av forsiden på varen. Strekkoden er sikrest – men navnet holder ofte.',
};
$$('.mode').forEach(b => b.addEventListener('click', () => {
  state.mode = b.dataset.mode;
  $$('.mode').forEach(x => x.classList.toggle('active', x === b));
  $('#modeHint').textContent = HINTS[state.mode];
  $('#shoot').classList.toggle('hidden', state.mode === 'barcode' || !Scan.running());
  $('#frame').className = 'frame ' + state.mode;
  if (Scan.running()) beginWatching();
}));

function camIdle() {
  $('#cam').classList.remove('live');
  $('#camMsg').textContent = 'Trykk for å starte kameraet';
  $('#camStart').classList.remove('hidden');
  $('#shoot').classList.add('hidden');
}

async function startCam() {
  try {
    $('#camMsg').textContent = 'Starter kamera …';
    $('#camStart').classList.add('hidden');
    await Scan.start($('#video'));
    $('#cam').classList.add('live');
    $('#camMsg').textContent = '';
    $('#shoot').classList.toggle('hidden', state.mode === 'barcode');
    beginWatching();
  } catch (e) {
    camIdle();
    status('Fikk ikke tilgang til kameraet. Gi tillatelse i nettleseren, eller bruk «Bilde fra galleri».', 'bad');
  }
}
$('#camStart').addEventListener('click', startCam);
$('#cam').addEventListener('click', (e) => { if (!Scan.running() && e.target !== $('#camStart')) startCam(); });

function beginWatching() {
  // Strekkoder leses i alle moduser – det er det sikreste
  Scan.watchBarcodes($('#video'), (ean) => {
    if (navigator.vibrate) navigator.vibrate(60);
    if (state.mode === 'label') return shootLabel(ean); // les også prisen på lappen
    Scan.stop(); camIdle();
    openEan(ean);
  });
}

$('#shoot').addEventListener('click', () => shootLabel());

async function shootLabel(knownEan) {
  if (state.busy) return;
  const canvas = Scan.snapshot($('#video'));
  Scan.stop(); camIdle();
  await analyzeImage(canvas, knownEan);
}

$('#filePick').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const canvas = await Scan.fileToCanvas(f);
  await analyzeImage(canvas);
});

async function analyzeImage(canvas, knownEan) {
  state.busy = true;
  try {
    status('Ser etter strekkode …');
    const ean = knownEan || await Scan.detectIn(canvas).catch(() => null);
    const wantText = state.mode !== 'barcode' || !ean;
    let read = { price: null, before: null, offer: false, query: '', ean: null };
    if (wantText) {
      status('Leser teksten i bildet … (første gang lastes en leser ned, ca. 10 MB)');
      const res = await Scan.ocr(canvas, (s, p) => {
        if (/loading|initializ/i.test(s)) status('Gjør klar tekstleser … ' + (p ? Math.round(p * 100) + ' %' : ''));
        if (/recogniz/i.test(s)) status('Leser teksten … ' + Math.round((p || 0) * 100) + ' %');
      });
      read = Label.parse(res);
    }
    const finalEan = ean || read.ean;
    const isLabel = state.mode === 'label';
    status('');
    if (finalEan) {
      return openEan(finalEan, { shelfPrice: isLabel ? read.price : null, claimedBefore: isLabel ? read.before : null });
    }
    if (!read.query) {
      status('Fant verken strekkode eller lesbar tekst. Prøv nærmere, med bedre lys – eller søk manuelt.', 'bad');
      return;
    }
    showPick(read.query, isLabel ? read : null);
  } catch (e) {
    status(e.code ? apiErrorText(e) : 'Klarte ikke å lese bildet: ' + esc(e.message), 'bad');
  } finally { state.busy = false; }
}

// Manuelt søk / strekkode
$('#manual').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#manualInput').value.trim();
  if (!q) return;
  const digits = q.replace(/\s/g, '');
  if (/^\d{8,14}$/.test(digits)) return openEan(Scan.normEan(digits));
  showPick(q, null);
});

// ---------- Velg vare ----------
let pendingRead = null;
async function showPick(q, read) {
  pendingRead = read;
  go('pick');
  $('#refineInput').value = q;
  const lr = $('#labelRead');
  if (read && (read.price || read.before)) {
    lr.classList.remove('hidden');
    lr.innerHTML = `Lest fra lappen: <b>${read.price ? kr(read.price) : '–'}</b>${read.before ? ` · før ${kr(read.before)}` : ''}${read.offer ? ' · <span class="tag">tilbud</span>' : ''}`;
  } else lr.classList.add('hidden');
  await runSearch(q);
}
$('#refine').addEventListener('submit', (e) => { e.preventDefault(); runSearch($('#refineInput').value.trim()); });

async function runSearch(q) {
  const ul = $('#pickList');
  if (!q) return;
  ul.innerHTML = '<li class="muted">Søker …</li>';
  try {
    const list = await API.search(q);
    if (!list.length) { ul.innerHTML = '<li class="muted">Ingen treff. Prøv færre eller andre ord (f.eks. merke + type).</li>'; return; }
    ul.innerHTML = list.map(p => {
      const lo = p.prices.length ? Math.min(...p.prices) : null;
      return `<li><button class="item" data-ean="${esc(p.ean)}">
        ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : '<div class="noimg">🛒</div>'}
        <div><b>${esc(p.name)}</b><span class="muted small">${esc(p.brand)}${lo != null ? ' · fra ' + kr(lo) : ''}</span></div>
      </button></li>`;
    }).join('');
  } catch (e) { ul.innerHTML = `<li class="status bad">${apiErrorText(e)}</li>`; }
}
$('#pickList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ean]');
  if (!b) return;
  openEan(b.dataset.ean, { shelfPrice: pendingRead && pendingRead.price, claimedBefore: pendingRead && pendingRead.before });
});

// ---------- Resultat ----------
async function openEan(ean, { shelfPrice = null, claimedBefore = null } = {}) {
  go('result');
  $('#result').innerHTML = '<div class="loading"><div class="spin"></div>Henter priser …</div>';
  try {
    const p = await API.byEan(ean);
    if (!p) {
      $('#result').innerHTML = `<div class="card"><h3>Fant ikke varen</h3><p>Strekkoden <code>${esc(ean)}</code> finnes ikke hos Kassalapp. Prøv å søke på navnet i stedet.</p></div>`;
      return;
    }
    state.product = p; state.shelfPrice = shelfPrice; state.claimedBefore = claimedBefore;
    state.period = 30;
    renderResult();
    addHistory(p);
  } catch (e) {
    $('#result').innerHTML = `<div class="status bad">${apiErrorText(e)}</div>`;
  }
}

const LEVEL = {
  good: { emoji: '😎', title: 'Lurt kjøp!', sub: 'Dette er en god pris.' },
  ok: { emoji: '🤔', title: 'Helt grei pris', sub: 'Ikke et kupp, men heller ikke lurt.' },
  bad: { emoji: '🤡', title: 'Du blir lurt!', sub: 'Dette får du billigere.' },
  unknown: { emoji: '🧐', title: 'Lurt?', sub: '' },
};

function renderResult() {
  const p = state.product;
  if (!p) return;
  const a = Verdict.analyze({ product: p, chain: state.chain, shelfPrice: state.shelfPrice, claimedBefore: state.claimedBefore });
  const L = LEVEL[a.level];
  const watched = store.get('watch', []).some(w => w.ean === p.ean);
  const size = p.weight ? `${String(p.weight).replace('.', ',')} ${p.weightUnit || ''}` : '';
  const noChain = !state.chain;

  $('#result').innerHTML = `
    <div class="prod">
      ${p.image ? `<img src="${esc(p.image)}" alt="">` : '<div class="noimg big">🛒</div>'}
      <div>
        <h2>${esc(p.name)}</h2>
        <p class="muted small">${esc([p.brand, size, p.category].filter(Boolean).join(' · '))}</p>
        ${p.stale ? '<p class="small tag warn">Uten nett – viser lagrede priser</p>' : ''}
      </div>
    </div>

    <div class="verdict ${a.level}">
      <div class="v-emoji">${L.emoji}</div>
      <div class="v-text">
        <div class="v-title">${noChain && a.level === 'unknown' ? 'Hvor står du?' : L.title}</div>
        <div class="v-sub">${noChain && a.level === 'unknown' ? 'Velg butikken øverst, eller skriv inn hyllepris under.' : L.sub}</div>
      </div>
      ${a.score != null ? `<div class="meter"><i style="left:${a.score}%"></i></div>` : ''}
    </div>

    <div class="pricebox">
      <div>
        <span class="muted small">${state.shelfPrice != null ? 'Hyllepris' : 'Pris hos ' + esc(state.storeLabel || '…')}</span>
        <div class="bigprice">${a.price != null ? kr(a.price) : '–'}</div>
        ${a.mine && a.mine.unitPrice ? `<span class="muted small">${kr(a.mine.unitPrice)} per ${unitWord(p)}</span>` : ''}
      </div>
      <button id="editShelf" class="btn ghost small" type="button">${state.shelfPrice != null ? 'Endre' : 'Skriv hyllepris'}</button>
    </div>

    <ul class="reasons">${a.reasons.map(r => `<li class="${r.type}">${esc(r.text)}</li>`).join('')}</ul>

    <div class="card">
      <div class="card-head"><h3>Prishistorikk${a.mine ? ' – ' + esc(a.mine.chainName) : ''}</h3></div>
      <div class="periods">${[[30, '1 mnd'], [90, '3 mnd'], [180, '6 mnd'], [365, '1 år'], [0, 'Alt']].map(([d, t]) =>
        `<button class="chip ${state.period === d ? 'on' : ''}" data-period="${d}">${t}</button>`).join('')}</div>
      ${chartSvg(p, a.mine ? a.mine.chain : null, state.period)}
      <p class="legend"><span class="sw mine"></span>${esc(a.mine ? a.mine.chainName : 'Valgt butikk')} <span class="sw other"></span>Andre kjeder</p>
      ${changesHtml(a.mine, state.period)}
    </div>

    <div class="card">
      <h3>Pris i andre kjeder nå</h3>
      ${othersHtml(p, a)}
      <div id="nearCheap"></div>
    </div>

    <div class="row">
      <button id="watchBtn" class="btn ${watched ? 'ghost' : 'primary'}" type="button">${watched ? '★ Følger' : '☆ Følg prisen'}</button>
      <button class="btn ghost" data-go="scan" type="button">📷 Skann ny</button>
    </div>
    <p class="muted small center">Strekkode ${esc(p.ean)} · priser fra <a href="https://kassal.app" target="_blank" rel="noopener">Kassalapp</a>${p.demo ? ' · <b>EKSEMPELDATA</b>' : ''}</p>
  `;

  $$('[data-period]', $('#result')).forEach(b => b.addEventListener('click', () => { state.period = Number(b.dataset.period); renderResult(); }));
  $('#editShelf').addEventListener('click', () => {
    const v = prompt('Pris på hyllelappen (kr):', state.shelfPrice != null ? String(state.shelfPrice).replace('.', ',') : '');
    if (v === null) return;
    const n = Number(v.replace(/[^\d,.]/g, '').replace(',', '.'));
    state.shelfPrice = v.trim() && !isNaN(n) && n > 0 ? n : null;
    renderResult();
  });
  $('#watchBtn').addEventListener('click', () => toggleWatch(p, a));
  $$('#result [data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  nearestCheap(a);
}

function unitWord(p) {
  const u = (p.weightUnit || '').toLowerCase();
  return u === 'l' || u === 'ml' || u === 'cl' ? 'liter' : u === 'stk' ? 'stk' : 'kg';
}

function othersHtml(p, a) {
  const all = p.offers.filter(o => o.price != null).sort((x, y) => x.price - y.price);
  if (!all.length) return '<p class="muted">Ingen priser funnet.</p>';
  const ref = a.price;
  return `<table class="prices">${all.map((o, i) => {
    const d = ref != null ? o.price - ref : null;
    const mine = a.mine && o.chain === a.mine.chain;
    return `<tr class="${mine ? 'mine' : ''}">
      <td>${i === 0 ? '🏆 ' : ''}${esc(o.chainName)}${mine ? ' <span class="tag">her</span>' : ''}</td>
      <td class="num">${kr(o.price)}</td>
      <td class="num diff ${d == null || mine ? '' : d < -0.009 ? 'neg' : d > 0.009 ? 'pos' : ''}">${d == null || mine ? '' : (d > 0 ? '+' : '') + d.toFixed(2).replace('.', ',')}</td>
    </tr>`;
  }).join('')}</table>
  ${all[0].priceDate ? `<p class="muted small">Prisene er sist oppdatert ${Verdict.dato(new Date(Math.max(...all.filter(o => o.priceDate).map(o => o.priceDate.getTime()))))}</p>` : ''}`;
}

async function nearestCheap(a) {
  const others = a.others || [];
  if (!others.length || !state.loc || state.product.demo) return;
  const cheapest = others[0];
  if (a.price != null && cheapest.price >= a.price - 0.5) return;
  try {
    const near = await API.nearbyStores(state.loc.lat, state.loc.lng, 5);
    const s = near.find(x => x.chain === cheapest.chain);
    if (s && $('#nearCheap')) {
      $('#nearCheap').innerHTML = `<p class="small">📍 Nærmeste ${esc(cheapest.chainName)}: <b>${esc(s.name)}</b>${s.dist != null ? ' (' + fmtKm(s.dist) + ')' : ''}</p>`;
    }
  } catch { /* ok */ }
}

// ---------- Graf ----------
function chartSvg(p, mineKey, days) {
  const now = Date.now(), DAY = Verdict.DAY;
  const offers = p.offers.filter(o => o.history.length || o.price != null);
  if (!offers.length) return '<p class="muted">Ingen historikk.</p>';
  let t0;
  if (days) t0 = now - days * DAY;
  else t0 = Math.min(...offers.flatMap(o => o.history.map(h => h.date.getTime())), now - 30 * DAY);
  const W = 340, H = 170, pl = 44, pr = 8, pt = 10, pb = 22;
  const series = offers.map(o => {
    const hist = o.history.length ? o.history : [{ date: new Date(now), price: o.price }];
    const pts = [];
    const start = Verdict.priceAt(hist, t0);
    if (start != null) pts.push([t0, start]);
    for (const h of hist) { const t = h.date.getTime(); if (t > t0 && t <= now) pts.push([t, h.price]); }
    if (pts.length) pts.push([now, pts[pts.length - 1][1]]);
    return { o, pts, mine: o.chain === mineKey };
  }).filter(s => s.pts.length);
  const ys = series.flatMap(s => s.pts.map(p => p[1]));
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y1 - y0 < 1) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.1; y0 -= pad; y1 += pad;
  const X = t => pl + (t - t0) / (now - t0) * (W - pl - pr);
  const Y = v => pt + (1 - (v - y0) / (y1 - y0)) * (H - pt - pb);
  const path = pts => pts.map((p, i) => i === 0 ? `M${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`
    : `H${X(p[0]).toFixed(1)}V${Y(p[1]).toFixed(1)}`).join('');
  const ticks = [y0 + pad, (y0 + y1) / 2, y1 - pad];
  const mine = series.find(s => s.mine);
  const lines = series.filter(s => !s.mine).map(s => `<path d="${path(s.pts)}" class="ln other"/>`).join('')
    + (mine ? `<path d="${path(mine.pts)}" class="ln mine"/>` + mine.pts.slice(0, -1).map(p => `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="2.5" class="dot"/>`).join('') : '');
  const d = (t) => new Date(t).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Prisgraf">
    ${ticks.map(v => `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${pl - 6}" y="${Y(v) + 4}" class="ax" text-anchor="end">${Math.round(v)}</text>`).join('')}
    ${lines}
    <text x="${pl}" y="${H - 6}" class="ax">${d(t0)}</text>
    <text x="${W - pr}" y="${H - 6}" class="ax" text-anchor="end">i dag</text>
  </svg>`;
}

function changesHtml(mine, days) {
  if (!mine) return '<p class="muted small">Velg butikk øverst for å se historikken der.</p>';
  const t0 = days ? Date.now() - days * Verdict.DAY : 0;
  const ch = Verdict.changes(mine.history).filter(c => c.date.getTime() >= t0).reverse();
  if (!ch.length) return `<p class="muted small">Ingen prisendringer i perioden.</p>`;
  return `<details class="changes"><summary>${ch.length} prisendring${ch.length > 1 ? 'er' : ''} i perioden</summary><ul>${ch.slice(0, 20).map(c =>
    `<li><span>${Verdict.dato(c.date)}</span> ${kr(c.from)} → <b>${kr(c.to)}</b> <span class="${c.to > c.from ? 'pos' : 'neg'}">${c.to > c.from ? '▲' : '▼'}</span></li>`).join('')}</ul></details>`;
}

// ---------- Følger / historikk ----------
function lowest(p) { const v = p.offers.map(o => o.price).filter(x => x != null); return v.length ? Math.min(...v) : null; }

function toggleWatch(p, a) {
  let w = store.get('watch', []);
  if (w.some(x => x.ean === p.ean)) w = w.filter(x => x.ean !== p.ean);
  else w.unshift({ ean: p.ean, name: p.name, image: p.image, low: lowest(p), price: a.price, t: Date.now() });
  store.set('watch', w);
  renderResult();
}

function addHistory(p) {
  if (p.demo) return;
  const h = store.get('history', []).filter(x => x.ean !== p.ean);
  h.unshift({ ean: p.ean, name: p.name, image: p.image, t: Date.now() });
  store.set('history', h.slice(0, 30));
}

async function renderSaved() {
  const w = store.get('watch', []);
  const h = store.get('history', []);
  const item = (x, extra = '') => `<li><button class="item" data-open="${esc(x.ean)}">
    ${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy">` : '<div class="noimg">🛒</div>'}
    <div><b>${esc(x.name)}</b><span class="muted small" data-extra="${esc(x.ean)}">${extra}</span></div></button></li>`;
  $('#watchList').innerHTML = w.length ? w.map(x => item(x, x.low != null ? 'Billigst da du la til: ' + kr(x.low) : '')).join('')
    : '<li class="muted small">Du følger ingen varer ennå. Trykk «Følg prisen» på en vare.</li>';
  $('#histList').innerHTML = h.length ? h.map(x => item(x, new Date(x.t).toLocaleDateString('nb-NO'))).join('')
    : '<li class="muted small">Ingenting skannet ennå.</li>';
  // Oppdater fulgte varer (maks 15 for å spare på oppslag)
  for (const x of w.slice(0, 15)) {
    try {
      const p = await API.byEan(x.ean);
      const lo = p && lowest(p);
      const el = $(`#watchList [data-extra="${CSS.escape(x.ean)}"]`);
      if (!el || lo == null) continue;
      const d = x.low != null ? lo - x.low : 0;
      el.innerHTML = `Billigst nå: <b>${kr(lo)}</b>` + (Math.abs(d) >= 0.5 ? ` <span class="${d < 0 ? 'neg' : 'pos'}">${d < 0 ? '▼' : '▲'} ${kr(Math.abs(d))}</span>` : '');
    } catch { break; }
  }
}
['#watchList', '#histList'].forEach(s => $(s).addEventListener('click', (e) => {
  const b = e.target.closest('[data-open]');
  if (b) openEan(b.dataset.open);
}));

// ---------- Innstillinger ----------
function loadSettingsForm() {
  const s = settings();
  $('#apiKey').value = s.apiKey || '';
  $('#proxy').value = s.proxy || '';
  $('#autoStore').checked = s.autoStore !== false;
}
$('#saveKey').addEventListener('click', async () => {
  saveSettings({ apiKey: $('#apiKey').value.trim() });
  const st = $('#keyStatus');
  st.textContent = 'Tester …'; st.className = 'small';
  try {
    await API.test();
    st.textContent = '✅ Det virker! Gå til Skann og prøv en vare.'; st.className = 'small good';
    refreshDemoBtn(); autoStore();
  } catch (e) { st.innerHTML = '❌ ' + apiErrorText(e); st.className = 'small bad'; }
});
$('#saveProxy').addEventListener('click', () => { saveSettings({ proxy: $('#proxy').value.trim() }); alert('Lagret'); });
$('#autoStore').addEventListener('change', (e) => saveSettings({ autoStore: e.target.checked }));
$('#clearCache').addEventListener('click', () => { API.clearCache(); alert('Lagrede priser er slettet.'); });
$('#clearHist').addEventListener('click', () => { store.set('history', []); alert('Historikken er slettet.'); });

// ---------- Oppstart ----------
function refreshDemoBtn() {
  const hasKey = !!settings().apiKey;
  $('#demoBtn').classList.toggle('hidden', hasKey);
  if (!hasKey) status('For å hente ekte priser trenger du en gratis nøkkel fra Kassalapp. <a href="#" data-go-settings>Sett opp (2 min)</a>', 'info');
  else status('');
}
$('#demoBtn').addEventListener('click', () => { if (!state.chain) setChain('kiwi', 'Kiwi (demo)'); openEan(API.DEMO_EAN); });

refreshDemoBtn();
autoStore();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
