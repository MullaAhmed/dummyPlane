# dummyPlane brand and media

The images used by the README, and the brand files you can reuse when you write about dummyPlane. The scripts that make them are in [`scripts/media/`](../../scripts/media/).

## Logo

<p>
  <img src="brand/logo-icon-cream.svg" width="64" alt="The dummyPlane mark, for dark backgrounds" style="background:#111111;padding:8px">
  &nbsp;
  <img src="brand/logo-icon-black.svg" width="64" alt="The dummyPlane mark, for light backgrounds">
</p>

The mark is a pixel symbol built from a grid of 4 × 4 squares.

| File | Use |
|---|---|
| [`brand/logo-icon-cream.svg`](brand/logo-icon-cream.svg), [`brand/logo-icon-white.svg`](brand/logo-icon-white.svg), [`brand/logo-icon-black.svg`](brand/logo-icon-black.svg) | The mark alone, transparent background: app icon, avatar, favicon. Cream and white for dark backgrounds, black for light ones |
| [`brand/logo-wordmark-*.svg`](brand/) and [`brand/logo-horizontal-*.svg`](brand/) | Lettering only, and mark with lettering. **Not in use yet:** the lettering in this pack reads "dummyIndex", not dummyPlane |
| [`brand/banner-dark.png`](brand/banner-dark.png), [`brand/banner-light.png`](brand/banner-light.png) | README header, 2560 × 800, in the Dark and Expressive and Calm and Playful palettes |
| [`brand/social-preview.png`](brand/social-preview.png) | GitHub social preview, 1280 × 640, in Dark and Expressive |

Please keep the mark's proportions and colors, and leave some room around it.

## Colors

The banners use two of the app's three palettes (the third is Electric and Energetic, canvas `#263CF5`, ink `#F4F4F1`). A palette is a canvas and an ink, and the ink is also the accent.

| | Dark and Expressive (the default) | Calm and Playful |
|---|---|---|
| Canvas | `#101014` | `#EDE3CC` |
| Text and accent | `#F4F4F1` | `#173F32` |
| Text on an accent fill | `#101014` | `#EDE3CC` |
| Waiting | `#DDAA62` | `#7A5418` |
| Success | `#7CC492` | `#356A44` |
| Terminals | `#0B0B0E` | `#0F2921` |

The full set of tokens is in [`src/theme/tokens.css`](../../src/theme/tokens.css) and the identity spec, [`docs/superpowers/specs/2026-10-25-dummyplane-identite-design.md`](../superpowers/specs/2026-10-25-dummyplane-identite-design.md) §4.

## Screenshots and GIFs

| Folder | Content |
|---|---|
| [`screenshots/`](screenshots/) | The board in both themes, and the usage detail |
| [`demo/`](demo/) | The tour GIFs and a real mission, recorded from the real app on a throwaway repository |
