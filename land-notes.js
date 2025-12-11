(function () {
    let data = {
        items: []
    }

    addLandNoteMarker();

    function addLandNoteMarker() {
        let map = document.getElementById("maps");
        if (!map) {
            return;
        }

        let lands = map.getElementsByClassName("land");
        for (let land of lands) {

            let landId = Number(land.getAttribute("data-id"));
            data.items.push({
                id: landId,
                text: ""
            });

            land.style.zIndex = '0';
            let noteImg = prepareNoteIcons(land, landId);
            land.appendChild(noteImg);
        }
    }

    function prepareNoteIcons(land, landId) {
        let img = document.createElement("img");
        img.src = chrome.runtime.getURL("images/menu-icon.png");
        img.classList.add("note-button");
        img.width = 15;
        img.height = 15;
        img.style.position = 'absolute';
        img.style.top = '0px';
        img.style.left = '-15px';
        img.style.border = 'none';
        img.style.zIndex = '100';

        img.addEventListener("click", () => displayTextArea(land, landId));

        return img;
    }

    function displayTextArea(land, landId) {
        land.style.zIndex = '10';

        let existingText = data.items.find(item => item.id === landId);

        let textarea = document.createElement("textarea");
        textarea.classList.add('note-add-window');
        textarea.style.position = 'absolute';
        textarea.style.width = '200px';
        textarea.style.height = '300px';
        textarea.style.top = '16px';
        textarea.style.left = '-200px';
        textarea.style.zIndex = '110';
        textarea.innerText = existingText.text;

        let saveButton = document.createElement("div");
        saveButton.classList.add('note-add-window');
        saveButton.style.position = 'absolute';
        saveButton.style.width = '80px';
        saveButton.style.height = '20px';
        saveButton.style.top = '328px';
        saveButton.style.left = '-190px';
        saveButton.style.zIndex = '110';
        saveButton.style.border = '1px solid black';
        saveButton.style.backgroundColor = 'rgba(0, 255, 0, 1)';
        saveButton.style.display = 'flex';
        saveButton.style.justifyContent = 'center';
        saveButton.style.alignItems = 'center';
        saveButton.style.fontWeight = 'bold';
        saveButton.style.color = 'black';
        saveButton.style.textAlign = 'center';
        saveButton.innerText = 'Uložit';

        let cancelButton = document.createElement("div");
        cancelButton.classList.add('note-add-window');
        cancelButton.style.position = 'absolute';
        cancelButton.style.width = '80px';
        cancelButton.style.height = '20px';
        cancelButton.style.top = '328px';
        cancelButton.style.left = '-90px';
        cancelButton.style.zIndex = '110';
        cancelButton.style.border = '1px solid black';
        cancelButton.style.backgroundColor = 'rgba(255, 0, 0, 1)';
        cancelButton.style.display = 'flex';
        cancelButton.style.justifyContent = 'center';
        cancelButton.style.alignItems = 'center';
        cancelButton.style.fontWeight = 'bold';
        cancelButton.style.color = 'black';
        cancelButton.style.textAlign = 'center';
        cancelButton.innerText = 'Zruš';

        saveButton.addEventListener("click", () => saveClicked(landId, textarea));
        cancelButton.addEventListener("click", () => cancelClicked());

        land.appendChild(textarea);
        land.appendChild(saveButton);
        land.appendChild(cancelButton);
        textarea.focus();
    }

    function saveClicked(landId, textarea) {
        let oldElement = data.items.find(item => item.id === landId);
        oldElement.text = textarea.value;
        console.log(textarea.value);
        [...document.getElementsByClassName("note-add-window")].forEach(element => element.remove());
    }

    function cancelClicked() {
        [...document.getElementsByClassName("note-add-window")].forEach(element => element.remove());
    }


})();