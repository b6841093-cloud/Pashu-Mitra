# Pashu-Mitra brand assets

`pashu-mitra-logo.png` is the **official product logo** and the single source of
truth for every user-facing logo location:

| Location | File / code |
| --- | --- |
| Organisation header (all four portals + web-call page + public pages) | `frontend/org-config.js` → `ORG.logo.src` |
| Login / OTP / signup screens | same `ORG.logo.src` (`brandLogoHtml()` in `app.js`) |
| Browser tab (favicon) | `frontend/index.html` → `<link rel="icon">` |
| iOS home screen | `frontend/index.html` → `<link rel="apple-touch-icon">` |
| Installed app / PWA | `frontend/manifest.json` → `icons[]` (also `maskable`) |

Dropping the official file in this folder with this exact name completes the
branding — **no code change is needed**.

## Requirements for the file

* Format: **PNG** (raster, the artwork exactly as supplied).
* Size: at least 64×64 px, ideally 256×256 px or larger, under 2 MB.
* Any aspect ratio is accepted; the artwork's own ratio is always preserved.
  The CSS limits the **height only** (`.pm-logo-img` → 40 px in the header,
  56 px on the login card, 32/24 px in compact contexts) and uses
  `width:auto; object-fit:contain`, so the logo is **never stretched, squashed
  or cropped**.
* A transparent or plain background is fine. The brand palette is unchanged.
* Do **not** substitute the State Emblem of India (its use is restricted by the
  State Emblem of India (Prohibition of Improper Use) Act, 2005).
* Do **not** re-draw or re-export the artwork, and do not replace it with an
  emoji — the file is used byte-for-byte.

If the file is missing, the `<img>` hides itself and the accessible product name
("Pashu-Mitra") stays visible: a broken-image icon is never shown and no
substitute logo is used.

## How to add it

Either place it directly in a checkout:

```bash
cp /path/to/official-logo.png frontend/assets/pashu-mitra-logo.png
```

or, without a local checkout, upload it to the branch on GitHub
(**Add file → Upload files**, path `frontend/assets/pashu-mitra-logo.png`,
target branch `arena/78af3dc6-pashu-shield-updated`).

Verify afterwards:

```bash
node --test frontend/tests/branding_webcall_states.test.mjs   # PNG signature, size, ratio, no stretch
```

That test **skips with an explicit reason while the file is absent** and runs
for real as soon as the asset is present — it never reports a pass it did not
perform.
