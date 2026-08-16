// spells-mode.js — Mód kouzel: která z mých seslaných kouzel neprojdou
// ---------------------------------------------------------------------------
// Dvě plochy, jedna logika:
//   1. STRÁNKA MAGIE (magie.asp) — u každého seslaného kouzla v seznamu se
//      připíše, jestli projde. Co neprojde, se označí; co neprojde a NENÍ
//      překouzleno (žádné kouzlo téhož typu na tutéž zem neprojde), se zvýrazní
//      výrazně — to je jediné, s čím může hráč ještě něco udělat.
//   2. MAPA — ikona v mini-menu s odznakem (počet nepřekouzlených propadáků) a
//      po zapnutí štítek u každé mé země: magická obrana + seznam kouzel.
//
// PRAVIDLO PRŮCHODU (nápověda hry + skill darkelf-kouzla):
//   kouzlo projde, když jeho síla > magická obrana země;
//   u POZITIVNÍCH (žlutých) stačí síla > MO/2 — procházejí 2× snáze.
//   Síla jednoho seslání je náhodná v rozmezí, které hra píše jako
//   „Kouzla sesíláš silou: A - B“. Proto má smysl kouzlo hodit znovu: napodruhé
//   může padnout vyšší číslo.
//
// CO ZNAMENÁ „PŘEKOUZLENO“:
//   Hráč, který vidí, že mu Spokojenost neprojde, ji hodí znovu a napodruhé
//   projde. Původní slabé seslání pak nemá cenu hlásit. Kouzla se proto
//   seskupují podle dvojice (země, kouzlo) a řeší se skupina jako celek:
//   projde-li aspoň jedno seslání, je skupina v pořádku.
//
// ZDROJ DAT — `magie.asp?id=<moje zem>` (ověřeno na živé stránce):
//   - seznam seslaných kouzel je jediný `div.ye`; jeden záznam =
//       <span class="mon">Zem - Kouzlo</span> …mezera… <span>SÍLA</span>
//   - `select#cb_my_lands` / `#cb_enemy_lands` dávají mapování názvu země na id
//   - text „Kouzla sesíláš silou: A - B“ = rozpětí síly, „Sesláno kouzel: X / Y“
//   - stránka ukazuje VLASTNÍ seslaná kouzla; cizí kouzla na mě hra před
//     přepočtem neprozradí, takže je mód (správně) neřeší.
//   - `magie.asp?id=` NEPŘEPISUJE session kontext země (změřeno proti
//     nakup.asp), takže se smí stahovat na pozadí. Viz de-context.js.
//
// MAGICKÁ OBRANA — `a.asp?id=<zem>`, řádek „Magická obrana“. a.asp kontext
//   PŘEPISUJE → čte se výhradně přes window.DEctx.
//   MO cizích zemí neznáme; u kouzel mířících ven se proto nic netvrdí („?“).
// ---------------------------------------------------------------------------
(function () {
    "use strict";

    // positive=true → platí poloviční MO. `sure` říká, jestli je to jisté:
    // u žlutých ano (nápověda to říká výslovně), u zelených rasových je to náš
    // odhad podle účinku — u těch se nejistota přizná v popisku.
    const SPELLS = {
        "Magický štít velký": { positive: true, sure: true },
        "Magický štít":       { positive: true, sure: true },
        "Vojenský štít velký":{ positive: true, sure: true },
        "Vojenský štít":      { positive: true, sure: true },
        "Mana na zlato":      { positive: true, sure: true },
        "Spokojenost":        { positive: true, sure: true },
        "Příznivé počasí":    { positive: true, sure: true },
        "Pás zmatení":        { positive: true, sure: true },
        "Magické klima":      { positive: true, sure: true },
        "Požehnání":          { positive: true, sure: true },
        "Ukrást peníze":      { positive: false, sure: true },
        "Ukrást manu":        { positive: false, sure: true },
        "Nespokojenost":      { positive: false, sure: true },
        "Krupobití":          { positive: false, sure: true },
        "Magický vír":        { positive: false, sure: true },
        "Dvojitá Kletba":     { positive: false, sure: true },
        "Kletba":             { positive: false, sure: true },
        "Blesk":              { positive: false, sure: true },
        "Bouře":              { positive: false, sure: true },
        "Černá smrt":         { positive: false, sure: true },
        "Smrtící démon":      { positive: false, sure: true },
        "Zemětřesení":        { positive: false, sure: true },
        "Uragán":             { positive: false, sure: true },
        "Démon kamene":       { positive: false, sure: true },
        "Démon magie":        { positive: false, sure: true },
        "Soudný den":         { positive: false, sure: true },
        "Magický šíp":        { positive: false, sure: false },
        "Strach":             { positive: false, sure: false },
        "Magické oko":        { positive: false, sure: false },
        "Děs obyvatelstva":   { positive: false, sure: false },
        "Odražeč štítů":      { positive: false, sure: false },
        "Povodeň":            { positive: false, sure: false },
        "Zasypání":           { positive: false, sure: false },
        "Nápoj lásky":        { positive: true,  sure: false },
        "Neovlivnitelnost":   { positive: true,  sure: false },
        "Uzdravení":          { positive: true,  sure: false },
        "Zmrtvýchvstání":     { positive: true,  sure: false },
    };
    // Nejdelší první — ať „Kletba“ nepřebije „Dvojitá Kletba“ a „Magický štít“
    // nepřebije „Magický štít velký“.
    const SPELL_NAMES = Object.keys(SPELLS).sort((a, b) => b.length - a.length);

    const onMagie = /\/magie\.asp$/i.test(location.pathname);
    const mo = {};          // landId -> číslo | null (null = neznáme; 0 je platná hodnota!)
    const moPending = {};   // landId -> Promise (ať netaháme a.asp vícekrát)

    // ------------------------------------------------------------- parsování magie.asp
    // Jeden záznam v seznamu: span.mon („Zem - Kouzlo“) + následující <span> se silou.
    function parseCasts(doc, nameToId) {
        const out = [];
        for (const mon of doc.querySelectorAll("div.ye span.mon")) {
            const raw = (mon.textContent || "").replace(/\s+/g, " ").trim();
            const spell = SPELL_NAMES.find((n) => raw.endsWith(n));
            if (!spell) continue;                       // neznámé kouzlo → nehádat
            const landName = raw.slice(0, raw.length - spell.length).replace(/\s*[-–]\s*$/, "").trim();
            const powEl = mon.nextElementSibling;       // přeskočí textový uzel s mezerou
            const power = powEl ? parseInt((powEl.textContent || "").trim(), 10) : NaN;
            const meta = SPELLS[spell];
            out.push({
                landName, landId: nameToId[landName] || null, spell,
                power: isNaN(power) ? null : power,
                positive: meta.positive, sure: meta.sure,
                mon, powEl,                             // uzly pro dokreslení značky
            });
        }
        return out;
    }

    // Název země -> id ze selectů na stránce magie.
    function landMap(doc) {
        const m = {};
        for (const sel of doc.querySelectorAll("#cb_my_lands, #cb_enemy_lands")) {
            for (const o of sel.options) {
                const id = parseInt(o.value, 10);
                const nm = (o.textContent || "").replace(/\s+/g, " ").trim();
                if (id && nm) m[nm] = id;
            }
        }
        return m;
    }
    function myLandIds(doc) {
        const sel = doc.querySelector("#cb_my_lands");
        return sel ? [...sel.options].map((o) => parseInt(o.value, 10)).filter(Boolean) : [];
    }
    function powerRange(doc) {
        const t = (doc.body ? doc.body.textContent : "").replace(/\s+/g, " ");
        const m = t.match(/sesíláš silou:?\s*(\d+)\s*[-–]\s*(\d+)/i);
        return m ? { min: +m[1], max: +m[2] } : null;
    }

    // ------------------------------------------------------------- magická obrana
    function parseMO(html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const t = (doc.body ? doc.body.textContent : "").replace(/\s+/g, " ");
        const m = t.match(/Magick[áa]\s+obrana[^\d-]{0,20}(\d+)/i);
        return m ? parseInt(m[1], 10) : null;
    }
    // a.asp přepisuje kontext → jedině přes DEctx, který ho po sekci vrátí zpět.
    function loadMO(ids) {
        const todo = ids.filter((id) => !(id in mo) && !moPending[id]);
        if (!todo.length) return Promise.all(ids.map((id) => moPending[id] || Promise.resolve()));
        const p = window.DEctx.run(() => Promise.all(todo.map(async (id) => {
            try { mo[id] = parseMO(await window.DEctx.text("a.asp?id=" + id)); }
            catch (e) { mo[id] = null; }
        })));
        todo.forEach((id) => { moPending[id] = p; });
        return p;
    }

    // ------------------------------------------------------------- vyhodnocení
    // true = projde, false = neprojde, null = nevíme (neznámá síla nebo MO).
    function passes(cast) {
        const landMo = cast.landId != null ? mo[cast.landId] : undefined;
        if (cast.power == null || landMo == null || landMo === undefined) return null;
        return cast.power > (cast.positive ? landMo / 2 : landMo);
    }

    // Doplní každému seslání `pass` a skupinový příznak `groupFails`:
    // skupina = (země, kouzlo); groupFails = neprojde ANI JEDNO seslání ve skupině.
    // Právě ta se zvýrazňuje výrazně — jen s ní má hráč ještě co dělat.
    function evaluate(casts) {
        const groups = new Map();
        for (const c of casts) {
            c.pass = passes(c);
            const key = c.landId + "|" + c.spell;
            const g = groups.get(key) || { casts: [], anyPass: false, anyUnknown: false };
            g.casts.push(c);
            if (c.pass === true) g.anyPass = true;
            if (c.pass === null) g.anyUnknown = true;
            groups.set(key, g);
        }
        for (const g of groups.values()) {
            // Varujeme jen když si jsme jistí — při neznámé síle/MO nic netvrdíme.
            g.fails = !g.anyPass && !g.anyUnknown;
            g.casts.forEach((c) => { c.groupFails = g.fails; c.groupSize = g.casts.length; });
        }
        return groups;
    }
    const failCount = (groups) => [...groups.values()].filter((g) => g.fails).length;

    // ============================================================ 1) STRÁNKA MAGIE
    const MAGIE_CSS = `
.de-sp-mark{font:bold 11px Arial;margin-left:5px;padding:0 3px;border-radius:3px;white-space:nowrap}
.de-sp-mark.ok{color:#4fbf4f}
.de-sp-mark.unknown{color:#c8a030}
/* neprojde, ale stejné kouzlo na tu zem už jinde vyšlo → jen ztlumit, nic neřešit */
.de-sp-mark.dead{color:#b06a6a}
.de-sp-dim{opacity:.55}
/* neprojde a NENÍ překouzleno → tohle je to jediné, co hráč musí vidět */
@keyframes de-sp-blink{0%,100%{background:#c0201a}50%{background:#ff3b2e}}
.de-sp-mark.bad{color:#fff;background:#c0201a;padding:1px 5px;
  box-shadow:0 0 0 1px #fff,0 0 6px rgba(255,60,45,.9);animation:de-sp-blink 1s ease-in-out infinite}
.de-sp-hot{outline:2px solid #ff3b2e;outline-offset:1px;border-radius:3px}
.de-sp-sum{margin:6px 0;padding:5px 8px;border-radius:5px;font:bold 12px Arial;
  background:#2a0606;border:1px solid #7a2a24;color:#f0c07a}
.de-sp-sum.bad{border-color:#ff3b2e;color:#ffd0c8}
.de-sp-sum small{display:block;font:400 11px Arial;color:#c8a888;margin-top:2px}`;

    function injectMagieStyle(doc) {
        if (doc.getElementById("de-sp-magie-style")) return;
        const st = doc.createElement("style");
        st.id = "de-sp-magie-style";
        st.textContent = MAGIE_CSS;
        (doc.head || doc.documentElement).appendChild(st);
    }

    function annotateMagie(doc) {
        const ye = doc.querySelector("div.ye");
        if (!ye) return;                                  // žádná seslaná kouzla
        const nameToId = landMap(doc);
        const casts = parseCasts(doc, nameToId);
        if (!casts.length) return;
        injectMagieStyle(doc);

        // MO potřebujeme jen pro cíle, které jsou moje (cizí zemi nepřečteme).
        const mineSet = new Set(myLandIds(doc));
        const need = [...new Set(casts.map((c) => c.landId).filter((id) => id && mineSet.has(id)))];
        loadMO(need).then(() => {
            const groups = evaluate(casts);
            doc.querySelectorAll(".de-sp-mark").forEach((e) => e.remove());
            doc.querySelectorAll(".de-sp-dim,.de-sp-hot").forEach((e) => e.classList.remove("de-sp-dim", "de-sp-hot"));

            for (const c of casts) {
                const span = doc.createElement("span");
                span.className = "de-sp-mark ";
                const landMo = c.landId != null ? mo[c.landId] : undefined;
                const need2 = landMo == null ? null : (c.positive ? landMo / 2 : landMo);
                if (c.pass === null) {
                    span.className += "unknown"; span.textContent = "?";
                    span.title = c.landId && mineSet.has(c.landId)
                        ? "Nepodařilo se zjistit magickou obranu téhle země."
                        : "Cizí zem — její magickou obranu hra neprozradí, takže nevím, jestli kouzlo projde.";
                } else if (c.pass) {
                    span.className += "ok"; span.textContent = "✓";
                    span.title = `Projde: síla ${c.power} > ${need2} (MO ${landMo}${c.positive ? ", pozitivní → poloviční obrana" : ""})`;
                } else if (!c.groupFails) {
                    span.className += "dead"; span.textContent = "✗ překouzleno";
                    span.title = `Neprojde (síla ${c.power}, potřeba přes ${need2}), ale stejné kouzlo na tuhle zem už jinde vyšlo.`;
                    c.mon.classList.add("de-sp-dim");
                } else {
                    span.className += "bad"; span.textContent = "✗ NEPROJDE";
                    span.title = `Síla ${c.power}, potřeba přes ${need2} (MO ${landMo}${c.positive ? ", pozitivní → poloviční obrana" : ""}).`
                        + " Žádné další seslání tohohle kouzla na tuhle zem neprojde — hoď ho znovu.";
                    c.mon.classList.add("de-sp-hot");
                }
                if (!c.sure) span.title += " (Rasové kouzlo — jestli u něj platí poloviční obrana, nápověda neuvádí.)";
                (c.powEl || c.mon).after(span);
            }
            renderSummary(doc, ye, groups, casts);
        });
    }

    // Shrnutí nad seznamem: kolik skupin neprojde a co s tím.
    function renderSummary(doc, ye, groups, casts) {
        doc.getElementById("de-sp-sum")?.remove();
        const n = failCount(groups);
        const box = doc.createElement("div");
        box.id = "de-sp-sum";
        box.className = "de-sp-sum" + (n ? " bad" : "");
        const rng = powerRange(doc);
        if (n) {
            const which = [...groups.values()].filter((g) => g.fails)
                .map((g) => g.casts[0].landName + " – " + g.casts[0].spell);
            box.textContent = "⚠ " + n + (n === 1 ? " kouzlo neprojde" : n < 5 ? " kouzla neprojdou" : " kouzel neprojde") + " a není překouzlené";
            const s = doc.createElement("small");
            s.textContent = which.join(" · ") + (rng ? ` — sesíláš silou ${rng.min}–${rng.max}, zkus je hodit znovu` : "");
            box.appendChild(s);
        } else {
            box.textContent = "✓ Všechna vyhodnocená kouzla projdou";
            const unknown = casts.filter((c) => c.pass === null).length;
            if (unknown) {
                const s = doc.createElement("small");
                s.textContent = unknown + "× nevyhodnoceno (cizí zem nebo neznámá obrana)";
                box.appendChild(s);
            }
        }
        ye.parentNode.insertBefore(box, ye);
    }

    // ============================================================ 2) MAPA
    let on = false, DATA = null, dataReady = false, loaded = false;
    let inlineMax = parseInt(localStorage.getItem("de-sp-inline") || "6", 10) || 6;
    let onlyFails = localStorage.getItem("de-sp-onlyfails") === "1";
    let panelApi = null, panelSeg = null;
    let mapCasts = [], mapGroups = new Map();

    async function fetchData() {
        const j = await (await fetch("map_export_json.asp", { credentials: "include" })).json();
        if (j && j.hlavicka && j.hlavicka.id_hrace && Array.isArray(j.zeme)) DATA = j;
        return DATA;
    }
    const isPlayer = () => DATA && DATA.hlavicka && DATA.hlavicka.id_hrace;
    const myLands = () => DATA.zeme.filter((z) => z.id_hrac === DATA.hlavicka.id_hrace);

    // magie.asp je na kontext neškodná, ale stejně jde přes DEctx kvůli frontě.
    async function loadFromMagie() {
        const lands = myLands();
        if (!lands.length) return;
        const html = await window.DEctx.text("magie.asp?id=" + lands[0].id);
        const doc = new DOMParser().parseFromString(html, "text/html");
        const nameToId = landMap(doc);
        mapCasts = parseCasts(doc, nameToId);
        const mineSet = new Set(myLandIds(doc));
        await loadMO([...new Set(mapCasts.map((c) => c.landId).filter((id) => id && mineSet.has(id)))]);
        // MO i pro moje země bez kouzel — štítek ji ukazuje vždy
        await loadMO(lands.map((z) => z.id));
        mapGroups = evaluate(mapCasts);
    }

    function groupsForLand(landId) {
        const seen = new Map();
        for (const c of mapCasts) {
            if (c.landId !== landId) continue;
            const g = seen.get(c.spell) || { spell: c.spell, casts: [], fails: false, anyPass: false, unknown: false };
            g.casts.push(c);
            if (c.pass === true) g.anyPass = true;
            if (c.pass === null) g.unknown = true;
            g.fails = !!c.groupFails;
            seen.set(c.spell, g);
        }
        for (const g of seen.values()) g.casts.sort((a, b) => (b.power || 0) - (a.power || 0));
        return [...seen.values()];
    }

    function pocetNeprochazejicich() {
        return loaded ? failCount(mapGroups) : 0;
    }

    function updateBadge(doc) {
        const tg = doc.getElementById("de-sp-menubtn");
        if (!tg) return;
        const n = pocetNeprochazejicich();
        let g = tg.querySelector("#de-sp-badge");
        if (!n) { if (g) g.remove(); return; }
        if (!g) {
            g = doc.createElementNS("http://www.w3.org/2000/svg", "g");
            g.setAttribute("id", "de-sp-badge");
            tg.appendChild(g);
        }
        const bw = n > 9 ? 18 : 14, bx = 47 - bw - 1;
        g.innerHTML =
            `<rect x="${bx}" y="0.5" width="${bw}" height="14" rx="7" fill="#e0281f" stroke="#fff" stroke-width="1.2"/>` +
            `<text x="${bx + bw / 2}" y="8.6" fill="#fff" font-family="Arial" font-size="10.5" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${n}</text>`;
    }

    function centerInMaps(doc, id) {
        const el = doc.getElementById("x" + id); if (!el) return null;
        const maps = doc.getElementById("maps");
        let x = 0, y = 0, n = el;
        while (n && n !== maps) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
        return { x: x + el.offsetWidth / 2, y: y + el.offsetHeight / 2 };
    }
    const mark = (g) => (g.fails ? "✗" : g.unknown ? "?" : "✓");

    function render(doc) {
        doc.querySelectorAll(".de-sp-box").forEach((e) => e.remove());
        if (!on || !isPlayer()) return;
        const maps = doc.getElementById("maps"); if (!maps) return;
        for (const z of myLands()) {
            const pos = centerInMaps(doc, z.id); if (!pos) continue;
            let groups = groupsForLand(z.id);
            if (onlyFails) groups = groups.filter((g) => g.fails);
            const landMo = mo[z.id];
            const box = doc.createElement("div");
            box.className = "de-sp-box" + (groups.some((g) => g.fails) ? " has-fail" : "");
            box.style.cssText = `left:${Math.round(pos.x)}px;top:${Math.round(pos.y)}px`;
            const head = doc.createElement("div");
            head.className = "de-sp-head";
            head.textContent = "MO " + (landMo == null ? "?" : landMo) + (groups.length ? " · " + groups.length + "×" : "");
            box.appendChild(head);
            for (const g of groups.slice(0, inlineMax)) {
                const row = doc.createElement("div");
                row.className = "de-sp-row " + (g.fails ? "fail" : g.unknown ? "unknown" : "ok");
                row.textContent = mark(g) + " " + g.spell + " " + (g.casts[0].power == null ? "?" : g.casts[0].power)
                    + (g.casts.length > 1 ? " (" + g.casts.length + "×)" : "");
                box.appendChild(row);
            }
            if (groups.length > inlineMax) {
                const more = doc.createElement("div");
                more.className = "de-sp-more";
                more.textContent = "+" + (groups.length - inlineMax) + " dalších…";
                box.appendChild(more);
            }
            box.title = z.zeme + " — magická obrana " + (landMo == null ? "?" : landMo);
            maps.appendChild(box);
        }
        updateBadge(doc);
    }

    function injectStyle(doc) {
        if (doc.getElementById("de-sp-style")) return;
        const st = doc.createElement("style");
        st.id = "de-sp-style";
        st.textContent = `
#de-sp-menubtn{cursor:pointer;vertical-align:baseline!important;margin:2px!important}
#de-sp-menubtn:hover{filter:brightness(1.12)}
#de-sp-menubtn .ring{stroke:none}
#de-sp-menubtn.on .ring{stroke:#ffcf3a}
#de-sp-menubtn.loading{pointer-events:none;cursor:progress}
#de-sp-menubtn .pbar{display:none}
#de-sp-menubtn.loading .pbar{display:block}
@keyframes de-sp-pbsweep{0%{transform:translateX(0)}100%{transform:translateX(25px)}}
#de-sp-menubtn.loading .pbar-fill{animation:de-sp-pbsweep .8s ease-in-out infinite alternate}
/* Mapa má pravidlo div{position:absolute;39x39} → přebít !important. */
.de-sp-box{position:absolute!important;z-index:18;width:auto!important;height:auto!important;
  margin:0!important;transform:translate(-50%,-50%);min-width:74px;max-width:170px;
  padding:2px 4px!important;border-radius:4px;pointer-events:auto;
  background:rgba(20,6,6,.86);border:1px solid rgba(122,42,36,.9);
  font:600 10px/12px Arial;color:#ecd9b0;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.6)}
/* Vnitřní divy MUSÍ dostat vlastní přebití: herní pravidlo div{} jinak i je
   udělá absolutní 39×39 a všechny řádky se poskládají přes sebe na jedno místo
   (zůstane vidět jen hlavička). Rámeček samotný nestačí. */
.de-sp-box > div{position:static!important;left:auto!important;top:auto!important;
  width:auto!important;height:auto!important;margin:0!important;padding:0!important;
  float:none!important;display:block!important;overflow:visible!important}
.de-sp-box:hover{z-index:22;background:rgba(30,8,8,.97)}
.de-sp-box.has-fail{border-color:#ff5040;box-shadow:0 0 0 1px rgba(255,80,64,.5),0 1px 5px rgba(0,0,0,.7)}
.de-sp-head{font-weight:700;color:#f0c07a;border-bottom:1px solid rgba(122,42,36,.7);margin-bottom:1px;padding-bottom:1px}
.de-sp-row{overflow:hidden;text-overflow:ellipsis}
.de-sp-row.ok{color:#8fd68f;opacity:.75}
.de-sp-row.unknown{color:#e8c060}
@keyframes de-sp-alert{0%,100%{color:#ff8f8f}50%{color:#ff4030}}
.de-sp-row.fail{color:#ff6a55;font-weight:700;animation:de-sp-alert 1.1s ease-in-out infinite}
.de-sp-more{color:#c8a888;font-style:italic}`;
        doc.head.appendChild(st);
    }

    const MENUBTN_SVG = `<title>Kouzla — co neprojde</title>
<defs><linearGradient id="de-sp-grad" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#3d2a6a"/><stop offset="0.35" stop-color="#2a1a4a"/><stop offset="1" stop-color="#170e2c"/></linearGradient></defs>
<rect x="1" y="1" width="45" height="36" rx="6" fill="url(#de-sp-grad)" stroke="#120a22" stroke-width="1"/>
<rect x="3" y="3" width="41" height="9" rx="4" fill="#c8b0ff" opacity="0.14"/>
<g transform="translate(12,7)">
<rect x="9.5" y="6" width="3" height="17" rx="1.5" transform="rotate(20 11 14)" fill="#d8c49a" stroke="#2a1806" stroke-width="0.7"/>
<path d="M7 2 L8.6 6 L12.6 7.6 L8.6 9.2 L7 13.2 L5.4 9.2 L1.4 7.6 L5.4 6 Z" fill="#ffe066" stroke="#8a6a10" stroke-width="0.6"/>
<circle cx="16.5" cy="4" r="1.7" fill="#9fe6ff"/><circle cx="18.5" cy="11" r="1.2" fill="#9fe6ff" opacity="0.8"/></g>
<g class="pbar"><rect x="6" y="30.5" width="35" height="3.6" rx="1.8" fill="#120a22" opacity="0.85"/><rect class="pbar-fill" x="6" y="30.5" width="10" height="3.6" rx="1.8" fill="#b79aff"/></g>
<rect class="ring" x="1.5" y="1.5" width="44" height="35" rx="6" fill="none" stroke-width="2.5"/>`;

    function mountToggle(doc) {
        if (doc.getElementById("de-sp-menubtn")) return;
        const mm = doc.getElementById("miniMenuContainer");
        if (!mm) { setTimeout(() => mountToggle(doc), 500); return; }
        const sample = mm.querySelector("img");
        const r = sample ? sample.getBoundingClientRect() : null;
        const tg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        tg.setAttribute("id", "de-sp-menubtn");
        tg.setAttribute("class", "miniMenuItem cursorHand" + (dataReady ? "" : " loading"));
        tg.setAttribute("width", r && r.width ? Math.round(r.width) : 47);
        tg.setAttribute("height", r && r.height ? Math.round(r.height) : 38);
        tg.setAttribute("viewBox", "0 0 47 38");
        tg.innerHTML = MENUBTN_SVG;
        tg.addEventListener("click", async () => {
            on = !on; tg.classList.toggle("on", on);
            if (!on) { if (panelApi) panelApi.hide(); render(doc); return; }
            if (panelApi) panelApi.show();
            if (!loaded) { try { await loadFromMagie(); loaded = true; } catch (e) {} }
            render(doc);
        });
        mm.appendChild(tg);
    }

    function buildPanel(doc) {
        if (panelApi || !window.DEui) return;
        const api = window.DEui.createPanel({ position: { top: "44px", left: "6px" } });
        api.hide();
        api.panel.appendChild(window.DEui.title("Kouzla — řádků na zemi"));
        panelSeg = window.DEui.segmented(
            [["3", "3"], ["6", "6"], ["99", "Vše"]],
            (v) => { inlineMax = Number(v); localStorage.setItem("de-sp-inline", v); render(doc); },
            String(inlineMax >= 99 ? 99 : inlineMax));
        api.panel.appendChild(window.DEui.row(panelSeg.el));
        api.panel.appendChild(window.DEui.toggle("Jen co neprojde", (v) => {
            onlyFails = v; localStorage.setItem("de-sp-onlyfails", v ? "1" : "0"); render(doc);
        }, onlyFails).el);
        api.panel.appendChild(window.DEui.hr());
        api.panel.appendChild(window.DEui.row(window.DEui.button("Načíst znovu", async () => {
            for (const k in mo) delete mo[k];
            for (const k in moPending) delete moPending[k];
            loaded = false;
            try { await loadFromMagie(); loaded = true; } catch (e) {}
            render(doc);
        })));
        panelApi = api;
    }

    async function preload(doc) {
        for (let i = 0; i < 6 && !isPlayer(); i++) {
            try { await fetchData(); } catch (e) {}
            if (!isPlayer()) await new Promise((r) => setTimeout(r, 2500));
        }
        if (isPlayer()) { try { await loadFromMagie(); loaded = true; } catch (e) {} }
        dataReady = true;
        doc.getElementById("de-sp-menubtn")?.classList.remove("loading");
        updateBadge(doc);
    }

    // ============================================================ start
    function init() {
        if (onMagie) { annotateMagie(document); return; }
        const doc = document;
        if (!doc.getElementById("maps")) return;    // jinde nemáme co dělat
        injectStyle(doc);
        mountToggle(doc);
        buildPanel(doc);
        preload(doc);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();

    window.DEspells = {
        render: () => render(document),
        dump: () => ({ mo, casts: mapCasts.map((c) => ({ z: c.landName, k: c.spell, sila: c.power, projde: c.pass, skupinaNeprojde: c.groupFails })) }),
    };
})();
