# Study Buddy — feature list

A steampunk desk companion for SBU Hacks. An ESP32 with a 2.8" touchscreen (320×240, landscape) and a rotary encoder hosts a clockwork pet that reacts to how well you focus. A laptop dashboard sets up sessions, watches for distractions, and prints a time card at the end.

**Pitch:** Study Buddy doesn't block anything. It notices when you drift, tells you why, and gives you a reason to come back.

---

## Shared systems

**The pet**
- Three bodies: clockwork bot (wind-up key), cat, dog.
- Two faces: plain or monocle.
- Four finishes: brass, copper, pewter, verdigris.
- Five moods, shared by every body: happy (idle), focused, annoyed (drift), wound up (break), shh (tapped during focus).
- The name is chosen by the user (up to 10 letters) and set on the laptop.
- Evolution: accessories unlock as it levels up. Goggles at Lv 5, bow tie at Lv 10, top hat at Lv 15.
- Drawn from one 16×16 pixel grid (`pet.js`), so the firmware can draw it in code with a palette swap. No image per combination.

**Timer**
- Pomodoro by default (25 min study / 5 min break). Custom lengths allowed: 15, 25, 45 or 60 min.
- Break rule: the break must be ⅕ to ⅓ of the study time (15 → 3–5, 25 → 5–8, 45 → 9–15, 60 → 12–20). The UI only offers allowed values.
- Four sessions per set, then a 15-minute long rest.
- **The timer is hidden by default** on both screens, so you're not watching the clock. Peek for 5 seconds with a knob press or the laptop button, or turn on "Always show."

**Focus score ("focus pressure")**
- Focus score = focused time ÷ elapsed time.
- **Sealed by default** during a session and revealed on the time card. Can be set to always show.

**Distractions (drift)**
- Screen drift: a distracting site or app (YouTube, Instagram, TikTok, Reddit, Netflix and similar), reported by a helper on the laptop.
- Idle: no keyboard or mouse input for 60 s (browser Idle Detection API).
- Every drift is named and timed ("YouTube 0:31"). The app never just says "you're not focused."
- Nothing is ever blocked.

**Study circle (linked play)**
- Friends' devices nearby (ESP-NOW) form a circle.
- XP multiplier: 2 friends = 2×, capped at 3×.
- **The bonus pauses while anyone in the circle is drifting**, so your slip costs your friends too (body doubling).

**XP, levels, hearts**
- +1 XP per focused minute × the circle multiplier. 500 XP per level.
- A session under 50% focus earns no XP and costs 10 XP, but never drops you below the start of your level.
- Hearts (0–5) are the pet's mood: +2 at 80%+, +1 at 60%+, −1 under 50%.

---

## Device screens (ESP32 + 2.8" TFT)

**Controls on every screen**
- **Turn knob:** move the highlight, or change a value.
- **Press:** select or confirm.
- **Hold 2 s:** go back, or end a session early.
- **Tap:** select directly. Locked during focus.
- The highlighted item is always filled brass with a ▸ pointer.

