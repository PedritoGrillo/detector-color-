// Conversiones de color y distancia ΔE2000 (sRGB, iluminante D65).

/** Valor lineal (0–1) de cada nivel sRGB de 8 bits. */
export const LIN = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** Lineal (0–1, se recorta) a nivel sRGB de 8 bits. */
export function linToSrgb8(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 255;
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.round(v * 255);
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function rgbToLab([r8, g8, b8]) {
  const r = LIN[r8], g = LIN[g8], b = LIN[b8];
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
  const z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883;
  const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Diferencia de color CIEDE2000. < 1 imperceptible, < 2 casi igual, < 5 parecido. */
export function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180, deg = 180 / Math.PI, p7 = 25 ** 7;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cb7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + p7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hue = (b, a) => {
    if (a === 0 && b === 0) return 0;
    const t = Math.atan2(b, a) * deg;
    return t < 0 ? t + 360 : t;
  };
  const h1p = hue(b1, a1p), h2p = hue(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    else hbp = (h1p + h2p) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad)
    + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Cbp7 = Cbp ** 7;
  const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + p7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

/** CMYK sencillo (sin perfil de impresión), en %. Orientativo. */
export function rgbToCmyk([r, g, b]) {
  const R = r / 255, G = g / 255, B = b / 255;
  const k = 1 - Math.max(R, G, B);
  if (k >= 1) return [0, 0, 0, 100];
  const c = (1 - R - k) / (1 - k), m = (1 - G - k) / (1 - k), y = (1 - B - k) / (1 - k);
  return [c, m, y, k].map(v => Math.round(v * 100));
}

export function rgbToHsl([r, g, b]) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

/** ¿Va mejor texto oscuro encima de este color? */
export function isLight([r, g, b]) {
  return 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b] > 0.22;
}

/** Los n colores de la lista más cercanos (lista con .lab precalculado). */
export function nearest(lab, list, n = 5) {
  return list
    .map(c => ({ ...c, dE: deltaE2000(lab, c.lab) }))
    .sort((a, b) => a.dE - b.dE)
    .slice(0, n);
}

export function matchQuality(dE) {
  if (dE < 1) return { label: 'Idéntico', tone: 'q1' };
  if (dE < 2.5) return { label: 'Casi idéntico', tone: 'q2' };
  if (dE < 5) return { label: 'Muy parecido', tone: 'q3' };
  if (dE < 10) return { label: 'Parecido', tone: 'q4' };
  return { label: 'Lejano', tone: 'q5' };
}
