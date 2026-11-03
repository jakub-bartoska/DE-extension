#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
regen_regions.py  —  Regeneruje regions.json v koreni repa (431 polygonů zemí) z
                     TAKTICKÉ mapy darkelf.cz.

Proč tahle verze (2026-07-06):
  Původní pipeline bral jako "zeď" VŠECHNY tmavé pixely staré grafiky, takže
  dekorace (hrady/hory = "maluvky") pletl do hranic -> watershed odhadoval ->
  velké nepřesnosti a špatné sousednosti.

Klíčové zjištění:
  * Hranice území jsou kreslené vyhrazenou barvou  TYRKYSOVÁ (0,66,66).
    Dekorace používají ČERNÉ obrysy (0,0,0). => filtr jen na tyrkysovou dá
    dokonale čistou síť hranic BEZ dekorací.
  * plain dlaždice `mapa1_N.gif` a detailní `mapa1_Nh.gif` mají hranice na
    PIXEL stejné (ověřeno). Pro extrakci se bere plain (čistší, míň šumu).
  * Seedy (1 na zemi) = středy vlajek z `css/de-mapa1high.css` (#x<id>{top;left},
    relativní k buňce position_xC_yR) + offset dlaždice ((C-1)*748,(R-1)*514) +
    ~(10,10) na střed vlajky. 428/431 padne do svého starého polygonu -> souřadný
    systém = systém regions.json (identita).

Metoda:
  teal -> dilatace 1px -> přemostění mezer (skeleton endpointy do 34px) -> zdi.
  moře = modrá voda napojená na okraj / plocha>10000. land = ~wall & ~sea.
  Uniformní geodezická BFS z vlajkových seedů (NE priority-flood: elevace
  zvýhodňuje centrální seedy a dělá slivery). Zdi/mezery dovyplnit nejbližším
  labelem. Vektorizace: dilatace 2px do souše (překryv přežije approxPolyDP) +
  approxPolyDP(eps=2).

Hybrid revert: v hornatých oblastech tyrkysová hranice fyzicky chybí (hora ji
  překrývá) -> flood proteče. Pro ~9 zemí (ratio new/old >1.5 nebo <0.5 nebo seed
  mimo nový polygon) se vezme STARÝ polygon (měl správnou topologii). Seznam
  REVERT níže; při jiném stavu mapy ho přepočítat z metrik.

Použití:
  python regen_regions.py            # stáhne, vygeneruje regions_new.json vedle sebe
  python regen_regions.py --deploy   # + zapíše do ../../regions.json (zálohuje)

