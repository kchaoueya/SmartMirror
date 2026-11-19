// Prépare une photo de vêtement pour le miroir (Node.js, sans dépendance) :
//   1. détoure le fond (uni et sombre ou clair, relié aux bords de l'image) → transparent ;
//   2. bouche les trous à l'intérieur du vêtement (pixels semi-transparents d'un détourage raté) ;
//   3. adoucit le contour (1 px) et prolonge les couleurs sous le contour (pas de liseré sombre) ;
//   4. détecte les ANCRES du vêtement : coutures d'épaule et coins de l'ourlet, en pixels de la texture.
//      Ce sont ces points (et non les coins de l'image) qui sont posés sur les épaules et les hanches.
//
// Usage : node tools/prepare-garment.mjs entree.png [sortie.png] [--fond=noir|blanc] [--taches]
//   --taches : efface aussi les taches claires isolées (détourage raté, comme sweat.png d'origine).
// Affiche les ancres à recopier dans public/assets/garments/catalog.json (champ "anchors").
import fs from 'node:fs';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

// ---------- PNG (8 bits, RGBA ou RGB, non entrelacé) ----------

export function decodePNG(buf) {
  let p = 8, W = 0, H = 0, colorType = 0, depth = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      W = d.readUInt32BE(0); H = d.readUInt32BE(4);
      depth = d[8]; colorType = d[9]; interlace = d[12];
    }
    if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`PNG non pris en charge (profondeur ${depth}, type ${colorType}, entrelacé ${interlace}) : exporter en RGBA 8 bits`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = W * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const img = Buffer.alloc(W * H * bpp);
  for (let y = 0; y < H; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = raw[y * (stride + 1) + 1 + x];
      const L = x >= bpp ? img[y * stride + x - bpp] : 0;
      const U = y ? img[(y - 1) * stride + x] : 0;
      const UL = y && x >= bpp ? img[(y - 1) * stride + x - bpp] : 0;
      let v = a;
      if (f === 1) v = a + L;
      else if (f === 2) v = a + U;
      else if (f === 3) v = a + ((L + U) >> 1);
      else if (f === 4) {
        const q = L + U - UL, pa = Math.abs(q - L), pb = Math.abs(q - U), pc = Math.abs(q - UL);
        v = a + (pa <= pb && pa <= pc ? L : pb <= pc ? U : UL);
      }
      img[y * stride + x] = v & 255;
    }
  }
  if (bpp === 4) return { W, H, px: img };
  const px = Buffer.alloc(W * H * 4, 255);
  for (let i = 0; i < W * H; i++) { px[i * 4] = img[i * 3]; px[i * 4 + 1] = img[i * 3 + 1]; px[i * 4 + 2] = img[i * 3 + 2]; }
  return { W, H, px };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePNG({ W, H, px }) {
  const stride = W * 4;
  const raw = Buffer.alloc(H * (stride + 1));
  const cand = [0, 1, 2].map(() => Buffer.alloc(stride));
  for (let y = 0; y < H; y++) {
    // Filtre choisi ligne par ligne (aucun, gauche, haut) : le plus petit en somme absolue.
    let best = 0, bestScore = Infinity;
    for (let f = 0; f < 3; f++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const v = px[y * stride + x];
        const ref = f === 1 ? (x >= 4 ? px[y * stride + x - 4] : 0) : f === 2 ? (y ? px[(y - 1) * stride + x] : 0) : 0;
        const d = (v - ref) & 255;
        cand[f][x] = d;
        score += d < 128 ? d : 256 - d;
      }
      if (score < bestScore) { bestScore = score; best = f; }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Nettoyage ----------

/** Fond relié aux bords : pixel transparent, ou proche de la couleur de fond (noir ou blanc). */
function backgroundMask({ W, H, px }, bg) {
  const isBg = (i) => {
    const a = px[i * 4 + 3];
    if (a < 40) return true;
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    // Fond blanc : blanc franc, ou gris très clair peu coloré (ombre douce sous le vêtement, sinon un liseré).
    if (bg === 'blanc') return Math.min(r, g, b) > 235 || (Math.min(r, g, b) > 205 && Math.max(r, g, b) - Math.min(r, g, b) < 14);
    return Math.max(r, g, b) < 40;
  };
  const mask = new Uint8Array(W * H); // 1 = fond
  const stack = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const i = stack.pop();
    if (mask[i] || !isBg(i)) continue;
    mask[i] = 1;
    const x = i % W, y = (i / W) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < W - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - W);
    if (y < H - 1) stack.push(i + W);
  }
  return mask;
}

