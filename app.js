// app.js — skjermer og logikk for Lurt?
'use strict';

const APP_VERSION = '2.0.2';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const { kr } = Verdict;

const state = {
  mode: 'barcode', close: false, macro: false,
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
  if (!msg) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.className = 'status ' + kind;
  el.innerHTML = msg;
}

function apiErrorText(e) {
  switch (e.code) {
    case 'nokey': return 'Prisdata er ikke koblet til ennå.';
    case 'auth': return 'Kassalapp avviste tilgangen. Prøv igjen senere.';
    case 'offline': return 'Du er uten nett. Varer du har sett før vises fortsatt.';
    case 'network': return 'Fikk ikke kontakt med Kassalapp. Sjekk nettet og prøv igjen.';
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

// Sjekker om posisjon allerede er tillatt
async function geoGranted() {
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted'; }
  catch { return false; }
}
async function autoStore({ ask = false } = {}) {
  const saved = JSON.parse(sessionStorage.getItem('lurt.chain') || 'null');
  if (saved) { setChain(saved.chain, saved.label); }
  if (settings().autoStore === false || !API.access().ready) return;
  if (state.chain && state.loc) return;
  if (!ask && !(await geoGranted())) return;
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
  if (!API.access().ready) { $('#nearList').innerHTML = ''; return; }
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
  label: 'Hold telefonen rett foran lappen så den fyller rammen, og trykk «Les lappen». Unngå gjenskinn.',
};
$$('.mode').forEach(b => b.addEventListener('click', () => {
  state.mode = b.dataset.mode;
  $$('.mode').forEach(x => x.classList.toggle('active', x === b));
  $('#modeHint').textContent = HINTS[state.mode];
  $('#shoot').classList.toggle('hidden', state.mode === 'barcode' || !Scan.running());
  $('#frame').className = 'frame ' + state.mode;
  const wantClose = state.mode === 'label';
  if (wantClose !== state.close) setClose(wantClose).then(() => Scan.running() && beginWatching());
  else if (Scan.running()) beginWatching();
}));

let torchOn = false;
function camIdle() {
  $('#lens').classList.add('hidden');
  torchOn = false; $('#torch').classList.add('hidden'); $('#torch').classList.remove('on');
  $('#cam').classList.remove('live');
  $('#camMsg').textContent = 'Trykk for å starte kameraet';
  $('#camStart').classList.remove('hidden');
  $('#shoot').classList.add('hidden');
}

async function startCam() {
  if (!state.chain) autoStore({ ask: true });
  try {
    $('#camMsg').textContent = 'Starter kamera …';
    $('#camStart').classList.add('hidden');
    const r = await Scan.start($('#video'), { close: state.close });
    state.macro = r.macro;
    updateLens();
    $('#cam').classList.add('live');
    $('#camMsg').textContent = '';
    $('#shoot').classList.toggle('hidden', state.mode === 'barcode');
    $('#torch').classList.toggle('hidden', !Scan.torchSupported());
    beginWatching();
  } catch (e) {
    camIdle();
    status('Fikk ikke tilgang til kameraet. Gi tillatelse i nettleseren, eller bruk «Bilde fra galleri».', 'bad');
  }
}
$('#camStart').addEventListener('click', startCam);

// Nærbilde: makrolinse hvis telefonen har det, ellers 2× zoom. Byttes med ett trykk.
function updateLens() {
  const b = $('#lens');
  const hasZoom = !!Scan.zoomRange(), info = Scan.cameraInfo();
  const canClose = (info && info.macroId) || hasZoom;
  b.classList.toggle('hidden', !Scan.running() || !canClose);
  b.classList.toggle('on', state.close);
  b.textContent = state.close ? (state.macro ? '🔬 Makro' : '🔍 ' + (Math.round(Scan.getZoom() * 10) / 10).toString().replace('.', ',') + '×') : '🔍 Nær';
}
async function setClose(on) {
  state.close = on;
  if (!Scan.running()) return updateLens();
  const info = Scan.cameraInfo();
  if (info && info.macroId) { Scan.stop(); await startCam(); return; } // bytt linse
  await Scan.setZoom(on ? 2 : 1).catch(() => {});
  updateLens();
}
$('#lens').addEventListener('click', (e) => { e.stopPropagation(); setClose(!state.close); });
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
$('#torch').addEventListener('click', async (e) => {
  e.stopPropagation();
  torchOn = !torchOn;
  try { await Scan.setTorch(torchOn); } catch { torchOn = false; }
  $('#torch').classList.toggle('on', torchOn);
});

async function shootLabel(knownEan) {
  if (state.busy) return;
  state.busy = true;
  status('Hold stødig …');
  let shot;
  try { shot = await Scan.capture($('#video'), $('#frame')); }
  finally { state.busy = false; }
  Scan.stop(); camIdle();
  await analyzeImage(shot.full, knownEan, shot.crop);
}

$('#filePick').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const canvas = await Scan.fileToCanvas(f);
  await analyzeImage(canvas);
});

