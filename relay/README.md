# OnlyStars lightning relay — self-hosted (alternative)

> **Most people should use the Cloudflare relay instead** (`../cloudflare-relay/`),
> which needs no machine of your own. Use this Node version only if you'd rather
> self-host on an always-on box — any small VM, a free Oracle Cloud Always-Free
> instance, Fly.io, etc.

Optional. Only needed if you want **integrated lightning markers on the map**
(fading dots at each strike) and prefer to run the relay yourself. Without it,
the explorer falls back to the LightningMaps.org embed layer, which needs no
infrastructure.

## Why a relay is required

- Browsers cannot open raw MQTT/TCP sockets, so a static page can't read
  Blitzortung's feed directly in a robust way.
- Blitzortung's data policy requires third-party apps to run **their own
  server** and not have every end-client connect to the raw socket.

This relay opens **one** upstream connection, decodes the feed, filters to a
bounding box, and rebroadcasts clean JSON (`{lat, lon, t}`) to your browser.

> **Non-commercial use only.** The upstream protocol is unofficial and can
> change without notice; if strikes stop appearing, the decoder or endpoints
> likely need updating.

## Run it

```bash
cd relay
npm install
node server.js          # listens on ws://0.0.0.0:8787, Ukraine bbox
```

Environment overrides:

```bash
PORT=8787 BBOX="21.5,43.5,41.5,53.5" node server.js   # west,south,east,north
```

Keep it alive with pm2 / a systemd unit / `screen` on your always-on box.

## Point the app at it

In `js/config.js`:

```js
export const LIGHTNING = {
  relayUrl: 'ws://192.168.1.50:8787',   // your relay's LAN or public address
  ...
};
```

If the app is served over **https** (Netlify), browsers block `ws://`
(mixed content). Use **`wss://`** — put the relay behind a TLS reverse proxy
(Caddy/nginx/Cloudflare Tunnel) so it's reachable as `wss://lightning.yourhost`.
For purely local use (`http://localhost`), plain `ws://` is fine.
