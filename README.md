# Lurt? 🛒

Er kjøpet lurt – eller blir du lurt? Skann en vare i butikken og få svaret.

**Åpne appen:** https://khalm.github.io/Lurt/

## Slik virker det
1. **Skann** strekkoden, ta bilde av **hyllelappen**, eller ta bilde av **selve varen**.
   - Strekkoden leses automatisk og er sikrest.
   - Fra hyllelappen leses også prisen (og eventuell «før»-pris).
   - Uten strekkode leses navnet, og du velger riktig vare fra en liste.
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

## Første gang: gratis nøkkel (2 min)
Prisene kommer fra [Kassalapp](https://kassal.app), som samler priser fra norske dagligvarekjeder. Det er gratis for privat bruk:
1. Gå til [kassal.app/profil/api](https://kassal.app/profil/api) og lag en gratis konto.
2. Lag en API-nøkkel og kopier den.
3. I Lurt?: **Innstillinger → lim inn → Lagre og test**.

Nøkkelen lagres bare på telefonen din. Uten nøkkel kan du trykke «Prøv med eksempeldata» for å se hvordan appen ser ut.

## Installer på telefonen
- **Android (Chrome):** åpne lenken → ⋮ → **Installer app**.
- **iPhone (Safari):** åpne lenken → Del → **Legg til på Hjem-skjerm**.

## Helt gratis
Ingen betalte tjenester. Strekkoder og tekst leses **på telefonen**:
- Strekkode: innebygd i Chrome på Android; på iPhone brukes [ZXing](https://github.com/Sec-ant/barcode-detector) (åpen kildekode).
- Tekst på hyllelapp/emballasje: [Tesseract.js](https://github.com/naptha/tesseract.js) (lastes ned første gang, ca. 10 MB).
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
- `style.css` – utseende
- `sw.js`, `manifest.json` – installerbar app som åpner uten nett
- `worker.js` – valgfri proxy