// Lokal tekstlesing (reserve når KI-lesing ikke er satt opp eller ikke svarer)
async function readLocal(img) {
  status('Leser teksten på lappen …');
  const res = await Scan.ocr(img, (s, p) => {
    if (/loading|initializ/i.test(s)) status('Gjør klar tekstleser … ' + (p ? Math.round(p * 100) + ' %' : ''));
  });
  const read = Label.parse(res);
  const bd = Brands.detect(read.words);
  read.brands = bd.brands;
  read.words = [...bd.brands, ...bd.words.filter(w => !bd.brands.includes(w))].slice(0, 8);
  read.source = 'local';
  return read;
}

// KI-lesing → samme format som lokal lesing
function fromAI(r) {
  const seen = new Set();
  const words = [r.brand, ...(r.search || '').split(/\s+/), ...(r.product || '').split(/\s+/)]
    .filter(w => w && w.length >= 2 && !/^\d+([.,]\d+)?$/.test(w))
    .filter(w => { const k = w.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 8);
  return {
    price: r.price, before: r.before && r.price && r.before > r.price ? r.before : null, offer: r.offer || !!r.before,
    unitPrice: r.unitPrice, unit: r.unit, multi: r.multi, size: r.size,
    product: r.product, brands: r.brand ? [r.brand] : [], words,
    query: r.search || [r.brand, r.product].filter(Boolean).join(' '),
    ean: r.ean && Scan.validEan(Scan.normEan(r.ean)) ? Scan.normEan(r.ean) : null,
    source: 'ai',
  };
}

async function analyzeImage(canvas, knownEan, crop) {
  state.busy = true;
  const img = crop || canvas;
  try {
    status('Ser etter strekkode …');
    const ean = knownEan || await Scan.detectIn(img).catch(() => null) || (crop ? await Scan.detectIn(canvas).catch(() => null) : null);
    if (state.mode === 'barcode') {
      if (ean) { status(''); return openEan(ean); }
      status('Fant ingen strekkode i bildet. Prøv igjen, eller bytt til «Hyllelapp».', 'bad');
      return;
    }
    let read = null, aiFailed = null;
    if (AI.enabled()) {
      status('Leser lappen …');
      try {
        const r = await AI.readLabel(img);
        if (r.readable && (r.price || r.product)) read = fromAI(r);
        else aiFailed = 'unreadable';
      } catch (e) { aiFailed = e.quota ? 'quota' : 'error'; console.warn('KI-lesing', e); }
    }
    if (!read) read = await readLocal(img);
    read.aiFailed = aiFailed;
    const finalEan = ean || read.ean;
    status('');
    if (finalEan) return openEan(finalEan, { shelfPrice: read.price, claimedBefore: read.before });
    if (!read.words.length && !read.query) {
      status(aiFailed === 'unreadable'
        ? 'Klarte ikke å lese lappen. Gå nærmere så lappen fyller rammen, hold stødig og unngå gjenskinn.'
        : 'Fant ingen tydelig tekst. Gå nærmere så lappen fyller rammen, og unngå gjenskinn.', 'bad');
      return;
    }
    read.preview = img.toDataURL('image/jpeg', 0.7);
    showPick(read, true);
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
  showPick({ words: [], query: q, manual: true }, false);
});

// ---------- Velg vare ----------
let pendingRead = null, chosenWords = [], pendingBrands = [];
const priceInput = (v) => v != null ? String(v.toFixed(2)).replace('.', ',') : '';
async function showPick(read, isLabel) {
  pendingRead = isLabel ? read : null;
  pendingBrands = read.brands || [];
  go('pick');
  const lr = $('#labelRead');
  const bits = [];
  if (read.preview) bits.push(`<img class="readprev" src="${read.preview}" alt="Bildet som ble lest">`);
  if (isLabel) {
    const info = [read.product && `<b>${esc(read.product)}</b>`, read.size && esc(read.size)].filter(Boolean).join(' · ');
    if (info) bits.push(info);
    bits.push(`<div class="readprice">
      <label>Pris <input id="rdPrice" inputmode="decimal" value="${priceInput(read.price)}" placeholder="–"> kr</label>
      <label>Før <input id="rdBefore" inputmode="decimal" value="${priceInput(read.before)}" placeholder="–"> kr</label>
    </div>${read.offer ? '<span class="tag">tilbud</span> ' : ''}${read.multi ? `<span class="tag">${esc(read.multi)}</span> ` : ''}${
      read.unitPrice ? `<span class="small muted">${esc(String(read.unitPrice).replace('.', ','))} kr/${esc(read.unit || 'kg')}</span>` : ''}`);
    if (read.aiFailed === 'quota') bits.push('<span class="small muted">⚠️ Dagens gratiskvote for KI-lesing er brukt opp – lest lokalt i stedet.</span>');
    else if (read.aiFailed === 'error') bits.push('<span class="small muted">⚠️ KI-lesing svarte ikke – lest lokalt i stedet.</span>');
  }
  chosenWords = read.manual ? [] : (read.source === 'ai' ? read.query.split(/\s+/) : read.words.slice(0, 3));
  if (read.words.length) {
    bits.push(`<span class="small muted">Søkeord – trykk for å slå av/på:</span><div class="chips words">${
      read.words.map(w => `<button class="chip ${chosenWords.some(c => c.toLowerCase() === w.toLowerCase()) ? 'on' : ''}" data-word="${esc(w)}">${pendingBrands.includes(w) ? '🏷️ ' : ''}${esc(w)}</button>`).join('')}</div>`);
  }
  lr.classList.toggle('hidden', !bits.length);
  lr.innerHTML = bits.map(b => `<div class="rd">${b}</div>`).join('');
  const q = read.manual ? read.query : chosenWords.join(' ');
  $('#refineInput').value = q;
  await runSearch(q, read.manual ? [] : read.words);
}
const readNum = (id) => {
  const el = $(id); if (!el) return null;
  const n = Number(el.value.replace(/[^\d,.]/g, '').replace(',', '.'));
  return el.value.trim() && n > 0 ? n : null;
};
$('#labelRead').addEventListener('click', (e) => {
  const b = e.target.closest('[data-word]');
  if (!b) return;
  const w = b.dataset.word;
  const has = chosenWords.some(c => c.toLowerCase() === w.toLowerCase());
  chosenWords = has ? chosenWords.filter(c => c.toLowerCase() !== w.toLowerCase()) : [...chosenWords, w];
  b.classList.toggle('on', !has);
  const q = chosenWords.join(' ');
  $('#refineInput').value = q;
  if (q) runSearch(q, chosenWords);
});
$('#refine').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#refineInput').value.trim(); runSearch(q, q.split(/\s+/)); });

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
// Hvor godt passer et søketreff med ordene vi leste? (tåler små lesefeil: sammenligner starten av ordene)
function matchScore(p, words) {
  const hay = norm(p.name + ' ' + p.brand);
  let s = 0;
  for (const w of words) {
    const n = norm(w);
    if (n.length < 2) continue;
    if (hay.includes(n)) s += 2;
    else if (n.length >= 5 && hay.includes(n.slice(0, 4))) s += 1;
  }
  return s;
}

let searchSeq = 0;
async function runSearch(q, words = []) {
  const ul = $('#pickList');
  const seq = ++searchSeq;
  if (!q && !words.length) { ul.innerHTML = ''; return; }
  ul.innerHTML = '<li class="muted">Søker …</li>';
  const ws = words.length ? words : q.split(/\s+/);
  const brand = pendingBrands[0];
  const rest = ws.filter(w => !pendingBrands.includes(w));
  // Flere søk: hele søket, så merke + første ord, så færre ord – stopp når vi har nok treff
  const queries = [...new Set([q, brand && `${brand} ${rest[0] || ''}`, ws.slice(0, 2).join(' '), brand, ws[0], ws[1]]
    .map(x => x && x.trim()).filter(Boolean))];
  const found = new Map();
  try {
    const add = (list) => { for (const p of list) { const e = found.get(p.ean); if (e) e.hits++; else found.set(p.ean, { ...p, hits: 1 }); } };
    for (const qq of queries.slice(0, 4)) {
      add(await API.search(qq));
      if (found.size >= 8) break;
    }
    if (!found.size) {
      const stems = [...new Set(ws.filter(w => w.length >= 5).map(w => w.slice(0, 5).toLowerCase()))].slice(0, 2);
      for (const st of stems) add(await API.search(st));
    }
    if (seq !== searchSeq) return;
    const lp = pendingRead && pendingRead.price;
    const list = [...found.values()].map(p => {
      let score = matchScore(p, ws) * 2 + p.hits + (pendingBrands.some(b => Brands.isBrand(p, b)) ? 6 : 0);
      // Pris på lappen stemmer med en pris i prisdataene → sannsynligvis riktig vare
      if (lp && p.prices.some(x => Math.abs(x - lp) < 0.01)) score += 5;
      else if (lp && p.prices.length && Math.min(...p.prices.map(x => Math.abs(x - lp) / lp)) < 0.15) score += 2;
      return { ...p, score };
    }).sort((a, b) => b.score - a.score).slice(0, 15);
    if (!list.length) { ul.innerHTML = '<li class="muted">Ingen treff. Slå av/på søkeord over, eller skriv merke + type (f.eks. «tine melk»).</li>'; return; }
    ul.innerHTML = list.map(p => {
      const lo = p.prices.length ? Math.min(...p.prices) : null;
      const priceMatch = lp && p.prices.some(x => Math.abs(x - lp) < 0.01);
      return `<li><button class="item" data-ean="${esc(p.ean)}">
        ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : '<div class="noimg">🛒</div>'}
        <div>${priceMatch ? '<span class="tag">✓ Samme pris</span> ' : ''}<b>${esc(p.name)}</b><span class="muted small">${esc(p.brand)}${lo != null ? ' · fra ' + kr(lo) : ''}</span></div>
      </button></li>`;
    }).join('');
  } catch (e) { if (seq === searchSeq) ul.innerHTML = `<li class="status bad">${apiErrorText(e)}</li>`; }
}
$('#pickList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ean]');
  if (!b) return;
  const price = pendingRead ? readNum('#rdPrice') : null, before = pendingRead ? readNum('#rdBefore') : null;
  openEan(b.dataset.ean, { shelfPrice: price, claimedBefore: before && price && before > price ? before : null });
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
function camInfoText() {
  const i = Scan.cameraInfo();
  if (!i) return 'Kameraene sjekkes første gang du starter kameraet.';
  if (i.macroId) return '🔬 Makro-/nærfokuslinse funnet. Den brukes automatisk på hyllelapper (bytt med «Nær»-knappen).';
  return `Nettleseren gir tilgang til ${i.back || 1} bakkamera${(i.back || 1) > 1 ? 'er' : ''}, men ingen egen makrolinse. Ved nærbilder zoomes det inn i stedet, så du kan holde telefonen litt unna.`;
}
$('#aiOn').addEventListener('change', (e) => saveSettings({ ai: e.target.checked }));
function loadSettingsForm() {
  $('#aiOn').checked = settings().ai !== false;
  $('#aiOn').disabled = !AI.available();
  const aerr = AI.lastError();
  $('#aiInfo').textContent = !AI.available()
    ? 'Ikke satt opp. Uten KI-lesing brukes enklere tekstlesing på telefonen (se README for oppsett).'
    : aerr ? 'Siste feil: ' + aerr : 'Klar' + (AI.lastModel() ? ` (${AI.lastModel()})` : '') + '. Bildet av lappen sendes til Google for å leses.';
  $('#camInfo').textContent = camInfoText();
  $('#autoStore').checked = settings().autoStore !== false;
  $('#dataStatus').innerHTML = API.access().ready
    ? '✅ Priser hentes fra <a href="https://kassal.app" target="_blank" rel="noopener">Kassalapp</a>. Du trenger ikke gjøre noe.'
    : '⚠️ Appen er ikke koblet til prisdata ennå. Prøv igjen senere – i mellomtiden kan du se eksempeldata.';
}
$('#reprobe').addEventListener('click', () => { Scan.reprobe(); $('#camInfo').textContent = 'Sjekkes neste gang du starter kameraet.'; });
$('#testConn').addEventListener('click', async () => {
  const st = $('#connStatus');
  st.textContent = 'Tester …'; st.className = 'small';
  try { await API.test(); st.textContent = '✅ Det virker!'; st.className = 'small good'; }
  catch (e) { st.innerHTML = '❌ ' + apiErrorText(e); st.className = 'small bad'; }
});

// ---------- Installering ----------
let installEvt = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); installEvt = e;
  if (!standalone()) { $('#installCard').classList.remove('hidden'); $('#installTop').classList.remove('hidden'); }
});
window.addEventListener('appinstalled', () => {
  installEvt = null;
  $('#installCard').classList.add('hidden'); $('#installTop').classList.add('hidden');
});
async function doInstall() {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice;
  installEvt = null;
  $('#installCard').classList.add('hidden'); $('#installTop').classList.add('hidden');
}
$('#installBtn').addEventListener('click', doInstall);
$('#installTop').addEventListener('click', doInstall);
$('#autoStore').addEventListener('change', (e) => saveSettings({ autoStore: e.target.checked }));
$('#clearCache').addEventListener('click', () => { API.clearCache(); alert('Lagrede priser er slettet.'); });
$('#clearHist').addEventListener('click', () => { store.set('history', []); alert('Historikken er slettet.'); });

// ---------- Oppstart ----------
function refreshDemoBtn() {
  const hasKey = API.access().ready;
  $('#demoBtn').classList.toggle('hidden', hasKey);
  if (!hasKey) status('Prisdata er ikke koblet til ennå. Du kan prøve appen med eksempeldata.', 'info');
  else status('');
}
$('#demoBtn').addEventListener('click', () => { if (!state.chain) setChain('kiwi', 'Kiwi (demo)'); openEan(API.DEMO_EAN); });

// Versjon og splash
$$('[data-version]').forEach(el => el.textContent = 'v' + APP_VERSION);
setTimeout(() => {
  const sp = $('#splash');
  sp.classList.add('out');
  setTimeout(() => sp.remove(), 400);
}, 1500);

refreshDemoBtn();
autoStore({ ask: true }); // spør om posisjon med en gang appen åpnes
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    reg.update().catch(() => {});
    // Ny versjon tatt i bruk → last siden på nytt én gang, så du ser den med en gang
    let reloaded = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded || !hadController) return;
      reloaded = true; location.reload();
    });
  }).catch(() => {});
}
