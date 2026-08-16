// contracts-mode.js — Mód smluv mezi zeměmi pro darkelf.cz
// ---------------------------------------------------------------------------
// Přepínač = ikona v mapovém mini-menu (#miniMenuContainer), vedle bojového módu.
// V módu se u každé MÉ země zobrazí malé barevné čipy — jeden na každého souseda,
// umístěný směrem k tomu sousedovi (u sdílené hranice). Barva + písmeno = typ
// smlouvy. Klik na čip → popup s dropdownem na změnu (POST smlouvy_zmena.asp).
//
// ČTENÍ dat: smlouvy_export_json.asp — jedno volání pro celou mapu.
//   - sousedi jako ID v s1..s10, smlouvy/nabídky v private.sm*/n*/p*/d*
//   - NEsahá na session kontext země (není a/b/c/utok.asp) → čtení je zadarmo
//     bezpečné, na rozdíl od původního N× GET c.asp. Viz de-context.js.
//   - limit 1×/5 s, cache 2 min → po vlastní změně je JSON zastaralý.
//   - fallback na původní parser c.asp, když API selže NEBO neprojde
//     sebekontrola (viz verifyApi) — kódy typů smluv v API nejsou zdokumentované.
//
// ZÁPIS: beze změny přes c.asp + POST smlouvy_zmena.asp.
//   - funguje jen pro VLASTNÍ země (cizí ukazují jen náhled).
//   - selecty CBoxMojeNabidka jsou POZIČNÍ (i-tý = i-tý soused v pořadí).
//   - zdrojová země POSTu = session kontext → před POSTem GET c.asp?id=X.
//   - POZICI BEREME VŽDY Z ČERSTVÉHO c.asp, ne z API: kdyby s1..s10 mělo díry,
//     poziční POST by nastavil smlouvu úplně jinému sousedovi.
// POZOR: mapa má agresivní `div{position:absolute;39x39}` → čipy v #maps mají
//   geometrii přebitou přes !important (stejně jako battle-mode klastry).
// ---------------------------------------------------------------------------
(function () {
    "use strict";

    // typ smlouvy: value (jako v CBoxMojeNabidka) → popisek, písmeno, barva
    // barvy dle herního dropdownu smluv
    // POZOR na „Zrušena" (5). Nastavit ji NENÍ příkaz „zruš, co tam bylo" — je to
    // vlastní herní akce s následky, podobně jako vyhlásit válku. Ale výsledný STAV
    // je odpad: hranice se Zrušenou je pro hráče stejně bezcenná jako prázdná, a
    // mezi dvěma vlastními zeměmi ji chce vidět zvýrazněnou k opravě.
    //   → v dropdownu je nastavitelná a parser ji musí umět přečíst (jinak by se
    //     „Cesta skurutů Zrušena" načetla jako název země a čip by zmizel),
    //   → ale v modelu ji vedeme jako PRÁZDNOU smlouvu (`empty: true`).
    // Skutečné „nic nenabízím" je hodnota "0" (v herním dropdownu prázdná položka).
    const TYPES = {
        "6": { label: "Válka",         letter: "V",  color: "#d83a30" },
        "3": { label: "Obchodní",      letter: "O",  color: "#e8c21c", text: "#2a2a2a" },
        "2": { label: "Magická",       letter: "M",  color: "#3b74d8" },
        "1": { label: "Vojenská",      letter: "Vo", color: "#e6e6e6", text: "#2a2a2a" },
        "7": { label: "Mír",           letter: "Mí", color: "#3fa64a" },
        "4": { label: "Volný průchod", letter: "Vp", color: "#b552cc" },
        "5": { label: "Zrušena",       letter: "Z",  color: "#8a8a8a", empty: true },
    };
    const NAME2VAL = { "Válka": "6", "Obchodní": "3", "Magická": "2", "Vojenská": "1", "Mír": "7", "Volný průchod": "4", "Zrušena": "5" };
    const TYPE_NAMES = Object.keys(NAME2VAL);
    const ORDER = ["6", "3", "2", "1", "7", "4", "5"]; // pořadí v dropdownu
    const NONE = "0"; // „nenabízet nic" — hodnota prázdné položky herního dropdownu

    // Název typu → jak ho vede model. Prázdné typy (Zrušena) = žádná smlouva.
    const asContract = (name) => (name && !(TYPES[NAME2VAL[name]] || {}).empty) ? name : "";

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
    // Přes DEctx (de-context.js) — fronta + návrat session kontextu. c.asp?id=
    // kontext přepisuje, takže bez fronty si dva požadavky lezou do zelí a hráči
    // pak spadne verbování/stavba do cizí země. Viz hlavička de-context.js.
    const decode = (url, opts) => window.DEctx.text(url, opts);
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
    const myAli = () => DATA.hlavicka.id_aliance;
    const hasAli = () => { const a = myAli(); return a && a !== "0" && a !== 0; }; // "0" = bez aliance
    const isAllied = (id) => { if (!hasAli()) return false; const z = landById(id); return !!z && z.id_aliance === myAli() && z.id_hrac !== myId(); };
    // „doma žádná armáda" — jen u vlastních/aliančních zemí (mají private data); jinak false
    const noArmy = (id) => { const p = (landById(id) || {}).private; return !!p && ((p.doma_war1 || 0) + (p.doma_war2 || 0) + (p.doma_war3 || 0)) === 0; };

    // Klasifikace hranice pro zvýraznění (sdílí render i počítadlo odznaku):
    //   ownEmpty = žádná smlouva mezi vlastní/alianční dvojicí (přidat)
    //   alert    = Válka, nebo Vojenská s oběma zeměmi bez armády (opravit)
    //   incoming = soused mi nabízí jinou smlouvu, než jaká platí (čeká na odpověď)
    //   expiring = smlouva dosluhuje, při přepočtu skončí (potvrdit, ať nespadne)
    // Poslední dvě zná jen API (c.asp je neukazuje) → na fallbacku zůstanou prázdné.
    function classifyBorder(z, it) {
        const friendly = isMine(it.neighborId) || isAllied(it.neighborId);
        // Dohodnutá změna už čeká na přepočet → hráč to vyřešil, nemá co opravovat.
        // Bez tohohle svítilo „oprav válku" i poté, co ji hráč přepnul na Obchodní:
        // platná smlouva je do přepočtu pořád ta stará.
        if (it.pending) return { ownEmpty: false, alert: false, incoming: false, expiring: false, pending: it.pending, transition: "", offered: false };
        // Moje nabídka, na kterou soused ještě neodpověděl. Mezi vlastními zeměmi
        // se dohoda uzavře hned (nastavujeme obě strany), takže tenhle stav vzniká
        // hlavně vůči cizím a aliančním — a může viset klidně den, než to potvrdí.
        // Dokud visí, nemá hráč co dělat → neotravovat ho výzvou k opravě.
        const offered = !!it.offer && it.offer !== it.contract;
        const ownEmpty = !it.contract && friendly && !offered;
        const alert = friendly && !(offered && it.offer !== "Válka")
            && (it.contract === "Válka"
            || (it.contract === "Vojenská" && noArmy(z.id) && noArmy(it.neighborId)));
        const incoming = !!it.incoming && it.incoming !== it.contract;
        // Dosluhující smlouva sama o sobě NENÍ problém — obvykle je to normální
        // přechod (Válka končí, od zítřka platí Obchodní). Vadí jen tehdy, když ji
        // nic nenahrazuje: pak hranice zítra zůstane prázdná.
        const expiring = !!it.expiring && !it.contract && friendly;
        // Probíhající výměna smlouvy: dnes ještě `expiring`, od přepočtu `contract`.
        const transition = (it.expiring && it.contract) ? it.expiring : "";
        return { ownEmpty, alert, incoming, expiring, pending: "", transition, offered };
    }
    // Počet smluv „k opravě/přidání" (unikátní dvojice; může být dvojciferné).
    function pocetZvyraznenych() {
        if (!isPlayer() || !loaded) return 0;
        const seen = new Set();
        let n = 0;
        for (const z of myLands()) for (const it of (contracts[z.id] || [])) {
            if (!it.neighborId) continue;
            const key = Math.min(z.id, it.neighborId) + "-" + Math.max(z.id, it.neighborId);
            if (seen.has(key)) continue;
            seen.add(key);
            const c = classifyBorder(z, it);
            if (c.ownEmpty || c.alert || c.incoming || c.expiring) n++;
        }
        return n;
    }
    // Odznak s počtem na ikoně smluv (červené kolečko; 0 = skryté; dvojčíslí širší).
    function updateBadge(doc) {
        const tg = doc.getElementById("de-ct-menubtn");
        if (!tg) return;
        if (lastSource) tg.dataset.deSrc = lastSource + (apiOk === true ? " (ověřeno)" : apiOk === null ? " (neověřeno)" : "");
        const n = pocetZvyraznenych();
        let g = tg.querySelector("#de-ct-badge");
        if (!n) { if (g) g.remove(); return; }
        if (!g) {
            g = doc.createElementNS("http://www.w3.org/2000/svg", "g");
            g.setAttribute("id", "de-ct-badge");
            tg.appendChild(g);
        }
        const bw = n > 9 ? 18 : 14, bx = 47 - bw - 1;
        g.innerHTML =
            `<rect x="${bx}" y="0.5" width="${bw}" height="14" rx="7" fill="#e0281f" stroke="#fff" stroke-width="1.2"/>` +
            `<text x="${bx + bw / 2}" y="8.6" fill="#fff" font-family="Arial" font-size="10.5" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${n}</text>`;
    }

    // Parsuje c.asp: řádek se sousedem ("Jméno [Typ...]") následovaný řádkem se
    // selectem "nabízíme:". Vrací [{neighbor, contract(name|""), offerVal}].
    function parseContracts(html) {
        const d = new DOMParser().parseFromString(html, "text/html");
        const form = d.querySelector("form"); if (!form) return [];
        const trs = [...form.querySelectorAll("tr")];
        const items = []; let pending = null;
        for (const tr of trs) {
            const sel = tr.querySelector('select[name="CBoxMojeNabidka"]');
            // Select nese MOJI nabídku — díky tomu zná visící nabídku i fallback
            // přes c.asp, ne jen API. (Sousedovu nabídku `p` umí opravdu jen API.)
            if (sel) { if (pending) { pending.offerVal = sel.value; pending.offer = apiType(sel.value) || ""; items.push(pending); pending = null; } continue; }
            const txt = tr.innerText.replace(/\s+/g, " ").trim();
            if (!txt || /^Smlouvy|^Hromadně|^Nabídky/.test(txt)) continue;
            // Typ se z řádku musí odříznout vždy — i „Zrušena", jinak by zůstala
            // součástí názvu země, nedohledal by se soused a čip by na mapě chyběl.
            let name = txt, contract = "";
            for (const t of TYPE_NAMES) { const i = txt.indexOf(t); if (i > 0) { name = txt.slice(0, i).trim(); contract = t; break; } }
            pending = { neighbor: name, contract: asContract(contract) };
        }
        return items;
    }
    // ------------------------------------------------------- API smluv (rychlá cesta)
    // Jedno volání vrátí smlouvy celé mapy. Rate limit hry: 1×/5 s (při překročení
    // vrací JSON s `retry_after`), cache 2 min.
    const CT_API = "smlouvy_export_json.asp";
    const API_GAP = 5200;      // vlastní odstup, ať do limitu vůbec nenarazíme
    let apiAt = 0, apiJson = null, apiWait = null;
    let apiOk = null;          // null = neověřeno, true/false = výsledek sebekontroly
    let apiMiss = 0;           // kolik sebekontrol po sobě neprošlo (2 se odpouští — viz loadFromApi)

    async function fetchApi(force) {
        if (!force && apiJson && Date.now() - apiAt < 90000) return apiJson; // pod herní cache 2 min
        if (apiWait) return apiWait;                                          // souběžná volání sdílí jeden request
        apiWait = (async () => {
            for (let i = 0; i < 3; i++) {
                const gap = API_GAP - (Date.now() - apiAt);
                if (gap > 0) await new Promise((r) => setTimeout(r, gap));
                apiAt = Date.now();
                try {
                    const j = await (await fetch(CT_API, { credentials: "include", cache: "no-store" })).json();
                    if (j && j.retry_after) { await new Promise((r) => setTimeout(r, (+j.retry_after || 5) * 1000)); continue; }
                    const rows = j && (j.smlouvy || j.zeme);
                    if (Array.isArray(rows) && j.hlavicka && j.hlavicka.id_hrace) { apiJson = j; return j; }
                } catch (e) { /* další pokus */ }
            }
            return null;
        })();
        try { return await apiWait; } finally { apiWait = null; }
    }

    // Hodnota typu smlouvy z API → náš název. Kódy nejsou v nápovědě popsané,
    // tak bereme obojí: číslo dropdownu i rovnou název. Cokoli jiného → null =
    // „API nerozumíme", což shodí celé načtení na fallback (radši pomalu než špatně).
    function apiType(v) {
        if (v === null || v === undefined || v === "" || v === 0 || v === "0") return "";
        const s = String(v).trim();
        if (TYPES[s]) return asContract(TYPES[s].label);  // číselný kód jako v CBoxMojeNabidka
        if (NAME2VAL[s]) return asContract(s);            // rovnou název typu
        return null;
    }

    // Řádek API → naše položky. Vrací null, když v datech potkáme neznámý kód.
    // Pozice v poli ODPOVÍDÁ s1..s10 bez děr, ale pro POST se stejně nepoužije
    // (viz hlavička souboru) — identita souseda je vždy neighborId.
    function itemsFromApi(row) {
        const priv = row.private || null;
        const pub = row.public || null;
        const items = [];
        for (let i = 1; i <= 10; i++) {
            const nid = +row["s" + i] || 0;
            if (!nid) continue;
            const contract = apiType(priv ? priv["sm" + i] : null);
            const offer = apiType(priv ? priv["n" + i] : null);
            const incoming = apiType(priv ? priv["p" + i] : null);
            if (contract === null || offer === null || incoming === null) return null;
            const d = priv ? priv["d" + i] : null;
            items.push({
                neighbor: (landById(nid) || {}).zeme || "",
                neighborId: nid,
                contract,
                offerVal: offer ? NAME2VAL[offer] : "0",
                offer,                                               // co nabízím já
                incoming,                                            // co nabízí soused mně
                // Obě strany nabízejí totéž → od přepočtu tam bude tahle smlouva.
                // Do té doby zůstává `contract` starý (např. Válka), a bez tohohle
                // by hráč po opravě dál viděl „oprav smlouvu" u něčeho, co už opravil.
                pending: (offer && offer === incoming && offer !== contract) ? offer : "",
                // POZOR: `d` NENÍ příznak 0/1, ale KÓD TYPU dosluhující smlouvy.
                // Ověřeno na živých datech: sm=3 (Obchodní) + d=6 (Válka) a c.asp
                // u toho píše „Obchodní (platnost od zítřka)“ → dnes ještě platí
                // Válka, od přepočtu Obchodní. `sm` je tedy ta NOVÁ smlouva.
                expiring: apiType(d) || "",                           // název končící smlouvy, "" = nic nekončí
                war: pub ? pub["w" + i] : null,                       // 1 vyhlášená / 0 dosluhující / null
            });
        }
        return items;
    }

    // Sebekontrola: porovnáme API proti jedné reálné c.asp.
    // Kódy typů v API nejsou zdokumentované (v testovací lize byly všechny sm/n/p/d
    // null, takže se nedaly odpozorovat) — kdyby číslovaly jinak než dropdown, tiše
    // bychom hráči ukazovali špatné smlouvy. Radši jeden request navíc.
    //
    // Vrací true = sedí, false = nesedí, **null = nebylo co porovnat**. Shoda dvou
    // prázdných seznamů totiž o kódování nedokazuje nic; kdybychom ji brali jako
    // důkaz, hráč bez smluv by API schválil natrvalo a první uzavřená smlouva by
    // se pak zobrazila neověřeně. Při null zůstáváme neověření a zkusíme to znovu
    // při dalším načtení.
    async function verifyApi(landId, apiItems) {
        const ref = parseContracts(await decode("c.asp?id=" + landId));
        ref.forEach((it) => { it.neighborId = nameToId(it.neighbor); });
        if (ref.length !== apiItems.length) return false;    // jiný počet sousedů → jiná data
        let checked = 0, withContract = 0;
        for (const r of ref) {
            if (!r.neighborId) continue;                     // jméno se nepodařilo zmapovat → přeskočit
            const a = apiItems.find((x) => x.neighborId === r.neighborId);
            if (!a || (a.contract || "") !== (r.contract || "")) return false;
            checked++;
            if (a.contract || r.contract) withContract++;    // tohle už je důkaz o kódování
        }
        if (!checked || !withContract) return null;
        return true;
    }

    // Odkud se naposled načetlo. Content script běží v izolovaném světě, takže
    // z konzole stránky to jinak nezjistíš — proto se to propisuje i do
    // data-atributu tlačítka (viz updateBadge): `data-de-src="api" | "c.asp"`.
    let lastSource = "";

    async function loadContracts(onProgress) {
        if (apiOk !== false && await loadFromApi(onProgress)) { lastSource = "api"; return; }
        await loadFromPages(onProgress);
        lastSource = "c.asp";
    }

    // Země, kde jsme právě měnili smlouvu, mají v API až 2 min starý stav (cache je
    // na serveru, naše invalidace na ni nedosáhne). Držíme si je v localStorage —
    // musí přežít reload stránky, jinak by hráč po změně a obnovení mapy uviděl
    // původní smlouvu. Po vypršení se čtou zase z API.
    const DIRTY_KEY = "de-ct-dirty";
    const DIRTY_MS = 150000; // 2 min cache + rezerva
    function dirtyMap() {
        try {
            const m = JSON.parse(localStorage.getItem(DIRTY_KEY) || "{}");
            const now = Date.now(), out = {};
            for (const k in m) if (m[k] > now) out[k] = m[k];
            return out;
        } catch (e) { return {}; }
    }
    function markDirty(landId) {
        const m = dirtyMap();
        m[landId] = Date.now() + DIRTY_MS;
        try { localStorage.setItem(DIRTY_KEY, JSON.stringify(m)); } catch (e) {}
    }

    // Rychlá cesta: jedno volání API pro všechny moje země. Vrací false → fallback.
    async function loadFromApi(onProgress) {
        const j = await fetchApi(true);
        if (!j) return false;
        const rows = j.smlouvy || j.zeme || [];
        const byId = new Map(rows.map((r) => [+r.id, r]));
        const lands = myLands();
        if (!lands.length) return false;
        const built = {};
        for (const z of lands) {
            const row = byId.get(+z.id);
            if (!row || !row.private) return false;   // bez privátních dat je API k ničemu
            const items = itemsFromApi(row);
            if (!items) return false;                 // neznámý kód typu
            built[z.id] = items;
        }
        if (apiOk !== true) {
            // Sondu NIKDY nedělat na zemi, kterou jsme právě měnili: API má 2min
            // cache, c.asp je živá — u čerstvé změny se neshodnou z principu a
            // nebyla by to chyba kódování.
            const dirty = dirtyMap();
            const cand = lands.filter((z) => !dirty[z.id]);
            // Ověřovat na zemi, která NĚJAKOU smlouvu má — jen ta o kódování něco řekne.
            const probe = cand.find((z) => (built[z.id] || []).some((it) => it.contract)) || cand[0];
            if (probe) {
                let v = null;
                try { v = await verifyApi(probe.id, built[probe.id]); } catch (e) { v = false; }
                if (v === false) {
                    // Neshoda skoro vždy znamená jen zastaralé API (hráč právě něco
                    // změnil, nebo proběhl přepočet), ne špatné kódování. Proto rychlou
                    // cestu NEVYPÍNAT natrvalo po prvním zaškobrtnutí — tentokrát jet
                    // přes c.asp a příště to zkusit znovu. Až když to nesedí opakovaně,
                    // je to nejspíš doopravdy formátem.
                    if (++apiMiss >= 3) {
                        apiOk = false;
                        console.warn("[DE] smlouvy_export_json opakovaně nesedí s c.asp → jedeme přes c.asp");
                    }
                    return false;
                }
                apiMiss = 0;
                apiOk = v; // true = ověřeno; null = nebylo co porovnat, zkusíme příště znovu
            }
        }
        Object.assign(contracts, built);
        // Čerstvě měněné země dočíst z c.asp — API je na ně ještě zastaralé.
        const dirty = dirtyMap();
        const stale = lands.filter((z) => dirty[z.id]);
        if (stale.length) {
            await window.DEctx.run(() => Promise.all(stale.map(async (z) => {
                try { mergeFromPage(z.id, parseContracts(await decode("c.asp?id=" + z.id))); } catch (e) {}
            })));
        }
        if (onProgress) onProgress(lands.length, lands.length);
        return true;
    }

    // Fallback: původní cesta — N× GET c.asp a parsování HTML.
    async function loadFromPages(onProgress) {
        const lands = myLands();
        let done = 0;
        // Paralelně, ale UVNITŘ jedné sekce — c.asp taky renderuje podle svého ?id=
        // (ověřeno 48/48 při plné paralelizaci), takže vadil jen vedlejší efekt na
        // session kontextu; ten uklidí sekce návratem na konci.
        await window.DEctx.run(() => Promise.all(lands.map(async (z) => {
            try {
                const items = parseContracts(await decode("c.asp?id=" + z.id));
                items.forEach((it) => { it.neighborId = nameToId(it.neighbor); });
                contracts[z.id] = items;
            } catch (e) { contracts[z.id] = []; }
            done++; if (onProgress) onProgress(done, lands.length);
        })));
    }

    // Zapsat výsledek čtení z c.asp do contracts[], ale neztratit údaje, které
    // c.asp nezná (příchozí nabídka, dosluhování) — ty umí jen API.
    function mergeFromPage(landId, page) {
        const old = contracts[landId] || [];
        page.forEach((it) => {
            it.neighborId = nameToId(it.neighbor);
            const prev = old.find((x) => x.neighborId === it.neighborId);
            // c.asp tyhle údaje neumí — nese je jen API, tak je nesmíme zahodit.
            if (prev) { it.incoming = prev.incoming; it.expiring = prev.expiring; it.war = prev.war; it.pending = prev.pending; }
        });
        contracts[landId] = page;
        return page;
    }

    // Nastaví MOU nabídku smlouvy k sousedovi (poziční POST). Vrací aktuální stav
    // po přečtení zpět. Zdroj = session kontext (proto GET před POSTem).
    //
    // Souseda adresujeme ID, ne pořadím: pozice se bere až z ČERSTVĚ načtené c.asp.
    // Kdyby index přišel odjinud (z API), mohl by ukazovat na jiného souseda a POST
    // by beze slova nastavil smlouvu jinde.
    async function setOffer(landId, neighborId, newVal) {
        // GET → POST → ověřovací GET musí být JEDNA sekce: mezi GET a POST se nesmí
        // vklínit nic s ?id=, jinak by se smlouva nastavila u úplně jiné země.
        return window.DEctx.run(async () => {
            const items = parseContracts(await decode("c.asp?id=" + landId)); // GET → kontext + pořadí sousedů
            items.forEach((it) => { it.neighborId = nameToId(it.neighbor); });
            const idx = items.findIndex((x) => x.neighborId === neighborId);
            if (idx < 0) throw new Error("souseda nenalezen na c.asp");
            const params = new URLSearchParams();
            items.forEach((_, i) => params.append("CBoxMojeNabidka", i === idx ? String(newVal) : "0"));
            params.append("cbHromadneNastaveni", "0");
            params.append("Nastav", "Nastav smlouvy");
            await window.DEctx.post("smlouvy_zmena.asp", params.toString());
            apiJson = null;                                                   // naše cache pryč…
            markDirty(landId);                                               // …serverová 2min ale zůstává → tuhle zemi číst z c.asp
            const after = parseContracts(await decode("c.asp?id=" + landId)); // ověřit (POST bývá vrtkavý)
            mergeFromPage(landId, after);
            return after.find((x) => x.neighborId === neighborId);
        });
    }

    // Změna smlouvy z popupu: nastaví moji stranu; když je soused taky můj, nastaví
    // i druhou stranu (aby smlouva mezi vlastními zeměmi platila hned).
    async function changeContract(landId, item, newVal) {
        // Celá oboustranná změna jako jedna sekce (vnořené setOffer se na ni navěsí),
        // ať kontext neskáče mezi mojí a sousedovou zemí uprostřed operace.
        return window.DEctx.run(() => changeContractInner(landId, item, newVal));
    }
    async function changeContractInner(landId, item, newVal) {
        await setOffer(landId, item.neighborId, newVal);
        if (isMine(item.neighborId)) {
            await setOffer(item.neighborId, landId, newVal);
            // Moji stranu setOffer re-readnul PŘED nastavením druhé strany → viděl ještě
            // starou dohodnutou smlouvu. Po nastavení OBOU stran ji načteme znovu, ať
            // contracts[landId] (a tím i počet na odznaku) sedí.
            mergeFromPage(landId, parseContracts(await decode("c.asp?id=" + landId)));
        }
        // Zapsat čekající změnu rovnou, ať odznak zhasne hned po kliku. Ze zpětného
        // čtení `c.asp` se to totiž nepozná — platná smlouva je do přepočtu stará
        // a sousedovu nabídku (`p`) umí jen API, které má navíc 2min cache.
        const label = TYPES[newVal] ? asContract(TYPES[newVal].label) : "";
        const fresh = (contracts[landId] || []).find((x) => x.neighborId === item.neighborId);
        if (fresh && label && label !== fresh.contract) {
            // Mezi vlastními zeměmi jsme právě nastavili OBĚ strany → je dohodnuto.
            // U cizí/alianční země jen tehdy, když soused totéž už nabízel.
            if (isMine(item.neighborId) || fresh.incoming === label) fresh.pending = label;
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
        function mkLine(a, b, info, ownEmpty, alert) {
            const line = doc.createElementNS(NS, "line");
            line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
            line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
            line.setAttribute("stroke-dasharray", "3 4");
            if (info) { line.setAttribute("stroke", info.color); line.setAttribute("stroke-width", String(P.cLW)); line.setAttribute("opacity", String(P.cO)); }
            else if (ownEmpty) { line.setAttribute("stroke", "#ffce1f"); line.setAttribute("stroke-width", String(P.cLW)); line.setAttribute("opacity", String(P.oeO)); }
            else { line.setAttribute("stroke", "#c8c8c8"); line.setAttribute("stroke-width", String(P.eLW)); line.setAttribute("opacity", String(P.eO)); }
            if (alert) { line.setAttribute("stroke", "#ff3030"); line.setAttribute("stroke-width", String(P.cLW + 1)); line.setAttribute("opacity", "1"); }
            svg.appendChild(line);
            return line;
        }
        function makeChip(pos, info, srcLand, item, line, titleExtra, cls) {
            const { ownEmpty, alert, incoming, expiring, pending, transition, offered } = cls;
            const chip = doc.createElement("div");
            chip.className = "de-ct-chip " + (info ? "has" : ownEmpty ? "own-empty" : "empty")
                + (alert ? " alert" : "") + (incoming ? " offer-in" : "") + (expiring ? " expiring" : "")
                + (pending || transition ? " pending" : "") + (offered ? " offer-out" : "");
            chip.style.cssText = `left:${Math.round(pos.x)}px;top:${Math.round(pos.y)}px;font-size:${P.fs}px;box-shadow:${P.sh};`
                + (info ? `background:${info.color};opacity:${P.hasOp};` + (info.text ? `color:${info.text};` : "") : "");
            chip.textContent = (info ? info.letter : "+") + (pending || transition ? "›" : offered ? "…" : "");
            // U probíhající výměny ukazujeme NOVOU smlouvu (jako to dělá c.asp
            // popiskem „platnost od zítřka“) a starou zmíníme v popisku.
            chip.title = srcLand.zeme + " ↔ " + item.neighbor + ": " + (info ? info.label : "žádná smlouva") + (titleExtra || "")
                + (transition ? " — dnes ještě " + transition + ", platnost od přepočtu" : "")
                + (pending ? " — dohodnuto, od přepočtu: " + pending : "")
                + (ownEmpty ? " — přidej smlouvu!" : "") + (alert ? " — ⚠ oprav smlouvu!" : "")
                + (offered ? " — nabídl jsi " + item.offer + ", čeká se na souseda" : "")
                + (incoming ? " — 📨 soused nabízí: " + item.incoming : "")
                + (expiring ? " — ⏳ " + item.expiring + " končí přepočtem a nic ji nenahradí!" : "");
            chip.addEventListener("click", (ev) => { ev.stopPropagation(); ev.preventDefault(); openPopup(doc, srcLand, item, ev); });
            const lw = line.getAttribute("stroke-width"), lo = line.getAttribute("opacity");
            chip.addEventListener("mouseenter", () => { line.setAttribute("stroke-width", (parseFloat(lw) + 2).toString()); line.setAttribute("opacity", "1"); line.removeAttribute("stroke-dasharray"); });
            chip.addEventListener("mouseleave", () => { line.setAttribute("stroke-width", lw); line.setAttribute("opacity", lo); line.setAttribute("stroke-dasharray", "3 4"); });
            maps.appendChild(chip);
        }

        const seen = new Set(); // dedup jen u normálních (blízkých) smluv
        for (const z of myLands()) {
            const a = centerInMaps(doc, z.id); if (!a) continue;
            (contracts[z.id] || []).forEach((it) => {
                if (!it.neighborId) return;
                const b = centerInMaps(doc, it.neighborId); if (!b) return;
                const info = it.contract ? TYPES[NAME2VAL[it.contract]] : null;
                const cls = classifyBorder(z, it); // (1) žádná (2) Válka (3) prázdná Vojenská (4) nabídka (5) dosluhuje
                const { ownEmpty, alert } = cls;
                const isPortal = PORTAL_NAMES.size
                    ? (PORTAL_NAMES.has(z.zeme) && PORTAL_NAMES.has(it.neighbor))
                    : (Math.hypot(b.x - a.x, b.y - a.y) > FAR && nearEdge(a) && nearEdge(b));
                if (isPortal) {
                    // PORTÁL: pahýl od TÉTO země k okraji + čip (bez dedup — každá země svůj)
                    const ep = edgePoint(a);
                    makeChip(ep, info, z, it, mkLine(a, ep, info, ownEmpty, alert), " (portál → " + it.neighbor + ")", cls);
                } else {
                    const key = Math.min(z.id, it.neighborId) + "-" + Math.max(z.id, it.neighborId);
                    if (seen.has(key)) return;
                    seen.add(key);
                    makeChip({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, info, z, it, mkLine(a, b, info, ownEmpty, alert), undefined, cls);
                }
            });
        }
        maps.appendChild(svg);
        updateBadge(doc); // po překreslení srovnat počet na odznaku
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
.exp{color:#f0c060}
.row{display:flex;gap:6px;align-items:center}
.sel{flex:1;min-width:0;background:#5a1616;color:#f0e0c0;border:1px solid #7a3030;border-radius:5px;font:600 12px Arial;padding:3px 5px;cursor:pointer}
.set{flex:none;cursor:pointer;border:1px solid #e6a050;border-radius:5px;background:linear-gradient(180deg,#e0842e,#c25a18);color:#fff;font:700 12px Arial;padding:4px 10px}
.set:disabled{opacity:.5;cursor:default}
.msg{margin-top:6px;font-size:11px;min-height:13px;color:#e8c8a8}
.msg.ok{color:#8fd68f}.msg.warn{color:#f0c060}.msg.err{color:#ff8f8f}`;

    // Krátká hláška u horního okraje mapy. Popup se po odeslání zavírá, takže
    // výsledek akce potřebuje kam odejít.
    const TOAST_CSS = `
:host{all:initial}
.box{position:fixed;left:50%;top:14px;transform:translateX(-50%);max-width:70vw;
  background:linear-gradient(180deg,#3a1414,#2a0d0d);border:1px solid #7a2a24;border-radius:7px;
  box-shadow:0 4px 14px rgba(0,0,0,.55);padding:7px 13px;font:600 12px Arial;color:#ecd9b0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.box.ok{border-color:#4d8a4d;color:#c8f0c8}
.box.warn{border-color:#c08a30;color:#f4dca8}`;

    let popup = null;
    function closePopup() { if (popup) { popup.remove(); popup = null; } }
    function toast(doc, text, ok) {
        doc.getElementById("de-ct-toast")?.remove();
        const { host, sh } = shadowHost(doc, TOAST_CSS);
        host.id = "de-ct-toast";
        host.style.cssText = "position:fixed;z-index:100003;left:0;top:0";
        const b = doc.createElement("div");
        b.className = "box " + (ok ? "ok" : "warn");
        b.textContent = (ok ? "✓ " : "") + text;
        sh.appendChild(b);
        doc.body.appendChild(host);
        setTimeout(() => host.remove(), 4000);
    }
    function openPopup(doc, z, item, ev) {
        closePopup();
        const { host, sh } = shadowHost(doc, POPUP_CSS);
        host.style.cssText = `position:fixed;z-index:100001;left:${Math.min(ev.clientX + 12, doc.documentElement.clientWidth - 232)}px;top:${ev.clientY + 12}px`;
        const curVal = item.contract ? NAME2VAL[item.contract] : "";
        const inVal = item.incoming && item.incoming !== item.contract ? NAME2VAL[item.incoming] : "";
        // Předvybíráme sousedovu nabídku (přijmout = jeden klik), jinak platnou
        // smlouvu, jinak „nenabízet". Prázdná položka MUSÍ být první a výchozí:
        // dřív nebylo vybráno nic, prohlížeč ukázal první možnost — Válku — a
        // neopatrný klik na „Nastav" tak rovnou vyhlásil válku.
        // Když smlouva neexistuje, předvybereme to, co hráč v dané situaci skoro
        // vždy chce: mezi vlastními/aliančními zeměmi Obchodní, na hranici s cizím
        // Válku. (Pořadí: sousedova nabídka > platná smlouva > tenhle default.)
        const defVal = item.contract ? ""
            : (isMine(item.neighborId) || isAllied(item.neighborId)) ? NAME2VAL["Obchodní"] : NAME2VAL["Válka"];
        const pick = inVal || curVal || defVal || NONE;
        const opts = `<option value="${NONE}" style="color:#999"${pick === NONE ? " selected" : ""}>— nenabízet —</option>`
            + ORDER.map((v) => `<option value="${v}" style="color:${TYPES[v].color}"${v === pick ? " selected" : ""}>${TYPES[v].label}</option>`).join("");
        const curInfo = item.contract ? TYPES[NAME2VAL[item.contract]] : null;
        const inInfo = inVal ? TYPES[inVal] : null;
        const wrap = doc.createElement("div");
        wrap.className = "wrap";
        wrap.innerHTML = `
            <div class="title">${z.zeme} ↔ ${item.neighbor}</div>
            <div class="cur">Nyní: <b${curInfo ? ` style="color:${curInfo.color}"` : ""}>${curInfo ? curInfo.label : "žádná"}</b>${isMine(item.neighborId) ? ' <span class="own">(vlastní)</span>' : ""}${item.expiring ? ` <span class="exp">⏳ dnes ještě ${item.expiring}</span>` : ""}</div>
            ${item.offer && item.offer !== item.contract ? `<div class="cur">Nabídl jsi: <b style="color:${TYPES[NAME2VAL[item.offer]].color}">${item.offer}</b> <span class="exp">— čeká na souseda</span></div>` : ""}
            ${inInfo ? `<div class="cur">Soused nabízí: <b style="color:${inInfo.color}">${inInfo.label}</b></div>` : ""}
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
                await changeContract(z.id, item, newVal);
                const nowName = ((contracts[z.id] || []).find((x) => x.neighborId === item.neighborId) || {}).contract;
                // "0" = nenabízet, "5" = Zrušena → model obojí vede jako žádnou smlouvu
                const want = TYPES[newVal] ? asContract(TYPES[newVal].label) : "";
                const matches = (nowName || "") === want;
                // Zavřít a překreslit — hráč se chce dívat na mapu, ne na formulář.
                // Výsledek by tím ale zmizel (hlavně to důležité „čeká na druhou
                // stranu"), tak ho řekne krátká hláška nahoře.
                closePopup();
                render(doc);
                toast(doc, z.zeme + " ↔ " + item.neighbor + ": "
                    + (matches ? (nowName || "žádná smlouva")
                               : (nowName || "žádná") + " — odesláno, čeká na druhou stranu"), matches);
            } catch (e) {
                // Při chybě popup NEzavírat, ať ji hráč stihne přečíst.
                msg.textContent = "Chyba: " + e.message; msg.className = "msg err";
                btn.disabled = false;
            }
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
#de-ct-menubtn .pbar{display:none}
#de-ct-menubtn.loading .pbar{display:block}
@keyframes de-ct-pbsweep{0%{transform:translateX(0)}100%{transform:translateX(25px)}}
#de-ct-menubtn.loading .pbar-fill{animation:de-ct-pbsweep .8s ease-in-out infinite alternate}
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
.de-ct-chip.own-empty{background:#ffce1f!important;color:#2a2a2a;font:700 11px Arial;border:2px solid #fff;z-index:16;padding:1px 4px;animation:de-ct-pulse 1.4s ease-in-out infinite}
/* Válka/Vojenská mezi vlastními/aliančními, kde OBĚ země nemají doma armádu — silné varování */
@keyframes de-ct-alert{0%,100%{box-shadow:0 0 0 2px #fff,0 0 6px 2px rgba(255,48,48,.85)}50%{box-shadow:0 0 0 2px #fff,0 0 13px 5px rgba(255,48,48,1)}}
.de-ct-chip.alert{opacity:1!important;z-index:17!important;border:2px solid #fff;animation:de-ct-alert 1s ease-in-out infinite!important}
/* soused mi nabízí jinou smlouvu, než jaká platí — čeká na odpověď (jen z API) */
@keyframes de-ct-offer{0%,100%{box-shadow:0 0 0 2px #fff,0 0 5px 2px rgba(90,220,120,.75)}50%{box-shadow:0 0 0 2px #fff,0 0 11px 4px rgba(90,220,120,1)}}
.de-ct-chip.offer-in{opacity:1!important;z-index:16;border:2px solid #fff;animation:de-ct-offer 1.3s ease-in-out infinite}
.de-ct-chip.offer-in::after{content:"✉";position:absolute;right:-7px;top:-9px;font:700 10px Arial;color:#5adc78;text-shadow:0 0 2px #000,0 0 2px #000}
/* moje nabídka visí a soused ještě neodpověděl — může to trvat i den (jen z API) */
.de-ct-chip.offer-out{opacity:1!important;border:1px dashed #ffb03a;animation:none!important}
/* dohodnutá změna čeká na přepočet — nechat vidět, ale neotravovat (jen z API) */
.de-ct-chip.pending{opacity:1!important;border:1px dashed #7fd0ff;animation:none!important}
/* smlouva dosluhuje — při nejbližším přepočtu skončí (jen z API) */
.de-ct-chip.expiring{opacity:1!important;border-style:dashed;border-color:#ffb03a}
.de-ct-chip.expiring::before{content:"⏳";position:absolute;left:-8px;top:-9px;font:700 10px Arial;text-shadow:0 0 2px #000,0 0 2px #000}`;
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
<g class="pbar"><rect x="6" y="30.5" width="35" height="3.6" rx="1.8" fill="#2a1806" opacity="0.85"/><rect class="pbar-fill" x="6" y="30.5" width="10" height="3.6" rx="1.8" fill="#e8b84a"/></g>
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
        try { await fetchData(); } catch (e) {} // čerstvá armáda (doma_war) → aktuální podmínka „Vojenská + obě prázdné"
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
        mountToggle(doc);   // startuje ve stavu „loading" → progress bar na ikoně
        buildPanel(doc);
        preload(doc);       // přednačíst na pozadí, pak spočítat odznak
    }

    // Přednačtení na pozadí (jako bojový mód): dotáhne data + smlouvy s progress
    // barem na ikoně; po dokončení tlačítko zpřístupní a přidá odznak s počtem
    // smluv „k opravě/přidání".
    async function preload(doc) {
        const okData = await ensureData();
        if (okData && !loaded) {
            try { await loadContracts(); loaded = true; } // bar běží plynule (indeterminate) přes CSS
            catch (e) {}
        }
        dataReady = true;
        const btn = doc.getElementById("de-ct-menubtn");
        if (btn) btn.classList.remove("loading");
        updateBadge(doc);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();

    window.DEcontracts = { render: () => render(document) };
})();
