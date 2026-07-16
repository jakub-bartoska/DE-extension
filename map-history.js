// Historie mapy — přepínání zobrazení mapy na minulé herní dny (i staré epochy).
//
// Data poskytuje serverless archiv (AWS Lambda + DynamoDB), který po každém
// přepočtu ukládá snímek celé mapy každé ligy. Tento skript přidá do pravého
// horního rohu mapy překlikávátko (◀ Den X ▶ / Dnes) a při volbě minulého dne
// „přehodí" obrázky jednotlivých zemí (vlajka, síla, stavby, války, hrdiny) za
// stav z daného dne. Tlačítko „Dnes" vrátí živou mapu.
//
// Když liga dohraje a začne znovu od dne 0, archiv zaznamenává novou „epochu"
// (vek) a stará se nepřepíše. Pokud má liga víc epoch, objeví se navíc
// rozbalovátko „Věk", kterým se lze podívat i na dohrané starší hry.
//
// API je veřejné, read-only, bez klíče (mapa je i tak veřejná přes spectator).

(function () {
    const API = "https://jromqobezam5ot4ixfszrbrjhu0dyjwb.lambda-url.eu-central-1.on.aws";

    const maps = document.getElementById("maps");
    const info = document.getElementById("info_text");
    if (!maps || !info) {
        return; // nejsme na stránce mapy
    }

    // Liga a aktuální den z hlavičky "Liga 1,  herní den 12,  počasí ..."
    const infoText = info.textContent || "";
    const ligaMatch = infoText.match(/Liga\s+([^\s,]+)/i);
    const denMatch = infoText.match(/den\s+(\d+)/i);
    if (!ligaMatch) {
        return;
    }
    const liga = ligaMatch[1];
    const dnesniDen = denMatch ? parseInt(denMatch[1], 10) : null;

    let prehled = [];           // všechny snímky ligy (všechny epochy)
    let veky = [];              // dostupné epochy, vzestupně: [1, 2, ...]
    let aktualniVek = null;     // nejvyšší vek = živá epocha (co je na mapě teď)
    let zvolenyVek = null;      // právě zobrazovaná epocha
    let snimky = [];            // snímky zvolené epochy, seřazené dle dne
    let idx = 0;                // pozice v `snimky`; === snimky.length znamená „živá mapa"
    let zivyMapsHTML = null;    // záloha živého DOMu mapy pro návrat na „Dnes"
    let label, prevBtn, nextBtn, vekSelect;

    buildPanel();
    loadSnapshots();

    // ---------------------------------------------------------------- UI
    //
    // Panel staví sdílený UI kit (window.DEui) — jednotný vzhled se zbytkem
    // rozšíření. Vlevo nahoře… ne, vpravo nahoře, v Shadow DOM hostu.

    function buildPanel() {
        const api = window.DEui.createPanel({
            position: { top: "8px", right: "8px", left: "auto" },
            draggable: true,
            storageKey: "de-history-pos",
        });
        api.show();

        api.panel.appendChild(window.DEui.title("Historie mapy"));

        // rozbalovátko věku (epochy) — skryté, dokud nevíme, že jich je víc
        vekSelect = window.DEui.select((v) => {
            zvolenyVek = Number(v);
            naplnSnimkyVeku();
            show();
        });
        vekSelect.id = "de-history-vek";
        vekSelect.style.display = "none";

        prevBtn = window.DEui.button("◀", () => { if (idx > 0) { idx--; show(); } });
        nextBtn = window.DEui.button("▶", () => { if (idx < maxIdx()) { idx++; show(); } });
        const dnesBtn = window.DEui.button("Dnes", () => {
            zvolenyVek = aktualniVek;
            if (vekSelect) vekSelect.value = String(aktualniVek);
            naplnSnimkyVeku();
            idx = snimky.length; // živá mapa
            show();
        }, { accent: true });

        label = document.createElement("span");
        label.className = "de-label";
        label.id = "de-history-label";
        label.textContent = "…";

        api.panel.appendChild(window.DEui.row(vekSelect, prevBtn, label, nextBtn, dnesBtn));
        setBusy(true);
    }

    function setBusy(busy) {
        if (prevBtn) prevBtn.disabled = busy;
        if (nextBtn) nextBtn.disabled = busy;
    }

    // Nejvyšší povolený index pro danou epochu: u živé epochy je navíc slot
    // „Dnes" (== snimky.length), u starých epoch končíme posledním dnem.
    function maxIdx() {
        return zvolenyVek === aktualniVek ? snimky.length : Math.max(0, snimky.length - 1);
    }

    // ---------------------------------------------------------------- data

    async function apiGet(path) {
        const r = await fetch(API + path, { method: "GET" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
    }

    // Snímek konkrétního dne (dle jeho `snap` klíče), memoizovaně — používá ho
    // jak přehazování času, tak porovnání s předchozím dnem (pruhované obarvení).
    const snapCache = {};
    function fetchSnap(snapKey) {
        if (!(snapKey in snapCache))
            snapCache[snapKey] = apiGet(
                "/stav/" + encodeURIComponent(liga) + "?snap=" + encodeURIComponent(snapKey));
        return snapCache[snapKey];
    }

    // Herní den právě zobrazené mapy (živá = dnešní den).
    function displayedDen() {
        if (zvolenyVek === aktualniVek && idx >= snimky.length) return dnesniDen;
        return snimky[idx] ? Number(snimky[idx].den) : null;
    }

    // Vlastníci všech zemí v herním dni TĚSNĚ PŘED právě zobrazeným (ve stejné
    // epoše). Vrací { landId: zemeZáznam } nebo null, když předchozí den není.
    // Slouží map-fill.js k pruhovanému obarvení nově obsazených zemí.
    async function prevDayOwners() {
        const curDen = displayedDen();
        if (curDen == null) return null;
        let prev = null;
        for (const s of snimky) {
            const d = Number(s.den);
            if (d < curDen && (!prev || d > Number(prev.den))) prev = s;
        }
        if (!prev) return null;
        let snap;
        try { snap = await fetchSnap(prev.snap); } catch (e) { return null; }
        const m = {};
        (snap.zeme || []).forEach((z) => { m[String(z.id)] = z; });
        return m;
    }

    // Prohlížíme živou (dnešní) mapu? Živá = aktuální epocha + slot za posledním
    // dnem. Bojový mód to používá, aby v historii skryl štítky neutrálek (archiv
    // nemá historický min_utok/MO).
    function isLive() {
        return zvolenyVek === aktualniVek && idx >= snimky.length;
    }

    window.DEhistory = { prevDayOwners, isLive };

    async function loadSnapshots() {
        try {
            prehled = await apiGet("/stav/" + encodeURIComponent(liga));
        } catch (e) {
            console.error("DE historie: nelze načíst přehled", e);
            label.textContent = "chyba API";
            return;
        }
        if (!Array.isArray(prehled) || !prehled.length) {
            label.textContent = "bez dat";
            return;
        }

        veky = [...new Set(prehled.map((s) => Number(s.vek)))].sort((a, b) => a - b);
        aktualniVek = Math.max(...veky);
        zvolenyVek = aktualniVek;

        // rozbalovátko věku naplníme jen když je epoch víc než jedna
        if (veky.length > 1) {
            vekSelect.innerHTML = "";
            [...veky].sort((a, b) => b - a).forEach((v) => {
                const opt = document.createElement("option");
                opt.value = String(v);
                opt.textContent = "Věk " + v + (v === aktualniVek ? " (aktuální)" : " (dohráno)");
                vekSelect.appendChild(opt);
            });
            vekSelect.value = String(aktualniVek);
            vekSelect.style.display = "";
        }

        naplnSnimkyVeku();
        idx = snimky.length; // start na „Dnes"
        setBusy(false);
        updateLabel();
        // data máme → pokud už běží obarvení, překreslit (teď umí i pruhy nově
        // obsazených zemí, na které byla dřív potřeba historie).
        reapplyFill();
    }

    function naplnSnimkyVeku() {
        snimky = prehled
            .filter((s) => Number(s.vek) === zvolenyVek)
            .sort((a, b) => Number(a.den) - Number(b.den));
        // u živé epochy začínáme na „Dnes", u staré na jejím posledním dni
        idx = zvolenyVek === aktualniVek ? snimky.length : Math.max(0, snimky.length - 1);
    }

    function updateLabel(suffix) {
        const staraEpocha = zvolenyVek !== aktualniVek;
        const prefix = staraEpocha ? "V" + zvolenyVek + " · " : "";
        if (!staraEpocha && idx >= snimky.length) {
            label.textContent = dnesniDen != null ? "Dnes (den " + dnesniDen + ")" : "Dnes";
        } else if (snimky[idx]) {
            label.textContent = prefix + "Den " + snimky[idx].den + (suffix || "");
        } else {
            label.textContent = "bez dat";
        }
    }

    async function show() {
        // živá mapa (jen u aktuální epochy, na slotu za posledním dnem)
        if (zvolenyVek === aktualniVek && idx >= snimky.length) {
            restoreLive();
            reapplyFill();
            updateLabel();
            return;
        }
        if (!snimky[idx]) { updateLabel(); return; }
        updateLabel(" …");
        setBusy(true);
        try {
            const snap = await fetchSnap(snimky[idx].snap);
            applySnapshot(snap);
            reapplyFill();
            updateLabel();
        } catch (e) {
            console.error("DE historie: nelze načíst snímek", e);
            label.textContent = "chyba";
        } finally {
            setBusy(false);
        }
    }

    // ---------------------------------------------------------------- swap DOMu

    function saveLiveOnce() {
        if (zivyMapsHTML === null) {
            // Fill vrstvu (#de-fill-svg z map-fill.js) do zálohy nezahrnovat —
            // spravuje ji map-fill zvlášť. Dočasně ji vyjmeme, uložíme, vrátíme.
            const fill = maps.querySelector("#de-fill-svg");
            if (fill) fill.remove();
            zivyMapsHTML = maps.innerHTML;
            if (fill) maps.appendChild(fill);
        }
    }

    // Po přehození času překreslit obarvení podle nových vlastníků (pokud běží).
    function reapplyFill() {
        if (window.DEfill && window.DEfill.reapply) window.DEfill.reapply();
        // Překreslit i bojový overlay (clustery) a štítky neutrálek — v historii se
        // štítky skryjí (nemáme historický min_utok/MO), na „Dnes" se zase zobrazí.
        if (window.DEbattle && window.DEbattle.render) window.DEbattle.render();
        if (window.DEbattle && window.DEbattle.reapplyNeutral) window.DEbattle.reapplyNeutral();
    }

    function setAttr(el, name, value) {
        if (value === null || value === undefined) el.removeAttribute(name);
        else el.setAttribute(name, value);
    }

    function applySnapshot(snap) {
        saveLiveOnce();

        // země: přehodit vnitřek + tooltip + majitele/alianci
        (snap.zeme || []).forEach((z) => {
            const el = document.getElementById("x" + z.id)
                || maps.querySelector('.land[data-id="' + z.id + '"]');
            if (!el) return;
            el.innerHTML = z.html;
            setAttr(el, "title", z.title);
            setAttr(el, "data-id_player", z.hrac_id);
            setAttr(el, "data-player", z.hrac);
            setAttr(el, "data-id_alliance", z.aliance_id);
            setAttr(el, "data-alliance", z.aliance);
        });

        // Krypty/hrdinové (divy s id "h<číslo>"): odstranit současné a vložit
        // historické. Pozici h-divu určuje CSS pravidlo #h<id> (top/left) a je
        // position:absolute RELATIVNÍ ke své buňce mapy (position_xN_yN). Proto
        // MUSÍ jít každý do buňky své země (stejné jako land x<id>) — jinak by
        // se umístil úplně jinam (do jiné buňky).
        [...maps.querySelectorAll("div[id]")]
            .filter((d) => /^h\d+$/.test(d.id))
            .forEach((d) => d.remove());
        (snap.krypty || []).forEach((k) => {
            const holder = document.createElement("div");
            holder.innerHTML = k.html;
            const el = holder.firstElementChild;
            if (!el) return;
            const land = document.getElementById("x" + el.id.slice(1));
            (land ? land.parentNode : maps).appendChild(el);
        });
    }

    function restoreLive() {
        if (zivyMapsHTML === null) return;
        // Zachovat fill vrstvu — jinak by ji nahrazení innerHTML zničilo a
        // map-fill by přišel o reference na polygony.
        const fill = maps.querySelector("#de-fill-svg");
        if (fill) fill.remove();
        maps.innerHTML = zivyMapsHTML;
        if (fill) maps.appendChild(fill);
    }
})();
