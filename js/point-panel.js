// point-panel.js — the draggable pin and everything in the readout panel.
import { OPEN_METEO, SWPC, proxyEndpoint } from './config.js';
import { $, el, getJSON, num, compass, timeFromDate, haversineKm } from './util.js';

const WMO = {
  0:'Clear',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Rime fog',
  51:'Light drizzle',53:'Drizzle',55:'Dense drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',
  71:'Light snow',73:'Snow',75:'Heavy snow',80:'Rain showers',81:'Rain showers',82:'Violent showers',
  95:'Thunderstorm',96:'Storm w/ hail',99:'Severe storm w/ hail',
};

export class PointPanel {
  constructor(map, panelEl, onChange = () => {}) {
    this.map = map;
    this.panel = panelEl;
    this.marker = null;
    this.lngLat = null;
    this.onChange = onChange;
  }

  place(lngLat) {
    this.lngLat = lngLat;
    if (!this.marker) {
      const node = el('div', { class: 'pin' });
      this.marker = new maplibregl.Marker({ element: node, draggable: true, anchor: 'bottom' })
        .setLngLat(lngLat).addTo(this.map);
      this.marker.on('dragend', () => { this.onChange(this.current()); this.refresh(); });
    } else {
      this.marker.setLngLat(lngLat);
    }
    this.refresh();
  }

  current() { return this.marker ? this.marker.getLngLat() : this.lngLat; }

  async refresh() {
    const { lng, lat } = this.current();
    this.panel.classList.add('open');
    this._renderShell(lat, lng);
    // Sun/moon are instant (client-side) — render first so the panel isn't empty.
    this._renderAstro(lat, lng);
    this._renderSpaceWeather(lat, lng); // async, non-blocking
    try {
      const data = await this._fetchOpenMeteo(lat, lng);
      this._renderNow(data);
      this._renderForecastStrip(data);
      this._renderStorm(data);
      this._renderAstroVerdict(data, lat, lng);
    } catch (e) {
      $('#pp-now').innerHTML = `<p class="warn">Forecast unavailable: ${e.message}</p>`;
    }
    this._renderSeeing(lat, lng);   // 7Timer via proxy, async
  }

  // ---- data ----
  async _fetchOpenMeteo(lat, lng) {
    const u = new URL(OPEN_METEO.forecastUrl);
    u.searchParams.set('latitude', lat.toFixed(4));
    u.searchParams.set('longitude', lng.toFixed(4));
    u.searchParams.set('models', OPEN_METEO.model);
    u.searchParams.set('hourly', OPEN_METEO.hourly.join(','));
    u.searchParams.set('forecast_days', '2');
    u.searchParams.set('timezone', 'auto');
    return getJSON(u);
  }

  // index of the hour >= now in the hourly arrays
  _nowIndex(times) {
    const now = Date.now();
    for (let i = 0; i < times.length; i++) if (new Date(times[i]).getTime() >= now - 30 * 60 * 1000) return i;
    return 0;
  }

  // ---- render ----
  _renderShell(lat, lng) {
    this.panel.innerHTML = `
      <div class="pp-head">
        <div>
          <div class="eyebrow">Pinned location</div>
          <div class="coords">${lat.toFixed(3)}°, ${lng.toFixed(3)}°</div>
        </div>
        <button class="pp-close" title="Close">✕</button>
      </div>
      <div id="pp-verdict" class="verdict-row"></div>
      <section id="pp-now" class="card"><div class="eyebrow">Now</div><p class="loading">Loading ICON-EU…</p></section>
      <section id="pp-forecast" class="card"><div class="eyebrow">Next 12 hours</div></section>
      <section id="pp-astro" class="card"><div class="eyebrow">Tonight · sun &amp; moon</div></section>
      <section id="pp-storm" class="card"><div class="eyebrow">Storm potential</div></section>
      <section id="pp-seeing" class="card"><div class="eyebrow">Astro seeing · 7Timer</div><p class="loading">Loading…</p></section>
      <section id="pp-space" class="card"><div class="eyebrow">Space weather</div><p class="loading">Loading…</p></section>
      <section id="pp-air" class="card">
        <div class="eyebrow">Air quality</div>
        <button id="pp-air-btn" class="ghost-btn">Load nearest station</button>
      </section>`;
    this.panel.querySelector('.pp-close').addEventListener('click', () => this.panel.classList.remove('open'));
    this.panel.querySelector('#pp-air-btn').addEventListener('click', () => this._renderAir(lat, lng));
  }

