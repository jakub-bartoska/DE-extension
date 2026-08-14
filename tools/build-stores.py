#!/usr/bin/env python3
"""Zabalí distribuční balíky rozšíření pro jednotlivé obchody.

Vytvoří:
  DE-extension-chromium.zip  — Chrome / Edge / Opera (Chromium, MV3; manifest.json)
  DE-extension-firefox.zip   — Firefox (Gecko, MV3; manifest.firefox.json → manifest.json)

Balíky mají manifest v kořeni a obsahují jen runtime soubory (bez .bak, README,
PRIVACY, tools, .git, nepoužitého land-notes.js). Kód je pro všechny prohlížeče
IDENTICKÝ — liší se jen manifest (Firefox potřebuje browser_specific_settings.gecko).

Použití:
  python tools/build-stores.py [OUT_DIR]
Výchozí OUT_DIR = C:/Users/apa11/Desktop/DE-extension-store
"""
import json, os, sys, zipfile

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # .../DE-extension
OUT = sys.argv[1] if len(sys.argv) > 1 else r"C:/Users/apa11/Desktop/DE-extension-store"

# Soubory se berou Z MANIFESTU, ne z ručního seznamu. Dřív tu byl výčet natvrdo
# a při přidání nového skriptu se zapomněl doplnit → balík by se postavil bez něj
# a rozšíření by v obchodě spadlo. Manifest je jediný zdroj pravdy.
def runtime_files(manifest):
    files = []
    for cs in manifest.get("content_scripts", []):
        files += cs.get("js", []) + cs.get("css", [])
    for war in manifest.get("web_accessible_resources", []):
        files += war.get("resources", [])
    files += list(manifest.get("icons", {}).values())
    seen, out = set(), []
    for f in files:                      # zachovat pořadí, zahodit duplicity
        if f not in seen:
            seen.add(f); out.append(f)
    return out

def build(zip_name, manifest_src):
    with open(os.path.join(SRC, manifest_src), encoding="utf-8") as fh:
        manifest = json.load(fh)
    files = runtime_files(manifest)

    missing = [f for f in files if not os.path.exists(os.path.join(SRC, f))]
    if missing:
        sys.exit(f"CHYBA: {manifest_src} odkazuje na neexistující soubory: {missing}")

    path = os.path.join(OUT, zip_name)
    if os.path.exists(path):
        os.remove(path)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(os.path.join(SRC, manifest_src), "manifest.json")  # vždy jako manifest.json
        for rel in files:
            z.write(os.path.join(SRC, rel), rel)

    # kontrola hotového balíku: nesmí v něm chybět nic, na co manifest odkazuje
    with zipfile.ZipFile(path) as z:
        bad = z.testzip()
        names = set(z.namelist())
        n = len(names)
    chybi = [f for f in files if f not in names] + [f for f in ["manifest.json"] if f not in names]
    print(f"{zip_name}: {n} souborů, {os.path.getsize(path)} B  v{manifest['version']}  (manifest={manifest_src})"
          + (f"  CHYBA:{bad}" if bad else "")
          + (f"  CHYBÍ:{chybi}" if chybi else ""))
    if bad or chybi:
        sys.exit(1)
    print("   skripty:", ", ".join(manifest["content_scripts"][0]["js"]))

os.makedirs(OUT, exist_ok=True)
build("DE-extension-chromium.zip", "manifest.json")
build("DE-extension-firefox.zip", "manifest.firefox.json")
print("Hotovo ->", OUT)
