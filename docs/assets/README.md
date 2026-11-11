# dummyPlane brand and media

The images used by the README, and the brand files you can reuse when you write about dummyPlane.
## Logo

<p>
  <img src="brand/logo-icon-cream.svg" width="64" alt="The dummyPlane mark, for dark backgrounds" style="background:#111111;padding:8px">
  &nbsp;
  <img src="brand/logo-icon-black.svg" width="64" alt="The dummyPlane mark, for light backgrounds">
</p>

The mark is a pixel symbol built from a grid of 4 × 4 squares. The app icon and the browser favicon ([`public/favicon.svg`](../../public/favicon.svg)) use the same mark on a dark rounded tile.

| File | Use |
|---|---|
| [`brand/logo-icon-cream.svg`](brand/logo-icon-cream.svg), [`brand/logo-icon-white.svg`](brand/logo-icon-white.svg), [`brand/logo-icon-black.svg`](brand/logo-icon-black.svg) | The mark alone, transparent background: app icon, avatar, favicon. Cream and white for dark backgrounds, black for light ones |
| [`brand/logo-horizontal-cream.svg`](brand/logo-horizontal-cream.svg), [`brand/logo-horizontal-white.svg`](brand/logo-horizontal-white.svg), [`brand/logo-horizontal-black.svg`](brand/logo-horizontal-black.svg) | The mark followed by "ummyPlane", drawn on the same 4 × 4 grid, so the mark is the "d" of dummyPlane: 236 × 53, transparent background. Cream and white for dark backgrounds, black for light ones |
| [`brand/banner-dark.png`](brand/banner-dark.png), [`brand/banner-light.png`](brand/banner-light.png) | README header, 2560 × 800, in the Dark and Expressive and Calm and Playful palettes |
| [`brand/social-preview.png`](brand/social-preview.png) | GitHub social preview, 1280 × 640, in Dark and Expressive |

Please keep the mark's proportions and colors, and leave some room around it.

## Colors

The three palettes of the app, from the tokens in [`src/theme/tokens.css`](../../src/theme/tokens.css); the default is `expressive`. The banners use two of them, Dark and Expressive and Calm and Playful. A palette is a canvas and an ink, and the ink is also the accent.

| | Dark and Expressive (`expressive`, the default) | Calm and Playful (`calm`) | Electric and Energetic (`electric`) |
|---|---|---|---|
| Canvas | `#101014` | `#EDE3CC` | `#263CF5` |
| Text and accent | `#F4F4F1` | `#173F32` | `#F4F4F1` |
| Text on an accent fill | `#101014` | `#EDE3CC` | `#263CF5` |
| Waiting | `#DDAA62` | `#7A5418` | `#F7DCA2` |
| Success | `#7CC492` | `#356A44` | `#AEEBBC` |
| Terminals | `#0B0B0E` | `#0F2921` | `#0D1556` |

The palette is set by `data-palette` on `<html>`. The full set of tokens is in [`src/theme/tokens.css`](../../src/theme/tokens.css), and the design rules behind these values are in the [design system](../design-system.md).
