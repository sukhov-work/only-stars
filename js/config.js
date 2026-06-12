// config.js — all tunable endpoints and constants live here.
// Nothing secret belongs in this file: it ships to the browser.
// Paid keys (if you ever add OpenWeatherMap etc.) go in Netlify env vars
// and are read by a serverless function, never here.

export const DEFAULT_VIEW = {
  // Dnipro, Ukraine
  lng: 35.045,
  lat: 48.467,
  zoom: 6.5,
};

// Open-Meteo point forecast (no key, CORS-open). ICON-EU is the highest
// resolution conventional model that actually reaches Dnipro (~7 km).
export const OPEN_METEO = {
  forecastUrl: 'https://api.open-meteo.com/v1/forecast',
  model: 'icon_eu',
  // Hourly variables for the point panel. Anything a model doesn't expose
  // comes back null and is rendered as "—", so over-requesting is safe.
  hourly: [
    'temperature_2m', 'dew_point_2m', 'relative_humidity_2m',
    'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
    'precipitation', 'precipitation_probability', 'weather_code',
    'visibility', 'freezing_level_height',
    'cape', 'lifted_index', 'convective_inhibition',
    'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m',
  ],
};

// Open-Meteo spatial map tiles (om:// MapLibre protocol). BETA upstream —
// wired defensively; if the package/API moves, these overlays just disable.
export const OM_TILES = {
  base: 'https://map-tiles.open-meteo.com/data_spatial',
  model: 'dwd_icon', // global ICON, covers Dnipro; good enough for an overlay field
  // Global ICON is coarse (~13 km), so cap the zoom and let MapLibre upscale —
  // otherwise the overlay vanishes when you zoom past the data's resolution.
  maxzoom: 7,
  // Pin to a current build. (An older fallback build lacks several colour
  // scales, which is what caused "variable not found" for precipitation.)
  scriptCandidates: [
    'https://unpkg.com/@openmeteo/weather-map-layer@0.0.19/dist/index.js',
    'https://cdn.jsdelivr.net/npm/@openmeteo/weather-map-layer@0.0.19/dist/index.js',
  ],
  // Only variables the renderer has colour scales for AND that the beta tiles
  // expose at the analysis hour (t=0). Precipitation is intentionally excluded:
  // it's a backward-sum with no t=0 timestep, and the published tile layer can't
  // select a forecast step via the source URL. Precip lives in the point panel
  // (exact mm + probability) and the 12 h strip; the radar layer is the map proxy.
  // Wind is published only as u/v components (no wind_speed_10m raster).
  variables: {
    cloud_cover: { label: 'Cloud cover', unit: '%' },
    temperature_2m: { label: 'Temperature 2 m', unit: '°C' },
  },
};

// RainViewer: free, no key. Radar is decorative over Ukraine (no live national
// radar during the war) — keep it OFF by default and lead with IR satellite.
export const RAINVIEWER = { mapsJson: 'https://api.rainviewer.com/public/weather-maps.json' };

// NASA GIBS — daily true-colour satellite (one composite/day). Good daytime
// cloud field, not sub-hourly. WMTS REST, CORS-open.
export const GIBS = {
  template:
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{time}/' +
      'GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg',
  layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
};

// EUMETSAT EUMETView WMS — optional, higher-quality near-real-time Meteosat.
// Layer names drift between geoserver versions; override from GetCapabilities
// if a layer stops resolving. Left as an optional, off-by-default layer.
export const EUMETSAT = {
  wms: 'https://view.eumetsat.int/geoserver/wms',
  layer: 'mtg_fd:rgb_truecolour',
};

// Cloudflare Worker origin. It serves three things: the lightning relay
// (/ws) and the two CORS proxies (/seventimer, /saveecobot). GitHub Pages can't
// run serverless functions, so these live on the Worker instead.
// Set this to '' to fall back to Netlify Functions instead.
const WORKER_ORIGIN = 'https://onlystars-lightning.ievgen-sukhov.workers.dev';

// Serverless proxies for CORS-blocked / http-only sources.
export const PROXY = { base: WORKER_ORIGIN };
export const proxyEndpoint = (name) =>
    PROXY.base ? `${PROXY.base}/${name}` : `/.netlify/functions/${name}`;

// NOAA SWPC space weather — aurora probability grid + planetary Kp. CORS-open.
export const SWPC = {
  ovation: 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json',
  kp: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
};

// Live lightning. Two paths (see cloudflare-relay/README.md):
//   - 'embed'  : LightningMaps.org iframe layer, zero infra, instant.
//   - relayUrl : your Cloudflare Worker relay for integrated strike markers.
// Defaults to the same Worker as the proxies above (accepts the WS upgrade on
// any path, so a trailing-slash URL also works).
export const LIGHTNING = {
  relayUrl: WORKER_ORIGIN ? WORKER_ORIGIN.replace(/^http/, 'ws') + '/ws' : '',
  embedSrc: 'https://map.blitzortung.org/',
  strikeTtlMs: 30 * 60 * 1000, // fade strikes over 30 min
};

// Dark base map — CARTO Dark Matter, token-less, attribution required.
export const BASEMAP = {
  tiles: [
    'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
    'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
    'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
  ],
  attribution:
      '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/attributions">CARTO</a>',
};

export const STORAGE_KEY = 'dnipro-meteo-explorer-v1';
