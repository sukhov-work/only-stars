// netlify/functions/seventimer.js
// Proxies 7Timer! ASTRO (HTTP-only, no CORS) so the static client can read
// astronomical seeing / transparency / cloud. Node 18+ (global fetch).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=1800', // 7Timer updates ~every 6 h
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const { lat, lon } = event.queryStringParameters || {};
  if (!lat || !lon) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'lat and lon required' }) };
  }

  const url = `http://www.7timer.info/bin/api.pl?lon=${encodeURIComponent(lon)}` +
    `&lat=${encodeURIComponent(lat)}&product=astro&output=json&unit=metric`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'onlystars-explorer/1.0' } });
    if (!res.ok) throw new Error(`7Timer ${res.status}`);
    const text = await res.text();
    // 7Timer occasionally wraps JSON oddly; trim to the outermost object.
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    const json = JSON.parse(text.slice(start, end + 1));
    return { statusCode: 200, headers: CORS, body: JSON.stringify(json) };
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
