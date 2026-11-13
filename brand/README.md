# OpenMindstorms logo

The three bricks from the home page plus the wordmark, in the site's Chakra Petch
display face (embedded in the SVGs, so they render anywhere).

| File | Use |
| --- | --- |
| `logo-square-dark.png` / `.svg` (512 x 512) | App icons and sign-in screens: Google OAuth consent screen, GitHub OAuth app |
| `logo-square-light.png` / `.svg` | Same on a white background |
| `logo-square-transparent.svg` | Light text, no background, for dark surfaces |
| `logo-wide-dark.png` / `.svg` (1600 x 500) | Banners, social previews, forum headers |
| `logo-wide-light.png` / `.svg` | Same on white |

`make_logo.py` regenerates the SVGs (it expects `cp.b64`, the base64 of the Chakra Petch
700 Latin woff2 from Google Fonts, next to it). PNGs were rendered from the SVGs with
headless Edge at 1:1.

## Favicons

`make_icons.py` writes the tab icons to `web/shared/icons/` (SVG, ICO with 16/32/48, 32 px and
180 px PNG): `home` shows all three bricks, `rcx`, `nxt` and `ev3` each show their own brick so
open Workbench tabs can be told apart. `web/favicon.ico` is a copy of `home.ico`. Run it with
`--png <tmp dir>` to re-render the bitmaps (needs Pillow and Edge).
