# Propriétaire : Salma — catalogue (préparation des photos de vêtements, OpenCV)
"""Prépare des photos de hauts pour le miroir : détourage, recadrage, texture PNG, vignette, entrée du catalogue.

Pour chaque image <dossier>/<catégorie>-<description>.(jpg|png) :
  1. silhouette : le MASQUE FOURNI <dossier>/masks/<même nom>.(jpg|png) s'il existe (VITON-HD : masque exact,
     seuil > 127 car c'est un JPEG), sinon GrabCut d'OpenCV (fond uni, vêtement centré) ;
  2. nettoyage : plus grand morceau d'un seul tenant, trous bouchés (étiquette blanche, motif clair) ;
  3. recadrage sur le vêtement (+ marge), 1024 px au plus, vignette 256 px ;
  4. contour : 1 px rogné et couleurs prolongées sous le bord (sinon liseré blanc du fond), alpha adouci ;
  5. ANCRES (coutures d'épaule, coins de l'ourlet) et centres de manche, calculés sur la silhouette avec
     la même méthode que tools/prepare-garment.mjs ; le squelette des bras en est déduit à l'exécution
     (src/vision/skinning.mjs), il n'est donc PAS écrit dans le catalogue ;
  6. coefficients `fit` : valeurs par défaut de la catégorie, à calibrer (outil de calibration, bouton
     « Copier »), comme le squelette (dev/skeleton-editor.html).

Usage :
    python tools/prepare_garments.py raw-garments/vitonhd --source vitonhd --merge-catalog
Options :
    --out DOSSIER       sortie (défaut : public/assets/garments/vitonhd)
    --source vitonhd    ajoute "source" (jeu de données, identifiant, licence) à chaque entrée,
                        d'après <dossier>/sources.json écrit par fetch_vitonhd.py
    --merge-catalog     ajoute / met à jour les entrées dans public/assets/garments/catalog.json
                        sans toucher aux autres vêtements (sinon : entrées affichées seulement)
Corriger les liserés d'une texture déjà préparée (sans la redétourer) :
    python tools/prepare_garments.py --bleed public/assets/garments/pull-gris.png ...
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "public" / "assets" / "garments" / "catalog.json"
DEFAULT_OUT = ROOT / "public" / "assets" / "garments" / "vitonhd"
CATEGORIES = ("chemise", "pull", "tshirt", "veste")
MAX_SIDE = 1024
THUMB_SIDE = 256
MARGIN = 0.03  # marge autour du vêtement recadré, en fraction du plus grand côté

# Valeurs de repli par catégorie, reprises des vêtements déjà calibrés du catalogue (t-shirts, pulls) ;
# chemise et veste : un peu plus amples. Elles se règlent ensuite avec l'outil de calibration.
DEFAULT_FIT = {
    "tshirt": {"ks": 1.3, "kh": 1.3, "dc": 0.08, "db": 0.1},
    "pull": {"ks": 1.32, "kh": 1.32, "dc": 0.1, "db": 0.08},
    "chemise": {"ks": 1.35, "kh": 1.3, "dc": 0.1, "db": 0.12},
    "veste": {"ks": 1.4, "kh": 1.35, "dc": 0.1, "db": 0.12},
}
LICENSES = {"vitonhd": ("VITON-HD", "CC BY-NC 4.0 (research, citation required)")}


# ─── Silhouette ──────────────────────────────────────────────────────────────

def find_mask(photo: Path) -> Path | None:
    """Masque fourni : <dossier>/masks/<même nom>.jpg ou .png."""
    for ext in (".jpg", ".png"):
        m = photo.parent / "masks" / f"{photo.stem}{ext}"
        if m.exists():
            return m
    return None


def mask_from_file(path: Path, shape: tuple[int, int]) -> np.ndarray:
    """Masque fourni → booléen. Seuil 127 : un masque JPEG a des gris parasites autour du contour."""
    m = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if m is None:
        raise ValueError(f"masque illisible : {path.name}")
    if m.shape != shape:
        raise ValueError(f"masque {m.shape[1]}×{m.shape[0]} ≠ photo {shape[1]}×{shape[0]}")
    return m > 127


def mask_grabcut(img: np.ndarray, iterations: int = 5) -> np.ndarray:
    """GrabCut (OpenCV) : modèle de couleurs du fond / du vêtement affiné par coupe de graphe.
    Initialisation par un rectangle à 2 % des bords : le vêtement est centré sur un fond uni."""
    h, w = img.shape[:2]
    rect = (int(0.02 * w), int(0.02 * h), int(0.96 * w), int(0.96 * h))
    gc = np.zeros((h, w), np.uint8)
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(img, gc, rect, bgd, fgd, iterations, cv2.GC_INIT_WITH_RECT)
    return (gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD)


def clean_mask(fg: np.ndarray) -> np.ndarray:
    """Plus grand morceau d'un seul tenant (poussières, ombres isolées → fond), puis trous bouchés :
    une zone de « fond » qui ne touche pas le bord de l'image est à l'intérieur du vêtement."""
    n, labels, stats, _ = cv2.connectedComponentsWithStats(fg.astype(np.uint8), connectivity=4)
    if n <= 1:
        raise ValueError("aucun vêtement détecté")
    best = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    fg = labels == best
    n, labels = cv2.connectedComponents((~fg).astype(np.uint8), connectivity=4)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    return ~np.isin(labels, border[border > 0]) | fg


# ─── Texture ─────────────────────────────────────────────────────────────────

def crop_resize(img: np.ndarray, fg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Recadre sur le vêtement (+ marge), puis réduit à MAX_SIDE au plus (jamais d'agrandissement : il
    n'ajouterait que du flou). Le masque est réduit en niveaux de gris puis re-seuillé (bord net)."""
    ys, xs = np.nonzero(fg)
    h, w = fg.shape
    m = int(MARGIN * max(xs.max() - xs.min(), ys.max() - ys.min()))
    x0, x1 = max(0, xs.min() - m), min(w, xs.max() + 1 + m)
    y0, y1 = max(0, ys.min() - m), min(h, ys.max() + 1 + m)
    img, fg = img[y0:y1, x0:x1], fg[y0:y1, x0:x1]
    k = min(1.0, MAX_SIDE / max(img.shape[:2]))
    if k < 1:
        size = (round(img.shape[1] * k), round(img.shape[0] * k))
        img = cv2.resize(img, size, interpolation=cv2.INTER_AREA)
        fg = cv2.resize(fg.astype(np.float32), size, interpolation=cv2.INTER_AREA) > 0.5
    return img, fg


