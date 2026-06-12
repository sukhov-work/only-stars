// app.js — bootstrap + UI wiring.
import { DEFAULT_VIEW, OM_TILES, STORAGE_KEY, LIGHTNING } from './config.js';
import { $, el } from './util.js';
import {
  createMap, initOpenMeteoProtocol, setOpenMeteoLayer, RainViewer,
  setGibs, setEumetsat, setLightningEmbed,
} from './map-layers.js';
import { PointPanel } from './point-panel.js';
import { LightningRelay } from './lightning-relay.js';

const state = loadState();

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

const map = createMap('map', state.view || DEFAULT_VIEW);
const panel = new PointPanel(map, $('#panel'), (ll) => savePin(ll));
const rv = new RainViewer(map);
const relay = new LightningRelay(map);

map.on('moveend', () => {
  state.view = { lng: map.getCenter().lng, lat: map.getCenter().lat, zoom: map.getZoom() };
  saveState();
});

// Place pin on click; restore last pin on load.
map.on('click', (e) => { panel.place(e.lngLat); savePin(e.lngLat); });
function savePin(ll) { state.pin = { lng: ll.lng, lat: ll.lat }; saveState(); }

map.on('load', async () => {
  await initOpenMeteoProtocol(map);
  await rv.load().catch((e) => console.warn('[rainviewer] load failed', e.message));
  buildControls();
  applyInitialLayers();
  // Restore or seed the pin (default: Dnipro).
  const ll = state.pin || { lng: DEFAULT_VIEW.lng, lat: DEFAULT_VIEW.lat };
  panel.place(new maplibregl.LngLat(ll.lng, ll.lat));
});

// ---------- layer control panel ----------
const LAYERS = [
  { id: 'om', label: 'Open-Meteo field', kind: 'om', hint: 'ICON model overlay (beta)' },
  { id: 'sat', label: 'Satellite IR', kind: 'sat', hint: 'RainViewer infrared — reliable over UA' },
  { id: 'radar', label: 'Radar + nowcast', kind: 'radar', hint: 'No live UA radar — EU context only' },
  { id: 'gibs', label: 'True colour (daily)', kind: 'gibs', hint: 'NASA VIIRS, daytime cloud field' },
  { id: 'eumetsat', label: 'EUMETSAT Meteosat', kind: 'eumetsat', hint: 'Optional WMS (layer may need swap)' },
  { id: 'lightning', label: 'Lightning', kind: 'lightning', hint: 'Live strikes (embed or relay)' },
];

function buildControls() {
  const wrap = $('#layers');
  wrap.innerHTML = '';
  state.layers = state.layers || { sat: true };

  for (const L of LAYERS) {
    const checked = !!state.layers[L.id];
    const row = el('label', { class: 'layer-row' }, [
      el('input', { type: 'checkbox', ...(checked ? { checked: 'checked' } : {}),
        onchange: (e) => toggleLayer(L, e.target.checked) }),
      el('span', { class: 'layer-name', text: L.label }),
      el('span', { class: 'layer-hint', text: L.hint }),
    ]);
    wrap.appendChild(row);

    if (L.id === 'om') {
      const sel = el('select', { class: 'om-var', onchange: (e) => {
        state.omVar = e.target.value; saveState();
        if (state.layers.om) setOpenMeteoLayer(map, true, state.omVar);
      } },
        Object.entries(OM_TILES.variables).map(([v, m]) =>
          el('option', { value: v, ...(state.omVar === v ? { selected: 'selected' } : {}) }, m.label)));
      wrap.appendChild(el('div', { class: 'om-var-wrap' }, [sel]));
    }
    if (L.id === 'radar') {
      const ctrls = el('div', { class: 'radar-ctrls', id: 'radar-ctrls' }, [
        el('button', { class: 'mini', title: 'Step back', onclick: () => { rv.stop(); rv.step(-1); } }, '◀'),
        el('button', { class: 'mini', id: 'radar-play', onclick: togglePlay }, '▶'),
        el('button', { class: 'mini', title: 'Step forward', onclick: () => { rv.stop(); rv.step(1); } }, '▶|'),
        el('span', { class: 'radar-time', id: 'radar-time', text: '—' }),
      ]);
      wrap.appendChild(ctrls);
    }
  }

  rv.onFrame = (frame) => {
    const t = new Date(frame.time * 1000);
    const lbl = `${t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${frame.forecast ? ' · forecast' : ''}`;
    const node = $('#radar-time'); if (node) node.textContent = lbl;
  };
}

function togglePlay() {
  if (rv.timer) { rv.stop(); $('#radar-play').textContent = '▶'; }
  else { rv.play(); $('#radar-play').textContent = '❚❚'; }
}

function applyInitialLayers() {
  for (const L of LAYERS) if (state.layers[L.id]) toggleLayer(L, true);
}

function toggleLayer(L, on) {
  state.layers[L.id] = on; saveState();
  switch (L.kind) {
    case 'om': setOpenMeteoLayer(map, on, state.omVar || 'cloud_cover'); break;
    case 'sat': rv.setSatellite(on); break;
    case 'radar': rv.setRadar(on); if (!on) $('#radar-play') && ($('#radar-play').textContent = '▶'); break;
    case 'gibs': setGibs(map, on); break;
    case 'eumetsat': setEumetsat(map, on); break;
    case 'lightning':
      if (LIGHTNING.relayUrl) relay.set(on);   // integrated markers if relay configured
      else setLightningEmbed(on);              // otherwise the embed panel
      break;
  }
}

// ---------- top bar buttons ----------
$('#btn-locate').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    const ll = new maplibregl.LngLat(pos.coords.longitude, pos.coords.latitude);
    map.flyTo({ center: ll, zoom: 9 });
    panel.place(ll); savePin(ll);
  });
});

$('#btn-night').addEventListener('click', () => {
  document.body.classList.toggle('night');
  state.night = document.body.classList.contains('night'); saveState();
});
if (state.night) document.body.classList.add('night');

$('#btn-panel').addEventListener('click', () => $('#panel').classList.toggle('open'));
