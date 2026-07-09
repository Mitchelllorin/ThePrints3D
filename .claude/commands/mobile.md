---
description: Launch the dev server + open it in phone-emulated Chrome (Android UA, no DevTools needed)
---

Run `powershell -ExecutionPolicy Bypass -File scripts/launch-mobile.ps1` and report
the URLs it prints.

What it does: kills stray node, starts `npm run dev -- --host`, auto-detects the
Vite port, and opens a SEPARATE Chrome instance with an Android user-agent + touch +
a Pixel-sized window — so the app's mobile detection is true and you see the REAL
mobile build without touching DevTools.

Adapt for this project:
- If the mobile view is behind a router route, pass it: `... launch-mobile.ps1 -AppPath '/#/your-route'`.
- Confirm how this app detects mobile (grep `isMobile`, `navigator.userAgent`,
  `matchMedia`, `maxTouchPoints`). If it keys off a width media query rather than
  the UA, the phone-sized window still switches the layout.

Origin: ported from CircuiTry3D, where the user is blind and the phone/emulated
view is ground truth — co-drive UX one testable piece at a time; don't batch big
autonomous changes.
