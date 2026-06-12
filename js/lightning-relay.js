// lightning-relay.js — connects to YOUR relay (see /relay) and draws strikes.
// If no relayUrl is configured this module does nothing; use the embed layer instead.
import { LIGHTNING } from './config.js';

export class LightningRelay {
  constructor(map) {
    this.map = map;
    this.ws = null;
    this.strikes = []; // {lng, lat, t}
    this.on = false;
    this._raf = null;
  }

  _ensureLayer() {
    if (this.map.getSource('strikes')) return;
    this.map.addSource('strikes', { type: 'geojson', data: this._fc() });
    this.map.addLayer({
      id: 'strikes-glow', type: 'circle', source: 'strikes',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'age'], 0, 14, 1, 4],
        'circle-color': '#ffe08a',
        'circle-blur': 1,
        'circle-opacity': ['interpolate', ['linear'], ['get', 'age'], 0, 0.9, 1, 0],
      },
    });
    this.map.addLayer({
      id: 'strikes-core', type: 'circle', source: 'strikes',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'age'], 0, 4, 1, 1.5],
        'circle-color': '#fff7e0',
        'circle-opacity': ['interpolate', ['linear'], ['get', 'age'], 0, 1, 1, 0],
      },
    });
  }

  _fc() {
    const now = Date.now();
    return {
      type: 'FeatureCollection',
      features: this.strikes.map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        properties: { age: Math.min(1, (now - s.t) / LIGHTNING.strikeTtlMs) },
      })),
    };
  }

  _tick() {
    const now = Date.now();
    this.strikes = this.strikes.filter((s) => now - s.t < LIGHTNING.strikeTtlMs);
    if (this.map.getSource('strikes')) this.map.getSource('strikes').setData(this._fc());
    this._raf = requestAnimationFrame(() => this._tick());
  }

  set(on) {
    this.on = on;
    if (on) {
      if (!LIGHTNING.relayUrl) { console.warn('[lightning] no relayUrl — use the embed layer instead.'); return; }
      this._ensureLayer();
      this._connect();
      if (!this._raf) this._tick();
    } else {
      if (this.ws) { this.ws.close(); this.ws = null; }
      clearInterval(this._ping);
      cancelAnimationFrame(this._raf); this._raf = null;
      ['strikes-core', 'strikes-glow'].forEach((id) => this.map.getLayer(id) && this.map.removeLayer(id));
      if (this.map.getSource('strikes')) this.map.removeSource('strikes');
    }
  }

  _connect() {
    try {
      this.ws = new WebSocket(LIGHTNING.relayUrl);
      this.ws.onopen = () => {
        // Periodic keepalive: keeps the connection from idling out and ensures
        // the relay re-establishes its upstream feed after any restart.
        clearInterval(this._ping);
        this._ping = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send('{"ping":1}');
        }, 30000);
      };
      this.ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          // relay emits {lat, lon} (or {lat, lng})
          const lat = m.lat, lng = m.lon ?? m.lng;
          if (typeof lat === 'number' && typeof lng === 'number') {
            this.strikes.push({ lat, lng, t: Date.now() });
            if (this.strikes.length > 5000) this.strikes.shift();
          }
        } catch (_) {}
      };
      this.ws.onclose = () => { clearInterval(this._ping); if (this.on) setTimeout(() => this.on && this._connect(), 3000); };
      this.ws.onerror = () => this.ws && this.ws.close();
    } catch (e) {
      console.warn('[lightning] relay connect failed:', e.message);
    }
  }
}
