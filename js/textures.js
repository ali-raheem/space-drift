// Procedural sprites: planets, rings, stars, accretion disks, nebula puffs, galaxies,
// rocks and the sector skybox. The expensive per-pixel ones are generator functions
// that yield every few rows, so the scene can spread them over several frames
// instead of stalling the animation.

import { makeNoise } from './rng.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/** Sample a multi-stop colour ramp at t in [0, 1]. */
function ramp(stops, t) {
  t = clamp01(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t));
  return mix(stops[i], stops[i + 1], t - i);
}

// --- planets ----------------------------------------------------------------------

export const PLANET_KINDS = {
  terran: { label: 'Terrestrial world', weight: 3 },
  ocean: { label: 'Ocean world', weight: 2 },
  desert: { label: 'Desert world', weight: 3 },
  ice: { label: 'Ice world', weight: 2 },
  lava: { label: 'Volcanic world', weight: 2 },
  barren: { label: 'Barren world', weight: 2 },
  gas: { label: 'Gas giant', weight: 5 },
  toxic: { label: 'Toxic world', weight: 1.5 },
};

const GAS_PALETTES = [
  [[120, 80, 50], [214, 178, 130], [240, 226, 196], [190, 120, 70], [235, 210, 170]],
  [[200, 170, 110], [235, 215, 160], [250, 240, 205], [215, 190, 130]],
  [[30, 60, 160], [60, 110, 210], [120, 170, 240], [40, 80, 190]],
  [[110, 200, 210], [170, 230, 235], [130, 210, 220], [200, 245, 245]],
];

function planetLook(kind, rng) {
  const look = { atmo: [140, 180, 255], atmoStrength: 0.6, kind };
  switch (kind) {
    case 'terran':
    case 'ocean': {
      look.sea = kind === 'ocean' ? rng.float(0.66, 0.74) : rng.float(0.48, 0.56);
      look.deep = mix([8, 30, 80], hsl(rng.float(190, 230), 0.7, 0.18), 0.5);
      look.shallow = hsl(rng.float(185, 205), 0.6, 0.42);
      look.land = [hsl(rng.float(70, 130), rng.float(0.3, 0.55), 0.3), hsl(rng.float(25, 45), 0.35, 0.38), [190, 180, 170]];
      look.clouds = rng.float(0.5, 0.95);
      look.lights = rng.chance(0.5);
      look.atmoStrength = 0.85;
      break;
    }
    case 'desert': {
      const h = rng.float(10, 40);
      look.ramp = [hsl(h, 0.55, 0.2), hsl(h + 5, 0.6, 0.38), hsl(h + 12, 0.55, 0.55), hsl(h + 20, 0.45, 0.72)];
      look.atmo = hsl(h + 10, 0.7, 0.7);
      look.atmoStrength = rng.float(0.2, 0.5);
      break;
    }
    case 'ice':
      look.ramp = [[150, 175, 200], [200, 220, 238], [240, 248, 255]];
      look.crack = hsl(rng.float(190, 215), 0.6, 0.45);
      look.atmo = [190, 220, 255];
      look.atmoStrength = 0.45;
      break;
    case 'lava':
      look.ramp = [[22, 18, 20], [50, 40, 38], [80, 64, 58]];
      look.glow = hsl(rng.float(5, 30), 1, 0.55);
      look.atmo = [255, 120, 60];
      look.atmoStrength = 0.35;
      break;
    case 'barren': {
      const h = rng.float(0, 60);
      look.ramp = [hsl(h, 0.08, 0.2), hsl(h, 0.08, 0.4), hsl(h, 0.06, 0.62)];
      look.atmoStrength = 0;
      break;
    }
    case 'toxic': {
      const h = rng.float(55, 110);
      look.bands = [hsl(h, 0.5, 0.3), hsl(h + 15, 0.6, 0.45), hsl(h - 10, 0.55, 0.38), hsl(h + 25, 0.5, 0.55)];
      look.bandFreq = rng.float(4, 9);
      look.turb = rng.float(1.5, 3);
      look.atmo = hsl(h + 10, 0.8, 0.65);
      look.atmoStrength = 1;
      break;
    }
    case 'gas': {
      if (rng.chance(0.3)) {
        const h = rng.float(0, 360);
        look.bands = [hsl(h, 0.5, 0.3), hsl(h + 20, 0.55, 0.55), hsl(h - 15, 0.4, 0.72), hsl(h + 35, 0.6, 0.42)];
      } else {
        look.bands = rng.pick(GAS_PALETTES);
      }
      look.bandFreq = rng.float(5, 14);
      look.turb = rng.float(1.2, 3.5);
      look.storm = rng.chance(0.6) ? { lat: rng.float(-0.5, 0.5), lon: rng.float(-0.6, 0.6), r: rng.float(0.08, 0.18) } : null;
      look.atmo = mix(look.bands[1], [180, 210, 255], 0.5);
      look.atmoStrength = 0.6;
      break;
    }
  }
  return look;
}

