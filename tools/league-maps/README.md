# league-maps

Generátor obrysů zemí a sítě hranic pro mapy lig, které mají jinou grafiku
i jiná ID zemí než běžné ligy. Zatím je hotová **K liga**. Běžné ligy používají
`regions.json` + `borders.png` v kořeni, K liga `maps/K/regions.json` +
`maps/K/borders.png`. Kterou sadu načíst, rozhoduje `map-assets.js` podle
pozadí mapy (`images/mapy/mapaK1_1h.gif` → `K`; číslo za písmenem je instance
ligy). Na mapě ligy bez dat (např. S liga) se nevykreslí nic.

Řeky a neobsazené hory schválně nemají polygon, aby bylo vidět, kde je most.
Země na obou březích řeky mají oba kusy spojené do jednoho polygonu tenkou
„chodbičkou“ přes řeku.

## Soubory

- `K/seeds.txt`: pozice tlačítek zemí (`id:x,y,w,h`, souřadnice mřížky 2244×1542)
- `K/fixes.txt`: ruční opravy (druhé břehy řek, Pražský hrad, …). Syntaxe je
  v hlavičce `generate.py`.
- `maps/K/regions.json`, `maps/K/borders.png` (v kořeni repa): výstup generátoru

## Jak přegenerovat / přidat ligu (např. S)

Příklad pro S ligu s instancí S1 (písmeno = liga, číslo = instance; mapa se
bere z kterékoli instance).

1. Pozorovatel: `https://www.darkelf.cz/login.asp?l=S1` → `map_new.asp`.
2. Pozice zemí: v konzoli na mapě
   ```js
   const o=document.querySelector('#position_x1_y1').getBoundingClientRect();
   [...document.querySelectorAll('#maps .land')].map(l=>{const r=l.getBoundingClientRect();
     return l.dataset.id+':'+[r.left-o.left,r.top-o.top,r.width,r.height].map(Math.round)}).join(' ')
   ```
   → uložit do `S/seeds.txt`.
3. Stáhnout dlaždice taktické mapy `images/mapy/mapaS1_{1..9}s.gif` a původní
   `mapaS1_{1..9}.gif` a každou sadu slepit 3×3 (748×514) do `full_s.png`
   a `full.png`. Taktická je hlavní zdroj (bez ikon měst). Z původní se berou
   hranice přes hory, kde je taktická nekreslí.
4. ```
   mkdir -p ../../maps/S
   ORIG=full.png python generate.py full_s.png S/seeds.txt ../../maps/S S/fixes.txt
   ```
   (numpy, opencv-python-headless, scipy, scikit-image, pillow) → `regions.json`,
   `borders.png`, `check.png`. Zkontrolovat `check.png` a výpis (sloučené země,
   prázdné plochy velikosti země = kandidáti na druhý břeh).
5. Přidat `"S"` do `LEAGUE_MAPS` v `map-assets.js` a oba soubory do
   `web_accessible_resources` v `manifest.json` i `manifest.firefox.json`.
   `check.png` z `maps/S/` smazat.
