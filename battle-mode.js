// battle-mode.js — Bojový mód pro darkelf.cz
// ---------------------------------------------------------------------------
// Přepínač = ikona v mapovém mini-menu (#miniMenuContainer). Jen když jsi
// přihlášený hráč ve hře (ne pozorovatel). V bojovém módu se u každé MOJÍ země
// (u vlajky) zobrazí štítek přesné útočné (přes válku)/obranné síly + 3 tlačítka
// (útok / verbování / stavby).
// Data z map_export_json.asp (viz memory darkelf-json-export). Výpočty dle
// darkelf-vzorce; staty jednotek dle darkelf-rasy (id_rasa 0..10).
//
// POZOR: mapa má agresivní globální pravidlo `div{position:absolute;39x39}`.
//   → prvky v light DOM (cluster, tlačítka, přepínač) musí mít geometrii přebitou
//     přes !important; panely jsou v Shadow DOM (na <section> hostu), kam herní
//     CSS nedosáhne (stejný důvod jako u map-fill/reporty).
// ---------------------------------------------------------------------------
(function () {
    "use strict";

    // staty jednotek podle rasy (id_rasa 0..10): [tier1,tier2,tier3]
    const RACE = {
        0:  { name: "Lidé",         atk: [1, 7, 4], def: [5, 3, 4] },
        1:  { name: "Barbaři",      atk: [4, 9, 5], def: [3, 3, 4] },
        2:  { name: "Skřeti",       atk: [2, 5, 3], def: [4, 3, 3] },
        3:  { name: "Skuruti",      atk: [3, 7, 5], def: [3, 1, 3] },
        4:  { name: "Nekromanti",   atk: [1, 7, 5], def: [4, 2, 3] },
        5:  { name: "Mágové",       atk: [2, 7, 3], def: [5, 2, 5] },
        6:  { name: "Elfové",       atk: [2, 6, 5], def: [6, 4, 5] },
        7:  { name: "Temní Elfové", atk: [3, 8, 4], def: [5, 3, 5] },
        8:  { name: "Trpaslíci",    atk: [2, 5, 3], def: [7, 6, 7] },
        9:  { name: "Hobiti",       atk: [2, 4, 1], def: [2, 2, 2] },
        10: { name: "Enti",         atk: [4, 8, 3], def: [6, 8, 6] },
    };

    // pevnostní koef [útok,obrana] — TODO přesné mapování z img_pevnost; zatím [1,1]
    function fortressCoef() { return { atk: 1, def: 1 }; }

    // přesná útočná (přes válku = bez postihu −30 %) a obranná síla z JSON dat
    function computePower(z) {
        const p = z.private || {};
        const r = RACE[z.id_rasa] || { atk: [0, 0, 0], def: [0, 0, 0] };
        const a = [p.doma_war1 || 0, p.doma_war2 || 0, p.doma_war3 || 0];
        let ua = 0, ud = 0;
        for (let i = 0; i < 3; i++) { ua += a[i] * r.atk[i]; ud += a[i] * r.def[i]; }
        const f = fortressCoef(z.img_pevnost);
        const atk = Math.floor(ua * f.atk);
        const def = Math.floor(ud * f.def * (1 + (z.bonus_obrana || 0) / 100)) + (p.obyvatel || 0);
        return { atk, def };
    }

    // ------------------------------------------------------------- data
    let DATA = null;
    let dataReady = false; // true až po prvním úspěšném fetchData (přepínač do té doby „loading")
    async function fetchData() {
        // Přepiš DATA JEN když jsou validní (hráčská data). Občas server vrátí
        // validní JSON bez id_hrace (relogin/hiccup) — tím bychom si přepsali stav
        // a render() by kvůli !isPlayer() smazal clustery (problik → zmizí). Necháme staré.
        const j = await (await fetch("map_export_json.asp", { credentials: "include" })).json();
        if (j && j.hlavicka && j.hlavicka.id_hrace && Array.isArray(j.zeme)) DATA = j;
        return DATA;
    }

    // polygony zemí (regions.json, stejné jako map-fill) — pro obarvení hranic v útočném módu
    const MAP_W = 2244, MAP_H = 1542;
    let REGIONS = null;
    async function loadRegions() {
        if (REGIONS) return REGIONS;
        REGIONS = await (await fetch(chrome.runtime.getURL("regions.json"))).json();
        return REGIONS;
    }
    // grid origin v CONTENT souřadnicích #maps (scroll-kompenzace, viz map-fill)
    function bmGridOrigin(doc) {
        const maps = doc.getElementById("maps"), cell = maps.querySelector("#position_x1_y1");
        const mr = maps.getBoundingClientRect(), cr = cell.getBoundingClientRect();
        return { x: Math.round(cr.left - mr.left + maps.scrollLeft), y: Math.round(cr.top - mr.top + maps.scrollTop) };
    }
    const neutralZeme = (z) => !z.id_hrac || z.id_hrac === 0 || z.id_hrac === "0" || z.id_hrac === "";
    const isPlayer = () => DATA && DATA.hlavicka && DATA.hlavicka.id_hrace;
    const myId = () => DATA.hlavicka.id_hrace;
    const myLands = () => DATA.zeme.filter((z) => z.id_hrac === myId());

    // zlato/mana ze sourozeneckého info framu (lista_informace: #i1 zlato, #i2 mana)
    function goldMana() {
        try {
            const fr = window.top.frames;
            for (let i = 0; i < fr.length; i++) {
                try {
                    const d = fr[i].document, i1 = d.getElementById("i1"), i2 = d.getElementById("i2");
                    if (i1 && i2) return { gold: parseInt(i1.innerText.replace(/\D/g, "")) || 0, mana: parseInt(i2.innerText.replace(/\D/g, "")) || 0 };
                } catch (e) {}
            }
        } catch (e) {}
        return { gold: Infinity, mana: Infinity }; // nedostupné → neomezovat (server případně odmítne)
    }

    // buňka počtu jednotek v a.asp může být "0" nebo "0+34" (základ + bonus) → obojí OK,
    // beru základní číslo (počet doma). Bez toho se tier s "N+M" přeskočil.
    const isCountCell = (s) => /^\d+(\+\d+)?$/.test(s);
    const baseCount = (s) => parseInt(s, 10) || 0;

    // ŽIVÁ armáda doma z a.asp (count sloupec) — map_export_json je cachovaný ~2 min,
    // takže po verbování nesedí; pro útok/aktuální stav čteme živě.
    async function liveArmy(id) {
        try {
            const d = new DOMParser().parseFromString(await decode("a.asp?id=" + id), "text/html");
            const rows = [...d.querySelectorAll("tr")].map((tr) => [...tr.children].map((td) => td.innerText.replace(/\s+/g, " ").trim())).filter((c) => c.join("").length);
            const c = rows.filter((r) => r.length === 4 && r[0] && /^\d+$/.test(r[1]) && isCountCell(r[3])).map((r) => baseCount(r[3]));
            return [c[0] || 0, c[1] || 0, c[2] || 0];
        } catch (e) { return null; }
    }
    function atkFromArmy(z, army) {
        const r = RACE[z.id_rasa] || { atk: [0, 0, 0] };
        return Math.floor((army[0] * r.atk[0] + army[1] * r.atk[1] + army[2] * r.atk[2]) * fortressCoef(z.img_pevnost).atk);
    }

    // PŘESNÁ útočná/obranná síla + armáda z a.asp (hra počítá vše přesně — vč.
    // vojenských smluv, pevnosti, staveb, hrdiny, obyvatel). liveStats: id -> {atk,def,army}.
    const liveStats = {};
    async function parseAasp(id) {
        try {
            const d = new DOMParser().parseFromString(await decode("a.asp?id=" + id), "text/html");
            const rows = [...d.querySelectorAll("tr")].map((tr) => [...tr.children].map((td) => td.innerText.replace(/\s+/g, " ").trim())).filter((c) => c.join("").length);
            // Souhrnný řádek najdi podle názvu (bez diakritiky, jako prefix) a vezmi
            // z něj POSLEDNÍ číselnou buňku — hra tam má hodnotu dopočítanou na chlup
            // (pevnost, stavby, hrdina, obyvatelé, vojenské smlouvy). Proto bereme
            // obranu odsud, ne z odhadu.
            const nrm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
            const stat = (aliases) => {
                for (const r of rows) {
                    if (!r[0]) continue;
                    const n0 = nrm(r[0]);
                    if (!aliases.some((a) => n0.startsWith(a))) continue;
                    for (let i = r.length - 1; i >= 1; i--) {
                        const v = (r[i] || "").replace(/[^\d]/g, "");
                        if (v) return parseInt(v, 10);
                    }
                }
                return null;
            };
            const c = rows.filter((r) => r.length === 4 && r[0] && /^\d+$/.test(r[1]) && isCountCell(r[3])).map((r) => baseCount(r[3]));
            return {
                atk: stat(["utocna sila"]),
                def: stat(["celkova obrana", "aktualni obrana", "obrana celkem"]),
                army: [c[0] || 0, c[1] || 0, c[2] || 0],
            };
        } catch (e) { return null; }
    }
    async function refreshLiveStats(doc) {
        if (!on || !isPlayer()) return;
        await Promise.all(myLands().map(async (z) => { const s = await parseAasp(z.id); if (s) liveStats[z.id] = s; }));
        render(doc);
    }

    // ------------------------------------------------------------- SVG ikony
    function svg(paths, s) {
        s = s || 13;
        return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="currentColor" style="display:block">${paths}</svg>`;
    }
    const IC = {
        sword: '<path d="M6.9 2 2 6.9l9 9 1.4-1.4-1-1L14 10l1.5 1.5L21 6 18 3l-5.5 5.5L11 7l2.3-2.3-1-1L9.9 6 6.9 2Z"/>',
        shield: '<path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z"/>',
        attack: '<path d="M3 21 21 3M14 3h7v7M8 21H3v-5" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
        recruit: '<path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4 0-7 2-7 5v1h14v-1c0-3-3-5-7-5Z"/>',
        build: '<path d="M15 3l6 6-2 2-6-6 2-2Z"/><path d="M13 8l-9 9 2 2 9-9-2-2Z"/>',
    };

    // ------------------------------------------------------------- styl (light DOM prvky)
    // Geometrie přebitá !important kvůli mapovému `div{position:absolute;39x39}`.
    function injectStyle(doc) {
        if (doc.getElementById("de-bm-style")) return;
        const st = doc.createElement("style");
        st.id = "de-bm-style";
        st.textContent = `
/* přepínač je celý jeden <svg> (jako herní <img> dlaždice → zarovná se stejně, div{} ho nebere) */
#de-bm-menubtn{cursor:pointer;vertical-align:baseline!important;margin:2px!important}
#de-bm-menubtn:hover{filter:brightness(1.12)}
#de-bm-menubtn .ring{stroke:none}
#de-bm-menubtn.on .ring{stroke:#ffcf3a}
/* loading stav: neklikatelné, meč ztlumený, dole běží progress bar */
#de-bm-menubtn.loading{pointer-events:none;cursor:progress}
#de-bm-menubtn.loading:hover{filter:none}
#de-bm-menubtn.loading .sword{opacity:.28}
#de-bm-menubtn .pbar{display:none}
#de-bm-menubtn.loading .pbar{display:block}
@keyframes de-bm-sweep{0%{transform:translateX(0)}100%{transform:translateX(24px)}}
#de-bm-menubtn.loading .pbar-fill{animation:de-bm-sweep .8s ease-in-out infinite alternate}
.de-bm-cluster{position:absolute!important;z-index:16;font-family:Arial;pointer-events:none;margin:0!important}
.de-bm-pow{position:absolute!important;bottom:100%;left:50%;transform:translateX(-50%);
  margin:0 0 2px!important;width:auto!important;height:auto!important;white-space:nowrap;
  font:bold 11px Arial;background:rgba(10,4,0,.92);border:1px solid #7a3010;border-radius:4px;
  padding:1px 5px;display:flex;gap:6px;line-height:14px}
.de-bm-pow .a{color:#ff8f8f;display:inline-flex;align-items:center;gap:2px}
.de-bm-pow .d{color:#9cccff;display:inline-flex;align-items:center;gap:2px}
.de-bm-btns{position:absolute!important;left:100%;top:50%;transform:translateY(-50%);
  margin:0 0 0 3px!important;width:auto!important;height:auto!important;
  display:flex;flex-direction:column;gap:2px;pointer-events:auto}
.de-bm-b{position:relative!important;left:auto!important;top:auto!important;margin:0!important;
  width:19px!important;height:19px!important;flex:0 0 auto;display:flex;align-items:center;
  justify-content:center;cursor:pointer;background:#1a0a00;border:1px solid #7a3010;border-radius:4px;
  color:#e7a86a;box-shadow:1px 1px 2px #000;box-sizing:border-box}
.de-bm-b:hover{background:#7a3010;color:#ffd9a0}
.de-bm-mlabel{position:absolute!important;z-index:17;display:flex!important;align-items:center;justify-content:center;
  pointer-events:none;margin:0!important}
.de-bm-mlabel span{font:bold 12px Arial;color:#fff;background:rgba(150,20,20,.94);border:1px solid #ffd98a;
  border-radius:4px;padding:0 4px;line-height:15px;box-shadow:1px 1px 2px #000;white-space:nowrap}`;
        doc.head.appendChild(st);
    }

    // ------------------------------------------------------------- panel (Shadow DOM)
    const PANEL_CSS = `
*{box-sizing:border-box}
.panel{background:linear-gradient(180deg,#231108,#150a05);border:1px solid #8a4a22;border-radius:12px;
  box-shadow:0 12px 36px rgba(0,0,0,.78),inset 0 1px 0 rgba(255,205,150,.08);color:#e7ddd3;
  font:13px Arial;min-width:252px;max-width:344px;max-height:76vh;display:flex;flex-direction:column;overflow:hidden}
.panel h3{margin:0;padding:11px 14px;font-size:13.5px;font-weight:bold;color:#f2c68c;flex:0 0 auto;
  background:linear-gradient(180deg,#3c1d0d,#2a1409);border-bottom:1px solid #6a3418;
  display:flex;justify-content:space-between;align-items:center;gap:10px;text-shadow:0 1px 1px #000}
.x{cursor:pointer;color:#b58c6a;font-size:18px;line-height:1;user-select:none;transition:color .1s}
.x:hover{color:#fff}
.body{padding:8px 12px 12px;overflow:auto;min-height:0}
.cat{color:#f0b070;font-size:10px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;
  margin:13px 0 4px;padding-bottom:3px;border-bottom:1px solid #4a2410;display:flex;align-items:center;gap:7px}
.cat:first-child{margin-top:2px}
.cat::before{content:"";width:7px;height:7px;border-radius:2px;background:#c47a30;transform:rotate(45deg);box-shadow:0 0 4px rgba(220,140,60,.6)}
.row{display:flex;align-items:center;gap:9px;padding:6px 8px;margin:1px -4px;border-radius:7px;cursor:pointer;transition:background .08s}
.row:hover{background:rgba(210,125,55,.15)}
.row input{accent-color:#e0863a;width:15px;height:15px;flex:0 0 auto;cursor:pointer}
.row .bn{flex:1}
.row .cost{font-size:11px;font-weight:bold;color:#eccb92;background:rgba(95,45,18,.55);border:1px solid #6a3418;
  border-radius:10px;padding:1px 8px;white-space:nowrap}
.act{background:linear-gradient(180deg,#93481f,#5c2b11);color:#ffe7c2;border:1px solid #a95d2c;border-radius:8px;
  padding:9px 12px;cursor:pointer;font:bold 12.5px Arial;margin-top:12px;width:100%;text-shadow:0 1px 1px #000;
  box-shadow:inset 0 1px 0 rgba(255,222,182,.28),0 2px 6px rgba(0,0,0,.45)}
.act:hover{background:linear-gradient(180deg,#a5531f,#6b3313)}
.act:active{transform:translateY(1px)}
.act:disabled{opacity:.5;cursor:default}
.muted{color:#9c8b7b;font-size:11px}
.hd{color:#d8ccc0;font-size:12px;margin-bottom:9px}.hd b{color:#ffdca0}
.trow{padding:7px 2px;border-bottom:1px solid #351a0c}
.trow:last-of-type{border-bottom:none}
.trow .lbl{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:4px}
.trow .lbl small{color:#9c8b7b;font-size:10px;white-space:nowrap}
.trow .ctrl{display:flex;align-items:center;gap:9px}
.trow input[type=range]{flex:1;accent-color:#e0863a;margin:0}
.trow .num{min-width:30px;text-align:right;font-weight:bold;color:#ffdca0}`;

    let openHost = null;
    function closePanel() { if (openHost) { openHost.remove(); openHost = null; } }
    function makePanel(doc, title, atX, atY) {
        closePanel();
        const host = doc.createElement("section"); // <section> herní div{} pravidlo nebere
        host.style.cssText = "position:fixed;z-index:100000;left:0;top:0";
        const root = host.attachShadow({ mode: "open" });
        root.innerHTML = `<style>${PANEL_CSS}</style><div class="panel"><h3><span>${title}</span><span class="x">✕</span></h3><div class="body"></div></div>`;
        root.querySelector(".x").onclick = closePanel;
        doc.body.appendChild(host);
        openHost = host;
        // umístění se dělá AŽ po naplnění obsahu (place()), aby se znalo h;
        // u nízkého kliknutí se panel otevře NAHORU, ať spodek nezajede mimo okno.
        const place = () => {
            const win = doc.defaultView, W = win.innerWidth, H = win.innerHeight;
            const panel = root.querySelector(".panel");
            const w = panel.offsetWidth, h = panel.offsetHeight;
            const left = Math.max(6, Math.min(atX, W - w - 6));
            let top = (atY + h <= H - 6) ? atY : atY - h;      // dolů, nebo flip nahoru
            top = Math.max(6, Math.min(top, H - h - 6));       // celý do viewportu
            host.style.left = left + "px";
            host.style.top = top + "px";
        };
        place();
        return { root, body: root.querySelector(".body"), place };
    }

    // kategorie staveb, které chceme (zvyšují útok/obranu) — bez diakritiky, upper
    const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
    const WANT_CAT = (name) => /UTOCN|OBRANN|PEVNOST/.test(norm(name));

    async function decode(url, opts) {
        const buf = await (await fetch(url, Object.assign({ credentials: "include" }, opts))).arrayBuffer();
        return new TextDecoder("windows-1250").decode(buf);
    }

    // ------------------------------------------------------------- STAVBY
    async function openBuild(doc, z, ev) {
        const { body, place } = makePanel(doc, "Stavby — " + z.zeme, ev.clientX + 10, ev.clientY - 20);
        body.innerHTML = '<div class="muted">Načítám…</div>';
        try {
            const d = new DOMParser().parseFromString(await decode("b.asp?id=" + z.id), "text/html");
            const sel = d.querySelector('select[name="CBoxVyvoj"]');
            if (!sel) { body.innerHTML = '<div class="muted">Tady nejde nic postavit.</div>'; place(); return; }
            body.innerHTML = "";
            const picks = new Set();
            let curCat = null, catShown = false, any = false;
            [...sel.options].forEach((o) => {
                const t = o.text.replace(/\s+/g, " ").trim();
                if (!o.value || o.value === "0") return;
                if (o.value === "4999") {                          // oddělovač = kategorie
                    const name = t.replace(/-/g, "").trim();
                    curCat = WANT_CAT(name) ? name : null;         // jen útočné/obranné/pevnosti
                    catShown = false;
                    return;
                }
                if (!curCat) return;                                // nechtěná kategorie → přeskoč
                if (!catShown) {                                    // nadpis až když má obsah
                    const h = doc.createElement("div"); h.className = "cat"; h.textContent = curCat;
                    body.appendChild(h); catShown = true;
                }
                const row = doc.createElement("label"); row.className = "row";
                const mc = t.match(/^(.*?)\s*\((\d+),(\d+)\)\s*$/); // "Název (zlato,mana)"
                const nm = mc ? mc[1] : t;
                const cost = mc ? (mc[2] + " zl" + (+mc[3] ? " · " + mc[3] + " m" : "")) : "";
                row.innerHTML = `<input type="checkbox"><span class="bn">${nm}</span>${cost ? `<span class="cost">${cost}</span>` : ""}`;
                row.querySelector("input").onchange = (e) => { e.target.checked ? picks.add(o.value) : picks.delete(o.value); };
                body.appendChild(row); any = true;
            });
            if (!any) { body.innerHTML = '<div class="muted">Všechny útočné/obranné stavby už tu stojí.</div>'; place(); return; }
            const btn = doc.createElement("button");
            btn.className = "act"; btn.textContent = "Postavit vybrané";
            btn.onclick = async () => {
                if (!picks.size) return;
                btn.disabled = true; btn.textContent = "Stavím…";
                for (const code of picks) {
                    await fetch("b.asp", {
                        method: "POST", credentials: "include",
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        body: new URLSearchParams({ id: String(z.id), CBoxVyvoj: code, Postavit: "Postavit" }).toString(),
                    });
                }
                setTimeout(() => openBuild(doc, z, ev), 500); // refresh nabídky
            };
            body.appendChild(btn);
            place(); // umístit až podle výsledné výšky (flip nahoru u nízkých zemí)
        } catch (e) {
            body.innerHTML = '<div class="muted">Chyba: ' + e.message + "</div>"; place();
        }
    }

    // ------------------------------------------------------------- VERBOVÁNÍ / ÚTOK (stub — doplňujeme)
    async function openRecruit(doc, z, ev) {
        const { body, place } = makePanel(doc, "Verbování — " + z.zeme, ev.clientX + 10, ev.clientY - 20);
        body.innerHTML = '<div class="muted">Načítám…</div>';
        try {
            const d = new DOMParser().parseFromString(await decode("a.asp?id=" + z.id), "text/html");
            const rows = [...d.querySelectorAll("tr")].map((tr) => [...tr.children].map((td) => td.innerText.replace(/\s+/g, " ").trim())).filter((c) => c.join("").length);
            const rm = (d.body.innerText.match(/Lze naverbovat:\s*(\d+)/) || [])[1];
            const recruitable = rm ? +rm : 0;
            // tiery: řádek [jméno,útok,obrana,počet] + [_,cena_zl,cena_mana,"žold: X"] + řádek "Naverbuj" (s "Cech… není postaven!" = nedostupné)
            const tiers = [];
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                if (r.length === 4 && r[0] && /^\d+$/.test(r[1]) && isCountCell(r[3])) {
                    const cost = rows[i + 1] || [], naverb = (rows[i + 2] || []).join(" ");
                    const zm = (cost[3] || "").match(/(\d+)/);
                    tiers.push({
                        idx: tiers.length + 1, name: r[0], count: baseCount(r[3]),
                        gold: +(cost[1] || 0), mana: +(cost[2] || 0), zold: zm ? +zm[1] : 0,
                        avail: !/není postaven/i.test(naverb), val: 0,
                    });
                }
            }
            const gm = goldMana();
            body.innerHTML = "";
            const hd = doc.createElement("div"); hd.className = "hd";
            hd.innerHTML = `Zlato <b>${isFinite(gm.gold) ? gm.gold : "?"}</b> · Mana <b>${isFinite(gm.mana) ? gm.mana : "?"}</b> · Lze naverbovat <b>${recruitable}</b>`;
            body.appendChild(hd);
            const sliders = [];
            tiers.forEach((t) => {
                if (!t.avail) {
                    const m = doc.createElement("div"); m.className = "muted"; m.style.padding = "5px 0";
                    m.textContent = `${t.name} — vyžaduje ${t.idx === 2 ? "Cech války" : "Cech magie"}`;
                    body.appendChild(m); return;
                }
                const row = doc.createElement("div"); row.className = "trow";
                row.innerHTML = `<div class="lbl"><span>${t.name} <small>nyní ${t.count}</small></span><small>${t.gold}zl${t.mana ? "/" + t.mana + "m" : ""} · žold ${t.zold}</small></div>
                  <div class="ctrl"><input type="range" min="0" max="0" value="0"><span class="num">0</span></div>`;
                const sl = row.querySelector("input"), num = row.querySelector(".num");
                sl.oninput = () => { t.val = +sl.value; num.textContent = t.val; recompute(); };
                body.appendChild(row);
                sliders.push({ t, sl });
            });
            const remain = doc.createElement("div"); remain.className = "muted"; remain.style.marginTop = "6px";
            body.appendChild(remain);
            function recompute() {
                let uv = 0, ug = 0, um = 0;
                tiers.forEach((t) => { uv += t.val; ug += t.val * t.gold; um += t.val * t.mana; });
                const gCap = isFinite(gm.gold) ? gm.gold : 1e9, mCap = isFinite(gm.mana) ? gm.mana : 1e9;
                const vL = recruitable - uv, gL = gCap - ug, mL = mCap - um;
                sliders.forEach(({ t, sl }) => {
                    const byG = t.gold > 0 ? Math.floor((gL) / t.gold) : 1e9, byM = t.mana > 0 ? Math.floor((mL) / t.mana) : 1e9;
                    sl.max = t.val + Math.max(0, Math.min(vL, byG, byM));
                });
                remain.textContent = `Zbývá: ${vL} vesničanů · ${gL} zl${isFinite(gm.mana) ? " · " + mL + " many" : ""}`;
            }
            recompute();
            const btn = doc.createElement("button"); btn.className = "act"; btn.textContent = "Naverbovat";
            btn.onclick = async () => {
                if (!tiers.reduce((s, t) => s + t.val, 0)) return;
                btn.disabled = true; btn.textContent = "Verbuji…";
                const p = new URLSearchParams({ id: String(z.id), koupit2: "Vycvičit" });
                for (let n = 1; n <= 3; n++) { const t = tiers.find((x) => x.idx === n); p.set("T" + n, String(t ? t.val : 0)); }
                await fetch("nakup.asp", { method: "POST", credentials: "include", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: p.toString() });
                // optimistická aktualizace (map_export_json je ~2 min cachovaný → fetchData by vrátil starý stav)
                const zz = DATA.zeme.find((x) => x.id === z.id);
                if (zz && zz.private) {
                    const g = (n) => { const t = tiers.find((x) => x.idx === n); return t ? t.val : 0; };
                    zz.private.doma_war1 += g(1); zz.private.doma_war2 += g(2); zz.private.doma_war3 += g(3);
                    zz.private.obyvatel = Math.max(0, zz.private.obyvatel - tiers.reduce((s, t) => s + t.val, 0));
                }
                delete liveStats[z.id]; render(doc); // starý liveStats by přebil optimistický stav
                parseAasp(z.id).then((s) => { if (s) { liveStats[z.id] = s; render(doc); } }); // přesné z a.asp
                setTimeout(() => openRecruit(doc, z, ev), 400); // panel se přenačte z živého a.asp
            };
            body.appendChild(btn);
            if (recruitable <= 0) body.insertAdjacentHTML("beforeend", '<div class="muted" style="margin-top:6px">Teď nelze verbovat (málo obyvatel vůči domům).</div>');
            place();
        } catch (e) {
            body.innerHTML = '<div class="muted">Chyba: ' + e.message + "</div>"; place();
        }
    }
    // ------------------------------------------------------------- ÚTOČNÝ MÓD
    // Cíle bere z hry (utok.asp select[name=cil]) — autoritativní, včetně vodních
    // přechodů. Šipka od zdroje na cíl NEJbližší myši; klik = odeslat dobyvačný
    // útok celou domácí armádou. Esc / pravý klik zruší.
    let attackState = null;
    function exitAttack(doc) {
        if (!attackState) return;
        const s = attackState; attackState = null;
        s.svg.remove(); s.tip.remove(); s.hint.remove();
        doc.getElementById("de-bm-borders")?.remove(); // popisky min_utok řídí render() (zůstávají)
        doc.removeEventListener("mousemove", s.onMove, true);
        doc.removeEventListener("click", s.onClick, true);
        doc.removeEventListener("contextmenu", s.onCtx, true);
        doc.removeEventListener("keydown", s.onKey, true);
    }
    function centerOf(doc, id) {
        const el = doc.getElementById("x" + id); if (!el) return null;
        const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    function toast(doc, msg, color) {
        const t = doc.createElement("section");
        t.style.cssText = `position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:100001;background:#1a0a00;border:1px solid ${color || "#7a3010"};border-radius:6px;padding:7px 14px;font:bold 13px Arial;color:#ffd9a0;box-shadow:0 3px 12px rgba(0,0,0,.6)`;
        t.textContent = msg; doc.body.appendChild(t);
        setTimeout(() => t.remove(), 4000);
    }
    // obarvení hranic v útočném módu: zdroj (modrá) + cíle (jantar) + u neutrálů
    // popisek potřebné síly (min_utok) na místě vlajky.
    async function buildAttackBorders(doc, z, targets) {
        let regions;
        try { regions = await loadRegions(); } catch (e) { return; }
        if (!attackState) return; // mezitím zrušeno
        const maps = doc.getElementById("maps"), NS = "http://www.w3.org/2000/svg";
        const o = bmGridOrigin(doc);
        const svg = doc.createElementNS(NS, "svg");
        svg.id = "de-bm-borders";
        svg.setAttribute("viewBox", `0 0 ${MAP_W} ${MAP_H}`);
        svg.style.cssText = `position:absolute;left:${o.x}px;top:${o.y}px;width:${MAP_W}px;height:${MAP_H}px;pointer-events:none;z-index:14;overflow:visible`;
        const poly = (id, color) => {
            if (!regions[id]) return;
            const p = doc.createElementNS(NS, "polygon");
            p.setAttribute("points", regions[id]);
            p.setAttribute("fill", "none");
            p.setAttribute("stroke", color);
            p.setAttribute("stroke-width", "3");
            p.setAttribute("stroke-linejoin", "round");
            svg.appendChild(p);
        };
        for (const t of targets) poly(t.id, "#ffc020"); // cíle = jantar
        poly(z.id, "#40c4ff");                           // zdroj = modrá (navrch)
        maps.appendChild(svg);
        // popisky min_utok na neutrálech dělá render() (na všech, ne jen cílech)
    }

    async function startAttack(doc, z) {
        closePanel(); exitAttack(doc);
        const army = await liveArmy(z.id); // ŽIVÁ armáda (ne cache) — kvůli čerstvě naverbovaným
        if (!army || (!army[0] && !army[1] && !army[2])) { toast(doc, "V „" + z.zeme + "“ není doma žádná armáda.", "#a33"); return; }
        let targets;
        try {
            const d = new DOMParser().parseFromString(await decode("utok.asp?id=" + z.id), "text/html");
            const sel = d.querySelector('select[name="cil"]');
            targets = sel ? [...sel.options].filter((o) => o.value).map((o) => ({ id: o.value, name: o.text.replace(/\s+/g, " ").trim() })) : [];
        } catch (e) { toast(doc, "Nepodařilo se načíst cíle útoku.", "#a33"); return; }
        if (!targets.length) { toast(doc, "Odsud není na koho zaútočit.", "#a33"); return; }
        const NS = "http://www.w3.org/2000/svg";
        const svg = doc.createElementNS(NS, "svg");
        svg.id = "de-bm-atksvg";
        svg.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99998;pointer-events:none";
        svg.innerHTML = '<defs><marker id="de-bm-ah" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0 0L7 3L0 6Z" fill="#ffcf3a"/></marker></defs><line stroke="#ffcf3a" stroke-width="3" stroke-linecap="round" marker-end="url(#de-bm-ah)"/>';
        doc.body.appendChild(svg);
        const line = svg.querySelector("line");
        const tip = doc.createElement("section");
        tip.style.cssText = "position:fixed;z-index:100000;background:#1a0a00;border:1px solid #7a3010;border-radius:5px;padding:3px 7px;font:bold 12px Arial;color:#fff;pointer-events:none;white-space:nowrap;display:none";
        doc.body.appendChild(tip);
        const hint = doc.createElement("section");
        hint.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:100000;background:#1a0a00;border:1px solid #7a3010;border-radius:6px;padding:6px 12px;font:12px Arial;color:#e7a86a;pointer-events:none";
        hint.textContent = "Útok z „" + z.zeme + "“ → najeď na cíl a klikni (dobyvačný) · Shift=plenivý · Ctrl=přesun · Esc zruší";
        doc.body.appendChild(hint);
        const myAtk = atkFromArmy(z, army); // z živé armády
        let cur = null;
        const onMove = (e) => {
            const src = centerOf(doc, z.id); if (!src) return;
            let best = null, bd = Infinity;
            for (const t of targets) { const c = centerOf(doc, t.id); if (!c) continue; const dd = Math.hypot(c.x - e.clientX, c.y - e.clientY); if (dd < bd) { bd = dd; best = { t, c }; } }
            if (!best) return;
            cur = best.t;
            line.setAttribute("x1", src.x); line.setAttribute("y1", src.y);
            line.setAttribute("x2", best.c.x); line.setAttribute("y2", best.c.y);
            const tgt = DATA.zeme.find((zz) => String(zz.id) === String(cur.id));
            const need = tgt ? tgt.min_utok : null;
            tip.style.display = "block";
            tip.style.left = (e.clientX + 16) + "px"; tip.style.top = (e.clientY + 16) + "px";
            tip.innerHTML = cur.name + (need != null
                ? ` <span style="color:${myAtk >= need ? "#7bd67b" : "#ff7676"}">útok ${myAtk} / třeba ${need}</span>`
                : ` <span style="color:#aaa">útok ${myAtk}</span>`);
        };
        const onClick = (e) => {
            if (!cur) return; e.preventDefault(); e.stopPropagation();
            const t = cur, typ = e.shiftKey ? "3" : e.ctrlKey ? "1" : "4"; // 4 dobyv., 3 plen., 1 přesun
            exitAttack(doc); sendAttack(doc, z, t, army, typ);
        };
        const onCtx = (e) => { e.preventDefault(); exitAttack(doc); };
        const onKey = (e) => { if (e.key === "Escape") exitAttack(doc); };
        doc.addEventListener("mousemove", onMove, true);
        setTimeout(() => doc.addEventListener("click", onClick, true), 0); // ať nechytne iniciační klik z tlačítka
        doc.addEventListener("contextmenu", onCtx, true);
        doc.addEventListener("keydown", onKey, true);
        attackState = { z, targets, svg, tip, hint, onMove, onClick, onCtx, onKey };
        buildAttackBorders(doc, z, targets); // obarvit hranice zdroje/cílů + min_utok u neutrálů
    }
    const TYP_NAME = { "4": "dobyvačný", "3": "plenivý", "1": "přesun" };
    async function sendAttack(doc, z, target, army, typ) {
        typ = typ || "4";
        try {
            const body = new URLSearchParams({
                id_zeme_zdroj: String(z.id), cil: String(target.id), typ: typ,
                T1: String(army[0]), T2: String(army[1]), T3: String(army[2]), odeslat: "Odeslat vojsko",
            }).toString();
            const res = await decode("utok_poslat.asp", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
            const okMsg = (res.match(/dorazí[^<\n]{0,40}/) || [])[0];
            toast(doc, `Útok (${TYP_NAME[typ]}) → ${target.name}` + (okMsg ? " · " + okMsg.trim() : ""), "#5a2a10");
        } catch (e) { toast(doc, "Odeslání selhalo: " + e.message, "#a33"); }
        // optimisticky: odeslaná armáda opustila domov (map_export_json je ~2 min cachovaný)
        const zz = DATA.zeme.find((x) => x.id === z.id);
        if (zz && zz.private) {
            zz.private.doma_war1 = Math.max(0, zz.private.doma_war1 - army[0]);
            zz.private.doma_war2 = Math.max(0, zz.private.doma_war2 - army[1]);
            zz.private.doma_war3 = Math.max(0, zz.private.doma_war3 - army[2]);
        }
        delete liveStats[z.id]; render(doc); // render() volá i renderArrows() → nová šipka
        parseAasp(z.id).then((s) => { if (s) { liveStats[z.id] = s; render(doc); } }); // přesná síla po odeslání
    }

    // ------------------------------------------------------------- ŠIPKY ODESLANÝCH ÚTOKŮ
    // Zdroj: attacks_list.asp (moje útoky; řádky "Zdroj => CílStav, typ: síla").
    // SVG se přidá do #maps (scrolluje s mapou); pozice zemí = offset vůči #maps.
    const ATK_COLOR = { "dobyvačný": "#ffb020", "plenivý": "#ff5555", "přesun": "#5bc0ff" };
    function centerInMaps(doc, id) {
        const el = doc.getElementById("x" + id); if (!el) return null;
        const maps = doc.getElementById("maps");
        let x = 0, y = 0, n = el;
        while (n && n !== maps) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
        return { x: x + el.offsetWidth / 2, y: y + el.offsetHeight / 2 };
    }
    async function renderArrows(doc) {
        doc.getElementById("de-bm-arrows")?.remove();
        if (!on || !isPlayer()) return;
        let lines;
        try {
            const d = new DOMParser().parseFromString(await decode("attacks_list.asp"), "text/html");
            lines = [...d.querySelectorAll("tr")].map((tr) => tr.textContent.replace(/\s+/g, " ").trim()).filter((t) => t.includes("=>"));
        } catch (e) { return; }
        if (!lines || !lines.length) return;
        const byName = {}; DATA.zeme.forEach((z) => { byName[z.zeme] = z.id; });
        const names = DATA.zeme.map((z) => ({ name: z.zeme, id: z.id })).sort((a, b) => b.name.length - a.name.length);
        const atks = [];
        for (const t of lines) {
            const m = t.match(/^(.*?)\s*=>\s*(.+?),\s*(dobyvačný|plenivý|přesun)\s*:\s*(\d+)/i);
            if (!m) continue;
            const srcId = byName[m[1].trim()];
            const tp = m[2].trim(), tgt = names.find((n) => tp.startsWith(n.name));
            if (srcId == null || !tgt) continue;
            atks.push({ srcId, tgtId: tgt.id, typ: m[3].toLowerCase(), sila: +m[4] });
        }
        if (!atks.length) return;
        const maps = doc.getElementById("maps"), NS = "http://www.w3.org/2000/svg";
        const mk = (id, ...kids) => { const e = doc.createElementNS(NS, id); return e; };
        const svg = doc.createElementNS(NS, "svg");
        svg.id = "de-bm-arrows";
        svg.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:15";
        // defs: glow filtr + hezčí (mírně konkávní) hroty pro každý typ
        let defs = `<filter id="de-bm-glow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="1.4" flood-color="#000" flood-opacity="0.85"/></filter>`;
        for (const [k, c] of Object.entries(ATK_COLOR)) defs += `<marker id="de-bm-m-${k}" markerWidth="11" markerHeight="11" refX="7.5" refY="4" orient="auto"><path d="M0 0 L9 4 L0 8 L3 4 Z" fill="${c}"/></marker>`;
        svg.innerHTML = `<defs>${defs}</defs>`;
        for (const a of atks) {
            const s = centerInMaps(doc, a.srcId), t = centerInMaps(doc, a.tgtId);
            if (!s || !t) continue;
            const c = ATK_COLOR[a.typ] || "#fff";
            // mírně prohnutá šipka (Bézier) — dynamičtější než rovná čára
            const dx = t.x - s.x, dy = t.y - s.y, len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len, ny = dx / len, bow = Math.min(38, len * 0.16);
            const cx = (s.x + t.x) / 2 + nx * bow, cy = (s.y + t.y) / 2 + ny * bow;
            const path = mk("path");
            path.setAttribute("d", `M ${s.x} ${s.y} Q ${cx} ${cy} ${t.x} ${t.y}`);
            path.setAttribute("fill", "none"); path.setAttribute("stroke", c);
            path.setAttribute("stroke-width", "3.4"); path.setAttribute("stroke-linecap", "round");
            path.setAttribute("opacity", "0.96"); path.setAttribute("marker-end", `url(#de-bm-m-${a.typ})`);
            path.setAttribute("filter", "url(#de-bm-glow)");
            svg.appendChild(path);
            // odznak se sílou na bodu křivky (t=0.5): 0.25·s + 0.5·ctrl + 0.25·t
            const bx = 0.25 * s.x + 0.5 * cx + 0.25 * t.x, by = 0.25 * s.y + 0.5 * cy + 0.25 * t.y;
            const label = String(a.sila), bw = label.length * 8.5 + 13, bh = 18;
            const g = mk("g"); g.setAttribute("filter", "url(#de-bm-glow)");
            const rect = mk("rect");
            rect.setAttribute("x", bx - bw / 2); rect.setAttribute("y", by - bh / 2);
            rect.setAttribute("width", bw); rect.setAttribute("height", bh); rect.setAttribute("rx", "6");
            rect.setAttribute("fill", "#170a05"); rect.setAttribute("stroke", c); rect.setAttribute("stroke-width", "1.5");
            const tx = mk("text");
            tx.setAttribute("x", bx); tx.setAttribute("y", by + 0.5); tx.setAttribute("fill", "#fff");
            tx.setAttribute("font-family", "Arial"); tx.setAttribute("font-size", "12.5"); tx.setAttribute("font-weight", "bold");
            tx.setAttribute("text-anchor", "middle"); tx.setAttribute("dominant-baseline", "central");
            tx.textContent = label;
            g.appendChild(rect); g.appendChild(tx); svg.appendChild(g);
        }
        maps.appendChild(svg);
    }

    // ------------------------------------------------------------- render clusterů
    let on = false;
    // Zrušení/odeslání útoku se děje v jiném framu → mapa o tom neví. Dokud je mód
    // zapnutý, periodicky obnovujeme šipky z attacks_list.asp (chytne zrušené i nové).
    let arrowPoll = null;
    function startArrowPoll(doc) {
        if (arrowPoll) return;
        arrowPoll = setInterval(() => {
            if (!on) { clearInterval(arrowPoll); arrowPoll = null; return; }
            renderArrows(doc);
        }, 15000);
    }
    function stopArrowPoll() { if (arrowPoll) { clearInterval(arrowPoll); arrowPoll = null; } }
    function render(doc) {
        renderArrows(doc); // šipky odeslaných útoků (async)
        doc.querySelectorAll(".de-bm-cluster, .de-bm-mlabel").forEach((e) => e.remove());
        if (!on || !isPlayer()) return;
        const win = doc.defaultView;
        for (const z of myLands()) {
            const land = doc.getElementById("x" + z.id);
            if (!land) continue;
            const cs = win.getComputedStyle(land);
            const cl = doc.createElement("div");
            cl.className = "de-bm-cluster";
            cl.style.cssText = `left:${cs.left};top:${cs.top};width:${cs.width};height:${cs.height}`;
            const s = liveStats[z.id], pw = computePower(z);
            const atk = s && s.atk != null ? s.atk : pw.atk;   // přesné z a.asp, jinak odhad
            const def = s && s.def != null ? s.def : pw.def;
            const pow = doc.createElement("div");
            pow.className = "de-bm-pow";
            pow.innerHTML = `<span class="a">${svg(IC.sword, 11)}${atk}</span><span class="d">${svg(IC.shield, 11)}${def}</span>`;
            cl.appendChild(pow);
            const btns = doc.createElement("div");
            btns.className = "de-bm-btns";
            const defs = [
                [IC.attack, "Poslat útok", () => startAttack(doc, z)],
                [IC.recruit, "Verbovat", (e) => openRecruit(doc, z, e)],
                [IC.build, "Stavby", (e) => openBuild(doc, z, e)],
            ];
            for (const [ico, tip, fn] of defs) {
                const b = doc.createElement("div");
                b.className = "de-bm-b"; b.title = tip; b.innerHTML = svg(ico, 12);
                b.onclick = (e) => { e.stopPropagation(); fn(e); };
                btns.appendChild(b);
            }
            cl.appendChild(btns);
            land.parentElement.appendChild(cl);
        }
        // potřebná síla (min_utok) na VŠECH neutrálech, na místě vlajky.
        // Nejdřív BATCH čtení pozic (offsetLeft/Top), pak zápis — ať to netrhá layout.
        const items = [];
        for (const z of DATA.zeme) {
            if (!neutralZeme(z) || z.min_utok == null) continue;
            const land = doc.getElementById("x" + z.id);
            if (land) items.push({ m: z.min_utok, land, l: land.offsetLeft, t: land.offsetTop, w: land.offsetWidth, h: land.offsetHeight });
        }
        for (const it of items) {
            const lab = doc.createElement("div");
            lab.className = "de-bm-mlabel";
            lab.style.cssText = `left:${it.l}px;top:${it.t}px;width:${it.w}px;height:${it.h}px`;
            lab.innerHTML = `<span>${it.m}</span>`;
            it.land.parentElement.appendChild(lab);
        }
    }

    // ------------------------------------------------------------- přepínač v mini-menu
    // Celý přepínač = jeden <svg> (zelená dlaždice + meč). <svg> je replaced element
    // jako herní <img> → zarovná se stejně (top) a herní `div{}` ho nebere.
    const MENUBTN_SVG = `<title>Bojový mód</title>
<defs><linearGradient id="de-bm-grad" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#347a46"/><stop offset="0.32" stop-color="#0d4a1e"/><stop offset="0.7" stop-color="#083a17"/><stop offset="1" stop-color="#052a10"/></linearGradient></defs>
<rect x="1" y="1" width="45" height="36" rx="6" fill="url(#de-bm-grad)" stroke="#04180a" stroke-width="1"/>
<rect x="3" y="3" width="41" height="9" rx="4" fill="#8fdc8f" opacity="0.18"/>
<g class="sword" transform="translate(11.5,6)" stroke="#04180a" stroke-linejoin="round">
<path d="M12 2.5 L14 6.5 L14 15 L10 15 L10 6.5 Z" fill="#ffe6a8" stroke-width="1"/>
<path d="M11 6.5 L13 6.5 L13 15 L11 15 Z" fill="#d9a94e" stroke="none"/>
<rect x="6" y="15" width="12" height="2.8" rx="1.2" fill="#e8c060" stroke-width="1"/>
<rect x="10.6" y="17.6" width="2.8" height="3.8" rx="0.6" fill="#5a3a16" stroke-width="0.9"/>
<circle cx="12" cy="21.8" r="1.9" fill="#e8c060" stroke-width="0.9"/></g>
<g class="pbar">
<rect x="6" y="30.5" width="35" height="3.6" rx="1.8" fill="#04180a" opacity="0.8"/>
<rect class="pbar-fill" x="6" y="30.5" width="11" height="3.6" rx="1.8" fill="#ffcf3a"/></g>
<rect class="ring" x="1.5" y="1.5" width="44" height="35" rx="6" fill="none" stroke-width="2.5"/>`;
    function mountToggle(doc) {
        if (doc.getElementById("de-bm-menubtn")) return;
        const mm = doc.getElementById("miniMenuContainer");
        if (!mm) { setTimeout(() => mountToggle(doc), 500); return; }
        const sample = mm.querySelector("img");
        const r = sample ? sample.getBoundingClientRect() : null;
        const w = r && r.width ? Math.round(r.width) : 47, h = r && r.height ? Math.round(r.height) : 38;
        const tg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        tg.setAttribute("id", "de-bm-menubtn");
        tg.setAttribute("class", "miniMenuItem cursorHand" + (dataReady ? "" : " loading"));
        tg.setAttribute("width", w); tg.setAttribute("height", h); tg.setAttribute("viewBox", "0 0 47 38");
        tg.innerHTML = MENUBTN_SVG;
        tg.addEventListener("click", () => {
            if (!dataReady) return; // před dotažením dat neklikatelné (jistota i k pointer-events:none)
            on = !on; tg.classList.toggle("on", on);
            closePanel();
            if (!on) { exitAttack(doc); stopArrowPoll(); render(doc); return; }
            render(doc); // hned z už načtených DATA
            startArrowPoll(doc); // periodicky obnovovat šipky (zrušené/nové útoky z jiného framu)
            fetchData().then(() => { if (on) { render(doc); refreshLiveStats(doc); } }).catch(() => {}); // obnovit na pozadí
        });
        mm.appendChild(tg);
    }

    async function init() {
        const doc = document;
        if (!doc.getElementById("maps")) return; // jen na mapě
        injectStyle(doc);
        mountToggle(doc);                        // hned — ve stavu „loading" (progress bar, neklikatelné)
        let ok = false;
        try { await fetchData(); ok = true; } catch (e) {}
        const btn = doc.getElementById("de-bm-menubtn");
        if (!ok || !isPlayer()) { if (btn) btn.remove(); return; } // pozorovatel/chyba → přepínač pryč
        dataReady = true;
        if (btn) btn.classList.remove("loading"); // povolit klik, skrýt progress
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();

    window.DEbattle = { render: () => render(document), refresh: fetchData };
})();
