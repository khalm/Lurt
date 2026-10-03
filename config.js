// config.js — innebygd oppsett.
// Denne filen skrives på nytt automatisk når appen publiseres (se .github/workflows/pages.yml),
// med verdier fra repoets «Secrets». Ikke lim inn nøkler her direkte.
window.LURT_CONFIG = {
  apiKey: '',   // fra secret KASSAL_KEY
  proxy: '',    // fra secret PROXY_URL (Cloudflare-proxy som har nøkkelen selv)
};
