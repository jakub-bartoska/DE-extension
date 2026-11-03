#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
regen_grow.py — přegeneruje regiony s volitelným PŘEROSTEM (grow) polygonů, offline
z cache (_regen_work). Účel: sladit výplně s přesnou sítí hranic (borders.png).

Původní regen_regions.py nechá polygon přerůst 2px do sousedů (aby po zjednodušení
nebyly mezery). To ale posune barevnou hranici výplně ~2px za skutečnou čáru →
barva přeteče. S overlay hranic už přerost nepotřebujeme: grow=0 nechá hranu
polygonu na skutečné hranici (střed teal zdi), overlay případný ≤2px šum překryje.

python regen_grow.py [GROW]      # default GROW=0; zapíše regions_g{GROW}.json
python regen_grow.py 0 --deploy  # + nasadí do ../../ i Desktop/...-nahrat
"""
import os, sys, json, shutil
import numpy as np, cv2
from PIL import Image
import regen_regions as R

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "_regen_work")
REPO = R.REPO
NAHRAT = os.path.join(os.path.expanduser("~"), "Desktop", "DE-extension-nahrat")

GROW = int([a for a in sys.argv[1:] if a.isdigit() or (a[:1] == '-' and a[1:].isdigit())][0]) \
       if any(a.lstrip('-').isdigit() for a in sys.argv[1:]) else 0


def vectorize(labels, lab2id, grow):
    land_any = (labels > 0).astype('uint8'); K = np.ones((3, 3), 'uint8'); out = {}
    for L, ID in sorted(lab2id.items()):
        m = (labels == L).astype('uint8')
        if m.sum() == 0: continue
        g = (cv2.dilate(m, K, iterations=grow) & land_any) | m if grow > 0 else m
        cnts, _ = cv2.findContours(g, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts: continue
        ap = cv2.approxPolyDP(max(cnts, key=cv2.contourArea), 2.0, True).reshape(-1, 2)
        if len(ap) < 3: continue
        out[str(ID)] = " ".join(f"{int(x)},{int(y)}" for x, y in ap)
    return out


def main():
    full = Image.open(os.path.join(WORK, "full_plain.png")).convert("RGB")
    html = open(os.path.join(WORK, "map.html"), encoding="utf-8").read()
    css = open(os.path.join(WORK, "pos.css"), encoding="utf-8").read()
    seeds = R.build_seeds(html, css)
    teal, sea = R.masks(np.asarray(full) if False else full)  # masks bere PIL/np přes np.asarray
    wall = R.bridge_walls(teal, sea)
    if os.path.exists(R.MANUAL):
        m = np.asarray(Image.open(R.MANUAL).convert("RGB")).astype(np.int16)
        mag = (m[..., 0] > 150) & (m[..., 1] < 110) & (m[..., 2] > 150)
        wall = wall | cv2.dilate(mag.astype('uint8'), np.ones((3, 3), 'uint8'), 1).astype(bool)
    labels, lab2id = R.flood(wall, sea, seeds)
    new = vectorize(labels, lab2id, GROW)

    # revert stejně jako regen (s ručními hranicemi: seed mimo polygon / degenerát)
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
    print(f"grow={GROW}  zemí={len(final)}  revert={sorted(rev)}")

    outp = os.path.join(HERE, f"regions_g{GROW}.json")
    json.dump(final, open(outp, "w"), separators=(",", ":"))
    print(f"-> {outp}")
    if "--deploy" in sys.argv:
        for d in (REPO, NAHRAT):
            tgt = os.path.join(d, "regions.json")
            if os.path.exists(tgt) and not os.path.exists(tgt + ".pre_g.bak"):
                shutil.copy(tgt, tgt + ".pre_g.bak")
            json.dump(final, open(tgt, "w"), separators=(",", ":"))
            print(f"DEPLOY -> {tgt}")


if __name__ == "__main__":
    main()
