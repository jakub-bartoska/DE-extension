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

    function colorForKey(key) {
        // stabilní barva z hashe klíče; zlatý úhel = dobré rozlišení mnoha hráčů
        let h = 2166136261;
        for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
        const hue = ((h >>> 0) * 137.508) % 360;
        const sat = 60 + ((h >>> 8) & 31);      // 60–91 %
        const lig = 42 + ((h >>> 13) & 15);     // 42–57 %
        return `hsl(${hue.toFixed(0)}, ${sat}%, ${lig}%)`;
    }

    async function colorByOwner(mode) { // "hrac" | "aliance" | null
        await ready();
        clearAll();
        if (!mode) return;
        const attr = mode === "aliance" ? "data-id_alliance" : "data-id_player";
        for (const land of maps.querySelectorAll(".land")) {
            const key = land.getAttribute(attr);
            if (!key || key === "0") continue; // neutrální / bez aliance
            fill(land.getAttribute("data-id"), colorForKey(key), { opacity: 0.55 });
        }
    }

    // ------------------------------------------------------------- UI
    //
    // Panel je v Shadow DOM na <section> hostu. Mapa má agresivní CSS pravidlo,
    // které dělá KAŽDÝ <div> velikost 39×39 px — kdyby byl panel běžný div v
    // stránce, scvrknul by se. Shadow DOM izoluje obsah od CSS stránky a host
    // není div, takže ho pravidlo `div{}` nechytí.

    const menu = document.getElementById("miniMenuContainer");
    if (menu) buildMenu();

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
