// Historie mapy — přepínání zobrazení mapy na minulé herní dny.
//
// Data poskytuje serverless archiv (AWS Lambda + DynamoDB), který po každém
// přepočtu ukládá snímek celé mapy každé ligy. Tento skript přidá do pravého
// horního rohu mapy překlikávátko (◀ Den X ▶ / Dnes) a při volbě minulého dne
// „přehodí" obrázky jednotlivých zemí (vlajka, síla, stavby, války, hrdiny) za
// stav z daného dne. Tlačítko „Dnes" vrátí živou mapu.
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

    let snimky = [];            // přehled dostupných snímků (aktuální věk)
    let idx = 0;                // index v `snimky`; === snimky.length znamená „Dnes"
    let zivyMapsHTML = null;    // záloha živého DOMu mapy pro návrat na „Dnes"
    let label, prevBtn, nextBtn;

    buildPanel();
    loadSnapshots();

    // ---------------------------------------------------------------- UI

    function mkBtn(text) {
        const b = document.createElement("button");
        b.textContent = text;
        Object.assign(b.style, {
            cursor: "pointer", background: "#601010", color: "#f0e0c0",
            border: "1px solid #a05028", borderRadius: "3px",
            font: "bold 13px Arial, sans-serif", padding: "2px 8px", lineHeight: "18px",
        });
        b.onmouseenter = () => (b.style.background = "#803018");
        b.onmouseleave = () => (b.style.background = "#601010");
        return b;
    }

    function buildPanel() {
        const panel = document.createElement("div");
        panel.id = "de-history-panel";
        Object.assign(panel.style, {
            position: "fixed", top: "8px", right: "8px", left: "auto", zIndex: "9999",
            width: "max-content", whiteSpace: "nowrap", boxSizing: "border-box",
            display: "flex", alignItems: "center", gap: "6px",
            background: "#400000", border: "3px solid #220000", borderTopColor: "#521000",
            borderRadius: "4px", padding: "5px 7px", color: "#e8d8b8",
            font: "12px Arial, sans-serif", boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
            userSelect: "none",
        });

        const title = document.createElement("span");
        title.textContent = "Historie:";
        title.style.fontWeight = "bold";

        prevBtn = mkBtn("◀");
        nextBtn = mkBtn("▶");
        const dnesBtn = mkBtn("Dnes");

        label = document.createElement("span");
        label.id = "de-history-label";
        label.textContent = "…";
        Object.assign(label.style, { minWidth: "78px", textAlign: "center" });

        prevBtn.onclick = () => { if (idx > 0) { idx--; show(); } };
        nextBtn.onclick = () => { if (idx < snimky.length) { idx++; show(); } };
        dnesBtn.onclick = () => { idx = snimky.length; show(); };

        panel.append(title, prevBtn, label, nextBtn, dnesBtn);
        document.body.appendChild(panel);
        setBusy(true);
    }

    function setBusy(busy) {
        if (prevBtn) prevBtn.disabled = busy;
        if (nextBtn) nextBtn.disabled = busy;
    }

    // ---------------------------------------------------------------- data

    async function apiGet(path) {
        const r = await fetch(API + path, { method: "GET" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
    }

    async function loadSnapshots() {
        try {
            const res = await apiGet("/stav/" + encodeURIComponent(liga));
            if (Array.isArray(res) && res.length) {
                const maxVek = Math.max(...res.map((s) => Number(s.vek)));
                snimky = res
                    .filter((s) => Number(s.vek) === maxVek)
                    .sort((a, b) => Number(a.den) - Number(b.den));
            }
        } catch (e) {
            console.error("DE historie: nelze načíst přehled", e);
            label.textContent = "chyba API";
            return;
        }
        if (!snimky.length) {
            label.textContent = "bez dat";
            return;
        }
        idx = snimky.length; // start na „Dnes"
        setBusy(false);
        updateLabel();
    }

    function updateLabel(suffix) {
        if (idx >= snimky.length) {
            label.textContent = dnesniDen != null ? "Dnes (den " + dnesniDen + ")" : "Dnes";
        } else {
            label.textContent = "Den " + snimky[idx].den + (suffix || "");
        }
    }

    async function show() {
        if (idx >= snimky.length) {
            restoreLive();
            updateLabel();
            return;
        }
        updateLabel(" …");
        setBusy(true);
        try {
            const snap = await apiGet(
                "/stav/" + encodeURIComponent(liga) + "?snap=" + encodeURIComponent(snimky[idx].snap)
            );
            applySnapshot(snap);
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
            zivyMapsHTML = maps.innerHTML;
        }
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

        // krypty/hrdinové (divy s id "h<číslo>") — nahradit vrstvu za historickou
        const staré = [...maps.querySelectorAll("div[id]")].filter((d) => /^h\d+$/.test(d.id));
        const rodič = staré.length ? staré[0].parentNode : maps;
        staré.forEach((d) => d.remove());
        if (snap.krypty && snap.krypty.length) {
            const holder = document.createElement("div");
            holder.innerHTML = snap.krypty.map((k) => k.html).join("");
            Array.from(holder.childNodes).forEach((n) => rodič.appendChild(n));
        }
    }

    function restoreLive() {
        if (zivyMapsHTML !== null) {
            maps.innerHTML = zivyMapsHTML;
        }
    }
})();
