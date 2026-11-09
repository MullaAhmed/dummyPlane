# README media

The scripts that make the logos, banners, screenshots and GIFs in [`docs/assets/`](../../docs/assets/). Run them again when the interface changes.

They need Python 3.11+ (Pillow 13 requires it) with the packages in `requirements.txt`, Node.js 22 and Microsoft Edge (for the banners).

```powershell
py -3.12 -m venv .venv-media
.venv-media\Scripts\pip install -r scripts/media/requirements.txt
```

## Logos and banners

| File | Made by |
|---|---|
| `docs/assets/brand/dummyplane-mark.svg`, `dummyplane-wave.svg`, `dummyplane-lockup-{dark,light}.svg` | `logos.py`: the wave mark (spec identité §4.1) and the wordmark, its text outlined from Inter SemiBold |
| `docs/assets/brand/banner-{dark,light}.png`, `social-preview.png` | `banner.html` in the same folder, rendered by `shot.py` |

```powershell
.venv-media\Scripts\python scripts/media/logos.py
.venv-media\Scripts\python scripts/media/shot.py "docs/assets/brand/banner.html?theme=dark" docs/assets/brand/banner-dark.png 1280 400 2
.venv-media\Scripts\python scripts/media/shot.py "docs/assets/brand/banner.html?theme=light" docs/assets/brand/banner-light.png 1280 400 2
.venv-media\Scripts\python scripts/media/shot.py "docs/assets/brand/banner.html?theme=dark&layout=social&h=640" docs/assets/brand/social-preview.png 1280 640 1
```

`banner.html` loads Inter and JetBrains Mono from `node_modules`, so run `pnpm install` first. `social-preview.png` is the image to upload in the repository's **Settings → Social preview**.

## GIFs and screenshots

The recordings are made from the real app. The scripts drive the page through WebView2's DevTools port, so they send input to the page only, never to your mouse or keyboard. Pages are captured with `Page.startScreencast` and turned into GIFs by `gif.py`.

1. Start a development build with its own data folder and the DevTools port, in a 1440 × 900 window (the default size):

   ```powershell
   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9223'
   pnpm tauri dev --config '{\"identifier\":\"dev.dummyplane.probe\"}'
   ```

2. Create the demo repository, a throwaway `acme-shop` in your temp folder with one uncommitted change, then open it as a project:

   ```powershell
   $repo = .venv-media\Scripts\python scripts/media/mkrepo.py
   node scripts/media/open-project.mjs $repo
   ```

   The first Claude session in that folder asks whether you trust it; answer once in any terminal.

3. Record a scene, then build its GIF. Scenes are in `scenes.mjs`: `launch`, `broadcast`, `commands`, `review` and `mission`.

   ```powershell
   node scripts/media/reset.mjs                # empties the canvas, stops its agents
   node scripts/media/rec.mjs broadcast
   .venv-media\Scripts\python scripts/media/gif.py $env:TEMP\dummyplane-media\frames\broadcast docs/assets/demo/broadcast.gif --width 1200 --cap 1.5
   ```

   `launch` starts from an empty canvas. `broadcast` and `review` start their own group, and `commands` reuses the group that `broadcast` left. `sheet.py <gif> <png>` makes a contact sheet to check a GIF at a glance.

   `mission` runs a real mission: an orchestrator on Sonnet 5.5, wired to a group of two Claude agents, with the model router on. It streams the start, then takes a frame every 1.5 s while the team works, until the mission ends. Commit `acme-shop` first, so the mission starts from a clean tree. `gif.py --ramp t:speed,…` speeds up the long part and marks it with a `×N` badge. If a run stops after the plan, record the rest with `missionGo`, then stitch the two with `join.py <first frames> <cut, UTC HH:MM:SS> <second frames> <out>`.

4. `board.mjs <png> [dark|light]` takes the board screenshot once the canvas holds a group with answers.

> [!WARNING]
> The scenes run **real agents on your account**. `broadcast` sends one short question to three Claude Code sessions on Haiku, which is a few cents of usage. `mission` costs more: a Sonnet orchestrator and two agents work for several minutes. The other scenes send no prompt. Do not record in a repository you care about.