Závislosti: numpy, pillow, scipy, opencv-python-headless, scikit-image
"""
import os, re, sys, json, urllib.request, http.cookiejar
from collections import deque
import numpy as np, cv2
from scipy import ndimage as ndi
from PIL import Image

LIGA   = "1"
TW, TH = 748, 514            # rozměr dlaždice; mřížka 3x3 = 2244x1542
HERE   = os.path.dirname(os.path.abspath(__file__))
WORK   = os.path.join(HERE, "_regen_work")
REPO   = os.path.normpath(os.path.join(HERE, "..", ".."))
MANUAL = os.path.join(HERE, "manual_borders.png")   # durable magenta ruční hranice (viz apply_manual_borders.py)
# Fallback revert set, když NEJSOU ruční hranice (manual_borders.png). S ručními
# hranicemi se revert počítá dynamicky (jen seed mimo polygon / degenerát) a
# reálně zbývají jen 355,358,413 (nejsevernější hory).
REVERT = {"288","66","92","136","278","382","358","413","355"}


def opener():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    op.addheaders = [('User-Agent','Mozilla/5.0'),
                     ('Referer','https://www.darkelf.cz/map_new.asp')]
    # spectator flow (pořadí povinné, viz memory darkelf-mapa-scraping)
    op.open(f"https://www.darkelf.cz/login.asp?l={LIGA}")
    op.open(f"https://www.darkelf.cz/nalogovan.asp?l={LIGA}")
    op.open("https://www.darkelf.cz/mapa.asp?vse=1")
    return op


def fetch_inputs():
    os.makedirs(WORK, exist_ok=True)
    op = opener()
    # plain dlaždice -> full_plain.png
    full = Image.new("RGB", (TW*3, TH*3))
    for n in range(1, 10):
        data = op.open(f"https://www.darkelf.cz/images/mapy/mapa1_{n}.gif").read()
        p = os.path.join(WORK, f"t{n}.gif"); open(p, "wb").write(data)
        c, r = (n-1) % 3, (n-1)//3
        full.paste(Image.open(p).convert("RGB"), (c*TW, r*TH))
    full.save(os.path.join(WORK, "full_plain.png"))
    # map HTML (land -> cell) a CSS (lokální pozice vlajek)
    html = op.open("https://www.darkelf.cz/mapa.asp?vse=1").read().decode("windows-1250","replace")
    css  = op.open("https://www.darkelf.cz/css/de-mapa1high.css").read().decode("windows-1250","replace")
    open(os.path.join(WORK,"map.html"),"w",encoding="utf-8").write(html)
    open(os.path.join(WORK,"pos.css"),"w",encoding="utf-8").write(css)
    return full, html, css


def build_seeds(html, css):
    # land -> buňka (C,R) v pořadí dokumentu
    land_cell, cur = {}, None
    for px, py, xid in re.findall(r"id='position_x(\d)_y(\d)'|<div id='x(\d+)' class='land'", html):
        if px: cur = (int(px), int(py))
        elif xid: land_cell[int(xid)] = cur
    loc = {int(i): (int(l), int(t)) for i, t, l in
           re.findall(r"#x(\d+)\s*\{[^}]*top:\s*(-?\d+)px;\s*left:\s*(-?\d+)px", css)}
    seeds = {}
    for i, (C, R) in land_cell.items():
        if i in loc:
            lx, ly = loc[i]
            seeds[i] = ((C-1)*TW + lx, (R-1)*TH + ly)   # + (10,10) střed až při floodu
    return seeds


def masks(full):
    p = np.asarray(full).astype(np.int16)
    r, g, b = p[...,0], p[...,1], p[...,2]
    teal = (r<40)&(g>40)&(g<95)&(b>40)&(b<95)             # vyhrazená barva hranic
    water = (b>140)&(b>=r+30)&(b>=g+10)
    lbl, n = ndi.label(water); sea = np.zeros_like(water)
    bids = set(lbl[0,:])|set(lbl[-1,:])|set(lbl[:,0])|set(lbl[:,-1])
    sizes = ndi.sum(np.ones_like(lbl), lbl, range(1, n+1))
    for i in range(1, n+1):
        if i in bids or sizes[i-1] > 10000: sea |= (lbl == i)
    return teal, sea


def bridge_walls(teal, sea):
    from skimage.morphology import skeletonize
    from scipy.spatial import cKDTree
    H, W = teal.shape
    sk = skeletonize(teal)
    nb = cv2.filter2D(sk.astype(np.uint8), -1, np.ones((3,3),np.uint8)) - sk.astype(np.uint8)
    eps = [(y,x) for y,x in np.argwhere(sk & (nb == 1))
           if not (y<6 or x<6 or y>H-7 or x>W-7)]          # ignoruj okraj mapy
    wall = cv2.dilate(teal.astype('uint8'), np.ones((3,3),np.uint8), 1)
    if len(eps) >= 2:
        P = np.array(eps); tree = cKDTree(P)
        d, idx = tree.query(P, k=2); used = set()
        for i in np.argsort(d[:,1]):
            j = idx[i,1]
            if i in used or j in used or d[i,1] > 34: continue
            y0,x0 = P[i]; y1,x1 = P[j]
            ys = np.linspace(y0,y1,20).astype(int); xs = np.linspace(x0,x1,20).astype(int)
            if sea[ys,xs].mean() > 0.2: continue           # nemostit přes moře
            cv2.line(wall, (int(x0),int(y0)), (int(x1),int(y1)), 1, 2)
            used.add(i); used.add(j)
    return wall.astype(bool)


def flood(wall, sea, seeds):
    H, W = wall.shape
    land = (~wall) & (~sea); landf = land.ravel()
    id_list = sorted(seeds); id2lab = {i: k+1 for k, i in enumerate(id_list)}
    lab2id = {v: k for k, v in id2lab.items()}
    labels = np.zeros(H*W, np.int32)
    def nudge(x, y):
        for rad in range(0, 25):
            for dx in range(-rad, rad+1):
                for dy in range(-rad, rad+1):
                    xx, yy = x+dx, y+dy
                    if 0 <= xx < W and 0 <= yy < H and land[yy, xx]: return xx, yy
        return x, y
    q = deque()
    for i, (x, y) in seeds.items():
        xx, yy = nudge(x+10, y+10); idx = yy*W+xx
        if labels[idx] == 0: labels[idx] = id2lab[i]; q.append(idx)
    while q:                                               # uniformní BFS (bez elevace!)
        idx = q.popleft(); l = labels[idx]; x = idx % W
        for j, ok in ((idx-1, x>0), (idx+1, x<W-1), (idx-W, idx-W>=0), (idx+W, idx+W<H*W)):
            if ok and labels[j] == 0 and landf[j]: labels[j] = l; q.append(j)
    labels = labels.reshape(H, W)
    tofill = (labels == 0) & (~sea)
    if tofill.any():
        _, (iy, ix) = ndi.distance_transform_edt(labels == 0, return_indices=True)
        labels = np.where(tofill, labels[iy, ix], labels)
    return labels, lab2id


def vectorize(labels, lab2id):
    land_any = (labels > 0).astype('uint8'); K = np.ones((3,3),'uint8'); out = {}
    for L, ID in sorted(lab2id.items()):
        m = (labels == L).astype('uint8')
        if m.sum() == 0: continue
        grown = (cv2.dilate(m, K, iterations=2) & land_any) | m
        cnts, _ = cv2.findContours(grown, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts: continue
        ap = cv2.approxPolyDP(max(cnts, key=cv2.contourArea), 2.0, True).reshape(-1, 2)
        if len(ap) < 3: continue
        out[str(ID)] = " ".join(f"{int(x)},{int(y)}" for x, y in ap)
    return out


def main():
    full, html, css = fetch_inputs()
    seeds = build_seeds(html, css)
    teal, sea = masks(full)
    wall = bridge_walls(teal, sea)
    # ruční hranice (magenta) jako dodatečné zdi, pokud existují
    has_manual = os.path.exists(MANUAL)
    if has_manual:
        m = np.asarray(Image.open(MANUAL).convert("RGB")).astype(np.int16)
        mag = (m[...,0] > 150) & (m[...,1] < 110) & (m[...,2] > 150)
        wall = wall | cv2.dilate(mag.astype('uint8'), np.ones((3,3),np.uint8), 1).astype(bool)
        print(f"manual_borders.png: {int(mag.sum())} magenta px přidáno ke zdem")
    labels, lab2id = flood(wall, sea, seeds)
    new = vectorize(labels, lab2id)

    old_path = os.path.join(REPO, "regions.json")
    old = json.load(open(old_path)) if os.path.exists(old_path) else {}
    final = dict(new)
    if has_manual:
        # ground truth -> věř nové verzi; revert jen když seed vypadne / degenerát
        def poly(s): return [tuple(map(float, p.split(','))) for p in s.split()]
        def area(s): return cv2.contourArea(np.array(poly(s), np.float32))
        def inside(pt, pl):
            x, y = pt; n = len(pl); ins = False; j = n-1
            for i in range(n):
                xi, yi = pl[i]; xj, yj = pl[j]
                if ((yi>y)!=(yj>y)) and (x < (xj-xi)*(y-yi)/(yj-yi+1e-9)+xi): ins = not ins
                j = i
            return ins
        rev = []
        for k in new:
            if k not in old: continue
            i = int(k); sx, sy = seeds.get(i, (None, None))
            if (sx is not None and not inside((sx+10, sy+10), poly(new[k]))) or area(new[k]) < 300:
                final[k] = old[k]; rev.append(k)
        print(f"revert (nedovřené): {sorted(rev)}")
    else:
        for k in REVERT:
            if k in old: final[k] = old[k]
        print(f"bez ručních hranic -> fixní REVERT set: {sorted(REVERT)}")
    outp = os.path.join(HERE, "regions_new.json")
    json.dump(final, open(outp, "w"), separators=(",", ":"))
    print(f"OK: {len(final)} zemí -> {outp}")
    if "--deploy" in sys.argv and os.path.exists(old_path):
        if not os.path.exists(old_path + ".bak"):
            os.replace(old_path, old_path + ".bak"); json.dump(old, open(old_path+".bak","w"))
        json.dump(final, open(old_path, "w"), separators=(",", ":"))
        print(f"DEPLOY -> {old_path}")


if __name__ == "__main__":
    main()
