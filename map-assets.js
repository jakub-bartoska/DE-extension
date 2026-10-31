// map-assets.js — obrysy zemí podle toho, která mapa je otevřená
// ---------------------------------------------------------------------------
// Běžné ligy a K liga mají jinou grafiku mapy i jiná ID zemí, takže každá
// potřebuje vlastní regions.json + borders.png:
//   běžné ligy → regions.json, borders.png (kořen rozšíření)
//   K liga     → maps/K/regions.json, maps/K/borders.png
// Kterou mapu hra ukazuje, se pozná podle pozadí buňky #position_x1_y1:
// images/mapy/mapaK1_1h.gif → liga "K" (číslo za písmenem je instance ligy);
// záložně podle css/de-mapaK1….css.
//
// Liga, pro kterou obrysy nemáme (např. S liga), dostane null → vrstva se
// nevykreslí (lepší nic než obrysy běžných lig přes jinou grafiku).
//
// Poskytuje:
//   window.DEmapAssets.key(doc)        — "" (běžné ligy) | "K" | …
//   window.DEmapAssets.url(name, doc)  — URL souboru pro otevřenou mapu, nebo null
//
// Další liga: vygenerovat maps/<liga>/ (viz tools/league-maps/README.md),
// přidat ji do LEAGUE_MAPS a soubory do web_accessible_resources v obou manifestech.
// ---------------------------------------------------------------------------
(function () {
    "use strict";

    const LEAGUE_MAPS = ["K"];

    function key(doc) {
        doc = doc || document;
        try {
            const c = doc.getElementById("position_x1_y1");
            let m = c && /mapa([A-Z])\d+_/.exec(getComputedStyle(c).backgroundImage || "");
            if (!m) {
                const l = doc.querySelector('link[href*="de-mapa"]');
                m = l && /de-mapa([A-Z])\d+/.exec(l.getAttribute("href"));
            }
            return m ? m[1] : "";
        } catch (e) { return ""; }
    }

    function url(name, doc) {
        const k = key(doc);
        if (!k) return chrome.runtime.getURL(name);
        return LEAGUE_MAPS.includes(k) ? chrome.runtime.getURL(`maps/${k}/${name}`) : null;
    }

    window.DEmapAssets = { key, url };
})();
