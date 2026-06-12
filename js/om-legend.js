// om-legend.js — legend for the Open-Meteo overlay.
// The colour scales below are copied verbatim from @openmeteo/weather-map-layer
// (the `n` scale table in its bundle) so the legend matches the rendered tiles
// exactly. These are discrete breakpoint scales: each colour covers the band
// from its breakpoint up to the next one.

export const OM_SCALES = {
  cloud_cover: {
    label: 'Cloud cover', unit: '%',
    breakpoints: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90],
    // light palette (the default when no ?dark=true is set)
    colors: [
      [255, 255, 255, 0], [249, 251, 253, 0.141], [244, 247, 250, 0.4],
      [233, 239, 244, 0.475], [220, 226, 233, 0.55], [209, 213, 219, 0.625],
      [188, 193, 202, 0.7], [166, 173, 184, 0.775], [138, 147, 162, 0.85],
      [104, 115, 133, 0.925],
    ],
    ticks: [0, 20, 40, 60, 80],
  },
  precipitation: {
    label: 'Precipitation', unit: 'mm/h',
    breakpoints: [0.01, 0.055, 0.11, 0.255, 0.45, 0.95, 2, 3, 4.95, 7.45, 10, 15, 20, 25, 30],
    colors: [
      [4, 59, 92, 0.091], [134, 205, 250, 0.5], [130, 203, 250, 0.7], [118, 197, 250, 0.717],
      [103, 188, 250, 0.74], [64, 161, 251, 0.8], [0, 96, 233, 0.814], [0, 177, 236, 0.827],
      [0, 241, 141, 0.851], [66, 248, 0, 0.879], [255, 221, 0, 0.905], [255, 111, 0, 0.947],
      [255, 0, 0, 0.976], [215, 0, 94, 0.994], [175, 0, 153, 1],
    ],
    ticks: [0.01, 0.45, 2, 10, 30],
  },
  temperature: {
    label: 'Temperature', unit: '°C',
    breakpoints: [-80, -60, -50, -40, -37.5, -35, -32.5, -30, -27.5, -25, -22.5, -20, -17.5,
      -15, -12.5, -10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28,
      30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50],
    colors: [
      [26, 242, 221, 1], [22, 147, 178, 1], [23, 101, 143, 1], [47, 17, 189, 1], [86, 15, 201, 1],
      [131, 13, 213, 1], [181, 10, 226, 1], [239, 7, 239, 1], [206, 6, 241, 1], [171, 5, 243, 1],
      [136, 4, 245, 1], [100, 4, 247, 1], [64, 3, 249, 1], [26, 2, 251, 1], [1, 14, 253, 1],
      [0, 52, 255, 1], [35, 110, 251, 1], [69, 156, 247, 1], [102, 192, 245, 1], [134, 219, 245, 1],
      [124, 245, 124, 1], [90, 244, 90, 1], [56, 244, 56, 1], [21, 245, 21, 1], [7, 224, 7, 1],
      [4, 193, 4, 1], [2, 161, 2, 1], [0, 128, 0, 1], [57, 170, 0, 1], [142, 213, 0, 1],
      [255, 255, 0, 1], [255, 233, 0, 1], [255, 210, 0, 1], [255, 188, 0, 1], [255, 165, 0, 1],
      [255, 141, 0, 1], [255, 118, 0, 1], [255, 94, 0, 1], [255, 71, 0, 1], [255, 47, 0, 1],
      [255, 24, 0, 1], [255, 0, 0, 1], [228, 0, 10, 1], [201, 0, 18, 1], [174, 0, 23, 1],
      [147, 0, 26, 1],
    ],
    ticks: [-40, -20, 0, 20, 40],
  },
};

// Point-API variable names → scale names.
const ALIAS = { temperature_2m: 'temperature' };

export function omLegendHTML(variable) {
  const scale = OM_SCALES[ALIAS[variable] || variable];
  if (!scale) return '';
  const n = scale.colors.length;
  const bar = scale.colors
    .map((c) => `<i style="background:rgba(${c[0]},${c[1]},${c[2]},${c[3]})"></i>`)
    .join('');
  const ticks = scale.ticks
    .map((v) => {
      let bi = 0, bd = Infinity;
      scale.breakpoints.forEach((b, i) => { const d = Math.abs(b - v); if (d < bd) { bd = d; bi = i; } });
      const pos = Math.max(0, Math.min(100, (bi / (n - 1)) * 100));
      return `<span style="left:${pos}%">${v}</span>`;
    })
    .join('');
  return `<div class="om-legend-title">${scale.label} · ${scale.unit}</div>
          <div class="om-legend-bar">${bar}</div>
          <div class="om-legend-ticks">${ticks}</div>
          <div class="om-legend-note">stepped scale · global ICON ~13 km</div>`;
}
