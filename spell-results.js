(function () {
    let allReports = [];
    let borderCertainColor = 'rgba(0, 255, 0, 1)';
    let borderNotSureColor = 'rgb(255,255,0, 1)';

    let neutralColor = 'rgba(200, 200, 200, 0.4)';
    let positiveColor = 'rgba(0, 255, 0, 0.4)';
    let slightlyNegativeColor = 'rgba(255, 255, 0, 0.4)';
    let negativeColor = 'rgba(255, 0, 0, 0.4)';

    let panelApi = null;

    // až po deklaracích výše (buildPanel plní `panelApi` — nesmí běžet v TDZ)
    addMenuButtons();

    function addMenuButtons() {
        let menu = document.getElementById("miniMenuContainer");
        if (!menu) {
            return;
        }
        menu.appendChild(createMenuItem());
        buildPanel();
    }

    function createMenuItem() {
        let img = document.createElement("img");
        img.src = "../images/mapy/but_map_menu.gif";
        img.className = "miniMenuItem cursorHand";
        img.width = 47;
        img.height = 38;
        img.id = "natality-button";

        img.addEventListener("click", () => displayDropdown());

        return img;
    }

    // Panel staví sdílený UI kit (window.DEui) do Shadow DOM — jednotný vzhled
    // se zbytkem rozšíření a izolace od herního CSS.
    function buildPanel() {
        panelApi = window.DEui.createPanel({ position: { display: "none" } });
        panelApi.panel.appendChild(window.DEui.title("Obarvit dle kouzel"));
        const seg = window.DEui.segmented(
            [["Porodnost", "Porodnost"], ["Zlato", "Zlato"], ["Mana", "Mana"], ["Nic", "Nic"]],
            (val) => {
                if (window.DEfill) {
                    window.DEfill.ready().then(() => window.DEfill.clearAll());
                }
                if (val !== "Nic") {
                    displaySpellResults(val);
                }
            }, null);
        panelApi.panel.appendChild(seg.el);
    }

    function displayDropdown() {
        if (!panelApi) return;
        if (!panelApi.isOpen()) {
            const r = document.getElementById("natality-button").getBoundingClientRect();
            panelApi.host.style.left = Math.round(r.left) + "px";
            panelApi.host.style.top = Math.round(r.bottom + 5) + "px";
        }
        panelApi.toggle();
    }

    function displaySpellResults(type) {
        (async () => {
            await getAllReports();
            let lands = document.getElementById("maps").getElementsByClassName("land");
            for (let land of lands) {
                var attribute = getAttributeByType(type);
                if (land.hasAttribute(attribute)) {
                    colorOwnLand(land, attribute);
                    continue;
                }
                colorLandFromReport(land, type);
            }
        })();
    }

    function colorOwnLand(land, attribute) {
        let value = Number(land.getAttribute(attribute));
        if (value === 100) {
            addBackground(land, neutralColor, borderCertainColor);
        } else if (value > 100) {
            addBackground(land, positiveColor, borderCertainColor);
        } else if (value < 100) {
            addBackground(land, negativeColor, borderCertainColor);
        } else {
            console.log("unknown value")
        }
    }

    let allLandNamesCache = null;

    function getAllLandNames() {
        if (!allLandNamesCache) {
            let lands = document.getElementById("maps").getElementsByClassName("land");
            allLandNamesCache = [...new Set(
                [...lands].map(l => l.getAttribute("data-name")).filter(Boolean)
            )];
        }
        return allLandNamesCache;
    }

    // Zem se v hlaseni pozna podle nazvu. Nazvy ale casto byvaji prefixem jinych
    // (napr. "Usti" vs "Usti nad Labem") a pouhy includes() by radek pripsal obema.
    // Radek proto pocitame pro danou zem jen tehdy, kdyz NEobsahuje jiny, delsi
    // nazev zeme, ktery tento nazev v sobe ma (tzn. vyhrava nejdelsi shoda).
    function rowIsAboutLand(text, landName) {
        if (!text.includes(landName)) {
            return false;
        }
        return !getAllLandNames().some(other =>
            other.length > landName.length &&
            other.includes(landName) &&
            text.includes(other)
        );
    }

    function colorLandFromReport(land, type) {
        let landName = land.getAttribute("data-name");
        let positive = 0;
        let negative = 0;
        let dk = 0;
        let neutral = 0;
        for (let doc of allReports) {
            positive += [...doc.querySelectorAll("tr")]
                .filter(row => rowIsAboutLand(row.textContent, landName))
                .filter(row =>
                    row.textContent.includes(getBasePositiveSpellByType(type)) ||
                    row.textContent.includes("Požehnání")
                )
                .map(row => row.nextElementSibling)
                .filter(row => row && (row.textContent.includes("seslal") || row.textContent.includes("Seslal"))).length;
            negative += [...doc.querySelectorAll("tr")]
                .filter(row => rowIsAboutLand(row.textContent, landName))
                .filter(row =>
                    (row.textContent.includes(getBaseNegativeSpellByType(type)) ||
                        row.textContent.includes("Kletba")) &&
                    // "Dvojita Kletba" obsahuje "Kletba" - nepocitat ji sem, patri do dk
                    !row.textContent.includes("Dvojitá Kletba")
                )
                .map(row => row.nextElementSibling)
                .filter(row => row && (row.textContent.includes("seslal") || row.textContent.includes("Seslal"))).length;
            dk += [...doc.querySelectorAll("tr")]
                .filter(row => rowIsAboutLand(row.textContent, landName))
                .filter(row => row.textContent.includes("Dvojitá Kletba"))
                .map(row => row.nextElementSibling)
                .filter(row => row && (row.textContent.includes("seslal") || row.textContent.includes("Seslal"))).length;
            neutral += [...doc.querySelectorAll("tr")]
                .filter(row => rowIsAboutLand(row.textContent, landName))
                .filter(row => row.textContent.includes(getBaseNeutralSpellByType(type)))
                .map(row => row.nextElementSibling)
                .filter(row => row && (row.textContent.includes("seslal") || row.textContent.includes("Seslal"))).length;
        }
        if (neutral > 0) {
            addBackground(land, neutralColor, borderCertainColor);
        } else if (dk > 0 || negative > 1) {
            addBackground(land, negativeColor, borderNotSureColor);
        } else if (negative === 1 && positive > 0) {
            addBackground(land, neutralColor, borderNotSureColor);
        } else if (negative === 1) {
            addBackground(land, slightlyNegativeColor, borderNotSureColor);
        } else if (positive > 0) {
            addBackground(land, positiveColor, borderNotSureColor);
        }
    }

    async function getAllReports() {
        if (allReports.length > 0) {
            return;
        }

        console.log("fetching reports");
        let allTeammatesIds = getAllTeammatesIds();
        let requests = allTeammatesIds.map(id =>
            fetch("https://www.darkelf.cz/hlaseni.asp?id_player=" + id)
                .then(response => response.arrayBuffer())
                .then(buffer => {
                    let decoder = new TextDecoder("windows-1250");
                    let html = decoder.decode(buffer);

                    let doc = new DOMParser().parseFromString(html, "text/html");

                    allReports.push(doc);
                })
        );
        await Promise.all(requests);
    }

    function getAllTeammatesIds() {
        let allLands = document.getElementById("maps").getElementsByClassName("land");
        return [...new Set(
            [...allLands]
                .filter(land => land.hasAttribute("data-b_natality"))
                .map(land => land.getAttribute("data-id_player"))
        )];
    }

    // Obarví celé území země (výplň pod ikonami). Dřív se kreslilo kolečko kolem
    // vlajky; teď se přes map-fill.js vyplní celý polygon země. Barva okraje
    // (jistota odhadu) se použije jako obrys země.
    function addBackground(land, color, borderColor) {
        if (!window.DEfill) return;
        const id = land.getAttribute("data-id");
        window.DEfill.ready().then(() => window.DEfill.fill(id, color, { stroke: borderColor }));
    }

    function getAttributeByType(type) {
        switch (type) {
            case "Porodnost":
                return "data-b_natality";
            case "Zlato":
                return "data-b_gold";
            case "Mana":
                return "data-b_mana";
        }
    }

    function getBasePositiveSpellByType(type) {
        switch (type) {
            case "Porodnost":
                return "Spokojenost";
            case "Zlato":
                return "Příznivé počasí";
            case "Mana":
                return "Magické klima";
        }
    }

    function getBaseNegativeSpellByType(type) {
        switch (type) {
            case "Porodnost":
                return "Nespokojenost";
            case "Zlato":
                return "Krupobití";
            case "Mana":
                return "Magický vír";
        }
    }

    function getBaseNeutralSpellByType(type) {
        switch (type) {
            case "Porodnost":
                return "Neovlivnitelnost";
            case "Zlato":
                return "Uzdravení";
            case "Mana":
                return "Uzdravení";
        }
    }
})();
