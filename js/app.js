import { RAL, PANTONE } from './colors.js';
import {
  LIN, linToSrgb8, hexToRgb, rgbToHex, rgbToLab, rgbToCmyk, rgbToHsl,
  isLight, nearest, matchQuality,
} from './color.js';

const $ = id => document.getElementById(id);

// ---------- Cartas de color con Lab precalculado ----------
const RAL_GROUPS = {
  'yellow and beige': 'Amarillos y beiges', orange: 'Naranjas', red: 'Rojos', violet: 'Violetas',
  blue: 'Azules', green: 'Verdes', grey: 'Grises', brown: 'Marrones', 'white and black': 'Blancos y negros',
};
const prep = (c, chart) => {
  const rgb = hexToRgb(c.hex);
  return { ...c, chart, rgb, lab: rgbToLab(rgb) };
};
const RAL_DB = RAL.map(c => prep(c, 'RAL'));
const PAN_DB = PANTONE.map(c => prep(c, 'PANTONE'));

// ---------- Estado ----------
const work = document.createElement('canvas');
const wctx = work.getContext('2d', { willReadFrequently: true });
const view = $('view');
const vctx = view.getContext('2d');
const loupe = $('loupe');
const lctx = loupe.getContext('2d');

const state = {
  w: 0, h: 0,
  orig: null,       // ImageData original
  cur: null,        // ImageData con la corrección de luz aplicada
  radius: 2,
  mode: 'pick',     // 'pick' | 'white'
  wb: null,         // factores de corrección [fr, fg, fb]
  picked: null,     // { rgb, hex, lab, pos }
  palette: [],
  dragging: false,
};

// ---------- Utilidades ----------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

