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

    const menu = document.getElementById("miniMenuContainer");
    if (menu) buildMenu();

    function buildMenu() {
        const btn = document.createElement("img");
        btn.src = "../images/mapy/but_map_menu.gif";
        btn.id = "de-fill-button";
        btn.title = "Obarvení území / hranice";
        btn.width = 47; btn.height = 38;
        btn.style.cursor = "pointer";
        btn.style.filter = "hue-rotate(120deg)"; // odliš od stávající ikony
        btn.addEventListener("click", togglePanel);
        menu.appendChild(btn);
        menu.appendChild(buildPanel());
    }

    function togglePanel() {
        const d = document.getElementById("de-fill-panel");
        d.style.display = d.style.display === "none" ? "block" : "none";
    }

    function buildPanel() {
        const div = document.createElement("div");
        div.id = "de-fill-panel";
        Object.assign(div.style, {
            display: "none", position: "absolute", left: "220px", top: "46px",
            zIndex: "60", padding: "10px 12px", width: "190px",
            border: "4px solid #220000", borderTopColor: "#521000", borderRightColor: "#521000",
            backgroundColor: "#400000", color: "#e8d8b8", font: "13px Arial, sans-serif",
            textAlign: "left",
        });

        const h = document.createElement("div");
        h.textContent = "Obarvit území podle:";
        h.style.fontWeight = "bold";
        h.style.marginBottom = "6px";
        div.appendChild(h);

        [["hrac", "Hráčů"], ["aliance", "Aliancí"], ["", "Nic"]].forEach(([val, label], i) => {
            const lab = document.createElement("label");
            lab.style.display = "block";
            lab.style.cursor = "pointer";
            const inp = document.createElement("input");
            inp.type = "radio"; inp.name = "de-fill-owner"; inp.value = val;
            if (i === 2) inp.checked = true;
            inp.addEventListener("change", () => colorByOwner(val || null));
            lab.appendChild(inp);
            lab.appendChild(document.createTextNode(" " + label));
            div.appendChild(lab);
        });

        const hr = document.createElement("div");
        hr.style.borderTop = "1px solid #7a3030";
        hr.style.margin = "8px 0";
        div.appendChild(hr);

        const bl = document.createElement("label");
        bl.style.display = "block";
        bl.style.cursor = "pointer";
        const bi = document.createElement("input");
        bi.type = "checkbox";
        bi.addEventListener("change", async () => { await ready(); setBorders(bi.checked); });
        bl.appendChild(bi);
        bl.appendChild(document.createTextNode(" Zvýraznit hranice"));
        div.appendChild(bl);

        return div;
    }
})();