| # | Screen | What's on it |
|---|---|---|
| 00 | **Boot** | "Study Buddy", day and time, the pet in its porthole, "Good evening, Sidak. Mochi missed you.", the question "Ready for a study session?" and two buttons: **Yes, wind it** and **Not yet**. |
| 01 | **Home** | Pet name and level, a **Menu** chip, the pet in its porthole, a study circle card (2× XP, friends' names), and a **Begin 25 / 5** button. The knob cycles Begin, Circle and Menu. |
| 02 | **Wind the timer** | A "Pomodoro" tag, a **Study** row with nixie digits (turn to set), a **Break** row showing the allowed range ("allowed 5–8"), and a hint line. |
| 03 | **Focus (default, timer hidden)** | "In Session", the 2× XP badge, a large pet in the porthole, four dark nixie tubes with "Press to peek", and friends' status lamps ("Ava · focused"). |
| 03b | **Peek** | The same screen with the nixie timer lit and a progress rail. Goes dark again after 5 s. |
| 04 | **Drift** | A copper alarm band naming the drift and its time ("YouTube Detected 0:31"), the annoyed pet, the note "Kindly return to your studies.", a small timer, and "2× paused." |
| 05 | **Intermission** | Verdigris frame, break countdown, the wound-up pet with hearts, "Turn or hold to wind Mochi", and "+2 ♥". Touch unlocks: petting the pet or turning the knob winds its key. |
| 06 | **Menu** | Begin session (25 / 5), Study circle (2 near), Mochi's workshop, Timer settings. Rows are 64 px tall in the 2× mockup, 32 px on the real screen. |
| 07 | **Mochi's workshop** | A live preview in the porthole. Rows for Body (Bot / Cat / Dog), Face (Plain / Monocle) and Finish (4 swatches). The outlined row is where the knob is; a filled chip is what's chosen. |

Other device duties:
- A chime marks the start of each break.
- The device can run sessions alone with no laptop. The laptop adds drift detection and stats.

---

## Laptop dashboard (web page on localhost)

**Top bar (every view):** the "Study Buddy" wordmark, step indicators (Setup · Session · Time card), and the device button ("Connect device" → "Device coupled · USB" with a lamp).

**1. Setup: "Before you begin"**
- "What are you working on?" goal field. It shows up on the time card.
- Study length chips: 15 / 25 / 45 / 60 min.
- Break chips limited to the allowed range, with the rule explained ("Classic Pomodoro" at 25 / 5).
- A **Begin** button showing the length and session number ("25 / 5 · Session I of IV").
- The study circle line ("Ava and Dev · 2× XP").
- **Your companion** panel:
  - live pet preview with name and level
  - name field (10 letters max)
  - body, face and finish pickers
  - **Send to device**

**2. Session: the live view**
- **Nixie timer:** realistic tubes (glass envelope, hex mesh, unlit digits behind the lit one, a neon-bulb colon). Dark by default, with **Peek for 5 s**, **Always show timer** and **End early**. When shown, it adds the elapsed rail and the end time.
- **Status line:** "Focused for 4 min on Problem set 4", or the live drift ("YouTube for 0:31. Kindly return to your studies.").
- **Pet porthole** mirroring the pet's mood ("Mochi is locked in." / "not amused").
- **Focus pressure gauge:** reads "Sealed" until the end, with an **Always show score** toggle.
- **Ship's log:** recent events in plain words ("Wandered to YouTube. Back after 0:31.").
- **Study circle panel:** the multiplier, each friend's status lamp, the level and XP bar, and "+26 XP so far (13 focused min × 2)."
- **The ledger:** a minute-by-minute strip (focused / screen drift / idle) with labels. Only shown while the timer is visible, so it doesn't give the time away.
- During a break, the same view switches to green nixie digits and hides the score, log and circle.

**3. Time card: the end of a session**
- **A punched time card prints out of a brass slot** (animated), then a **"90% Focused" stamp** lands on it. The card shows: card number, IN and OUT times, date, the task, a minute grid (holes = focused, copper ring = screen, copper dot = idle), focused time, each lapse with its duration, the XP line ("22 MIN × 2 CIRCLE = 44", or the penalty), hearts, and a tear-off stub ("II / IV").
- **Verdict headline:** "90% focused." plus a summary ("25 minutes, two lapses, 44 XP. YouTube cost you the most.").
- **Pet verdict:** the pet's reaction, level-ups and unlocks, the XP bar, and "XP to next level".
- **The circle's cards:** a leaderboard of you and your friends' focus %.
- **Did you finish?** The goal with **Yes / Partly / Not yet**. Unfinished goals carry into the next session.
- **A note for next time:** one specific tip based on the biggest lapse.
- **Up next:** **Start intermission** (or the long rest after IV) or **Skip to next session**.

**Demo controls** (a drawer in the bottom-right corner, plus keyboard shortcuts) fake drifts, idle, a friend drifting, ×30 speed and jump-to-end, so the full flow can be shown without hardware.

---

## Out of scope for this build
Camera and posture tracking, laptop mount, phone tray, PIR and ultrasonic sensors, audio or voice module, night light, daily strengths-and-improvements summary.
