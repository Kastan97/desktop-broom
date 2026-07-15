'use strict';
// Generates icon.png (256x256) and icon.ico for DeskSweep - pure Node, no deps.
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const S = 256;
const buf = Buffer.alloc(S * S * 4); // RGBA
function px(x, y, r, g, b, a = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  const ia = a / 255, na = 1 - ia;
  buf[i] = r * ia + buf[i] * na; buf[i + 1] = g * ia + buf[i + 1] * na;
  buf[i + 2] = b * ia + buf[i + 2] * na; buf[i + 3] = Math.max(buf[i + 3], a);
}
function roundedBgGradient(radius) {
  for (let y = 0; y < S; y++) {
    const t = y / S;
    const r = Math.round(15 + t * 12), g = Math.round(23 + t * 18), b = Math.round(42 + t * 24); // navy gradient
    for (let x = 0; x < S; x++) {
      // rounded corners
      const cx = Math.min(x, S - 1 - x), cy = Math.min(y, S - 1 - y);
      if (cx < radius && cy < radius) {
        const dx = radius - cx, dy = radius - cy;
        if (dx * dx + dy * dy > radius * radius) continue;
      }
      px(x, y, r, g, b, 255);
    }
  }
}
function fillPoly(pts, r, g, b, a = 255) {
  let minY = 1e9, maxY = -1e9;
  for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a1 = pts[i], b1 = pts[(i + 1) % pts.length];
      if ((a1[1] <= y && b1[1] > y) || (b1[1] <= y && a1[1] > y)) {
        xs.push(a1[0] + (y - a1[1]) / (b1[1] - a1[1]) * (b1[0] - a1[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.floor(xs[k]); x <= Math.ceil(xs[k + 1]); x++) px(x, y, r, g, b, a);
  }
}
function thickLine(x0, y0, x1, y1, w, r, g, b) {
  const steps = Math.hypot(x1 - x0, y1 - y0) * 2;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps, cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
    for (let dy = -w; dy <= w; dy++) for (let dx = -w; dx <= w; dx++) if (dx * dx + dy * dy <= w * w) px(cx + dx, cy + dy, r, g, b);
  }
}
function star(cx, cy, rad, r, g, b) {
  for (let a = -rad; a <= rad; a++) { px(cx + a, cy, r, g, b); px(cx, cy + a, r, g, b); }
  const d = rad * 0.5;
  for (let a = -d; a <= d; a++) { px(cx + a, cy + a, r, g, b, 160); px(cx + a, cy - a, r, g, b, 160); }
}

// --- draw ---
roundedBgGradient(48);
// bristle head (neon green trapezoid) - the "sweep"
fillPoly([[96, 150], [128, 150], [162, 214], [70, 214]], 57, 255, 20);
// bristle lines (darker green)
for (let bx = 78; bx <= 154; bx += 12) thickLine((96 + bx) / 2 - 8 + (bx - 96) * 0.2, 158, bx, 210, 1, 22, 120, 12);
// broom handle (wood)
thickLine(180, 52, 112, 152, 7, 201, 146, 46);
thickLine(180, 52, 112, 152, 3, 232, 180, 90);
// motion sparkles
star(196, 120, 12, 255, 255, 255);
star(158, 74, 9, 57, 255, 20);
star(210, 176, 7, 255, 255, 255);
star(120, 96, 6, 180, 255, 160);

// --- encode PNG ---
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function toPNG() {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(S * (S * 4 + 1));
  for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, y * S * 4 + S * 4); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
const png = toPNG();
const outDir = __dirname;
fs.writeFileSync(path.join(outDir, 'icon.png'), png);

// --- wrap PNG into ICO ---
const dir = Buffer.alloc(6); dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4);
const ent = Buffer.alloc(16);
ent[0] = 0; ent[1] = 0; ent[2] = 0; ent[3] = 0; // 256x256, 0 colors
ent.writeUInt16LE(1, 4); ent.writeUInt16LE(32, 6);
ent.writeUInt32LE(png.length, 8); ent.writeUInt32LE(22, 12);
fs.writeFileSync(path.join(outDir, 'icon.ico'), Buffer.concat([dir, ent, png]));
console.log('Wrote icon.png and icon.ico (' + png.length + ' bytes PNG)');
