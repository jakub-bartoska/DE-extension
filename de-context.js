// de-context.js — jediný vlastník „aktivní země" v session hry
// ---------------------------------------------------------------------------
// PROČ TO EXISTUJE (změřeno přímo ve hře, ne odhad):
//   Hra drží vybranou zemi v SERVER SESSION. Přepíše ji každý GET na
//   a.asp / b.asp / c.asp / utok.asp s ?id=.
//   Akční formuláře hry ale žádné `id` neposílají:
//     a.asp → POST nakup.asp (verbování/domy/propouštění): T1,T2,T3,koupit1,
//                                                          koupit2,propustit
//     b.asp → POST b.asp     (stavby):                     CBoxVyvoj,Postavit
//   POST se tedy VŽDY provede na zemi ze session kontextu.
//
//   Pozor na rozdíl mezi STRÁNKOU a CÍLEM POSTU: hráč sedí na a.asp / b.asp
//   (obojí nese ?id= v URL). nakup.asp je jen cíl POSTu — jeho GET přesměruje
//   na a.asp a `id` přitom zahodí, takže hráč na něm nikdy není a strážce tam
//   nepatří. (Na tomhle jsem se poprvé spálil: strážce visel na nakup.asp
//   a nikdy se neinstaloval.)
//
//   Důsledek: když si extension na pozadí načte data všech zemí (Promise.all
//   přes a.asp?id=…), přepíše hráči vybranou zemi — a jeho další verbování nebo
//   stavba se provede jinde. Vítěz té dávky je náhodný (6 měření: 3× / 3×),
//   takže hráč vidí „přehazuje mi to na jednu konkrétní zemku".
//
//   Stejná bota hrozí i nám samotným: openRecruit/openBuild udělají GET ?id=X
//   při otevření panelu, ale POST až když hráč klikne — klidně o půl minuty
//   později. `id` v našem POSTu to nezachrání, protože ho server ignoruje.
//
// ŘEŠENÍ — čtyři vrstvy, teprve dohromady dávají jistotu:
//   1. FRONTA  — nic, co sahá na kontext, neběží souběžně (žádné Promise.all)
//   2. SEKCE   — GET ?id=X a navazující POST drží zámek, nikdo se mezi ně nevklíní
//   3. NÁVRAT  — po každé sekci se kontext vrátí na zemi, kterou má hráč otevřenou
//   4. ODESLÁNÍ— herní formulář si těsně před POSTem potvrdí kontext podle toho,
//                co je vidět na stránce → „co vidíš, to se stane"
//
//   Vrstva 4 je ta, která dělá záruku úplnou: vrstvy 1–3 zkrátí špatné okno
//   z „navždy" na dobu dávky (~0,5–2 s), ale nezavřou případ, kdy hráč klikne
//   uprostřed ní, ani případ, kdy neznáme zemi pro návrat.
//
// KOORDINACE MEZI FRAMY: mapa a herní menu jsou různé framy. Jedou přes
//   localStorage (stejný origin): mapový frame drží „de-ctx-busy", interceptor
//   na něj počká; interceptor drží „de-ctx-hold", fronta ho respektuje.
//   Oba příznaky mají časové razítko — po zastarání se ignorují, aby mrtvý frame
//   nikdy nezablokoval hráči odeslání formuláře.
// ---------------------------------------------------------------------------
(function () {
    "use strict";

    const BUSY_KEY = "de-ctx-busy";    // mapový frame právě sahá na kontext
    const HOLD_KEY = "de-ctx-hold";    // herní frame se chystá odeslat formulář
    const LAND_KEY = "de-ctx-land";    // země, kterou má hráč naposledy otevřenou
    const NAMES_KEY = "de-ctx-names";  // název země -> id (plní mapový frame)
    const BUSY_STALE = 15000;          // mrtvý mapový frame neblokuje déle než tohle
    const HOLD_STALE = 4000;
    const SUBMIT_CAP = 4000;           // strop čekání před odesláním formuláře

    // stránky, jejichž GET s ?id= přepíše session kontext (nakup.asp mezi ně NEpatří)
    const CTX_SETTER = /\b(a|b|c|utok)\.asp\?[^#]*\bid=(\d+)/i;

    const now = () => Date.now();
    const fresh = (key, stale) => { const v = +(localStorage.getItem(key) || 0); return v && now() - v < stale; };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // ------------------------------------------------------------ syrový fetch
    // cache:no-store — herní stránky musí být vždy čerstvé, jinak by prohlížeč
    // po odeslání akce vrátil starý stav.
    async function raw(url, opts) {
        const r = await fetch(url, Object.assign({ credentials: "include", cache: "no-store" }, opts));
        return new TextDecoder("windows-1250").decode(await r.arrayBuffer());
    }

    // ------------------------------------------------------- hráčova země
    // Zapisujeme JEN podle toho, co hráč reálně vidí (URL framu / obsah stránky).
    // Naše requesty na pozadí frame nenavigují, takže sem nepropadnou.
    function noteLand(id) {
        if (!id) return;
        try { localStorage.setItem(LAND_KEY, String(id)); } catch (e) {}
    }
    function playerLand() {
        const v = +(localStorage.getItem(LAND_KEY) || 0);
        return v || null;
    }
    function setNames(pairs) { // [{name,id}] z map_export_json (má je jen mapový frame)
        try { localStorage.setItem(NAMES_KEY, JSON.stringify(pairs)); } catch (e) {}
    }
    function names() {
        try {
            const a = JSON.parse(localStorage.getItem(NAMES_KEY) || "[]");
            // nejdelší první — ať „Ústí" nepřebije „Ústí nad Řekou"
            return Array.isArray(a) ? a.sort((x, y) => y.name.length - x.name.length) : [];
        } catch (e) { return []; }
    }

    // ------------------------------------------------------------ fronta + sekce
    let chain = Promise.resolve();
    let depth = 0;        // >0 = běžíme uvnitř sekce
    let touched = 0;      // kolik requestů v sekci sáhlo na kontext
    let lastCtx = null;   // id z posledního z nich (spolehlivé jen když touched === 1)

    // Serializuje `fn`. Uvnitř sekce se kontext smí libovolně přepínat; na konci
    // se vrátí na hráčovu zemi. Vnořené volání se navěsí na běžící sekci (bez
    // dalšího zámku), aby run() uvnitř run() nezatuhl.
    function run(fn) {
        if (depth > 0) return fn();
        const step = chain.then(async () => {
            // nevlézt frontě do cesty, když se herní frame chystá odeslat formulář
            for (let i = 0; i < 40 && fresh(HOLD_KEY, HOLD_STALE); i++) await sleep(25);
            depth++; touched = 0; lastCtx = null;
            try { localStorage.setItem(BUSY_KEY, String(now())); } catch (e) {}
            try {
                return await fn();
            } finally {
                try { await restore(); } catch (e) {}
                depth--;
                try { localStorage.removeItem(BUSY_KEY); } catch (e) {}
            }
        });
        // řetěz nesmí umřít na chybě jedné sekce
        chain = step.then(() => {}, () => {});
        return step;
    }

    // Vrátí kontext na zemi, kterou má hráč otevřenou. Když ji neznáme, necháme
    // to být — vrstva 4 (interceptor) si stejně kontext potvrdí sama.
    //
    // Návrat se smí přeskočit JEN když sekce sáhla na kontext jediným requestem
    // a mířil na hráčovu zemi. Při víc requestech nevíme, který server zpracoval
    // poslední (uvnitř sekce běží čtení klidně paralelně), takže `lastCtx` by lhal
    // a přeskočením bychom nechali kontext rozbitý — přesně ta původní bota.
    async function restore() {
        const land = playerLand();
        if (!touched || !land) return;
        if (touched === 1 && String(lastCtx) === String(land)) return;
        await raw("a.asp?id=" + land);
        touched = 0; lastCtx = null;
    }

    // Text stránky. Mimo sekci se sám zabalí do vlastní sekce (a tím i do fronty
    // a návratu kontextu) — díky tomu jsou i staré call-sity bezpečné.
    function text(url, opts) {
        if (depth > 0) {
            const m = String(url).match(CTX_SETTER);
            if (m) { touched++; lastCtx = m[2]; }
            return raw(url, opts);
        }
        return run(() => text(url, opts));
    }

    // POST herní akce. Musí běžet ve stejné sekci jako GET, který nastavil kontext.
    function post(url, body) {
        return text(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: typeof body === "string" ? body : new URLSearchParams(body).toString(),
        });
    }

    // ------------------------------------------------ vrstva 4: pojistka na formuláři
    // Kterou zemi má stránka před sebou? a.asp i b.asp ji nesou v URL. Po odeslání
    // formuláře ale server přesměruje na a.asp UŽ BEZ id — pak zemi čteme z textu
    // („Vojsko <název>" / „Stavby v <název>"). Porovnáváme proti známým názvům,
    // ne regexem na konec řádku, ať nás nerozhodí formátování stránky.
    function landOfPage() {
        const m = location.search.match(/[?&]id=(\d+)/);
        if (m && /\/(a|b|c)\.asp$/.test(location.pathname.toLowerCase())) return +m[1];
        const t = (document.body && document.body.innerText || "").replace(/\s+/g, " ");
        for (const lead of ["Vojsko ", "Stavby v "]) {
            const i = t.indexOf(lead);
            if (i < 0) continue;
            const head = t.slice(i + lead.length);
            for (const n of names()) if (head.indexOf(n.name) === 0) return n.id;
        }
        return null;
    }

    async function waitIdle() {
        const t0 = now();
        while (fresh(BUSY_KEY, BUSY_STALE) && now() - t0 < SUBMIT_CAP) await sleep(25);
    }

    // Hlídá odeslání herních formulářů na STRÁNKÁCH, kde hráč reálně je: a.asp
    // (verbování/domy/propouštění) a b.asp (stavby). Chová se FAIL-OPEN: jakmile
    // si nejsme jistí (neznámá země, chyba), formulář pustíme beze změny —
    // extension nikdy nesmí hráči zabránit v akci.
    function installGuard() {
        if (!/\/(a|b)\.asp$/.test(location.pathname.toLowerCase())) return;
        let pressed = null;

        document.addEventListener("click", (e) => {
            const t = e.target;
            if (!t || !t.closest) return;
            const b = t.closest('input[type="submit"],input[type="image"],button');
            if (b && b.form) pressed = b;
        }, true);

        document.addEventListener("submit", (e) => {
            const form = e.target;
            if (!form || form.dataset.deSent === "1") return; // naše vlastní odeslání
            const land = landOfPage();
            if (!land) return;                                // neznáme zemi → nezasahovat
            // Které tlačítko akci spustilo. `e.submitter` je autoritativní a pokrývá
            // i odeslání Enterem; klik si držíme jen jako záložku. Když to nevíme,
            // NEZASAHUJEME: programové odeslání by muselo tlačítko uhodnout a mýlka
            // mezi koupit1 (domy) a koupit2 (verbování) by provedla úplně jinou akci.
            // Nechráněné odeslání je vždycky lepší než odeslání špatné akce.
            const btn = e.submitter || (pressed && pressed.form === form ? pressed : null);
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            (async () => {
                try {
                    try { localStorage.setItem(HOLD_KEY, String(now())); } catch (err) {}
                    await waitIdle();
                    await raw("a.asp?id=" + land);            // kontext = to, co hráč vidí
                    noteLand(land);
                } catch (err) { /* fail-open: odešli i tak */ }
                try { localStorage.removeItem(HOLD_KEY); } catch (err) {}
                // Programové form.submit() zahodí jméno stisknutého tlačítka
                // (koupit1 × koupit2 × propustit × Postavit) a server by nepoznal
                // akci → doplníme ho skrytým polem.
                if (btn.name) {
                    const h = document.createElement("input");
                    h.type = "hidden"; h.name = btn.name; h.value = btn.value;
                    form.appendChild(h);
                }
                form.dataset.deSent = "1";
                form.submit();
            })();
        }, true);
    }

    // Zaznamenat zemi, kterou hráč právě otevřel (navigace framu = hráčova volba).
    function noteFromLocation() {
        const m = (location.pathname + location.search).match(CTX_SETTER);
        if (m) { noteLand(+m[2]); return; }
        const l = landOfPage();
        if (l) noteLand(l);
    }

    window.DEctx = { run, text, post, noteLand, playerLand, setNames, landOfPage };

    noteFromLocation();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installGuard);
    else installGuard();
})();
