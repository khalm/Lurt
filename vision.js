// vision.js — gjenkjenner varer på bilde, helt på telefonen.
// Bruker en liten åpen bildemodell (MobileCLIP S0, ca. 55 MB, lastes ned én gang og lagres):
//  1) gjetter hva slags vare det er (kaffe, pizza, melk …) → gir søkeord selv uten lesbar tekst
//  2) sammenligner bildet ditt med produktbildene i søketreffene → riktig vare havner øverst
'use strict';

const Vision = (() => {
  const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';
  const MODEL = 'Xenova/mobileclip_s0';
  const VER = 'v1';
  let lib = null, tok = null, textM = null, proc = null, visM = null, loading = null, cats = null;
  const embCache = new Map();

  // [søkeord på norsk, beskrivelse for modellen]
  const CATEGORIES = [
    ['kaffe', 'a bag of ground coffee'], ['kaffe', 'a jar of instant coffee'], ['te', 'a box of tea bags'],
    ['melk', 'a carton of milk'], ['juice', 'a carton of orange juice'], ['fløte', 'a small carton of cream'],
    ['yoghurt', 'a cup of yogurt'], ['rømme', 'a tub of sour cream'], ['smør', 'a pack of butter'],
    ['ost', 'a block of cheese'], ['ost', 'a package of sliced cheese'], ['egg', 'a carton of eggs'],
    ['brød', 'a loaf of bread in a bag'], ['knekkebrød', 'a box of crispbread'], ['frokostblanding', 'a box of breakfast cereal'],
    ['havregryn', 'a bag of oats'], ['müsli', 'a bag of granola'], ['pizza', 'a frozen pizza box'],
    ['pølser', 'a package of sausages'], ['kjøttdeig', 'a package of minced meat'], ['kylling', 'a package of chicken'],
    ['laks', 'a package of salmon fillets'], ['fiskepinner', 'a box of fish fingers'], ['skinke', 'a package of sliced ham'],
    ['leverpostei', 'a tin of liver pate'], ['kaviar', 'a tube of fish roe spread'], ['syltetøy', 'a jar of jam'],
    ['peanøttsmør', 'a jar of peanut butter'], ['sjokolade', 'a chocolate bar'], ['godteri', 'a bag of candy'],
    ['chips', 'a bag of potato chips'], ['nøtter', 'a bag of nuts'], ['kjeks', 'a package of cookies'],
    ['iskrem', 'a tub of ice cream'], ['brus', 'a bottle of soda'], ['brus', 'a can of soda'],
    ['energidrikk', 'a can of energy drink'], ['vann', 'a bottle of water'], ['saft', 'a bottle of fruit syrup'],
    ['øl', 'a can of beer'], ['pasta', 'a package of dry pasta'], ['ris', 'a bag of rice'],
    ['nudler', 'a pack of instant noodles'], ['suppe', 'a packet of instant soup'], ['pastasaus', 'a jar of pasta sauce'],
    ['hakkede tomater', 'a can of chopped tomatoes'], ['bønner', 'a can of beans'], ['mais', 'a can of sweet corn'],
    ['taco', 'a taco kit box'], ['tortilla', 'a pack of tortilla wraps'], ['ketchup', 'a bottle of ketchup'],
    ['majones', 'a tube of mayonnaise'], ['sennep', 'a bottle of mustard'], ['krydder', 'a jar of spices'],
    ['olje', 'a bottle of cooking oil'], ['mel', 'a bag of flour'], ['sukker', 'a bag of sugar'],
    ['kakao', 'a tin of cocoa powder'], ['frosne grønnsaker', 'a bag of frozen vegetables'], ['proteinbar', 'a protein bar'],
    ['tyggegummi', 'a pack of chewing gum'], ['vaskemiddel', 'a bottle of laundry detergent'], ['oppvaskmiddel', 'a bottle of dish soap'],
    ['toalettpapir', 'a pack of toilet paper'], ['tørkerull', 'a pack of paper towels'], ['sjampo', 'a bottle of shampoo'],
    ['tannkrem', 'a tube of toothpaste'], ['bleier', 'a pack of diapers'], ['kattemat', 'a bag of cat food'],
    ['hundemat', 'a bag of dog food'], ['smoothie', 'a bottle of smoothie'],
  ];

  const enabled = () => { try { return (JSON.parse(localStorage.getItem('lurt.settings') || '{}').vision) !== false; } catch { return true; } };
  const ready = () => !!(visM && cats);
  const downloaded = () => localStorage.getItem('lurt.vision.ok') === VER;

  async function load(onProgress) {
    if (ready()) return true;
    if (loading) return loading;
    loading = (async () => {
      lib = await import(LIB);
      lib.env.allowLocalModels = false;
      const files = {};
      const progress_callback = (p) => {
        if (p.status === 'progress' && p.total) {
          files[p.file] = [p.loaded, p.total];
          const l = Object.values(files).reduce((s, f) => s + f[0], 0), t = Object.values(files).reduce((s, f) => s + f[1], 0);
          onProgress && onProgress(l / t, t);
        }
      };
      const opts = { dtype: 'q8', device: 'wasm', progress_callback };
      [tok, proc] = await Promise.all([lib.AutoTokenizer.from_pretrained(MODEL), lib.AutoProcessor.from_pretrained(MODEL)]);
      [visM, textM] = await Promise.all([
        lib.CLIPVisionModelWithProjection.from_pretrained(MODEL, opts),
        lib.CLIPTextModelWithProjection.from_pretrained(MODEL, opts),
      ]);
      cats = await categoryEmbeddings();
      localStorage.setItem('lurt.vision.ok', VER);
      return true;
    })().catch((e) => { loading = null; throw e; });
    return loading;
  }

  async function categoryEmbeddings() {
    const key = 'lurt.vision.cats.' + VER;
    try {
      const c = JSON.parse(localStorage.getItem(key) || 'null');
      if (c && c.length === CATEGORIES.length) return c;
    } catch { /* regn ut på nytt */ }
    const texts = CATEGORIES.map(([, d]) => 'a photo of ' + d);
    const out = [];
    for (let i = 0; i < texts.length; i += 16) {
      const inputs = tok(texts.slice(i, i + 16), { padding: 'max_length', truncation: true });
      const { text_embeds } = await textM(inputs);
      out.push(...text_embeds.normalize().tolist().map(v => v.map(x => +x.toFixed(4))));
    }
    try { localStorage.setItem(key, JSON.stringify(out)); } catch { /* full */ }
    return out;
  }

  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

  async function embedImage(image) {
    const inputs = await proc(image);
    const { image_embeds } = await visM(inputs);
    return image_embeds.normalize().tolist()[0];
  }

  async function embedCanvas(canvas) {
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    return embedImage(await lib.RawImage.fromBlob(blob));
  }

  // Produktbilder hentes via en gratis bildeproxy som tillater dette i nettleseren (og gjør dem små)
  const thumb = (url) => 'https://wsrv.nl/?w=256&h=256&fit=contain&cbg=white&output=jpg&url=' + encodeURIComponent(url.replace(/^https?:\/\//, ''));

  async function embedUrl(url) {
    if (embCache.has(url)) return embCache.get(url);
    const p = (async () => embedImage(await lib.RawImage.fromURL(thumb(url))))();
    embCache.set(url, p);
    try { return await p; } catch (e) { embCache.delete(url); throw e; }
  }

  // Hva slags vare er det? → topp-kategorier med søkeord
  function classify(emb, n = 3) {
    const scores = cats.map((c, i) => ({ term: CATEGORIES[i][0], s: dot(emb, c) }));
    const max = Math.max(...scores.map(x => x.s));
    const exp = scores.map(x => ({ ...x, p: Math.exp(100 * (x.s - max)) }));
    const sum = exp.reduce((s, x) => s + x.p, 0);
    const best = new Map();
    for (const x of exp.sort((a, b) => b.p - a.p)) if (!best.has(x.term)) best.set(x.term, x.p / sum);
    return [...best.entries()].slice(0, n).map(([term, p]) => ({ term, p }));
  }

  // Likhet mellom bildet ditt og produktbildene (kjøres noen om gangen)
  async function rank(emb, items, onProgress) {
    const todo = items.filter(x => x.image);
    let done = 0;
    const worker = async () => {
      while (todo.length) {
        const it = todo.shift();
        try { it.sim = dot(emb, await embedUrl(it.image)); } catch { it.sim = null; }
        onProgress && onProgress(++done);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return items;
  }

  return { load, ready, enabled, downloaded, embedCanvas, classify, rank, MODEL_MB: 55 };
})();
