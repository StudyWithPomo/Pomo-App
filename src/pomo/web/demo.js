/* Pomo — simulated device, for the hosted demo (GitHub Pages) with no hardware and no server.
   It stands in for the serial port: app.js writes laptop -> device lines to it, and it answers with
   the device -> laptop lines of schema/pomo-device.schema.json (hello, start, state, end, circle),
   which app.js reads through the same handler as a real device's.
   Like the firmware it owns the countdown, XP and level. Time runs fast: a study session of any
   length takes about a minute, and its break and long rest shrink by the same factor, so every
   number the device reports (left, total, minutes, XP) is in the session's own minutes. */
(function () {
  'use strict';

  const XP_PER_LEVEL = 500;
  const MAX_MULT = 3;
  const SESSIONS_PER_SET = 4;
  const LONG_BREAK = 15;
  const DRIFT_MINUTE_SECS = 15; // a minute with 15+ s of drift is a drift minute
  const PENALTY_BELOW = 50, PENALTY_XP = 10;
  const SESSION_REAL_S = 60; // a study session lasts about this long, whatever its length
  const START_XP = 3 * XP_PER_LEVEL + 490; // Lv 4, 10 XP short of Lv 5 (goggles): the first session levels up
  const CAMERA_LABELS = { absent: 'Away from desk', drowsy: 'Drowsy', looking_away: 'Looking away', slouching: 'Slouching' };

  const isLocal = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  // ?demo=1 turns it on, ?demo=0 off; otherwise it is on anywhere but localhost
  function wanted() {
    let q = null;
    try { q = new URLSearchParams(location.search).get('demo'); } catch (e) { /* no query */ }
    if (q === '1') return true;
    if (q === '0') return false;
    return !isLocal();
  }

  // emit(line) gets each device -> laptop line (a JSON string, no newline)
  function create(emit) {
    let stopped = false;
    const d = {
      phase: 'idle', session: 1, study: 25, brk: 5, left: 0, total: 0, rate: 1,
      elapsed: 0, xp: START_XP, drift: null, camera: null, run: null
    };
    const friends = [{ name: 'Ava', focused: true, pct: 0, drifted: 0 }, { name: 'Dev', focused: true, pct: 0, drifted: 0 }];
    const level = () => Math.floor(d.xp / XP_PER_LEVEL) + 1;
    const activeDrift = () => (d.phase === 'study' ? d.drift || d.camera : null);
    // Every friend studies along with you, so all of them count toward the bonus; it pauses while anyone drifts
    const mult = () => (activeDrift() || friends.some((f) => !f.focused) ? 1 : Math.min(MAX_MULT, 1 + friends.length));

    // Lines go out a moment later, as over the serial link, in order; the device drops lines of 256+ bytes
    function out(m) {
      const line = JSON.stringify(m);
      if (new TextEncoder().encode(line + '\n').length >= 256) { console.warn('Simulator: line too long, dropped', m); return; }
      setTimeout(() => { if (!stopped) emit(line); }, 20);
    }
    function state() {
      const a = activeDrift();
      const m = {
        t: 'state', left: d.left, total: d.total, phase: d.phase, focus: a ? 'drift' : 'focused', session: d.session,
        drift: a ? a.label : '', drift_kind: a ? a.kind : '', drift_s: a ? d.elapsed - a.since : 0, mult: mult(), xp: d.xp, level: level()
      };
      if (d.phase === 'study') m.earned = d.run.earned;
      out(m);
    }
    function circle() {
      out({ t: 'circle', friends: friends.map((f) => ({ name: f.name, focused: f.focused, pct: f.pct })) });
    }

    // The firmware's snapping: study 15-90 in steps of 5, the break between a fifth and a third of it
    function setLengths(m) {
      const study = Math.min(90, Math.max(15, Math.round((Number(m.study) || 25) / 5) * 5));
      const brk = Math.min(Math.floor(study / 3), Math.max(Math.ceil(study / 5), Math.round(Number(m.brk) || 0)));
      d.study = study;
      d.brk = brk;
    }
    function beginStudy(session) {
      d.phase = 'study';
      d.session = session;
      d.total = d.left = d.study * 60;
      d.rate = Math.round(d.total / SESSION_REAL_S);
      d.elapsed = 0;
      d.drift = d.camera = null;
      d.run = { minDrift: 0, minMult: MAX_MULT, focusedMin: 0, earned: 0 };
      friends.forEach((f) => { f.focused = true; f.pct = 0; f.drifted = 0; });
      out({ t: 'start', study: d.study, brk: d.brk, session });
      circle();
      state();
    }
    // One second of study, in session time
    function studySecond() {
      const r = d.run;
      if (activeDrift()) r.minDrift++;
      r.minMult = Math.min(r.minMult, mult());
      friends.forEach((f) => { if (!f.focused) f.drifted++; });
      d.left--;
      d.elapsed++;
      if (d.elapsed % 60 === 0) {
        if (r.minDrift < DRIFT_MINUTE_SECS) { r.focusedMin++; r.earned += r.minMult; }
        r.minDrift = 0;
        r.minMult = MAX_MULT;
      }
    }
    // Score the session; an early end doesn't count the partial last minute and skips the break
    function finishStudy(early) {
      const r = d.run;
      const elapsedMin = Math.floor(d.elapsed / 60);
      const pct = elapsedMin ? Math.round((r.focusedMin / elapsedMin) * 100) : 0;
      const penalty = elapsedMin >= 1 && pct < PENALTY_BELOW;
      const floor = (level() - 1) * XP_PER_LEVEL; // a penalty never drops a level
      const delta = penalty ? -Math.min(PENALTY_XP, d.xp - floor) : r.earned;
      d.xp += delta;
      out({ t: 'end', pct, xp: delta || 0, level: level(), total_xp: d.xp, focused_min: r.focusedMin, elapsed_min: elapsedMin, penalty, early });
      // The friends finish with you and post their own scores
      friends.forEach((f, i) => {
        f.focused = true;
        f.pct = Math.max(1, Math.min(100, Math.round(100 - (d.elapsed ? (f.drifted / d.elapsed) * 100 : 0)) - [4, 9][i % 2]));
      });
      circle();
      d.drift = d.camera = null;
      d.run = null;
      if (early) goIdle();
      else if (d.session >= SESSIONS_PER_SET) beginBreak(Math.max(LONG_BREAK, Math.floor(d.study / 3)), 'long_rest');
      else beginBreak(d.brk, 'break');
    }
    function beginBreak(minutes, phase) {
      d.phase = phase;
      d.total = d.left = minutes * 60;
      state();
    }
    // A break that runs out waits in ready; a long rest ends the set
    function breakOver() {
      if (d.phase === 'long_rest') { goIdle(); return; }
      d.phase = 'ready';
      d.left = d.total = 0;
      state();
    }
    function goIdle() {
      d.phase = 'idle';
      d.session = 1;
      d.left = d.total = 0;
      state(); // once, on returning to idle
    }

    function tick() {
      if (d.phase === 'idle') return;
      if (d.phase === 'study') {
        for (let i = 0; i < d.rate && d.left > 0; i++) studySecond();
        if (d.left <= 0) { finishStudy(false); return; }
      } else if (d.phase !== 'ready') {
        d.left = Math.max(0, d.left - d.rate);
        if (d.left <= 0) { breakOver(); return; }
      }
      state();
    }

    // A laptop -> device line
    function receive(line) {
      let m;
      try { m = JSON.parse(line); } catch (e) { return; }
      switch (m.t) {
        case 'start': // ignored while a phase runs
          if (d.phase === 'idle') { setLengths(m); beginStudy(1); } else if (d.phase === 'ready') { setLengths(m); beginStudy(d.session + 1); }
          break;
        case 'end':
          if (m.scope === 'session') {
            if (d.phase === 'study') finishStudy(true);
            else if (d.phase === 'ready') goIdle(); // finishes the set
          } else if (m.scope === 'break') {
            if (d.phase === 'break' || d.phase === 'ready') beginStudy(d.session + 1);
            else if (d.phase === 'long_rest') goIdle();
          }
          break;
        case 'drift':
          if (d.phase !== 'study') break;
          d.drift = m.active ? { label: String(m.label || 'Drift').slice(0, 15), kind: m.kind === 'idle' ? 'idle' : 'site', since: d.elapsed } : null;
          break;
        case 'focus': // camera ticks, if a local Pomo app is feeding them
          if (d.phase !== 'study') break;
          if ((m.state === 'drifting' || m.state === 'unfocused') && CAMERA_LABELS[m.reason]) {
            if (!d.camera || d.camera.label !== CAMERA_LABELS[m.reason]) d.camera = { label: CAMERA_LABELS[m.reason], kind: 'camera', since: d.elapsed };
          } else if (m.state === 'focused') d.camera = null;
          break;
        // config, peek, ping and feed change nothing the simulator reports
      }
    }

    const timer = setInterval(tick, 1000);
    // Boot: hello, then the idle state (so the dashboard shows the device's XP and level), then the circle comes into range
    setTimeout(() => { if (stopped) return; out({ t: 'hello', fw: 'simulator' }); state(); }, 300);
    setTimeout(() => { if (!stopped) circle(); }, 1500);

    return {
      writer: {
        write(line) { if (!stopped) setTimeout(() => receive(line), 10); return Promise.resolve(); },
        close() { return Promise.resolve(); }
      },
      // Session seconds per real second, for the dashboard's "ends at" clock
      rate: () => (['study', 'break', 'long_rest'].includes(d.phase) ? d.rate : 1),
      // F: Dev starts or stops drifting (only while studying); returns the friend, or null
      toggleFriend() {
        if (d.phase !== 'study') return null;
        const f = friends[friends.length - 1];
        f.focused = !f.focused;
        circle();
        return { name: f.name, focused: f.focused };
      },
      // E: run the rest of the session at once, as it stands now
      finish() {
        if (d.phase !== 'study') return false;
        while (d.left > 0) studySecond();
        finishStudy(false);
        return true;
      },
      stop() { stopped = true; clearInterval(timer); }
    };
  }

  window.PomoDemo = { wanted, create, isLocal };
})();
