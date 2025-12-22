// ==UserScript==
// @name         Arekino MiniScripty
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  Vsetky skripty skombinovane
// @author       You
// @match        https://www.darkelf.cz/*
// @match        http://deficurky.detimes.cz/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    magickeHlaseniaPreZemku();
    moNeutralky();
    odhadVHlaseniach();

    function magickeHlaseniaPreZemku()
    {
        if(!document.URL.match("https://www.darkelf.cz/l.asp\\?id=.*"))
        {
            return;
        }
        const toNodes = html =>
            new DOMParser().parseFromString(html, 'text/html').body.childNodes;

        var MenoZemky = (document.getElementsByTagName('th')[0].innerText.substring(10))+"-";//niektore zemky su prefixom inych, najdi aj s - uprostred Osada - Nespokojenost
        //var AlliesId=[];
        var xhttp = new XMLHttpRequest();
        xhttp.onreadystatechange = onReadyAliPage;
        var url = "https://www.darkelf.cz/aliance.asp";
        xhttp.open("GET",url);
        xhttp.send();

        function onReadyAliPage()
        {
            if (this.readyState == 4 && this.status == 200) {
                var pocetNajdenych = 0;
                var response = this.responseText;
                var pos;
                do
                {
                    pos = response.search("forum_hrac")+11;
                    if(pos!=10)
                    {
                        pocetNajdenych+=1;
                        response = response.substring(pos);
                        var alliesId=parseInt(response);
                        var xhttp1 = new XMLHttpRequest();
                        xhttp1.onreadystatechange = onReadyHlaseniPage;
                        var url1 = "https://www.darkelf.cz/hlaseni.asp?id_player="+alliesId;
                        xhttp1.open("GET",url1);
                        xhttp1.responseType = 'blob';
                        xhttp1.send();

                        //AlliesId.push(parseInt(response));
                    }
                }
                while (pos!=10)
                if(pocetNajdenych==0)
                {
                    xhttp1 = new XMLHttpRequest();
                    xhttp1.onreadystatechange = onReadyHlaseniPage;
                    url1 = "https://www.darkelf.cz/hlaseni.asp";
                    xhttp1.open("GET",url1);
                    xhttp1.responseType = 'blob';
                    xhttp1.send();}
            }
        }

        function onReadyHlaseniPage()
        {
            if (this.readyState == 4 && this.status == 200) {
                var a = new FileReader();
                a.readAsText(this.response,'windows-1250');
                a.onloadend = function(){
                    var response = a.result
                    var dom = new DOMParser().parseFromString(response, 'text/html');
                    var hlasenia = dom.getElementsByTagName('tr');
                    var arrHlasenia = Array.from(hlasenia);
                    arrHlasenia.forEach((x,index)=>{
                        var pos=x.innerText.search(MenoZemky);
                        if(pos!=-1)
                        {
                        }
                        if(pos!=-1)
                        {
                            x.removeChild(x.childNodes[1]);
                            x.removeChild(x.childNodes[8]);
                            x.removeChild(x.childNodes[4]);
                            document.body.appendChild(x);
                            document.body.appendChild(arrHlasenia[index+1]);
                        }
                    })
                }

            }
        }

    }

    function moNeutralky()
    {
        if(!document.URL.match("https://www.darkelf.cz/l.asp\\?id=.*"))
        {
            return;
        }
        if (document.getElementsByTagName('td')[1].innerHTML != "\nNeobsazená země\n") {
            return;
        }
        //read input
        var string = document.getElementsByTagName('th')[1].innerHTML;
        var pos = string.search("<");
        var vojsko = string.substring(1, pos);
        var obranaElem = document.getElementsByTagName('td')[5].innerHTML;
        pos = obranaElem.search(">");
        var obranaString = obranaElem.substring(pos + 1, pos + 4);
        var obrana = parseInt(obranaString);
        var bonus = 0;
        var tdElements = document.getElementsByTagName('td');
        for (var i = 0; i < tdElements.length; i++) {
            var s = tdElements[i].innerHTML;
            var najdene = s.search("obrana");
            if (najdene == -1) {
                continue;
            }
            bonus = parseInt(s);
            break;
        }
        var denElement = parent.frames.mapa.document.getElementsByTagName('span')[0].innerHTML;
        pos = denElement.search("&");
        var denString = denElement.substring(pos+15, pos+19);
        var den = parseInt(denString);
        // calculate
        var MO = calulateMO(vojsko, obrana, bonus, den);
        //insert into document
        var zNode = document.createElement('td');
        if (MO != undefined) {
            for (var item in MO) {
                zNode.innerHTML += '<p style="color:red">MO: ' + item + ' - ' + Math.round(MO[item] * 1000)/10 + '%</p>'; //+ item + ' - ' + Math.round(MO[item] * 1000)/10
            }
        }
        else {
            zNode.innerHTML = '<p style="color:red">Odlogla neutralka</p>';
        }
        zNode.setAttribute('id', 'myContainer');
        document.getElementsByTagName('td')[5].parentElement.parentElement.appendChild(zNode);


        function choose(n, k) {
            var hore = 1;
            var dole = 1;
            for (var i = 2; i <= n; i++) {
                hore *= i;
            }
            for (i = 2; i <= k; i++) {
                dole *= i
            }
            for (i = 2; i <= n - k; i++) {
                dole *= i
            }
            return hore / dole;
        }

        function calulateMO(vojsko, sila, bonus, den) {
            var i;
            var maxJednotiek = Math.floor((vojsko - 16) / 6) + 1;
            for (i = 0; i < maxJednotiek; i++) {
                var pocetDvojek = (vojsko - i * 6) / 8;
                var ZvysokPoDvojkach = (vojsko - i * 6) % 8;
                if (ZvysokPoDvojkach != 0) {
                    continue; //tolkoto jednotiek nemoze byt
                }
                var obrana = Math.floor((i * 5 + pocetDvojek * 4) * (1 + (bonus / 100))) + 10;
                var obyv = sila - Math.floor((i * 5 + pocetDvojek * 4) * (1 + (bonus / 100))) - 1;
                var maxObyv = +10 + +den;
                if (obyv <= (maxObyv)) {
                    obyv = sila - Math.floor((i * 5 + pocetDvojek * 4) * (1 + (bonus / 100))) - 1;
                    var domky = Math.max(48, i + pocetDvojek + obyv);
                    var MO = Math.floor((pocetDvojek * pocetDvojek * 3) / domky);
                    console.log(i+"-0-"+pocetDvojek+" "+obyv);
                    var minDomky = Math.max(48, i + pocetDvojek + obyv);
                    var results = new Object();
                    if (i > den * 2 + 6 || pocetDvojek > den * 2 + 2) {
                        return undefined;
                    }
                    for (var j = 0; j <= den; j++) {
                        var mocnina = Math.pow(0.5, den);
                        var kombinacne = choose(den, j)
                        var probability = mocnina * kombinacne;
                        MO = Math.floor((pocetDvojek * pocetDvojek * 3) / (minDomky + j));
                        if (results[MO] == undefined) {
                            results[MO] = probability;
                        } else {
                            results[MO] += probability;
                        }
                    }

                    return results;
                }
            }
        }

    }

    function odhadVHlaseniach()
    {
        if(!document.URL.match("https://www.darkelf.cz/hlaseni.asp.*"))
        {
            return;
        }
        var nonNegativeInteger = /\d+/;
        var nonNegativeIntegers = /\d+/g;
        var onlyNonNegativeInteger = /^\d+$/;


        var table = document.getElementsByTagName("table")[1];
        var rows = table.getElementsByTagName("tr");
        for(var r=0; r<rows.length-1; r+=2) {
            if(rows[r].innerHTML.indexOf("images/s/m3.gif") == -1) // image of battle
            {
                continue;
            }
            var lines = rows[r+1].innerHTML.split(/<br ?\/?>/i);
            if(lines.length < 4) // too few lines
            {
                continue;
            }
            lines[0] = lines[0].replace(/<.*?>/g," ");
            var isAttack = lines[0].indexOf("zaútočilo") != -1;
            var isDefence = lines[0].indexOf("napadena") != -1;
            if(!isAttack && !isDefence)
            {
                continue;
            }
            // default setting is isAttack
            var strengthLine = 0;
            var usedUnitsLine = 1;
            var lostUnitsLine = 2;
            var multiplicator = 3;
            var string = "Odhadovaná obrana";
            if(isDefence) {
                if(lines.length < 5) // too few lines
                {
                    continue;
                }
                strengthLine = 1;
                if(lines[2].indexOf("spojenecká vojska") != -1) {
                    usedUnitsLine = 4;
                    lostUnitsLine = 5;
                } else {
                    usedUnitsLine = 2;
                    lostUnitsLine = 3;
                }
                multiplicator = 6;
                string = "Odhadovaný útok";
            }
            var strength = parseInt(lines[strengthLine].match(nonNegativeInteger));
            var index = lines[usedUnitsLine].indexOf("Hrdina");
            if(index == -1)
            {
                index = lines[usedUnitsLine].length;
            }
            var usedUnits = lines[usedUnitsLine].substring(0,index).match(nonNegativeIntegers);
            if(usedUnits == null) // no soldiers used
            {
                continue;
            }
            var lostUnits = lines[lostUnitsLine].match(nonNegativeIntegers);
            var maxUsedUnits = 0;
            for(var u in usedUnits)
            {
                maxUsedUnits = Math.max(parseInt(usedUnits[u]), maxUsedUnits);
            }
            if(lostUnits == null)
            {
                lostUnits = new Array(0);
            }
            var maxLostUnits = 0;
            for(u in lostUnits)
            {
                maxLostUnits = Math.max(parseInt(lostUnits[u]), maxLostUnits);
            }
            var min = Math.floor((maxLostUnits / maxUsedUnits) * multiplicator * strength);
            var max = Math.floor((((maxLostUnits+1) / maxUsedUnits) * multiplicator * strength)-1);
            if(isAttack) {
                if(max >= strength && lines[0].indexOf("zvítězilo") != -1)
                {
                    max = strength -1;
                }
                if(min < strength && lines[0].indexOf("poraženo") != -1)
                {
                    min = strength;
                }
            }
            if(isDefence) {
                if(max > strength)
                {
                    max = strength -1;
                }
            }
            var cell = rows[r+1].getElementsByTagName("td")[0];
            cell.innerHTML = cell.innerHTML + "<br><br>" + string + " " + min + " - " + max;
        }
    }
})();