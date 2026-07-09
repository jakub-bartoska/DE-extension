// contracts-mode.js — Mód smluv mezi zeměmi pro darkelf.cz
// ---------------------------------------------------------------------------
// Přepínač = ikona v mapovém mini-menu (#miniMenuContainer), vedle bojového módu.
// V módu se u každé MÉ země zobrazí malé barevné čipy — jeden na každého souseda,
// umístěný směrem k tomu sousedovi (u sdílené hranice). Barva + písmeno = typ
// smlouvy. Klik na čip → popup s dropdownem na změnu (POST smlouvy_zmena.asp).
//
// Data: c.asp?id=<moje zem> (seznam sousedů + aktuální smlouva + nabídka).
//   - funguje jen pro VLASTNÍ země (cizí ukazují jen náhled).
//   - selecty CBoxMojeNabidka jsou POZIČNÍ (i-tý = i-tý soused v pořadí).
//   - zdrojová země POSTu = session kontext → před POSTem GET c.asp?id=X.
// POZOR: mapa má agresivní `div{position:absolute;39x39}` → čipy v #maps mají
//   geometrii přebitou přes !important (stejně jako battle-mode klastry).
// ---------------------------------------------------------------------------
(function () {
    "use strict";

    // typ smlouvy: value (jako v CBoxMojeNabidka) → popisek, písmeno, barva
    // barvy dle herního dropdownu smluv
    const TYPES = {
        "6": { label: "Válka",         letter: "V",  color: "#d83a30" },
        "3": { label: "Obchodní",      letter: "O",  color: "#e8c21c", text: "#2a2a2a" },
        "2": { label: "Magická",       letter: "M",  color: "#3b74d8" },
        "1": { label: "Vojenská",      letter: "Vo", color: "#e6e6e6", text: "#2a2a2a" },
        "7": { label: "Mír",           letter: "Mí", color: "#3fa64a" },
        "4": { label: "Volný průchod", letter: "Vp", color: "#b552cc" },
    };
    const NAME2VAL = { "Válka": "6", "Obchodní": "3", "Magická": "2", "Vojenská": "1", "Mír": "7", "Volný průchod": "4" };
    const TYPE_NAMES = Object.keys(NAME2VAL);
    const ORDER = ["6", "3", "2", "1", "7", "4"]; // pořadí v dropdownu
    const CANCEL = "5"; // Zrušena

    // Výraznost zobrazení 1–3 (na barevných mapách znázornění zaniká → jde zesílit).
    // cLW/eLW = šířka čar (smlouva/prázdná), cO/oeO/eO = jejich krytí, hasOp = krytí
    // čipů uzavřených smluv, fs = velikost čipu, sh = obrys/stín pro kontrast.
    const INT = {
        1: { cLW: 1,   eLW: 0.8, cO: 0.4, oeO: 0.55, eO: 0.4,  hasOp: 0.6, fs: 10, sh: "0 1px 2px rgba(0,0,0,.5)" },
        2: { cLW: 2,   eLW: 1.4, cO: 0.7, oeO: 0.85, eO: 0.6,  hasOp: 0.9, fs: 11, sh: "0 0 0 1px #000,0 1px 3px rgba(0,0,0,.75)" },
        3: { cLW: 3.2, eLW: 2.2, cO: 1,   oeO: 1,    eO: 0.9,  hasOp: 1,   fs: 12, sh: "0 0 0 1.5px #000,0 1px 4px rgba(0,0,0,.9)" },
    };

    let on = false, DATA = null, dataReady = false, loaded = false;
    let intensity = parseInt(localStorage.getItem("de-ct-intensity") || "1", 10) || 1;
    let panelApi = null, panelSeg = null;
    const contracts = {}; // landId -> [{neighbor, neighborId, contract(name|""), offerVal}]

    // ---------------------------------------------------------------- data
    async function decode(url, opts) {
        const buf = await (await fetch(url, Object.assign({ credentials: "include" }, opts))).arrayBuffer();
        return new TextDecoder("windows-1250").decode(buf);
    }
    async function fetchData() {
        const j = await (await fetch("map_export_json.asp", { credentials: "include" })).json();
        if (j && j.hlavicka && j.hlavicka.id_hrace && Array.isArray(j.zeme)) DATA = j;
        return DATA;
    }
    const isPlayer = () => DATA && DATA.hlavicka && DATA.hlavicka.id_hrace;
    const myId = () => DATA.hlavicka.id_hrace;
    const myLands = () => DATA.zeme.filter((z) => z.id_hrac === myId());
    const landById = (id) => DATA.zeme.find((z) => z.id === id);
    const nameToId = (name) => { const z = DATA.zeme.find((z) => z.zeme === name); return z ? z.id : null; };
    const isMine = (id) => { const z = landById(id); return !!z && z.id_hrac === myId(); };

    // Parsuje c.asp: řádek se sousedem ("Jméno [Typ...]") následovaný řádkem se
    // selectem "nabízíme:". Vrací [{neighbor, contract(name|""), offerVal}].
    function parseContracts(html) {
        const d = new DOMParser().parseFromString(html, "text/html");
        const form = d.querySelector("form"); if (!form) return [];
        const trs = [...form.querySelectorAll("tr")];
        const items = []; let pending = null;
        for (const tr of trs) {
            const sel = tr.querySelector('select[name="CBoxMojeNabidka"]');
            if (sel) { if (pending) { pending.offerVal = sel.value; items.push(pending); pending = null; } continue; }
            const txt = tr.innerText.replace(/\s+/g, " ").trim();
            if (!txt || /^Smlouvy|^Hromadně|^Nabídky/.test(txt)) continue;
            let name = txt, contract = "";
            for (const t of TYPE_NAMES) { const i = txt.indexOf(t); if (i > 0) { name = txt.slice(0, i).trim(); contract = t; break; } }
            pending = { neighbor: name, contract };
        }
        return items;
    }
    async function loadContracts(onProgress) {
        const lands = myLands();
        let done = 0;
        await Promise.all(lands.map(async (z) => {
            try {
                const items = parseContracts(await decode("c.asp?id=" + z.id));
                items.forEach((it) => { it.neighborId = nameToId(it.neighbor); });
                contracts[z.id] = items;
            } catch (e) { contracts[z.id] = []; }
            done++; if (onProgress) onProgress(done, lands.length);
        }));
    }

    // Nastaví MOU nabídku smlouvy k sousedovi (poziční POST). Vrací aktuální stav
    // po přečtení zpět. Zdroj = session kontext (proto GET před POSTem).
    async function setOffer(landId, neighborIndex, newVal) {
        const items = parseContracts(await decode("c.asp?id=" + landId)); // GET → kontext + počet sousedů
        const params = new URLSearchParams();
        items.forEach((_, i) => params.append("CBoxMojeNabidka", i === neighborIndex ? String(newVal) : "0"));
        params.append("cbHromadneNastaveni", "0");
        params.append("Nastav", "Nastav smlouvy");
        await decode("smlouvy_zmena.asp", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
        const after = parseContracts(await decode("c.asp?id=" + landId)); // ověřit (POST bývá vrtkavý)
        after.forEach((it) => { it.neighborId = nameToId(it.neighbor); });
        contracts[landId] = after;
        return after[neighborIndex];
    }

    // Změna smlouvy z popupu: nastaví moji stranu; když je soused taky můj, nastaví
    // i druhou stranu (aby smlouva mezi vlastními zeměmi platila hned).
    async function changeContract(landId, item, neighborIndex, newVal) {
        await setOffer(landId, neighborIndex, newVal);
        if (isMine(item.neighborId)) {
            const myName = (landById(landId) || {}).zeme;
            const nItems = parseContracts(await decode("c.asp?id=" + item.neighborId));
            const backIdx = nItems.findIndex((x) => x.neighbor === myName);
            if (backIdx >= 0) await setOffer(item.neighborId, backIdx, newVal);
        }
    }

    // ---------------------------------------------------------------- render čipů
    function centerInMaps(doc, id) {
        const el = doc.getElementById("x" + id); if (!el) return null;
        const maps = doc.getElementById("maps");
        let x = 0, y = 0, n = el;
        while (n && n !== maps) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
        return { x: x + el.offsetWidth / 2, y: y + el.offsetHeight / 2 };
    }
    function render(doc) {
        doc.querySelectorAll(".de-ct-chip").forEach((e) => e.remove());
        doc.getElementById("de-ct-lines")?.remove();
        if (!on || !intensity || !isPlayer()) return;
        const maps = doc.getElementById("maps"); if (!maps) return;
        const P = INT[intensity] || INT[1]; // parametry dle zvolené výraznosti
        // Skutečný okraj mapy z pozic zemí (scrollWidth/Height je nafouklý → pahýl
        // by přestřelil do vody). min/max středů všech zemí.
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        maps.querySelectorAll('[id^="x"]').forEach((el) => {
            if (!/^x\d+$/.test(el.id)) return;
            let x = 0, y = 0, n = el; while (n && n !== maps) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
            const cx = x + el.offsetWidth / 2, cy = y + el.offsetHeight / 2;
            if (cx < bx0) bx0 = cx; if (cx > bx1) bx1 = cx; if (cy < by0) by0 = cy; if (cy > by1) by1 = cy;
        });
        // Portál spojuje vzdálené krajní země — místo čáry přes celou mapu kreslíme
        // krátký pahýl od portálové země těsně za její okraj mapy s vlastním čipem.
        // Portálové země = ručně ověřený seznam (jména). Fallback (prázdný seznam):
        // obě země u okraje a daleko od sebe.
        const PORTAL_NAMES = new Set([
            "Cesta bohů", "Brána naděje", "Přímořsko", "Modré hory",
            "Jižní cesta", "Jižní cíp", "Oriel el Alb", "Přístav Torment",
            "Posvěcená zem", "Obelisk osudu", "Tajemný portál", "Lesní portál",
        ]);
        const cw = (maps.querySelector('[id^="x"]') || {}).offsetWidth || 39;
        const EDGE_M = cw * 1.6;
        const FAR = Math.min(bx1 - bx0, by1 - by0) * 0.3;
        const nearEdge = (c) => c.x - bx0 < EDGE_M || bx1 - c.x < EDGE_M || c.y - by0 < EDGE_M || by1 - c.y < EDGE_M;
        const NS = "http://www.w3.org/2000/svg";
        const svg = doc.createElementNS(NS, "svg");
        svg.id = "de-ct-lines";
        svg.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:14";

        function edgePoint(c) { // těsně za nejbližší okrajovou zemí (u reálného okraje mapy)
            const pad = cw * 0.6;
            const dL = c.x - bx0, dR = bx1 - c.x, dT = c.y - by0, dB = by1 - c.y, m = Math.min(dL, dR, dT, dB);
            if (m === dL) return { x: bx0 - pad, y: c.y };
            if (m === dR) return { x: bx1 + pad, y: c.y };
            if (m === dT) return { x: c.x, y: by0 - pad };
            return { x: c.x, y: by1 + pad };
        }
        function mkLine(a, b, info, ownEmpty) {
            const line = doc.createElementNS(NS, "line");
            line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
            line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
            line.setAttribute("stroke-dasharray", "3 4");
            if (info) { line.setAttribute("stroke", info.color); line.setAttribute("stroke-width", String(P.cLW)); line.setAttribute("opacity", String(P.cO)); }
            else if (ownEmpty) { line.setAttribute("stroke", "#ffce1f"); line.setAttribute("stroke-width", String(P.cLW)); line.setAttribute("opacity", String(P.oeO)); }
            else { line.setAttribute("stroke", "#c8c8c8"); line.setAttribute("stroke-width", String(P.eLW)); line.setAttribute("opacity", String(P.eO)); }
            svg.appendChild(line);
            return line;
        }
        function makeChip(pos, info, ownEmpty, srcLand, item, idx, line, titleExtra) {
            const chip = doc.createElement("div");
            chip.className = "de-ct-chip " + (info ? "has" : ownEmpty ? "own-empty" : "empty");
            chip.style.cssText = `left:${Math.round(pos.x)}px;top:${Math.round(pos.y)}px;font-size:${P.fs}px;box-shadow:${P.sh};`
                + (info ? `background:${info.color};opacity:${P.hasOp};` + (info.text ? `color:${info.text};` : "") : "");
            chip.textContent = info ? info.letter : "+";
            chip.title = srcLand.zeme + " ↔ " + item.neighbor + ": " + (info ? info.label : "žádná smlouva") + (titleExtra || "") + (ownEmpty ? " — mezi vlastními, přidej!" : "");
            chip.addEventListener("click", (ev) => { ev.stopPropagation(); ev.preventDefault(); openPopup(doc, srcLand, item, idx, ev); });
            const lw = line.getAttribute("stroke-width"), lo = line.getAttribute("opacity");
            chip.addEventListener("mouseenter", () => { line.setAttribute("stroke-width", (parseFloat(lw) + 2).toString()); line.setAttribute("opacity", "1"); line.removeAttribute("stroke-dasharray"); });
            chip.addEventListener("mouseleave", () => { line.setAttribute("stroke-width", lw); line.setAttribute("opacity", lo); line.setAttribute("stroke-dasharray", "3 4"); });
            maps.appendChild(chip);
        }

        const seen = new Set(); // dedup jen u normálních (blízkých) smluv
        for (const z of myLands()) {
            const a = centerInMaps(doc, z.id); if (!a) continue;
            (contracts[z.id] || []).forEach((it, idx) => {
                if (!it.neighborId) return;
                const b = centerInMaps(doc, it.neighborId); if (!b) return;
                const info = it.contract ? TYPES[NAME2VAL[it.contract]] : null;
                const ownEmpty = !info && isMine(it.neighborId); // prázdná mezi vlastními → zvýraznit
                const isPortal = PORTAL_NAMES.size
                    ? (PORTAL_NAMES.has(z.zeme) && PORTAL_NAMES.has(it.neighbor))
                    : (Math.hypot(b.x - a.x, b.y - a.y) > FAR && nearEdge(a) && nearEdge(b));
                if (isPortal) {
                    // PORTÁL: pahýl od TÉTO země k okraji + čip (bez dedup — každá země svůj)
                    const ep = edgePoint(a);
                    makeChip(ep, info, ownEmpty, z, it, idx, mkLine(a, ep, info, ownEmpty), " (portál → " + it.neighbor + ")");
                } else {
                    const key = Math.min(z.id, it.neighborId) + "-" + Math.max(z.id, it.neighborId);
                    if (seen.has(key)) return;
                    seen.add(key);
                    makeChip({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, info, ownEmpty, z, it, idx, mkLine(a, b, info, ownEmpty));
                }
            });
        }
        maps.appendChild(svg);
    }

    // ---------------------------------------------------------------- popup + loader
    // Obsah je v Shadow DOM (host je <section>), aby ho herní pravidlo
    // `div{position:absolute;39x39}` nemanglovalo — jinak byl popup „rozházený".
    function shadowHost(doc, css) {
        const host = doc.createElement("section");
        const sh = host.attachShadow({ mode: "open" });
        const st = doc.createElement("style"); st.textContent = css;
        sh.appendChild(st);
        return { host, sh };
    }
    const POPUP_CSS = `
:host{all:initial}
.wrap{min-width:206px;background:linear-gradient(180deg,#3a1414,#2a0d0d);border:1px solid #7a2a24;border-radius:8px;
  box-shadow:0 6px 18px rgba(0,0,0,.5);padding:10px 12px;font-family:Arial;color:#ecd9b0;font-size:13px}
.title{font-weight:700;color:#f0c07a;font-size:12px;margin-bottom:5px;white-space:nowrap}
.cur{margin-bottom:8px;font-size:12px}
.own{color:#8fc98f}
.row{display:flex;gap:6px;align-items:center}
.sel{flex:1;min-width:0;background:#5a1616;color:#f0e0c0;border:1px solid #7a3030;border-radius:5px;font:600 12px Arial;padding:3px 5px;cursor:pointer}
.set{flex:none;cursor:pointer;border:1px solid #e6a050;border-radius:5px;background:linear-gradient(180deg,#e0842e,#c25a18);color:#fff;font:700 12px Arial;padding:4px 10px}
.set:disabled{opacity:.5;cursor:default}
.msg{margin-top:6px;font-size:11px;min-height:13px;color:#e8c8a8}
.msg.ok{color:#8fd68f}.msg.warn{color:#f0c060}.msg.err{color:#ff8f8f}`;

    let popup = null;
    function closePopup() { if (popup) { popup.remove(); popup = null; } }
    function openPopup(doc, z, item, neighborIndex, ev) {
        closePopup();
        const { host, sh } = shadowHost(doc, POPUP_CSS);
        host.style.cssText = `position:fixed;z-index:100001;left:${Math.min(ev.clientX + 12, doc.documentElement.clientWidth - 232)}px;top:${ev.clientY + 12}px`;
        const curVal = item.contract ? NAME2VAL[item.contract] : "";
        const opts = ORDER.map((v) => `<option value="${v}" style="color:${TYPES[v].color}"${v === curVal ? " selected" : ""}>${TYPES[v].label}</option>`).join("")
            + `<option value="${CANCEL}" style="color:#999">Zrušit smlouvu</option>`;
        const curInfo = item.contract ? TYPES[NAME2VAL[item.contract]] : null;
        const wrap = doc.createElement("div");
        wrap.className = "wrap";
        wrap.innerHTML = `
            <div class="title">${z.zeme} ↔ ${item.neighbor}</div>
            <div class="cur">Nyní: <b${curInfo ? ` style="color:${curInfo.color}"` : ""}>${curInfo ? curInfo.label : "žádná"}</b>${isMine(item.neighborId) ? ' <span class="own">(vlastní)</span>' : ""}</div>
            <div class="row"><select class="sel">${opts}</select><button class="set">Nastav</button></div>
            <div class="msg"></div>`;
        sh.appendChild(wrap);
        doc.body.appendChild(host);
        popup = host;
        const sel = sh.querySelector(".sel"), btn = sh.querySelector(".set"), msg = sh.querySelector(".msg");
        btn.addEventListener("click", async () => {
            const newVal = sel.value;
            btn.disabled = true; msg.textContent = "Nastavuji…"; msg.className = "msg";
            try {
                await changeContract(z.id, item, neighborIndex, newVal);
                const nowName = (contracts[z.id][neighborIndex] || {}).contract;
                render(doc);
                const matches = (nowName || "") === (newVal === CANCEL ? "" : TYPES[newVal].label);
                msg.textContent = matches
                    ? "✓ " + (nowName ? TYPES[NAME2VAL[nowName]].label : "smlouva zrušena")
                    : "Odesláno; nyní: " + (nowName ? TYPES[NAME2VAL[nowName]].label : "žádná") + " (čeká na druhou stranu)";
                msg.className = "msg" + (matches ? " ok" : " warn");
            } catch (e) {
                msg.textContent = "Chyba: " + e.message; msg.className = "msg err";
            }
            btn.disabled = false;
        });
    }

    // Loading indikátor s progress barem (taky Shadow DOM).
    const LOADER_CSS = `
:host{all:initial}
.box{position:fixed;left:50%;top:16px;transform:translateX(-50%);min-width:210px;text-align:center;
  background:linear-gradient(180deg,#3a1414,#2a0d0d);border:1px solid #7a2a24;border-radius:8px;
  box-shadow:0 6px 18px rgba(0,0,0,.5);padding:8px 14px;font:600 12px Arial;color:#f0c07a}
.bar{margin-top:7px;height:6px;border-radius:3px;background:#2a0606;overflow:hidden}
.fill{height:100%;width:40%;border-radius:3px;background:linear-gradient(90deg,#e0842e,#ffcf3a)}
.bar.indet .fill{animation:de-ct-sweep 1s ease-in-out infinite}
@keyframes de-ct-sweep{0%{margin-left:-42%}100%{margin-left:102%}}`;
    function showLoader(doc) {
        hideLoader(doc);
        const { host, sh } = shadowHost(doc, LOADER_CSS);
        host.id = "de-ct-loader";
        host.style.cssText = "position:fixed;z-index:100002;left:0;top:0";
        const box = doc.createElement("div"); box.className = "box";
        box.innerHTML = `<div class="txt">Načítám…</div><div class="bar indet"><div class="fill"></div></div>`;
        sh.appendChild(box);
        doc.body.appendChild(host);
        return {
            setText: (t) => { const e = sh.querySelector(".txt"); if (e) e.textContent = t; },
            setProgress: (done, total) => {
                const bar = sh.querySelector(".bar"), fill = sh.querySelector(".fill");
                if (bar) bar.classList.remove("indet");
                if (fill) { fill.style.marginLeft = "0"; fill.style.width = Math.round((done / total) * 100) + "%"; }
            },
        };
    }
    function hideLoader(doc) { doc.getElementById("de-ct-loader")?.remove(); }

    // ---------------------------------------------------------------- styl
    function injectStyle(doc) {
        if (doc.getElementById("de-ct-style")) return;
        const st = doc.createElement("style");
        st.id = "de-ct-style";
        st.textContent = `
#de-ct-menubtn{cursor:pointer;vertical-align:baseline!important;margin:2px!important}
#de-ct-menubtn:hover{filter:brightness(1.12)}
#de-ct-menubtn .ring{stroke:none}
#de-ct-menubtn.on .ring{stroke:#ffcf3a}
#de-ct-menubtn.loading{pointer-events:none;cursor:progress}
#de-ct-menubtn.loading:hover{filter:none}
.de-ct-chip{position:absolute!important;z-index:15;width:auto!important;height:auto!important;margin:0!important;
  transform:translate(-50%,-50%);min-width:13px;text-align:center;
  font:bold 10px Arial;color:#fff;background:#555;border:1px solid rgba(0,0,0,.5);
  border-radius:4px;padding:1px 3px;line-height:12px;cursor:pointer;pointer-events:auto;
  box-shadow:0 1px 2px rgba(0,0,0,.5);white-space:nowrap}
.de-ct-chip:hover{filter:brightness(1.2);outline:1px solid #fff}
.de-ct-chip.empty{background:rgba(110,110,110,.5);color:#e8e8e8;font-weight:400}
/* uzavřená smlouva — ztlumit (na hover zvýraznit) */
.de-ct-chip.has{opacity:.6;box-shadow:none;border-color:rgba(0,0,0,.3)}
.de-ct-chip.has:hover{opacity:1}
/* prázdná mezi VLASTNÍMI zeměmi — příležitost na obchod, silně zvýraznit */
@keyframes de-ct-pulse{0%,100%{box-shadow:0 0 4px 1px rgba(255,206,31,.6)}50%{box-shadow:0 0 10px 3px rgba(255,206,31,1)}}
.de-ct-chip.own-empty{background:#ffce1f!important;color:#2a2a2a;font:700 11px Arial;border:2px solid #fff;z-index:16;padding:1px 4px;animation:de-ct-pulse 1.4s ease-in-out infinite}`;
        doc.head.appendChild(st);
    }

    // ---------------------------------------------------------------- přepínač
    // Ikona: pergamen se smlouvou (odlišná od meče bojového módu).
    const MENUBTN_SVG = `<title>Smlouvy mezi zeměmi</title>
<defs><linearGradient id="de-ct-grad" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#8a5a2a"/><stop offset="0.35" stop-color="#5a3410"/><stop offset="1" stop-color="#3a220a"/></linearGradient></defs>
<rect x="1" y="1" width="45" height="36" rx="6" fill="url(#de-ct-grad)" stroke="#2a1806" stroke-width="1"/>
<rect x="3" y="3" width="41" height="9" rx="4" fill="#ffd98a" opacity="0.15"/>
<g transform="translate(14,7)">
<rect x="0" y="1" width="19" height="23" rx="2" fill="#f3e2bd" stroke="#2a1806" stroke-width="1"/>
<line x1="3" y1="6" x2="16" y2="6" stroke="#a9855a" stroke-width="1.4"/>
<line x1="3" y1="10" x2="16" y2="10" stroke="#a9855a" stroke-width="1.4"/>
<line x1="3" y1="14" x2="12" y2="14" stroke="#a9855a" stroke-width="1.4"/>
<circle cx="14" cy="20" r="3.4" fill="#c0392b" stroke="#2a1806" stroke-width="0.8"/></g>
<rect class="ring" x="1.5" y="1.5" width="44" height="35" rx="6" fill="none" stroke-width="2.5"/>`;
    function mountToggle(doc) {
        if (doc.getElementById("de-ct-menubtn")) return;
        const mm = doc.getElementById("miniMenuContainer");
        if (!mm) { setTimeout(() => mountToggle(doc), 500); return; }
        const sample = mm.querySelector("img");
        const r = sample ? sample.getBoundingClientRect() : null;
        const w = r && r.width ? Math.round(r.width) : 47, h = r && r.height ? Math.round(r.height) : 38;
        const tg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        tg.setAttribute("id", "de-ct-menubtn");
        tg.setAttribute("class", "miniMenuItem cursorHand" + (dataReady ? "" : " loading"));
        tg.setAttribute("width", w); tg.setAttribute("height", h); tg.setAttribute("viewBox", "0 0 47 38");
        tg.innerHTML = MENUBTN_SVG;
        tg.addEventListener("click", async () => {
            on = !on; tg.classList.toggle("on", on);
            closePopup();
            if (!on) { if (panelApi) panelApi.hide(); hideLoader(doc); render(doc); return; }
            if (panelApi) panelApi.show();
            if (!intensity) { intensity = 1; if (panelSeg) panelSeg.set("1"); localStorage.setItem("de-ct-intensity", "1"); }
            await ensureLoadedAndRender(doc);
        });
        mm.appendChild(tg);
    }

    // panel s přepínačem výraznosti (sdílený UI kit)
    function buildPanel(doc) {
        if (panelApi || !window.DEui) return;
        const api = window.DEui.createPanel({ position: { top: "44px", left: "6px" } });
        api.hide();
        api.panel.appendChild(window.DEui.title("Smlouvy — výraznost"));
        panelSeg = window.DEui.segmented(
            [["0", "Vyp"], ["1", "1"], ["2", "2"], ["3", "3"]],
            (v) => setIntensity(doc, Number(v)),
            String(intensity)
        );
        api.panel.appendChild(window.DEui.row(panelSeg.el));
        panelApi = api;
    }
    function setIntensity(doc, v) {
        intensity = v;
        if (v) localStorage.setItem("de-ct-intensity", String(v));
        render(doc); // v===0 → render se vyprázdní (early-out)
    }
    async function ensureLoadedAndRender(doc) {
        const loader = showLoader(doc);
        loader.setText("Načítám data…");
        const okData = await ensureData(); // retry přes throttle
        if (!okData) { hideLoader(doc); return false; }
        if (!loaded) {
            loader.setText("Načítám smlouvy…");
            await loadContracts((d, t) => { loader.setText(`Načítám smlouvy… ${d}/${t}`); loader.setProgress(d, t); });
            loaded = true;
        }
        hideLoader(doc);
        render(doc);
        return true;
    }

    // zavřít popup klikem mimo / Esc
    document.addEventListener("click", (e) => { if (popup && !popup.contains(e.target) && !(e.target.closest && e.target.closest(".de-ct-chip"))) closePopup(); }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePopup(); });

    // map_export_json.asp je krátce throttlovaný (rychlé opakované volání vrátí
    // prázdno) a navíc soupeříme s battle-mode, který ho tahá taky. Proto data
    // doháníme s prodlevami a tlačítko NIKDY neodstraňujeme kvůli přechodnému
    // výpadku (dřív to mizelo právě když battle-mode zrovna načítal).
    async function ensureData() {
        for (let i = 0; i < 6 && !isPlayer(); i++) {
            try { await fetchData(); } catch (e) {}
            if (!isPlayer()) await new Promise((r) => setTimeout(r, 2500));
        }
        return isPlayer();
    }
    async function init() {
        const doc = document;
        if (!doc.getElementById("maps")) return; // jen na mapě
        injectStyle(doc);
        mountToggle(doc);
        buildPanel(doc);
        dataReady = true; // klikatelné hned; data se dotáhnou líně (ensureData)
        const btn = doc.getElementById("de-ct-menubtn");
        if (btn) btn.classList.remove("loading");
        ensureData(); // na pozadí, bez odstraňování tlačítka
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();

    window.DEcontracts = { render: () => render(document) };
})();
