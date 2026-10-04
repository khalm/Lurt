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
  // Telefoner med flere bakkameraer: finn det som fokuserer nærmest (makro), én gang, og husk det.
  const CAM_KEY = 'lurt.cameras';
  let camInfo = null;
  try { camInfo = JSON.parse(localStorage.getItem(CAM_KEY) || 'null'); } catch { /* */ }

  async function open(constraints) {
    // Ber om zoom-tilgang der det går; faller tilbake uten
    try { return await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...constraints, zoom: true } }); }
    catch (e) {
      if (e.name === 'NotAllowedError') throw e;
      return navigator.mediaDevices.getUserMedia({ audio: false, video: constraints });
    }
  }
  const BASE = { width: { ideal: 1920 }, height: { ideal: 1440 } };

  async function probeCameras() {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    const back = devs.filter(d => !/front|user|selfie|forside/i.test(d.label));
    const list = [];
    if (back.length > 1) {
      for (const d of back) {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: d.deviceId } } });
          const t = s.getVideoTracks()[0];
          const c = t.getCapabilities ? t.getCapabilities() : {};
          list.push({ id: d.deviceId, label: d.label, minFocus: c.focusDistance ? c.focusDistance.min : null, zoomMax: c.zoom ? c.zoom.max : null });
          s.getTracks().forEach(x => x.stop());
        } catch { /* hopp over */ }
      }
    }
    const withFocus = list.filter(x => x.minFocus != null && x.minFocus > 0);
    const macro = withFocus.sort((a, b) => a.minFocus - b.minFocus)[0] || null;
    const main = list[0] || null;
    camInfo = { probed: Date.now(), count: devs.length, back: back.length, list,
      macroId: macro && main && macro.id !== main.id && (!main.minFocus || macro.minFocus < main.minFocus * 0.8) ? macro.id : null };
    try { localStorage.setItem(CAM_KEY, JSON.stringify(camInfo)); } catch { /* */ }
    return camInfo;
  }

  async function start(video, { close = false } = {}) {
    stop();
    // Første gang: undersøk kameraene (krever at tillatelse er gitt, så vi åpner standardkameraet først)
    if (!camInfo) {
      const s = await open({ facingMode: { ideal: 'environment' } });
      s.getTracks().forEach(t => t.stop());
      await probeCameras().catch(() => null);
    }
    const useMacro = close && camInfo && camInfo.macroId;
    stream = await open(useMacro ? { ...BASE, deviceId: { exact: camInfo.macroId } } : { ...BASE, facingMode: { ideal: 'environment' } })
      .catch(() => open({ ...BASE, facingMode: { ideal: 'environment' } }));
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    await video.play();
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    try { if (caps.focusMode && caps.focusMode.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* ok */ }
    // Uten makrolinse: zoom inn for nærbilder, så du kan holde telefonen der den klarer å fokusere
    if (close && !useMacro) await setZoom(2).catch(() => {});
    return { macro: !!useMacro };
  }

  function zoomRange() {
    try { const c = stream.getVideoTracks()[0].getCapabilities(); return c.zoom ? { min: c.zoom.min, max: c.zoom.max } : null; } catch { return null; }
  }
  async function setZoom(z) {
    const r = zoomRange();
    if (!r) return null;
    const v = Math.max(r.min, Math.min(r.max, z));
    await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ zoom: v }] });
    return v;
  }
  function getZoom() {
    try { return stream.getVideoTracks()[0].getSettings().zoom || 1; } catch { return 1; }
  }
  const cameraInfo = () => camInfo;
  async function reprobe() { camInfo = null; localStorage.removeItem(CAM_KEY); }

  function stop() {
    if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  function running() { return !!stream; }

  // Leter etter strekkode i videoen. Krever to like treff på rad for å unngå feillesing.
  let loopGen = 0;
  function watchBarcodes(video, onCode) {
    let lastSeen = null;
    if (loopTimer) clearTimeout(loopTimer);
    const gen = ++loopGen;
    const tick = async () => {
      if (!stream || gen !== loopGen) return;
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

  // Skarphet (varians av Laplace) på et lite utsnitt – brukes for å velge det skarpeste bildet
  function sharpness(canvas) {
    const w = 320, h = Math.max(1, Math.round(canvas.height * 320 / canvas.width));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.drawImage(canvas, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    let sum = 0, sum2 = 0, n = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      sum += l; sum2 += l * l; n++;
    }
    return n ? sum2 / n - (sum / n) ** 2 : 0;
  }

  // Tar flere bilder på rad og beholder det skarpeste (mot uskarphet fra håndbevegelse)
  async function bestShot(video, frame, count = 5, gap = 110) {
    let best = null;
    for (let i = 0; i < count; i++) {
      if (i) await new Promise(r => setTimeout(r, gap));
      const crop = cropToFrame(video, frame);
      const s = sharpness(crop);
      if (!best || s > best.s) best = { s, crop, full: snapshot(video) };
    }
    return best;
  }

  // Lommelykt (der telefonen støtter det)
  function torchSupported() {
    try { const t = stream && stream.getVideoTracks()[0]; return !!(t && t.getCapabilities && t.getCapabilities().torch); } catch { return false; }
  }
  async function setTorch(on) {
    const t = stream && stream.getVideoTracks()[0];
    if (t) await t.applyConstraints({ advanced: [{ torch: !!on }] });
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

  // Klipper ut området inne i rammen på skjermen (videoen vises med object-fit: cover)
  // Hvor rammen er, som andel (0–1) av videobildet
  function frameRect(video, frame, pad = 0.04) {
    const vr = video.getBoundingClientRect(), fr = frame.getBoundingClientRect();
    const VW = video.videoWidth, VH = video.videoHeight;
    const scale = Math.max(vr.width / VW, vr.height / VH);
    const offX = (vr.width - VW * scale) / 2, offY = (vr.height - VH * scale) / 2;
    let x = (fr.left - vr.left - offX) / scale, y = (fr.top - vr.top - offY) / scale;
    let w = fr.width / scale, h = fr.height / scale;
    x -= w * pad; y -= h * pad; w *= 1 + 2 * pad; h *= 1 + 2 * pad;
    x = Math.max(0, x); y = Math.max(0, y); w = Math.min(VW - x, w); h = Math.min(VH - y, h);
    return { x: x / VW, y: y / VH, w: w / VW, h: h / VH };
  }

  function cropCanvas(src, sw, sh, r) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w * sw)); c.height = Math.max(1, Math.round(r.h * sh));
    c.getContext('2d').drawImage(src, r.x * sw, r.y * sh, r.w * sw, r.h * sh, 0, 0, c.width, c.height);
    return c;
  }

  function cropToFrame(video, frame) {
    return cropCanvas(video, video.videoWidth, video.videoHeight, frameRect(video, frame));
  }

  // Likhet mellom to bilder (korrelasjon på små gråtonebilder) – brukes for å sjekke at fotoet viser det samme som videoen
  function similarity(a, b) {
    const W = 48, H = 24;
    const g = (src) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, W, H);
      const d = x.getImageData(0, 0, W, H).data, v = new Float32Array(W * H);
      for (let i = 0; i < v.length; i++) v[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
      const m = v.reduce((s, t) => s + t, 0) / v.length;
      let sd = 0; for (let i = 0; i < v.length; i++) { v[i] -= m; sd += v[i] * v[i]; }
      sd = Math.sqrt(sd) || 1; for (let i = 0; i < v.length; i++) v[i] /= sd;
      return v;
    };
    const va = g(a), vb = g(b);
    let s = 0; for (let i = 0; i < va.length; i++) s += va[i] * vb[i];
    return s;
  }

  // Fotoet kan ha annet format enn videoen (4:3 mot 16:9) og ev. ikke være zoomet. Prøv mulige utsnitt og velg det som ligner mest på videoen.
  function photoCrop(photo, rect, videoCrop, va, zoom) {
    const PW = photo.width, PH = photo.height, pa = PW / PH;
    const cands = [];
    for (const z of zoom > 1.05 ? [1, zoom] : [1]) {
      // synlig område av fotoet som tilsvarer videobildet
      let vw = PW, vh = PH, ox = 0, oy = 0;
      if (pa < va) { vh = PW / va; oy = (PH - vh) / 2; } else { vw = PH * va; ox = (PW - vw) / 2; }
      // foto uten zoom: videoen viser bare midten
      const zw = vw / z, zh = vh / z, zx = ox + (vw - zw) / 2, zy = oy + (vh - zh) / 2;
      const r = { x: (zx + rect.x * zw) / PW, y: (zy + rect.y * zh) / PH, w: rect.w * zw / PW, h: rect.h * zh / PH };
      const c = cropCanvas(photo, PW, PH, r);
      cands.push({ c, s: similarity(c, videoCrop) });
    }
    cands.sort((a, b) => b.s - a.s);
    return cands[0].s > 0.55 ? cands[0].c : null;
  }

  // Tar et ekte foto i full oppløsning (skarpere og mer detaljer enn videoen). Faller tilbake til beste videobilde.
  async function capture(video, frame) {
    const rect = frameRect(video, frame);
    const shot = await bestShot(video, frame, 3, 90);
    const track = stream && stream.getVideoTracks()[0];
    if (track && 'ImageCapture' in window) {
      try {
        const ic = new ImageCapture(track);
        const blob = await Promise.race([ic.takePhoto(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3500))]);
        const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(blob));
        if (bmp.width * bmp.height > video.videoWidth * video.videoHeight * 1.2) {
          const crop = photoCrop(bmp, rect, shot.crop, video.videoWidth / video.videoHeight, getZoom());
          if (crop) return { crop, full: shot.full, hires: true };
        }
      } catch (e) { console.warn('takePhoto', e); }
    }
    return { crop: shot.crop, full: shot.full, hires: false };
  }

  // ---------- Tekstgjenkjenning (Tesseract.js) ----------
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Kunne ikke laste ' + src));
      document.head.appendChild(s);
    });
  }

  async function getWorker(onProgress) {
    await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    if (!ocrWorker) {
      ocrWorker = await Tesseract.createWorker(['nor', 'eng'], 1, {
        logger: m => onProgress && m.status && onProgress(m.status, m.progress),
      });
      // «Spredt tekst»: finner ord hvor som helst i bildet (passer for lapper og emballasje)
      await ocrWorker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
    }
    return ocrWorker;
  }

  function wordsOf(data, variant) {
    const out = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
      for (const w of l.words || []) {
        const t = (w.text || '').trim();
        if (!t) continue;
        out.push({ text: t, conf: w.confidence, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, h: w.bbox.y1 - w.bbox.y0, v: variant });
      }
    }
    return out;
  }
  const goodWords = (ws) => ws.filter(w => w.conf >= 60 && /[A-Za-zÆØÅæøå0-9]{2,}/.test(w.text));

  // Leser teksten. Prøver vanlig og invertert bilde (hvit tekst på farget lapp), og slår sammen.
  async function ocr(canvas, onProgress) {
    const worker = await getWorker(onProgress);
    const base = Prep.upscale(canvas, 1800);
    // Gråtone + invertert (hvit tekst på farget lapp) alltid; terskel-variant bare hvis lite ble funnet
    const variants = [['gray', () => Prep.gray(base)], ['inv', () => Prep.binarize(base, true)], ['bin', () => Prep.binarize(base, false)]];
    let all = [];
    for (const [name, make] of variants) {
      if (name === 'bin' && goodWords(all).length >= 6) break;
      const { data } = await worker.recognize(make(), {}, { blocks: true, text: true });
      all = all.concat(wordsOf(data, name));
    }
    return { words: mergeWords(all), width: base.width, height: base.height };
  }

  // Samme ord funnet i flere varianter → behold det sikreste
  function mergeWords(ws) {
    const out = [];
    for (const w of ws.sort((a, b) => b.conf - a.conf)) {
      const dup = out.find(o => overlap(o, w) > 0.5);
      if (!dup) out.push(w);
    }
    return out.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  }
  function overlap(a, b) {
    const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
    const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    const i = ix * iy, u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i;
    return u > 0 ? i / u : 0;
  }

  return { capture, start, zoomRange, setZoom, getZoom, cameraInfo, reprobe, stop, running, watchBarcodes, snapshot, cropToFrame, bestShot, torchSupported, setTorch, fileToCanvas, detectIn, ocr, validEan, normEan };
})();

