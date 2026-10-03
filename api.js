// api.js — Kassalapp API (https://kassal.app/api), cache, kjede-oppslag og demo-data
'use strict';

const API = (() => {
  const BASE = 'https://kassal.app/api/v1';
  const CACHE_MS = 6 * 60 * 60 * 1000; // 6 timer

  const settings = () => {
    try { return JSON.parse(localStorage.getItem('lurt.settings') || '{}'); } catch { return {}; }
  };

  // ---------- Kjeder ----------
  // Gjør "MENY_NO", "Meny", "COOP_EXTRA", "Coop Extra", "REMA_1000" sammenlignbare.
  function chainKey(s) {
    if (!s) return '';
    return String(s).toLowerCase()
      .replace(/_no$/, '').replace(/\.no$/, '')
      .replace(/[^a-z0-9æøå]/g, '');
  }

  const CHAINS = [
    ['kiwi', 'Kiwi'], ['rema1000', 'Rema 1000'], ['meny', 'Meny'], ['spar', 'Spar'],
    ['joker', 'Joker'], ['coopextra', 'Coop Extra'], ['coopprix', 'Coop Prix'],
    ['coopmega', 'Coop Mega'], ['coopobs', 'Obs'], ['coopmarked', 'Coop Marked'],
    ['bunnpris', 'Bunnpris'], ['oda', 'Oda'], ['naerbutikken', 'Nærbutikken'],
    ['matkroken', 'Matkroken'], ['europris', 'Europris'],
  ];
  const chainName = (key) => (CHAINS.find(c => c[0] === key) || [null, null])[1];

  // ---------- HTTP ----------
  // Nøkkel/proxy er bygget inn i appen (config.js, skrives ved publisering)
  function access() {
    const c = window.LURT_CONFIG || {};
    const proxy = (c.proxy || '').trim();
    const key = proxy ? '' : (c.apiKey || '').trim();
    return { key, proxy, ready: !!(key || proxy) };
  }
  const builtIn = () => access().ready;

  async function get(path) {
    const a = access();
    if (!a.ready) throw new ApiError('nokey', 'Mangler API-nøkkel');
    const base = a.proxy ? a.proxy.replace(/\/$/, '') : BASE;
    const headers = { 'Accept': 'application/json' };
    if (a.key) headers['Authorization'] = 'Bearer ' + a.key;
    let res;
    try {
      res = await fetch(base + path, { headers });
    } catch (e) {
      throw new ApiError(navigator.onLine ? 'network' : 'offline', e.message);
    }
    if (res.status === 401 || res.status === 403) throw new ApiError('auth', 'API-nøkkelen ble avvist');
    if (res.status === 404) return null;
    if (res.status === 429) throw new ApiError('rate', 'For mange oppslag – vent et minutt');
    if (!res.ok) throw new ApiError('http', 'Feil fra Kassalapp (' + res.status + ')');
    return res.json();
  }

  class ApiError extends Error {
    constructor(code, msg) { super(msg); this.code = code; }
  }

  function cacheGet(key) {
    try {
      const v = JSON.parse(localStorage.getItem('lurt.c.' + key) || 'null');
      return v;
    } catch { return null; }
  }
  function cacheSet(key, data) {
    try { localStorage.setItem('lurt.c.' + key, JSON.stringify({ t: Date.now(), data })); }
    catch { clearCache(); }
  }
  function clearCache() {
    Object.keys(localStorage).filter(k => k.startsWith('lurt.c.')).forEach(k => localStorage.removeItem(k));
  }

  // ---------- Normalisering ----------
  function priceOf(cp) {
    if (cp == null) return null;
    if (typeof cp === 'number') return cp;
    if (typeof cp === 'object' && cp.price != null) return Number(cp.price);
    const n = Number(cp); return isNaN(n) ? null : n;
  }

  // Gjør ett Kassalapp-produkt om til vår enkle form.
  function normOffer(p) {
    const store = p.store || {};
    const key = chainKey(store.code || store.name);
    const hist = (p.price_history || [])
      .map(h => ({ price: Number(h.price), date: new Date(h.date) }))
      .filter(h => !isNaN(h.price) && !isNaN(h.date))
      .sort((a, b) => a.date - b.date);
    let price = priceOf(p.current_price);
    let priceDate = p.current_price && p.current_price.date ? new Date(p.current_price.date) : null;
    if (price == null && hist.length) { price = hist[hist.length - 1].price; priceDate = hist[hist.length - 1].date; }
    const unit = (p.current_price && p.current_price.unit_price) ?? p.current_unit_price ?? null;
    return {
      chain: key,
      chainName: chainName(key) || store.name || store.code || 'Ukjent',
      logo: store.logo || null,
      url: p.url || null,
      price, priceDate,
      unitPrice: unit != null ? Number(unit) : null,
      history: hist,
    };
  }

  function normProduct(ean, products) {
    if (!products || !products.length) return null;
    // Velg det "beste" produktet for navn/bilde (det med flest felt)
    const main = products.slice().sort((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0))[0];
    const offersByChain = {};
    for (const p of products) {
      const o = normOffer(p);
      if (!o.chain) continue;
      // Hvis samme kjede finnes flere ganger, behold den med nyest pris
      const prev = offersByChain[o.chain];
      if (!prev || (o.priceDate && (!prev.priceDate || o.priceDate > prev.priceDate))) offersByChain[o.chain] = o;
    }
    return {
      ean: ean || main.ean,
      name: main.name,
      brand: main.brand || main.vendor || '',
      image: main.image || (products.find(p => p.image) || {}).image || null,
      weight: main.weight || null,
      weightUnit: main.weight_unit || null,
      category: Array.isArray(main.category) && main.category.length ? main.category[main.category.length - 1].name : null,
      offers: Object.values(offersByChain),
      fetched: Date.now(),
    };
  }

  // ---------- Offentlige funksjoner ----------
  async function byEan(ean, { fresh = false } = {}) {
    if (ean === DEMO_EAN) return demoProduct();
    const c = cacheGet('ean.' + ean);
    if (!fresh && c && Date.now() - c.t < CACHE_MS) return revive(c.data);
    try {
      const json = await get('/products/ean/' + encodeURIComponent(ean));
      if (!json || !json.data) return null;
      const d = json.data;
      const products = Array.isArray(d) ? d : (d.products || []);
      const prod = normProduct(d.ean || ean, products);
      if (prod) cacheSet('ean.' + ean, prod);
      return prod;
    } catch (e) {
      if (c && (e.code === 'offline' || e.code === 'network' || e.code === 'rate')) {
        const p = revive(c.data); p.stale = true; return p;
      }
      throw e;
    }
  }

  // Fritekstsøk → liste med unike varer (gruppert på EAN)
  async function search(q) {
    const json = await get('/products?size=40&search=' + encodeURIComponent(q));
    const list = (json && json.data) || [];
    const byEan = new Map();
    for (const p of list) {
      if (!p.ean) continue;
      const e = byEan.get(p.ean) || { ean: p.ean, name: p.name, brand: p.brand || p.vendor || '', image: p.image, prices: [] };
      if (!e.image && p.image) e.image = p.image;
      const pr = priceOf(p.current_price);
      if (pr != null) e.prices.push(pr);
      byEan.set(p.ean, e);
    }
    return [...byEan.values()].slice(0, 15);
  }

  // Butikker i nærheten (for å finne hvilken kjede du står i)
  async function nearbyStores(lat, lng, km = 0.4) {
    const key = `near.${lat.toFixed(3)}.${lng.toFixed(3)}.${km}`;
    const c = cacheGet(key);
    if (c && Date.now() - c.t < 7 * 24 * 3600 * 1000) return c.data;
    const json = await get(`/physical-stores?lat=${lat}&lng=${lng}&km=${km}&size=20`);
    const list = ((json && json.data) || []).map(s => ({
      name: s.name,
      chain: chainKey(s.group),
      lat: s.position && Number(s.position.lat),
      lng: s.position && Number(s.position.lng),
      address: s.address,
    })).filter(s => s.chain);
    for (const s of list) s.dist = (s.lat && s.lng) ? distKm(lat, lng, s.lat, s.lng) : null;
    list.sort((a, b) => (a.dist ?? 99) - (b.dist ?? 99));
    cacheSet(key, list);
    return list;
  }

  async function test() {
    const json = await get('/products?size=1&search=melk');
    return !!(json && json.data);
  }

  function distKm(a, b, c, d) {
    const R = 6371, r = x => x * Math.PI / 180;
    const dl = r(c - a), dn = r(d - b);
    const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dn / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Datoer overlever ikke JSON – gjør dem om igjen
  function revive(p) {
    p = JSON.parse(JSON.stringify(p));
    for (const o of p.offers) {
      o.priceDate = o.priceDate ? new Date(o.priceDate) : null;
      o.history = o.history.map(h => ({ price: h.price, date: new Date(h.date) }));
    }
    return p;
  }

  // ---------- Demo (eksempeldata, ikke ekte priser) ----------
  const DEMO_EAN = '0000000000000';
  function demoProduct() {
    const day = 864e5, now = Date.now();
    const mk = (pts) => pts.map(([d, p]) => ({ date: new Date(now - d * day), price: p }));
    const offers = [
      { chain: 'kiwi', chainName: 'Kiwi', price: 54.9, history: mk([[200, 49.9], [120, 52.9], [40, 59.9], [6, 54.9]]) },
      { chain: 'rema1000', chainName: 'Rema 1000', price: 49.9, history: mk([[200, 49.9], [100, 51.9], [20, 49.9]]) },
      { chain: 'meny', chainName: 'Meny', price: 64.9, history: mk([[200, 59.9], [90, 64.9]]) },
      { chain: 'coopextra', chainName: 'Coop Extra', price: 52.9, history: mk([[200, 52.9]]) },
      { chain: 'spar', chainName: 'Spar', price: 62.5, history: mk([[200, 58.9], [60, 62.5]]) },
    ].map(o => ({ ...o, priceDate: o.history[o.history.length - 1].date, unitPrice: +(o.price / 0.5).toFixed(2), logo: null, url: null }));
    return {
      ean: DEMO_EAN, name: 'Demo-kaffe 500 g (eksempeldata)', brand: 'Demo', image: null,
      weight: 500, weightUnit: 'g', category: 'Kaffe', offers, fetched: now, demo: true,
    };
  }

  return { access, builtIn, byEan, search, nearbyStores, test, chainKey, chainName, CHAINS, clearCache, ApiError, DEMO_EAN, distKm, settings };
})();
