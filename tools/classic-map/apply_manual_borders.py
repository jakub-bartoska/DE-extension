#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
apply_manual_borders.py — Vezme ručně dokreslené hranice (MAGENTA čáry v
  EDIT_mapa.png) a přegeneruje regions.json. Magenta se přidá k tyrkysovým zdem,
  takže flood v problémových horských oblastech už neproteče.

Workflow:
  1) V `Desktop/DE-mapa-uprava/EDIT_mapa.png` (2244x1542) dokresli CHYBĚJÍCÍ
     hranice čistou MAGENTOU (255,0,255), tloušťka ~2-3 px. Ulož (přepiš soubor).
  2) python apply_manual_borders.py            # náhled, zapíše regions_new.json
     python apply_manual_borders.py --deploy   # + nasadí do ../../regions.json

Revert na starý polygon se přepočítává z metrik (ratio new/old, seed uvnitr) —
  co magentou uzavřeš, se přestane revertovat a použije se nová přesná hranice.

Barvy v EDIT_mapa.png: zelená = moje aktuální hranice (vodítko), oranžová =
  vyznačené problémové zóny. Ani jednu skript nečte — bere JEN magentu.

Závislosti jako regen_regions.py.
"""
import os, sys, json
import numpy as np, cv2
from PIL import Image
import regen_regions as R   # znovupoužití fetch/seeds/masks/bridge/flood/vectorize

EDIT = os.path.join(os.path.expanduser("~"), "Desktop", "DE-mapa-uprava", "EDIT_mapa.png")


def magenta_mask(path):
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    r, g, b = a[...,0], a[...,1], a[...,2]
    return (r > 150) & (g < 110) & (b > 150)   # tolerantní (přežije antialiasing štětce)


def main():
    if not os.path.exists(EDIT):
        print("CHYBA: nenašel jsem", EDIT); sys.exit(1)
    mag = magenta_mask(EDIT)
    print(f"magenta pixelů (ručně dokreslené hranice): {int(mag.sum())}")
    if mag.sum() == 0:
        print("Pozor: žádná magenta. Nejdřív do EDIT_mapa.png dokresli hranice (255,0,255) a ulož.")

    full, html, css = R.fetch_inputs()
    if full.size != (mag.shape[1], mag.shape[0]):
        print("CHYBA: EDIT_mapa.png má jiný rozměr než mapa", full.size, mag.shape); sys.exit(1)
    seeds = R.build_seeds(html, css)
    teal, sea = R.masks(full)
    wall = R.bridge_walls(teal, sea)
    wall = wall | cv2.dilate(mag.astype('uint8'), np.ones((3,3),'uint8'), 1).astype(bool)  # + ruční zdi

    labels, lab2id = R.flood(wall, sea, seeds)
    new = R.vectorize(labels, lab2id)

    # revert z metrik (co je uzavřené magentou, projde a použije new)
    old_path = os.path.join(R.REPO, "regions.json")
    old = json.load(open(old_path)) if os.path.exists(old_path) else {}
    def poly(s): return [tuple(map(float, p.split(','))) for p in s.split()]
    def area(s): return cv2.contourArea(np.array(poly(s), np.float32))
    def inside(pt, pl):
        x, y = pt; n = len(pl); ins = False; j = n-1
        for i in range(n):
            xi, yi = pl[i]; xj, yj = pl[j]
            if ((yi>y)!=(yj>y)) and (x < (xj-xi)*(y-yi)/(yj-yi+1e-9)+xi): ins = not ins
            j = i
        return ins
    # Uživatel dodal ruční hranice (magenta) = ground truth -> věř NOVÉ verzi.
    # Revert na starou jen když je nová evidentně rozbitá: seed vypadl z polygonu
    # nebo je polygon degenerovaný (tiny). Plochu vs stará (nepřesná) NEřešit.
    final = dict(new); reverted = []
    for k in new:
        if k not in old: continue
        na = area(new[k]); i = int(k); sx, sy = seeds.get(i, (None, None))
        seedout = (sx is not None) and not inside((sx+10, sy+10), poly(new[k]))
        if seedout or na < 300:
            final[k] = old[k]; reverted.append(k)
    print(f"regiony: {len(final)}  revert na staré (nedovřené): {len(reverted)} {sorted(reverted)}")

    outp = os.path.join(R.HERE, "regions_new.json")
    json.dump(final, open(outp, "w"), separators=(",", ":"))
    print("zapsáno", outp)
    if "--deploy" in sys.argv:
        json.dump(final, open(old_path, "w"), separators=(",", ":"))
        load = os.path.join(os.path.expanduser("~"), "Desktop", "DE-extension-nahrat", "regions.json")
        if os.path.exists(os.path.dirname(load)):
            json.dump(final, open(load, "w"), separators=(",", ":"))
        print("NASAZENO do repo i nahrávací složky")


if __name__ == "__main__":
    main()
