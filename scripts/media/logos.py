"""dummyPlane logo set: the wave mark (identity spec §4.1) and wordmark lockups,
the text outlined from Inter SemiBold so the SVGs render the same everywhere."""
import io
import os
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

REPO = Path(__file__).resolve().parents[2]
FONT = REPO / "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"
OUT = REPO / "docs/assets/brand"
os.makedirs(OUT, exist_ok=True)

SLATE, CLAY, IVORY_TEXT, INK = "#1A1918", "#D97757", "#F5F4EF", "#29261B"
WAVE = "M10 36 C 18 14, 26 14, 32 32 S 46 50, 54 26"


def instance(weight):
    font = TTFont(FONT)
    font.flavor = None
    inst = instantiateVariableFont(font, {"wght": weight, **({"opsz": 32} if "opsz" in [a.axisTag for a in font["fvar"].axes] else {})})
    buf = io.BytesIO()
    inst.save(buf)
    return inst, buf.getvalue()


def outline(text, weight, size, x0, baseline, tracking=0.0):
    """Path data for `text`, shaped by HarfBuzz (kerning), `size` units per em."""
    font, data = instance(weight)
    upem = font["head"].unitsPerEm
    face = hb.Face(data)
    hbfont = hb.Font(face)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hbfont, buf, {"kern": True, "liga": True})
    glyphs = font.getGlyphSet()
    order = font.getGlyphOrder()
    scale = size / upem
    pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    x = 0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        t = TransformPen(pen, (scale, 0, 0, -scale, x0 + (x + pos.x_offset) * scale, baseline - pos.y_offset * scale))
        glyphs[name].draw(t)
        x += pos.x_advance + tracking * upem
    width = (x - tracking * upem) * scale
    cap = font["OS/2"].sCapHeight * scale
    return pen.getCommands(), width, cap


def mark(size=64, x=0, y=0):
    s = size / 64
    return (f'<g transform="translate({x} {y}) scale({s:g})">'
            f'<rect width="64" height="64" rx="14" fill="{SLATE}"/>'
            f'<path d="{WAVE}" stroke="{CLAY}" stroke-width="7" fill="none" stroke-linecap="round"/></g>')


def write(name, body, w, h):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w:g}" height="{h:g}" viewBox="0 0 {w:g} {h:g}">'
           f'{body}</svg>\n')
    open(os.path.join(OUT, name), "w", encoding="utf8", newline="\n").write(svg)
    print(name, f"{w:g}x{h:g}")


# The mark alone, and the wave alone (for places that already have a dark ground).
write("dummyplane-mark.svg", mark(), 64, 64)
write("dummyplane-wave.svg", f'<path d="{WAVE}" transform="translate(-6 -12)" stroke="{CLAY}" stroke-width="7" fill="none" stroke-linecap="round"/>', 52, 40)

# Lockups: the app pairs an 22 px mark with 15 px SemiBold text and an 8 px gap.
M, GAP, SIZE = 64, 22, 44
for theme, color in (("dark", IVORY_TEXT), ("light", INK)):
    probe, width, cap = outline("dummyPlane", 600, SIZE, 0, 0, tracking=-0.012)
    baseline = M / 2 + cap / 2
    d, width, cap = outline("dummyPlane", 600, SIZE, M + GAP, baseline, tracking=-0.012)
    body = mark() + f'<path d="{d}" fill="{color}"/>'
    write(f"dummyplane-lockup-{theme}.svg", body, round(M + GAP + width + 2, 1), M)