/**
 * Renders a lit planet into a square canvas. The disk has radius `diskFrac` × size/2;
 * the margin holds the atmospheric halo. `light` is a unit vector in view space
 * (x right, y down, z towards the viewer).
 */
export function* planetJob({ rng, kind, size, light }) {
  const { fbm3, noise3 } = makeNoise(rng.int(0, 2 ** 30));
  const look = planetLook(kind, rng);
  const S = size;
  const R = S * 0.45;
  const halo = S / 2 - R;
  const canvas = makeCanvas(S, S);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const tilt = rng.float(-0.45, 0.45), spin = rng.float(0, Math.PI * 2);
  const ct = Math.cos(tilt), st = Math.sin(tilt), cs = Math.cos(spin), ss = Math.sin(spin);
  const [Lx, Ly, Lz] = light;
  // Half vector for the ocean glint (viewer is +z).
  let Hx = Lx, Hy = Ly, Hz = Lz + 1;
  const hl = Math.hypot(Hx, Hy, Hz); Hx /= hl; Hy /= hl; Hz /= hl;
  const off = rng.float(0, 100);
  const out = [0, 0, 0];
  const emit = [0, 0, 0];

  // Writes surface colour to `out` and night-side / self emission to `emit`.
  // Returns 1 for water (specular), 0 otherwise.
  function surface(px, py, pz) {
    emit[0] = emit[1] = emit[2] = 0;
    switch (look.kind) {
      case 'terran':
      case 'ocean': {
        const h = fbm3(px * 1.7 + off, py * 1.7, pz * 1.7, 6);
        const lat = Math.abs(py);
        let c, water = 0;
        if (h < look.sea) {
          c = mix(look.deep, look.shallow, Math.pow(h / look.sea, 4));
          water = 1;
        } else {
          const t = (h - look.sea) / (1 - look.sea);
          c = t < 0.05 ? [194, 178, 128] : t < 0.4 ? mix(look.land[0], look.land[1], smooth(0.05, 0.4, t)) : mix(look.land[1], look.land[2], smooth(0.4, 0.8, t));
          if (look.lights && lat < 0.75 && noise3(px * 38, py * 38, pz * 38) > 0.68) {
            emit[0] = 255; emit[1] = 190; emit[2] = 110;
          }
        }
        if (lat + (h - 0.5) * 0.5 > 0.82) { c = [235, 242, 250]; water = 0; }
        const cl = smooth(0.5, 0.75, fbm3(px * 2.4 + 20, py * 5 + off, pz * 2.4, 5)) * look.clouds;
        c = mix(c, [245, 248, 252], cl);
        emit[0] *= 1 - cl; emit[1] *= 1 - cl; emit[2] *= 1 - cl;
        out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
        return water * (1 - cl);
      }
      case 'desert': {
        const h = fbm3(px * 2 + off, py * 2, pz * 2, 6);
        const ridge = 1 - Math.abs(2 * noise3(px * 7, py * 7, pz * 7 + off) - 1);
        let c = ramp(look.ramp, h * 1.1 - 0.05 + ridge * 0.12);
        if (Math.abs(py) > 0.9 - h * 0.1) c = mix(c, [240, 240, 245], 0.85);
        out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
        return 0;
      }
      case 'ice': {
        const h = fbm3(px * 2.2 + off, py * 2.2, pz * 2.2, 5);
        let c = ramp(look.ramp, h);
        const crack = Math.abs(noise3(px * 5, py * 5, pz * 5 + off) - 0.5);
        if (crack < 0.025) c = mix(c, look.crack, 0.7 * (1 - crack / 0.025));
        out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
        return 0.4;
      }
      case 'lava': {
        const h = fbm3(px * 2.5 + off, py * 2.5, pz * 2.5, 5);
        const c = ramp(look.ramp, h);
        const r = 1 - Math.abs(2 * fbm3(px * 3 + 40, py * 3, pz * 3 + off, 4) - 1);
        const g = smooth(0.86, 0.97, r);
        out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
        emit[0] = look.glow[0] * g; emit[1] = look.glow[1] * g; emit[2] = look.glow[2] * g;
        return 0;
      }
      case 'barren': {
        let h = fbm3(px * 2.5 + off, py * 2.5, pz * 2.5, 6);
        const cr = noise3(px * 9 + off, py * 9, pz * 9);
        h -= smooth(0.62, 0.7, cr) * 0.18 - smooth(0.58, 0.62, cr) * smooth(0.7, 0.66, cr) * 0.12;
        const c = ramp(look.ramp, h);
        out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
        return 0;
      }
      default: { // gas, toxic
        const w = fbm3(px * 1.4 + off, py * 1.4, pz * 1.4, 4);
        const fine = fbm3(px * 2, py * 16 + off, pz * 2, 3);
        const band = py * look.bandFreq + (w - 0.5) * look.turb;
        let v = 0.5 + 0.5 * Math.sin(band * Math.PI);
        v = v * 0.7 + fine * 0.3;
        let c = ramp(look.bands, v);
        if (look.storm) {
          const lon = Math.atan2(px, pz);
          const du = (lon - look.storm.lon) / 2, dv = (py - look.storm.lat) * 1.6;
          const sd = Math.hypot(du, dv) / look.storm.r;
          if (sd < 1.3) {
            const swirl = 0.5 + 0.5 * Math.sin(sd * 9 + Math.atan2(dv, du) * 2);
            const tone = mix(look.bands[0], [200, 90, 60], 0.5);
            c = mix(c, mix(tone, look.bands[2], swirl * 0.4), smooth(1.3, 0.7, sd));
          }
        }
        out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
        return 0;
      }
    }
  }

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - S / 2) / R, dy = (y + 0.5 - S / 2) / R;
      const d2 = dx * dx + dy * dy;
      const i = (y * S + x) * 4;
      const dist = Math.sqrt(d2);
      if (dist <= 1 + 1 / R) {
        const nz = Math.sqrt(Math.max(0, 1 - d2));
        const nx = dist > 1 ? dx / dist : dx, ny = dist > 1 ? dy / dist : dy;
        // Planet-space normal: undo axial tilt (about z) then spin (about y).
        const tx = nx * ct + ny * st, ty = -nx * st + ny * ct;
        const px = tx * cs + nz * ss, pz = -tx * ss + nz * cs;
        const water = surface(px, ty, pz);
        const lambert = nx * Lx + ny * Ly + nz * Lz;
        const shade = 0.025 + 0.975 * smooth(-0.12, 0.5, lambert);
        const night = smooth(0.12, -0.12, lambert);
        const rim = Math.pow(1 - nz, 2.6) * look.atmoStrength * smooth(-0.25, 0.4, lambert);
        let spec = 0;
        if (water > 0) {
          const nh = nx * Hx + ny * Hy + nz * Hz;
          spec = nh > 0 ? Math.pow(nh, 60) * 200 * water : 0;
        }
        const em = look.kind === 'lava' ? 1 : night;
        d[i] = out[0] * shade + look.atmo[0] * rim + spec + emit[0] * em;
        d[i + 1] = out[1] * shade + look.atmo[1] * rim + spec + emit[1] * em;
        d[i + 2] = out[2] * shade + look.atmo[2] * rim + spec + emit[2] * em;
        d[i + 3] = 255 * clamp01((1 - dist) * R + 1);
      } else if (look.atmoStrength > 0) {
        const t = (dist - 1) * R / halo;
        if (t < 1) {
          const lit = smooth(-0.5, 0.7, ((dx * Lx + dy * Ly) / dist) * 0.85 + Lz * 0.4);
          d[i] = look.atmo[0]; d[i + 1] = look.atmo[1]; d[i + 2] = look.atmo[2];
          d[i + 3] = 255 * Math.pow(1 - t, 3) * look.atmoStrength * lit * 0.85;
        }
      }
    }
    if ((y & 7) === 7) yield;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, diskFrac: R / (S / 2), look };
}

