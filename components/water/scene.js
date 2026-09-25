// Pure scene math for the scroll-driven water background. No DOM, no React.
// Shared by the site (components/water/WaterBackground.js) and the preview
// workspace in motion-lab/, so scrubbing its timeline shows exactly what
// scrolling the homepage shows.
//
//   p  page scroll progress 0..1 (macro state: hero → expansion → background → footer)
//   t  ambient time in seconds (bubbles, wave drift, drop bob — runs even when idle)
//   L  layout: { vw, vh, scrollY, anchor: { x, y, d }, reduced }
//      anchor = the hero orb slot in document coordinates (y includes scroll offset).

// Palette — every colour the animation uses. Exact values already in the codebase;
// only alpha variations are derived (see `alpha`). Do not add new values here.
export const C = {
  bg: '#e3f1fb', //       --color-clay-bg
  surface: '#f2faff', //  --color-clay-surface
  ink: '#0c4a6e', //      --color-clay-ink (motion-lab HUD only)
  sky: '#38bdf8', //      --color-clay-sky
  skydeep: '#0284c7', //  --color-clay-skydeep
  sky300: '#93c5fd', //   old hero orb gradient
  sky500: '#0ea5e9', //   old hero orb gradient + headline accent
  drop: '#7dd3fc', //     old hero drop gradient
  foam: '#cdefff', //     old hero drop gradient
  white: '#ffffff', //    old hero drop / waves / bubbles
};

export const alpha = (hex, a) =>
  `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;

// Bubbles: [u0 (0..1 across the orb), size px, rise speed (cycles/s), phase, drift amp, drift freq].
// Mobile renders only the first 4.
export const BUBBLES = [
  [0.3, 10, 0.16, 0.0, 0.03, 0.35],
  [0.62, 7, 0.21, 0.45, 0.025, 0.5],
  [0.45, 12, 0.13, 0.75, 0.035, 0.28],
  [0.72, 8, 0.18, 0.2, 0.03, 0.42],
  [0.24, 6, 0.24, 0.6, 0.02, 0.55],
  [0.55, 9, 0.15, 0.9, 0.03, 0.33],
  [0.8, 6, 0.2, 0.35, 0.02, 0.47],
];
export const MOBILE_MAX = 767;

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, k) => a + (b - a) * k;
const frac = (x) => x - Math.floor(x);
const smooth = (a, b, x) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const easeInOutCubic = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

export function getScene(p, t, L) {
  if (L.reduced) {
    // No motion: hero orb sits static in its slot, background frozen at its final state.
    const still = { ...L, reduced: false };
    return { ...getScene(1, 0, still), orb: getScene(0, 0, still).orb };
  }
  p = clamp01(p);
  const { vw, vh } = L;
  const r = L.anchor.d / 2;

  // Expansion 0.12–0.40. Before that e = 0 and the orb tracks its hero slot exactly.
  const e = easeInOutCubic(clamp01((p - 0.12) / 0.28));
  const ax = L.anchor.x + r;
  const ay = L.anchor.y - L.scrollY + r;
  const cover = (Math.hypot(vw / 2, vh / 2) / r) * 1.02;

  const orb = {
    x: lerp(ax, vw / 2, e) - r,
    y: lerp(ay, vh / 2, e) - r,
    d: L.anchor.d,
    scale: lerp(1, cover, e),
    // Saturated art fades out before the growing disc can reach any text (contrast
    // must never drop below the page's existing ratios); the pale disc keeps growing.
    deep: 1 - smooth(0, 0.06, e),
    opacity: 1 - smooth(0.36, 0.44, p),
    waves: [frac(t / 9), 1 - frac(t / 6), frac(t / 13)], // 3 parallax layers, fraction of one period
    shimmer: Math.sin((t * TAU) / 7) * 6, // % translateX
    bob: -6 + 6 * Math.sin((t * TAU) / 3.2), // % translateY of the drop
    bobScale: 1 + 0.02 * Math.sin((t * TAU) / 3.2),
  };

  // Full background 0.40–0.85: water level rises, intensity eases off.
  const k = smooth(0.4, 0.85, p);
  const level = vh * lerp(0.72, 0.3, k);
  const bg = {
    opacity: smooth(0.33, 0.4, p) * (1 - 0.15 * k),
    level,
    waves: [frac(t / 16), 1 - frac(t / 11), frac(t / 23)],
    amp: 1 - 0.5 * smooth(0.93, 1, p), // calmer surface once the ripple has settled
  };

  // Footer 0.85–1: one drop falls (0.85–0.93) and rings the surface once (0.93–1).
  // Desktop drops into the page margin beside the content column; narrower screens centre it.
  const dropX = vw > 1216 ? (vw - 1152) / 4 : vw / 2;
  const fall = clamp01((p - 0.85) / 0.08);
  const rip = clamp01((p - 0.93) / 0.07);
  const drip = { x: dropX, y: lerp(-40, level - 28, fall * fall), o: fall > 0 && fall < 1 ? 1 : 0 };
  const ripple = { x: dropX, y: level, s: lerp(0.3, 4, rip), o: rip > 0 ? 0.9 * (1 - rip) : 0 };

  // Bubbles live in the orb, then spread across the water below the surface as the orb expands.
  const n = vw <= MOBILE_MAX ? 4 : BUBBLES.length;
  const bubbles = BUBBLES.slice(0, n).map(([u0, size, speed, phase, amp, freq]) => {
    const c = frac(t * speed + phase);
    const u = u0 + amp * Math.sin(TAU * (t * freq + phase));
    const v = 0.88 - 0.76 * c;
    const x = lerp(ax + (u - 0.5) * 2 * r, vw * (0.05 + 0.9 * clamp01((u - 0.2) / 0.6)), e);
    const y = lerp(ay + (v - 0.5) * 2 * r, level + (vh - level) * v, e);
    return { x: x - size / 2, y: y - size / 2, scale: lerp(1, 1.6, e), o: Math.min(1, c / 0.1, (1 - c) / 0.15) };
  });

  return { orb, bg, drip, ripple, bubbles };
}