  _renderNow(d) {
    const h = d.hourly, i = this._nowIndex(h.time);
    const total = h.cloud_cover[i];
    const rows = [
      ['Sky', `${WMO[h.weather_code[i]] ?? '—'}`],
      ['Cloud', `${num(total)}% <span class="sub">(lo ${num(h.cloud_cover_low[i])} · mid ${num(h.cloud_cover_mid[i])} · hi ${num(h.cloud_cover_high[i])})</span>`],
      ['Temp', `${num(h.temperature_2m[i],1)}°C <span class="sub">dew ${num(h.dew_point_2m[i],1)}°</span>`],
      ['Precip', `${num(h.precipitation[i],1)} mm <span class="sub">${num(h.precipitation_probability[i])}% chance</span>`],
      ['Wind', `${num(h.wind_speed_10m[i])} km/h ${h.wind_direction_10m[i]!=null?compass(h.wind_direction_10m[i]):''} <span class="sub">gust ${num(h.wind_gusts_10m[i])}</span>`],
      ['Visibility', `${h.visibility[i]!=null?num(h.visibility[i]/1000,1)+' km':'—'}`],
      ['Freezing lvl', `${h.freezing_level_height[i]!=null?num(h.freezing_level_height[i])+' m':'—'}`],
    ];
    $('#pp-now').innerHTML = `<div class="eyebrow">Now <span class="model">ICON-EU ~7 km</span></div>` +
      `<table class="kv">${rows.map(([k,v])=>`<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
  }

  _renderForecastStrip(d) {
    const h = d.hourly, i0 = this._nowIndex(h.time);
    const cols = [];
    for (let k = 0; k <= 12; k++) {
      const i = i0 + k; if (i >= h.time.length) break;
      const cloud = h.cloud_cover[i] ?? 0;
      const pp = h.precipitation_probability[i] ?? 0;
      const t = new Date(h.time[i]);
      const wet = pp >= 40 || (h.precipitation[i] ?? 0) > 0.1;
      cols.push(`
        <div class="fc-col" title="${cloud}% cloud · ${pp}% precip">
          <div class="fc-bar"><div class="fc-fill ${wet?'wet':''}" style="height:${cloud}%"></div></div>
          <div class="fc-cloud">${cloud}</div>
          <div class="fc-hr">${k===0?'now':t.getHours()+'h'}</div>
        </div>`);
    }
    $('#pp-forecast').innerHTML =
      `<div class="eyebrow">Next 12 hours <span class="model">cloud % · blue = wet</span></div>` +
      `<div class="fc-strip">${cols.join('')}</div>`;
  }

  _renderStorm(d) {
    const h = d.hourly, i0 = this._nowIndex(h.time);
    let maxCape = 0, minLI = 99, maxIdx = i0;
    for (let i = i0; i < Math.min(i0 + 12, h.time.length); i++) {
      const c = h.cape[i] ?? 0; if (c > maxCape) { maxCape = c; maxIdx = i; }
      if (h.lifted_index[i] != null) minLI = Math.min(minLI, h.lifted_index[i]);
    }
    let verdict = 'Stable', cls = 'ok';
    if (maxCape >= 2000 || minLI <= -4) { verdict = 'Strong storm potential'; cls = 'bad'; }
    else if (maxCape >= 800 || minLI <= -2) { verdict = 'Some storm potential'; cls = 'warn'; }
    const when = new Date(h.time[maxIdx]).toLocaleTimeString([], { hour: '2-digit' });
    $('#pp-storm').innerHTML =
      `<div class="eyebrow">Storm potential</div>
       <div class="badge ${cls}">${verdict}</div>
       <table class="kv">
         <tr><th>Max CAPE (12 h)</th><td>${num(maxCape)} J/kg <span class="sub">~${when}</span></td></tr>
         <tr><th>Min lifted index</th><td>${minLI===99?'—':num(minLI,1)}</td></tr>
       </table>
       <p class="hint">Convection forecast at ~7 km. For live strikes, enable the Lightning layer.</p>`;
  }

