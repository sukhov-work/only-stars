# OnlyStars — Dnipro meteo explorer

A pannable, map-first weather explorer for **astrophotography and landscape
photography around Dnipro, Ukraine**. Drop a pin anywhere and read a detailed
point forecast: cloud layers, near-future trajectory, storm potential,
astronomical darkness windows, golden hour, seeing/transparency, space weather,
and air quality. Toggle satellite, model-field, radar, and lightning overlays.

Static front-end + a couple of tiny serverless proxies. No build step.

> **The Ukraine reality, baked in:** there is no live ground weather radar over
> Dnipro during the war, and the best conventional model that reaches you is
> ICON-EU (~7 km). So this tool leads with **satellite IR + ICON-EU model field
> + live lightning**, and the radar layer is labelled as European context only.
> Near-future prediction is delivered through the point panel's 12-hour
> trajectory, RainViewer's nowcast frames, and 7Timer's 3-hour astro steps —
> not radar-grade rain timing, which doesn't exist here.

## What feeds what

| Feature | Source | Key? | Notes |
|---|---|---|---|
| Point forecast (cloud lo/mid/hi, precip, CAPE, LI, CIN, visibility, freezing level, wind) | Open-Meteo, `models=icon_eu` | no | CORS-open, client-side |
| Model field overlay | Open-Meteo `om://` map tiles | no | **beta** upstream; auto-disables if unavailable |
| Satellite IR (default ON) | RainViewer | no | reliable over Ukraine |
| Radar + nowcast frames | RainViewer | no | **no live UA radar** — EU context |
| Daily true-colour | NASA GIBS (VIIRS) | no | one composite/day |
| Meteosat (optional) | EUMETSAT EUMETView WMS | no | layer name may need swapping |
| Astro seeing / transparency | 7Timer! ASTRO | no | via `seventimer` function (http-only) |
| Sun/moon, twilight, golden hour | SunCalc | no | fully client-side |
| Space weather (Kp, aurora prob) | NOAA SWPC | no | CORS-open |
| Air quality (nearest station) | SaveEcoBot | no | via `saveecobot` function |
| Live lightning | LightningMaps embed **or** Cloudflare relay | no | see `cloudflare-relay/` (no home server) |

## Run locally

Because the app uses ES modules, open it through a local server (not `file://`):

```bash
npx serve .            # or: python3 -m http.server 8000
```

The two serverless functions (7Timer, SaveEcoBot) only run under Netlify. To get
them locally too, use the Netlify CLI:

```bash
npm i -g netlify-cli
netlify dev            # serves the site AND the functions at /.netlify/functions/*
```

Without the functions, everything else still works; the seeing and air-quality
cards just show "unavailable".

## Deploy to Netlify

No build, no framework. Two ways:

**A. Drag-and-drop** — zip the project folder (or drag the folder) into the
Netlify dashboard "Deploys" drop zone. `netlify.toml` tells Netlify the publish
dir is `.` and functions live in `netlify/functions`.

**B. Git (recommended)** —

```bash
git init && git add . && git commit -m "OnlyStars init"
# push to GitHub/GitLab, then in Netlify: "Add new site" → "Import from Git"
```

Build command: leave empty. Publish directory: `.`. Functions directory is
picked up from `netlify.toml`. That's it — the functions deploy automatically.

There are **no API keys** in this MVP, so nothing to configure. If you later add
a paid source (e.g. OpenWeatherMap forecast tiles), put the key in
**Site settings → Environment variables** and read it from a new function —
never inline it in `js/`.

## Lightning (item 2)

- **Zero-infra:** just enable the *Lightning* layer — it opens the
  LightningMaps.org live map in a corner panel. Works immediately.
- **Integrated markers (recommended): Cloudflare.** Deploy the relay in
  `cloudflare-relay/` to the Workers free tier and set `LIGHTNING.relayUrl` in
  `js/config.js` to `wss://<your-worker>.workers.dev/ws`. Strikes then render as
  fading dots directly on the map — with **no machine of your own** running.
  See `cloudflare-relay/README.md` (≈3-minute deploy).
- **Alternative — self-host:** if you'd rather run it yourself (any always-on
  VM, or a free box like an Oracle Cloud Always-Free instance), the Node version
  in `relay/` does the same job. See `relay/README.md`.

Why a relay at all: browsers can't speak raw MQTT/TCP, and Blitzortung's policy
requires apps to use one shared upstream connection rather than having every
client hit the source directly. The relay is that shared connection.

## Tuning

Everything adjustable lives in `js/config.js`: default map view, the ICON model,
which hourly variables to request, the Open-Meteo overlay model/variables, the
EUMETSAT WMS layer, and the lightning mode. The astro go/no-go thresholds
(cloud %, moon %, –18° darkness) are in `js/point-panel.js` →
`_renderAstroVerdict`.

## Licence / attribution notes

Respect each source's terms: Open-Meteo data is CC-BY 4.0 (non-commercial use
free); CARTO and OpenStreetMap require the on-map attribution (kept in the
attribution control); Blitzortung/LightningMaps are **non-commercial only**.
This project is a personal, non-commercial tool.
