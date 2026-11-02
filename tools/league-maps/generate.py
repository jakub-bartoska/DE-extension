"""Generátor obrysů zemí pro mapu K ligy (a dalších lig) z TAKTICKÉ grafiky (dlaždice mapaK1_<n>s.gif).

python generate.py full_s.png seeds.txt outdir [fixes.txt]
  full_s.png = slepená taktická mapa (3×3 dlaždice 748×514)
  seeds.txt  = "id:x,y,w,h ..." (pozice div.land v souřadnicích mřížky)
  fixes.txt  = ruční opravy, řádky:
                 seed <id> <x> <y>   další semínko země (např. druhý břeh řeky)
                 void <x> <y>        místo, které nepatří žádné zemi
                 move <id> <x> <y>   přesunout hlavní semínko (tlačítko země leží mimo ni)
                 line x1 y1 x2 y2 …  dokreslit hranici (lomená čára)
                 hardbox x0 y0 x1 y1 v obdélníku jsou čáry taktické mapy neprůchodné
                 lineowner x0 y0 x1 y1 A B  pixely čar v obdélníku mezi zeměmi A a B dostane A
                                     (hranice pak vede po okraji čáry na straně B)
Výstup: regions.json, borders.png, check.png
"""
import sys, os, json, numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi
from skimage.segmentation import watershed

full, seedsf, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
fixesf = sys.argv[4] if len(sys.argv) > 4 else None
a = np.array(Image.open(full).convert('RGB')).astype(int)
H, W, _ = a.shape
r, g, b = a[..., 0], a[..., 1], a[..., 2]
mx, mn = a.max(2), a.min(2)

