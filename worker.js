// worker.js — VALGFRI gratis proxy på Cloudflare Workers.
// Trengs bare hvis nettleseren ikke får lov til å snakke direkte med Kassalapp (CORS).
// Oppsett (kan gjøres på mobilen):
//   1. Gå til https://dash.cloudflare.com → Workers & Pages → Create → Create Worker
//   2. Gi den et navn (f.eks. lurt-proxy) → Deploy → Edit code
//   3. Lim inn hele denne filen → Deploy
//   4. Settings → Variables and Secrets → Add → Type «Secret», navn KASSAL_KEY,
//      verdi = Kassalapp-nøkkelen din → Deploy
//   5. Legg adressen (https://lurt-proxy.<navn>.workers.dev) inn som secret PROXY_URL
//      i GitHub-repoet (se README). Da trenger ingen brukere nøkkel, og nøkkelen er skjult.
// Uten KASSAL_KEY sendes nøkkelen fra appen videre i stedet.

const ALLOWED_ORIGIN = 'https://khalm.github.io';

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    // Bare lese-oppslag appen trenger
    if (!/^\/(products|physical-stores)/.test(url.pathname)) return new Response('Not found', { status: 404, headers: cors });
    const target = 'https://kassal.app/api/v1' + url.pathname + url.search;
    const res = await fetch(target, {
      method: request.method,
      headers: {
        'Authorization': env && env.KASSAL_KEY ? 'Bearer ' + env.KASSAL_KEY : (request.headers.get('Authorization') || ''),
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
