(function () {
    addMenuButtons();

    let allReports = [];
    let borderCertainColor = 'rgba(0, 255, 0, 1)';
    let borderNotSureColor = 'rgb(255,255,0, 1)';

    let neutralColor = 'rgba(200, 200, 200, 0.4)';
    let positiveColor = 'rgba(0, 255, 0, 0.4)';
    let slightlyNegativeColor = 'rgba(255, 255, 0, 0.4)';
    let negativeColor = 'rgba(255, 0, 0, 0.4)';

    function addMenuButtons() {
        let menu = document.getElementById("miniMenuContainer");
        if (!menu) {
            return;
        }
        let base = createMenuItem("base");
        var dropDown = createDropdown();
        menu.appendChild(base);
        menu.appendChild(dropDown);
    }

    function createMenuItem() {
        let img = document.createElement("img");
        img.src = "../images/mapy/but_map_menu.gif";
        img.class = "miniMenuItem cursorHand";
        img.id = "displaySpellResults"
        img.width = 47;
        img.height = 38;
        img.id = "natality-button";

        img.addEventListener("click", () => displayDropdown());

        return img;
    }

    function displayDropdown() {
        let dropdown = document.getElementById("display-results-dropdown");
        let isHidden = window.getComputedStyle(dropdown).display === "none";
        if (isHidden) {
            dropdown.style.display = "block";
        } else {
            dropdown.style.display = "none";
        }
    }

    function createDropdown() {
        let div = document.createElement("div");
        div.id = "display-results-dropdown";
        div.style.display = "none";
        div.style.padding = "0px 8px 10px 8px";
        div.style.left = "220px";
        div.style.top = "46px";
        div.style.position = "absolute";
        div.style.zIndex = "50";
        div.style.height = "auto";
        div.style.width = "190px";
        div.style.maxWidth = "210px";
        div.style.border = "4px solid #220000";
        div.style.backgroundColor = "#400000";
        div.style.borderTopColor = "#521000";
        div.style.borderRightColor = " #521000";
        div.style.backgroundImage = "../images/pozadi/poz_drv.jpg";

        const options = ["Porodnost", "Zlato", "Mana", "Nic"];

        options.forEach(optionText => {
            const label = document.createElement("label");
            label.style.display = "block";
            label.style.textAlign = "left";
            label.style.cursor = "pointer";

            const input = document.createElement("input");
            input.type = "radio";
            input.name = "results-display";
            input.value = optionText;

            input.addEventListener("change", () => {
                document.querySelectorAll(".indicator").forEach(el => el.remove());
                if (input.value !== "Nic") {
                    displaySpellResults(input.value);
                }
            });

            label.appendChild(input);
            label.appendChild(document.createTextNode(" " + optionText));
            div.appendChild(label);
        });

        return div;
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

    function colorLandFromReport(land, type) {
        let landName = land.getAttribute("data-name");
        let positive = 0;
        let negative = 0;
        let dk = 0;
        let neutral = 0;
        for (let doc of allReports) {
            positive += [...doc.querySelectorAll("tr")]
                .filter(row => row.textContent.includes(landName))
                .filter(row =>
                    row.textContent.includes(getBasePositiveSpellByType(type)) ||
                    row.textContent.includes("Požehnání")
                )
                .map(row => row.nextElementSibling)
                .filter(row => row.textContent.includes("seslal") || row.textContent.includes("Seslal")).length;
            negative += [...doc.querySelectorAll("tr")]
                .filter(row => row.textContent.includes(landName))
                .filter(row =>
                    row.textContent.includes(getBaseNegativeSpellByType(type)) ||
                    row.textContent.includes("Kletba")
                )
                .map(row => row.nextElementSibling)
                .filter(row => row.textContent.includes("seslal") || row.textContent.includes("Seslal")).length;
            dk += [...doc.querySelectorAll("tr")]
                .filter(row => row.textContent.includes(landName))
                .filter(row => row.textContent.includes("Dvojitá Kletba"))
                .map(row => row.nextElementSibling)
                .filter(row => row.textContent.includes("seslal") || row.textContent.includes("Seslal")).length;
            neutral += [...doc.querySelectorAll("tr")]
                .filter(row => row.textContent.includes(landName))
                .filter(row => row.textContent.includes(getBaseNeutralSpellByType(type)))
                .map(row => row.nextElementSibling)
                .filter(row => row.textContent.includes("seslal") || row.textContent.includes("Seslal")).length;
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

    function addBackground(land, color, borderColor) {
        let landStyle = window.getComputedStyle(land);
        let top = parseFloat(landStyle.top);
        let left = parseFloat(landStyle.left);

        let newDiv = document.createElement("div");
        newDiv.classList.add('indicator');
        newDiv.style.zIndex = '1';
        newDiv.style.pointerEvents = '1';
        newDiv.style.top = (top - 11) + 'px';
        newDiv.style.left = (left - 11) + 'px';
        newDiv.style.backgroundColor = color;
        newDiv.style.position = 'absolute';
        newDiv.style.width = '60px';
        newDiv.style.height = '60px';
        newDiv.style.borderRadius = '50%';
        newDiv.style.border = '2px solid ' + borderColor;

        land.parentNode.insertBefore(newDiv, land);
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
