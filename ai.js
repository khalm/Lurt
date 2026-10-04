// ai.js — leser hyllelapper med Google Gemini (gratis API-nøkkel, legges inn som GitHub-secret GEMINI_KEY).
// Mye bedre enn vanlig tekstgjenkjenning på bilder tatt i butikken: forstår små øre-tall, tilbud, før-pris og kilopris.
// Uten nøkkel, eller hvis kvoten er brukt opp, faller appen tilbake til lokal tekstlesing.
'use strict';

const AI = (() => {
  const URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
  // Prøves i rekkefølge. Hver modell har egen gratiskvote, så ved «kvote brukt opp» prøves neste.
  const MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];
  const LAST_KEY = 'lurt.ai.model';

  const key = () => ((window.LURT_CONFIG || {}).geminiKey || '').trim();
  const userOn = () => { try { return JSON.parse(localStorage.getItem('lurt.settings') || '{}').ai !== false; } catch { return true; } };
  const available = () => !!key();
  const enabled = () => available() && userOn() && navigator.onLine !== false;

  const PROMPT = `Bildet viser en hyllelapp (prislapp på hylla) i en norsk dagligvarebutikk.
Les lappen nøye og svar KUN med ett JSON-objekt med disse feltene:
{
 "readable": true/false (false hvis det ikke er en lesbar hyllelapp),
 "product": varenavnet slik det står på lappen (uten pris og uten butikknavn),
 "brand": merket hvis det står, ellers null,
 "size": mengde/vekt, f.eks. "575 g", "1,75 l", "6 x 0,5 l", ellers null,
 "price": prisen kunden betaler for ÉN vare, i kroner som tall (IKKE kilopris/literpris/enhetspris),
 "before_price": før-pris/ordinær pris hvis lappen viser et tilbud, ellers null,
 "unit_price": kilopris/literpris/stykkpris som tall, ellers null,
 "unit": "kg", "l", "stk" eller null,
 "multi": flerkjøpstilbud som tekst, f.eks. "3 for 99", ellers null,
 "offer": true hvis det er tilbud/kampanje, ellers false,
 "ean": strekkoden som tall-streng hvis den står lesbart på lappen (8 eller 13 siffer), ellers null,
 "search": 2–4 ord som egner seg til å søke opp varen i en nettbutikk (merke + varetype + evt. variant)
}
Merk: Prisen står ofte med store kroner og små øre hevet, f.eks. "59⁹⁰" betyr 59.90, og "39,-" betyr 39.00.
Hvis flere lapper er synlige, bruk lappen nærmest midten av bildet.`;

  function toJpeg(canvas, max = 1280) {
    const s = Math.min(1, max / Math.max(canvas.width, canvas.height));
    const c = document.createElement('canvas');
    c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88).split(',')[1];
  }

  const num = (v) => {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d,.-]/g, '').replace(',', '.'));
    return isFinite(n) && n > 0 && n < 10000 ? Math.round(n * 100) / 100 : null;
  };

  function parse(text) {
    const m = String(text || '').match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Uventet svar');
    const j = JSON.parse(m[0]);
    return {
      readable: j.readable !== false,
      product: j.product ? String(j.product).trim() : '',
      brand: j.brand ? String(j.brand).trim() : null,
      size: j.size ? String(j.size).trim() : null,
      price: num(j.price),
      before: num(j.before_price),
      unitPrice: num(j.unit_price),
      unit: j.unit || null,
      multi: j.multi || null,
      offer: !!j.offer,
      ean: j.ean ? String(j.ean).replace(/\D/g, '') : null,
      search: j.search ? String(j.search).trim() : '',
    };
  }

  async function call(model, b64, signal) {
    const res = await fetch(`${URL}${model}:generateContent?key=${encodeURIComponent(key())}`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: b64 } }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) {
      const err = new Error('Gemini ' + res.status);
      err.status = res.status;
      try { err.detail = (await res.json()).error.message; } catch { /* */ }
      throw err;
    }
    const j = await res.json();
    const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    return parse(parts.map(p => p.text || '').join(''));
  }

  async function readLabel(canvas, { timeout = 20000 } = {}) {
    if (!enabled()) throw new Error('KI-lesing er ikke satt opp');
    const b64 = toJpeg(canvas);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    const last = localStorage.getItem(LAST_KEY);
    const order = last && MODELS.includes(last) ? [last, ...MODELS.filter(m => m !== last)] : MODELS;
    let lastErr = null;
    try {
      for (const m of order) {
        try {
          const r = await call(m, b64, ctl.signal);
          localStorage.setItem(LAST_KEY, m);
          localStorage.removeItem('lurt.ai.err');
          return r;
        } catch (e) {
          lastErr = e;
          // Modell finnes ikke (404), kvote brukt opp (429) eller overbelastet (503): prøv neste
          if (![404, 429, 500, 503].includes(e.status)) break;
        }
      }
    } finally { clearTimeout(timer); }
    try { localStorage.setItem('lurt.ai.err', (lastErr && (lastErr.detail || lastErr.message) || 'ukjent').slice(0, 200)); } catch { /* */ }
    if (lastErr && lastErr.status === 429) lastErr.quota = true;
    throw lastErr || new Error('KI-lesing feilet');
  }

  const lastError = () => localStorage.getItem('lurt.ai.err');
  const lastModel = () => localStorage.getItem(LAST_KEY);

  return { available, enabled, readLabel, parse, lastError, lastModel };
})();

if (typeof module !== 'undefined') module.exports = AI;
