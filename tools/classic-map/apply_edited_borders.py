#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
apply_edited_borders.py — vezme ručně UPRAVENOU mapu s červenými hranicemi a
přegeneruje z ní OBOJÍ: borders.png (overlay) + regions.json (tvary zemí).

Vstup: mapa 2244×1542 s hranicemi kreslenými ČERVENĚ (255,0,0) — uživatel upravil
`borders_over_mapa.png`/`borders_edit.png`. Červená = síť hranic (jediný zdroj
pravdy). Seedy vlajek a moře se berou z cache (_regen_work) — stejný souřadný
systém.

Metoda: červená → skeleton (1px) → despeckle → jako ZDI pro geodezický flood ze
seedů (R.flood) → vektorizace grow=0 (hrany na skutečné hranici) → regions.json;
borders.png = dilatace skeletonu na LINE_PX.

Použití:
  python apply_edited_borders.py <edited.gif|png> [--deploy]
Závislosti: numpy, pillow, scipy, opencv-python-headless, scikit-image
"""
import os, sys, json, shutil
import numpy as np, cv2
from scipy import ndimage as ndi
from skimage.morphology import skeletonize
from PIL import Image
import regen_regions as R

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "_regen_work")
REPO = R.REPO
NAHRAT = os.path.join(os.path.expanduser("~"), "Desktop", "DE-extension-nahrat")
LINE_PX = 3
MIN_COMP = 6           # menší souvislé kousky červené = šum → pryč


def compute_sea(full):
    # Jako R.masks, ALE maska vody navíc `r<120` → vyloučí severní SNÍH/LED (198,198,255),
    # který se jinak bere jako moře a ukusuje nejsevernější země (355/358/413). Oceán má
    # r=0, sníh r≈198 → r<120 oceán nechá, sníh ne.
    p = np.asarray(full).astype(np.int16)
    r, g, b = p[..., 0], p[..., 1], p[..., 2]
    water = (b > 140) & (b >= r + 30) & (b >= g + 10) & (r < 120)
    lbl, n = ndi.label(water); sea = np.zeros_like(water)
    bids = set(lbl[0, :]) | set(lbl[-1, :]) | set(lbl[:, 0]) | set(lbl[:, -1])
    sizes = ndi.sum(np.ones_like(lbl), lbl, range(1, n + 1))
    for i in range(1, n + 1):
        if i in bids or sizes[i - 1] > 10000: sea |= (lbl == i)
    return sea


def red_skeleton(path):
    m = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    r, g, b = m[..., 0], m[..., 1], m[..., 2]
    red = (r > 170) & (g < 90) & (b < 90)
    sk = skeletonize(red)
    # despeckle: zahoď malé komponenty (šum z ikon)
    lbl, n = ndi.label(sk, structure=np.ones((3, 3)))
    if n:
        sizes = ndi.sum(np.ones_like(lbl), lbl, range(1, n + 1))
        keep = np.zeros(n + 1, bool)
        for i in range(1, n + 1):
            keep[i] = sizes[i - 1] >= MIN_COMP
        sk = keep[lbl]
    return sk


def vectorize(labels, lab2id):
    land_any = (labels > 0).astype('uint8'); out = {}
    for L, ID in sorted(lab2id.items()):
        m = (labels == L).astype('uint8')
        if m.sum() == 0: continue
        cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts: continue
        ap = cv2.approxPolyDP(max(cnts, key=cv2.contourArea), 2.0, True).reshape(-1, 2)
        if len(ap) < 3: continue
        out[str(ID)] = " ".join(f"{int(x)},{int(y)}" for x, y in ap)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print("Zadej cestu k upravené mapě."); return
    edited = args[0]

    full = Image.open(os.path.join(WORK, "full_plain.png")).convert("RGB")
    html = open(os.path.join(WORK, "map.html"), encoding="utf-8").read()
    css = open(os.path.join(WORK, "pos.css"), encoding="utf-8").read()
    seeds = R.build_seeds(html, css)
    sea = compute_sea(full)   # s fixem na severní sníh (viz compute_sea)

    sk = red_skeleton(edited)
    print(f"skeleton hranic: {int(sk.sum())} px")
    wall = cv2.dilate(sk.astype('uint8'), np.ones((3, 3), 'uint8'), 1).astype(bool)  # 1px → zavři mezírky

    labels, lab2id = R.flood(wall, sea, seeds)
    new = vectorize(labels, lab2id)

    # revert: věř nové verzi (edit = ground truth); starý polygon jen když seed
    # vypadne z nového polygonu nebo je degenerovaný
    old = json.load(open(os.path.join(REPO, "regions.json")))
    final = dict(new)
    def poly(s): return [tuple(map(float, p.split(','))) for p in s.split()]
    def area(s): return cv2.contourArea(np.array(poly(s), np.float32))
    def inside(pt, pl):
        x, y = pt; n = len(pl); ins = False; j = n - 1
        for i in range(n):
            xi, yi = pl[i]; xj, yj = pl[j]
            if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi): ins = not ins
            j = i
        return ins
    rev = []
    for k in new:
        if k not in old: continue
        i = int(k); sx, sy = seeds.get(i, (None, None))
        if (sx is not None and not inside((sx + 10, sy + 10), poly(new[k]))) or area(new[k]) < 300:
            final[k] = old[k]; rev.append(k)
    print(f"zemí={len(final)}  revert(nedovřené)={sorted(rev)}")

    # borders.png overlay z upravené sítě
    line = cv2.dilate(sk.astype('uint8'), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (LINE_PX, LINE_PX)), 1).astype(bool)
    H, W = sk.shape
    rgba = np.zeros((H, W, 4), np.uint8); rgba[line] = (0, 0, 0, 210)

    reg_out = os.path.join(HERE, "regions_edited.json")
    json.dump(final, open(reg_out, "w"), separators=(",", ":"))
    Image.fromarray(rgba, "RGBA").save(os.path.join(HERE, "borders.png"))
    print(f"-> {reg_out} + borders.png")

    if "--deploy" in sys.argv:
        for d in (REPO, NAHRAT):
            rt = os.path.join(d, "regions.json")
            if os.path.exists(rt) and not os.path.exists(rt + ".pre_edit.bak"):
                shutil.copy(rt, rt + ".pre_edit.bak")
            json.dump(final, open(rt, "w"), separators=(",", ":"))
            shutil.copy(os.path.join(HERE, "borders.png"), os.path.join(d, "borders.png"))
            print(f"DEPLOY -> {d}")


if __name__ == "__main__":
    main()
