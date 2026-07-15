# DE-extension

Rozsireni do prohlizece pro hru **Dark Elf** (darkelf.cz). Prida na herni mapu tyto funkce:

- **Barveni mapy podle kouzel** — vybarvi zeme podle odhadovane porodnosti z hlaseni tvych a spoluhracu.
- **Historie mapy** — umozni preklikavat mapu na minule herni dny a videt, jak svet vypadal drive.
- **Vybarveni uzemi podle vlastnika / aliance** — na prvni pohled je videt, kdo co ovlada (vcetne pruhovaneho zvyrazneni cerstve dobytych zemi).
- **Bojovy mod** — u tvych zemi ukaze presnou utocnou/obrannou silu a umozni primo z mapy verbovat, stavet a posilat utoky.

A navic drobne pomucky na strankach zemi a hlaseni (odhad obrany neutralek, odhady sil v boji).

Funguje v prohlizecich zalozenych na Chromiu (Chrome, Opera, Edge, Brave, ...).

---

# Instalace

Rozsireni neni v obchode — instaluje se jako "rozbalene", tzn. nacte se primo ze slozky na disku.

**1) Stahni repo jako ZIP** (zelene tlacitko `Code` -> `Download ZIP`):

<img width="990" height="421" alt="stazeni zip" src="https://github.com/user-attachments/assets/f66ce940-a347-45bf-a260-ed459f06518f" />

**2) Rozbal ZIP** nekam na disk. Slozku uz pak nemaz ani neprejmenovavej — prohlizec z ni rozsireni nacita napevno.

**3) Otevri stranku s rozsirenimi** (podle prohlizece zadej do adresniho radku):

- Chrome: `chrome://extensions/`
- Opera: `opera://extensions/`
- Edge: `edge://extensions/`

**4) Vpravo nahore zapni Rezim pro vyvojare** (Developer mode):

<img width="1130" height="123" alt="rezim pro vyvojare" src="https://github.com/user-attachments/assets/3145649b-97c9-423a-94f3-08a9ee8a49e9" />

**5) Klikni na Nacist rozbalene** (Load unpacked):

<img width="828" height="226" alt="nacist rozbalene" src="https://github.com/user-attachments/assets/26ee7bcf-c348-4cc5-95d4-9b613b9827a6" />

**6) Vyber rozbalenou slozku `DE-extension`** — tu, ve ktere lezi soubor `manifest.json`:

<img width="1149" height="696" alt="vyber slozky" src="https://github.com/user-attachments/assets/12404f87-82cf-4eb1-81fe-dd811acc83dd" />

**7) Hotovo.** Otevri (nebo obnov klavesou **F5**) mapu ve hre a funkce se objevi primo na ni.

> **Aktualizace na novou verzi:** stahni novy ZIP a nahrad jim slozku, nebo si repo naklonuj pres `git`.
> Pak na strance `chrome://extensions/` klikni u DE-extension na obnovit (↻) a dej **F5** na mape.

---

# Funkce 1: Barveni mapy podle kouzel

Po instalaci se na mape vedle ikonek (aktualizace mapy, hromadne kouzleni) objevi **nova ikona**:

<img width="290" height="54" alt="nova ikona" src="https://github.com/user-attachments/assets/e2356c53-8088-464f-9962-526e27f10b19" />

Po kliknuti a vyberu typu (Porodnost / Zlato / Mana) rozsireni **vybarvi cele uzemi** kazde
zeme podle toho, jak na ne prosla kouzla — vychazi z **hlaseni tebe a tvych spoluhracu**.
Vyplna lezi POD ikonami (vlajky, vojsko, stavby), takze ty zustanou dobre videt.

- **Tve zeme a zeme spoluhracu** se obarvi vzdy spravne (porodnost znas presne).
- **Neutralky a nepratele** se obarvi jen podle kouzel, ktera videli tvoji lide. Jestli tam
  kouzlil i souper, nevis — proto barva **nemusi sedet na 100 %**.

**Barva vyplne:**

| barva   | vyznam                                        |
|---------|-----------------------------------------------|
| seda    | neutralni porodnost (100 %)                   |
| zelena  | 200 % porodnost                               |
| zluta   | na zem sla 1x Nespokojenost                   |
| cervena | 50 % porodnost, nebo na zem sla 2x Nespokojenost |

**Obrys zeme:**

| obrys  | vyznam                                              |
|--------|-----------------------------------------------------|
| zeleny | zobrazeni je na 100 % spravne                       |
| zluty  | realna porodnost se muze lisit kvuli akcim soupere  |

### Priklady

Pred zakouzlenim:

<img width="908" height="502" alt="pred zakouzlenim" src="https://github.com/user-attachments/assets/7e08d95f-d941-4098-a95d-f9400292dc66" />

Vysledek po prepoctu:

<img width="1034" height="502" alt="po prepoctu" src="https://github.com/user-attachments/assets/1f53686f-9c5c-47c3-b8d6-fee6f87596c4" />

