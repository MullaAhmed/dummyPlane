"""Renders an HTML file to PNG with headless Edge, in a throwaway profile.
Usage: shot.py <html>[?query] <png> <width> <height> [scale]
Example: shot.py "docs/assets/brand/banner.html?theme=light" banner-light.png 1280 400 2"""
import os
import pathlib
import subprocess
import sys
import tempfile

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PROFILE = pathlib.Path(tempfile.gettempdir()) / "dummyplane-media" / "edge-profile"
html, png, w, h = sys.argv[1:5]
scale = sys.argv[5] if len(sys.argv) > 5 else "1"
path, _, query = html.partition("?")
url = pathlib.Path(path).resolve().as_uri() + ("?" + query if query else "")
out = pathlib.Path(png).resolve()
subprocess.run([
    EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    f"--user-data-dir={PROFILE}", "--allow-file-access-from-files",
    f"--force-device-scale-factor={scale}", f"--window-size={w},{h}",
    "--virtual-time-budget=4000", "--default-background-color=00000000",
    f"--screenshot={out}", url,
], check=True, capture_output=True, timeout=60)
print(out, os.path.getsize(out))
