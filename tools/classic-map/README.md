# classic-map

Generátor obrysů zemí (`regions.json`) a sítě hranic (`borders.png`) pro
**běžné ligy** — ty, co používají soubory v kořeni repa. Mapy lig s jinou
grafikou a jinými ID zemí (K liga) řeší `../league-maps/`.

Výstup těchhle skriptů je v kořeni repa: `regions.json` (431 polygonů) a
`borders.png` (2244×1542 RGBA, souřadný systém = souřadnice `regions.json`).

## Jak to funguje

Hranice území jsou v grafice hry kreslené vyhrazenou **tyrkysovou** (0,66,66),
zatímco dekorace (hrady, hory) mají černé obrysy. Filtr jen na tyrkysovou tedy
dá čistou síť hranic bez dekorací — to je základ celé pipeline. Seedy (1 na zemi)
jsou středy vlajek z `css/de-mapa1high.css`.

Dlaždice taktické mapy si `regen_regions.py` stahuje sám přes pozorovatelský
flow na darkelf.cz, takže grafika není v repu — stačí být online.

Tam, kde tyrkysová v grafice chybí (hory), se dokresluje ručně — proto je tu
`manual_borders.png` (magenta čáry). To je jediný ručně vyrobený vstup, znovu
se nevygeneruje.

## Soubory

- `regen_regions.py` — hlavní pipeline: taktická mapa → `regions.json`
- `gen_borders.py` — síť hranic → `borders.png` (+ preview)
- `manual_borders.png` — ručně dokreslené hranice (magenta) tam, kde chybí tyrkysová
- `apply_manual_borders.py` — přegeneruje regiony z ručně dokreslených magenta hranic
- `apply_edited_borders.py` — z ručně upravené mapy s červenými hranicemi vyrobí obojí
- `regen_grow.py` — přegeneruje polygony s jiným přerostem, offline z cache
- `preview_fit.py` — kontrola, že výplně sedí na síť hranic (hledá přetečení barvy)
- `compute_adjacency.py` — sousednosti zemí z `regions.json` → `adjacency.json`

Závislosti: `numpy`, `pillow`, `scipy`, `opencv-python-headless`, `scikit-image`.

## Běžné použití

Všechny skripty se pouštějí z téhle složky. Bez `--deploy` jen vyrobí výstup
vedle sebe, s `--deploy` ho nasadí do kořene repa i do načítací složky
`~/Desktop/DE-extension-nahrat`.

```
python regen_regions.py              # nahled, nic nenasazuje
python regen_regions.py --deploy     # + zapise ../../regions.json (zaloha .bak)
python gen_borders.py --deploy       # + zapise ../../borders.png
python preview_fit.py                # kontrolni nahled do _regen_work/
```

Mezivýsledky a cache si skripty odkládají do `_regen_work/`, která je
v `.gitignore` — jsou to desítky MB a všechno se dá vyrobit znovu.

Cache staví `regen_regions.py` (stažené dlaždice slepí do `full_plain.png`
a uloží `map.html` + `pos.css`). Offline skripty `regen_grow.py`,
`preview_fit.py` a `apply_edited_borders.py` z ní čtou, takže na čistém
klonu je potřeba pustit nejdřív `regen_regions.py`. `gen_borders.py` cache
použije, když existuje, jinak si grafiku stáhne sám.

## Ruční doladění hranic

Když flood v horách proteče (tyrkysová tam není), jde hranice dokreslit ručně:

1. Do `~/Desktop/DE-mapa-uprava/EDIT_mapa.png` (2244×1542) dokresli chybějící
   hranice čistou **magentou** (255,0,255), tloušťka 2–3 px, a ulož.
2. `python apply_manual_borders.py` → náhled, `--deploy` → nasadí.

Skript čte **jen** magentu; zelená (aktuální hranice) a oranžová (problémové
zóny) v tom souboru slouží jen jako vodítko pro člověka.

Druhá varianta je upravit celou síť hranic **červeně** (255,0,0) a nechat
`apply_edited_borders.py <edited.png>` vyrobit `regions.json` i `borders.png`
z jednoho zdroje pravdy.
