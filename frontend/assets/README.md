# Pashu-Mitra brand assets

`pashu-mitra-logo.png` is the **official product logo** and the single source of
truth for every user-facing logo location:

| Location | File / code |
| --- | --- |
| Organisation header (all portals) | `frontend/org-config.js` → `ORG.logo.src` |
| Login / OTP / signup screens | same `ORG.logo.src` (rendered by the global header) |
| Browser tab (favicon) | `frontend/index.html` → `<link rel="icon">` |
| Installed app / PWA | `frontend/manifest.json` → `icons[]` |

Replace the file to re-brand: no code change is needed.

* Keep the artwork's own aspect ratio — the CSS only limits the height
  (`.pm-logo-img`, 40 px) and uses `object-fit: contain`, so the logo is never
  stretched or cropped.
* If the file is missing, the `<img>` hides itself and the accessible product
  name stays visible. A broken-image icon is never shown, and no substitute or
  redrawn logo is used.
* Do **not** use the State Emblem of India here (its use is restricted by the
  State Emblem of India (Prohibition of Improper Use) Act, 2005).

**Current status:** the logo file itself has not been added to this working
copy yet — the attachment did not arrive with the change request. Every
reference above already points at `assets/pashu-mitra-logo.png`, so dropping the
official PNG in this folder (same file name) completes the branding without any
further code change.
