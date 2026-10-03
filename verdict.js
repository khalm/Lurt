// verdict.js — regner ut om kjøpet er lurt, eller om du blir lurt
'use strict';

const Verdict = (() => {
  const DAY = 864e5;
  const kr = (n) => n == null ? '–' : n.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr';
  const dato = (d) => d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });

  // Pris en gitt dato (historikken er "trapp": prisen gjelder til neste endring)
  function priceAt(hist, t) {
    let v = null;
    for (const h of hist) { if (h.date.getTime() <= t) v = h.price; else break; }
    return v;
  }

  // Statistikk over de siste `days` dagene, én verdi per dag
  function stats(hist, days, now = Date.now(), endT = now) {
    const vals = [];
    for (let t = endT - days * DAY; t <= endT; t += DAY) {
      const v = priceAt(hist, t);
      if (v != null) vals.push(v);
    }
    if (!vals.length) return null;
    const s = vals.slice().sort((a, b) => a - b);
    const mid = s.length >> 1;
    return {
      min: s[0], max: s[s.length - 1],
      avg: vals.reduce((a, b) => a + b, 0) / vals.length,
      median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2,
      days: vals.length,
    };
  }

  // Liste med prisendringer (dato + fra/til)
  function changes(hist) {
    const out = [];
    for (let i = 1; i < hist.length; i++) {
      if (Math.abs(hist[i].price - hist[i - 1].price) >= 0.01) {
        out.push({ date: hist[i].date, from: hist[i - 1].price, to: hist[i].price });
      }
    }
    return out;
  }

  // "Falskt tilbud": prisen settes opp, og senere "ned" til omtrent det den var før.
  function fakeSale(hist, current, now = Date.now()) {
    const ch = changes(hist).filter(c => now - c.date.getTime() < 75 * DAY);
    for (let i = 0; i < ch.length; i++) {
      const up = ch[i];
      if (up.to < up.from * 1.05) continue;
      for (let j = i + 1; j < ch.length; j++) {
        const down = ch[j];
        if (down.to < down.from && Math.abs(current - down.to) < 0.01 && down.to >= up.from * 0.97) {
          return { before: up.from, raised: up.to, upDate: up.date, downDate: down.date, now: down.to };
        }
      }
    }
    return null;
  }

  /**
   * analyze({ product, chain, shelfPrice, claimedBefore })
   * chain = kjeden du står i (nøkkel), shelfPrice = pris lest fra hyllelappen (valgfri)
   */
  function analyze({ product, chain, shelfPrice, claimedBefore, now = Date.now() }) {
    const reasons = [];
    let score = 50;
    const offers = product.offers.filter(o => o.price != null);
    const mine = offers.find(o => o.chain === chain) || null;
    const others = offers.filter(o => o !== mine).sort((a, b) => a.price - b.price);
    const price = shelfPrice ?? (mine && mine.price);

    if (price == null) {
      return { score: null, level: 'unknown', reasons: [{ type: 'info', text: 'Fant ingen pris for denne kjeden. Skriv inn prisen fra hyllelappen for å få en vurdering.' }], price: null, mine, others };
    }

    // 1) Sammenlign med andre kjeder akkurat nå
    if (others.length) {
      const cheapest = others[0];
      const diff = price - cheapest.price;
      const pct = diff / cheapest.price;
      if (diff <= 0.009) {
        score += diff < -0.5 ? 22 : 15;
        reasons.push({ type: 'good', text: diff < -0.5
          ? `Billigere enn alle andre kjeder – ${kr(-diff)} under ${cheapest.chainName}.`
          : `Like billig som den billigste kjeden (${cheapest.chainName}).` });
      } else {
        const p = Math.round(pct * 100);
        score -= pct > 0.25 ? 30 : pct > 0.12 ? 22 : pct > 0.05 ? 12 : 5;
        reasons.push({ type: pct > 0.05 ? 'bad' : 'info',
          text: `${kr(diff)} (${p} %) dyrere enn ${cheapest.chainName} (${kr(cheapest.price)}).` });
      }
    } else {
      reasons.push({ type: 'info', text: 'Fant ikke priser fra andre kjeder å sammenligne med.' });
    }

    // 2) Sammenlign med denne kjedens egen historikk (30 dager)
    const hist = mine ? mine.history : [];
    const s30 = stats(hist, 30, now);
    const s90 = stats(hist, 90, now);
    const fake = hist.length ? fakeSale(hist, price, now) : null;
    if (s30 && s30.max - s30.min >= 0.5) {
      if (price <= s30.min + 0.01 && !fake) {
        score += 14; reasons.push({ type: 'good', text: `Laveste pris her de siste 30 dagene (høyest var ${kr(s30.max)}).` });
      } else if (price >= s30.max - 0.01) {
        score -= 14; reasons.push({ type: 'bad', text: `Høyeste pris her de siste 30 dagene (lavest var ${kr(s30.min)}).` });
      } else {
        reasons.push({ type: 'info', text: `Har kostet mellom ${kr(s30.min)} og ${kr(s30.max)} her siste 30 dager.` });
      }
    } else if (s30) {
      reasons.push({ type: 'info', text: `Prisen her har ikke endret seg siste 30 dager.` });
    }
    if (s90 && s90.days > 45) {
      const vsMed = (price - s90.median) / s90.median;
      if (vsMed > 0.05) { score -= 8; reasons.push({ type: 'bad', text: `${Math.round(vsMed * 100)} % over vanlig pris her (median siste 3 mnd: ${kr(s90.median)}).` }); }
      else if (vsMed < -0.05) { score += 8; reasons.push({ type: 'good', text: `${Math.round(-vsMed * 100)} % under vanlig pris her (median siste 3 mnd: ${kr(s90.median)}).` }); }
    }

    // 3) Falskt tilbud?
    if (fake) {
      score -= 12;
      reasons.push({ type: 'bad', text: `Mulig «falskt tilbud»: prisen ble satt opp fra ${kr(fake.before)} til ${kr(fake.raised)} (${dato(fake.upDate)}), og er nå tilbake på ${kr(fake.now)}.` });
    }

    // 4) Nylig prisøkning
    const ch = changes(hist);
    const last = ch[ch.length - 1];
    if (last && !fake && last.to > last.from && now - last.date.getTime() < 21 * DAY && Math.abs(price - last.to) < 0.01) {
      const d = Math.round((now - last.date.getTime()) / DAY);
      score -= 5; reasons.push({ type: 'bad', text: `Prisen gikk opp fra ${kr(last.from)} for ${d === 0 ? 'under ett døgn' : d + ' dager'} siden.` });
    }

    // 5) «Før-pris» på hyllelappen – stemmer den?
    if (claimedBefore && claimedBefore > price) {
      const start = last ? last.date.getTime() : now;
      const pre = stats(hist, 30, now, start - DAY);
      if (pre && pre.min < claimedBefore - 0.5) {
        score -= 10;
        reasons.push({ type: 'bad', text: `Hyllelappen sier før-pris ${kr(claimedBefore)}, men den laveste prisen her de 30 dagene før var ${kr(pre.min)}.` });
      } else if (pre) {
        reasons.push({ type: 'good', text: `Før-prisen på lappen (${kr(claimedBefore)}) stemmer med historikken.` });
      }
    }

    // 6) Hyllepris vs. registrert pris
    if (shelfPrice != null && mine && mine.price != null && Math.abs(shelfPrice - mine.price) >= 0.5) {
      reasons.push({ type: 'info', text: shelfPrice < mine.price
        ? `Hyllelappen (${kr(shelfPrice)}) er lavere enn registrert pris (${kr(mine.price)}). Sjekk at du får hyllepris i kassa.`
        : `Hyllelappen (${kr(shelfPrice)}) er høyere enn registrert pris hos ${mine.chainName} (${kr(mine.price)}).` });
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const level = score >= 62 ? 'good' : score >= 40 ? 'ok' : 'bad';
    return { score, level, reasons, price, mine, others, s30, s90 };
  }

  return { analyze, stats, priceAt, changes, fakeSale, kr, dato, DAY };
})();

if (typeof module !== 'undefined') module.exports = Verdict;