async function copy(text, what = text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copiado: ${what}`);
  } catch {
    toast('No se ha podido copiar');
  }
}

const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>';
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = n => n.toFixed(1).replace('.', ',');

// ---------- Carga de imagen ----------
/** Decodifica respetando la orientación EXIF de las fotos del móvil. */
async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* probar con <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; img.src = url; });
    return { width: img.naturalWidth, height: img.naturalHeight, source: img, close() {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Eso no parece una imagen'); return; }
  try {
    const img = await decodeImage(file);
    const iw = img.width, ih = img.height;
    const max = 1600;
    const s = Math.min(1, max / Math.max(iw, ih));
    state.w = work.width = Math.max(1, Math.round(iw * s));
    state.h = work.height = Math.max(1, Math.round(ih * s));
    wctx.drawImage(img.source ?? img, 0, 0, state.w, state.h);
    img.close?.();
    state.orig = wctx.getImageData(0, 0, state.w, state.h);
  } catch {
    toast('No he podido abrir esa imagen');
    return;
  }
  state.wb = null;
  state.picked = null;
  applyWhiteBalance();
  setMode('pick');

  $('drop').hidden = true;
  view.hidden = false;
  $('stage').classList.add('has-image');
  $('toolbar').hidden = false;
  $('btnResetWhite').hidden = true;
  $('result').hidden = true;
  $('resultEmpty').hidden = false;
  drawView();
  renderDominant();
}

// ---------- Corrección de luz (balance de blancos) ----------
function applyWhiteBalance() {
  const src = state.orig.data;
  const out = new ImageData(state.w, state.h);
  const d = out.data;
  if (!state.wb) {
    d.set(src);
  } else {
    const luts = state.wb.map(f => Uint8ClampedArray.from({ length: 256 }, (_, v) => linToSrgb8(LIN[v] * f)));
    const [lr, lg, lb] = luts;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lr[src[i]]; d[i + 1] = lg[src[i + 1]]; d[i + 2] = lb[src[i + 2]]; d[i + 3] = src[i + 3];
    }
  }
  state.cur = out;
  wctx.putImageData(out, 0, 0);
}

function setWhiteReference(pos) {
  // Muestra amplia de la referencia, medida sobre la foto original.
  const r = Math.max(state.radius, 4);
  const [R, G, B] = averageLinear(state.orig.data, pos.x, pos.y, r);
  if (Math.min(R, G, B) < 0.02) { toast('Esa zona es demasiado oscura para usarla de referencia'); return false; }
  if (Math.max(R, G, B) > 0.995) toast('Ojo: esa zona está quemada (blanco puro); la corrección será limitada');
  const m = (R + G + B) / 3;
  state.wb = [m / R, m / G, m / B];
  applyWhiteBalance();
  return true;
}

// ---------- Muestreo ----------
function averageLinear(data, cx, cy, r) {
  let R = 0, G = 0, B = 0, n = 0;
  const x0 = Math.max(0, cx - r), x1 = Math.min(state.w - 1, cx + r);
  const y0 = Math.max(0, cy - r), y1 = Math.min(state.h - 1, cy + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const o = (y * state.w + x) * 4;
      if (data[o + 3] < 128) continue;
      R += LIN[data[o]]; G += LIN[data[o + 1]]; B += LIN[data[o + 2]]; n++;
    }
  }
  return n ? [R / n, G / n, B / n] : [0, 0, 0];
}

function sampleAt(pos) {
  return averageLinear(state.cur.data, pos.x, pos.y, state.radius).map(linToSrgb8);
}

// ---------- Vista ----------
function drawView() {
  if (!state.cur) return;
  const stage = $('stage');
  const maxW = stage.clientWidth;
  const maxH = Math.max(260, window.innerHeight * 0.68);
  const s = Math.min(maxW / state.w, maxH / state.h);
  const cssW = Math.round(state.w * s), cssH = Math.round(state.h * s);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.style.width = cssW + 'px';
  view.style.height = cssH + 'px';
  view.width = Math.round(cssW * dpr);
  view.height = Math.round(cssH * dpr);
  vctx.imageSmoothingQuality = 'high';
  vctx.drawImage(work, 0, 0, view.width, view.height);

  if (state.picked?.pos) {
    const k = view.width / state.w;
    const x = (state.picked.pos.x + 0.5) * k, y = (state.picked.pos.y + 0.5) * k;
    const rr = Math.max(9 * dpr, (state.radius + 0.5) * k);
    vctx.lineWidth = 3 * dpr;
    vctx.strokeStyle = 'rgba(0,0,0,.55)';
    vctx.beginPath(); vctx.arc(x, y, rr + 2 * dpr, 0, Math.PI * 2); vctx.stroke();
    vctx.lineWidth = 2 * dpr;
    vctx.strokeStyle = '#fff';
    vctx.beginPath(); vctx.arc(x, y, rr, 0, Math.PI * 2); vctx.stroke();
  }
}

function toWork(e) {
  const rect = view.getBoundingClientRect();
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * state.w);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * state.h);
  return { x: Math.min(state.w - 1, Math.max(0, x)), y: Math.min(state.h - 1, Math.max(0, y)) };
}

// ---------- Lupa ----------
function updateLoupe(e) {
  const pos = toWork(e);
  const span = Math.max(15, state.radius * 2 + 9);
  const half = Math.floor(span / 2);
  const W = loupe.width;
  lctx.imageSmoothingEnabled = false;
  lctx.fillStyle = '#000';
  lctx.fillRect(0, 0, W, W);
  lctx.drawImage(work, pos.x - half, pos.y - half, span, span, 0, 0, W, W);
  const cell = W / span;
  const box = (state.radius * 2 + 1) * cell;
  const c = (W - box) / 2;
  lctx.lineWidth = 4; lctx.strokeStyle = 'rgba(0,0,0,.6)'; lctx.strokeRect(c - 2, c - 2, box + 4, box + 4);
  lctx.lineWidth = 2; lctx.strokeStyle = state.mode === 'white' ? '#f2b705' : '#fff'; lctx.strokeRect(c, c, box, box);

  const stageRect = $('stage').getBoundingClientRect();
  const px = e.clientX - stageRect.left, py = e.clientY - stageRect.top;
  const size = 150;
  const touch = e.pointerType !== 'mouse';
  let lx = touch ? px - size / 2 : px + 24;
  let ly = touch ? py - size - 48 : py - size - 24;
  if (lx + size > stageRect.width) lx = px - size - 24;
  if (ly < 4) ly = touch ? py + 48 : py + 24;
  loupe.style.left = Math.max(4, Math.min(stageRect.width - size - 4, lx)) + 'px';
  loupe.style.top = Math.max(4, Math.min(stageRect.height - size - 4, ly)) + 'px';
  loupe.hidden = false;
}

view.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  view.setPointerCapture(e.pointerId);
  state.dragging = true;
  updateLoupe(e);
  e.preventDefault();
});
view.addEventListener('pointermove', e => {
  if (state.dragging || e.pointerType === 'mouse') updateLoupe(e);
});
view.addEventListener('pointerup', e => {
  if (!state.dragging) return;
  state.dragging = false;
  if (e.pointerType !== 'mouse') loupe.hidden = true;
  handlePick(toWork(e));
});
view.addEventListener('pointercancel', () => { state.dragging = false; loupe.hidden = true; });
view.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !state.dragging) loupe.hidden = true; });

function handlePick(pos) {
  if (state.mode === 'white') {
    if (setWhiteReference(pos)) {
      setMode('pick');
      $('btnResetWhite').hidden = false;
      toast('Luz corregida con esa referencia');
      if (state.picked?.pos) selectColor(sampleAt(state.picked.pos), state.picked.pos);
      drawView();
      renderDominant();
    }
    return;
  }
  selectColor(sampleAt(pos), pos);
}

// ---------- Modo ----------
function setMode(mode) {
  state.mode = mode;
  const hint = $('hint');
  const btn = $('btnWhite');
  btn.classList.toggle('active', mode === 'white');
  if (mode === 'white') {
    hint.hidden = false;
    hint.classList.add('warn');
    hint.textContent = 'Toca algo que en la realidad sea blanco o gris neutro (un papel, una pared blanca, una junta gris…).';
  } else {
    hint.classList.remove('warn');
    hint.hidden = !state.cur;
    hint.textContent = state.wb
      ? 'Luz corregida. Toca la foto para medir un color (mantén pulsado y arrastra para usar la lupa).'
      : 'Toca la foto para medir un color. Mantén pulsado y arrastra para afinar con la lupa.';
  }
}

// ---------- Colores principales (k-means en Lab) ----------
function dominantColors(k = 8) {
  const d = state.cur.data;
  const total = state.w * state.h;
  const step = Math.max(1, Math.floor(total / 6000));
  const pts = [];
  for (let i = 0; i < total; i += step) {
    const o = i * 4;
    if (d[o + 3] < 128) continue;
    const rgb = [d[o], d[o + 1], d[o + 2]];
    pts.push({ lab: rgbToLab(rgb), lin: [LIN[rgb[0]], LIN[rgb[1]], LIN[rgb[2]]] });
  }
  if (!pts.length) return [];
  let seed = 7;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

  // k-means++
  const centers = [pts[Math.floor(rand() * pts.length)].lab.slice()];
  while (centers.length < k) {
    const ds = pts.map(p => Math.min(...centers.map(c => dist(p.lab, c))));
    const sum = ds.reduce((a, b) => a + b, 0);
    if (sum === 0) break;
    let r = rand() * sum, i = 0;
    while ((r -= ds[i]) > 0 && i < ds.length - 1) i++;
    centers.push(pts[i].lab.slice());
  }
  const assign = new Int32Array(pts.length);
  for (let it = 0; it < 12; it++) {
    pts.forEach((p, i) => {
      let best = 0, bd = Infinity;
      centers.forEach((c, j) => { const dd = dist(p.lab, c); if (dd < bd) { bd = dd; best = j; } });
      assign[i] = best;
    });
    const acc = centers.map(() => [0, 0, 0, 0]);
    pts.forEach((p, i) => { const a = acc[assign[i]]; a[0] += p.lab[0]; a[1] += p.lab[1]; a[2] += p.lab[2]; a[3]++; });
    acc.forEach((a, j) => { if (a[3]) centers[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  const groups = centers.map(() => ({ lin: [0, 0, 0], n: 0 }));
  pts.forEach((p, i) => { const g = groups[assign[i]]; g.lin[0] += p.lin[0]; g.lin[1] += p.lin[1]; g.lin[2] += p.lin[2]; g.n++; });
  // Une grupos casi iguales (degradados de luz) para no repetir el mismo color.
  const merged = [];
  groups.filter(g => g.n).sort((a, b) => b.n - a.n).forEach(g => {
    const lab = rgbToLab(g.lin.map(v => linToSrgb8(v / g.n)));
    const twin = merged.find(m => Math.sqrt(dist(m.lab, lab)) < 9);
    if (twin) {
      twin.lin = twin.lin.map((v, i) => v + g.lin[i]); twin.n += g.n;
    } else merged.push({ ...g, lin: g.lin.slice(), lab });
  });
  return merged
    .filter(g => g.n / pts.length >= 0.02)
    .sort((a, b) => b.n - a.n)
    .map(g => ({ rgb: g.lin.map(v => linToSrgb8(v / g.n)), share: g.n / pts.length }));
}

function renderDominant() {
  const list = dominantColors();
  const box = $('dominant');
  box.innerHTML = '';
  list.forEach(c => {
    const hex = rgbToHex(c.rgb);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dom-chip';
    b.title = `Usar ${hex}`;
    b.style.setProperty('--c', hex);
    b.innerHTML = `<i></i>${hex}<small>${Math.round(c.share * 100)} %</small>`;
    b.addEventListener('click', () => selectColor(c.rgb, null));
    box.appendChild(b);
  });
  $('dominantWrap').hidden = list.length === 0;
}

// ---------- Resultado ----------
function selectColor(rgb, pos) {
  const hex = rgbToHex(rgb);
  const lab = rgbToLab(rgb);
  state.picked = { rgb, hex, lab, pos };
  drawView();

  $('resultEmpty').hidden = true;
  $('result').hidden = false;
  $('pickedChip').style.setProperty('--c', hex);
  $('pickedHex').textContent = hex;

  const [c, m, y, k] = rgbToCmyk(rgb);
  const [h, s, l] = rgbToHsl(rgb);
  const rows = [
    ['HEX', hex],
    ['RGB', rgb.join(', ')],
    ['CMYK', `${c} ${m} ${y} ${k}`],
    ['HSL', `${h}° ${s}% ${l}%`],
    ['Lab', lab.map(v => Math.round(v)).join(', ')],
  ];
  const dl = $('pickedValues');
  dl.innerHTML = rows.map(([t, v]) =>
    `<dt>${t}</dt><dd>${esc(v)}</dd><button type="button" class="copy" data-copy="${esc(v)}" aria-label="Copiar ${t}">${COPY_ICON}</button>`).join('');

  const ral = nearest(lab, RAL_DB, 5);
  const pan = nearest(lab, PAN_DB, 5);
  renderList($('listRal'), ral);
  renderList($('listPan'), pan);

  // Abanico: las 3 mejores de cada carta, la más parecida arriba y en horizontal.
  const top = [...ral.slice(0, 3), ...pan.slice(0, 3)].sort((a, b) => a.dE - b.dE);
  renderFan($('fan'), top, { spread: 74 });
}

function describe(c) {
  return c.chart === 'RAL' ? `${c.name} · ${RAL_GROUPS[c.group] ?? c.group}` : c.hex;
}

function renderList(ol, items) {
  ol.innerHTML = '';
  items.forEach(c => {
    const q = matchQuality(c.dE);
    const li = document.createElement('li');
    li.title = `Copiar ${c.code}`;
    li.innerHTML = `<span class="dot" style="--c:${c.hex}"></span>
      <span class="nm"><b>${esc(c.code)}</b><small>${esc(describe(c))}</small></span>
      <span class="de ${q.tone}" title="${q.label}">ΔE ${fmt(c.dE)}</span>`;
    li.addEventListener('click', () => copy(c.code));
    ol.appendChild(li);
  });
}

function renderFan(fan, items, { spread = 74, interactive = true } = {}) {
  fan.innerHTML = '';
  const n = items.length;
  const step = n > 1 ? spread / (n - 1) : 0;
  items.forEach((c, rank) => {
    const b = document.createElement(interactive ? 'button' : 'div');
    if (interactive) b.type = 'button';
    b.className = 'blade';
    b.style.setProperty('--c', c.hex);
    b.style.setProperty('--ink-on', isLight(c.rgb) ? '#1f1b16' : '#ffffff');
    b.style.zIndex = String(n - rank);
    b.dataset.angle = String(-rank * step);
    b.style.setProperty('--d', `${(n - rank) * 45}ms`);
    const q = c.dE != null ? matchQuality(c.dE) : null;
    b.innerHTML = `<span class="rivet"></span>
      <span class="lbl">${c.chart === 'RAL' ? 'RAL' : 'PANTONE'}</span>
      <span class="sw">
        <span class="sw-name"><b>${esc(c.code)}</b><small>${esc(c.chart === 'RAL' ? c.name : 'aprox. ' + c.hex)}</small></span>
        ${q ? `<span class="sw-de"><em>ΔE ${fmt(c.dE)}</em><i>${q.label}</i></span>` : ''}
      </span>`;
    if (interactive) {
      b.title = `${c.code} — clic para copiar`;
      b.addEventListener('click', () => copy(c.code));
    }
    fan.appendChild(b);
  });
  sizeFan(fan, spread);
  // Se abre como una carta de verdad.
  fan.getBoundingClientRect(); // fuerza el estado cerrado antes de abrir
  setTimeout(() => {
    fan.querySelectorAll('.blade').forEach(b => b.style.setProperty('--a', `${b.dataset.angle}deg`));
  }, 30);
}

function sizeFan(fan, spread = 74) {
  const blade = fan.querySelector('.blade');
  if (!blade || fan.classList.contains('fan-mini')) return;
  const L = blade.offsetWidth, H = blade.offsetHeight;
  fan.style.height = Math.ceil(L * Math.sin((spread * Math.PI) / 180) + H + 34) + 'px';
}

$('pickedValues').addEventListener('click', e => {
  const btn = e.target.closest('[data-copy]');
  if (btn) copy(btn.dataset.copy);
});

// ---------- Paleta ----------
const STORE = 'muestrario.paleta.v1';
function loadPalette() {
  try { state.palette = JSON.parse(localStorage.getItem(STORE)) || []; } catch { state.palette = []; }
}
function savePalette() {
  try { localStorage.setItem(STORE, JSON.stringify(state.palette)); } catch { /* sin almacenamiento */ }
}
function renderPalette() {
  const box = $('palette');
  box.innerHTML = '';
  state.palette.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'chip-card';
    card.style.setProperty('--c', p.hex);
    card.innerHTML = `<div class="chip-color"></div>
      <div class="chip-label"><b>${esc(p.hex)}</b><small>${esc(p.ral)}</small><small>${esc(p.pan)}</small></div>
      <button type="button" class="del" aria-label="Quitar ${esc(p.hex)}">×</button>`;
    card.querySelector('.del').addEventListener('click', () => {
      state.palette.splice(i, 1); savePalette(); renderPalette();
    });
    card.querySelector('.chip-color').addEventListener('click', () => copy(p.hex));
    box.appendChild(card);
  });
  $('paletteCard').hidden = state.palette.length === 0;
}

$('btnSave').addEventListener('click', () => {
  const p = state.picked;
  if (!p) return;
  if (state.palette.some(x => x.hex === p.hex)) { toast('Ese color ya está en tu paleta'); return; }
  const ral = nearest(p.lab, RAL_DB, 1)[0];
  const pan = nearest(p.lab, PAN_DB, 1)[0];
  state.palette.unshift({ hex: p.hex, ral: ral.code, pan: pan.code });
  state.palette = state.palette.slice(0, 30);
  savePalette();
  renderPalette();
  toast('Guardado en tu paleta');
});
$('btnCopyPalette').addEventListener('click', () => {
  const txt = state.palette.map(p => `${p.hex}\t${p.ral}\t${p.pan}`).join('\n');
  copy(txt, `${state.palette.length} colores`);
});
$('btnClearPalette').addEventListener('click', () => {
  if (!confirm('¿Vaciar la paleta?')) return;
  state.palette = []; savePalette(); renderPalette();
});

// ---------- Controles ----------
document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
  state.radius = Number(b.dataset.r);
  if (state.picked?.pos) selectColor(sampleAt(state.picked.pos), state.picked.pos);
}));
$('btnWhite').addEventListener('click', () => setMode(state.mode === 'white' ? 'pick' : 'white'));
$('btnResetWhite').addEventListener('click', () => {
  state.wb = null;
  applyWhiteBalance();
  $('btnResetWhite').hidden = true;
  setMode('pick');
  if (state.picked?.pos) selectColor(sampleAt(state.picked.pos), state.picked.pos);
  drawView();
  renderDominant();
  toast('Corrección de luz quitada');
});

['file', 'camera', 'file2'].forEach(id => $(id).addEventListener('change', e => {
  loadFile(e.target.files[0]);
  e.target.value = '';
}));

const drop = $('drop');
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
  e.preventDefault();
  drop.classList.add('over');
}));
['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => {
  e.preventDefault();
  if (ev === 'dragleave' && e.relatedTarget) return;
  drop.classList.remove('over');
}));
document.addEventListener('drop', e => loadFile(e.dataTransfer?.files?.[0]));
document.addEventListener('paste', e => {
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (item) loadFile(item.getAsFile());
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    drawView();
    sizeFan($('fan'));
    sizeFan($('dropFan'));
  }, 120);
});

// ---------- Inicio: abanico decorativo de la portada ----------
(function intro() {
  const picks = ['RAL 1023', 'RAL 2004', 'RAL 3020', 'RAL 4006', 'RAL 5015', 'RAL 6018', 'RAL 7016'];
  const items = picks.map(code => RAL_DB.find(c => c.code === code)).filter(Boolean).reverse();
  renderFan($('dropFan'), items, { spread: 84, interactive: false });
})();

loadPalette();
renderPalette();
