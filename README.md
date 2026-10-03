# Lurt? 🏷️

<img src="icon-512.png" width="96" alt="Lurt?-logo">

Er kjøpet lurt – eller blir du lurt? Skann en vare i butikken og få svaret.

**Åpne appen:** https://khalm.github.io/Lurt/

## Slik virker det
1. **Skann** strekkoden, ta bilde av **hyllelappen**, eller ta bilde av **selve varen**.
   - Strekkoden leses automatisk og er sikrest.
   - Fra hyllelappen leses også prisen (og eventuell «før»-pris).
   - Uten strekkode leses navnet, og du velger riktig vare fra en liste. Ordene appen fant vises som knapper du kan slå av og på.
   - I **Vare**-modus kjenner appen også igjen varen på bildet: den gjetter varetypen (kaffe, pizza, melk …) og sammenligner bildet med produktbildene, så den mest like havner øverst («👁️ Mest lik»).
   - Appen kjenner ~400 norske varemerker (Tine, Gilde, Stabburet, Grandiosa …) og lærer flere fra prisdataene. Feilleste merker rettes («Grandios» → «Grandiosa»), og det søkes på merke + varetype.
   - Den **pugger** varer du tar bilde av og velger, så neste gang kjenner den dem igjen («⭐ Kjent fra før»). Alt lagres bare på telefonen.
   - Tips: gå nær så lappen fyller rammen, hold stødig (appen tar flere bilder og velger det skarpeste), og bruk 🔦 i dårlig lys.
2. **Butikken** du står i finnes automatisk med GPS (eller velg selv øverst).
3. Du får en **dom**: 😎 *Lurt kjøp!*, 🤔 *Helt grei pris* eller 🤡 *Du blir lurt!* – med begrunnelse:
   - Pris nå i andre kjeder, og hva du sparer
   - Prishistorikk i denne kjeden (1 måned, kan utvides til 3 mnd, 6 mnd, 1 år eller alt)
   - Om prisen er lav eller høy sammenlignet med de siste 30 dagene og vanlig pris
   - **Falske tilbud**: om prisen ble satt opp rett før den ble satt «ned» igjen
   - Om **før-prisen** på hyllelappen stemmer med historikken
   - Om **hylleprisen** avviker fra den registrerte prisen
   - Nærmeste butikk i den billigste kjeden
4. **Følg prisen** på varer du kjøper ofte, og se om de har blitt billigere neste gang du åpner appen.

## Prisdata: bygg inn nøkkelen én gang (brukerne slipper)
Prisene kommer fra [Kassalapp](https://kassal.app) (gratis for privat bruk). Nøkkelen legges inn **én gang i GitHub**, så bygges den inn i appen automatisk:
1. Hent nøkkel på [kassal.app/profil/api](https://kassal.app/profil/api).
2. I repoet: **Settings → Secrets and variables → Actions → New repository secret**. Navn: `KASSAL_KEY`, verdi: nøkkelen.
3. **Settings → Pages → Source: GitHub Actions** (én gang).
4. **Actions → Publiser appen → Run workflow** (eller bare gjør en endring).

Brukerne ser aldri noe til nøkkelen. Etter publisering viser `build-info.json` om nøkkelen ble funnet (`priceData: true`).

Nøkkelen ligger ikke i koden i repoet, men kan finnes av noen som graver i den publiserte siden. For å skjule den helt kan eieren av repoet sette opp gratis Cloudflare-proxy (`worker.js`) og legge adressen inn som secret `PROXY_URL` i stedet.

## Installer på telefonen
- **Android (Chrome):** åpne lenken → ⋮ → **Installer app**. På Pixel havner nye apper i **appskuffen** (sveip opp), ikke automatisk på hjemskjermen.
  - Sier Chrome «This app is already installed» uten at du finner den: sveip opp og søk «Lurt». Finnes den ikke, gå til Innstillinger → Apper → Lurt? → Avinstaller, og installer på nytt.
- **iPhone (Safari):** åpne lenken → Del → **Legg til på Hjem-skjerm**.

## Helt gratis
Ingen betalte tjenester. Strekkoder og tekst leses **på telefonen**:
- Strekkode: innebygd i Chrome på Android; på iPhone brukes [ZXing](https://github.com/Sec-ant/barcode-detector) (åpen kildekode).
- Tekst på hyllelapp/emballasje: [Tesseract.js](https://github.com/naptha/tesseract.js) (lastes ned første gang, ca. 10 MB).
- Bildegjenkjenning: [MobileCLIP S0](https://huggingface.co/Xenova/mobileclip_s0) via [Transformers.js](https://github.com/huggingface/transformers.js) (ca. 55 MB første gang, kan slås av i Innstillinger). Produktbildene hentes små via [wsrv.nl](https://wsrv.nl).
- Priser og butikker: [Kassalapp API](https://kassal.app/api) (gratis «Hobby»-nivå: 60 oppslag i minuttet). Svar lagres i 6 timer, så samme vare koster ikke nye oppslag.

## Begrensninger
- Kassalapp har kjedenes registrerte (nett)priser. De fleste kjeder har like priser i hele landet, men enkeltbutikker kan avvike. Derfor kan du alltid skrive inn hylleprisen selv.
- Tekstlesing av emballasje er usikker – strekkode eller hyllelapp gir best treff.

## Hvis appen ikke får kontakt med Kassalapp
Noen nettlesere kan blokkere direkte oppslag (CORS). Da kan du sette opp en gratis proxy på Cloudflare – se instruksjonene øverst i `worker.js`, og lim adressen inn under **Innstillinger → Avansert: proxy**.

## Teknisk
Ren HTML/CSS/JavaScript uten byggesteg, hostet på GitHub Pages. Kan redigeres rett i GitHub på mobilen.
- `index.html` – skjermer og layout
- `app.js` – logikk for skjermene
- `api.js` – Kassalapp-oppslag, lagring og kjeder
- `verdict.js` – regnestykket bak «Lurt?»-dommen (poeng, falske tilbud, før-pris)
- `scan.js` – kamera, strekkodeleser og lesing av hyllelapper
- `vision.js` – gjenkjenning av varer på bilde, og pugging av varer du har valgt
- `brands.js` – liste over varemerker (rediger fritt for å legge til flere)
- `style.css` – utseende
- `sw.js`, `manifest.json` – installerbar app som åpner uten nett
- `config.js` – innebygd nøkkel/proxy (skrives av `.github/workflows/pages.yml`)
- `icon.svg` – logo (PNG-ikonene er laget fra den)
- `worker.js` – valgfri proxy