  _renderAstro(lat, lng) {
    const now = new Date();
    const t = SunCalc.getTimes(now, lat, lng);
    const sunPos = SunCalc.getPosition(now, lat, lng);
    const moonIll = SunCalc.getMoonIllumination(now);
    const moonPos = SunCalc.getMoonPosition(now, lat, lng);
    const moonTimes = SunCalc.getMoonTimes(now, lat, lng);
    const phaseName = (p) => {
      if (p < 0.03 || p > 0.97) return 'New'; if (p < 0.22) return 'Waxing crescent';
      if (p < 0.28) return 'First quarter'; if (p < 0.47) return 'Waxing gibbous';
      if (p < 0.53) return 'Full'; if (p < 0.72) return 'Waning gibbous';
      if (p < 0.78) return 'Last quarter'; return 'Waning crescent';
    };
    const rows = [
      ['Sun alt', `${num(sunPos.altitude*180/Math.PI,1)}° ${compass(sunPos.azimuth*180/Math.PI+180)}`],
      ['Golden hr (eve)', `${timeFromDate(t.goldenHour)}`],
      ['Sunset', `${timeFromDate(t.sunset)}`],
      ['Blue/astro dusk', `${timeFromDate(t.dusk)} → ${timeFromDate(t.night)}`],
      ['Astro dawn', `${timeFromDate(t.nightEnd)} → ${timeFromDate(t.dawn)}`],
      ['Sunrise', `${timeFromDate(t.sunrise)}`],
      ['Moon', `${phaseName(moonIll.phase)} · ${num(moonIll.fraction*100)}% lit`],
      ['Moon alt', `${num(moonPos.altitude*180/Math.PI,1)}°`],
      ['Moonrise/set', `${timeFromDate(moonTimes.rise)} / ${timeFromDate(moonTimes.set)}`],
    ];
    $('#pp-astro').innerHTML = `<div class="eyebrow">Tonight · sun &amp; moon</div>` +
      `<table class="kv">${rows.map(([k,v])=>`<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
  }

  // Combines tonight's dark window (sun < -18°) with Open-Meteo cloud + moon
  // into a single go/no-go verdict for deep-sky imaging.
  _renderAstroVerdict(d, lat, lng) {
    const h = d.hourly;
    const moonFrac = SunCalc.getMoonIllumination(new Date()).fraction;
    let bestCloud = 101, bestTime = null, darkHours = 0;
    for (let i = 0; i < h.time.length; i++) {
      const dt = new Date(h.time[i]);
      if (dt.getTime() < Date.now() || dt.getTime() > Date.now() + 18 * 3600 * 1000) continue;
      const sun = SunCalc.getPosition(dt, lat, lng).altitude * 180 / Math.PI;
      if (sun > -18) continue; // not astronomically dark
      darkHours++;
      const c = h.cloud_cover[i] ?? 100;
      if (c < bestCloud) { bestCloud = c; bestTime = dt; }
    }
    let label, cls;
    if (!darkHours) { label = 'No astro darkness in next 18 h'; cls = 'warn'; }
    else if (bestCloud <= 20 && moonFrac < 0.4) { label = 'Good — clear & dark'; cls = 'go'; }
    else if (bestCloud <= 30) { label = `Workable — ${num(bestCloud)}% cloud`; cls = 'ok'; }
    else { label = `Poor — best ${num(bestCloud)}% cloud`; cls = 'bad'; }
    const moonNote = moonFrac >= 0.4 ? ` · moon ${num(moonFrac*100)}%` : '';
    const at = bestTime ? ` @ ${bestTime.toLocaleTimeString([],{hour:'2-digit'})}` : '';
    $('#pp-verdict').innerHTML =
      `<div class="verdict ${cls}"><span class="vlabel">Astro tonight</span>` +
      `<span class="vval">${label}${at}${moonNote}</span></div>`;
  }

