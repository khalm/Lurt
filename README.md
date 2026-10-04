# Lurt? 🏷️

<img src="icon-512.png" width="96" alt="Lurt?-logo">

Er kjøpet lurt – eller blir du lurt? Skann en vare i butikken og få svaret.

**Åpne appen:** https://khalm.github.io/Lurt/

## Slik virker det
1. **Skann** strekkoden, eller ta bilde av **hyllelappen**.
   - Strekkoden leses automatisk og er sikrest.
   - På hyllelappen leses varenavn, pris, før-pris, kilopris og flerkjøpstilbud. Har lappen strekkode, brukes den.
   - Du ser hva som ble lest og kan rette prisen før du velger vare. Treff med samme pris som på lappen merkes «✓ Samme pris».
   - Tips: hold telefonen rett foran lappen så den fyller rammen, og unngå gjenskinn. Appen tar et ekte foto i full oppløsning, bytter til nærbilde automatisk og har 🔦 for dårlig lys.
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

## Nøkler (legges inn på GitHub – brukerne slipper)
Begge nøklene er gratis og legges inn **én gang** under **Settings → Secrets and variables → Actions → New repository secret**. De bygges inn i appen automatisk når den publiseres.

| Secret | Hva | Hvor du får den |
|---|---|---|
| `KASSAL_KEY` | Priser og butikker (påkrevd) | [kassal.app/profil/api](https://kassal.app/profil/api) |
| `GEMINI_KEY` | KI-lesing av hyllelapper (anbefalt) | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → «Create API key» |

Etter at en secret er lagt inn: **Actions → Publiser appen → Run workflow**. `build-info.json` viser om nøklene ble funnet (`priceData`, `aiLabels`).

Uten `GEMINI_KEY` leses lappene med enklere tekstgjenkjenning på telefonen. Gemini har en gratis dagskvote; er den brukt opp, faller appen automatisk tilbake til lokal lesing. Bildet av lappen sendes da til Google for å leses. Ikke slå på fakturering for nøkkelen, så kan den aldri koste noe.

Nøklene ligger ikke i koden i repoet, men kan finnes av noen som graver i den publiserte siden. For å skjule Kassal-nøkkelen helt kan du sette opp gratis Cloudflare-proxy (`worker.js`) og legge adressen inn som secret `PROXY_URL` i stedet.

## Installer på telefonen
- **Android (Chrome):** åpne lenken → ⋮ → **Installer app**. På Pixel havner nye apper i **appskuffen** (sveip opp), ikke automatisk på hjemskjermen.
  - Sier Chrome «This app is already installed» uten at du finner den: sveip opp og søk «Lurt». Finnes den ikke, gå til Innstillinger → Apper → Lurt? → Avinstaller, og installer på nytt.
- **iPhone (Safari):** åpne lenken → Del → **Legg til på Hjem-skjerm**.

## Helt gratis
Ingen betalte tjenester:
- Strekkode: innebygd i Chrome på Android; på iPhone brukes [ZXing](https://github.com/Sec-ant/barcode-detector) (åpen kildekode).
- Tekst på hyllelapp/emballasje: [Tesseract.js](https://github.com/naptha/tesseract.js) (lastes ned første gang, ca. 10 MB).
- KI-lesing av hyllelapper: [Google Gemini](https://ai.google.dev) (gratis kvote, valgfritt).
- Priser og butikker: [Kassalapp API](https://kassal.app/api) (gratis «Hobby»-nivå: 60 oppslag i minuttet). Svar lagres i 6 timer, så samme vare koster ikke nye oppslag.

## Begrensninger
- Kassalapp har kjedenes registrerte (nett)priser. De fleste kjeder har like priser i hele landet, men enkeltbutikker kan avvike. Derfor kan du alltid skrive inn hylleprisen selv.
- Uten KI-lesing er tekstlesing av hyllelapper usikker – strekkode gir alltid best treff.

## Hvis appen ikke får kontakt med Kassalapp
Noen nettlesere kan blokkere direkte oppslag (CORS). Da kan du sette opp en gratis proxy på Cloudflare – se instruksjonene øverst i `worker.js`, og legg adressen inn som GitHub-secret `PROXY_URL`.

## Teknisk
Ren HTML/CSS/JavaScript uten byggesteg, hostet på GitHub Pages. Kan redigeres rett i GitHub på mobilen.
- `index.html` – skjermer og layout
- `app.js` – logikk for skjermene
- `api.js` – Kassalapp-oppslag, lagring og kjeder
- `verdict.js` – regnestykket bak «Lurt?»-dommen (poeng, falske tilbud, før-pris)
- `scan.js` – kamera, strekkodeleser og lesing av hyllelapper
- `ai.js` – KI-lesing av hyllelapper (Gemini)
- `brands.js` – liste over varemerker, brukes til å rette lesefeil (rediger fritt)
- `style.css` – utseende
- `sw.js`, `manifest.json` – installerbar app som åpner uten nett
- `config.js` – innebygd nøkkel/proxy (skrives av `.github/workflows/pages.yml`)
- `icon.svg` – logo (PNG-ikonene er laget fra den)
- `worker.js` – valgfri proxy