// ---------- Bildebehandling før tekstlesing ----------
const Prep = (() => {
  function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // Små utsnitt forstørres (Tesseract liker tekst på 25–60 piksler)
  function upscale(src, target) {
    const s = Math.min(3, target / Math.max(src.width, src.height));
    const c = canvasOf(Math.round(src.width * s), Math.round(src.height * s));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  function grayArr(src) {
    const { width: w, height: h } = src;
    const d = src.getContext('2d').getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    // Kontraststrekk (2.–98. persentil)
    const hist = new Uint32Array(256);
    for (const v of g) hist[v | 0]++;
    let lo = 0, hi = 255, acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > g.length * 0.02) { lo = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > g.length * 0.02) { hi = i; break; } }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < g.length; i++) g[i] = Math.max(0, Math.min(255, (g[i] - lo) * 255 / span));
    return { g, w, h };
  }

  function toCanvas(arr, w, h) {
    const c = canvasOf(w, h), ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let i = 0, j = 0; i < arr.length; i++, j += 4) { img.data[j] = img.data[j + 1] = img.data[j + 2] = arr[i]; img.data[j + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function gray(src) { const { g, w, h } = grayArr(src); return toCanvas(g, w, h); }

  // Adaptiv terskel (Bradley): tåler skygger og ujevnt lys på hylla
  function binarize(src, invert) {
    const { g, w, h } = grayArr(src);
    if (invert) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i];
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
    }
    const r = Math.max(8, Math.round(Math.min(w, h) / 16)), T = 0.16;
    const out = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
        const n = (x1 - x0 + 1) * (y1 - y0 + 1);
        const sum = I[(y1 + 1) * (w + 1) + x1 + 1] - I[y0 * (w + 1) + x1 + 1] - I[(y1 + 1) * (w + 1) + x0] + I[y0 * (w + 1) + x0];
        out[y * w + x] = g[y * w + x] * n < sum * (1 - T) ? 0 : 255;
      }
    }
    return toCanvas(out, w, h);
  }

  return { upscale, gray, binarize };
})();

