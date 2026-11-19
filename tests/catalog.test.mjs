// Tests du schéma de catalog.json (S3). Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCatalog } from '../src/ui/ui.mjs';

const good = (over = {}) => ({
  id: 'tshirt', name: 'T-shirt', texture: '/assets/garments/tshirt.png',
  size: [1024, 1024], fit: { ks: 1.35, kh: 1.25, dc: 0.12, db: 0.1 }, ...over,
});

test('le catalog.json du projet est valide (5 hauts, aucun avertissement)', () => {
  const json = JSON.parse(readFileSync(new URL('../public/assets/garments/catalog.json', import.meta.url), 'utf8'));
  const { catalog, warnings } = validateCatalog(json);
  assert.deepEqual(catalog.garments.map((g) => g.id), ['tshirt-strass', 'tshirt-raye', 'pull-gris', 'pull-jaune', 'sweat']);
  assert.deepEqual(warnings, []);
});

test('valeurs par défaut : size 1024×1024, colors []', () => {
  const { catalog } = validateCatalog({ garments: [{ ...good(), size: undefined, colors: undefined }] });
  assert.deepEqual(catalog.garments[0].size, [1024, 1024]);
  assert.deepEqual(catalog.garments[0].colors, []);
  assert.equal(catalog.version, 1);
});

test('un vêtement mal décrit est écarté avec un avertissement, les autres restent', () => {
  const { catalog, warnings } = validateCatalog({
    garments: [
      good(),
      good({ id: 'tshirt' }),                                // id en double
      good({ id: 'x', fit: { ks: 1.3, kh: -1, dc: 0, db: 0 } }), // kh négatif
      good({ id: 'y', texture: '' }),                        // texture manquante
      good({ id: 'z', size: [1024] }),                       // size incomplet
    ],
  });
  assert.deepEqual(catalog.garments.map((g) => g.id), ['tshirt']);
  assert.equal(warnings.length, 4);
  assert.match(warnings[0], /id en double/);
  assert.match(warnings[1], /fit/);
});

test('catalogue sans vêtement utilisable → erreur', () => {
  assert.throws(() => validateCatalog({}), /garments/);
  assert.throws(() => validateCatalog({ garments: [] }), /vide/);
  assert.throws(() => validateCatalog({ garments: [{ id: 'a' }] }), /vide/);
});

test('anchors : facultatif, 4 points [x, y] dans l\'ordre épaules puis ourlet', () => {
  const anchors = [[282, 277], [763, 277], [720, 812], [323, 812]];
  const { catalog, warnings } = validateCatalog({
    garments: [
      good({ id: 'ok', anchors }),
      good({ id: 'trois', anchors: anchors.slice(0, 3) }),
      good({ id: 'inverse', anchors: [anchors[1], anchors[0], anchors[2], anchors[3]] }), // épaules inversées
      good({ id: 'texte', anchors: [['a', 1], ...anchors.slice(1)] }),
    ],
  });
  assert.deepEqual(catalog.garments.map((g) => g.id), ['ok']);
  assert.deepEqual(catalog.garments[0].anchors, anchors);
  assert.equal(warnings.length, 3);
  assert.ok(warnings.every((w) => /anchors/.test(w)));
});

test('sleeves : facultatif, 2 points, et seulement avec des ancres', () => {
  const anchors = [[282, 277], [763, 277], [720, 812], [323, 812]];
  const sleeves = [[180, 632], [856, 651]];
  const { catalog, warnings } = validateCatalog({
    garments: [
      good({ id: 'ok', anchors, sleeves }),
      good({ id: 'sans-ancres', sleeves }),
      good({ id: 'un-seul', anchors, sleeves: [sleeves[0]] }),
    ],
  });
  assert.deepEqual(catalog.garments.map((g) => g.id), ['ok']);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((w) => /sleeves/.test(w)));
});

test('skeleton : facultatif ; invalide → avertissement, vêtement gardé avec le squelette par défaut', () => {
  const joints = ['shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'hipL', 'hipR'];
  const skeleton = Object.fromEntries(joints.map((k, i) => [k, [0.1 + i * 0.1, 0.5]]));
  const { catalog, warnings } = validateCatalog({
    garments: [
      good({ id: 'ok', skeleton, category: 'tshirt' }),
      good({ id: 'hors-bornes', skeleton: { ...skeleton, wristL: [1.2, 0.5] } }),
      good({ id: 'incomplet', skeleton: { shoulderL: [0.3, 0.2] } }),
      good({ id: 'categorie', category: 42 }),
    ],
  });
  assert.deepEqual(catalog.garments.map((g) => g.id), ['ok', 'hors-bornes', 'incomplet']);
  assert.deepEqual(catalog.garments[0].skeleton, skeleton);
  assert.equal(catalog.garments[1].skeleton, undefined);
  assert.equal(catalog.garments[2].skeleton, undefined);
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /skeleton/);
  assert.match(warnings[2], /category/);
});
