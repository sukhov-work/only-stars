// netlify/functions/saveecobot.js
// Ukraine-specific air quality (SaveEcoBot open data). Fetches the public
// station dump, finds the nearest station with PM2.5/AQI to the pin, and
// returns only that — keeps the client light. Node 18+ (global fetch).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=600',
};

const SRC = 'https://api.saveecobot.com/output.json';

// Warm-invocation cache so we don't refetch the (large) dump every request.
let cache = { at: 0, stations: null };
const TTL = 10 * 60 * 1000;

function km(aLat, aLon, bLat, bLon) {
  const R = 6371, r = (d) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat), dLon = r(bLon - aLon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function readStations(raw) {
  // The dump is an array of station objects. Field names vary; read defensively.
  return (Array.isArray(raw) ? raw : []).map((s) => {
    const lat = parseFloat(s.latitude ?? s.lat);
    const lon = parseFloat(s.longitude ?? s.lng ?? s.lon);
    const name = s.stationName || s.localName || s.cityName || s.platformName || 'station';
    let pm25 = null, aqi = null;
    const pols = s.pollutants || s.pollutant || [];
    for (const p of pols) {
      const key = (p.pol || p.name || '').toString().toUpperCase();
      const val = parseFloat(p.value ?? p.averageValue);
      if (Number.isNaN(val)) continue;
      if (key.includes('PM2.5') || key.includes('PM25')) pm25 = val;
      if (key.includes('AIR QUALITY INDEX') || key === 'AQI') aqi = val;
    }
    return { name, lat, lon, pm25, aqi };
  }).filter((s) => !Number.isNaN(s.lat) && !Number.isNaN(s.lon));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const { lat, lon } = event.queryStringParameters || {};
  if (!lat || !lon) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'lat and lon required' }) };
  const pLat = parseFloat(lat), pLon = parseFloat(lon);

  try {
    if (!cache.stations || Date.now() - cache.at > TTL) {
      const res = await fetch(SRC, { headers: { 'User-Agent': 'onlystars-explorer/1.0' } });
      if (!res.ok) throw new Error(`SaveEcoBot ${res.status}`);
      cache = { at: Date.now(), stations: readStations(await res.json()) };
    }
    let best = null, bestD = Infinity;
    for (const s of cache.stations) {
      if (s.pm25 == null && s.aqi == null) continue;
      const d = km(pLat, pLon, s.lat, s.lon);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best || bestD > 120) return { statusCode: 200, headers: CORS, body: JSON.stringify({ station: null }) };
    return {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({ station: best.name, lat: best.lat, lon: best.lon, pm25: best.pm25, aqi: best.aqi }),
    };
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
