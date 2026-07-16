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
import os, sys, zipfile

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # .../DE-extension
OUT = sys.argv[1] if len(sys.argv) > 1 else r"C:/Users/apa11/Desktop/DE-extension-store"

# runtime soubory shodné pro všechny prohlížeče (bez manifestu — ten se řeší zvlášť)
RUNTIME = [
    "ui-kit.js", "map-fill.js", "spell-results.js", "map-history.js",
    "battle-mode.js", "contracts-mode.js", "regions.json", "borders.png",
    "images/menu-icon.png", "images/icon-16.png", "images/icon-32.png",
    "images/icon-48.png", "images/icon-128.png",
]

def build(zip_name, manifest_src):
    path = os.path.join(OUT, zip_name)
    if os.path.exists(path):
        os.remove(path)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        # manifest vždy jako "manifest.json" v kořeni
        z.write(os.path.join(SRC, manifest_src), "manifest.json")
        for rel in RUNTIME:
            z.write(os.path.join(SRC, rel), rel)
    with zipfile.ZipFile(path) as z:
        bad = z.testzip()
        n = len(z.namelist())
    print(f"{zip_name}: {n} souborů, {os.path.getsize(path)} B  (manifest={manifest_src})"
          + (f"  CHYBA:{bad}" if bad else ""))

os.makedirs(OUT, exist_ok=True)
build("DE-extension-chromium.zip", "manifest.json")
build("DE-extension-firefox.zip", "manifest.firefox.json")
print("Hotovo ->", OUT)
