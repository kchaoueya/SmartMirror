# Propriétaire : Salma — catalogue (téléchargement des vêtements VITON-HD)
"""Télécharge des hauts du jeu de données VITON-HD : photo produit ET masque de détourage exact.

VITON-HD (Choi et al., CVPR 2021, KAIST) fournit pour chaque haut une photo de face sur fond blanc
(768×1024) et son masque. Le masque évite le détourage approché (GrabCut) : c'est la raison d'utiliser ce
jeu de données plutôt que des photos de boutique. Licence : CC BY-NC 4.0 (usage non commercial, citation
de l'article et mention des modifications obligatoires) — voir README.md, section « Crédits ».

Usage (depuis n'importe quel dossier) :
    python tools/fetch_vitonhd.py 00311_00=pull-gris 01234_00=chemise-rayee ...

L'identifiant peut aussi être écrit comme dans le dépôt (cloth/00311_00.jpg). Le nom doit commencer par
une catégorie du catalogue (chemise, pull, tshirt, veste).

Sortie (jamais versionnée : raw-garments/ est dans .gitignore) :
    raw-garments/vitonhd/<nom>.jpg          photo
    raw-garments/vitonhd/masks/<nom>.jpg    masque (même nom : prepare_garments.py l'associe ainsi)
    raw-garments/vitonhd/sources.json       nom → identifiant VITON-HD + URL (traçabilité, crédits)
Étape suivante : python tools/prepare_garments.py raw-garments/vitonhd --source vitonhd --merge-catalog
"""
from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

import cv2
import numpy as np

BASE_URL = "https://huggingface.co/datasets/TryOnVirtual/VITON-HD-TEST/resolve/main"
CATEGORIES = ("chemise", "pull", "tshirt", "veste")
MIN_BYTES = 5_000  # une vraie photo 768×1024 pèse > 30 Ko ; en dessous : page d'erreur ou fichier tronqué
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "raw-garments" / "vitonhd"
# Nom de client générique : aucune information personnelle n'est envoyée au serveur.
HEADERS = {"User-Agent": "smartmirror-ar-tools/1.0"}

ID_RE = re.compile(r"^(?:.*/)?(\d{5}_\d{2})(?:\.jpg)?$")
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def parse_arg(arg: str) -> tuple[str, str]:
    """« cloth/00013_00.jpg=tshirt-rose » → ("00013_00", "tshirt-rose"). ValueError si mal formé."""
    if "=" not in arg:
        raise ValueError(f"« {arg} » : format attendu identifiant=nom (ex. 00311_00=pull-gris)")
    raw_id, name = (s.strip() for s in arg.split("=", 1))
    m = ID_RE.match(raw_id)
    if not m:
        raise ValueError(f"« {raw_id} » : identifiant VITON-HD attendu de la forme 00311_00")
    if not NAME_RE.match(name):
        raise ValueError(f"« {name} » : nom en minuscules, chiffres et tirets seulement")
    if name.split("-", 1)[0] not in CATEGORIES:
        raise ValueError(f"« {name} » : le nom doit commencer par une catégorie ({', '.join(CATEGORIES)})")
    return m.group(1), name


def urls(vid: str) -> tuple[str, str]:
    """URL de la photo et du masque d'un identifiant."""
    return f"{BASE_URL}/cloth/{vid}.jpg", f"{BASE_URL}/cloth-mask/{vid}.jpg"


def download(url: str) -> bytes:
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def check_image(data: bytes, what: str, gray: bool = False) -> np.ndarray:
    """Décode et vérifie une image téléchargée ; ValueError avec un message clair sinon."""
    if len(data) < MIN_BYTES:
        raise ValueError(f"{what} trop petit ({len(data)} octets) : fichier absent ou tronqué")
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE if gray else cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"{what} illisible (ce n'est pas une image)")
    return img


def fetch_one(vid: str, name: str, out_dir: Path) -> dict:
    """Télécharge et vérifie photo + masque, puis les enregistre. Rien n'est écrit si une vérification échoue."""
    photo_url, mask_url = urls(vid)
    photo = download(photo_url)
    mask = download(mask_url)
    p = check_image(photo, "photo")
    m = check_image(mask, "masque", gray=True)
    if p.shape[:2] != m.shape[:2]:
        raise ValueError(f"dimensions différentes : photo {p.shape[1]}×{p.shape[0]}, masque {m.shape[1]}×{m.shape[0]}")
    (out_dir / "masks").mkdir(parents=True, exist_ok=True)
    (out_dir / f"{name}.jpg").write_bytes(photo)
    (out_dir / "masks" / f"{name}.jpg").write_bytes(mask)
    return {"dataset": "VITON-HD", "id": vid, "photo": photo_url, "mask": mask_url,
            "size": [int(p.shape[1]), int(p.shape[0])]}


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1
    out_dir = OUT_DIR
    sources_path = out_dir / "sources.json"
    sources = json.loads(sources_path.read_text("utf-8")) if sources_path.exists() else {}
    ok, failed = 0, []
    for arg in argv:
        try:
            vid, name = parse_arg(arg)
        except ValueError as e:
            failed.append(str(e))
            print(f"✗ {e}")
            continue
        try:
            sources[name] = fetch_one(vid, name, out_dir)
            w, h = sources[name]["size"]
            print(f"✓ {name:28s} ← {vid}  ({w}×{h}, photo + masque)")
            ok += 1
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
            failed.append(f"{name} ({vid}) : {e}")
            print(f"✗ {name} ({vid}) : {e}")
    if ok:
        out_dir.mkdir(parents=True, exist_ok=True)
        sources_path.write_text(json.dumps(sources, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"\n{ok} vêtement(s) téléchargé(s) dans {out_dir.relative_to(ROOT)}, {len(failed)} échec(s).")
    return 0 if not failed else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
