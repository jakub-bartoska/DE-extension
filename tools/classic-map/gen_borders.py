#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_borders.py — Vygeneruje borders.png: overlay SKUTEČNÉ sítě hranic území pro
                 funkci „Zvýraznit hranice" v DE-extension.

Proč (2026-07-11):
  Obtahování jednotlivých polygonů z regions.json kreslí hranice 2× (sousedé se
  schválně o ~2px překrývají a každý má vlastní zjednodušený obrys — hrany NEJSOU
  sdílené). U neutrálů to navíc nejde srazit na jednu čáru (nemají výplň). Řešení:
  vzít JEDNU sdílenou síť hranic přímo z mapy — vyhrazená TYRKYSOVÁ (0,66,66) —
  stejný zdroj, ze kterého se generuje regions.json. Výsledek je jedna čára všude
  (i mezi neutrály), přesně po skutečné hranici.

Metoda (sdílená s regen_regions.py):
  teal -> dilatace + přemostění mezer (bridge_walls) -> + ruční magenta hranice
  (manual_borders.png, hory kde teal chybí) -> skeleton na 1px -> dilatace na ~2px
  -> RGBA PNG (černé čáry, průhledné pozadí), 2244x1542 = souř. systém regions.json.

Použití:
  python gen_borders.py            # vygeneruje borders.png + preview vedle sebe
  python gen_borders.py --deploy   # + zkopíruje do ../../ (kořen repa) a do
                                    #   Desktop/DE-extension-nahrat (načítací složka)

Závislosti: numpy, pillow, scipy, opencv-python-headless, scikit-image
"""
import os, sys, shutil
import numpy as np, cv2
from PIL import Image
from skimage.morphology import skeletonize

import regen_regions as R   # sdílený fetch_inputs / masks / bridge_walls

HERE   = os.path.dirname(os.path.abspath(__file__))
WORK   = os.path.join(HERE, "_regen_work")
REPO   = os.path.normpath(os.path.join(HERE, "..", ".."))
NAHRAT = os.path.join(os.path.expanduser("~"), "Desktop", "DE-extension-nahrat")
MANUAL = os.path.join(HERE, "manual_borders.png")

LINE_PX   = 3       # výsledná tloušťka čáry (px v systému 2244x1542); 3 = spolehlivě
                    # přkryje ≤2px zbytkový šum výplní (regions.json grow=0)
LINE_RGBA = (0, 0, 0, 210)   # černá, poloprůhledná


def get_full():
    """full_plain.png z cache (rychlé), jinak stáhnout spectator flow."""
    cached = os.path.join(WORK, "full_plain.png")
    if os.path.exists(cached):
        print(f"cache: {cached}")
        return Image.open(cached).convert("RGB")
    print("stahuji mapu (spectator flow)...")
    full, _html, _css = R.fetch_inputs()
    return full


def main():
    full = get_full()
    teal, sea = R.masks(full)
    wall = R.bridge_walls(teal, sea)          # bool, dilatovaná + přemostěná síť

    if os.path.exists(MANUAL):
        m = np.asarray(Image.open(MANUAL).convert("RGB")).astype(np.int16)
        mag = (m[..., 0] > 150) & (m[..., 1] < 110) & (m[..., 2] > 150)
        wall = wall | cv2.dilate(mag.astype("uint8"), np.ones((3, 3), "uint8"), 1).astype(bool)
        print(f"manual_borders.png: +{int(mag.sum())} magenta px")

    # normalizace tloušťky: skeleton na 1px, pak dilatace na LINE_PX
    skel = skeletonize(wall)
    if LINE_PX > 1:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (LINE_PX, LINE_PX))
        line = cv2.dilate(skel.astype("uint8"), k, 1).astype(bool)
    else:
        line = skel
    print(f"hranice: {int(line.sum())} px")

    H, W = line.shape
    rgba = np.zeros((H, W, 4), np.uint8)
    rgba[line] = LINE_RGBA
    out = os.path.join(HERE, "borders.png")
    Image.fromarray(rgba, "RGBA").save(out)
    print(f"OK -> {out}  ({W}x{H})")

    # preview přes mapu (jen pro kontrolu okem)
    base = np.asarray(full).astype(np.float32)
    al = (rgba[..., 3:4].astype(np.float32) / 255.0)
    prev = (base * (1 - al) + rgba[..., :3].astype(np.float32) * al).astype(np.uint8)
    Image.fromarray(prev, "RGB").save(os.path.join(HERE, "borders_preview.png"))
    print(f"preview -> {os.path.join(HERE, 'borders_preview.png')}")

    if "--deploy" in sys.argv:
        for d in (REPO, NAHRAT):
            if os.path.isdir(d):
                shutil.copy(out, os.path.join(d, "borders.png"))
                print(f"DEPLOY -> {os.path.join(d, 'borders.png')}")
            else:
                print(f"(přeskočeno, neexistuje) {d}")


if __name__ == "__main__":
    main()
