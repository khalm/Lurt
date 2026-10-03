// scan.js — kamera, strekkodeleser og tekstgjenkjenning (alt skjer på telefonen)
'use strict';

const Scan = (() => {
  const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
  let stream = null, detector = null, loopTimer = null, ocrWorker = null;

  // ---------- Strekkode ----------
  async function getDetector() {
    if (detector) return detector;
    if ('BarcodeDetector' in window) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        if (FORMATS.some(f => supported.includes(f))) {
          detector = new window.BarcodeDetector({ formats: FORMATS.filter(f => supported.includes(f)) });
          return detector;
        }
      } catch { /* faller tilbake */ }
    }
    // iPhone og andre uten innebygd leser: åpen kildekode-leser (ZXing, WebAssembly)
    const mod = await import('https://cdn.jsdelivr.net/npm/barcode-detector@2/dist/es/pure.min.js');
    detector = new mod.BarcodeDetector({ formats: FORMATS });
    return detector;
  }

  function validEan(code) {
    if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
    const d = code.split('').map(Number);
    const check = d.pop();
    const sum = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === check;
  }
  function normEan(code) {
    code = String(code).replace(/\D/g, '');
    if (code.length === 12) code = '0' + code;      // UPC-A → EAN-13
    if (code.length === 14 && code[0] === '0') code = code.slice(1);
    return code;
  }

  async function detectIn(source) {
    const det = await getDetector();
    const codes = await det.detect(source);
    for (const c of codes) {
      const v = normEan(c.rawValue);
      if (validEan(v)) return v;
    }
    return null;
  }

  // ---------- Kamera ----------
  async function start(video) {
    stop();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    await video.play();
    // Prøv kontinuerlig autofokus der det støttes
    try {
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.focusMode && caps.focusMode.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch { /* ok */ }
  }

  function stop() {
    if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  function running() { return !!stream; }

  // Leter etter strekkode i videoen. Krever to like treff på rad for å unngå feillesing.
  function watchBarcodes(video, onCode) {
    let lastSeen = null;
    const tick = async () => {
      if (!stream) return;
      try {
        if (video.readyState >= 2) {
          const code = await detectIn(video);
          if (code && code === lastSeen) { onCode(code); return; }
          lastSeen = code;
        }
      } catch (e) { console.warn(e); }
      loopTimer = setTimeout(tick, 250);
    };
    tick();
  }

  function snapshot(video) {
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    return c;
  }

  async function fileToCanvas(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c;
  }

  // ---------- Tekstgjenkjenning (Tesseract.js) ----------
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Kunne ikke laste ' + src));
      document.head.appendChild(s);
    });
  }

  async function ocr(canvas, onProgress) {
    await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    if (!ocrWorker) {
      ocrWorker = await Tesseract.createWorker(['nor', 'eng'], 1, {
        logger: m => onProgress && m.status && onProgress(m.status, m.progress),
      });
    }
    const { data } = await ocrWorker.recognize(prep(canvas), {}, { blocks: true, text: true });
    const words = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
      for (const w of l.words || []) words.push({ text: w.text, h: w.bbox.y1 - w.bbox.y0, conf: w.confidence, line: l.text });
    }
    return { text: data.text || '', words };
  }

  // Gråtoner + kontrast gir bedre tekstgjenkjenning
  function prep(src) {
    const scale = Math.min(1, 1600 / Math.max(src.width, src.height));
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * scale); c.height = Math.round(src.height * scale);
    const ctx = c.getContext('2d');
    ctx.filter = 'grayscale(1) contrast(1.4)';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  return { start, stop, running, watchBarcodes, snapshot, fileToCanvas, detectIn, ocr, validEan, normEan };
})();

// ---------- Tolking av hyllelapp / emballasje ----------
const Label = (() => {
  const STOP = /^(kr|pr|per|kg|stk|l|ltr|liter|g|gram|tilbud|pris|før|nå|spar|kilo|kilopris|literpris|enhetspris|ord|org|veil|pant|inkl|mva|stykkpris|best|før:|holdbar|pakke|ca|x|og|kiwi|rema|meny|coop|extra|prix|mega|obs|spar|joker|bunnpris|oda)$/i;

  function toNum(s) { return Number(String(s).replace(/\s/g, '').replace(',', '.').replace(/[-–]$/, '').replace(/\.$/, '')); }

  // Finner priskandidater. Store tall på lappen er som regel varens pris.
  function prices(ocrRes) {
    const cands = [];
    const text = ocrRes.text.replace(/ /g, ' ');
    const unitAfter = /^\s*(\/|pr\.?|per)\s*(kg|l|ltr|liter|stk|hg|100)/i;
    const re = /(\d{1,4})\s?[,.]\s?(\d{2})\b|(\d{1,4}),\s?[-–]/g;
    let m;
    while ((m = re.exec(text))) {
      const v = m[3] ? Number(m[3]) : Number(m[1] + '.' + m[2]);
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 12);
      const before = text.slice(Math.max(0, m.index - 14), m.index);
      if (v <= 0 || v > 5000) continue;
      cands.push({
        v,
        unit: unitAfter.test(after) || /(kg|liter|l|stk)pris|pr\.?\s*(kg|l)\s*$/i.test(before),
        before: /f[øo]r\s*:?\s*$/i.test(before),
        h: heightOf(ocrRes.words, m[0]),
      });
    }
    // Store tall uten komma, f.eks. «39⁹⁰» som leses som «3990»
    for (const w of ocrRes.words) {
      const t = w.text.replace(/[^\d]/g, '');
      if (/^\d{3,5}$/.test(t) && w.text.replace(/[\d.,-]/g, '').length <= 1) {
        cands.push({ v: Number(t) / 100, unit: false, before: false, h: w.h * 0.9, guess: true });
      }
    }
    return cands;
  }

  function heightOf(words, token) {
    const first = token.replace(/\s/g, '').slice(0, 3);
    const w = words.find(w => w.text.includes(first));
    return w ? w.h : 0;
  }

  function parse(ocrRes) {
    const c = prices(ocrRes);
    const main = c.filter(x => !x.unit && !x.before).sort((a, b) => b.h - a.h || (a.guess ? 1 : 0) - (b.guess ? 1 : 0));
    const before = c.find(x => x.before && !x.unit);
    const price = main.length ? main[0].v : null;
    const offer = /tilbud|kampanje|spar\s|før\s*:?\s*\d|nå\s*\d/i.test(ocrRes.text);

    // Varenavn: linjer med mest bokstaver
    const lines = ocrRes.text.split('\n').map(l => l.trim()).filter(Boolean);
    const scored = lines.map(l => {
      const words = l.split(/\s+/).filter(w => /^[A-Za-zÆØÅæøåÉé&'\-]{2,}$/.test(w) && !STOP.test(w));
      return { l, words, score: words.join('').length };
    }).filter(x => x.score >= 4).sort((a, b) => b.score - a.score);
    const name = scored.slice(0, 2).map(x => x.words.join(' ')).join(' ').slice(0, 60).trim();

    return {
      price,
      before: before ? before.v : null,
      offer,
      query: name,
      ean: (ocrRes.text.match(/\b\d{13}\b|\b\d{8}\b/g) || []).map(Scan.normEan).find(Scan.validEan) || null,
    };
  }

  return { parse };
})();

if (typeof module !== 'undefined') module.exports = { Label };
