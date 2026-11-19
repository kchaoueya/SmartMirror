// Tests du schéma de catalog.json (S3). Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCatalog } from '../src/ui/ui.js';

const good = (over = {}) => ({
  id: 'tshirt', name: 'T-shirt', texture: '/assets/garments/tshirt.png',
  size: [1024, 1024], fit: { ks: 1.35, kh: 1.25, dc: 0.12, db: 0.1 }, ...over,
});

test('le catalog.json du projet est valide (3 hauts, aucun avertissement)', () => {
  const json = JSON.parse(readFileSync(new URL('../public/assets/garments/catalog.json', import.meta.url), 'utf8'));
  const { catalog, warnings } = validateCatalog(json);
  assert.deepEqual(catalog.garments.map((g) => g.id), ['tshirt', 'chemise', 'sweat']);
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
