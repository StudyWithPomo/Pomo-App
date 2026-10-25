# Demo checklist (fresh Linux laptop)

Everything here is what this repo needs to run the dashboard against the Study Buddy device. Do the setup part the day before; the "On the day" part takes five minutes.

## 1. Install (once)

- [ ] **Python 3.10, 3.11 or 3.12.** Not 3.13: `mediapipe==0.10.21` has no 3.13 wheels.
  - Check with `python3 --version`. Ubuntu 24.04 ships 3.12. If yours is 3.13 (e.g. Fedora 41+), install a 3.12 package (`sudo dnf install python3.12`) and use `python3.12` below.
- [ ] Get the code and make a virtual environment:

      git clone https://github.com/StudyWithPomo/Pomo-App.git
      cd Pomo-App
      python3 -m venv .venv
      .venv/bin/python -m pip install -e ".[dev]"

  This pulls in OpenCV and mediapipe even if you run without the camera (they are in the dependency list), so do it on good Wi-Fi.
- [ ] Optional sanity check: `.venv/bin/python -m pytest` should pass.
- [ ] **Google Chrome** (or Chromium/Edge). Web Serial is Chromium-only; Firefox can't talk to the device.
  - Prefer the Chrome `.deb`/`.rpm` from google.com. Snap Chromium can't see serial ports unless you also run `sudo snap connect chromium:raw-usb`.

## 2. Serial port permission (once, needs a re-login)

The device's USB chip is a CP210x, so it shows up as `/dev/ttyUSB0` (or `ttyUSB1`, ...), owned by the `dialout` group.

- [ ] `sudo usermod -aG dialout $USER`
- [ ] **Log out and back in** (or reboot). The group only applies to new logins; `groups` must list `dialout` before Chrome can open the port.
- [ ] Plug the device in and check: `ls -l /dev/ttyUSB*` should show a `dialout` device.

## 3. Focus helper extension (once, optional)

Only needed if the demo shows a site drift from a real tab (YouTube etc.). The `Y` key fakes the same drift without it.

- [ ] Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick this repo's `extension` folder.
- [ ] The extension id must be `llpokpkaonmjajcghgjfklpdmbepijha` (it's fixed by the `key` in `extension/manifest.json`). The app only accepts that id.
- [ ] It sends only the active tab's URL and title, and only to `ws://localhost:8765` (this laptop).

## 4. Bluetooth (optional; USB is the safe choice)

The firmware advertises Bluetooth Classic SPP as **`Pomo-XXXX`** (last four hex digits of its address), pairs with "Just Works" (PIN `1234` if asked).

- [ ] Pair: `bluetoothctl` → `scan on` → wait for `Pomo-XXXX` → `pair <address>` → `trust <address>` → `quit`.
- [ ] **Untested on Linux.** Bluetooth with the dashboard has only been used on Windows (as a COM port). Whether Chrome on Linux lists the paired device in the Web Serial picker hasn't been checked, so plan the demo on **USB**.
- [ ] Known issue: the firmware sends `hello` on every new Bluetooth connection, and the dashboard currently treats a `hello` after a reconnect as "the device restarted" and ends the session. Don't reconnect Bluetooth mid-session in the demo.

## 5. On the day

- [ ] Plug the device into the laptop by USB (a data cable, not a charge-only one).
- [ ] Close anything else that might hold the serial port: `idf.py monitor`, Arduino IDE, `screen`, `minicom`.
- [ ] Start the app **without the camera** (no `uv` needed):

      cd Pomo-App
      .venv/bin/python -m pomo --no-camera

  It prints the dashboard address. Leave this terminal open.
- [ ] Open **http://localhost:8000** in Chrome.
- [ ] Click **Connect device** (top right) → pick the `CP210x` / `ttyUSB0` entry → expect a "Device says hello" toast.
- [ ] On Setup, set the pet and press **Send to device**; the pet changes on the device screen.
- [ ] Press **Begin**. The device enters focus; the dashboard follows its timer.
- [ ] Short on time? Turn on **Test timing** on the device's Study screen first: every study, break and long rest then lasts 30 s, and the dashboard shows a "Test timing" tag.
- [ ] Demo keys (click the page first so it has focus): `Y` YouTube drift, `I` idle, `Space` peek, `D` shows the demo drawer. With the drawer open, `F` makes a fake friend drift (use this if the second device isn't there).
- [ ] With a second device: start the session together from the device's **Circle** screen (invite → accept). The dashboard's study circle panel shows the friend and the 2× bonus.

## If X breaks, do Y

| Symptom | Fix |
|---|---|
| `python -m pomo` says "could not start the server (…). Is another copy already running?" | Another copy is still running. `ss -ltnp \| grep -E ':8000\|:8765'` shows the process; stop it (Ctrl+C in its terminal, or `kill <pid>`). For a clash on 8000 only, `--port 8001` and open that port. 8765 can't move (the page expects it). |
| "Connect device" picker is empty | Is it plugged in with a data cable? `ls /dev/ttyUSB*`. If the device exists but isn't listed: you haven't re-logged in since adding `dialout` (`groups` to check), or you're on snap Chromium (see section 1). |
| Picker shows the device but connecting fails ("Failed to open serial port") | Something else has the port open (`idf.py monitor`, Arduino, another Chrome tab with the dashboard). Close it and try again. `fuser /dev/ttyUSB0` shows who holds it. |
| No "hello" toast after connecting | The device was already running, so it sent `hello` earlier. That's fine: `config` is still sent. Press **Send to device** to check the link. Still nothing: unplug/replug and reconnect. |
| Extension does nothing; the app logs or devtools show **403** on the WebSocket | The extension id isn't the pinned one. Remove it and **Load unpacked** again from this repo's `extension` folder (the `key` line in `manifest.json` must be intact). Make sure you're running this repo's app (older builds didn't allow the extension at all). |
| Extension loaded but no drift from YouTube | Start a session first (drifts only count during focus). Reload the extension in `chrome://extensions` after restarting the app. |
| Page looks old after an update, or buttons missing | Hard refresh: **Ctrl+Shift+R**. |
| "lost the device" overlay after unplugging | Plug it back in and press **Reconnect**. If the device rebooted (USB powers it), the dashboard says the session ended and goes back to Setup; just press Begin again. |
| Camera error toast | You started without `--no-camera`, or the webcam is busy. Restart with `--no-camera` for the demo. |