Realny priklad:

<img width="2241" height="1110" alt="realny priklad" src="https://github.com/user-attachments/assets/c0f7595e-f26e-4849-a58c-1cf678168a5a" />

---

# Funkce 2: Historie mapy

Umozni podivat se, jak mapa vypadala v **minulych hernich dnech** — kdo ktere zeme vlastnil,
jak byl silny, co mel postavene, kde byly vyhlasene valky a kde stali hrdinove.

## Jak se to ovlada

V **pravem hornim rohu mapy** se objevi listka:

```
Historie:   ◀   Den X   ▶   Dnes
```

- **◀ / ▶** — preklikne mapu na predchozi / dalsi herni den. Cela mapa se prekresli do stavu
  z toho dne: vlajky (kdo zem vlastnil), sila vojska, domy a stavby, vyhlasene valky i hrdinove.
- **Dnes** — vrati aktualni (zivou) mapu.

## Jak to funguje "pod kapotou"

Hra si historii mapy **sama nedrzi** — na mape je vzdy jen aktualni stav z posledniho prepoctu.
Jakmile prijde dalsi prepocet, predchozi stav je nenavratne prepsany. Proto k rozsireni patri
**automaticky archiv**, ktery ty stavy zaznamenava:

1. Na pozadi (na serveru AWS) bezi ukladac. Po kazdem prepoctu si stahne **verejnou spectator
   mapu** kazde ligy (prihlaseni do hry neni potreba) a ulozi z ni snimek celeho sveta.
2. Rozsireni si tyto snimky stahuje z verejneho **read-only API** a pri volbe dne jimi "prehodi"
   obrazky na mape.

## Co je dobre vedet

- **Historie se plni az od chvile, kdy archiv bezi.** Dny starsi nez zacatek sberu nejsou
  k dispozici. Kazdy novy herni den pribyde jako dalsi snimek — cim dele to bezi, tim delsi
  historii uvidis.
- **Ligy se pridavaji samy** — archiv si sam najde vsechny hrajici ligy, nic nenastavujes.
- **Zadne prihlaseni ani klic** — data z mapy jsou verejna, takze API je jen pro cteni a
  rozsireni k nemu nepotrebuje zadne heslo.
- Kdyz liga dohraje a restartuje se (den spadne zpet na 0), archiv zacne novou "epochu", takze
  se historie stare hry neprepise.

---

# Funkce 3: Vybarveni celych zemi

Rozsireni umi obarvit **cele uzemi** zeme (ne jen kolecko u vlajky). Vyplna lezi pod ikonami
hrace, takze vlajky, vojsko a stavby zustavaji dobre videt.

## Ovladani

Na mape pribyde v horni liste **druha ikona**. Po kliknuti se otevre panel:

- **Obarvit uzemi podle: Hracu / Aliancí / Nic** — obarvi kazdou zemi barvou jejiho vlastnika,
  nebo podle aliance (spojenci stejna barva). Na prvni pohled je videt, kdo co ovlada.
  Barva se bere z **dominantni barvy vlajky hrace** (resp. **erbu aliance**). Kdyz maji dva
  moc podobnou barvu (i po smichani se zelenou mapou), nebo by barva splyvala s mapou ci
  chybela (cernobily erb), priradi se jina, dostatecne odlisna a viditelna barva. Aliance/hrac
  se skutecnou vlastni barvou si ji udrzi, ostatni dostanou nahradu.
- **Zvyraznit hranice** — obtahne kazdou zemi cerne, at jsou hranice jasne videt.
- **Zvyraznit hrdiny** / **Zvyraznit krypty** — dva samostatne prepinace, ktere zarici
  aurou zvyrazni hrdiny, resp. krypty, aby mezi ostatnimi ikonami nezanikli. **Vyraznost 1–3**
  (1 jemne, 3 hodne napadne — pulz + zvetseni). Funguje i v historii.

**Cerstve dobyte zeme** (ty, ktere oproti minulemu hernimu dni zmenily majitele) se
nevybarvi jednou barvou, ale **sikmymi pruhy**: siroky pruh ma barvu **noveho** vlastnika,
uzky pruh barvu **puvodniho** (tu dohleda z historie). Kdyz nekdo obsadil neutralku, je
uzky pruh pruhledny (prosvita mapa). Diky tomu na prvni pohled vidis, kde se zrovna
prehazuji uzemi a kdo je komu sebral.

Toto obarvovani pouziva i **Funkce 1** (kouzla) — misto puvodnich kolecek vyplni celou zem.

Obarveni **funguje i v historii** (Funkce 2): kdyz se vracis v case a zeme zmenila
majitele, prebarvi se podle toho, komu patrila v dany den. Kazdy hrac (resp. aliance)
ma pritom **vzdy stejnou barvu**, at jsi kdekoli v historii — barvy se drzi napric dny.

