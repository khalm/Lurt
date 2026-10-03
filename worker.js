// worker.js — VALGFRI gratis proxy på Cloudflare Workers.
// Trengs bare hvis nettleseren ikke får lov til å snakke direkte med Kassalapp (CORS).
// Oppsett (kan gjøres på mobilen):
//   1. Gå til https://dash.cloudflare.com → Workers & Pages → Create → Create Worker
//   2. Gi den et navn (f.eks. lurt-proxy) → Deploy → Edit code
//   3. Lim inn hele denne filen → Deploy
//   4. Kopier adressen (https://lurt-proxy.<navn>.workers.dev) inn under
//      Innstillinger → Avansert: proxy i Lurt?
// API-nøkkelen din sendes videre fra appen; den lagres ikke i proxyen.

const ALLOWED_ORIGIN = 'https://khalm.github.io';

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const target = 'https://kassal.app/api/v1' + url.pathname + url.search;
    const res = await fetch(target, {
      method: request.method,
      headers: {
        'Authorization': request.headers.get('Authorization') || '',
        'Accept': 'application/json',
        'Content-Type': request.headers.get('Content-Type') || 'application/json',
      },
      body: request.method === 'POST' ? await request.text() : undefined,
    });
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
