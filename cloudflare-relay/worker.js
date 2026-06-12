// worker.js — OnlyStars relay + proxies on Cloudflare Workers + Durable Objects.
//
// This one Worker serves three things, so a GitHub Pages site (which has no
// serverless functions of its own) has everything it needs:
//   • WebSocket upgrade on ANY path  -> live lightning relay (Durable Object)
//   • GET /seventimer?lat&lon         -> 7Timer ASTRO proxy (http-only + CORS)
//   • GET /saveecobot?lat&lon         -> SaveEcoBot nearest-station air quality
//
// A single, globally-unique Durable Object holds ONE upstream WebSocket to
// Blitzortung (policy-compliant), decodes/filters it, and fans strikes out to
// every browser. It only runs while someone is watching, so it sits inside the
// Workers Free plan.
//
// Deploy:  npm i -g wrangler && wrangler login && wrangler deploy
//
// NON-COMMERCIAL USE ONLY. The Blitzortung protocol is unofficial and may change.

const UPSTREAMS = ['ws1', 'ws7', 'ws8', 'ws3'].map((h) => `https://${h}.blitzortung.org/`);
const BBOX = [21.5, 43.5, 41.5, 53.5]; // Ukraine + margin: [west, south, east, north]

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const J = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'Cache-Control': 'public, max-age=600', ...CORS },
  });

// Long-standing community decoder for Blitzortung's LZW-compressed frames.
function decode(b) {
  const e = {};
  const d = String(b).split('');
  let c = d[0], f = c, o = 256;
  const g = [c];
  for (let i = 1; i < d.length; i++) {
    const code = d[i].charCodeAt(0);
    const a = code < 256 ? d[i] : (e[code] ? e[code] : f + c);
    g.push(a);
    c = a.charAt(0);
    e[o++] = f + c;
    f = a;
  }
  return g.join('');
}
const inBox = (lat, lon) => lon >= BBOX[0] && lat >= BBOX[1] && lon <= BBOX[2] && lat <= BBOX[3];

// ---------------- HTTP proxies ----------------
async function seventimer(url) {
  const lat = url.searchParams.get('lat'), lon = url.searchParams.get('lon');
  if (!lat || !lon) return J({ error: 'lat and lon required' }, 400);
  try {
    const u = `http://www.7timer.info/bin/api.pl?lon=${encodeURIComponent(lon)}` +
      `&lat=${encodeURIComponent(lat)}&product=astro&output=json&unit=metric`;
    const r = await fetch(u, { headers: { 'User-Agent': 'onlystars/1.0' } });
    const t = await r.text();
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    return J(JSON.parse(t.slice(s, e + 1)));
  } catch (e) {
    return J({ error: String(e.message || e) }, 502);
  }
}

