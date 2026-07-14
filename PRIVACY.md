# Zásady ochrany soukromí — Dark Elf (neoficiální rozšíření funkcí)

_Poslední aktualizace: 14. 7. 2026_

Toto je neoficiální rozšíření prohlížeče pro hru **Dark Elf** (darkelf.cz).
Toto je kompletní přehled toho, jak rozšíření nakládá s daty.

## Krátce

**Rozšíření nesbírá, neukládá ani neposílá žádné osobní údaje jeho autorovi ani žádné
třetí straně.** Nemá žádnou analytiku, žádné sledování, žádné reklamy a nikomu nic neprodává.

## Kde rozšíření běží

Rozšíření je aktivní **výhradně na doméně `https://www.darkelf.cz/`**. Na žádných jiných
webech se nespouští a k jejich obsahu nemá přístup.

## S jakými daty pracuje a proč

- **Obsah herních stránek darkelf.cz** — rozšíření čte obsah stránek hry (mapa, hlášení,
  stránky zemí), aby nad ně vykreslilo své pomůcky (obarvení území, štítky se silou apod.).
  Toto zpracování probíhá **lokálně ve tvém prohlížeči**. Data se nikam neodesílají.

- **Oficiální herní API na darkelf.cz** (`map_export_json.asp`) — bojový mód a barvení
  čtou aktuální stav mapy a tvých zemí ze samotné hry (stejný server, na kterém hraješ).
  Jde o komunikaci mezi tvým prohlížečem a herním serverem, stejně jako když hru běžně hraješ.

- **Veřejné historické API** (`https://jromqobezam5ot4ixfszrbrjhu0dyjwb.lambda-url.eu-central-1.on.aws/`)
  — pro funkci „Historie mapy" si rozšíření **stahuje** (pouze čtení) veřejné snímky mapy
  jednotlivých lig. Tyto snímky vznikají z **veřejné spectator mapy**, která je dostupná
  komukoli i bez přihlášení. Rozšíření na toto API **neodesílá žádná tvá osobní data ani
  přihlašovací údaje** — jen si vyžádá historická data k zobrazení.

## Co rozšíření NEDĚLÁ

- Nesbírá jména, e-maily, hesla ani jiné osobní údaje.
- Nečte tvoje přihlašovací údaje ani cookies a nikam je neposílá.
- Nesleduje tvou aktivitu na webu a nepředává data reklamním sítím.
- Neběží na jiných webech než darkelf.cz.

## Herní akce

Bojový mód umí na tvůj pokyn provést reálné herní tahy (verbování, stavby, útoky).
Tyto akce se posílají **pouze hernímu serveru darkelf.cz** a jen tehdy, když na dané
tlačítko sám klikneš.

## Kontakt

Dotazy k soukromí i k rozšíření: [GitHub – jakub-bartoska/DE-extension](https://github.com/jakub-bartoska/DE-extension).

## Změny

Případné změny těchto zásad budou zveřejněny v tomto souboru v repozitáři projektu.

---

# Privacy Policy — DE-extension (English summary)

DE-extension is a browser helper for the game **Dark Elf** (darkelf.cz).

**The extension does not collect, store, or transmit any personal data to its author or any
third party.** No analytics, no tracking, no ads, nothing sold.

It runs **only on `https://www.darkelf.cz/`**. It reads the game's page content locally in
your browser to draw overlays, talks to the game's own API on darkelf.cz (the same server you
play on), and **downloads** read-only public map snapshots from a history API
(`…lambda-url.eu-central-1.on.aws`). It sends **no personal data or credentials** to that API.
Battle-mode actions (recruit/build/attack) are sent only to darkelf.cz and only when you click
the corresponding button.

Contact: https://github.com/jakub-bartoska/DE-extension
