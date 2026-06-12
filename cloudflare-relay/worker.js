// worker.js — OnlyStars lightning relay on Cloudflare Workers + Durable Objects.
//
// A single, globally-unique Durable Object holds ONE upstream WebSocket to
// Blitzortung (policy-compliant: every browser shares this one connection),
// decodes the feed, filters to a bounding box, and fans the strikes out to all
// connected browsers. The upstream only runs while at least one browser is
// watching, so on the Workers Free plan this sits well inside the limits.
//
// Deploy:  npm i -g wrangler && wrangler login && wrangler deploy
// Then set LIGHTNING.relayUrl in js/config.js to  wss://<your-worker>/ws
//
// NON-COMMERCIAL USE ONLY. The upstream protocol is unofficial and may change.

const UPSTREAMS = ['ws1', 'ws7', 'ws8', 'ws3'].map((h) => `https://${h}.blitzortung.org/`);
// Ukraine + margin: [west, south, east, north]. Override by editing here.
const BBOX = [21.5, 43.5, 41.5, 53.5];

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }
      const stub = env.RELAY.get(env.RELAY.idFromName('ukraine')); // one shared instance
      return stub.fetch(request);
    }
    return new Response('OnlyStars lightning relay — connect a WebSocket to /ws',
      { headers: { 'content-type': 'text/plain' } });
  },
};

export class LightningRelay {
  constructor(ctx, env) {
    this.ctx = ctx;       // DurableObjectState
    this.env = env;
    this.up = null;       // upstream WebSocket
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

  // Browser sends a periodic keepalive; use it to guarantee the upstream is up
  // (e.g. after the runtime restarts the object).
  webSocketMessage() { this.ensureUpstream(); }
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