SLIT = 6  # fentes du masque de moins de 6 px (entre manche et corps) : refermées ; au-delà, vrai écart


def close_slits(fg: np.ndarray) -> np.ndarray:
    """Referme les fentes fines (aisselle, manche posée contre le flanc). Le masque y laisse passer le
    fond blanc de la photo sur quelques pixels ; une fois le maillage étiré, ces fentes deviennent des
    traits blancs. Fermeture morphologique : seules les ouvertures < SLIT px sont comblées."""
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (SLIT, SLIT))
    return cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_CLOSE, k).astype(bool) | fg


def bleed(color: np.ndarray, body: np.ndarray) -> np.ndarray:
    """« Alpha bleeding » : chaque pixel transparent prend la couleur du pixel de vêtement le plus proche.
    Pourquoi tout le fond et pas un anneau : le GPU échantillonne des versions réduites de la texture
    (mipmaps) quand le vêtement est petit à l'écran ; au niveau n, un pixel mélange 2ⁿ × 2ⁿ pixels
    d'origine, donc un anneau de 6 px ne protège plus le bord dès le niveau 3, et le fond (blanc ou noir)
    réapparaît en liseré. Transformée de distance d'OpenCV avec étiquettes : un seul passage, O(N)."""
    src = (~body).astype(np.uint8)  # 0 = vêtement : les étiquettes désignent le pixel de vêtement le plus proche
    _, labels = cv2.distanceTransformWithLabels(src, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    seeds = np.flatnonzero(src.ravel() == 0)  # étiquette k (≥ 1) = k-ième pixel nul en ordre de balayage
    out = color.reshape(-1, 3)[seeds][labels.ravel() - 1].reshape(color.shape)
    out[body] = color[body]
    return out


def rgba_texture(img: np.ndarray, fg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Texture BGRA. Sur fond blanc, le contour mélange vêtement et blanc sur 1 à 2 px. On referme les
    fentes fines, on rogne 1 px, puis TOUT ce qui n'est pas « sûr » (anneau de 3 px du contour, fentes
    refermées — blanches sur la photo —, fond) reprend la couleur du pixel sûr le plus proche (bleed).
    Pas d'inpainting ici : il s'appuierait aussi sur le fond blanc voisin et salirait le bord.
    Alpha = silhouette adoucie par un flou 3×3.
    @returns (texture BGRA, silhouette rognée)"""
    k3 = np.ones((3, 3), np.uint8)
    closed = close_slits(fg)
    body = cv2.erode(closed.astype(np.uint8), k3, iterations=1).astype(bool)
    slits = cv2.dilate((closed & ~fg).astype(np.uint8), k3, iterations=2).astype(bool)
    trusted = cv2.erode(body.astype(np.uint8), k3, iterations=3).astype(bool) & ~slits
    color = bleed(img, trusted if trusted.any() else body)
    alpha = cv2.blur(body.astype(np.float32), (3, 3))
    bgra = np.dstack([color, np.round(alpha * 255).astype(np.uint8)])
    return bgra, body


def bleed_png(path: Path) -> None:
    """Corrige une texture DÉJÀ préparée (autre outil, images d'origine perdues) : alpha inchangé, couleurs
    des pixels transparents remplacées par celles du vêtement le plus proche."""
    t = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if t is None or t.ndim != 3 or t.shape[2] != 4:
        raise ValueError(f"{path.name} : PNG RGBA attendu")
    t[:, :, :3] = bleed(np.ascontiguousarray(t[:, :, :3]), t[:, :, 3] >= 128)
    cv2.imwrite(str(path), t, [cv2.IMWRITE_PNG_COMPRESSION, 9])


def thumbnail(bgra: np.ndarray) -> np.ndarray:
    k = THUMB_SIDE / max(bgra.shape[:2])
    size = (max(1, round(bgra.shape[1] * k)), max(1, round(bgra.shape[0] * k)))
    return cv2.resize(bgra, size, interpolation=cv2.INTER_AREA)


# ─── Ancres (même méthode que tools/prepare-garment.mjs) ─────────────────────

def runs(row: np.ndarray) -> list[tuple[int, int]]:
    """Plages [début, fin] de vêtement sur une ligne (plages de 3 px ou moins ignorées : bruit)."""
    d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
    starts, ends = np.nonzero(d == 1)[0], np.nonzero(d == -1)[0] - 1
    return [(int(a), int(b)) for a, b in zip(starts, ends) if b - a + 1 > 3]


def detect_anchors(fg: np.ndarray) -> list[list[int]]:
    """Coutures d'épaule = bords du CORPS (plage qui contient l'axe central, une fois les manches détachées),
    remontés jusqu'au haut du vêtement ; ourlet = bas du corps.
    @returns [[épaule G], [épaule D], [ourlet D], [ourlet G]] en pixels (ordre des coins du maillage)"""
    ys, xs = np.nonzero(fg)
    top, bottom = int(ys.min()), int(ys.max())
    cx = int(round((xs.min() + xs.max()) / 2))

    def body_at(y: int):
        return next(((a, b) for a, b in runs(fg[y]) if a <= cx <= b), None)

    hem_y = bottom
    while hem_y > top and not fg[hem_y, cx]:
        hem_y -= 1
    # Largeur du corps sous les aisselles : premières lignes où il est séparé des DEUX manches (3 plages ou
    # plus, le corps au milieu). Manches collées au corps (t-shirt à plat) : médiane sur la moitié basse.
    lefts, rights = [], []
    for y in range(top, hem_y):
        rs = runs(fg[y])
        i = next((k for k, (a, b) in enumerate(rs) if a <= cx <= b), -1)
        if len(rs) >= 3 and 0 < i < len(rs) - 1:
            lefts.append(rs[i][0])
            rights.append(rs[i][1])
            if len(lefts) >= 12:
                break
    if not lefts:
        for y in range(round(top + 0.55 * (hem_y - top)), round(hem_y - 0.05 * (hem_y - top))):
            r = body_at(y)
            if r:
                lefts.append(r[0])
                rights.append(r[1])
    if not lefts:
        raise ValueError("corps du vêtement introuvable (silhouette vide sur l'axe central ?)")
    body_l, body_r = sorted(lefts)[len(lefts) // 2], sorted(rights)[len(rights) // 2]

    def top_at(x: int) -> int:
        col = np.nonzero(fg[top:hem_y, x])[0]
        return top + int(col[0]) if col.size else hem_y

    # Ourlet un peu au-dessus du bas : on vise la bande de côtes, pas un coin arrondi.
    hem = body_at(round(hem_y - 0.02 * (hem_y - top))) or (body_l, body_r)
    # Même hauteur pour les deux épaules : une photo à plat est droite ; un écart vient du col ou d'un pli
    # et pencherait le vêtement à l'écran.
    shoulder_y = round((top_at(body_l) + top_at(body_r)) / 2)
    return [[body_l, shoulder_y], [body_r, shoulder_y], [hem[1], hem_y], [hem[0], hem_y]]


def sleeve_centers(fg: np.ndarray, anchors: list[list[int]]) -> list[list[int]] | None:
    """Barycentre du tissu à l'extérieur du corps, de chaque côté : direction de la manche au repos.
    None si une manche est introuvable (moins de 0,5 % de l'image : bord du corps, débardeur)."""
    h, w = fg.shape
    margin = 0.03 * w
    ys, xs = np.nonzero(fg)
    out = []
    for side in (xs < anchors[0][0] - margin, xs > anchors[1][0] + margin):
        if side.sum() < 0.005 * w * h:
            return None
        out.append([int(round(xs[side].mean())), int(round(ys[side].mean()))])
    return out


# ─── Un vêtement ─────────────────────────────────────────────────────────────

def human_name(stem: str) -> str:
    """« tshirt-marine-bandes » → « T-shirt marine bandes »."""
    cat, _, rest = stem.partition("-")
    label = {"tshirt": "T-shirt", "pull": "Pull", "chemise": "Chemise", "veste": "Veste"}[cat]
    return f"{label} {rest.replace('-', ' ')}".strip()


def prepare_one(photo: Path, out_dir: Path, url_prefix: str, source: dict | None = None) -> tuple[dict, list[str]]:
    """Prépare un vêtement ; écrit <out>/<nom>.png et <out>/thumbs/<nom>.png.
    @returns (entrée du catalogue, remarques à afficher)"""
    stem = photo.stem
    category = stem.split("-", 1)[0]
    if category not in CATEGORIES:
        raise ValueError(f"nom « {stem} » : doit commencer par {', '.join(CATEGORIES)}")
    img = cv2.imread(str(photo), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("photo illisible")
    notes = []
    mask_path = find_mask(photo)
    if mask_path:
        fg, method = mask_from_file(mask_path, img.shape[:2]), "masque fourni"
    else:
        fg, method = mask_grabcut(img), "GrabCut"
    fg = clean_mask(fg)
    img, fg = crop_resize(img, fg)
    bgra, body = rgba_texture(img, fg)
    anchors = detect_anchors(body)
    sleeves = sleeve_centers(body, anchors)
    if sleeves is None:
        notes.append("manches introuvables : pas de champ sleeves (squelette par défaut)")

    (out_dir / "thumbs").mkdir(parents=True, exist_ok=True)
    # Compression maximale : sans perte, −40 % environ ; ces fichiers sont versionnés et mis en cache
    # par le Service Worker, la taille compte plus que la seconde gagnée à l'écriture.
    png = [cv2.IMWRITE_PNG_COMPRESSION, 9]
    cv2.imwrite(str(out_dir / f"{stem}.png"), bgra, png)
    cv2.imwrite(str(out_dir / "thumbs" / f"{stem}.png"), thumbnail(bgra), png)
    h, w = bgra.shape[:2]
    entry = {
        "id": stem, "category": category, "name": human_name(stem),
        "texture": f"{url_prefix}/{stem}.png", "thumb": f"{url_prefix}/thumbs/{stem}.png",
        "size": [w, h], "anchors": anchors, "fit": dict(DEFAULT_FIT[category]), "colors": [],
    }
    if sleeves:
        entry["sleeves"] = sleeves
    if source:
        entry["source"] = source
    notes.insert(0, f"{method}, {w}×{h}, fit par défaut « {category} » (à calibrer)")
    return entry, notes


# ─── Catalogue ───────────────────────────────────────────────────────────────

def _value(v) -> str:
    """Même style que catalog.json : listes compactes, objets « { "a": 1, "b": 2 } » sur une ligne."""
    if isinstance(v, dict):
        return "{ " + ", ".join(f"{json.dumps(k)}: {_value(x)}" for k, x in v.items()) + " }" if v else "{}"
    if isinstance(v, list):
        return "[" + ", ".join(_value(x) for x in v) + "]"
    return json.dumps(v, ensure_ascii=False)


def format_catalog(cat: dict, newline: str = "\n") -> str:
    """catalog.json au format du dépôt : un champ par ligne, valeurs compactes (diff lisibles)."""
    lines = ["{"]
    lines += [f'  {json.dumps(k)}: {_value(v)},' for k, v in cat.items() if k != "garments"]
    lines.append('  "garments": [')
    for i, g in enumerate(cat["garments"]):
        lines.append("    {")
        items = list(g.items())
        lines += [f"      {json.dumps(k)}: {_value(v)}{',' if j < len(items) - 1 else ''}" for j, (k, v) in enumerate(items)]
        lines.append("    }" + ("," if i < len(cat["garments"]) - 1 else ""))
    lines += ["  ]", "}"]
    return newline.join(lines) + newline


def merge_catalog(path: Path, entries: list[dict]) -> tuple[int, int]:
    """Ajoute les nouvelles entrées, remplace celles de même id À LEUR PLACE ; les autres ne bougent pas.
    @returns (ajoutées, mises à jour)"""
    text = path.read_text("utf-8")
    cat = json.loads(text)
    index = {g["id"]: i for i, g in enumerate(cat["garments"])}
    added = updated = 0
    for e in entries:
        if e["id"] in index:
            cat["garments"][index[e["id"]]] = e
            updated += 1
        else:
            index[e["id"]] = len(cat["garments"])
            cat["garments"].append(e)
            added += 1
    path.write_text(format_catalog(cat, "\r\n" if "\r\n" in text else "\n"), "utf-8", newline="")
    return added, updated


def load_sources(folder: Path, kind: str) -> dict[str, dict]:
    """Champ "source" de chaque vêtement, d'après sources.json (fetch_vitonhd.py)."""
    dataset, license_ = LICENSES[kind]
    path = folder / "sources.json"
    raw = json.loads(path.read_text("utf-8")) if path.exists() else {}
    return {name: {"dataset": dataset, "id": s["id"], "license": license_} for name, s in raw.items()}


def main(argv: list[str]) -> int:
    if argv[:1] == ["--bleed"]:  # python tools/prepare_garments.py --bleed texture.png [...]
        for p in map(Path, argv[1:]):
            bleed_png(p)
            print(f"✓ {p} : fond transparent recoloré (alpha inchangé)")
        return 0
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("folder", type=Path)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--source", choices=sorted(LICENSES))
    ap.add_argument("--merge-catalog", action="store_true")
    a = ap.parse_args(argv)
    out_dir = a.out.resolve()
    try:
        url_prefix = "/" + out_dir.relative_to(ROOT / "public").as_posix()
    except ValueError:
        print("--out doit être un dossier de public/ (la texture est servie par le site)")
        return 1
    sources = load_sources(a.folder, a.source) if a.source else {}
    photos = sorted(p for p in a.folder.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    entries, failed = [], 0
    for photo in photos:
        try:
            src = sources.get(photo.stem)
            if a.source and not src:
                print(f"! {photo.stem} : absent de sources.json, pas de champ source")
            entry, notes = prepare_one(photo, out_dir, url_prefix, src)
            entries.append(entry)
            print(f"✓ {photo.stem:28s} " + " ; ".join(notes))
        except (ValueError, cv2.error) as e:
            failed += 1
            print(f"✗ {photo.stem} : {e}")
    if a.merge_catalog and entries:
        added, updated = merge_catalog(CATALOG, entries)
        print(f"\ncatalog.json : {added} ajouté(s), {updated} mis à jour, autres vêtements inchangés.")
    elif entries:
        print("\n(entrées non fusionnées : ajouter --merge-catalog)")
        for e in entries:
            print(_value(e))
    print(f"{len(entries)} vêtement(s) préparé(s) dans {out_dir.relative_to(ROOT)}, {failed} échec(s).")
    return 0 if not failed else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
