# OnlyStars lightning relay — Cloudflare (no home server needed)

Runs the live-lightning relay entirely on Cloudflare's free tier. No always-on
machine of your own. This is the **recommended** path for integrated strike
markers on the map.

## What this Worker serves

One Worker, three jobs — so a GitHub Pages site (no serverless functions of its
own) has everything it needs:

- **WebSocket upgrade on any path** → live lightning relay (the Durable Object).
- **`GET /seventimer?lat&lon`** → 7Timer ASTRO seeing/transparency (proxied; the
  source is http-only with no CORS).
- **`GET /saveecobot?lat&lon`** → nearest SaveEcoBot air-quality station.

In the app, `js/config.js` points `WORKER_ORIGIN` at this Worker; `PROXY.base`
and `LIGHTNING.relayUrl` are both derived from it.

## How the lightning relay works

A single, globally-unique **Durable Object** holds **one** upstream WebSocket to
Blitzortung (this is what their data policy requires — everyone shares that one
connection, rather than each browser hammering the source). The object decodes
the feed, filters to a Ukraine bounding box, and fans the strikes out to every
connected browser. The upstream only runs **while at least one browser is
watching**, then idles.

Browsers can't speak raw MQTT/TCP and a plain stateless Worker can't hold a
persistent connection — the Durable Object is the piece that makes this work
without a server of your own.

## Deploy (about 3 minutes)

```bash
cd cloudflare-relay
npm install                       # pulls wrangler
npx wrangler login                # opens a browser to authorize (free account)
npx wrangler deploy
```

`wrangler deploy` prints a URL like:

```
https://skywatch-lightning.<your-subdomain>.workers.dev
```

## Wire it to the app

In `js/config.js`, set the relay URL to that host with a `/ws` path and the
`wss://` scheme:

```js
export const LIGHTNING = {
  relayUrl: 'wss://skywatch-lightning.<your-subdomain>.workers.dev/ws',
  ...
};
```

Redeploy the Netlify site (or just reload locally), enable the **Lightning**
layer, and strikes appear as fading dots on the map. Because the site is https,
the `wss://` scheme is required — the Worker serves TLS automatically, so
there's nothing extra to configure (unlike a self-hosted relay).

## Free-tier reality

- Durable Objects on the **Workers Free plan**: 100,000 requests/day and
  13,000 GB-s/day of compute. One shared relay object at 128 MB running flat-out
  for a full day is ~10,800 GB-s — under the limit — and it only runs while
  you're watching, so real usage is far lower.
- Incoming WebSocket messages are billed at a 20:1 ratio (100k requests/day ≈
  2 million incoming strike messages/day). Personal use stays well under this.
- On the free plan, if you ever blow past a limit, operations simply fail until
  the 00:00 UTC reset — **no surprise charges**. Upgrading to the $5/mo Workers
  Paid plan removes the ceiling if you ever want it.

## Adjusting the area

Edit `BBOX` at the top of `worker.js` (`[west, south, east, north]`) and
redeploy. Default is Ukraine plus a margin.

> **Non-commercial use only.** The upstream protocol is unofficial; if strikes
> stop arriving, the decoder or endpoint list in `worker.js` likely needs a
> refresh.
