#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_adjacency.py — Spočítá sousednost zemí z regions.json (sdílené hranice
  polygonů) → adjacency.json {id: [id_souseda, ...]}.

Metoda: zrastruje polygony do label-mapy (2244×1542, fillPoly label=index+1),
  projde 4-sousednosti pixelů; dvojice různých labelů = sdílená hranice, počítá
  se délka. Sousedi = dvojice se sdílenou hranicí ≥ MIN_BORDER px (odfiltruje
  dotyk rohem). Souřadný systém regions.json = plné rozlišení (viz [[darkelf-extension]]).

Použití: python compute_adjacency.py [--deploy]   (--deploy zapíše do ../../ i nahrávací složky)
"""
import os, sys, json
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
LOAD = os.path.join(os.path.expanduser("~"), "Desktop", "DE-extension-nahrat")
W, H = 2244, 1542
MIN_BORDER = 8   # min. délka sdílené hranice v px, aby to byl soused

def main():
    reg = json.load(open(os.path.join(REPO, "regions.json"), encoding="utf-8"))
    ids = list(reg.keys())
    lab = np.zeros((H, W), np.int32)
    for i, k in enumerate(ids, start=1):
        pts = np.array([[int(x), int(y)] for x, y in (p.split(",") for p in reg[k].split())], np.int32)
        cv2.fillPoly(lab, [pts], i)  # překryv polygonů: pozdější přepíše — ok, hranice zůstane
    # počítej sdílené hranice mezi 4-sousedy
    from collections import Counter
    pairs = Counter()
    def scan(a, b):
        m = (a > 0) & (b > 0) & (a != b)
        for x, y in zip(a[m].tolist(), b[m].tolist()):
            pairs[(min(x, y), max(x, y))] += 1
    scan(lab[:, :-1], lab[:, 1:])   # horizontální sousedi
    scan(lab[:-1, :], lab[1:, :])   # vertikální sousedi
    adj = {k: set() for k in ids}
    for (a, b), n in pairs.items():
        if n >= MIN_BORDER:
            adj[ids[a - 1]].add(ids[b - 1]); adj[ids[b - 1]].add(ids[a - 1])
    out = {k: sorted(v, key=int) for k, v in adj.items()}
    degs = [len(v) for v in out.values()]
    print(f"zemí {len(out)}, průměr sousedů {sum(degs)/len(degs):.1f}, min {min(degs)}, max {max(degs)}, bez souseda {sum(1 for d in degs if d==0)}")
    path = os.path.join(HERE, "adjacency.json")
    json.dump(out, open(path, "w"), separators=(",", ":"))
    print("zapsáno", path, os.path.getsize(path), "B")
    if "--deploy" in sys.argv:
        for base in [REPO, LOAD]:
            if os.path.isdir(base):
                json.dump(out, open(os.path.join(base, "adjacency.json"), "w"), separators=(",", ":"))
                print("deploy →", base)

if __name__ == "__main__":
    main()
