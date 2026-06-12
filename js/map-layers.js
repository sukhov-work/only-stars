// map-layers.js — MapLibre map + every overlay layer and its controls.
import { BASEMAP, OM_TILES, RAINVIEWER, GIBS, EUMETSAT, LIGHTNING } from './config.js';
import { getJSON } from './util.js';

export function createMap(container, view) {
  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        basemap: {
          type: 'raster', tiles: BASEMAP.tiles, tileSize: 256,
          attribution: BASEMAP.attribution,
        },
      },
      layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
    },
    center: [view.lng, view.lat],
    zoom: view.zoom,
    attributionControl: false,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  return map;
}

// Helper: add or remove a simple raster source+layer pair, inserted just
// above the basemap so the pin and labels stay on top.
function setRaster(map, id, def, on, beforeId) {
  const sid = id + '-src';
  const present = map.getLayer(id);
  if (on && !present) {
    if (!map.getSource(sid)) map.addSource(sid, def.source);
    map.addLayer({ id, type: 'raster', source: sid, paint: { 'raster-opacity': def.opacity ?? 0.8 } }, beforeId);
  } else if (!on && present) {
    map.removeLayer(id);
    if (map.getSource(sid)) map.removeSource(sid);
  }
}

// ---------- Open-Meteo om:// overlay (BETA, graceful degradation) ----------
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => reject(new Error('failed ' + src));
    document.head.appendChild(s);
  });
}

export async function initOpenMeteoProtocol(map) {
  for (const url of OM_TILES.scriptCandidates) {
    try {
      await loadScript(url);
      const lib = window.OMWeatherMapLayer;
      if (lib && typeof lib.omProtocol === 'function') {
        if (!map._omRegistered) {
          maplibregl.addProtocol('om', (params, ac) => lib.omProtocol(params, ac));
          map._omRegistered = true;
        }
        return true;
      }
    } catch (_) { /* try next candidate */ }
  }
  console.warn('[OM tiles] weather-map-layer unavailable — Open-Meteo overlays disabled.');
  return false;
}

export function setOpenMeteoLayer(map, on, variable) {
  const id = 'om-overlay', sid = id + '-src';
  if (map.getLayer(id)) { map.removeLayer(id); }
  if (map.getSource(sid)) { map.removeSource(sid); }
  if (!on || !map._omRegistered) return;
  // Backward-accumulated variables (precipitation, radiation) are omitted from
  // the model's first timestep, so `latest.json` (the analysis hour) has no data
  // for them. Such variables request `current_time` instead — the step valid now.
  const meta = (OM_TILES.variables[variable] && OM_TILES.variables[variable].time) || 'latest';
  const omUrl = `${OM_TILES.base}/${OM_TILES.model}/${meta}.json?variable=${variable}`;
  try {
    map.addSource(sid, { type: 'raster', url: 'om://' + omUrl, maxzoom: OM_TILES.maxzoom || 7 });
    map.addLayer({ id, type: 'raster', source: sid, paint: { 'raster-opacity': 0.7 } });
  } catch (e) {
    console.warn('[OM tiles] add failed:', e.message);
  }
}

// ---------- RainViewer: animated radar + IR satellite ----------
export class RainViewer {
  constructor(map) {
    this.map = map;
    this.frames = [];      // combined past + nowcast radar frames
    this.satFrame = null;  // latest IR satellite frame
    this.host = '';
    this.pos = 0;
    this.timer = null;
    this.radarOn = false;
    this.satOn = false;
    this.onFrame = () => {};
  }
  async load() {
    const j = await getJSON(RAINVIEWER.mapsJson);
    this.host = j.host;
    const past = (j.radar && j.radar.past) || [];
    const now = (j.radar && j.radar.nowcast) || [];
    this.frames = [...past, ...now].map((f) => ({ ...f, forecast: now.includes(f) }));
    const ir = j.satellite && j.satellite.infrared;
    this.satFrame = ir && ir.length ? ir[ir.length - 1] : null;
    this.pos = past.length ? past.length - 1 : 0; // start at "now"
  }
  _radarUrl(frame) {
    // host + path + /{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png
    return `${this.host}${frame.path}/256/{z}/{x}/{y}/4/1_1.png`;
  }
  _satUrl(frame) {
    return `${this.host}${frame.path}/256/{z}/{x}/{y}/0/0_0.png`;
  }
  _renderRadar() {
    const id = 'rv-radar', sid = id + '-src';
    if (this.map.getLayer(id)) this.map.removeLayer(id);
    if (this.map.getSource(sid)) this.map.removeSource(sid);
    if (!this.radarOn || !this.frames.length) return;
    const frame = this.frames[this.pos];
    this.map.addSource(sid, { type: 'raster', tiles: [this._radarUrl(frame)], tileSize: 256 });
    this.map.addLayer({ id, type: 'raster', source: sid, paint: { 'raster-opacity': 0.75 } });
    this.onFrame(frame, this.pos, this.frames.length);
  }
  setRadar(on) {
    this.radarOn = on;
    if (!on) this.stop();
    this._renderRadar();
  }
  setSatellite(on) {
    this.satOn = on;
    const id = 'rv-sat', sid = id + '-src';
    if (this.map.getLayer(id)) this.map.removeLayer(id);
    if (this.map.getSource(sid)) this.map.removeSource(sid);
    if (on && this.satFrame) {
      this.map.addSource(sid, { type: 'raster', tiles: [this._satUrl(this.satFrame)], tileSize: 256 });
      this.map.addLayer({ id, type: 'raster', source: sid, paint: { 'raster-opacity': 0.85 } },
        this.map.getLayer('rv-radar') ? 'rv-radar' : undefined);
    }
  }
  step(delta) { this.pos = (this.pos + delta + this.frames.length) % this.frames.length; this._renderRadar(); }
  seek(i) { this.pos = i; this._renderRadar(); }
  play() {
    if (this.timer || !this.radarOn) return;
    this.timer = setInterval(() => this.step(1), 600);
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}

// ---------- NASA GIBS daily true colour ----------
export function setGibs(map, on) {
  const d = new Date(Date.now() - 24 * 3600 * 1000); // yesterday: reliably complete
  const date = d.toISOString().slice(0, 10);
  const tiles = GIBS.template.replace('{layer}', GIBS.layer).replace('{time}', date);
  setRaster(map, 'gibs', { source: { type: 'raster', tiles: [tiles], tileSize: 256 }, opacity: 0.85 }, on);
}

// ---------- EUMETSAT EUMETView WMS (optional) ----------
export function setEumetsat(map, on) {
  const url = `${EUMETSAT.wms}?service=WMS&request=GetMap&version=1.3.0&layers=${encodeURIComponent(EUMETSAT.layer)}` +
    `&styles=&format=image/png&transparent=true&crs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}`;
  setRaster(map, 'eumetsat', { source: { type: 'raster', tiles: [url], tileSize: 256 }, opacity: 0.85 }, on);
}

// ---------- Lightning embed (zero-infra fallback) ----------
export function setLightningEmbed(on) {
  let frame = document.getElementById('lightning-embed');
  if (on && !frame) {
    frame = document.createElement('iframe');
    frame.id = 'lightning-embed';
    frame.src = LIGHTNING.embedSrc;
    frame.title = 'LightningMaps.org live lightning';
    document.getElementById('lightning-embed-wrap').appendChild(frame);
  } else if (!on && frame) {
    frame.remove();
  }
  document.getElementById('lightning-embed-wrap').classList.toggle('open', on);
}
