// Propriétaire : Salma — éditeur du squelette au repos d'un vêtement (champ « skeleton » de catalog.json).
// Ouvrir http://localhost:5173/dev/skeleton-editor.html après `npm run dev`.
import { loadCatalog } from '../src/ui/ui.mjs';
import {
  JOINTS, BONE, defaultSkeleton, skeletonToPixels, buildSkinMesh, computeWeights, SKIN_RES,
} from '../src/vision/skinning.mjs';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const g2d = canvas.getContext('2d');
const BONE_COLORS = { [BONE.TORSO]: '#9ca3af', [BONE.ARM_L]: '#60a5fa', [BONE.FORE_L]: '#1d4ed8', [BONE.ARM_R]: '#f472b6', [BONE.FORE_R]: '#be185d' };
const LINKS = [['shoulderL', 'elbowL'], ['elbowL', 'wristL'], ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
  ['shoulderL', 'shoulderR'], ['shoulderR', 'hipR'], ['hipR', 'hipL'], ['hipL', 'shoulderL']];

let catalog = null, garment = null, image = null;
let skeleton = null; // normalisé [u, v]
let dragging = null;

const round = (v) => Math.round(v * 1000) / 1000;

async function init() {
  catalog = await loadCatalog();
  $('garment').innerHTML = catalog.garments.map((g) => `<option value="${g.id}">${g.name}</option>`).join('');
  $('garment').addEventListener('change', () => select($('garment').value));
  $('weights').addEventListener('change', draw);
  $('reset').addEventListener('click', () => { skeleton = defaultSkeleton(garment.fit, garment.category, garment); draw(); });
  $('copy').addEventListener('click', copy);
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  window.addEventListener('pointerup', () => { dragging = null; });
  await select(catalog.garments[0].id);
}

async function select(id) {
  garment = catalog.garments.find((g) => g.id === id);
  image = new Image();
  image.src = garment.texture;
  await image.decode();
  [canvas.width, canvas.height] = garment.size;
  skeleton = garment.skeleton ? structuredClone(garment.skeleton) : defaultSkeleton(garment.fit, garment.category, garment);
  $('msg').textContent = garment.skeleton ? 'Squelette lu dans catalog.json.' : 'Squelette par défaut (calculé depuis les ancres et les manches).';
  draw();
}

function draw() {
  const [W, H] = garment.size;
  g2d.clearRect(0, 0, W, H);
  g2d.drawImage(image, 0, 0, W, H);
  const px = skeletonToPixels(skeleton, W, H);
  if ($('weights').checked) {
    // Os dominant de chaque sommet du maillage, recalculé à chaque déplacement (quelques ms).
    const mesh = buildSkinMesh(W, H, garment.anchors ?? null, SKIN_RES);
    const { bones, w } = computeWeights(px, mesh, { category: garment.category, anchors: garment.anchors });
    for (let i = 0; i < mesh.count; i++) {
      g2d.fillStyle = BONE_COLORS[bones[i * 2]];
      g2d.globalAlpha = 0.25 + 0.6 * w[i * 2];
      g2d.beginPath();
      g2d.arc(mesh.restVertices[i * 2], mesh.restVertices[i * 2 + 1], 4, 0, Math.PI * 2);
      g2d.fill();
    }
    g2d.globalAlpha = 1;
  }
  g2d.lineWidth = 3;
  g2d.strokeStyle = '#facc15';
  for (const [a, b] of LINKS) {
    g2d.beginPath(); g2d.moveTo(...px[a]); g2d.lineTo(...px[b]); g2d.stroke();
  }
  g2d.font = `${Math.round(W / 45)}px system-ui`;
  for (const k of JOINTS) {
    g2d.fillStyle = k === dragging ? '#f87171' : '#facc15';
    g2d.beginPath(); g2d.arc(...px[k], W / 90, 0, Math.PI * 2); g2d.fill();
    g2d.fillStyle = '#fff';
    g2d.fillText(k, px[k][0] + W / 70, px[k][1] - W / 70);
  }
  $('json').value = json();
}

const json = () => `"skeleton": ${JSON.stringify(Object.fromEntries(JOINTS.map((k) => [k, skeleton[k].map(round)])))}`;

/** Position du pointeur en coordonnées texture normalisées. */
function at(e) {
  const r = canvas.getBoundingClientRect();
  return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
}

function down(e) {
  const [u, v] = at(e);
  const [W, H] = garment.size;
  let best = null, bd = Infinity;
  for (const k of JOINTS) {
    const d = Math.hypot((skeleton[k][0] - u) * W, (skeleton[k][1] - v) * H);
    if (d < bd) { bd = d; best = k; }
  }
  if (bd < W / 25) { dragging = best; canvas.setPointerCapture(e.pointerId); draw(); }
}

function move(e) {
  if (!dragging) return;
  skeleton[dragging] = at(e);
  draw();
}

async function copy() {
  try {
    await navigator.clipboard.writeText(json());
    $('msg').textContent = 'Copié : coller dans l\'entrée du vêtement de public/assets/garments/catalog.json.';
  } catch {
    $('json').select();
    $('msg').textContent = 'Copie automatique refusée : sélectionner le texte et Ctrl+C.';
  }
}

init().catch((e) => { $('msg').textContent = `Erreur : ${e.message}`; });