/** Concentric ring system. Outer radius is the full canvas half-width. */
export function ringSprite(rng, size, inner) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const { noise3 } = makeNoise(rng.int(0, 2 ** 30));
  const c1 = hsl(rng.float(25, 50), rng.float(0.15, 0.45), rng.float(0.6, 0.8));
  const c2 = hsl(rng.float(15, 45), rng.float(0.1, 0.35), rng.float(0.35, 0.55));
  const gap = rng.float(0.45, 0.75);
  const half = size / 2;
  const steps = Math.round(half * (1 - inner));
  for (let k = 0; k < steps; k++) {
    const t = k / steps;
    const r = half * (inner + (1 - inner) * t);
    let a = 0.15 + 0.75 * noise3(t * 30, 0.5, 1.5) * noise3(t * 7, 2.5, 0.5) * 1.6;
    a *= smooth(0, 0.08, t) * smooth(1, 0.85, t);
    if (Math.abs(t - gap) < 0.025) a *= 0.08;
    const c = mix(c1, c2, noise3(t * 10, 4.5, 3.5));
    ctx.strokeStyle = rgba(c, clamp01(a));
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(half, half, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  return canvas;
}

// --- stars ------------------------------------------------------------------------

export const STAR_CLASSES = {
  O: { color: [155, 176, 255], label: 'Class O blue star', weight: 0.6, size: [2.2, 3] },
  B: { color: [170, 191, 255], label: 'Class B blue-white star', weight: 1, size: [1.6, 2.4] },
  A: { color: [210, 222, 255], label: 'Class A white star', weight: 1.2, size: [1.2, 1.8] },
  F: { color: [248, 246, 255], label: 'Class F yellow-white star', weight: 1.2, size: [1, 1.4] },
  G: { color: [255, 236, 200], label: 'Class G yellow dwarf', weight: 1.5, size: [0.8, 1.2] },
  K: { color: [255, 196, 130], label: 'Class K orange dwarf', weight: 1.3, size: [0.6, 1] },
  M: { color: [255, 140, 90], label: 'Class M red dwarf', weight: 1.2, size: [0.4, 0.7] },
  RG: { color: [255, 110, 60], label: 'Red giant', weight: 0.8, size: [3, 4.5] },
  WD: { color: [220, 235, 255], label: 'White dwarf', weight: 0.5, size: [0.18, 0.28] },
};

export function* starSurfaceJob({ rng, color, size }) {
  const { fbm3 } = makeNoise(rng.int(0, 2 ** 30));
  const S = size, R = S / 2;
  const canvas = makeCanvas(S, S);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const hot = mix(color, [255, 255, 255], 0.75);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - R) / R, dy = (y + 0.5 - R) / R;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1.02) continue;
      const nz = Math.sqrt(Math.max(0, 1 - d2));
      const g = fbm3(dx * 9, dy * 9, nz * 9, 4);
      const spots = smooth(0.72, 0.8, fbm3(dx * 2 + 5, dy * 2, nz * 2, 3));
      const limb = 0.45 + 0.55 * Math.pow(nz, 0.5);
      const c = mix(color, hot, limb * (0.55 + g * 0.6));
      const k = limb * (0.85 + g * 0.3) * (1 - spots * 0.55);
      const i = (y * S + x) * 4;
      d[i] = c[0] * k + 30; d[i + 1] = c[1] * k + 30; d[i + 2] = c[2] * k + 30;
      d[i + 3] = 255 * clamp01((1 - Math.sqrt(d2)) * R + 1);
    }
    if ((y & 15) === 15) yield;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Accretion disk seen face on; the scene squashes and rotates it. Inner hole at `inner`. */
