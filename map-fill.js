// Vybarvení celých zemí na mapě.
//
// Místo kolečka kolem vlajky obarví celé území země. Tvary zemí (polygony) jsou
// předpočítané z čisté staré grafiky (viz regions.json) — za běhu se nic nepočítá,
// jen se nastaví `fill` u příslušného polygonu. Výplň leží POD ikonami hráče
// (vlajky, vojsko, stavby, hrdinové), takže ty zůstávají dobře viditelné.
//
// Poskytuje:
//   window.DEfill.fill(id, color, {opacity, stroke})  — obarvit zemi
//   window.DEfill.clearAll()                           — zrušit všechna obarvení
//   window.DEfill.setBorders(on)                       — obtáhnout všechny země černě
//   window.DEfill.ready()                              — Promise, až je vrstva hotová
// a menu tlačítko s obarvením podle vlastníka / aliance.

(function () {
    const maps = document.getElementById("maps");
    if (!maps) return; // jen na stránce mapy

    const NS = "http://www.w3.org/2000/svg";
    const MAP_W = 2244, MAP_H = 1542; // 3×748 × 3×514
    let svg = null, polys = {}, readyPromise = null;

    // ------------------------------------------------------------- vrstva

    function gridOrigin() {
        // buňka x1_y1 vůči #maps (mapa má nahoře offset hlavičky ~51 px)
        const cell = maps.querySelector("#position_x1_y1");
        const mr = maps.getBoundingClientRect();
        const cr = cell.getBoundingClientRect();
        return { x: Math.round(cr.left - mr.left), y: Math.round(cr.top - mr.top) };
    }

    function ready() {
        if (!readyPromise) {
            readyPromise = fetch(chrome.runtime.getURL("regions.json"))
                .then((r) => r.json())
                .then(buildLayer)
                .catch((e) => { console.error("DEfill: regions.json", e); });
        }
        return readyPromise;
    }

    function buildLayer(regions) {
        if (svg) return;
        const o = gridOrigin();
        svg = document.createElementNS(NS, "svg");
        svg.id = "de-fill-svg";
        svg.setAttribute("viewBox", `0 0 ${MAP_W} ${MAP_H}`);
        Object.assign(svg.style, {
            position: "absolute", left: o.x + "px", top: o.y + "px",
            width: MAP_W + "px", height: MAP_H + "px",
            pointerEvents: "none", zIndex: "5", // < z-index vlajek (10) a hrdinů (16)
        });
        for (const id in regions) {
            const pg = document.createElementNS(NS, "polygon");
            pg.setAttribute("points", regions[id]);
            pg.setAttribute("fill", "none");
            pg.setAttribute("stroke", "none");
            pg.setAttribute("stroke-width", "1.4");
            pg.setAttribute("stroke-linejoin", "round");
            polys[id] = pg;
            svg.appendChild(pg);
        }
        maps.appendChild(svg);
    }

    // ------------------------------------------------------------- API

    let bordersOn = false;

    // fill přes style (podpora rgba()/hsl()). opts: {opacity, stroke}
    function fill(id, color, opts) {
        const p = polys[id];
        if (!p) return;
        opts = opts || {};
        p.style.fill = color;
        p.style.fillOpacity = opts.opacity == null ? "" : String(opts.opacity);
        if (opts.stroke) p.style.stroke = opts.stroke;
        else if (!bordersOn) p.style.stroke = "none";
    }

    function clearAll() {
        for (const id in polys) {
            polys[id].style.fill = "none";
            if (!bordersOn) polys[id].style.stroke = "none";
        }
    }

    function setBorders(on) {
        bordersOn = on;
        for (const id in polys) polys[id].style.stroke = on ? "rgba(0,0,0,0.75)" : "none";
    }

    window.DEfill = { fill, clearAll, setBorders, ready, hasRegion: (id) => !!polys[id] };

    // ------------------------------------------------ obarvení dle vlastníka

    // Dominantní (nejčastější sytá) barva obrázku — vlajky hráče nebo erbu aliance.
    // Obrázky jsou same-origin, takže je lze načíst do canvasu a přečíst pixely.
    const _colCache = {};
    function dominantColor(img) {
        const src = img && img.getAttribute("src");
        if (!src) return null;
        if (src in _colCache) return _colCache[src];
        let res = null;
        try {
            const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            if (w && h) {
                const cv = document.createElement("canvas");
                cv.width = w; cv.height = h;
                const ctx = cv.getContext("2d");
                ctx.drawImage(img, 0, 0);
                const d = ctx.getImageData(0, 0, w, h).data, buckets = {};
                for (let i = 0; i < d.length; i += 4) {
                    if (d[i + 3] < 128) continue;
                    const r = d[i], g = d[i + 1], b = d[i + 2];
                    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
                    if (mx - mn < 28 || mx < 50) continue; // šedivé/tmavé přeskočit
                    const k = (r >> 5) + "," + (g >> 5) + "," + (b >> 5);
                    const o = buckets[k] || (buckets[k] = { n: 0, r: 0, g: 0, b: 0 });
                    o.n++; o.r += r; o.g += g; o.b += b;
                }
                let best = null;
                for (const k in buckets) if (!best || buckets[k].n > best.n) best = buckets[k];
                if (best) {
                    let c = [best.r / best.n, best.g / best.n, best.b / best.n];
                    const mx = Math.max(...c);
                    if (mx < 100) c = c.map((v) => v * 100 / mx); // zesvětli hodně tmavé
                    res = c.map(Math.round);
                }
            }
        } catch (e) { /* tainted / nenačteno */ }
        _colCache[src] = res;
        return res;
    }

    // Perceptuální barevný prostor (Lab) a vzdálenost — pro poznání "moc podobných".
    function rgb2lab(a) {
        let [R, G, B] = [a[0] / 255, a[1] / 255, a[2] / 255].map(
            (v) => (v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92));
        let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
        let y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
        let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
        [x, y, z] = [x, y, z].map((v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116));
        return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
    }
    function dE(a, b) { const l = a[0] - b[0], p = a[1] - b[1], q = a[2] - b[2]; return Math.sqrt(l * l + p * p + q * q); }
    function minDE(lab, arr) { let m = Infinity; for (const a of arr) m = Math.min(m, dE(lab, a)); return m; }

    function hsl2rgb(h, s, l) {
        s /= 100; l /= 100;
        const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
        let r, g, b;
        if (h < 60)[r, g, b] = [c, x, 0]; else if (h < 120)[r, g, b] = [x, c, 0];
        else if (h < 180)[r, g, b] = [0, c, x]; else if (h < 240)[r, g, b] = [0, x, c];
        else if (h < 300)[r, g, b] = [x, 0, c]; else[r, g, b] = [c, 0, x];
        return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
    }
    // sada dobře odlišených barev pro náhradu při kolizi
    const DISTINCT = (() => {
        const out = [];
        for (const [s, l] of [[72, 50], [82, 42], [62, 60], [85, 34]])
            for (let h = 0; h < 360; h += 30) out.push(hsl2rgb(h, s, l));
        return out;
    })();
    const COLLISION_THRESHOLD = 26; // ΔE — pod tím jsou barvy "moc podobné"
    const FILL_OP = 0.65;           // průhlednost výplně
    const GRASS = [0, 132, 0];      // barva trávy (přes ni se výplň míchá)
    // Lab výsledné barvy tak, jak reálně vypadá na mapě (výplň přes trávu) —
    // podobnost počítáme na TOMTO, ne na čisté barvě, aby území šla rozeznat.
    const onGrass = (c) => rgb2lab([0, 1, 2].map(
        (i) => Math.round(c[i] * FILL_OP + GRASS[i] * (1 - FILL_OP))));

    async function colorByOwner(mode) { // "hrac" | "aliance" | null
        await ready();
        clearAll();
        if (!mode) return;

        // hráč → barva z vlajky (1. <img> v zemi); aliance → barva z erbu
        // (obrázek z images/e/…, sdílený všemi členy aliance).
        const isAli = mode === "aliance";
        const attr = isAli ? "data-id_alliance" : "data-id_player";
        const groups = {};
        for (const land of maps.querySelectorAll(".land")) {
            const key = land.getAttribute(attr);
            if (!key || key === "0") continue;
            const g = groups[key] || (groups[key] = {
                img: isAli ? land.querySelector("img[src*='/e/']") : land.querySelector("img"),
                lands: [],
            });
            g.lands.push(land.getAttribute("data-id"));
        }
        // seed barvou trávy — aby žádná výplň nesplynula s mapou (grass-zelená)
        // ani nechyběla (černobílý erb) → dostane odlišnou viditelnou náhradu.
        const grassLab = rgb2lab(GRASS);
        const usable = (c) => c && dE(onGrass(c), grassLab) >= COLLISION_THRESHOLD;

        const list = Object.values(groups).map((g) => ({ lands: g.lands, base: dominantColor(g.img) }));
        // pořadí: nejdřív ti s POUŽITELNOU vlastní barvou (ať si ji nechají), pak
        // podle velikosti; bezbarví/splývající dostanou náhradu až nakonec.
        list.sort((a, b) => (usable(b.base) - usable(a.base)) || (b.lands.length - a.lands.length));

        const assignedLab = [grassLab];
        for (const gr of list) {
            let color = gr.base;
            if (!color || minDE(onGrass(color), assignedLab) < COLLISION_THRESHOLD) {
                // vyber z palety barvu, jejíž výsledek na mapě je nejvzdálenější
                let best = null, bestD = -1;
                for (const cand of DISTINCT) {
                    const dd = minDE(onGrass(cand), assignedLab);
                    if (dd > bestD) { bestD = dd; best = cand; }
                }
                color = best;
            }
            assignedLab.push(onGrass(color));
            const css = `rgb(${color[0]},${color[1]},${color[2]})`;
            for (const id of gr.lands) fill(id, css, { opacity: FILL_OP });
        }
    }

    // ------------------------------------------------------------- UI
    //
    // Panel je v Shadow DOM na <section> hostu. Mapa má agresivní CSS pravidlo,
    // které dělá KAŽDÝ <div> velikost 39×39 px — kdyby byl panel běžný div v
    // stránce, scvrknul by se. Shadow DOM izoluje obsah od CSS stránky a host
    // není div, takže ho pravidlo `div{}` nechytí.

    const PANEL_CSS = `
        .panel { box-sizing:border-box; display:flex; flex-direction:column; gap:9px;
            width:max-content; padding:9px 11px; border:3px solid #220000;
            border-top-color:#521000; border-radius:4px; background:#400000;
            color:#e8d8b8; font:13px Arial,sans-serif; white-space:nowrap;
            box-shadow:0 3px 8px rgba(0,0,0,.5); }
        .title { font-weight:bold; text-align:center; }
        .row { display:flex; gap:5px; }
        .chip { cursor:pointer; border:1px solid #7a3030; border-radius:3px;
            font:bold 12px Arial,sans-serif; padding:3px 10px; line-height:16px;
            background:#5a1414; color:#e8c8a8; }
        .chip:hover { background:#6e1a1a; }
        .chip.active { background:#9a3018; border-color:#d68040; color:#fff2d8; }
        .hr { height:1px; background:#7a3030; }
        .bchip { align-self:flex-start; }
    `;

    // až po definici PANEL_CSS (const nelze použít před svým řádkem)
    const menu = document.getElementById("miniMenuContainer");
    if (menu) buildMenu();

    function buildMenu() {
        const btn = document.createElement("img");
        btn.src = "../images/mapy/but_map_menu.gif";
        btn.id = "de-fill-button";
        btn.title = "Obarvení území / hranice";
        btn.width = 47; btn.height = 38;
        btn.style.cursor = "pointer";
        btn.style.filter = "hue-rotate(200deg)"; // odliš od stávající ikony
        btn.addEventListener("click", togglePanel);
        menu.appendChild(btn);
        buildPanel();
    }

    function buildPanel() {
        const host = document.createElement("section"); // NE div (mapa div mangluje)
        host.id = "de-fill-host";
        Object.assign(host.style, { position: "fixed", zIndex: "99999", display: "none" });
        document.body.appendChild(host);
        const sh = host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = PANEL_CSS;
        sh.appendChild(style);

        const panel = document.createElement("div");
        panel.className = "panel";

        const title = document.createElement("div");
        title.className = "title";
        title.textContent = "Obarvit území podle:";
        panel.appendChild(title);

        const row = document.createElement("div");
        row.className = "row";
        const chips = {};
        [["hrac", "Hráčů"], ["aliance", "Aliancí"], ["", "Vypnout"]].forEach(([val, label]) => {
            const c = document.createElement("button");
            c.type = "button"; c.className = "chip"; c.textContent = label;
            if (val === "") c.classList.add("active");
            chips[val] = c;
            c.addEventListener("click", () => {
                for (const k in chips) chips[k].classList.toggle("active", k === val);
                colorByOwner(val || null);
            });
            row.appendChild(c);
        });
        panel.appendChild(row);

        const hr = document.createElement("div");
        hr.className = "hr";
        panel.appendChild(hr);

        let bOn = false;
        const bchip = document.createElement("button");
        bchip.type = "button"; bchip.className = "chip bchip";
        bchip.textContent = "Zvýraznit hranice";
        bchip.addEventListener("click", async () => {
            bOn = !bOn;
            bchip.classList.toggle("active", bOn);
            await ready();
            setBorders(bOn);
        });
        panel.appendChild(bchip);

        sh.appendChild(panel);
    }

    function togglePanel() {
        const host = document.getElementById("de-fill-host");
        if (host.style.display === "none") {
            const r = document.getElementById("de-fill-button").getBoundingClientRect();
            host.style.left = Math.round(r.left) + "px";
            host.style.top = Math.round(r.bottom + 5) + "px";
            host.style.display = "block";
        } else {
            host.style.display = "none";
        }
    }
})();