/** Remplit les pixels `bad` par la moyenne de leurs voisins valides, de proche en proche. */
function inpaint({ W, H, px }, bad, maxPasses = 64) {
  for (let pass = 0; pass < maxPasses; pass++) {
    const fixed = [];
    for (let i = 0; i < W * H; i++) {
      if (!bad[i]) continue;
      const x = i % W, y = (i / W) | 0;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if ((dx || dy) && xx >= 0 && yy >= 0 && xx < W && yy < H && !bad[yy * W + xx]) {
            const j = (yy * W + xx) * 4;
            r += px[j]; g += px[j + 1]; b += px[j + 2]; n++;
          }
        }
      }
      if (n) fixed.push(i, r / n, g / n, b / n);
    }
    if (!fixed.length) return;
    for (let k = 0; k < fixed.length; k += 4) {
      const i = fixed[k];
      px[i * 4] = fixed[k + 1]; px[i * 4 + 1] = fixed[k + 2]; px[i * 4 + 2] = fixed[k + 3];
      bad[i] = 0;
    }
  }
}

/**
 * Taches claires laissées par un détourage raté : pixels nettement plus clairs que la moyenne du tissu
 * autour d'eux (fenêtre large, pour qu'une grande tache ne fausse pas sa propre référence). Deux passes :
 * la seconde recalcule la moyenne sans les taches trouvées par la première. Marque les pixels dans `bad`.
 * @returns {number} nombre de pixels marqués
 */
function brightSpots({ W, H, px }, bad, radius = 40, margin = 30, floor = 215) {
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  let marked = 0;
  for (let pass = 0; pass < 2; pass++) {
    // Images intégrales de la luminance et du nombre de pixels de tissu valides.
    const S = new Float64Array((W + 1) * (H + 1));
    const C = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let rs = 0, rc = 0;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!bad[i]) { rs += lum[i]; rc++; }
        S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + rs;
        C[(y + 1) * (W + 1) + x + 1] = C[y * (W + 1) + x + 1] + rc;
      }
    }
    const box = (T, x0, y0, x1, y1) => T[y1 * (W + 1) + x1] - T[y0 * (W + 1) + x1] - T[y1 * (W + 1) + x0] + T[y0 * (W + 1) + x0];
    const found = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (bad[i]) continue;
        const x0 = Math.max(0, x - radius), y0 = Math.max(0, y - radius);
        const x1 = Math.min(W, x + radius + 1), y1 = Math.min(H, y + radius + 1);
        const n = box(C, x0, y0, x1, y1);
        if (n > 50 && lum[i] > floor && lum[i] > box(S, x0, y0, x1, y1) / n + margin) found.push(i);
      }
    }
    for (const i of found) bad[i] = 1;
    marked += found.length;
  }
  return marked;
}

/**
 * Ne garde que le plus grand morceau de vêtement d'un seul tenant : les points isolés autour du contour
 * (artefacts JPEG, poussières, ombre mouchetée) passent dans le fond. Modifie `fond` en place.
 */
function keepLargestPiece(fond, W, H) {
  const label = new Int32Array(W * H);
  let best = 0, bestSize = 0, next = 0;
  for (let s = 0; s < W * H; s++) {
    if (fond[s] || label[s]) continue;
    next++;
    let size = 0;
    const stack = [s];
    label[s] = next;
    while (stack.length) {
      const i = stack.pop();
      size++;
      const x = i % W, y = (i / W) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && !fond[j] && !label[j]) { label[j] = next; stack.push(j); }
      }
    }
    if (size > bestSize) { bestSize = size; best = next; }
  }
  for (let i = 0; i < W * H; i++) if (!fond[i] && label[i] !== best) fond[i] = 1;
}