// ---------- Tolking av hyllelapp / emballasje ----------
const Label = (() => {
  const STOP = new Set(('kr pr per kg stk ltr liter gram tilbud pris før for nå na spar kilo kilopris literpris enhetspris stykkpris ' +
    'fer f0r den det dette de en et ny nye the and new ord org veil pant inkl mva best holdbar pakke ca og med uten til fra kiwi rema meny coop extra prix mega obs joker bunnpris oda ' +
    'norge norsk varenr varenummer ean pris/kg kr/kg kr/l kr/stk sammenlign sammenligningspris').split(' '));
  const VOWEL = /[aeiouyæøåé]/i;

  const num = (s) => Number(String(s).replace(',', '.'));
  const clean = (t) => t.replace(/[”“"'’‘`´°*]/g, '').replace(/^[^\wÆØÅæøå]+|[^\wÆØÅæøå,.\-–]+$/g, '');
  const sameLine = (a, b) => {
    const ov = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    return ov > 0.4 * Math.min(a.h, b.h);
  };

  // Slår sammen sifre som ble lest som egne ord: «5» «9» → «59»
  function joinDigits(ws) {
    ws = ws.slice().sort((a, b) => a.x0 - b.x0);
    const out = [];
    for (const w of ws) {
      const prev = out.find(o => /^\d+$/.test(o.t) && /^\d+$/.test(w.t) && sameLine(o, w)
        && w.x0 >= o.x1 - o.h * 0.1 && w.x0 - o.x1 < o.h * 0.35 && Math.abs(w.h - o.h) < 0.25 * Math.max(w.h, o.h));
      if (prev) { prev.t += w.t; prev.x1 = w.x1; prev.y0 = Math.min(prev.y0, w.y0); prev.y1 = Math.max(prev.y1, w.y1); prev.conf = Math.min(prev.conf, w.conf); }
      else out.push({ ...w });
    }
    return out;
  }

  function priceCands(words) {
    const out = [];
    const ws = joinDigits(words.map(w => ({ ...w, t: clean(w.text) })).filter(w => w.t));
    const maxH = Math.max(1, ...ws.filter(w => /\d/.test(w.t)).map(w => w.h));
    for (const w of ws) {
      let v = null, kind = null, m;
      if ((m = w.t.match(/^(\d{1,4})[,.](\d{2})$/))) { v = num(m[1] + '.' + m[2]); kind = 'full'; }
      else if ((m = w.t.match(/^(\d{1,4})[,.]?[-–]$/))) { v = num(m[1]); kind = 'dash'; }
      else if ((m = w.t.match(/^(\d{1,4})$/)) && w.conf >= 50) {
        // Stort tall med små øre-tall like til høyre: «39⁹⁰»
        const dec = ws.find(o => o !== w && /^\d{2}$/.test(o.t) && o.h < w.h * 0.8
          && (o.x0 + o.x1) / 2 > (w.x0 + w.x1) / 2 && o.x0 - w.x1 < w.h * 1.2
          && o.y0 >= w.y0 - w.h * 0.3 && o.y0 < w.y0 + w.h * 0.45);
        if (dec) {
          let ip = m[1];
          if (ip.length >= 3 && ip.endsWith(dec.t[0])) ip = ip.slice(0, -1); // «599» + «90» → 59,90
          v = num(ip + '.' + dec.t); kind = 'super';
        }
        else if (m[1].length >= 3 && m[1].length <= 5 && /(00|50|90|95|99|49|29|79|69|59|39|19|89)$/.test(m[1])) { v = num(m[1]) / 100; kind = 'merged'; }
        else if (m[1].length <= 3) { v = num(m[1]); kind = 'int'; }
      }
      if (v == null || v <= 0 || v > 5000) continue;
      // Ord rett før/etter prisen, i omtrent samme skriftstørrelse og høyde
      const near = (o) => o !== w && o.h > w.h * 0.45 && o.h < w.h * 2.2
        && Math.abs((o.y0 + o.y1) / 2 - (w.y0 + w.y1) / 2) < 0.6 * Math.min(o.h, w.h);
      const after = ws.filter(o => near(o) && o.x0 >= w.x1 - 2 && o.x0 - w.x1 < w.h * 3).sort((a, b) => a.x0 - b.x0).map(o => o.t.toLowerCase()).join(' ');
      const beforeTxt = ws.filter(o => near(o) && o.x1 <= w.x0 + 2 && w.x0 - o.x1 < w.h * 4).sort((a, b) => a.x0 - b.x0).map(o => o.t.toLowerCase()).join(' ');
      const unit = /^(\/|pr\.?|per)?\s*(kg|l|liter|ltr|stk|hg)\b|^kilo|^liter|^pr\.?\s*(kg|l|stk)|^kr\/|enhet|sammenl/.test(after)
        || /(kilopris|literpris|enhetspris|pr\.?|per)\s*(kg|l)?\s*:?$/.test(beforeTxt);
      const before = /\bf[øo0e]r\s*:?$|tidligere\s*:?$|ordin[æa]r\w*\s*:?$/.test(beforeTxt);
      const prio = { full: 3, super: 3, dash: 2, merged: 1, int: 0 }[kind];
      // «Sammenslåtte» tall (3990 → 39,90) bare når de er blant de største tallene på lappen
      if (kind === 'merged' && w.h < maxH * 0.6) continue;
      out.push({ v, h: w.h, conf: w.conf, unit, before, kind, prio });
    }
    return out;
  }

  function nameWords(words) {
    const seen = new Set();
    return words
      .map(w => ({ ...w, t: clean(w.text).replace(/[,.]+$/, '') }))
      .filter(w => w.conf >= 55 && w.t.length >= 3 && /^[A-Za-zÆØÅæøåÉéÜüÖöÄä'&\-]+$/.test(w.t) && VOWEL.test(w.t)
        && !STOP.has(w.t.toLowerCase()) && !/(.)\1\1/.test(w.t.toLowerCase()))
      .sort((a, b) => b.h - a.h || b.conf - a.conf)
      .filter(w => { const k = w.t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 8)
      .map(w => w.t);
  }

  function parse(res) {
    const words = res.words || [];
    const all = words.map(w => clean(w.text)).join(' ');
    const c = priceCands(words);
    const main = c.filter(x => !x.unit && !x.before && x.prio > 0)
      .sort((a, b) => (b.h * (1 + b.prio * 0.15)) - (a.h * (1 + a.prio * 0.15)));
    const intOnly = c.filter(x => !x.unit && !x.before && x.prio === 0).sort((a, b) => b.h - a.h);
    const pick = main[0] && (!intOnly[0] || main[0].h >= intOnly[0].h * 0.6) ? main[0] : (intOnly[0] || main[0]);
    const before = c.filter(x => x.before && !x.unit && x.prio >= 2).sort((a, b) => b.prio - a.prio || b.h - a.h)[0];
    const nw = nameWords(words);
    const eans = (all.match(/\b\d{8}\b|\b\d{13}\b/g) || []).map(Scan.normEan).filter(Scan.validEan);
    return {
      price: pick ? pick.v : null,
      before: before && (!pick || before.v > pick.v) ? before.v : null,
      offer: /tilbud|kampanje|\bspar\b|f[øo]r\s*\d/i.test(all),
      words: nw,
      query: nw.slice(0, 3).join(' '),
      ean: eans[0] || null,
    };
  }

  return { parse, priceCands, nameWords };
})();

if (typeof module !== 'undefined') module.exports = { Label, Prep };
