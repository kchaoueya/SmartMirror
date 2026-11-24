# Propriétaire : Salma — tests de tools/prepare_garments.py et tools/fetch_vitonhd.py
"""Lancer : python tools/test_prepare_garments.py

Aucune image réelle : un faux haut (formes géométriques sur fond blanc) et son masque sont générés en mémoire,
puis écrits dans un dossier temporaire supprimé à la fin. Aucun accès réseau.
"""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_vitonhd as fv  # noqa: E402
import prepare_garments as pg  # noqa: E402

W, H = 600, 800
BODY = (200, 150, 400, 700)  # x0, y0, x1, y1 du corps


def fake_garment() -> tuple[np.ndarray, np.ndarray]:
    """Haut bleu à manches écartées sur fond blanc + masque exact (manches séparées du corps sous l'aisselle).
    Un PATCH bleu isolé dans le coin n'est PAS dans le masque : s'il apparaît, le masque n'a pas été suivi."""
    img = np.full((H, W, 3), 255, np.uint8)
    mask = np.zeros((H, W), np.uint8)
    x0, y0, x1, y1 = BODY
    for target, val in ((img, (180, 60, 30)), (mask, 255)):
        cv2.rectangle(target, (x0, y0), (x1, y1), val, -1)
        cv2.fillConvexPoly(target, np.array([[x0, y0], [x0 - 130, y0 + 260], [x0 - 70, y0 + 290], [x0, y0 + 90]]), val)
        cv2.fillConvexPoly(target, np.array([[x1, y0], [x1 + 130, y0 + 260], [x1 + 70, y0 + 290], [x1, y0 + 90]]), val)
    cv2.rectangle(img, (5, 5), (40, 40), (180, 60, 30), -1)  # tache hors masque
    cv2.rectangle(img, (290, 300), (310, 330), (255, 255, 255), -1)  # étiquette blanche dans le corps
    cv2.rectangle(mask, (290, 300), (310, 330), 0, -1)  # … et trou correspondant dans le masque
    return img, mask


class PrepareTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "masks").mkdir()
        img, mask = fake_garment()
        cv2.imwrite(str(self.tmp / "tshirt-test.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
        cv2.imwrite(str(self.tmp / "masks" / "tshirt-test.jpg"), mask)  # JPEG, comme VITON-HD
        self.out = self.tmp / "out"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_masque_fourni_utilise_et_pas_grabcut(self):
        original = pg.mask_grabcut
        pg.mask_grabcut = lambda *a, **k: self.fail("GrabCut appelé alors qu'un masque est fourni")
        try:
            entry, notes = pg.prepare_one(self.tmp / "tshirt-test.jpg", self.out, "/assets/garments/t")
        finally:
            pg.mask_grabcut = original
        self.assertIn("masque fourni", notes[0])
        tex = cv2.imread(str(self.out / "tshirt-test.png"), cv2.IMREAD_UNCHANGED)
        self.assertEqual(tex.shape[2], 4, "texture RGBA")
        # Recadrage sur le masque (la tache du coin est exclue) : largeur ≈ 600 - 2·70 + marges, pas 600.
        w, h = entry["size"]
        self.assertEqual([tex.shape[1], tex.shape[0]], [w, h])
        span_x, span_y = (BODY[2] + 130) - (BODY[0] - 130), BODY[3] - BODY[1]
        self.assertLess(abs(w - span_x * (1 + 2 * pg.MARGIN)), 6, f"largeur {w}")
        self.assertLess(abs(h - span_y * (1 + 2 * pg.MARGIN)), 6, f"hauteur {h}")
        # Trou bouché (étiquette) : opaque au centre du corps.
        self.assertEqual(tex[int(h * 0.3), w // 2, 3], 255)
        # Fond transparent (coin), vêtement opaque.
        self.assertEqual(tex[0, 0, 3], 0)

    def test_vignette_et_entree_catalogue(self):
        entry, _ = pg.prepare_one(self.tmp / "tshirt-test.jpg", self.out, "/assets/garments/t",
                                  {"dataset": "VITON-HD", "id": "00000_00", "license": "x"})
        th = cv2.imread(str(self.out / "thumbs" / "tshirt-test.png"), cv2.IMREAD_UNCHANGED)
        self.assertEqual(max(th.shape[:2]), pg.THUMB_SIDE)
        self.assertEqual(entry["texture"], "/assets/garments/t/tshirt-test.png")
        self.assertEqual(entry["category"], "tshirt")
        self.assertEqual(entry["fit"], pg.DEFAULT_FIT["tshirt"])
        self.assertEqual(entry["source"]["dataset"], "VITON-HD")
        self.assertNotIn("skeleton", entry, "le squelette est déduit des ancres à l'exécution")

    def test_ancres_sur_les_coutures_et_manches(self):
        entry, _ = pg.prepare_one(self.tmp / "tshirt-test.jpg", self.out, "/x")
        (sl, sr, hr, hl), w = entry["anchors"], entry["size"][0]
        # Coordonnées attendues dans l'image recadrée : décalage = bord gauche du vêtement - marge.
        m = int(pg.MARGIN * max(260 + 200, BODY[3] - BODY[1]))
        ox, oy = BODY[0] - 130 - m, BODY[1] - m
        for got, want in ((sl[0], BODY[0] - ox), (sr[0], BODY[2] - ox), (hl[0], BODY[0] - ox), (hr[0], BODY[2] - ox)):
            self.assertLess(abs(got - want), 4, f"x ancre {got} ≠ {want}")
        self.assertLess(abs(sl[1] - (BODY[1] - oy)), 4, "épaules en haut du corps")
        self.assertLess(abs(hl[1] - (BODY[3] - oy)), 4, "ourlet en bas du corps")
        left, right = entry["sleeves"]
        self.assertLess(left[0], sl[0])
        self.assertGreater(right[0], sr[0])

    def test_pas_de_liseré_fond_recoloré_et_fentes_refermées(self):
        # Fente de 3 px entre la manche gauche et le corps, là où ils se touchent (y0 … y0 + 90), ouverte
        # vers le bas sur l'écart sous l'aisselle (comme une vraie fente : un trou fermé serait une étiquette),
        # dans la photo (blanc) ET dans le masque.
        img, mask = fake_garment()
        x0, y0 = BODY[0], BODY[1]
        for target, val in ((img, (255, 255, 255)), (mask, 0)):
            cv2.line(target, (x0 - 2, y0 + 20), (x0 - 2, y0 + 110), val, 3)
        cv2.imwrite(str(self.tmp / "tshirt-test.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
        cv2.imwrite(str(self.tmp / "masks" / "tshirt-test.jpg"), mask)
        entry, _ = pg.prepare_one(self.tmp / "tshirt-test.jpg", self.out, "/x")
        tex = cv2.imread(str(self.out / "tshirt-test.png"), cv2.IMREAD_UNCHANGED).astype(int)
        blue = np.array([180, 60, 30])
        # 1. Fond transparent : couleur du vêtement partout (ni blanc ni noir), même loin du bord.
        far = tex[tex[:, :, 3] == 0][:, :3]
        self.assertLess(np.abs(far - blue).max(), 40, "fond transparent recoloré")
        # 2. Fente refermée : opaque et bleue (pas le blanc de la photo).
        m = int(pg.MARGIN * max(260 + 200, BODY[3] - BODY[1]))
        sx, sy = x0 - 2 - (BODY[0] - 130 - m), y0 + 50 - (BODY[1] - m)
        self.assertEqual(tex[sy, sx, 3], 255, "fente refermée")
        self.assertLess(np.abs(tex[sy, sx, :3] - blue).max(), 40, "fente recolorée")
        # 3. Mipmap niveau 3 (moyenne 8×8, comme le GPU, couleurs non prémultipliées) : bord sans liseré.
        mip = cv2.resize(tex.astype(np.float32), None, fx=1 / 8, fy=1 / 8, interpolation=cv2.INTER_AREA)
        edge = (mip[:, :, 3] > 25) & (mip[:, :, 3] < 230)
        self.assertLess(np.abs(mip[edge][:, :3] - blue).max(), 40, "pas de liseré aux mipmaps")

    def test_bleed_png_alpha_inchange(self):
        t = np.zeros((40, 40, 4), np.uint8)
        t[10:30, 10:30] = (20, 200, 30, 255)
        path = self.tmp / "t.png"
        cv2.imwrite(str(path), t)
        pg.bleed_png(path)
        u = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
        self.assertTrue(np.array_equal(u[:, :, 3], t[:, :, 3]))
        self.assertEqual(tuple(u[0, 0, :3]), (20, 200, 30))

    def test_grabcut_sans_masque(self):
        (self.tmp / "masks" / "tshirt-test.jpg").unlink()
        entry, notes = pg.prepare_one(self.tmp / "tshirt-test.jpg", self.out, "/x")
        self.assertIn("GrabCut", notes[0])
        self.assertIn("anchors", entry)

    def test_masque_de_mauvaise_taille_refuse(self):
        cv2.imwrite(str(self.tmp / "masks" / "tshirt-test.jpg"), np.zeros((10, 10), np.uint8))
        with self.assertRaises(ValueError):
            pg.prepare_one(self.tmp / "tshirt-test.jpg", self.out, "/x")


class CatalogTest(unittest.TestCase):
    def test_format_identique_au_depot(self):
        """Relire puis réécrire catalog.json ne change rien : la fusion ne touche pas aux autres vêtements."""
        text = pg.CATALOG.read_text("utf-8")
        nl = "\r\n" if "\r\n" in text else "\n"
        self.assertEqual(pg.format_catalog(json.loads(text), nl), text)

    def test_fusion_ajoute_et_remplace_sur_place(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            path = tmp / "catalog.json"
            path.write_text(pg.format_catalog({"version": 2, "garments": [{"id": "a", "n": 1}, {"id": "b", "n": 1}]}), "utf-8")
            added, updated = pg.merge_catalog(path, [{"id": "a", "n": 2}, {"id": "c", "n": 1}])
            self.assertEqual((added, updated), (1, 1))
            ids = [(g["id"], g["n"]) for g in json.loads(path.read_text("utf-8"))["garments"]]
            self.assertEqual(ids, [("a", 2), ("b", 1), ("c", 1)])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class FetchArgsTest(unittest.TestCase):
    def test_formes_acceptees(self):
        self.assertEqual(fv.parse_arg("00311_00=pull-gris"), ("00311_00", "pull-gris"))
        self.assertEqual(fv.parse_arg("cloth/00013_00.jpg=tshirt-rose"), ("00013_00", "tshirt-rose"))
        self.assertEqual(fv.urls("00013_00")[1], f"{fv.BASE_URL}/cloth-mask/00013_00.jpg")

    def test_formes_refusees(self):
        for bad in ("00311_00", "abc=pull-x", "00311_00=robe-x", "00311_00=Pull Gris"):
            with self.assertRaises(ValueError, msg=bad):
                fv.parse_arg(bad)

    def test_image_trop_petite_ou_illisible(self):
        with self.assertRaises(ValueError):
            fv.check_image(b"x" * 100, "photo")
        with self.assertRaises(ValueError):
            fv.check_image(b"x" * 10_000, "photo")


if __name__ == "__main__":
    unittest.main(verbosity=2)