function clean(img, bg, spots = false) {
  const { W, H, px } = img;
  const fond = backgroundMask(img, bg);
  keepLargestPiece(fond, W, H);
  const N = W * H;
  // Pixels à recolorer : trous du vêtement (semi-transparents), anneau de 2 px le long du contour (liseré
  // de la couleur du fond), et fond proche du contour (sinon le filtrage de texture ramène du noir au bord).
  const dist = new Uint8Array(N).fill(255); // distance (Chebyshev) au contour, plafonnée
  const queue = [];
  for (let i = 0; i < N; i++) {
    const x = i % W, y = (i / W) | 0;
    const edge = (x > 0 && fond[i - 1] !== fond[i]) || (x < W - 1 && fond[i + 1] !== fond[i])
      || (y > 0 && fond[i - W] !== fond[i]) || (y < H - 1 && fond[i + W] !== fond[i]);
    if (edge) { dist[i] = 0; queue.push(i); }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    if (dist[i] >= 6) continue;
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (dist[j] > dist[i] + 1) { dist[j] = dist[i] + 1; queue.push(j); }
      }
    }
  }
  // Fond blanc : le contour d'une photo (JPEG, souvent agrandie) mélange vêtement et blanc sur plusieurs
  // pixels. On rogne 1 px et on recolore 3 px depuis l'intérieur ; sinon un liseré clair entoure le vêtement.
  const ring = bg === 'blanc' ? 3 : 1;
  if (bg === 'blanc') for (let i = 0; i < N; i++) if (!fond[i] && dist[i] <= 1) fond[i] = 1;
  const bad = new Uint8Array(N);
  let holes = 0;
  for (let i = 0; i < N; i++) {
    if (fond[i]) bad[i] = 1;
    else if (px[i * 4 + 3] < 250) { bad[i] = 1; holes++; }
    else if (dist[i] <= ring) bad[i] = 1;
  }
  // Taches claires : seulement sur demande (--taches). Sur un imprimé (strass, rayures claires),
  // les zones claires sont voulues et seraient effacées.
  if (spots) holes += brightSpots(img, bad);
  inpaint(img, bad);
  // Alpha : 255 dans le vêtement, 0 dans le fond, bord adouci par un flou 3×3 du masque.
  for (let i = 0; i < N; i++) {
    const x = i % W, y = (i / W) | 0;
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        s += fond[yy * W + xx] ? 0 : 1; n++;
      }
    }
    px[i * 4 + 3] = Math.round((255 * s) / n);
  }
  return { fond, holes };
}

// ---------- Ancres ----------

/** Plages [début, fin] de vêtement sur une ligne. */
function runs(fond, W, y) {
  const out = [];
  let start = -1;
  for (let x = 0; x <= W; x++) {
    const on = x < W && !fond[y * W + x];
    if (on && start < 0) start = x;
    if (!on && start >= 0) { if (x - start > 2) out.push([start, x - 1]); start = -1; }
  }
  return out;
}

/**
 * Coutures d'épaule = bords du CORPS du vêtement (plage qui contient l'axe central, manches exclues dès
 * qu'elles s'en détachent), remontés jusqu'au haut du vêtement. Ourlet = bas du corps, au même niveau.
 * @returns {number[][]} [[épauleG], [épauleD], [ourletD], [ourletG]] en pixels (ordre des coins du maillage)
 */
