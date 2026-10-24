# Study Buddy (Pomo): notes for Claude Code

I'm Sidak, the frontend / UI-UX person on a 4-person SBU Hacks team. The event **ends Sunday**, so speed matters most. Keep changes small and safe, and never break the demo.

## What this is
A steampunk desk study companion. An ESP32 with a 2.8" touchscreen (320×240, ILI9341 + XPT2046 touch, rotary encoder) shows a clockwork pet that reacts to how well you focus. This repo is the **laptop side**: one Python process that serves the dashboard and runs webcam focus tracking.

- `src/pomo/web/`: **the dashboard (my area).** Plain HTML/CSS/JS, no build step, no framework.
  - `index.html`: three views (`#view-setup`, `#view-live`, `#view-card`), plus the demo drawer and the toast.
  - `app.js`: everything else (state, session engine, rendering, Web Serial, camera feed, petting).
  - `pet.js`: the pet sprite as 16×16 rectangle data plus palettes (`StudyPet.drawPet(canvas, opts)`). The firmware uses the same data.
  - `styles.css`: theme tokens on `:root`, plus bundled `@font-face` rules at the top.
  - `fonts/`: bundled woff2 files, so the dashboard works offline. **Never re-add Google Fonts links.**
  - `schema/pomo-device.schema.json`: **the serial protocol, and the source of truth.** Where it disagrees with older READMEs, the schema wins.
- `src/pomo/*.py`: the server and the camera/ML pipeline (my teammates' area).
- `docs/FEATURES.md`: the full feature list for both UIs.

## Run it (Windows, from the Pomo-App folder)
```
uv run python -m pomo --no-camera     # UI work, no webcam
uv run python -m pomo --preview       # with camera + overlay window
```
Open http://localhost:8000 in **Chrome or Edge** (Web Serial is Chromium-only).
Demo keys (no hardware needed): `Y` YouTube drift, `I` idle, `F` friend drifts, `S` ×30 speed, `E` jump to the end, `Space` peek.
Python tests: `uv run pytest`. There are no JS tests, so test the UI by clicking through all three views.

## Rules: don't break these
- **Product rules** (enforced in `app.js`; keep them):
  - Break = ⅕ to ⅓ of study time (25 → 5–8). Four sessions per set, then a 15-min long rest.
  - **The timer and focus score are hidden during focus by default.** Peek for 5 s, or "Always show."
  - XP = focused minutes × study-circle multiplier (capped at 3×). The bonus pauses if anyone in the circle drifts. Under 50% focus: −10 XP, never dropping a level.
  - Petting only works outside focus. During focus the pet shows `shh` and the "Not now" bubble, with no hearts.
- **Code conventions in `app.js`:**
  - `S` is the global app state; `s` is the local `S.session`. **Always null-guard the session**: `S.session && S.session.mode === 'focus'`. There's no session on the Setup and Time card views.
  - `$` is `getElementById`. Views render through `renderSetup()`, `renderLive()` (runs every second) and `renderCard()`.
  - Pet faces go through `currentMood()` / `drawPets()`. Never hard-code a mood in a draw call, or `renderLive()` overwrites it every second.
  - Use `textContent` for user text, not `innerHTML`.
- **Design:** steampunk, built from the device. Walnut, brass, parchment, copper for drift, verdigris for breaks. Fonts: IM Fell English SC (display), Libre Caslon Text (body), IBM Plex Mono (numbers). Use the CSS variables in `:root`; don't add new colors. Pixel-art icons only, no emoji. **No generic "AI slop" UI:** no gradients, glassmorphism, soft drop shadows, rounded SaaS cards or Inter. Respect `prefers-reduced-motion`. Keep buttons at least 44px tall.
- **Privacy:** camera frames never get saved or sent anywhere. Don't change that.

## How to work with me
- **One branch per task**, created from an up-to-date `main`: `git checkout main && git pull && git checkout -b <name>`. Never commit straight to `main`, never force-push, and never rewrite history.
- **Stay inside `src/pomo/web/`** unless I say otherwise. Ask before touching the Python server, the ML code, `pyproject.toml` or the protocol schema. Teammates own those.
- Keep each change small. Tell me what you changed and how to test it, and **let me review `git diff` before committing.** Don't push or open pull requests unless I ask.
- If a change touches the serial protocol, check it against `schema/pomo-device.schema.json` and tell me, because the firmware team has to match it.
- I'm on Windows (cmd / PowerShell in VS Code). Give me Windows commands.

## Task queue (in order)
1. **Hide the demo drawer by default.** `<aside id="demo">` starts hidden. The `D` key toggles it, in the existing `keydown` listener after the input-field check. Typing "d" in a text field must not toggle it. Y/I/F/S/E keep working while it's hidden.
2. **Integration fixes** as the hardware team brings up the serial link. I'll paste errors. The flow to verify: Connect device → hello toast → Send to device (pet updates on the screen) → Begin (device enters focus) → `Y` drift (device shows the alarm band) → knob press peeks / hold ends the session.
3. **Level-up moment on the time card.** When `c.leveled` is true: a brief burst plus a "Level N!" banner, with the unlocked accessory (goggles at Lv 5, bow tie at 10, top hat at 15) appearing on the card pet. Pixel style, reduced-motion safe, under 1.5 s.
4. **Top-bar step labels** (Setup · Session · Time card) look clickable but aren't. Restyle them clearly as progress markers. Don't make them navigate mid-session.
5. **Small-laptop check.** At 1366×768, make sure the Session view's key info (the timer, the pet, the study circle) is visible without scrolling, and that nothing overflows.
