// relay/server.js
// A tiny, policy-compliant relay for Blitzortung live lightning.
//
// Why this exists: browsers can't speak raw MQTT/TCP, and Blitzortung's data
// policy explicitly requires third-party apps to use their OWN server rather
// than having every end-client hammer the raw socket. This relay opens ONE
// upstream WebSocket, decodes the feed, filters to a bounding box (Ukraine by
// default), and rebroadcasts clean {lat, lon, t} JSON to your browser clients.
//
// Run it on an always-on box (e.g. a home mini-PC) or any small VPS, then set
//   LIGHTNING.relayUrl in js/config.js  ->  ws://<that-host>:8787
//
// NON-COMMERCIAL USE ONLY. The upstream protocol is unofficial and may change.
//
//   npm install
//   node server.js

const WebSocket = require('ws');

const PORT = process.env.PORT || 8787;
// Ukraine bounding box (with margin). [west, south, east, north]
const BBOX = (process.env.BBOX || '21.5,43.5,41.5,53.5').split(',').map(Number);
const UPSTREAMS = ['ws1', 'ws7', 'ws8', 'ws3'].map((h) => `wss://${h}.blitzortung.org/`);

// Blitzortung sends an LZW-compressed JSON string. This is the long-standing
// community decoder for that scheme.
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

// ---- downstream: serve our own clients ----
const wss = new WebSocket.Server({ port: PORT });
wss.on('connection', () => log(`client connected (${wss.clients.size} total)`));
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
}
function log(...a) { console.log(new Date().toISOString(), ...a); }

// ---- upstream: one connection to Blitzortung, with rotation/backoff ----
let upstreamIdx = 0;
function connectUpstream() {
  const url = UPSTREAMS[upstreamIdx % UPSTREAMS.length];
  upstreamIdx++;
  log('connecting upstream', url);
  const up = new WebSocket(url);

  up.on('open', () => { log('upstream open'); up.send(JSON.stringify({ a: 111 })); });
  up.on('message', (raw) => {
    try {
      const obj = JSON.parse(decode(raw.toString()));
      const lat = obj.lat, lon = obj.lon;
      if (typeof lat === 'number' && typeof lon === 'number' && inBox(lat, lon)) {
        broadcast({ lat, lon, t: obj.time ? Math.round(obj.time / 1e6) : Date.now() });
      }
    } catch (_) { /* ignore malformed frames */ }
  });
  up.on('close', () => { log('upstream closed, retrying in 4s'); setTimeout(connectUpstream, 4000); });
  up.on('error', (e) => { log('upstream error:', e.message); up.close(); });
}

connectUpstream();
log(`relay listening on ws://0.0.0.0:${PORT}  bbox=${BBOX.join(',')}`);