function detectAnchors(fond, W, H) {
  let top = H, bottom = -1, minX = W, maxX = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (fond[y * W + x]) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  if (bottom < 0) throw new Error('Aucun vêtement détecté (fond mal reconnu ? essayer --fond=blanc)');
  const cx = Math.round((minX + maxX) / 2);
  const bodyAt = (y) => runs(fond, W, y).find(([a, b]) => a <= cx && cx <= b);

  // Bas du corps sur l'axe central (l'ourlet).
  let hemY = bottom;
  while (hemY > top && fond[hemY * W + cx]) hemY--;
  // Largeur du corps sous les aisselles : premières lignes où le corps est séparé des deux manches
  // (au moins 3 plages). Sans manches détachées (t-shirt, débardeur) : médiane sur la moitié basse.
  const lefts = [], rights = [];
  for (let y = top; y < hemY && lefts.length < 12; y++) {
    const rs = runs(fond, W, y);
    const i = rs.findIndex(([a, b]) => a <= cx && cx <= b);
    if (rs.length >= 3 && i > 0 && i < rs.length - 1) { lefts.push(rs[i][0]); rights.push(rs[i][1]); }
  }
  if (!lefts.length) {
    for (let y = Math.round(top + 0.55 * (hemY - top)); y < hemY - 0.05 * (hemY - top); y++) {
      const r = bodyAt(y);
      if (r) { lefts.push(r[0]); rights.push(r[1]); }
    }
  }
  const median = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  const bodyL = median(lefts), bodyR = median(rights);
  // Haut du vêtement au droit des coutures (la pente d'épaule est conservée).
  const topAt = (x) => { let y = top; while (y < hemY && fond[y * W + x]) y++; return y; };
  // Ourlet un peu au-dessus du bas pour viser la bande de côtes, pas un coin arrondi.
  const hemRow = Math.round(hemY - 0.02 * (hemY - top));
  const hem = bodyAt(hemRow) ?? [bodyL, bodyR];
  // Même hauteur pour les deux épaules : une photo à plat est droite, un écart vient du contour
  // (col, pli) et pencherait le vêtement à l'écran.
  const shoulderY = Math.round((topAt(bodyL) + topAt(bodyR)) / 2);
  return [
    [bodyL, shoulderY],
    [bodyR, shoulderY],
    [hem[1], hemY],
    [hem[0], hemY],
  ];
}

/**
 * Centre de chaque manche (barycentre des pixels opaques à l'extérieur du corps), en pixels de texture.
 * La direction épaule → centre est la direction de la manche AU REPOS, sur la photo à plat : l'application
 * fait tourner la manche de l'écart entre cette direction et celle du bras (src/vision/sleeves.mjs).
 * @param {{W:number, H:number, px:Buffer}} img  image RGBA (déjà détourée)
 * @param {number[][]} anchors  [[épaule G], [épaule D], [ourlet D], [ourlet G]]
 * @returns {number[][]|null} [[gauche], [droite]], null si une manche est introuvable (débardeur)
 */
export function sleeveCenters({ W, H, px }, anchors) {
  const margin = 0.03 * W;
  const acc = [[0, 0, 0], [0, 0, 0]];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (px[(y * W + x) * 4 + 3] < 128) continue;
      const side = x < anchors[0][0] - margin ? 0 : x > anchors[1][0] + margin ? 1 : -1;
      if (side < 0) continue;
      acc[side][0] += x; acc[side][1] += y; acc[side][2]++;
    }
  }
  // Moins de 0,5 % de l'image : pas une manche (bord du corps, poussière).
  if (acc.some(([, , n]) => n < 0.005 * W * H)) return null;
  return acc.map(([sx, sy, n]) => [Math.round(sx / n), Math.round(sy / n)]);
}

// ---------- Programme ----------

function main() {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith('--'));
  const bg = (args.find((a) => a.startsWith('--fond=')) ?? '--fond=noir').slice(7);
  if (!files.length) {
    console.log('Usage : node tools/prepare-garment.mjs entree.png [sortie.png] [--fond=noir|blanc]');
    process.exit(1);
  }
  const [input, output = input] = files;
  const img = decodePNG(fs.readFileSync(input));
  const { fond, holes } = clean(img, bg, args.includes('--taches'));
  const anchors = detectAnchors(fond, img.W, img.H);
  fs.writeFileSync(output, encodePNG(img));
  const bgCount = fond.reduce((s, v) => s + v, 0);
  console.log(`${output} : ${img.W}×${img.H}, fond détouré ${(100 * bgCount / (img.W * img.H)).toFixed(1)} %, trous bouchés ${holes} px`);
  console.log(`"size": [${img.W}, ${img.H}],`);
  console.log(`"anchors": ${JSON.stringify(anchors)},`);
  console.log(`"sleeves": ${JSON.stringify(sleeveCenters(img, anchors))}`);
  console.log('(si les ancres sont corrigées à la main, recalculer "sleeves" avec ces ancres : sleeveCenters)');
}

// Lancé en ligne de commande (et non importé, par exemple pour réutiliser decodePNG / encodePNG).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
