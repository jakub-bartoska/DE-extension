// Sdílený UI kit pro DE-extension — jednotný vzhled ovládacích panelů.
//
// Všechny panely rozšíření (obarvení území, historie mapy, obarvení dle kouzel)
// používají tyto komponenty, aby vypadaly stejně. Panel se staví do Shadow DOM
// na <section> hostu: mapa má agresivní CSS pravidlo `div{}` (každý div 39×39 px)
// a Shadow DOM obsah před ním izoluje (host není div, takže ho pravidlo nechytí).
//
// window.DEui:
//   createPanel({position})  → {host, shadow, panel, show, hide, toggle, isOpen}
//   title(text)              → nadpis panelu
//   segmented(opts, onChange, initial) → {el, set(value)}   segmentovaný přepínač
//   toggle(label, onChange, initialOn) → {el, set(on)}      on/off switch
//   button(text, onClick, {accent})    → <button>
//   select(onChange)         → <select>
//   row(...children)         → řádek
//   hr()                     → oddělovač

(function () {
    if (window.DEui) return;

    const SHARED_CSS = `
        :host { all: initial; }
        * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; }
        .de-panel { display:flex; flex-direction:column; gap:11px; width:max-content;
            padding:12px 13px; border-radius:9px;
            background:linear-gradient(180deg,#4a0e0e 0%,#380a0a 100%);
            border:1px solid #7a2a24;
            box-shadow:0 6px 18px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,180,120,.12);
            color:#ecd9b0; font-size:13px; white-space:nowrap; }
        .de-title { font-weight:700; font-size:11px; letter-spacing:.09em;
            text-transform:uppercase; color:#f0c07a; opacity:.92; }
        .de-seg { display:inline-flex; padding:3px; gap:3px; border-radius:7px;
            background:#2a0606; box-shadow:inset 0 1px 3px rgba(0,0,0,.5); }
        .de-seg button { cursor:pointer; border:0; background:transparent; color:#e8c8a8;
            font:600 12px Arial,sans-serif; padding:5px 12px; border-radius:5px;
            line-height:16px; transition:.12s; }
        .de-seg button:hover { background:rgba(255,255,255,.06); color:#fff2d8; }
        .de-seg button.active { color:#fff;
            background:linear-gradient(180deg,#e0842e,#c25a18);
            box-shadow:0 1px 3px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,220,170,.5); }
        .de-row { display:flex; align-items:center; gap:7px; }
        .de-btn { cursor:pointer; border:1px solid #7a3030; border-radius:6px;
            background:#5a1616; color:#e8c8a8; font:700 13px Arial,sans-serif;
            padding:5px 11px; line-height:16px; transition:.12s; }
        .de-btn:hover { background:#6e1a1a; color:#fff2d8; }
        .de-btn:disabled { opacity:.45; cursor:default; }
        .de-btn.accent { background:linear-gradient(180deg,#e0842e,#c25a18);
            border-color:#e6a050; color:#fff; }
        .de-btn.accent:hover { background:linear-gradient(180deg,#ec9038,#cc6420); }
        .de-label { min-width:96px; text-align:center; font-weight:600; color:#f4e6c6; }
        .de-select { cursor:pointer; background:#5a1616; color:#f0e0c0;
            border:1px solid #7a3030; border-radius:6px; font:600 12px Arial,sans-serif;
            padding:4px 6px; }
        .de-toggle { display:flex; align-items:center; gap:9px; cursor:pointer;
            user-select:none; }
        .de-switch { position:relative; width:38px; height:21px; border-radius:11px;
            background:#2a0606; border:1px solid #7a3030;
            box-shadow:inset 0 1px 2px rgba(0,0,0,.5); transition:.15s; flex:none; }
        .de-switch::after { content:""; position:absolute; top:2px; left:2px;
            width:15px; height:15px; border-radius:50%; background:#e8d2a6;
            box-shadow:0 1px 2px rgba(0,0,0,.5); transition:.15s; }
        .de-toggle.on .de-switch { background:linear-gradient(180deg,#e0842e,#c25a18);
            border-color:#e6a050; }
        .de-toggle.on .de-switch::after { left:20px; background:#fff4e2; }
        .de-hr { height:1px; margin:1px 0;
            background:linear-gradient(90deg,transparent,#7a3030,transparent); }
    `;

    function createPanel(opts) {
        opts = opts || {};
        const host = document.createElement("section"); // NE div (mapa div mangluje)
        Object.assign(host.style, { position: "fixed", zIndex: "99999" });
        if (opts.position) Object.assign(host.style, opts.position);
        const shadow = host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = SHARED_CSS;
        shadow.appendChild(style);
        const panel = document.createElement("div");
        panel.className = "de-panel";
        shadow.appendChild(panel);
        document.body.appendChild(host);
        return {
            host, shadow, panel,
            show() { host.style.display = "block"; },
            hide() { host.style.display = "none"; },
            toggle() { host.style.display = host.style.display === "none" ? "block" : "none"; },
            isOpen() { return host.style.display !== "none"; },
        };
    }

    function title(text) {
        const d = document.createElement("div");
        d.className = "de-title";
        d.textContent = text;
        return d;
    }

    // options: [[value, label], ...]; onChange(value); initial = value nebo null
    function segmented(options, onChange, initial) {
        const wrap = document.createElement("div");
        wrap.className = "de-seg";
        const btns = {};
        options.forEach(([value, label]) => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = label;
            if (value === initial) b.classList.add("active");
            b.addEventListener("click", () => {
                for (const k in btns) btns[k].classList.toggle("active", k === String(value));
                onChange(value);
            });
            btns[String(value)] = b;
            wrap.appendChild(b);
        });
        return {
            el: wrap,
            set(value) { for (const k in btns) btns[k].classList.toggle("active", k === String(value)); },
        };
    }

    function toggle(label, onChange, initialOn) {
        const l = document.createElement("label");
        l.className = "de-toggle" + (initialOn ? " on" : "");
        const sw = document.createElement("span");
        sw.className = "de-switch";
        l.appendChild(sw);
        l.appendChild(document.createTextNode(label));
        let on = !!initialOn;
        l.addEventListener("click", () => {
            on = !on;
            l.classList.toggle("on", on);
            onChange(on);
        });
        return { el: l, set(v) { on = !!v; l.classList.toggle("on", on); } };
    }

    function button(text, onClick, opts) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "de-btn" + (opts && opts.accent ? " accent" : "");
        b.textContent = text;
        if (onClick) b.addEventListener("click", onClick);
        return b;
    }

    function select(onChange) {
        const s = document.createElement("select");
        s.className = "de-select";
        if (onChange) s.addEventListener("change", () => onChange(s.value));
        return s;
    }

    function row() {
        const d = document.createElement("div");
        d.className = "de-row";
        for (const c of arguments) if (c) d.appendChild(c);
        return d;
    }

    function hr() {
        const d = document.createElement("div");
        d.className = "de-hr";
        return d;
    }

    window.DEui = { SHARED_CSS, createPanel, title, segmented, toggle, button, select, row, hr };
})();
