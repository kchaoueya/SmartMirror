/**
 * Génère 3 PNG de placeholder pour les vêtements (tshirt, chemise, sweat).
 * À remplacer par les vraies images en S3/S5.
 * Usage : node scripts/generate-placeholders.mjs
 */
import { writeFileSync, mkdirSync } from 'fs';
import { deflateSync } from 'zlib';

const SIZE = 512;
const OUT = 'public/assets/garments';

// --- Encodeur PNG minimal (signature + IHDR + IDAT + IEND) ---

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = (crc >>> 8) ^ table[(crc ^ b) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length);
  const crcBuf = Buffer.allocUnsafe(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}

function encodePNG(pixels) {
  // pixels : Uint8Array RGBA, SIZE×SIZE
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Scanlines avec filtre 0 (None) au début de chaque ligne
  const raw = Buffer.allocUnsafe(SIZE * (1 + SIZE * 4));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (1 + SIZE * 4)] = 0;
    for (let x = 0; x < SIZE; x++) {
      const src = (y * SIZE + x) * 4;
      const dst = y * (1 + SIZE * 4) + 1 + x * 4;
      raw[dst]     = pixels[src];
      raw[dst + 1] = pixels[src + 1];
      raw[dst + 2] = pixels[src + 2];
      raw[dst + 3] = pixels[src + 3];
    }
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// --- Formes des vêtements ---

function inTshirt(x, y) {
  const nx = x / SIZE, ny = y / SIZE;
  // Manches : bande en haut sur toute la largeur
  if (ny < 0.30) return true;
  // Corps : rectangle centré en dessous
  if (ny >= 0.30 && ny <= 1.0 && nx >= 0.22 && nx <= 0.78) return true;
  return false;
}

function inChemise(x, y) {
  const nx = x / SIZE, ny = y / SIZE;
  // Col : petite encoche centrale en haut
  if (ny < 0.10 && Math.abs(nx - 0.5) < 0.08) return false;
  // Épaules étroites
  if (ny < 0.20) return nx >= 0.15 && nx <= 0.85;
  // Corps droit
  if (ny < 1.0) return nx >= 0.25 && nx <= 0.75;
  return false;
}

function inSweat(x, y) {
  const nx = x / SIZE, ny = y / SIZE;
  // Manches larges
  if (ny < 0.35) return true;
  // Corps large
  if (ny >= 0.35 && ny <= 1.0 && nx >= 0.15 && nx <= 0.85) return true;
  return false;
}

function makePixels(shapeFn, r, g, b) {
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      if (shapeFn(x, y)) {
        pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 230;
      }
      // sinon : alpha = 0 (transparent)
    }
  }
  return pixels;
}

// --- Génération ---

mkdirSync(OUT, { recursive: true });

const garments = [
  { file: 'tshirt.png',  shape: inTshirt,  r: 240, g: 240, b: 240 },
  { file: 'chemise.png', shape: inChemise, r: 200, g: 220, b: 240 },
  { file: 'sweat.png',   shape: inSweat,   r: 220, g: 200, b: 220 },
];

for (const { file, shape, r, g, b } of garments) {
  const pixels = makePixels(shape, r, g, b);
  writeFileSync(`${OUT}/${file}`, encodePNG(pixels));
  console.log(`✓ ${OUT}/${file}`);
}