  async _renderSeeing(lat, lng) {
    try {
      const j = await getJSON(`${proxyEndpoint('seventimer')}?lat=${lat.toFixed(3)}&lon=${lng.toFixed(3)}`);
      const series = (j.dataseries || []).slice(0, 8); // ~24 h at 3 h steps
      const seeingLbl = ['','<0.5"','0.5-0.75"','0.75-1"','1-1.25"','1.25-1.5"','1.5-2"','2-2.5"','>2.5"'];
      const transLbl = ['','<0.3','0.3-0.4','0.4-0.5','0.5-0.6','0.6-0.7','0.7-0.85','0.85-1','>1'];
      const cloudPct = (c) => Math.round((c - 1) / 8 * 100); // 1..9 → 0..100%
      const rows = series.map((s) => {
        const hr = (s.timepoint || 0);
        return `<tr><td>+${hr}h</td><td>${cloudPct(s.cloudcover)}%</td>` +
          `<td>${seeingLbl[s.seeing] || '—'}</td><td>${transLbl[s.transparency] || '—'}</td></tr>`;
      }).join('');
      $('#pp-seeing').innerHTML =
        `<div class="eyebrow">Astro seeing · 7Timer <span class="model">GFS ~20 km · 3 h</span></div>
         <table class="kv tight"><tr><th>t</th><th>cloud</th><th>seeing</th><th>transp</th></tr>${rows}</table>`;
    } catch (e) {
      $('#pp-seeing').innerHTML = `<div class="eyebrow">Astro seeing · 7Timer</div>` +
        `<p class="hint">Unavailable (${e.message}). Needs the seventimer function deployed.</p>`;
    }
  }

  async _renderSpaceWeather(lat, lng) {
    try {
      const [ov, kp] = await Promise.all([getJSON(SWPC.ovation), getJSON(SWPC.kp)]);
      // ovation: coordinates [lon(0-360), lat, prob]
      const lon360 = (lng + 360) % 360;
      let best = 0, bestD = 1e9;
      for (const [olon, olat, prob] of ov.coordinates) {
        const d = Math.abs(olat - lat) + Math.abs(((olon - lon360 + 540) % 360) - 180);
        if (d < bestD) { bestD = d; best = prob; }
      }
      const latestKp = Array.isArray(kp) && kp.length ? kp[kp.length - 1] : null;
      const kpVal = latestKp ? latestKp[1] : '—';
      $('#pp-space').innerHTML =
        `<div class="eyebrow">Space weather</div>
         <table class="kv">
           <tr><th>Planetary Kp</th><td>${kpVal}</td></tr>
           <tr><th>Aurora prob (here)</th><td>${num(best)}%</td></tr>
         </table>
         <p class="hint">Aurora is rare at 48°N — needs a strong geomagnetic storm.</p>`;
    } catch (e) {
      $('#pp-space').innerHTML = `<div class="eyebrow">Space weather</div><p class="hint">Unavailable.</p>`;
    }
  }

  async _renderAir(lat, lng) {
    const box = $('#pp-air');
    box.innerHTML = `<div class="eyebrow">Air quality</div><p class="loading">Finding nearest station…</p>`;
    try {
      const j = await getJSON(`${proxyEndpoint('saveecobot')}?lat=${lat.toFixed(3)}&lon=${lng.toFixed(3)}`);
      if (!j || !j.station) { box.innerHTML = `<div class="eyebrow">Air quality</div><p class="hint">No nearby station.</p>`; return; }
      const dist = haversineKm(lat, lng, j.lat, j.lon);
      box.innerHTML =
        `<div class="eyebrow">Air quality <span class="model">SaveEcoBot</span></div>
         <table class="kv">
           <tr><th>Station</th><td>${j.station} <span class="sub">${num(dist)} km</span></td></tr>
           ${j.pm25!=null?`<tr><th>PM2.5</th><td>${num(j.pm25,1)} µg/m³</td></tr>`:''}
           ${j.aqi!=null?`<tr><th>AQI</th><td>${num(j.aqi)}</td></tr>`:''}
         </table>`;
    } catch (e) {
      box.innerHTML = `<div class="eyebrow">Air quality</div><p class="hint">Unavailable (${e.message}).</p>`;
    }
  }
}
