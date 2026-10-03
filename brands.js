// brands.js — norske (og vanlige) dagligvaremerker. Brukes til å rette lesefeil («Grandios» → «Grandiosa»)
// og til å søke på merke + varetype. Listen utvides automatisk med merker appen ser i prisdataene.
'use strict';

const Brands = (() => {
  const BASE = `
Tine;Q-Meieriene;Synnøve;Synnøve Finden;Jarlsberg;Norvegia;Ridderost;Snøfrisk;Gudbrandsdalsost;Kavli;Mills;Stabburet;Gilde;Prior;Nortura;Fatland;Grilstad;Leiv Vidar;Nordfjord;Finsbråten;Den Stolte Hane;Solvinge;Ytterøykylling;Norsk Kylling;Jacobs Utvalgte;Eldorado;First Price;Xtra;Coop;Rema 1000;Unik;Folkets;Lerøy;Mowi;Salma;King Oscar;Stabbur-Makrell;Lofoten;Findus;Frionor;Fjordland;Toro;Knorr;Maggi;Idun;Regal;Møllerens;Bjørn;Freia;Nidar;Kvikk Lunsj;Smash;Laban;Stratos;Firkløver;Troika;Hobby;Seigmenn;Sørlandschips;Kims;Maarud;Polly;Pringles;Bugles;Cheez Doodles;Nøtti Frutti;Friele;Evergood;Ali;BKI;Kjeldsberg;Joh. Johannson;Jacobs;Lipton;Twinings;Pukka;Grandiosa;Big One;Dr. Oetker;Peppes;Kokkens;Bremykt;Brelett;Melange;Soft Flora;Flora;Vita;Olivero;Sætre;Göteborgs;Ballerina;Bixit;Oreo;Wasa;Leksands;Sigdal;Bakers;Mesterbakeren;Bakehuset;Hatting;Pågen;Kellogg's;Nestlé;Weetabix;Quaker;Axa;Havrefras;Cheerios;Nesquik;Cini Minis;Mr. Lee;Yoplait;Activia;Danone;Lindt;Marabou;Cloetta;Haribo;Malaco;Nugatti;Nora;Lerum;Hapå;Sunniva;Biola;Litago;Go'morgen;Piano;Kesam;Cultura;Oatly;Alpro;Arla;Philadelphia;Président;Castello;Apetina;Salakis;Galbani;Coca-Cola;Pepsi;Pepsi Max;Solo;Mozell;Farris;Imsdal;Olden;Bonaqua;Telemark;Isklar;Villa;Urge;Fanta;Sprite;7Up;Schweppes;Battery;Red Bull;Monster;Celsius;Burn;Nocco;Ringnes;Hansa;Mack;Aass;Frydenlund;Borg;Tuborg;Carlsberg;Grans;Nøgne Ø;Lervig;Heinz;Idun Ketchup;Barilla;Uncle Ben's;Ben's Original;Santa Maria;Old El Paso;Tabasco;Mutti;Zeta;Felix;Nescafé;Gevalia;Zoégas;Löfbergs;Lavazza;Illy;Bama;Hoff;Eldhus;Hennig-Olsen;Diplom-Is;Pinup;Krone-Is;Ben & Jerry's;Magnum;Lano;Zalo;Jif;Klorin;Define;Zendium;Colgate;Solidox;Sensodyne;Libero;Pampers;Lambi;Serla;Omo;Neutral;Milo;Comfort;Lilleborg;Finish;Fairy;Dove;Head & Shoulders;Pantene;Nivea;Gillette;Always;Tampax;Vanish;Ajax;Grumme;Sunlight;Synnøve Gulost;Norvegia Lett;Philadelphia Original;Sørlandsis;Tulip;Scan;Polar;Ringstad;Arneberg;Eidsvoll;Gårdsand;Hvaler;Lunde;Holmen;Steinsland;Nordic Seafood;Stabburet Leverpostei;Mills Majones;Mills Kaviar;Kalles;Kalles Kaviar;Skagenkaviar;Mor Monsen;Bakeriet;Ideal;Mors Flatbrød;Ideal Flatbrød;Leksands Knäcke;Göteborgs Kjeks;Tine Smør;Q Lettmelk;Tine Lettmelk;Lerum Saft;Nora Saft;Freia Melkesjokolade;Twist;Non Stop;Smil;Melkerull;Japp;Bounty;Snickers;Mars;Twix;Kitkat;M&M's;Toblerone;Daim;Kexchoklad;Supreme;Lay's;Doritos;Estrella;OLW;Maarud Potetgull;Ahlgrens;Fazer;Kalas;Bilar;Djungelvrål;Hubba Bubba;Stimorol;Mentos;Fisherman's;Läkerol;Sorbits;Freia Twist;O'boy;Swiss Miss;Nutella;Sunda;Skippy;Gilde Servelat;Gilde Kjøttboller;Gilde Wienerpølser;Gilde Grillpølser;Prior Kyllingfilet;Stabburet Makrell;Vestlandslefsa;Hellefisk;Kavli Prim;Kavli Reker;Mills Remulade;Idun Sennep;Toro Lasagne;Toro Gryte;Knorr Suppe;Maggi Nudler;Yum Yum;Nissin;Santa Maria Tacokrydder;Rema Taco;Old El Paso Tortilla;Pastella;Barilla Pasta;Sopps;Møllerens Hvetemel;Regal Mel;Dan Sukker;Jozo;Hindu;Santa Maria Krydder;Hellmann's;Kühne;Felix Ketchup;Heinz Ketchup;Bähncke;Coop Xtra;Rema 1000 Kaffe;First Price Kaffe;Evergood Classic;Friele Frokostkaffe;Ali Original;Joh. Johannson Kaffe;Kjeldsbergs;Pukka Te;Lipton Te;Bama Gruppen;Grønn Linje;Gartnerier;Coop Prima;Coop Gilde;Änglamark;Garant;Fun Light;Sunquick;Brazil;Trope;Sunniva Appelsinjuice;Tropicana;God Morgen;Innocent;Froosh;Proteinfabrikken;Barebells;Nutramino;Fulfil;Gainomax;YT Restitusjon;Pocket;Whiskas;Felix Katt;Purina;Pedigree;Royal Canin;Hill's;Dreamies;Sheba;Gourmet;Friskies;Applaws
`;
  const LEARN_KEY = 'lurt.brands';
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/å/g, 'a').replace(/[^a-z0-9 &'.-]/g, '').trim();

  let list = null;
  function all() {
    if (list) return list;
    let learned = [];
    try { learned = JSON.parse(localStorage.getItem(LEARN_KEY) || '[]'); } catch { /* */ }
    const set = new Map();
    for (const b of BASE.split(';').map(s => s.trim()).concat(learned)) {
      if (b && b.length >= 2 && !set.has(norm(b))) set.set(norm(b), b);
    }
    list = [...set.entries()].map(([n, b]) => ({ name: b, n, words: n.split(/\s+/) }));
    return list;
  }

  // Lærer nye merker fra prisdataene (f.eks. når et søk eller oppslag gir et merke vi ikke kjente)
  function learn(names) {
    const known = new Set(all().map(b => b.n));
    const add = names.filter(Boolean).map(s => String(s).trim()).filter(s => s.length >= 2 && s.length <= 30 && !known.has(norm(s)));
    if (!add.length) return;
    let learned = [];
    try { learned = JSON.parse(localStorage.getItem(LEARN_KEY) || '[]'); } catch { /* */ }
    learned = [...new Set(learned.concat(add))].slice(-1500);
    try { localStorage.setItem(LEARN_KEY, JSON.stringify(learned)); } catch { /* */ }
    list = null;
  }

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        rowMin = Math.min(rowMin, cur[j]);
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  const allowed = (len) => len <= 4 ? 0 : len <= 7 ? 1 : 2;

  // Finner merker blant ordene fra bildet og retter lesefeil i dem.
  // Returnerer { brands: [«Grandiosa»], words: [rettede ord] }
  function detect(words) {
    const ws = words.map(w => ({ raw: w, n: norm(w) }));
    const found = [];
    const out = ws.map(w => w.raw);
    const used = new Set();
    // Lengste merker først (f.eks. «Kvikk Lunsj» før «Kvikk»)
    const brands = all().slice().sort((a, b) => b.words.length - a.words.length || b.n.length - a.n.length);
    for (const b of brands) {
      if (b.n.length < 3) continue;
      const k = b.words.length;
      for (let i = 0; i + k <= ws.length; i++) {
        if ([...Array(k).keys()].some(j => used.has(i + j))) continue;
        const cand = ws.slice(i, i + k).map(w => w.n).join(' ');
        if (cand.length < 3) continue;
        const d = lev(cand, b.n, allowed(b.n.length));
        if (d <= allowed(b.n.length)) {
          found.push(b.name);
          for (let j = 0; j < k; j++) used.add(i + j);
          out[i] = b.name; for (let j = 1; j < k; j++) out[i + j] = null;
        }
      }
    }
    // Ord fra bildet kan stå i annen rekkefølge enn merket – sjekk også hvert ord alene mot ettords-merker
    return { brands: [...new Set(found)], words: out.filter(Boolean) };
  }

  const isBrand = (p, brand) => norm(p.brand || '').includes(norm(brand)) || norm(p.name || '').startsWith(norm(brand));

  return { detect, learn, isBrand, norm, count: () => all().length };
})();

if (typeof module !== 'undefined') module.exports = Brands;