seeds = {}
for tok in open(seedsf).read().split():
    k, v = tok.split(':')
    x, y, w, h = map(int, v.split(','))
    seeds[int(k)] = [(min(x + w // 2, W - 1), min(y + h // 2, H - 1))]
voids, flines, fixseeds, hboxes, owners = [], [], [], [], []
if fixesf and os.path.exists(fixesf):
    for ln in open(fixesf, encoding='utf8'):
        t = ln.split('#')[0].split()
        if not t: continue
        if t[0] == 'seed':
            seeds[int(t[1])].append((int(t[2]), int(t[3]))); fixseeds.append((int(t[1]), int(t[2]), int(t[3])))
        elif t[0] == 'void': voids.append((int(t[1]), int(t[2])))
        elif t[0] == 'move': seeds[int(t[1])][0] = (int(t[2]), int(t[3]))
        elif t[0] == 'hardbox': hboxes.append(tuple(map(int, t[1:5])))
        elif t[0] == 'lineowner': owners.append(tuple(map(int, t[1:7])))
        elif t[0] == 'line':
            q = list(map(int, t[1:])); flines.append(list(zip(q[0::2], q[1::2])))
ids = sorted(seeds)
idx = {k: i + 1 for i, k in enumerate(ids)}
VOID = len(ids) + 1

line = (mx - mn <= 10) & (mx <= 48)                    # černé hranice
# hranice z původní grafiky (vedou i přes hory, kde je taktická mapa nekreslí)
if os.environ.get('ORIG'):
    o = np.array(Image.open(os.environ['ORIG']).convert('RGB')).astype(int)
    omx, omn = o.max(2), o.min(2)
    oline = (omx - omn <= 12) & (omx <= 45)
    # jen tenké čáry: ikony (velké tmavé plochy) vynechat
    oline &= ~cv2.morphologyEx(oline.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)).astype(bool)
    # v hardboxech jen čáry taktické mapy (původní grafika tam má hradby a střechy → klikatá hranice)
    for (bx0, by0, bx1, by1) in hboxes:
        oline[by0:by1, bx0:bx1] = False
    line |= oline
river = (b > r + 25) & (b > g + 10)                    # řeky
_rl, _rn = ndi.label(river, np.ones((3, 3)))
_rs = np.bincount(_rl.ravel()); _rs[0] = 0
river = (_rs >= 600)[_rl]                              # bez malých modrých ikon (portály)
river = cv2.dilate(river.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
hard = np.zeros((H, W), np.uint8)                      # ručně dokreslené hranice (neprůchodné)
for pl in flines:
    cv2.polylines(hard, [np.array(pl, np.int32)], False, 1, 1)
hard = hard.astype(bool)
line |= hard
manual = hard.copy()
# v boxu jsou čáry taktické mapy zdí (rozšířené o 1 px, ať se zavřou drobné mezery)
_thick = cv2.dilate((line & ~river).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
for (bx0, by0, bx1, by1) in hboxes:
    hard[by0:by1, bx0:bx1] |= _thick[by0:by1, bx0:bx1]
icon = (mx - mn <= 14) & (mx > 48)                     # šedé budovy, mosty
bar0 = line | river | icon

# divočina (velké plochy bez semínka) se počítá bez zdí z hardboxů
ncomp, comp = cv2.connectedComponents((~bar0).astype(np.uint8), connectivity=4)
sizes = np.bincount(comp.ravel())
_, (iy, ix) = ndi.distance_transform_edt(bar0, return_indices=True)
def snap(x, y): return int(ix[y, x]), int(iy[y, x])
seeded0 = {comp[snap(x, y)[1], snap(x, y)[0]] for k in ids for (x, y) in seeds[k]}
BIG = int(os.environ.get('BIG', '1500'))
voidc = np.zeros(ncomp, bool)
for c in range(1, ncomp):
    if c not in seeded0 and sizes[c] > BIG: voidc[c] = True
for (x, y) in voids:
    sx, sy = snap(x, y); voidc[comp[sy, sx]] = True
wild = voidc[comp] & (comp > 0)
comp0, sizes0 = comp, sizes

# komponenty pro semínka – i se zdmi z hardboxů
bar = bar0 | hard
ncomp, comp = cv2.connectedComponents((~bar).astype(np.uint8), connectivity=4)
sizes = np.bincount(comp.ravel())
_, (iy, ix) = ndi.distance_transform_edt(bar, return_indices=True)
seedcomp = {}
for k in ids:
    for (x, y) in seeds[k]:
        sx, sy = snap(x, y)
        if not wild[sy, sx]: seedcomp.setdefault(comp[sy, sx], set()).add(k)

# watershed nad vzdáleností od hranic; komponenta s jediným semínkem = celý marker
DARK = int(os.environ.get('DARK', '66'))
dark = (mx <= DARK) & ~line                            # horské hřebeny (hranice tam nejsou kreslené)
D = ndi.gaussian_filter(ndi.distance_transform_edt(~(bar | dark)), 1.0)
markers = np.zeros((H, W), np.int32)
markers[river | wild] = VOID
multi = []
for c, ks in seedcomp.items():
    if c == 0: continue
    if len(ks) == 1:
        markers[comp == c] = idx[next(iter(ks))]
    else:
        multi.append(sorted(ks))
        for k in ks:
            for (x, y) in seeds[k]:
                sx, sy = snap(x, y)
                if comp[sy, sx] != c: continue
                # okolí semínka do 25 px, které nepřekročí hranici
                x0, y0 = max(sx - 25, 0), max(sy - 25, 0)
                sub = (comp[y0:sy + 26, x0:sx + 26] == c).astype(np.uint8)
                disk = np.zeros_like(sub); cv2.circle(disk, (sx - x0, sy - y0), 25, 1, -1)
                lb, _ = ndi.label(sub & disk)
                reg = lb == lb[sy - y0, sx - x0]
                mk = markers[y0:sy + 26, x0:sx + 26]
                mk[reg & (mk == 0)] = idx[k]
markers[bar & (markers != VOID)] = 0
for k, x, y in fixseeds:                               # ruční semínko má přednost i před řekou
    fm = np.zeros((H, W), np.uint8); cv2.circle(fm, (x, y), 5, 1, -1)
    markers[fm.astype(bool) & ~hard] = idx[k]
lab = watershed(-D, markers, mask=~hard)
# 2. kolo: pruhy bez semínka uzavřené zdmi z hardboxů dovyplnit (přes čáry, ne přes ruční čáry)
if hboxes:
    m2 = lab.copy(); m2[(river | wild) & (m2 == 0)] = VOID
    lab = watershed(-D, m2, mask=~manual)
    lab[lab == VOID] = 0
    _d, (_jy, _jx) = ndi.distance_transform_edt(lab == 0, return_indices=True)
    _f = (lab == 0) & (_d <= 2) & hard & ~manual
    lab[_f] = lab[_jy[_f], _jx[_f]]
lab[lab == VOID] = 0

for (bx0, by0, bx1, by1, ia, ib) in owners:
    sub = lab[by0:by1, bx0:bx1]
    sel = cv2.dilate(line.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)[by0:by1, bx0:bx1] \
        & ((sub == idx[ia]) | (sub == idx[ib]))
    k5 = np.ones((7, 7), np.uint8)
    sel &= cv2.dilate((sub == idx[ia]).astype(np.uint8), k5).astype(bool) \
        & cv2.dilate((sub == idx[ib]).astype(np.uint8), k5).astype(bool)   # jen u společné hranice
    sub[sel] = idx[ia]

# díry uvnitř jedné země (ostrůvky bez země obklopené jen jí) → patří zemi
holes = ndi.binary_fill_holes(lab > 0) & (lab == 0) & ~river & ~manual
hl, nh = ndi.label(holes)
for i in range(1, nh + 1):
    m = hl == i
    ring = cv2.dilate(m.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & ~m
    v = np.unique(lab[ring]); v = v[v > 0]
    if len(v) == 1: lab[m] = v[0]

def join_parts(parts):
    """Spojí víc kusů do jednoho polygonu nulově širokou chodbičkou."""
    poly = list(parts[0])
    for p in parts[1:]:
        A = np.array(poly); B = np.array(p)
        d = ((A[:, None, :] - B[None, :, :]) ** 2).sum(2)
        i, j = np.unravel_index(d.argmin(), d.shape)
        poly = poly[:i + 1] + list(p[j:]) + list(p[:j + 1]) + poly[i:]
    return poly

regions, info = {}, []
k3 = np.ones((3, 3), np.uint8)
for k in ids:
    m = (lab == idx[k]).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k3)
    m = cv2.dilate(m, k3)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cs = sorted(cs, key=cv2.contourArea, reverse=True)
    keep = [c for c in cs if cv2.contourArea(c) > 300] or cs[:1]
    if len(keep) > 1: info.append((k, [int(cv2.contourArea(c)) for c in keep]))
    parts = [[tuple(map(int, q)) for q in cv2.approxPolyDP(c, 1.0, True).reshape(-1, 2)] for c in keep]
    regions[str(k)] = ' '.join(f'{x},{y}' for x, y in join_parts(parts))
json.dump(regions, open(f'{outdir}/regions.json', 'w'), separators=(',', ':'))

edge = np.zeros((H, W), bool)
dx = lab[:, 1:] != lab[:, :-1]; edge[:, 1:] |= dx; edge[:, :-1] |= dx
dy = lab[1:, :] != lab[:-1, :]; edge[1:, :] |= dy; edge[:-1, :] |= dy
edge &= lab > 0          # čáry jen na straně země (ne uvnitř řek / divočiny)
ov = np.zeros((H, W, 4), np.uint8); ov[edge, 3] = 210
Image.fromarray(ov).save(f'{outdir}/borders.png', optimize=True)

rng = np.random.default_rng(1)
pal = rng.integers(40, 255, (VOID + 1, 3)); pal[0] = 0
vis = np.where((lab > 0)[..., None], a * 0.4 + pal[lab] * 0.6, a * 0.5).astype(np.uint8)
vis[edge] = 0
for k in ids:
    for (x, y) in seeds[k]: cv2.circle(vis, snap(x, y), 4, (255, 255, 255), -1)
for (x, y) in voids: cv2.circle(vis, snap(x, y), 4, (255, 0, 0), -1)
Image.fromarray(vis).save(f'{outdir}/check.png')

holes_rep = []
for k in ids:
    m = lab == idx[k]
    h = ndi.binary_fill_holes(m) & ~m & ~manual
    if h.sum() > 20: holes_rep.append((k, int(h.sum())))
print('lands with holes', holes_rep)
areas = np.bincount(lab.ravel(), minlength=VOID + 1)
sm = sorted((int(areas[idx[k]]), k) for k in ids)
print('smallest', sm[:6], 'largest', sm[-6:])
print('multi-seed comps', multi)
print('multi-part lands', info)
for c in np.nonzero(voidc)[0]:
    ys, xs = np.nonzero(comp0 == c)
    ring = cv2.dilate((comp0 == c).astype(np.uint8), np.ones((31, 31), np.uint8)).astype(bool)
    nb = {ids[v - 1]: int(n) for v, n in zip(*np.unique(lab[ring & (lab > 0)], return_counts=True))}
    print('VOID comp', c, 'size', int(sizes0[c]), 'center', int(xs.mean()), int(ys.mean()), 'nb', sorted(nb.items(), key=lambda t: -t[1])[:4])
print('unseeded comps >300:', sorted(((int(sizes[c]), c) for c in range(1, ncomp) if c not in seedcomp and sizes[c] > 300), reverse=True)[:25])