const km = (aLat, aLon, bLat, bLon) => {
  const R = 6371, r = (d) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat), dLon = r(bLon - aLon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
function readStations(raw) {
  return (Array.isArray(raw) ? raw : []).map((s) => {
    const lat = parseFloat(s.latitude ?? s.lat);
    const lon = parseFloat(s.longitude ?? s.lng ?? s.lon);
    const name = s.stationName || s.localName || s.cityName || s.platformName || 'station';
    let pm25 = null, aqi = null;
    for (const p of (s.pollutants || s.pollutant || [])) {
      const key = (p.pol || p.name || '').toString().toUpperCase();
      const val = parseFloat(p.value ?? p.averageValue);
      if (Number.isNaN(val)) continue;
      if (key.includes('PM2.5') || key.includes('PM25')) pm25 = val;
      if (key.includes('AIR QUALITY INDEX') || key === 'AQI') aqi = val;
    }
    return { name, lat, lon, pm25, aqi };
  }).filter((s) => !Number.isNaN(s.lat) && !Number.isNaN(s.lon));
}
let sebCache = { at: 0, stations: null };
async function saveecobot(url) {
  const lat = parseFloat(url.searchParams.get('lat')), lon = parseFloat(url.searchParams.get('lon'));
  if (Number.isNaN(lat) || Number.isNaN(lon)) return J({ error: 'lat and lon required' }, 400);
  try {
    if (!sebCache.stations || Date.now() - sebCache.at > 10 * 60 * 1000) {
      const r = await fetch('https://api.saveecobot.com/output.json', { headers: { 'User-Agent': 'onlystars/1.0' } });
      if (!r.ok) throw new Error(`SaveEcoBot ${r.status}`);
      sebCache = { at: Date.now(), stations: readStations(await r.json()) };
    }
    let best = null, bestD = Infinity;
    for (const s of sebCache.stations) {
      if (s.pm25 == null && s.aqi == null) continue;
      const d = km(lat, lon, s.lat, s.lon);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best || bestD > 120) return J({ station: null });
    return J({ station: best.name, lat: best.lat, lon: best.lon, pm25: best.pm25, aqi: best.aqi });
  } catch (e) {
    return J({ error: String(e.message || e) }, 502);
  }
}

// ---------------- entry point ----------------
export default {
  async fetch(request, env) {
    // Any WebSocket upgrade -> the lightning relay Durable Object.
    if (request.headers.get('Upgrade') === 'websocket') {
      return env.RELAY.get(env.RELAY.idFromName('ukraine')).fetch(request);
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    if (url.pathname === '/seventimer') return seventimer(url);
    if (url.pathname === '/saveecobot') return saveecobot(url);
    return new Response('OnlyStars relay — WebSocket /ws (lightning), GET /seventimer, GET /saveecobot',
      { headers: { 'content-type': 'text/plain', ...CORS } });
  },
};

export class LightningRelay {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.up = null;
    this.connecting = false;
    this.idx = 0;
  }

  async fetch() {
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server); // hibernatable client connection
    this.ensureUpstream();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage() { this.ensureUpstream(); } // client keepalive
  webSocketClose() { this.maybeCloseUpstream(); }
  webSocketError() { this.maybeCloseUpstream(); }

  clients() { return this.ctx.getWebSockets().filter((w) => w.readyState === 1); }

  maybeCloseUpstream() {
    if (this.clients().length <= 1 && this.up) { // <=1: the closing socket may still be counted
      try { this.up.close(); } catch (_) {}
      this.up = null;
    }
  }

  broadcast(obj) {
    const m = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(m); } catch (_) {} }
  }

  async ensureUpstream() {
    if (this.up || this.connecting) return;
    this.connecting = true;
    const url = UPSTREAMS[this.idx++ % UPSTREAMS.length];
    try {
      const resp = await fetch(url, { headers: { Upgrade: 'websocket' } });
      const up = resp.webSocket;
      if (!up) return;
      up.accept();
      this.up = up;
      up.send(JSON.stringify({ a: 111 })); // subscribe
      up.addEventListener('message', (ev) => {
        try {
          const obj = JSON.parse(decode(typeof ev.data === 'string' ? ev.data : ''));
          const { lat, lon } = obj;
          if (typeof lat === 'number' && typeof lon === 'number' && inBox(lat, lon)) {
            this.broadcast({ lat, lon, t: obj.time ? Math.round(obj.time / 1e6) : Date.now() });
          }
        } catch (_) { /* skip malformed frame */ }
      });
      up.addEventListener('close', () => { this.up = null; this.reconnectSoon(); });
      up.addEventListener('error', () => { try { up.close(); } catch (_) {} this.up = null; this.reconnectSoon(); });
    } catch (_) {
      this.up = null; this.reconnectSoon();
    } finally {
      this.connecting = false;
    }
  }

  reconnectSoon() {
    if (this.clients().length === 0) return; // nobody watching — let it idle
    setTimeout(() => this.ensureUpstream(), 3000);
  }
}
