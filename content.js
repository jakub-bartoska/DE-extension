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
        let menuItem = createMenuItem();
        menu.appendChild(menuItem);
    }

    function createMenuItem() {
        let img = document.createElement("img");
        img.src = chrome.runtime.getURL("images/menu-icon.png");
        img.class = "miniMenuItem cursorHand";
        img.id = "displaySpellResults"
        img.width = 47;
        img.height = 38;
        img.id = "natality-button";

        img.setAttribute("display", "false");

        img.addEventListener("click", displaySpellResults);

        return img;
    }

    function displaySpellResults() {
        let natalityButton = document.getElementById("miniMenuContainer");
        let displayed = natalityButton.getAttribute("display");
        if (displayed == "true") {
            document.querySelectorAll(".natality-indicator").forEach(el => el.remove());
            natalityButton.setAttribute("display", "false");
            return;
        }

        natalityButton.setAttribute("display", "true");
        (async () => {
            await getAllReports();
            let lands = document.getElementById("maps").getElementsByClassName("land");
            for (let land of lands) {
                if (land.hasAttribute("data-b_natality")) {
                    colorOwnLand(land);
                    continue;
                }
                colorLandFromReport(land);
            }
        })();
    }

    function colorOwnLand(land) {
        let natality = land.getAttribute("data-b_natality");
        if (natality == '100') {
            addBackground(land, neutralColor, borderCertainColor);
        } else if (natality == '200') {
            addBackground(land, positiveColor, borderCertainColor);
        } else if (natality == '50') {
            addBackground(land, negativeColor, borderCertainColor);
        } else {
            console.log("unknown natality")
        }
    }

    function colorLandFromReport(land) {
        let landName = land.getAttribute("data-name");
        let positive = 0;
        let negative = 0;
        let dk = 0;
        let neutral = 0;
        for (let doc of allReports) {
            positive += [...doc.querySelectorAll("tr")]
                .filter(row => row.textContent.includes(landName))
                .filter(row =>
                    row.textContent.includes("Spokojenost") ||
                    row.textContent.includes("Požehnání")
                )
                .map(row => row.nextElementSibling)
                .filter(row => row.textContent.includes("seslal") || row.textContent.includes("Seslal")).length;
            negative += [...doc.querySelectorAll("tr")]
                .filter(row => row.textContent.includes(landName))
                .filter(row =>
                    row.textContent.includes("Nespokojenost") ||
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
                .filter(row => row.textContent.includes("Neovlivnitelnost"))
                .map(row => row.nextElementSibling)
                .filter(row => row.textContent.includes("seslal") || row.textContent.includes("Seslal")).length;
        }
        console.log('landName: ' + landName + ' posivie: ' + positive + ' negative: ' + negative + ' dk: ' + dk + ' neutral: ' + neutral);
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
        newDiv.classList.add('natality-indicator');
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
})();