export function* diskJob({ rng, size, inner = 0.22 }) {
  const { fbm3 } = makeNoise(rng.int(0, 2 ** 30));
  const S = size, R = S / 2;
  const canvas = makeCanvas(S, S);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const stops = [[255, 255, 250], [255, 236, 170], [255, 170, 70], [230, 90, 30], [120, 30, 20]];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - R) / R, dy = (y + 0.5 - R) / R;
      const r = Math.hypot(dx, dy);
      if (r < inner || r > 1) continue;
      const t = (r - inner) / (1 - inner);
      const a = Math.atan2(dy, dx);
      const n = fbm3(Math.cos(a) * 1.6, Math.sin(a) * 1.6, r * 16, 5);
      const c = ramp(stops, Math.pow(t, 0.7));
      const b = (0.35 + 0.9 * n) * (1.25 - t);
      const i = (y * S + x) * 4;
      d[i] = c[0] * b; d[i + 1] = c[1] * b; d[i + 2] = c[2] * b;
      d[i + 3] = 255 * clamp01(smooth(0, 0.05, t) * smooth(1, 0.55, t) * (0.25 + n));
    }
    if ((y & 15) === 15) yield;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// --- clouds, galaxies, rocks ------------------------------------------------------

export function nebulaPuff(rng, colorA, colorB, size = 128) {
  const { fbm3 } = makeNoise(rng.int(0, 2 ** 30));
  const S = size, R = S / 2;
  const canvas = makeCanvas(S, S);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const z = rng.float(0, 50);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - R) / R, dy = (y + 0.5 - R) / R;
      const r2 = dx * dx + dy * dy;
      if (r2 >= 1) continue;
      const fall = (1 - r2) * (1 - r2);
      const n = fbm3(dx * 2.2, dy * 2.2, z, 5);
      const c = mix(colorA, colorB, smooth(0.35, 0.65, fbm3(dx * 1.5 + 9, dy * 1.5, z, 3)));
      const i = (y * S + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
      d[i + 3] = 255 * fall * smooth(0.2, 0.85, n);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function galaxySprite(rng, size = 192) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const R = size / 2;
  const arms = rng.int(2, 4);
  const wind = rng.float(2.5, 5);
  const core = hsl(rng.float(30, 50), 0.6, 0.8);
  const arm = hsl(rng.float(190, 240), 0.5, 0.75);
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(R, R, 0, R, R, R * 0.35);
  g.addColorStop(0, rgba(core, 0.9));
  g.addColorStop(1, rgba(core, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1800; i++) {
    const t = Math.pow(rng.next(), 0.8);
    const a = (rng.int(0, arms - 1) / arms) * Math.PI * 2 + t * wind + rng.gauss() * 0.28 * (1 - t * 0.5);
    const r = t * R * 0.92;
    const c = mix(core, arm, smooth(0.1, 0.6, t));
    ctx.fillStyle = rgba(c, 0.25 + 0.5 * rng.next() * (1 - t));
    const s = rng.float(0.6, 1.6);
    ctx.fillRect(R + Math.cos(a) * r, R + Math.sin(a) * r, s, s);
  }
  return canvas;
}

export function rockSprite(rng, light, size = 96) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const R = size / 2;
  const pts = rng.int(9, 14);
  const tone = hsl(rng.float(15, 45), rng.float(0.05, 0.2), rng.float(0.35, 0.55));
  ctx.translate(R, R);
  ctx.beginPath();
  for (let i = 0; i < pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const r = R * rng.float(0.62, 0.95);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(light[0] * R, light[1] * R, -light[0] * R, -light[1] * R);
  g.addColorStop(0, rgba(mix(tone, [255, 255, 255], 0.25)));
  g.addColorStop(0.55, rgba(mix(tone, [0, 0, 0], 0.55)));
  g.addColorStop(1, 'rgb(6,6,8)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  for (let i = 0; i < rng.int(3, 7); i++) {
    const cx = rng.float(-0.5, 0.5) * R, cy = rng.float(-0.5, 0.5) * R, cr = rng.float(0.08, 0.2) * R;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx + light[0] * cr * 0.2, cy + light[1] * cr * 0.2, cr, Math.PI, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
  return canvas;
}

// --- sector skybox ----------------------------------------------------------------

/**
 * A sector's distant backdrop: a soft low-resolution nebula/galactic band (scaled up
 * when drawn) plus a list of static background stars biased towards the band.
 */
export function* skyJob({ rng, palette, size = 320 }) {
  const { fbm3 } = makeNoise(rng.int(0, 2 ** 30));
  const S = size;
  const canvas = makeCanvas(S, S);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const seedZ = rng.float(0, 100);
  const bandAngle = rng.float(0, Math.PI);
  const bx = Math.cos(bandAngle), by = Math.sin(bandAngle);
  const bandWidth = rng.float(0.18, 0.4);
  const bandOffset = rng.float(-0.25, 0.25);
  const { a: A, b: B, base, intensity } = palette;
  const band = (u, v) => Math.exp(-((((u * by - v * bx) - bandOffset) / bandWidth) ** 2));

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * 2 - 1, v = (y / S) * 2 - 1;
      const q = fbm3(u * 1.3, v * 1.3, seedZ, 4);
      const w = fbm3(u * 1.3 + 5.2, v * 1.3 + 1.3, seedZ, 4);
      const n = fbm3(u * 2 + 2.6 * q, v * 2 + 2.6 * w, seedZ + 7, 5);
      const bnd = band(u, v);
      let dens = Math.pow(smooth(0.32, 0.85, n), 1.5) * (0.3 + 0.7 * bnd) * intensity;
      const dust = smooth(0.52, 0.66, fbm3(u * 3.2, v * 3.2, seedZ + 3, 4)) * bnd;
      dens *= 1 - 0.75 * dust;
      const c = mix(A, B, smooth(0.3, 0.7, q));
      const glow = bnd * 0.25 * (1 - dust);
      const i = (y * S + x) * 4;
      d[i] = base[0] + c[0] * dens + 120 * glow * intensity;
      d[i + 1] = base[1] + c[1] * dens + 110 * glow * intensity;
      d[i + 2] = base[2] + c[2] * dens + 125 * glow * intensity;
      d[i + 3] = 255;
    }
    if ((y & 3) === 3) yield;
  }
  ctx.putImageData(img, 0, 0);

  // Static background stars in normalised [-0.5, 0.5] sky coordinates.
  const count = 900;
  const stars = new Float32Array(count * 4); // x, y, brightness, twinkle phase
  for (let i = 0; i < count; i++) {
    let u, v;
    do { u = rng.float(-1, 1); v = rng.float(-1, 1); } while (rng.next() > 0.25 + 0.75 * band(u, v));
    stars[i * 4] = u / 2;
    stars[i * 4 + 1] = v / 2;
    stars[i * 4 + 2] = Math.pow(rng.next(), 3);
    stars[i * 4 + 3] = rng.float(0, Math.PI * 2);
  }
  return { canvas, stars };
}
