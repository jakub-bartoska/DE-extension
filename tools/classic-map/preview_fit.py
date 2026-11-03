#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
preview_fit.py — kontrolní náhled: sedí výplně (regions.json) na síť hranic
(borders.png)? Vykreslí sousední země různými barvami přes mapu + overlay hranic,
takže „přelezení" = barva přeteče přes černou čáru do souseda.

Volitelně vyzkouší ZÚŽENÍ polygonů dovnitř (inset) — reverz ~2px přerostu, který
způsobuje overflow. Vytvoří náhledy pro víc hodnot insetu na porovnání.

Použití: python preview_fit.py
Výstup: _regen_work/fit_inset{N}.png pro N v INSETS.
"""
import os, json
import numpy as np, cv2
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "_regen_work")
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
MAP_W, MAP_H = 2244, 1542
INSETS = [0, 2, 3]     # px zúžení dovnitř na vyzkoušení

# pár výrazných barev na odlišení sousedů
COLORS = [(230,25,75),(60,180,75),(0,130,200),(245,130,48),
          (145,30,180),(70,240,240),(240,50,230),(255,225,25)]


def poly_pts(s):
    return np.array([[int(a) for a in p.split(",")] for p in s.split()], np.int32)


def inset_poly(pts, inset):
    if inset <= 0:
        return pts
    x0, y0 = pts.min(0) - (inset + 2)
    x1, y1 = pts.max(0) + (inset + 2)
    w, h = int(x1 - x0), int(y1 - y0)
    if w <= 0 or h <= 0:
        return None
    m = np.zeros((h, w), np.uint8)
    cv2.fillPoly(m, [pts - [x0, y0]], 255)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * inset + 1, 2 * inset + 1))
    er = cv2.erode(m, k)
    cnts, _ = cv2.findContours(er, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    ap = cv2.approxPolyDP(max(cnts, key=cv2.contourArea), 1.5, True).reshape(-1, 2)
    if len(ap) < 3:
        return None
    return ap + [x0, y0]


def main():
    regions = json.load(open(os.path.join(REPO, "regions.json")))
    base = np.asarray(Image.open(os.path.join(WORK, "full_plain.png")).convert("RGB")).astype(np.float32)
    borders = np.asarray(Image.open(os.path.join(HERE, "borders.png")).convert("RGBA"))
    bmask = borders[..., 3:4].astype(np.float32) / 255.0
    bcol = borders[..., :3].astype(np.float32)

    ids = sorted(regions, key=lambda k: int(k))
    for inset in INSETS:
        fill = np.zeros((MAP_H, MAP_W, 3), np.float32)
        alpha = np.zeros((MAP_H, MAP_W, 1), np.float32)
        dropped = 0
        for i, k in enumerate(ids):
            pts = poly_pts(regions[k])
            ip = inset_poly(pts, inset)
            if ip is None:
                dropped += 1
                continue
            m = np.zeros((MAP_H, MAP_W), np.uint8)
            cv2.fillPoly(m, [ip.astype(np.int32)], 255)
            mb = m.astype(bool)
            fill[mb] = COLORS[i % len(COLORS)]
            alpha[mb] = 0.6
        img = base * (1 - alpha) + fill * alpha            # výplně přes mapu
        img = img * (1 - bmask) + bcol * bmask             # hranice navrch
        out = os.path.join(WORK, f"fit_inset{inset}.png")
        Image.fromarray(img.astype(np.uint8), "RGB").save(out)
        print(f"inset {inset}px: dropped {dropped} -> {out}")


if __name__ == "__main__":
    main()