## Jak to funguje "pod kapotou"

Tvary vsech ~431 zemi jsou **predpocitane** (v souboru `regions.json`). Vznikly jednou z ciste
stare grafiky mapy metodou **watershed** — kazdy bod souse i mala vnitrni jezera se priradi
nejblizsi zemi, ohraniceno nakreslenymi hranicemi. Voda u okraje mapy i velka jezera se povazuji
za **more** a nevybarvuji se; jen mala jezera uvnitr zeme se vybarvi jako jeji soucast. Diky tomu
vypln dosahuje az k hranicim (zadne neobarvene pruhy) a pokryva i mala jezera. Za behu se nic
nepocita — jen se polozi pres mapu prusvitná SVG vrstva a nastavi se `fill` u prislusneho tvaru.
Diky tomu je to okamzite a **nezatezuje prohlizec**.

Hranice zemi jsou v stare i nove grafice na stejnych pixelech, takze vyplne sedi **at hrajes s
jakoukoli grafikou**.

---

# Funkce 4: Bojovy mod

Bojovy mod z tebe udela velitele primo na mape — u kazde **tve zeme** ukaze presnou silu
a das odsud rovnou verbovat, stavet i utocit, aniz bys musel proklikavat stranky hry.

> Tahle funkce je jen pro **prihlaseneho hrace**. Pozorovateli (spectator mapa) se
> neobjevi. Data bere z oficialniho exportu mapy (`map_export_json.asp`).

## Zapnuti

V mapovem menu pribude **zelena ikona s mecem**. Chvili po nacteni mapy je „nedostupna"
(nacitaji se data — bezi na ni prouzek), pak zezelena a da se kliknout. Kliknutim mod
zapnes/vypnes.

## Co uvidis u svych zemi

U kazde tve zeme se nad vlajkou objevi **stitek se silou** a vedle **tri tlacitka**:

- **Sila** — cervene cislo s mecem = **utocna sila** (pocitano jako pres vyhlasenou valku,
  tzn. bez postihu), modre cislo se stitem = **obranna sila**. Cisla se berou co nejpresneji
  ze hry (vcetne pevnosti, staveb, hrdiny, obyvatel).
- **Utok** (sipka) — spusti miereni: od zeme se natahne sipka k nejblizsimu moznemu cili.
  Najedes mysi na cil a **kliknutim odesles cely domaci oddil**. U neutralnich zemi se
  navic ukaze **potrebna sila k dobyti** — zelene kdyz tvuj utok staci, cervene kdyz ne.
  - **klik** = dobyvacny utok
  - **Shift + klik** = plenivy utok
  - **Ctrl + klik** = presun vojska
  - **Esc** nebo **pravy klik** = zrusit mireni
- **Verbovani** (panacek) — otevre panel s posuvniky pro jednotlive typy jednotek. Posuvniky
  samy hlidaji, kolik si muzes dovolit (zlato, mana i pocet volnych vesnicanu). Jednim
  tlacitkem naverbujes.
- **Stavby** (krumpac) — nabidne stavby, ktere v te zemi jeste nestoji a **zvysuji utok nebo
  obranu** (utocne, obranne, pevnostni). Zaskrtnes a postavis.

## Sipky odeslanych utoku

Vsechny **tve prave probihajici utoky** se na mape vykresli jako **sipky** od zdroje k cili
(barva podle typu: dobyvacny / plenivy / presun) s **odznakem sily** utoku. Seznam se sam
obcerstvuje, takze zrusene i nove utoky se promitnou.

> **Pozor:** tlacitka **opravdu provadi akce ve hre** — naverbovani, stavba i odeslany utok
> jsou skutecne tahy, ne jen nahled. Odesila se cely domaci oddil dane zeme.

## Jak to funguje "pod kapotou"

Sila se pocita ze statu jednotek jednotlivych ras a hernich vzorcu; presne stavy (armada,
utocna a obranna sila) se ctou zivo ze stranky zeme, protoze oficialni export je chvili
cachovany. Po tve akci (verbovani/utok) se stav rovnou upravi, aby cisla sedela hned.

---

# Dalsi drobne pomucky

Krome mapy pridava rozsireni i par pomucek na dalsich strankach hry:

- **Odhad obrany neutralky** — na strance neobsazene zeme (`l.asp`) spocita pravdepodobne
  slozeni jeji obrany.
- **Magicka hlaseni k zemi** — na strance zeme sesbira z hlaseni tvych spoluhracu kouzla,
  ktera na tu zem prosla.
- **Odhady sil v boji** — v hlasenich (`hlaseni.asp`) k utokum/obranam doplni odhadovanou silu
  utoku, resp. obrany, z poctu nasazenych a padlych jednotek.

(Tyto pomucky pochazeji z puvodnich uzivatelskych skriptu a parsuji stranky hry — kdyby hra
zmenila rozlozeni stranek, mohou prestat fungovat.)
