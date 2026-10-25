/* Pomo — laptop dashboard.
   Plain JS, no build step. Serve this folder on localhost and open in Chrome or Edge
   (Web Serial and Idle Detection need a Chromium browser and a secure origin; localhost counts). */
(function () {
  'use strict';

  // ---------- Constants & rules ----------
  const XP_PER_LEVEL = 500;
  const MAX_MULT = 3;
  const PENALTY_BELOW = 50;      // focus % under this costs XP
  const PENALTY_XP = 10;
  const DRIFT_MINUTE_SECS = 15;  // a minute counts as drift if 15+ s of it drifted
  const SESSIONS_PER_SET = 4;
  const LONG_BREAK = 15;
  const STUDY_OPTIONS = [15, 25, 45, 60];
  const DISTRACTING = ['youtube', 'instagram', 'tiktok', 'reddit', 'netflix', 'twitter', 'x.com', 'twitch', 'discord', 'facebook'];
  const SITE_LABELS = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', reddit: 'Reddit', netflix: 'Netflix', twitter: 'Twitter', 'x.com': 'X', twitch: 'Twitch', discord: 'Discord', facebook: 'Facebook' };
  const ROMAN = ['I', 'II', 'III', 'IV'];
  const $ = (id) => document.getElementById(id);

  const store = {
    get(k, d) { try { const v = localStorage.getItem('sb.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('sb.' + k, JSON.stringify(v)); } catch (e) { /* storage blocked: keep in memory */ } }
  };

  // ---------- State ----------
  function demoCircle() { return [{ name: 'Ava', focused: true }, { name: 'Dev', focused: true }]; }
  const S = {
    view: 'setup',
    settings: Object.assign({ user: '', name: 'Mochi', body: 'bot', face: 'plain', color: 'brass', pinTime: false, pinScore: false, study: 25, brk: 5, custom: false, goal: '' }, store.get('settings', {})),
    progress: Object.assign({ level: 3, xp: 340, hearts: 3 }, store.get('progress', {})),
    sessionNo: 1,
    session: null,
    lastCard: null,
    circle: [], // friends from the device's circle message
    fake: demoCircle(), // demo friends, shown only while the demo drawer is open (F toggles one)
    gone: [], // friends who dropped out of range during this set: [{ name }]
    device: { connected: false, port: null, writer: null },
    dev: null, // latest 'state' message from the device (it owns the clock, XP and level while coupled)
    lost: null, // set while the link dropped mid-session: { info }; the session is frozen, not ended
    paused: false, // the device's own 'paused' flag from its latest state
    recon: null, // after a reconnect, the timer that waits for the device's first state
    readyDismissed: false, // the person answered the 'ready' panel; hide it until the device leaves ready
    wasReady: false,
    testTiming: false, // the device's last start said test:true (30 s phases)
    armed: false, // a state has arrived since the (re)connect, so silence can now mean loss
    toastOnResume: false, // announce 'Session resumed' once the device stops reporting paused
    helloSeen: false, // a hello arrived while lost or reconnecting: the next state says whether it restarted
    lastRx: 0, // when the last device line arrived
    peekUntil: 0,
    speed: 1,
    idleDetector: null,
    lovedUntil: 0, // petted: the love face until then (ms)
    care: null, // Milestone E gears and hunger: null until the device reports them (today's firmware never does)
    feedWait: 0, // a feed request is waiting for the device's pet reply (the 2 s timer)
    feedUnsupported: false, // this connection's firmware didn't answer feed: feed on the device instead
    shhUntil: 0, // tapped during focus: the shh face until then
    play: { wound: 0, key: 0, shown: null, lastPlay: 0, lastRunDown: 0, dancing: false, danceAt: 0, gear: null, asleep: false, loveUntil: 0, line: '' }
  };
  const breakRange = (study) => [Math.ceil(study / 5), Math.floor(study / 3)];
  const STUDY_MIN = 15, STUDY_MAX = 90, STUDY_STEP = 5; // the device accepts 15-90 in steps of 5
  const longRest = (study) => Math.max(LONG_BREAK, Math.floor(study / 3));
  const two = (n) => String(n).padStart(2, '0');
  const mmss = (sec) => two(Math.floor(sec / 60)) + ':' + two(Math.floor(sec % 60));
  const clock = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const save = () => { store.set('settings', S.settings); store.set('progress', S.progress); };
  const petName = () => (S.settings.name || '').trim() || 'Mochi';

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- Views ----------
  function show(view) {
    S.view = view;
    for (const v of ['home', 'play', 'setup', 'live', 'card']) $('view-' + v).hidden = v !== view;
    $('brandBtn').setAttribute('aria-disabled', String(!!S.session)); // Home only between sessions
    document.querySelector('.steps').hidden = view === 'home' || view === 'play'; // neither is a step
    if (view !== 'card') S.viewCard = null;
    // Progress markers, not links: earlier steps read as done, the current one is lit.
    const here = ['setup', 'live', 'card'].indexOf(view);
    document.querySelectorAll('.steps li').forEach((el, i) => {
      el.dataset.state = i < here ? 'done' : i === here ? 'current' : 'todo';
      if (i === here) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
      el.querySelector('.sr').hidden = i >= here;
    });
    window.scrollTo(0, 0);
  }

  // ---------- Setup view ----------
  function chip(label, pressed, onClick, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', onClick);
    return b;
  }

  // Numbers go in the chips' monospace face: the display font has old-style figures ('40' reads as '4o').
  function withNums(parts) {
    return parts.map((p) => {
      if (typeof p === 'string') return document.createTextNode(p);
      const s = document.createElement('span');
      s.className = 'num';
      s.textContent = String(p.n);
      return s;
    });
  }

  function renderSetup() {
    const st = S.settings;
    if (!STUDY_OPTIONS.includes(st.study)) st.custom = true;
    if (st.custom) st.study = Math.min(STUDY_MAX, Math.max(STUDY_MIN, Math.round(st.study / STUDY_STEP) * STUDY_STEP));
    const [bMin, bMax] = breakRange(st.study);
    if (st.custom) st.brk = Math.min(bMax, Math.max(bMin, st.brk)); // a new study length re-clamps the break
    else if (st.brk < bMin || st.brk > bMax) st.brk = bMin;

    const studyChips = STUDY_OPTIONS.map((m) => chip(m + ' min', !st.custom && st.study === m, () => { st.custom = false; st.study = m; st.brk = Math.ceil(m / 5); save(); renderSetup(); }));
    studyChips.push(chip('Custom', st.custom, () => { st.custom = true; save(); renderSetup(); $('studyDial').focus(); }));
    $('studyChips').replaceChildren(...studyChips);
    $('customStudy').hidden = !st.custom;
    $('studyBreak').classList.toggle('custom', st.custom);
    updateDial();
    if (st.custom) {
      const step = (label, aria, delta) => {
        const b = chip(label, false, () => { st.brk = Math.min(bMax, Math.max(bMin, st.brk + delta)); save(); renderSetup(); }, 'verd-chip');
        b.removeAttribute('aria-pressed');
        b.setAttribute('aria-label', aria);
        b.disabled = delta < 0 ? st.brk <= bMin : st.brk >= bMax;
        return b;
      };
      const val = document.createElement('span');
      val.className = 'step-val mono';
      val.textContent = st.brk + ' min';
      $('breakChips').replaceChildren(step('\u2212', 'Shorter break', -1), val, step('+', 'Longer break', 1));
    } else {
      const breaks = [];
      for (let b = bMin; b <= bMax; b++) breaks.push(chip(b + 'm', st.brk === b, () => { st.brk = b; save(); renderSetup(); }, 'verd-chip'));
      $('breakChips').replaceChildren(...breaks);
    }
    $('longRest').textContent = 'Long rest after four sessions: ' + longRest(st.study) + ' min.';
    $('breakRule').textContent = 'Between a fifth and a third of study time: ' + bMin + '–' + bMax + ' min for ' + st.study + ' min.' + (st.study === 25 && st.brk === 5 ? ' Classic Pomodoro.' : '');
    $('beginBtn').replaceChildren(...withNums(['Begin · ', { n: st.study }, ' min']));
    const mult = multiplier();
    $('circleHint').replaceChildren(...withNums(['then ' + ([8, 11, 18].includes(st.brk) ? 'an ' : 'a '), { n: st.brk }, ' min break · Session ' + ROMAN[S.sessionNo - 1] + ' of IV'].concat(circleShown().length ? [' · Study circle: ' + circleShown().map((f) => f.name).join(' and ') + ', ', { n: mult }, '× XP'] : [])));

    $('bodyChips').replaceChildren(...[['bot', 'Clockwork bot'], ['cat', 'Cat'], ['dog', 'Dog']].map(([k, l]) => chip(l, st.body === k, () => { st.body = k; petChanged(); }, 'word')));
    $('faceChips').replaceChildren(...[['plain', 'Plain'], ['monocle', 'Monocle']].map(([k, l]) => chip(l, st.face === k, () => { st.face = k; petChanged(); }, 'word')));
    $('colorChips').replaceChildren(...Object.keys(StudyPet.PALETTES).map((k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = StudyPet.PALETTES[k].body;
      b.setAttribute('aria-label', k);
      b.setAttribute('aria-pressed', String(st.color === k));
      b.addEventListener('click', () => { st.color = k; petChanged(); });
      return b;
    }));
    $('finishLabel').textContent = 'Finish · ' + st.color.charAt(0).toUpperCase() + st.color.slice(1);
    $('petTitle').textContent = petName() + ' · Lv ' + S.progress.level;
    drawPets();
  }

  // ---------- Study dial (custom length) ----------
  // A 270-degree sweep from bottom-left (15 min) to bottom-right (90 min); ticks every 5 min.
  const DIAL_START = -135, DIAL_SWEEP = 270;
  const dialDeg = (v) => DIAL_START + ((v - STUDY_MIN) / (STUDY_MAX - STUDY_MIN)) * DIAL_SWEEP;
  const dialPt = (r, deg) => { const a = (deg * Math.PI) / 180; return [(80 + r * Math.sin(a)).toFixed(1), (80 - r * Math.cos(a)).toFixed(1)]; };
  function buildDial() {
    let g = '';
    for (let v = STUDY_MIN; v <= STUDY_MAX; v += STUDY_STEP) {
      const major = v % 15 === 0, d = dialDeg(v);
      const [x1, y1] = dialPt(major ? 51 : 55, d), [x2, y2] = dialPt(62, d);
      g += '<line class="tick" data-v="' + v + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>';
      if (major) { const [lx, ly] = dialPt(71, d); g += '<text class="lbl" x="' + lx + '" y="' + ly + '" text-anchor="middle" dominant-baseline="central">' + v + '</text>'; }
    }
    $('studyDial').innerHTML = '<svg viewBox="0 0 160 160" aria-hidden="true">' + g +
      '<circle class="knob" cx="80" cy="80" r="44"/>' +
      '<line class="notch" id="dialNotch" x1="80" y1="46" x2="80" y2="38"/>' +
      '<text class="val" id="dialVal" x="80" y="74" text-anchor="middle" dominant-baseline="central"></text>' +
      '<text class="unit" x="80" y="97" text-anchor="middle" dominant-baseline="central">min</text></svg>';
  }
  function updateDial() {
    const st = S.settings, dial = $('studyDial');
    const [x1, y1] = dialPt(33, dialDeg(st.study)), [x2, y2] = dialPt(42, dialDeg(st.study));
    const n = $('dialNotch');
    n.setAttribute('x1', x1); n.setAttribute('y1', y1); n.setAttribute('x2', x2); n.setAttribute('y2', y2);
    $('dialVal').textContent = String(st.study);
    dial.querySelectorAll('.tick').forEach((t) => t.classList.toggle('on', Number(t.dataset.v) <= st.study));
    dial.setAttribute('aria-valuenow', String(st.study));
    dial.setAttribute('aria-valuetext', st.study + ' minutes');
  }
  function setStudy(v) {
    v = Math.min(STUDY_MAX, Math.max(STUDY_MIN, Math.round(v / STUDY_STEP) * STUDY_STEP));
    if (v === S.settings.study) return;
    S.settings.study = v;
    save();
    renderSetup(); // re-clamps the break and updates the labels
  }
  function wireDial() {
    const dial = $('studyDial');
    buildDial();
    let last = null; // previous pointer angle, to stop a drag wrapping across the gap at the bottom
    const fromPointer = (e) => {
      const r = dial.getBoundingClientRect();
      let a = (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
      if (last !== null && Math.abs(a - last) > 180) a = last < 0 ? DIAL_START : -DIAL_START;
      last = a;
      a = Math.min(-DIAL_START, Math.max(DIAL_START, a));
      setStudy(STUDY_MIN + ((a - DIAL_START) / DIAL_SWEEP) * (STUDY_MAX - STUDY_MIN));
    };
    dial.addEventListener('pointerdown', (e) => { last = null; dial.setPointerCapture(e.pointerId); dial.focus(); fromPointer(e); e.preventDefault(); });
    dial.addEventListener('pointermove', (e) => { if (dial.hasPointerCapture(e.pointerId)) fromPointer(e); });
    dial.addEventListener('pointerup', () => { last = null; });
    dial.addEventListener('wheel', (e) => { e.preventDefault(); setStudy(S.settings.study + (e.deltaY < 0 ? STUDY_STEP : -STUDY_STEP)); }, { passive: false });
    dial.addEventListener('keydown', (e) => {
      const st = S.settings.study;
      const to = { ArrowUp: st + STUDY_STEP, ArrowRight: st + STUDY_STEP, ArrowDown: st - STUDY_STEP, ArrowLeft: st - STUDY_STEP,
        PageUp: st + 15, PageDown: st - 15, Home: STUDY_MIN, End: STUDY_MAX }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      setStudy(to);
    });
  }

  function petChanged() {
    save();
    $('sentNote').textContent = S.device.connected ? 'Changes show on the device after you send them.' : '';
    renderSetup();
  }

  function petOpts(mood) {
    return { body: S.settings.body, face: S.settings.face, color: S.settings.color, level: S.progress.level, mood };
  }
  function drawPets() {
    const card = S.viewCard || S.lastCard;
    if (card) {
      StudyPet.drawPet($('petCard'), petOpts(petted() ? 'love' : card.mood));
    }
    StudyPet.drawPet($('petSetup'), petOpts(currentMood()));
    StudyPet.drawPet($('petLive'), petOpts(currentMood()));
    StudyPet.drawPet($('petHome'), petOpts(currentMood()));
    if (S.view === 'play') renderPlay();
  }

  // ---------- Nixie tubes ----------
  const TUBE_SVG = '<svg viewBox="0 0 120 230" width="120" height="230" aria-hidden="true">' +
    '<path d="M57 4 L63 4 L63 13 Q102 17 105 46 L105 202 L15 202 L15 46 Q18 17 57 13 Z" fill="url(#nxGlass)" stroke="#A89A88" stroke-opacity="0.55" stroke-width="1.5"/>' +
    '<rect class="haze" x="26" y="44" width="68" height="146" fill="url(#nxHaze)"/>' +
    '<rect x="26" y="44" width="68" height="146" fill="url(#nxHex)" stroke="#8A5A34"/>' +
    '<line x1="30" y1="36" x2="30" y2="196" stroke="#7A6A58" stroke-width="1.4"/><line x1="90" y1="36" x2="90" y2="196" stroke="#7A6A58" stroke-width="1.4"/>' +
    '<ellipse cx="60" cy="40" rx="36" ry="3.5" fill="none" stroke="#9C8E7C" stroke-opacity="0.7"/><ellipse cx="60" cy="194" rx="36" ry="3.5" fill="none" stroke="#9C8E7C" stroke-opacity="0.7"/>' +
    '<path d="M22 54 Q20 124 22 194" fill="none" stroke="#fff" stroke-opacity="0.22" stroke-width="3" stroke-linecap="round"/>' +
    '<rect x="12" y="202" width="96" height="24" rx="3" fill="#15100C" stroke="#4A3522" stroke-width="1.5"/><line x1="20" y1="214" x2="100" y2="214" stroke="#2B1E16" stroke-width="2"/></svg>';
  const COLON_SVG = '<svg viewBox="0 0 32 230" width="32" height="230" aria-hidden="true">' +
    '<rect x="6" y="96" width="20" height="74" rx="10" fill="#fff" fill-opacity="0.05" stroke="#A89A88" stroke-opacity="0.55" stroke-width="1.2"/>' +
    '<circle cx="16" cy="118" r="4" fill="#FFD9A0" filter="url(#nxDot)"/><circle cx="16" cy="146" r="4" fill="#FFD9A0" filter="url(#nxDot)"/>' +
    '<rect x="8" y="170" width="16" height="10" fill="#15100C" stroke="#4A3522"/></svg>';

  // Four tubes with a colon in the middle, in `box`; returns the tubes
  function buildTubes(box) {
    const list = [];
    box.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const el = document.createElement('div');
      if (i === 2) { el.className = 'colon'; el.innerHTML = COLON_SVG; box.appendChild(el); continue; }
      el.className = 'tube';
      el.innerHTML = TUBE_SVG + '<span class="glyph ghost"></span><span class="glyph ghost b"></span><span class="glyph lit"></span>';
      box.appendChild(el);
      list.push(el);
    }
    return list;
  }
  // One tube shows `ch` ('' leaves it unlit), with the neighbouring cathodes faint behind it
  function setTube(el, ch) {
    const d = Number(ch || 0);
    const [ga, gb, l] = el.querySelectorAll('.glyph');
    ga.textContent = String((d + 3) % 10);
    gb.textContent = String((d + 6) % 10);
    if (l.textContent !== ch) l.textContent = ch;
  }
  let tubes = [];
  function buildNixie() { tubes = buildTubes($('nixie')); }
  function setNixie(sec, lit) {
    const t = mmss(Math.max(0, sec)).replace(':', '');
    tubes.forEach((el, i) => setTube(el, t[i]));
    $('nixie').classList.toggle('dark', !lit);
    $('nixie').setAttribute('aria-label', lit ? Math.floor(sec / 60) + ' minutes ' + Math.floor(sec % 60) + ' seconds left' : 'Timer hidden');
  }

  // ---------- Gauge ----------
  function gaugeSvg(pct, sealed) {
    let ticks = '';
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI - (i * Math.PI) / 10;
      const r2 = i % 5 === 0 ? 62 : 70;
      ticks += 'M' + (100 + 78 * Math.cos(a)).toFixed(1) + ' ' + (110 - 78 * Math.sin(a)).toFixed(1) + ' L' + (100 + r2 * Math.cos(a)).toFixed(1) + ' ' + (110 - r2 * Math.sin(a)).toFixed(1) + ' ';
    }
    const na = Math.PI - (pct / 100) * Math.PI;
    const tc = sealed ? '#6B5233' : '#C9A15A';
    return '<svg viewBox="0 0 200 130" width="100%" style="max-width:280px" role="img" aria-label="' + (sealed ? 'Focus gauge sealed until the session ends' : 'Focus gauge reading ' + pct + ' percent') + '">' +
      '<path d="M20 110 A80 80 0 0 1 180 110" fill="none" stroke="#6B5233" stroke-width="10"/>' +
      (sealed ? '' : '<path d="M20 110 A80 80 0 0 1 43.4 53.4" fill="none" stroke="#B5462A" stroke-width="10"/>') +
      '<path d="' + ticks + '" stroke="' + tc + '" stroke-width="2"/>' +
      (sealed ? '' : '<line x1="100" y1="110" x2="' + (100 + 64 * Math.cos(na)).toFixed(1) + '" y2="' + (110 - 64 * Math.sin(na)).toFixed(1) + '" stroke="#FFC08A" stroke-width="3" stroke-linecap="round"/>') +
      '<circle cx="100" cy="110" r="7" fill="' + tc + '"/>' +
      '<text x="100" y="92" text-anchor="middle" font-family="' + (sealed ? 'IM Fell English SC, serif' : 'IBM Plex Mono, monospace') + '" font-size="22" fill="' + (sealed ? '#B8A27C' : '#EFE3C8') + '">' + (sealed ? 'Sealed' : pct + '%') + '</text></svg>';
  }

  // ---------- Session engine ----------
  // The demo drawer (D) swaps in fake friends, so linked play can be shown without a second device
  const demoOn = () => !$('demo').hidden;
  const circleShown = () => (demoOn() ? S.fake : S.circle);
  function multiplier() {
    if (demoOn()) {
      const f = S.fake;
      if (!f.length || f.some((x) => !x.focused)) return 1; // bonus pauses while anyone drifts
      return Math.max(1, Math.min(MAX_MULT, f.length));
    }
    if (S.device.connected && S.dev) return S.dev.mult;
    return 1;
  }
  // Only the device knows who is in its study group; mult says whether the bonus is running
  function circleNote(mult, list, gone, s) {
    if (!list.length && !gone.length) return 'No friends nearby. Other Pomos in range show up here.';
    if (mult > 1) return 'The bonus holds while everyone stays focused.';
    const drifting = (s && s.drift) || list.some((f) => !f.focused) || (!demoOn() && S.dev && S.dev.focus === 'drift');
    if (drifting) return 'Paused: someone in the circle is drifting.';
    if (gone.length) return 'Out of range. The bonus waits until they are back.';
    return 'No bonus yet. Invite a friend from the Circle screen on the device to study together.';
  }

  function startSession() {
    const st = S.settings;
    st.goal = $('goal').value.trim();
    save();
    beginFocus(st.study, st.brk, st.goal);
    send({ t: 'start', study: st.study, brk: st.brk });
  }

  function newFocusSession(study, brk, goal) {
    const total = study * 60;
    return {
      mode: 'focus', goal: goal || 'Untitled session', study, brk,
      startedAt: new Date(), total, left: total, focusedSec: 0, xpSec: 0, acc: 0,
      drift: null, events: [], secs: new Array(total).fill(null), log: []
    };
  }
  function beginFocus(study, brk, goal) {
    S.session = newFocusSession(study, brk, goal);
    S.lastRx = Date.now(); // the silence watchdog counts from the start of a device session
    addLog(0, 'Session ' + ROMAN[S.sessionNo - 1] + ' begun' + (goal ? ': ' + goal : '') + '.');
    requestIdle();
    setCamera(true);
    show('live');
    renderLive();
  }

  function startBreak(minutes, long) {
    // The device drives the break only while its latest state says it is on one; otherwise count down here.
    if (!(deviceBreak() && S.session && S.session.mode === 'break' && !S.session.local)) {
      S.session = { mode: 'break', total: minutes * 60, left: minutes * 60, long: !!long, local: !deviceBreak() };
    }
    show('live');
    renderLive();
  }

  function deviceBreak() {
    return !!(S.device.connected && S.dev && (S.dev.phase === 'break' || S.dev.phase === 'long_rest'));
  }

  function elapsed() { return S.session ? S.session.total - S.session.left : 0; }

  function startDrift(kind, label) {
    const s = S.session;
    if (!s || s.mode !== 'focus') return;
    if (s.drift && s.drift.kind === kind && s.drift.label === label) return;
    if (s.drift) endDrift();
    s.drift = { kind, label, since: elapsed() };
    if (kind !== 'camera') send({ t: 'drift', active: true, label: String(label).slice(0, 15), kind }); // the device derives camera drifts from the focus ticks
    renderLive();
  }
  function endDrift() {
    const s = S.session;
    if (!s || !s.drift) return;
    const d = s.drift;
    const len = elapsed() - d.since;
    s.drift = null;
    if (len >= 3) {
      s.events.push({ kind: d.kind, label: d.label, at: d.since, len });
      addLog(d.since, (d.kind === 'idle' ? 'Went idle, no keyboard or mouse.' : d.kind === 'camera' ? 'The camera saw you: ' + d.label.toLowerCase() + '.' : 'Wandered to ' + d.label + '.') + ' Back after ' + mmss(len).replace(/^0/, '') + '.');
    }
    if (d.kind !== 'camera') send({ t: 'drift', active: false });
    renderLive();
  }

  function addLog(at, text) {
    if (!S.session || !S.session.log) return;
    S.session.log.unshift({ at, text });
    S.session.log = S.session.log.slice(0, 6);
  }

  function tick() {
    const s = S.session;
    if (!s) return;
    if (S.lost) { if (S.view === 'live') renderLive(); return; } // frozen until the device is back
    if (S.device.connected && (s.mode === 'focus' || !s.local)) { if (S.view === 'live') renderLive(); return; } // the device owns the countdown
    for (let i = 0; i < S.speed && s.left > 0; i++) {
      if (s.mode === 'focus') {
        const idx = s.total - s.left;
        s.secs[idx] = s.drift ? s.drift.kind : 'focus';
        if (!s.drift) { s.focusedSec++; s.xpSec += multiplier(); }
      }
      s.left--;
    }
    if (s.left <= 0) {
      if (s.mode === 'focus') endSession(false);
      else { S.session = null; chime(); toast('Intermission over. Ready for the next session?'); show('setup'); renderSetup(); }
      return;
    }
    if (S.view === 'live') renderLive();
  }

  // m is the device's 'end' message when one is coupled; the device then supplies the numbers.
  function endSession(early, m) {
    const s = S.session;
    if (!s || s.mode !== 'focus') return;
    if (S.device.connected && !m) { requestDeviceEnd(); return; }
    setCamera(false); // camera only runs during focus sessions
    S.speed = 1; // the demo's ×30 never carries into the next session
    if (m) s.drift = null; // the session is already over on the device; nothing more to tell it
    if (s.drift) endDrift();
    chime();
    const before = Object.assign({}, S.progress);
    let done, pct, focusedMin, focusedSec, earned, penalty, leveled;
    const mult = s.focusedSec ? Math.max(1, Math.round(s.xpSec / s.focusedSec)) : 1;
    if (m) {
      done = m.elapsed_min * 60; pct = m.pct; focusedMin = m.focused_min; focusedSec = m.focused_min * 60;
      penalty = m.penalty ? Math.max(0, -m.xp) : 0;
      earned = m.penalty ? 0 : Math.max(0, m.xp);
      applyDeviceProgress(m.total_xp, m.level);
      leveled = S.progress.level > before.level;
    } else {
      done = elapsed();
      pct = done ? Math.round((s.focusedSec / done) * 100) : 0;
      focusedMin = Math.floor(s.focusedSec / 60); focusedSec = s.focusedSec;
      earned = Math.floor(s.xpSec / 60);
      penalty = 0;
      if (pct < PENALTY_BELOW) { penalty = Math.min(PENALTY_XP, S.progress.xp); earned = 0; }
      S.progress.xp = Math.max(0, S.progress.xp + earned - penalty);
      leveled = false;
      while (S.progress.xp >= XP_PER_LEVEL) { S.progress.xp -= XP_PER_LEVEL; S.progress.level++; leveled = true; }
    }
    // Hearts are a dashboard-only flourish; the schema doesn't carry them.
    const heartDelta = pct >= 80 ? 2 : pct >= 60 ? 1 : pct < PENALTY_BELOW ? -1 : 0;
    S.progress.hearts = Math.max(0, Math.min(5, S.progress.hearts + heartDelta));
    save();

    S.lastCard = {
      no: S.sessionNo, goal: s.goal, startedAt: s.startedAt, endedAt: new Date(), early: m ? m.early : early,
      total: s.total, done, focusedSec, pct, focusedMin, mult, earned, penalty,
      study: s.study, heartDelta, leveled, before, test: !!(m && S.testTiming), events: s.events.slice(), minutes: minuteKinds(s, true), brk: s.brk, finished: null
    };
    S.session = null;
    S.sessionNo = S.sessionNo % SESSIONS_PER_SET + 1;
    renderCard();
    archiveCard(S.lastCard);
    show('card');
  }

  function minuteKinds(s, onlyDone) {
    const mins = Math.ceil(s.total / 60);
    const out = [];
    for (let m = 0; m < mins; m++) {
      const slice = s.secs.slice(m * 60, m * 60 + 60);
      if (slice.every((v) => v === null)) { out.push(onlyDone ? 'empty' : 'future'); continue; }
      const site = slice.filter((v) => v === 'site' || v === 'camera').length;
      const idle = slice.filter((v) => v === 'idle').length;
      if (site + idle >= DRIFT_MINUTE_SECS) out.push(idle > site ? 'idle' : 'site');
      else out.push('focus');
    }
    return out;
  }

  function currentMood() {
    const s = S.session;
    if (linkDown()) return 'sad';
    if (petted() && (!s || s.mode === 'break')) return 'love';
    if (!s) return careMood() || 'happy';
    if (s.mode === 'break') return 'happy';
    if (hushed()) return 'shh';
    return s.drift ? 'annoyed' : 'focus';
  }
  // ---------- Live view ----------
  function renderLive() {
    const s = S.session;
    if (!s) return;
    const now = Date.now();
    const peeking = now < S.peekUntil;
    const showTime = s.mode === 'break' || S.settings.pinTime || peeking;
    const showScore = S.settings.pinScore || peeking;
    const brk = s.mode === 'break';
    const done = elapsed();
    const pct = s.mode === 'focus' && done ? Math.round((s.focusedSec / done) * 100) : 100;

    $('testTag').hidden = !((S.device.connected && S.testTiming) || S.speed !== 1); // also flags the demo ×30 speed
    $('nixie').classList.toggle('break', brk);
    setNixie(s.left, showTime);
    $('timeLabel').textContent = brk ? (s.long ? 'Long rest' : 'Intermission') + ' · time remaining' :
      (showTime ? 'Time remaining' : 'Tubes dark') + ' · Session ' + ROMAN[S.sessionNo - 1] + ' of IV';
    $('timeDetail').hidden = !showTime;
    $('darkNote').hidden = showTime;
    $('railFill').style.width = ((done / s.total) * 100).toFixed(1) + '%';
    $('elapsedTxt').textContent = mmss(done) + ' elapsed of ' + mmss(s.total);
    $('endsTxt').textContent = 'ends ' + clock(new Date(Date.now() + (s.left * 1000) / (S.device.connected ? 1 : S.speed)));

    if (brk) {
      $('statusLine').textContent = 'Stretch, get water, step away. ' + petName() + ' will chime when it\'s time.';
    } else if (s.drift) {
      $('statusLine').textContent = s.drift.kind === 'idle' ? 'Gone idle for ' + mmss(done - s.drift.since) + '. ' + petName() + ' is waiting.' : s.drift.label + ' for ' + mmss(done - s.drift.since) + '. Kindly return to your studies.';
    } else {
      const lastEnd = s.events.length ? s.events[s.events.length - 1].at + s.events[s.events.length - 1].len : 0;
      const streak = Math.floor((done - lastEnd) / 60);
      $('statusLine').textContent = 'Focused for ' + streak + ' min' + (s.goal && s.goal !== 'Untitled session' ? ' on ' + s.goal + '.' : '.');
    }
    $('peekBtn').hidden = brk;
    $('peekBtn').textContent = peeking ? 'Peeking…' : 'Peek for 5 s';
    $('pinTimeBtn').hidden = brk;
    $('pinTimeBtn').textContent = S.settings.pinTime ? 'Hide timer again' : 'Always show timer';
    $('pinTimeBtn').setAttribute('aria-pressed', String(S.settings.pinTime));
    $('endBtn').textContent = brk ? 'End break' : 'End early';

    StudyPet.drawPet($('petLive'), petOpts(currentMood()));
    $('petMood').textContent = brk ? petName() + ' is winding down.' : s.drift ? petName() + ' is not amused.' : petName() + ' is locked in.';

    const gaugeWrap = $('gauge').parentElement;
    gaugeWrap.hidden = brk;
    $('gauge').innerHTML = gaugeSvg(pct, !showScore);
    $('gaugeNote').hidden = showScore;
    $('pinScoreBtn').textContent = S.settings.pinScore ? 'Seal it again' : 'Always show score';
    $('pinScoreBtn').setAttribute('aria-pressed', String(S.settings.pinScore));

    const logEl = $('log');
    logEl.parentElement.hidden = brk;
    if (!brk) {
      const items = [{ at: done, text: s.drift ? 'Drifting right now.' : 'Still steady.' }].concat(s.log);
      logEl.replaceChildren(...items.slice(0, 5).map((l) => {
        const li = document.createElement('li');
        const t = document.createElement('time');
        t.textContent = mmss(l.at);
        const sp = document.createElement('span');
        sp.textContent = l.text;
        li.append(t, sp);
        return li;
      }));
    }

    $('circlePanel').hidden = brk;
    const mult = multiplier();
    $('multiplier').textContent = mult + '× XP';
    const list = circleShown(), gone = demoOn() ? [] : S.gone;
    $('circleNote').textContent = circleNote(mult, list, gone, s);
    const friendRow = (lamp, name, status, cls) => {
      const li = document.createElement('li');
      if (cls) li.className = cls;
      li.innerHTML = '<span class="lamp' + (lamp ? ' ' + lamp : '') + '"></span><span class="who"></span><span></span>';
      li.children[1].textContent = name;
      li.children[2].textContent = status;
      return li;
    };
    // A friend's pct is 0 while they study, so a pct means they aren't studying right now
    $('friends').replaceChildren(...list.map((f) => friendRow(f.focused ? 'on' : 'off', f.name,
      !demoOn() && f.pct > 0 ? 'Not studying · last ' + f.pct + '%' : f.focused ? 'Focused' : 'Drifting')),
      ...gone.map((g) => friendRow('', g.name, 'Out of range', 'gone')));
    const coupled = S.device.connected && S.dev;
    const xpNow = coupled ? S.progress.xp : S.progress.xp + Math.floor(s.xpSec ? s.xpSec / 60 : 0);
    $('xpLevel').textContent = petName() + ' · Level ' + S.progress.level;
    $('xpText').textContent = Math.min(xpNow, XP_PER_LEVEL) + ' / ' + XP_PER_LEVEL + ' XP';
    $('xpFill').style.width = Math.min(100, (xpNow / XP_PER_LEVEL) * 100).toFixed(1) + '%';
    const gained = coupled ? (typeof S.dev.earned === 'number' ? S.dev.earned : Math.max(0, S.dev.xp - (s.xp0 != null ? s.xp0 : S.dev.xp))) : Math.floor((s.xpSec || 0) / 60);
    $('xpSoFar').textContent = s.mode === 'focus' ? '+' + gained + ' XP so far (' + Math.floor(s.focusedSec / 60) + ' focused min × ' + mult + ')' : '';

    $('ledgerPanel').hidden = brk || !showTime;
    if (!brk && showTime) renderLedger(s);
    renderLinkOverlay();
  }

  function renderLedger(s) {
    const kinds = minuteKinds(s, false);
    const led = $('ledger');
    led.style.gridTemplateColumns = 'repeat(' + kinds.length + ', minmax(14px, 1fr))';
    led.classList.add('ledger-wrap');
    const tags = {};
    for (const e of s.events) { const m = Math.floor(e.at / 60); if (!tags[m]) tags[m] = (e.kind === 'idle' ? 'Idle ' : e.label + ' ') + mmss(e.len).replace(/^0/, ''); }
    led.replaceChildren(...kinds.map((k, i) => {
      const c = document.createElement('div');
      c.className = 'cell ' + k;
      if (tags[i]) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = tags[i]; c.appendChild(t); }
      return c;
    }));
  }

  // ---------- Time card ----------
  function renderCard() {
    const c = S.viewCard || S.lastCard;
    if (!c) return;
    S.cardShown = c;
    const rows = [];
    for (let r = 0; r < Math.ceil(c.minutes.length / 5); r++) {
      rows.push('<span class="m">' + r * 5 + 'm</span>');
      for (let k = 0; k < 5; k++) {
        const kind = c.minutes[r * 5 + k];
        rows.push(kind ? '<span class="punch ' + (kind === 'focus' ? '' : kind) + '"></span>' : '<span></span>');
      }
    }
    const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
    const evLines = c.events.map((e) => '<div class="line"><span>' + mmss(e.at) + ' ' + esc(e.kind === 'idle' ? 'IDLE' : e.label.toUpperCase()) + '</span><span>' + mmss(e.len).replace(/^0/, '') + '</span></div>').join('');
    const xpLine = c.penalty ? '<div class="line"><span>UNDER ' + PENALTY_BELOW + '% · PENALTY</span><b>−' + c.penalty + '</b></div>' :
      '<div class="line"><span>XP ' + c.focusedMin + ' MIN × ' + c.mult + (c.mult > 1 ? ' CIRCLE' : '') + '</span><b>' + c.earned + '</b></div>';
    $('timecard').innerHTML =
      '<div class="line"><h2>Time Card</h2><span>No. ' + String(c.no + 1000).slice(1) + '</span></div>' + (c.test ? '<div class="line"><span class="test-tag">Test timing</span></div>' : '') +
      '<div class="line rule solid" style="border-bottom:2px solid var(--ink);padding:8px 0"><span>IN&nbsp; ' + clock(c.startedAt) + '</span><span>OUT ' + clock(c.endedAt) + '</span><span>' + c.startedAt.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' }).toUpperCase() + '</span></div>' +
      '<div class="line"><span>TASK</span><span style="text-align:right">' + esc(c.goal.toUpperCase()) + '</span></div>' +
      '<div><b>MINUTES PUNCHED</b><div class="punches" style="margin-top:6px">' + rows.join('') + '</div>' +
      '<div class="key" style="margin-top:8px"><span><i style="background:var(--panel)"></i>focused</span><span><i style="border:3px solid var(--copper)"></i>screen</span><span><i style="background:var(--copper)"></i>idle</span></div></div>' +
      '<div class="rule"></div>' +
      '<div class="line"><span>FOCUSED</span><span>' + mmss(c.focusedSec) + '</span></div>' + (evLines || '<div class="line"><span>NO LAPSES</span><span>—</span></div>') +
      '<div class="rule"></div>' + xpLine +
      '<div class="line"><span>HEARTS TO ' + esc(petName().toUpperCase()) + '</span><b>' + (c.heartDelta > 0 ? '+' : '') + c.heartDelta + '</b></div>' +
      '<div class="stamp"><b>' + c.pct + '%</b><span>Focused</span></div>' +
      '<div class="tear"></div><div class="stub"><span>STUB · KEEP FOR YOUR RECORDS</span><span>' + ROMAN[c.no - 1] + ' / IV</span></div>';
    const card = $('timecard');
    card.classList.remove('print'); void card.offsetWidth; card.classList.add('print');

    const { worst, tooShort } = renderCardLine(c);

      c.mood = c.pct >= 60 ? 'love' : c.pct >= PENALTY_BELOW ? 'happy' : 'annoyed';
      StudyPet.drawPet($('petCard'), petOpts(c.mood));
      if (c.leveled && !c.levelShown) { c.levelShown = true; levelUpMoment(c); } // once, not on every redraw
      $('petVerdict').textContent = c.leveled ? petName() + ' reached Level ' + S.progress.level + '!' + (S.progress.level === 5 ? ' Goggles unlocked.' : S.progress.level === 10 ? ' Bow tie unlocked.' : S.progress.level === 15 ? ' Top hat unlocked.' : '') :
      tooShort ? petName() + ' barely got started.' : c.pct >= 80 ? petName() + ' is most proud.' : c.pct >= PENALTY_BELOW ? petName() + ' is content.' : petName() + ' is disappointed, but you keep your level.';
    $('cardLevel').textContent = 'Lv ' + S.progress.level;
    $('cardXp').textContent = S.progress.xp + ' / ' + XP_PER_LEVEL + ' XP';
    $('cardXpFill').style.width = ((S.progress.xp / XP_PER_LEVEL) * 100).toFixed(1) + '%';
    $('cardToNext').textContent = (XP_PER_LEVEL - S.progress.xp) + ' XP to Level ' + (S.progress.level + 1);

    renderBoard();

    $('cardGoal').textContent = c.goal;
    renderFinish();
    $('coachNote').textContent = coach(c, worst);

    // No break after End early (matches the firmware), with or without a device.
    const noBreak = c.early;
    $('startBreakBtn').hidden = noBreak;
    $('skipBreakBtn').textContent = noBreak ? 'Begin next session' : 'Skip to next session';
    $('nextTitle').closest('.panel').hidden = !!S.viewCard; // an earlier card from the shelf is only for looking at
    const long = c.no === SESSIONS_PER_SET;
    if (noBreak) {
      $('nextTitle').textContent = 'Session ' + ROMAN[S.sessionNo - 1] + ' of IV';
      $('nextSub').textContent = 'You ended early, so there is no intermission.';
      return;
    }
    $('nextTitle').textContent = long ? 'Long rest · ' + longRest(c.study || S.settings.study) + ' minutes' : 'Intermission · ' + c.brk + ' minutes';
    $('nextSub').textContent = long ? 'You finished a full set of four. Step away properly.' : 'Then session ' + ROMAN[S.sessionNo - 1] + ' of IV.' + (S.sessionNo === SESSIONS_PER_SET ? ' After that, a long rest.' : '');
  }

  // The verdict and score line of a time card
  function renderCardLine(c) {
    const words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
    const tooShort = c.early && c.done < 60; // ended before a full minute: a % would read as a bug
    $('verdict').textContent = tooShort ? 'Ended early.' : c.pct + '% focused.';
    const worst = c.events.slice().sort((a, b) => b.len - a.len)[0];
    const lapses = c.events.length;
    // The gears from the device's earned message, as Intermission says them (Firmware-Pomo docs/PET_PLAY_AND_CARE.md, "What the pet says")
    const gears = c.gears == null ? '' : ', ' + (c.gears === 0 ? 'gears full' : '+' + c.gears + (c.gears === 1 ? ' gear' : ' gears'));
    $('verdictSub').textContent = Math.round(c.done / 60) + ' minutes, ' + (lapses ? (words[lapses] || lapses).toLowerCase() + ' lapse' + (lapses > 1 ? 's' : '') : 'no lapses') +
      (c.penalty ? ', and ' + c.penalty + ' XP lost' + gears + '.' : ', ' + c.earned + ' XP' + (c.mult > 1 ? ' with your study circle' : '') + gears + '.') +
      (worst ? ' ' + (worst.kind === 'idle' ? 'Going idle' : worst.label) + ' cost you the most.' : '');
    return { worst, tooShort };
  }

  // Brief burst + banner on the time card. The new accessory pops in mid-burst.
  function levelUpMoment(c) {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const banner = $('levelUp');
    const burst = $('levelBurst');
    const lvl = S.progress.level;
    banner.textContent = 'Level ' + lvl + '!';
    banner.hidden = false;
    burst.replaceChildren();
    if (!still) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2, d = 46 + (i % 2) * 14;
        const b = document.createElement('i');
        b.style.setProperty('--dx', Math.round(Math.cos(a) * d) + 'px');
        b.style.setProperty('--dy', Math.round(Math.sin(a) * d) + 'px');
        b.style.setProperty('--c', ['var(--brass-pale)', 'var(--brass)', 'var(--copper-soft)'][i % 3]);
        burst.appendChild(b);
      }
      // Draw the pet without the new accessory, then swap it in as the burst peaks.
      if (lvl === 5 || lvl === 10 || lvl === 15) {
        StudyPet.drawPet($('petCard'), Object.assign(petOpts(c.mood), { level: lvl - 1 }));
        setTimeout(() => { if (S.lastCard === c) drawPets(); }, 350);
      }
    }
    banner.classList.remove('go'); void banner.offsetWidth;
    if (!still) banner.classList.add('go');
    setTimeout(() => { banner.hidden = true; burst.replaceChildren(); }, 1400);
  }

  // The circle's cards: real friends' last scored session from the device (0 while they're still
  // studying, shown as a dash until their result arrives); the demo drawer keeps the made-up ones.
  function renderBoard() {
    const c = S.viewCard || S.lastCard;
    if (!c) return;
    const fake = demoOn();
    const board = [{ name: 'You', pct: c.pct, me: true }].concat(circleShown().map((f, i) =>
      ({ name: f.name, pct: fake ? (f.pct != null ? f.pct : [94, 88, 91][i % 3]) : (f.pct > 0 ? f.pct : null) })));
    board.sort((a, b) => (b.pct == null ? -1 : b.pct) - (a.pct == null ? -1 : a.pct));
    $('board').replaceChildren(...board.map((p) => {
      const li = document.createElement('li');
      const w = p.pct == null ? 0 : p.pct;
      li.innerHTML = '<span class="who' + (p.me ? ' me' : '') + '"></span><span class="bar"><i style="width:' + w + '%"></i></span><span class="pct">' + (p.pct == null ? '—' : p.pct + '%') + '</span>';
      li.firstChild.textContent = p.name;
      if (p.pct == null) li.title = 'Still studying';
      return li;
    }));
    $('board').parentElement.hidden = board.length < 2;
  }

  function renderFinish() {
    const c = S.viewCard || S.lastCard;
    const notes = { yes: 'Logged as finished.', partly: 'Logged as partly done. The rest carries into the next session.', no: 'Logged as not finished. It carries into the next session.' };
    $('finishChips').replaceChildren(...[['yes', 'Yes'], ['partly', 'Partly'], ['no', 'Not yet']].map(([k, l]) => chip(l, c.finished === k, () => {
      c.finished = k;
      if (k !== 'yes' && c.goal !== 'Untitled session') { S.settings.goal = c.goal; $('goal').value = c.goal; save(); }
      renderFinish();
    }, 'word')));
    $('finishNote').textContent = c.finished ? notes[c.finished] : 'Your answer is saved with this time card.';
  }

  function coach(c, worst) {
    if (!worst) return 'A clean session. Keep the same setup for the next one.';
    if (worst.kind === 'idle') return 'You went idle at ' + mmss(worst.at) + ' for ' + mmss(worst.len).replace(/^0/, '') + '. If you need to step away, start a break instead, so it doesn\'t count against you.';
    if (worst.kind === 'camera') return 'The camera saw you ' + worst.label.toLowerCase() + ' at ' + mmss(worst.at) + ' for ' + mmss(worst.len).replace(/^0/, '') + '. Settle in before you begin, and take a real break when you need one.';
    return worst.label + ' pulled you away at ' + mmss(worst.at) + ' for ' + mmss(worst.len).replace(/^0/, '') + '. Close that tab before the next session begins.';
  }

  // ---------- Activity sources ----------
  async function requestIdle() {
    if (!('IdleDetector' in window) || S.idleDetector) return;
    try {
      if ((await IdleDetector.requestPermission()) !== 'granted') return;
      const det = new IdleDetector();
      det.addEventListener('change', () => {
        if (det.userState === 'idle') startDrift('idle', 'Idle'); else if (S.session && S.session.drift && S.session.drift.kind === 'idle') endDrift();
      });
      await det.start({ threshold: 60000 });
      S.idleDetector = det;
    } catch (e) { /* permission denied or unsupported: demo controls still work */ }
  }

  // The local Pomo app (same process that served this page) streams webcam focus ticks over
  // ws://localhost:8765, and switches the camera on/off when we ask. A separate helper
  // (Chrome extension or script) may also send {t:'active'} messages on the same socket.
  // Camera states that count as a drift. Looking away alone only lowers the score to
  // 'drifting' (never 'unfocused'), so both must count.
  const CAMERA_DRIFT_STATES = ['drifting', 'unfocused'];
  const CAMERA_LABELS = { absent: 'Away from desk', drowsy: 'Drowsy', looking_away: 'Looking away', slouching: 'Slouching' };
  let helper = null;

  function sendHelper(obj) {
    if (helper && helper.readyState === WebSocket.OPEN) helper.send(JSON.stringify(obj));
  }
  function setCamera(on) { sendHelper({ t: 'camera', on }); }

  // A page URL is matched on its host only ('box.com' or a "Reddit API docs" title must not trip 'x.com' / 'reddit');
  // without a usable URL (desktop-app helpers, blank tabs) the title and app name are searched instead.
  function distractingMatch(m) {
    let host = '';
    try { host = new URL(m.url).hostname.toLowerCase(); } catch (e) { /* no usable URL */ }
    if (host) return DISTRACTING.find((d) => (d.includes('.') ? host === d || host.endsWith('.' + d) : host.split('.').includes(d)));
    const hay = ((m.title || '') + ' ' + (m.app || '')).toLowerCase();
    return DISTRACTING.find((d) => hay.includes(d));
  }

  function connectHelper() {
    let ws;
    try { ws = new WebSocket('ws://localhost:8765'); } catch (e) { return; }
    helper = ws;
    ws.onopen = () => { if (S.session && S.session.mode === 'focus') setCamera(true); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'focus') { onCameraTick(m); return; }
      if (m.t === 'camera_error') { toast('Camera: ' + (m.message || 'could not start') + '. The session continues without it.'); return; }
      if (m.t !== 'active') return;
      const hit = distractingMatch(m);
      if (hit) startDrift('site', m.label || SITE_LABELS[hit] || hit.charAt(0).toUpperCase() + hit.slice(1).replace('.com', ''));
      else if (S.session && S.session.drift && S.session.drift.kind === 'site') endDrift();
    };
    ws.onclose = () => { if (helper === ws) helper = null; setTimeout(connectHelper, 5000); };
  }

  function onCameraTick(m) {
    const s = S.session;
    if (!s || s.mode !== 'focus') return;
    const f = focusMsg(m); // the device's pet reacts to the same ticks (see schema/pomo-device.schema.json)
    if (f) send(f);
    if (CAMERA_DRIFT_STATES.includes(m.state)) {
      // Start (or switch) only on a named reason; a null reason while the score recovers keeps the current drift.
      if (CAMERA_LABELS[m.reason]) startDrift('camera', CAMERA_LABELS[m.reason]);
    } else if (m.state === 'focused' && s.drift && s.drift.kind === 'camera') {
      endDrift();
    }
  }

  // ---------- Device (Web Serial, JSON lines) ----------
  async function connectDevice() {
    if (S.lost) { reconnectDevice(true); return; }
    if (S.device.connected) return;
    if (!('serial' in navigator)) { toast('Web Serial needs Chrome or Edge on localhost.'); return; }
    try {
      const port = await navigator.serial.requestPort();
      await attachPort(port);
      S.circle = []; // the real circle arrives from the device
      S.gone = [];
      renderSetup();
    } catch (e) { toast('Could not connect: ' + (e.message || e)); }
  }
  // Open the port and start talking; used for the first connect and for a reconnect.
  // stale() lets a timed-out attempt that finally opens close the port again instead of taking over.
  async function attachPort(port, stale) {
    if (port.readable || port.writable) { try { await port.close(); } catch (e) { /* already closing */ } }
    await port.open({ baudRate: 115200 });
    // Keep DTR/RTS low so opening the port doesn't reset the ESP32.
    try { await port.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch (e) { /* not supported (e.g. Bluetooth) */ }
    if (stale && stale()) { try { await port.close(); } catch (e) { /* ignore */ } return false; }
    const enc = new TextEncoderStream();
    enc.readable.pipeTo(port.writable);
    S.device = { connected: true, port, writer: enc.writable.getWriter(), stop: null };
    S.lastRx = Date.now();
    S.armed = false;
    S.feedUnsupported = false;
    clearTimeout(S.feedWait);
    S.feedWait = 0;
    setDeviceChip();
    sendConfig();
    readLoop(port);
    return true;
  }
  async function readLoop(port) {
    const dec = new TextDecoderStream();
    port.readable.pipeTo(dec.writable).catch(() => {});
    const reader = dec.readable.getReader();
    if (S.device.port === port) S.device.stop = () => reader.cancel().catch(() => {});
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line) {
            S.lastRx = Date.now();
            try { onDevice(JSON.parse(line)); } catch (e) { /* ignore non-JSON debug prints */ }
          }
        }
      }
    } catch (e) { /* unplugged */ }
    if (S.device.port === port) linkLost(); // not already handled (e.g. by the silence watchdog)
  }

  // A device session is running: it is frozen, not ended, when the link drops.
  function deviceSessionRunning() {
    const s = S.session;
    return !!(S.device.connected && s && (s.mode === 'focus' || !s.local));
  }
  const linkDown = () => !!(S.lost || S.paused || S.recon);
  // The link dropped (the read loop ended, or the device went silent).
  function linkLost() {
    const dev = S.device;
    if (!dev.connected) return;
    const running = deviceSessionRunning();
    S.device = { connected: false, port: null, writer: null };
    try { if (dev.stop) dev.stop(); dev.writer.close().catch(() => {}); } catch (e) { /* already gone */ }
    setTimeout(() => { if (dev.port && dev.port.close && S.device.port !== dev.port) dev.port.close().catch(() => {}); }, 300);
    if (running) {
      let info = {};
      try { info = dev.port.getInfo(); } catch (e) { /* unknown */ }
      S.lost = { info, port: dev.port };
      scheduleRetry();
      setDeviceChip();
      if (S.view === 'live') renderLive();
      return;
    }
    S.dev = null;
    S.care = null;
    renderCare();
    S.circle = []; // back to the local engine; the demo drawer has the fake friends
    S.gone = [];
    setDeviceChip();
    renderSetup();
    if (S.view === 'live') renderLive();
    toast('Device disconnected.');
  }
  // No line from the device for 6 s while a device session runs. An idle device sends nothing,
  // so this is armed only by a state after the (re)connect, and only while that state says a session is on.
  const BUSY_PHASES = ['study', 'break', 'long_rest', 'ready'];
  // The device waits between sessions: "Ready for session N of IV?" over whichever view is open.
  function renderReady() {
    const on = !!(S.device.connected && !linkDown() && S.dev && S.dev.phase === 'ready' && !S.readyDismissed);
    const box = $('ready');
    const key = on ? String(S.dev.session) : '';
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.classList.toggle('show', on);
    box.setAttribute('aria-hidden', String(!on));
    document.querySelector('main').inert = on;
    if (!on) return;
    const next = Math.min(SESSIONS_PER_SET, S.dev.session + 1); // state.session is the one that just finished
    $('readyTitle').textContent = 'Ready for session ' + (ROMAN[next - 1] || next) + ' of IV?';
    StudyPet.drawPet($('petReady'), petOpts(currentMood()));
    $('readyNextBtn').focus();
  }
  function linkWatch() {
    if (S.armed && S.dev && BUSY_PHASES.includes(S.dev.phase) && deviceSessionRunning() && Date.now() - S.lastRx > 6000) linkLost();
  }
  // Reopen the port after a loss. Button click: may ask which port. Plug-in event: only already-allowed ports.
  // Same device as the one we lost: USB vendor/product id, or the Bluetooth service class id.
  function samePort(p, info) {
    try {
      const a = p.getInfo();
      if (a.usbVendorId != null) return a.usbVendorId === info.usbVendorId && a.usbProductId === info.usbProductId;
      if (a.bluetoothServiceClassId != null) return String(a.bluetoothServiceClassId).toLowerCase() === String(info.bluetoothServiceClassId).toLowerCase();
    } catch (e) { /* no info */ }
    return false;
  }
  // Reopen the port we lost: the exact SerialPort object first, then granted ports that match it,
  // and the picker only when asked to and there is not exactly one match. One attempt at a time, 8 s at most.
  async function reconnectDevice(askUser) {
    if (!S.lost || reconnectDevice.busy) return;
    reconnectDevice.busy = true;
    let timedOut = false, picking = false, clock;
    const stale = () => timedOut || !S.lost;
    const attempt = (async () => {
      const lost = S.lost;
      const matches = (await navigator.serial.getPorts()).filter((p) => p !== lost.port && samePort(p, lost.info));
      // Fall back to a granted port only when exactly one matches; with several, guessing could pick the wrong device.
      const candidates = (lost.port ? [lost.port] : []).concat(matches.length === 1 ? matches : []);
      let failure = null;
      for (const port of candidates) {
        try {
          if (!(await attachPort(port, stale))) return;
          if (stale()) return;
          S.lost = null;
          clearTimeout(retryTimer);
          S.toastOnResume = true;
          // Keep the notice up until the device's first state says whether its session survived.
          S.recon = setTimeout(() => endLostSession(true), 5000);
          renderLinkOverlay();
          return;
        } catch (e) { failure = e; }
      }
      if (matches.length !== 1 && askUser) {
        picking = true; // the 8 s limit is for open(), not for the person choosing
        const port = await navigator.serial.requestPort();
        picking = false;
        if (await attachPort(port, stale) && !stale()) {
          S.lost = null;
          clearTimeout(retryTimer);
          S.toastOnResume = true;
          S.recon = setTimeout(() => endLostSession(true), 5000);
          renderLinkOverlay();
        }
        return;
      }
      if (failure) throw failure;
    })();
    const limit = new Promise((resolve, reject) => { clock = setTimeout(() => { if (picking) return; timedOut = true; reject(new Error('timed out')); }, 8000); });
    try { await Promise.race([attempt, limit]); }
    catch (e) { if (askUser) toast('Could not reconnect: ' + (e.message || e)); }
    finally { clearTimeout(clock); reconnectDevice.busy = false; }
  }
  // While the notice is up, keep looking for the device: every 3 s, after the last try has finished.
  let retryTimer = null;
  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(async () => {
      if (!S.lost) return;
      await reconnectDevice(false);
      if (S.lost) scheduleRetry();
    }, 3000);
  }
  // After a hello, a study state that doesn't continue our session (another session number, another
  // length, or more time left than we last saw) means the device restarted and began a new one
  function restartedSession(m) {
    const s = S.session;
    if (m.phase !== 'study' || !s || s.mode !== 'focus') return false;
    return m.session !== S.sessionNo || m.total !== s.total || m.left > s.left;
  }
  function settleReconnect() {
    if (!S.recon) return;
    clearTimeout(S.recon);
    S.recon = null;
    S.helloSeen = false;
    maybeResumed();
    if (S.view === 'live') renderLive();
  }
  function maybeResumed() {
    if (!S.toastOnResume || S.paused || S.recon) return;
    S.toastOnResume = false;
    toast('Reconnected. Session resumed.');
  }
  // The device restarted (USB power loss) so its session is gone: end the frozen one cleanly.
  // XP and level stay as the device reports them. forgetState: the last state we hold is stale.
  function endLostSession(forgetState) {
    clearTimeout(S.recon); S.recon = null; S.toastOnResume = false; S.helloSeen = false;
    clearTimeout(retryTimer);
    S.lost = null; S.paused = false;
    if (forgetState) S.dev = null;
    if (S.session && S.session.mode === 'focus') setCamera(false);
    S.session = null;
    S.peekUntil = 0;
    renderLinkOverlay();
    show('setup');
    renderSetup();
    toast(petName() + " restarted, so that session ended. Start a new one when you're ready.");
  }
  function leaveLostSession() {
    clearTimeout(S.recon); S.recon = null; S.toastOnResume = false; S.helloSeen = false;
    clearTimeout(retryTimer);
    S.lost = null; S.paused = false; S.dev = null;
    if (S.session && S.session.mode === 'focus') setCamera(false);
    S.session = null;
    S.circle = [];
    S.gone = [];
    setDeviceChip();
    show('setup');
    renderSetup();
  }
  function renderLinkOverlay() {
    const down = linkDown();
    const box = $('linkLost');
    box.classList.toggle('show', down);
    box.setAttribute('aria-hidden', String(!down));
    $('timerPanel').classList.toggle('frozen', down);
    for (const el of $('view-live').children) if (el !== box) el.inert = down;
    if (!down) return;
    $('linkLostTitle').textContent = petName() + ' lost the device';
    // Over Bluetooth the board stays powered and keeps timing; over USB (no battery) it usually lost power
    if (S.lost) {
      $('linkLostSub').textContent = S.lost.info.bluetoothServiceClassId != null
        ? 'Pomo is still keeping time. Plug it back in or reconnect Bluetooth to see it.'
        : "Pomo lost power or the cable came loose. Plug it back in; if it restarted, you'll start a fresh session.";
    }
    $('linkLostTry').textContent = S.lost ? 'Looking for ' + petName() + '…' : '';
    $('reconnectBtn').hidden = !S.lost;
    $('leaveBtn').hidden = !S.lost;
    StudyPet.drawPet($('petLost'), petOpts(currentMood()));
  }
  // Outgoing lines are checked against schema/pomo-device.schema.json before they are written:
  // known type, no extra fields, required fields present, and the device drops lines over 256 bytes.
  const OUT = {
    config: { req: [], keys: ['user', 'pet', 'time', 'tz'] },
    start: { req: ['study', 'brk'], keys: ['study', 'brk'], ok: (m) => Number.isInteger(m.study) && m.study >= 15 && m.study <= 90 && m.study % 5 === 0 && Number.isInteger(m.brk) && m.brk >= 1 },
    drift: { req: ['active'], keys: ['active', 'label', 'kind'] },
    focus: { req: ['ts', 'focus', 'state', 'reason'], keys: ['ts', 'focus', 'state', 'reason', 'window', 'yaw', 'pitch', 'ear'] },
    peek: { req: [], keys: [] },
    end: { req: ['scope'], keys: ['scope'] },
    ping: { req: [], keys: [] },
    feed: { req: [], keys: [] }
  };
  const FOCUS_STATES = ['calibrating', 'focused', 'drifting', 'unfocused'];
  const FOCUS_REASONS = ['absent', 'drowsy', 'looking_away', 'slouching', 'bad_window'];
  function send(obj) {
    const spec = OUT[obj.t];
    const bad = !spec || Object.keys(obj).some((k) => k !== 't' && !spec.keys.includes(k)) || spec.req.some((k) => !(k in obj)) || (spec.ok && !spec.ok(obj));
    const line = bad ? '' : JSON.stringify(obj) + '\n';
    if (bad || new TextEncoder().encode(line).length >= 256) { console.warn('Not sent (breaks the device schema):', obj); return; }
    if (!S.device.writer) return;
    S.device.writer.write(line).catch(() => {});
  }
  function sendConfig() {
    const st = S.settings;
    const pet = { name: petName().slice(0, 10) };
    if (['bot', 'cat', 'dog'].includes(st.body)) pet.body = st.body;
    if (['plain', 'monocle'].includes(st.face)) pet.face = st.face;
    if (['brass', 'copper', 'pewter', 'verdigris'].includes(st.color)) pet.color = st.color;
    // An empty name is left out, so it never wipes a name the device already has (friends then see the pet's)
    const user = String(st.user || '').trim().slice(0, 16);
    send(Object.assign({ t: 'config' }, user ? { user } : {}, { pet, time: Math.floor(Date.now() / 1000), tz: -new Date().getTimezoneOffset() }));
  }
  // The helper's tick carries exactly the schema's fields today; rebuild it anyway so nothing extra reaches the device.
  function focusMsg(m) {
    const ts = Number(m.ts), focus = Math.round(Number(m.focus));
    if (!(ts >= 1600000000) || !(focus >= 0 && focus <= 100) || !FOCUS_STATES.includes(m.state)) return null;
    const f = { t: 'focus', ts: Math.round(ts * 100) / 100, focus, state: m.state, reason: FOCUS_REASONS.includes(m.reason) ? m.reason : null };
    if (typeof m.window === 'string') f.window = m.window;
    if (Number.isFinite(m.yaw)) f.yaw = m.yaw;
    if (Number.isFinite(m.pitch)) f.pitch = m.pitch;
    if (Number.isFinite(m.ear) && m.ear >= 0 && m.ear <= 1) f.ear = m.ear;
    return f;
  }
  // "End early" with a device coupled: ask it to end; its 'end' message builds the time card.
  function requestDeviceEnd() {
    send({ t: 'end', scope: 'session' });
    clearTimeout(requestDeviceEnd.t);
    requestDeviceEnd.t = setTimeout(() => {
      if (S.session && S.session.mode === 'focus') toast('The device has not confirmed yet. End it on the device.');
    }, 3000);
  }
  // The device reports a running XP total; the dashboard shows XP within the level.
  function applyDeviceProgress(totalXp, level) {
    S.progress.level = level;
    S.progress.xp = Math.max(0, totalXp - (level - 1) * XP_PER_LEVEL);
    save();
  }
  // Coupled, the dashboard keeps its per-second record (gauge, ledger) from the device's clock.
  function accrue(s) {
    const upto = s.total - s.left;
    for (let i = s.acc || 0; i < upto; i++) {
      s.secs[i] = s.drift ? s.drift.kind : 'focus';
      if (!s.drift) { s.focusedSec++; s.xpSec += multiplier(); }
    }
    s.acc = Math.max(s.acc || 0, upto);
  }
  function onDeviceStart(m) {
    S.sessionNo = m.session;
    S.testTiming = m.test === true;
    if (S.dev && S.dev.phase === 'ready') S.readyDismissed = true; // started from the device: follow it
    renderReady();
    const s = S.session;
    if (s && s.mode === 'focus') {
      s.study = m.study; s.brk = m.brk;
      if (s.total !== m.study * 60) { s.total = s.left = m.study * 60; s.secs = new Array(s.total).fill(null); s.acc = 0; }
      renderLive();
    } else {
      beginFocus(m.study, m.brk, S.settings.goal);
    }
  }
  function onDeviceState(m) {
    S.dev = m;
    S.paused = m.paused === true;
    S.armed = true;
    if (Number.isInteger(m.gears) || typeof m.hunger === 'string') updateCare({ gears: m.gears, hunger: m.hunger });
    const nowReady = m.phase === 'ready';
    if (nowReady && !S.wasReady) chime(); // once, when ready begins
    S.wasReady = nowReady;
    if (!nowReady) S.readyDismissed = false;
    if (m.phase === 'idle') { S.testTiming = false; S.sessionNo = 1; S.gone = []; } // the firmware's goIdle resets the set
    applyDeviceProgress(m.xp, m.level);
    if (S.recon && m.phase === 'idle') { endLostSession(false); return; } // it restarted: nothing to resume
    if (S.recon && S.helloSeen && restartedSession(m)) { endLostSession(false); return; }
    if (S.recon && S.helloSeen) S.toastOnResume = false; // same session still running: resume quietly
    if (S.recon) settleReconnect(); else maybeResumed();
    let s = S.session;
    if (m.phase === 'study') {
      S.sessionNo = m.session;
      if (!s || s.mode !== 'focus') { beginFocus(Math.max(1, Math.round(m.total / 60)), S.settings.brk, S.settings.goal); s = S.session; }
      if (s.total !== m.total) { const old = s.secs; s.total = m.total; s.secs = new Array(m.total).fill(null); old.slice(0, m.total).forEach((v, i) => { s.secs[i] = v; }); }
      s.left = m.left;
      if (s.xp0 == null) s.xp0 = m.xp;
      accrue(s);
    } else if (m.phase === 'break' || m.phase === 'long_rest') {
      if (!s) S.session = { mode: 'break', total: m.total, left: m.left, long: m.phase === 'long_rest' };
      else if (s.mode === 'break') { s.total = m.total; s.left = m.left; s.long = m.phase === 'long_rest'; s.local = false; }
    } else if (nowReady) { // the break ran out: no timer runs, the ready panel takes over
      if (s && s.mode === 'break' && !s.local) { S.session = null; if (S.view === 'live') { show('setup'); renderSetup(); } }
    } else if (m.phase === 'idle' && s && s.mode === 'break' && !s.local) { // idle again: the break is over
      S.session = null;
      if (S.view === 'live') { chime(); toast('Intermission over. Ready for the next session?'); show('setup'); renderSetup(); }
    }
    if (S.view === 'live') renderLive();
    renderReady();
  }
  function onDeviceEnd(m) {
    clearTimeout(requestDeviceEnd.t);
    if (!S.session || S.session.mode !== 'focus') { // e.g. the page was reloaded mid-session
      const total = m.elapsed_min * 60;
      S.session = Object.assign(newFocusSession(Math.max(1, m.elapsed_min), S.settings.brk, S.settings.goal), { total, left: 0, startedAt: new Date(Date.now() - total * 1000), secs: new Array(total).fill(null) });
    }
    endSession(m.early, m);
  }
  // The device lists every Pomo in range. One that vanishes mid-set stays as a greyed "Out of range"
  // row until it comes back or the set ends; the multiplier follows the device's state.mult.
  function onCircle(friends) {
    const next = friends.map((f) => ({ name: String(f.name).slice(0, 10), focused: !!f.focused, pct: Number.isInteger(f.pct) ? f.pct : 0 }));
    if (S.session) {
      for (const f of S.circle) if (!next.some((n) => n.name === f.name) && !S.gone.some((g) => g.name === f.name)) S.gone.push({ name: f.name });
    }
    S.gone = S.gone.filter((g) => !next.some((n) => n.name === g.name));
    S.circle = next;
    renderSetup();
    if (S.view === 'live') renderLive();
    if (S.view === 'card') renderBoard();
  }
  function onDevice(m) {
    switch (m.t) {
      case 'hello':
        // The firmware also says hello on every Bluetooth connect, with its session still running:
        // the next state decides whether it really restarted (see onDeviceState)
        if (S.lost || S.recon) { S.helloSeen = true; sendConfig(); break; }
        toast('Device says hello (firmware ' + (m.fw || '?') + ').'); sendConfig(); break;
      case 'start': onDeviceStart(m); break;
      case 'state': onDeviceState(m); break;
      case 'end': onDeviceEnd(m); break;
      case 'circle':
        if (Array.isArray(m.friends)) onCircle(m.friends);
        break;
      case 'pet': onPet(m); break;
    }
  }
  // ---------- Pet care (Milestone E, prepared) ----------
  // Everything here stays off until the device sends gears or hunger (Firmware-Pomo docs/PET_PLAY_AND_CARE.md, Part 2).
  const HUNGER = ['full', 'content', 'peckish', 'hungry'];
  // Idle face by hunger: full -> love, hungry -> hungry, otherwise none (the caller's default)
  function careMood() {
    if (!S.care) return null;
    if (S.care.hunger === 'full') return 'love';
    if (S.care.hunger === 'hungry') return 'hungry';
    return null;
  }
  function updateCare(part) {
    const c = S.care || { gears: 0, max: 12, hunger: 'content', fedAt: 0 };
    if (Number.isInteger(part.gears)) c.gears = Math.max(0, Math.min(c.max, part.gears));
    if (Number.isInteger(part.max) && part.max > 0) c.max = part.max;
    if (HUNGER.includes(part.hunger)) c.hunger = part.hunger;
    if (Number.isInteger(part.fedAt)) c.fedAt = part.fedAt;
    S.care = c;
    // a pet sitting idle in the Playground says the line for its new hunger
    const p = S.play;
    if (S.view === 'play' && !p.dancing && !p.gear && !p.wound && !p.asleep && Object.values(IDLE_LINES).includes(p.line)) p.line = idleLine();
    renderCare();
    drawPets();
    if (S.view === 'home') renderHome();
  }
  // The device's pet message; feed attempts made on the device show in the Playground
  // A fed, empty or stuffed event answers a waiting feed request; a fed event nobody here asked for
  // is a feed on the device (knob or touch), shown here too. The gear count always comes from the message.
  function onPet(m) {
    const wasHungry = !!(S.care && S.care.hunger === 'hungry');
    if (m.event === 'earned') gearsEarned(Number.isInteger(m.earned) ? m.earned : 0);
    const answer = ['fed', 'empty', 'stuffed'].includes(m.event);
    if (answer && S.feedWait) { clearTimeout(S.feedWait); S.feedWait = 0; }
    updateCare({ gears: m.gears, max: m.max_gears, hunger: m.hunger, fedAt: m.fed_at });
    if (S.view !== 'play' || !answer) return;
    const p = S.play;
    if (m.event === 'fed') {
      const woke = playNoted();
      if (p.gear || p.dancing) { // a gear already flying (or dancing): just the result
        p.line = wasHungry ? "Oh, that's better!" : 'Crunchy! Thank you.';
        p.loveUntil = Date.now() + AFTER_MS;
      } else toss(woke, wasHungry);
      renderPlay();
      return;
    }
    p.line = m.event === 'empty' ? 'Out of gears! Finish a session to earn some.' : "I'm stuffed! Save it for later.";
    sound(SOUNDS.SHH); // the device's low hum for a refused feed
    p.lastPlay = Date.now();
    renderPlay();
  }
  // The gears a completed session earned arrive just after its end: they join that time card's score line
  function gearsEarned(n) {
    const c = S.lastCard;
    if (!c || c.gears != null || Date.now() - c.endedAt.getTime() > 15000) return;
    c.gears = n;
    const t = store.get('cards', null); // the shelf's copy of the card too
    if (t && Array.isArray(t.list)) {
      const saved = t.list.find((x) => x.id === c.endedAt.getTime());
      if (saved) { saved.gears = n; store.set('cards', t); }
    }
    if (!S.viewCard) renderCardLine(c); // only the score line, so the card doesn't print again
  }
  // Ask the device to feed; the button waits for its pet reply. No reply in 2 s: this firmware
  // doesn't know feed yet, so the button becomes "Feed on Pomo" for the rest of the connection.
  const FEED_REPLY_MS = 2000;
  function requestFeed() {
    if (S.feedWait) return;
    playNoted();
    if (S.feedUnsupported || !S.device.connected) { renderFeedBtn(); return; }
    send({ t: 'feed' });
    S.feedWait = setTimeout(() => {
      S.feedWait = 0;
      S.feedUnsupported = true;
      renderFeedBtn();
    }, FEED_REPLY_MS);
    renderFeedBtn();
  }
  function renderFeedBtn() {
    const btn = $('feedBtn'), c = S.care, fallback = !!(c && S.feedUnsupported);
    btn.disabled = !!S.feedWait;
    btn.textContent = fallback ? 'Feed on Pomo' : 'Feed a gear';
    btn.classList.toggle('dim', fallback || !!(c && c.gears <= 0));
    $('feedHint').hidden = !fallback;
  }
  // The gears bars on Home and the Playground: a small gear, then a pip per gear the bar holds
  function renderCare() {
    const c = S.care;
    for (const id of ['homeGears', 'playGears']) {
      const bar = $(id);
      bar.hidden = !c;
      if (!c) continue;
      if (!bar.firstChild) bar.innerHTML = '<span class="gear-icon">' + GEAR_FRAMES[0] + '</span><span class="pips"></span>';
      const pips = bar.lastChild;
      if (pips.children.length !== c.max) pips.replaceChildren(...Array.from({ length: c.max }, () => document.createElement('i')));
      [...pips.children].forEach((pip, i) => pip.classList.toggle('on', i < c.gears));
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', 'Gears: ' + c.gears + ' of ' + c.max);
    }
    renderFeedBtn();
  }

  // ---------- Home ----------
  // Today's time cards in this browser, kept as { day: 'YYYY-MM-DD', list } (dates as ISO strings)
  const todayKey = () => { const d = new Date(); return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()); };
  function todaysCards() {
    const t = store.get('cards', null);
    if (!t || t.day !== todayKey() || !Array.isArray(t.list)) return [];
    return t.list.map((c) => Object.assign({}, c, { startedAt: new Date(c.startedAt), endedAt: new Date(c.endedAt) }));
  }
  function archiveCard(c) {
    if (!c) return;
    const list = todaysCards();
    // a stored card never replays its level-up
    list.push(Object.assign({}, c, { id: c.endedAt.getTime(), leveled: false }));
    store.set('cards', { day: todayKey(), list: list.slice(-12) });
  }
  // The latest card, redrawn if an earlier one from the shelf was on the card view
  function showLastCard() {
    if (!S.lastCard || S.session) return;
    S.viewCard = null;
    if (S.cardShown !== S.lastCard) renderCard();
    show('card');
  }
  // Open a card from the shelf: the latest is the live one, an earlier one is shown on its own
  function openCard(card) {
    if (S.session) return;
    if (S.lastCard && S.lastCard.endedAt.getTime() === card.id) { showLastCard(); return; }
    S.viewCard = card;
    renderCard();
    show('card');
  }
  // The nixie clock: 12-hour, the hour's first tube unlit below 10, the colon blinking each second
  let clockTubes = null, clockMin = -1;
  function renderClock() {
    if (!clockTubes) clockTubes = buildTubes($('homeClock'));
    const now = new Date();
    $('homeClock').classList.toggle('blink', now.getSeconds() % 2 === 1);
    const stamp = now.getHours() * 60 + now.getMinutes();
    if (stamp === clockMin) return;
    clockMin = stamp;
    const h = now.getHours() % 12 || 12;
    const t = (h < 10 ? ' ' + h : String(h)) + two(now.getMinutes());
    clockTubes.forEach((el, i) => setTube(el, t[i] === ' ' ? '' : t[i]));
    const ampm = now.getHours() < 12 ? 'AM' : 'PM';
    $('homeAmPm').textContent = ampm;
    $('homeClock').setAttribute('aria-label', 'The time is ' + h + ':' + two(now.getMinutes()) + ' ' + ampm);
  }
  const firstVisit = () => store.get('settings', null) === null; // nothing saved yet in this browser
  function renderHome() {
    const first = firstVisit();
    $('homeWelcome').hidden = !first;
    $('homeReturning').hidden = first;
    $('homePetTitle').hidden = first; // a first visit shows no stats
    $('homePetTitle').replaceChildren(...withNums([petName() + ' · Lv ', { n: S.progress.level }]));
    if (!first) {
      const h = new Date().getHours();
      const part = h < 5 ? 'Up late' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
      const who = (S.settings.user || '').trim();
      $('homeGreeting').textContent = who ? part + ', ' + who + '.' : part + '.';
      $('homeLevel').replaceChildren(...withNums(['To level ', { n: S.progress.level + 1 }]));
      $('homeXp').replaceChildren(...withNums([{ n: S.progress.xp }, ' / ', { n: XP_PER_LEVEL }, ' XP']));
      $('homeXpFill').style.width = Math.min(100, (S.progress.xp / XP_PER_LEVEL) * 100).toFixed(1) + '%';
      renderClock();
      const cards = todaysCards();
      const focused = cards.reduce((sum, c) => sum + (c.focusedMin || 0), 0);
      $('homeFocused').hidden = !focused;
      $('homeFocused').replaceChildren(...withNums([{ n: focused }, ' min focused today']));
      // The set's four sessions: done ones filled, the next one lit (as the Begin label counts them)
      const next = S.sessionNo;
      $('homeCycle').setAttribute('aria-label', 'Session ' + ROMAN[next - 1] + ' of IV is next');
      $('homeCycle').replaceChildren(...ROMAN.map((r, i) => {
        const li = document.createElement('li');
        li.dataset.state = i < next - 1 ? 'done' : i === next - 1 ? 'current' : 'todo';
        li.innerHTML = '<span class="pip" aria-hidden="true"></span><span></span>';
        li.lastChild.textContent = r;
        return li;
      }));
      renderShelf(cards);
    } else {
      $('homeShelfWrap').hidden = true;
    }
    document.querySelector('.home').classList.toggle('full', !first);
    const awake = S.device.connected;
    $('homeLamp').className = 'lamp' + (awake ? ' on' : '');
    $('homeDevice').parentElement.classList.toggle('awake', awake);
    // Awake is a status; otherwise the line is the same connect action as the top-bar chip
    $('homeDevice').hidden = !awake;
    $('homeDevice').textContent = 'Pomo is awake';
    $('homeConnectBtn').hidden = awake;
    const label = S.lost ? 'Reconnect Pomo' : 'Connect Pomo to begin';
    if ($('homeConnectBtn').textContent !== label) $('homeConnectBtn').textContent = label;
    $('homeSpeech').hidden = first;
    $('homeFed').hidden = first || !S.care;
    if (!first && S.care) $('homeFed').textContent = 'Last fed: ' + fedAgo(S.care.fedAt);
    if (!first) {
      const line = petSays();
      if ($('homeSpeech').textContent !== line) $('homeSpeech').textContent = line;
    }
    StudyPet.drawPet($('petHome'), petOpts(currentMood()));
  }
  // Today's cards, newest first, at most four; an empty slot on a day with none
  function renderShelf(cards) {
    $('homeShelfWrap').hidden = false;
    const key = cards.map((c) => c.id).join(',');
    if ($('homeShelf').dataset.key === key && key) return;
    $('homeShelf').dataset.key = key;
    if (!cards.length) {
      const slot = document.createElement('div');
      slot.className = 'mini-card empty';
      slot.textContent = 'Your first card of the day lands here.';
      $('homeShelf').replaceChildren(slot);
      return;
    }
    $('homeShelf').replaceChildren(...cards.slice(-4).reverse().map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mini-card';
      const mins = Math.round(c.done / 60);
      const len = mins < 1 ? '<1 min' : mins + ' min';
      b.innerHTML = '<span class="mini-stamp"></span><span class="mini-len"></span>';
      b.firstChild.textContent = c.pct + '%';
      b.lastChild.textContent = len;
      b.setAttribute('aria-label', 'Time card from ' + clock(c.endedAt) + ': ' + c.pct + '% focused, ' + len);
      b.addEventListener('click', () => openCard(c));
      return b;
    }));
  }
  // What the pet says on Home, from real state, first match wins. The pet is speaking, so no pet name.
  function petSays() {
    const names = S.circle.map((f) => f.name);
    if (names.length) {
      const who = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
      return who + (names.length === 1 ? ' is' : ' are') + ' nearby. Study together?';
    }
    if (S.care && (S.care.hunger === 'hungry' || S.care.hunger === 'peckish')) return IDLE_LINES[S.care.hunger];
    const cards = todaysCards().reverse(); // newest first
    const proud = cards.find((c) => c.pct >= 80);
    if (proud) return 'That ' + proud.pct + '% session? Proud of you.';
    if (cards.some((c) => c.pct < 60)) return "Rough one earlier. Let's try a short one.";
    if (new Date().getHours() < 5) return "It's late. One short session, then sleep?";
    if (!S.device.connected) return "Plug me in and we'll get started.";
    return 'Ready when you are.';
  }
  // Status's "Last fed" wording (Firmware-Pomo docs/PET_PLAY_AND_CARE.md, "On screen"); fed_at 0 reads as unknown
  function fedAgo(fedAt) {
    if (!fedAt) return '\u2013';
    const s = Date.now() / 1000 - fedAt;
    if (s < 120) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 172800) return 'yesterday';
    return Math.floor(s / 86400) + ' days ago';
  }
  function goHome() {
    if (S.session) return; // not mid-session
    show('home');
    renderHome();
  }
  // Leave Home for Setup, optionally landing on one field
  function toSetup(fieldId) {
    show('setup');
    renderSetup();
    if (fieldId) $(fieldId).focus();
  }

  function setDeviceChip() {
    $('deviceLamp').className = 'lamp' + (S.device.connected ? ' on' : '');
    $('deviceText').textContent = S.device.connected ? 'Device coupled · USB' : S.lost ? 'Device lost · Reconnect' : 'Connect device';
    $('sendPetBtn').disabled = !S.device.connected;
    $('sentNote').textContent = S.device.connected ? '' : 'Connect the device to send.';
    if (S.view === 'home') renderHome();
  }

  // ---------- Misc ----------
  function peek() {
    if (!S.session || S.session.mode !== 'focus' || linkDown()) return;
    send({ t: 'peek' });
    S.peekUntil = Date.now() + 5000;
    renderLive();
    clearTimeout(peek.t);
    peek.t = setTimeout(() => { if (S.view === 'live') renderLive(); }, 5050);
  }
  // One shared AudioContext. Chrome keeps a new one suspended without a recent user gesture, so it is
  // created and resumed on the first pointerdown/keydown and reused for every chime.
  let audio = null;
  function getAudio() {
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ } }
    return audio;
  }
  function unlockAudio() {
    const ac = getAudio();
    if (!ac) return;
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    if (ac.state !== 'suspended') {
      document.removeEventListener('pointerdown', unlockAudio, true);
      document.removeEventListener('keydown', unlockAudio, true);
    }
  }
  function chime() {
    const ac = getAudio();
    if (!ac) return;
    const play = () => {
      if (ac.state !== 'running') return; // still blocked: stay silent rather than chime late
      const t0 = ac.currentTime;
      [660, 880].forEach((f, i) => {
        const o = ac.createOscillator(); const g = ac.createGain();
        o.frequency.value = f; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, t0 + i * 0.18);
        g.gain.exponentialRampToValueAtTime(0.2, t0 + i * 0.18 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.5);
        o.connect(g).connect(ac.destination); o.start(t0 + i * 0.18); o.stop(t0 + i * 0.18 + 0.55);
      });
    };
    if (ac.state === 'suspended') ac.resume().then(play, () => {}); else play();
  }

  function demo(action) {
    const s = S.session;
    if (linkDown()) { toast('The session is paused until the device is back.'); return; }
    if (action === 'friend' && !demoOn()) { toast('Open the demo drawer (D) to use the fake friends.'); return; }
    if (S.device.connected && (action === 'fast' || action === 'finish')) { toast('The device owns the clock while it is coupled.'); return; }
    if (action === 'fast') { S.speed = S.speed === 1 ? 30 : 1; toast(S.speed === 1 ? 'Normal speed' : 'Speed ×30'); if (S.view === 'live') renderLive(); return; }
    if (action === 'friend') {
      const f = S.fake[1] || S.fake[0];
      if (f) { f.focused = !f.focused; toast(f.name + (f.focused ? ' is focused again' : ' is drifting')); }
      if (S.view === 'live') renderLive();
      return;
    }
    if (!s || s.mode !== 'focus') { toast('Start a session first.'); return; }
    if (action === 'site') { if (s.drift && s.drift.kind === 'site') endDrift(); else startDrift('site', 'YouTube'); }
    if (action === 'idle') { if (s.drift && s.drift.kind === 'idle') endDrift(); else startDrift('idle', 'Idle'); }
    if (action === 'finish') { while (s.left > 1) { s.secs[s.total - s.left] = s.drift ? s.drift.kind : 'focus'; if (!s.drift) { s.focusedSec++; s.xpSec += multiplier(); } s.left--; } tick(); }
  }

const HEART_SVG = '<svg viewBox="0 0 7 6" width="100%" height="100%" shape-rendering="crispEdges" aria-hidden="true"><g fill="currentColor"><rect x="1" y="0" width="2" height="1"/><rect x="4" y="0" width="2" height="1"/><rect x="0" y="1" width="7" height="2"/><rect x="1" y="3" width="5" height="1"/><rect x="2" y="4" width="3" height="1"/><rect x="3" y="5" width="1" height="1"/></g></svg>';

  function showBubble(porthole, show){
    let b = porthole.querySelector('.pet-bubble');
    if (!b){
      b = document.createElement('span');
      b.className = 'pet-bubble';
      b.textContent = "Not now, we're working.";

      porthole.appendChild(b);
    }
    b.hidden = !show;
  }

  // ---------- Petting (Firmware-Pomo docs/PET_PLAY_AND_CARE.md, Part 1 "Petting") ----------
  // Outside focus: a tap (on press) hops the porthole, sends three hearts and the love face for 2 s;
  // a stroke squishes the pet and sends one heart. In focus a tap only hushes it (shh for 2 s).
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const petted = () => Date.now() < S.lovedUntil;
  const hushed = () => Date.now() < S.shhUntil;
  const PET_FACE_MS = 2000;
  // The face changes back by itself: redraw just after it runs out
  function redrawAfter(ms) { setTimeout(drawPets, ms + 20); }

  // A heart at viewport (x, y): rises 38 px over 900 ms (ease-out), opaque for the first half, then fades
  function heartAt(x, y) {
    const h = document.createElement('span');
    h.className = 'heart-fx';
    h.innerHTML = HEART_SVG;
    h.style.left = Math.round(x) + 'px';
    h.style.top = Math.round(y) + 'px';
    document.body.appendChild(h);
    if (!reducedMotion()) h.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-38px)' }], { duration: 900, easing: 'ease-out' });
    h.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], { duration: 900 }).onfinish = () => h.remove();
  }
  // Three hearts at the doc's offsets from the porthole's centre (x) and top (y), 120 ms apart
  // With 3 hearts all three start positions, with 2 the left and right, with 1 the middle (Firmware-Pomo docs/PET_PLAY_AND_CARE.md, "Hunger")
  const HEART_STARTS = { 3: [[-22, 6], [2, 0], [18, 10]], 2: [[-22, 6], [18, 10]], 1: [[2, 0]] };
  function tapHearts(porthole, count) {
    const r = porthole.getBoundingClientRect();
    if (!r.width) return; // not on screen
    const cx = r.left + r.width / 2;
    HEART_STARTS[count || 3].forEach(([dx, dy], i) => setTimeout(() => heartAt(cx + dx, r.top + dy), i * 120));
  }
  // Taps give 3/3/2/1 hearts when full/content/peckish/hungry; 3 while the device hasn't reported hunger
  const tapHeartCount = () => (S.care ? { full: 3, content: 3, peckish: 2, hungry: 1 }[S.care.hunger] || 3 : 3);
  const hungry = () => !!(S.care && S.care.hunger === 'hungry');
  // One heart from a random spot: ±20 px of centre, 0-10 px below the porthole's top
  function strokeHeart(porthole) {
    const r = porthole.getBoundingClientRect();
    if (!r.width) return;
    heartAt(r.left + r.width / 2 + (Math.random() * 40 - 20), r.top + Math.random() * 10);
  }
  // The porthole hops 5 px: 110 ms up, 140 ms down
  function hop(el) {
    if (reducedMotion()) return;
    el.animate([{ transform: 'translateY(0)', easing: 'ease-out' }, { transform: 'translateY(-5px)', offset: 110 / 250, easing: 'ease-in' }, { transform: 'translateY(0)' }],
      { duration: 250, composite: 'add' });
  }
  // The pet squishes to 115% width and back: 110 ms out, 170 ms back, ease-out
  function squish(canvas) {
    if (reducedMotion() || !canvas) return;
    canvas.animate([{ transform: 'scaleX(1)', easing: 'ease-out' }, { transform: 'scaleX(1.15)', offset: 110 / 280, easing: 'ease-out' }, { transform: 'scaleX(1)' }],
      { duration: 280, composite: 'add' });
  }
  function hush(porthole) {
    S.shhUntil = Date.now() + PET_FACE_MS;
    drawPets();
    if (S.view === 'live') renderLive();
    redrawAfter(PET_FACE_MS);
    showBubble(porthole, true);
    clearTimeout(hush.t);
    hush.t = setTimeout(() => showBubble(porthole, false), PET_FACE_MS);
    sound(SOUNDS.SHH);
  }
  function loved(ms) {
    S.lovedUntil = Math.max(S.lovedUntil, Date.now() + ms);
    drawPets();
    redrawAfter(ms);
  }

  function wirePetting(porthole) {
    const canvas = porthole.querySelector('canvas');
    let pressed = false, travel = 0, lastStroke = 0;
    porthole.addEventListener('pointerdown', (e) => {
      if (S.play.dancing) return; // the dance ignores petting
      pressed = true;
      travel = 0;
      try { porthole.setPointerCapture(e.pointerId); } catch (err) { /* the stroke still counts while over the pet */ }
      if (S.session && S.session.mode === 'focus') { hush(porthole); return; }
      loved(PET_FACE_MS);
      hop(porthole);
      tapHearts(porthole, tapHeartCount());
      sound(SOUNDS.PET);
      notePlay();
    });
    // A stroke: every 30 px of |dx| + |dy|, at most once per 250 ms. Pointer capture keeps counting off the pet.
    porthole.addEventListener('pointermove', (e) => {
      if (!pressed || S.play.dancing || (S.session && S.session.mode === 'focus')) return;
      travel += Math.abs(e.movementX) + Math.abs(e.movementY);
      const now = Date.now();
      if (travel < 30 || now - lastStroke < 250) return;
      travel = 0;
      lastStroke = now;
      loved(PET_FACE_MS);
      squish(canvas);
      if (!hungry()) strokeHeart(porthole); // a hungry pet purrs, without a heart
      sound(SOUNDS.PURR);
      notePlay();
    });
    const release = () => { pressed = false; };
    porthole.addEventListener('pointerup', release);
    porthole.addEventListener('pointercancel', release);
  }

  // ---------- Sounds (PET_PLAY_AND_CARE.md, "Sounds") ----------
  // Each note is [hz, vol 0-50, ms]; hz 0 is a rest. Square waves on the shared AudioContext.
  const SOUNDS = {
    PET: [[1150, 25, 45], [0, 0, 35], [1400, 30, 45], [0, 0, 35], [1750, 35, 80]],
    PURR: [[520, 18, 35], [0, 0, 10], [600, 18, 35], [0, 0, 10], [520, 18, 45]],
    WIND: [[3400, 25, 6], [0, 0, 14], [2900, 20, 5]],
    DANCE: [2093, 2637, 3136, 2637, 2349, 2793, 3520, 2793].map((hz) => [hz, 30, 110]).concat([[3136, 30, 160], [0, 0, 40], [4186, 30, 220]]),
    TOSS: [[1800, 12, 20], [2300, 12, 20], [2900, 12, 25]],
    CRUNCH: [[420, 40, 25], [0, 0, 20], [360, 40, 25], [0, 0, 60], [440, 35, 25], [0, 0, 20], [380, 35, 30]],
    SHH: [[880, 20, 70]]
  };
  const SOUND_GAIN = 0.06; // gain at vol 50 (the doc's "full"), kept well down so the sounds stay quiet
  function sound(notes) {
    const ac = getAudio();
    if (!ac) return;
    const play = () => {
      if (ac.state !== 'running') return; // not unlocked yet: stay silent
      let t = ac.currentTime + 0.01;
      for (const [hz, vol, ms] of notes) {
        const d = ms / 1000;
        if (hz) {
          const o = ac.createOscillator(), g = ac.createGain(), peak = SOUND_GAIN * vol / 50;
          o.type = 'square';
          o.frequency.value = hz;
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(peak, t + 0.002);
          g.gain.setValueAtTime(peak, t + d - 0.002);
          g.gain.linearRampToValueAtTime(0, t + d);
          o.connect(g).connect(ac.destination);
          o.start(t);
          o.stop(t + d + 0.01);
        }
        t += d;
      }
    };
    if (ac.state === 'suspended') ac.resume().then(play, () => {}); else play();
  }

  // ---------- Playground (PET_PLAY_AND_CARE.md, Part 1 "The Playground") ----------
  const WIND_FULL = 12, RUN_DOWN_AFTER = 3000, RUN_DOWN_EVERY = 600, DANCE_MS = 3000, AFTER_MS = 1500;
  const FLIGHT_MS = 650, SLEEP_AFTER = 20000, HOLD_DELAY = 400, HOLD_REPEAT = 150;
  const IDLE_LINE = 'Wind my key, or toss me a gear!';
  // The Playground's idle line by hunger (Firmware-Pomo docs/PET_PLAY_AND_CARE.md, Part 2 "What the pet says")
  const IDLE_LINES = { full: "I'm stuffed! Wind me up instead?", content: IDLE_LINE, peckish: 'A gear would be lovely...', hungry: "My tummy's ticking... got a gear?" };
  const idleLine = () => (S.care && IDLE_LINES[S.care.hunger]) || IDLE_LINE;
  const gearSvg = (rects) => '<svg viewBox="0 0 7 7" width="21" height="21" shape-rendering="crispEdges" aria-hidden="true"><g fill="currentColor">' +
    rects.map(([x, y, w, h]) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"/>').join('') + '</g></svg>';
  // The gear's two tumbling frames, 7x7 (Feeding)
  const GEAR_FRAMES = [
    gearSvg([[3, 0, 1, 1], [1, 1, 5, 1], [1, 2, 2, 1], [4, 2, 2, 1], [0, 3, 2, 1], [5, 3, 2, 1], [1, 4, 2, 1], [4, 4, 2, 1], [1, 5, 5, 1], [3, 6, 1, 1]]),
    gearSvg([[1, 0, 1, 1], [5, 0, 1, 1], [2, 1, 3, 1], [1, 2, 2, 1], [4, 2, 2, 1], [1, 3, 1, 1], [5, 3, 1, 1], [1, 4, 2, 1], [4, 4, 2, 1], [2, 5, 3, 1], [1, 6, 1, 1], [5, 6, 1, 1]])
  ];
  const playPorthole = () => $('petPlay').parentElement;

  // Moods in the Playground, highest wins: dancing / just danced or caught / petted -> love; asleep -> sleep; else happy
  function playMood() {
    const p = S.play, now = Date.now();
    if (p.dancing || now < p.loveUntil || petted()) return 'love';
    if (p.asleep) return 'sleep';
    return careMood() || 'happy';
  }
  function renderPlay() {
    const p = S.play;
    StudyPet.drawPet($('petPlay'), Object.assign(petOpts(playMood()), { key: p.key }));
    const level = Math.max(0, Math.min(WIND_FULL, Math.ceil(p.shown != null ? p.shown : p.wound)));
    const cells = $('windGauge').children;
    for (let i = 0; i < WIND_FULL; i++) cells[i].classList.toggle('on', i < level);
    $('windGauge').setAttribute('aria-valuenow', String(level));
    $('windCount').replaceChildren(...withNums([{ n: level }, ' / ', { n: WIND_FULL }]));
    if ($('playSpeech').textContent !== p.line) $('playSpeech').textContent = p.line;
    renderPlay.mood = playMood();
  }
  // Any play resets the idle clocks and wakes a sleeping pet, which then says hello instead of its usual line
  function playNoted() {
    const p = S.play;
    p.lastPlay = Date.now();
    if (!p.asleep) return false;
    p.asleep = false;
    p.line = 'Oh! Hello again.';
    return true;
  }
  function notePlay() {
    if (S.view !== 'play') return;
    playNoted();
    renderPlay();
  }
  function openPlay() {
    if (S.session) return;
    const p = S.play;
    p.lastPlay = Date.now();
    p.asleep = false;
    if (!p.wound && !p.dancing) p.line = idleLine();
    show('play');
    renderPlay();
    playLoop();
  }
  // One click of the key (a knob detent, a tap of Wind, or one repeat while it's held)
  function wind() {
    const p = S.play;
    if (S.view !== 'play' || p.dancing) return;
    const woke = playNoted();
    p.wound = Math.min(WIND_FULL, p.wound + 1);
    p.key = (p.key + 1) % 4;
    sound(SOUNDS.WIND);
    if (p.wound >= WIND_FULL) { startDance(); return; }
    if (!woke) p.line = p.wound <= 5 ? 'Keep winding...' : 'Almost there!';
    renderPlay();
  }
  // The dance: 3 s, three turns (drawn at |cos(angle)| width, mirrored while cos < 0), a hop every half turn
  function startDance() {
    const p = S.play;
    p.dancing = true;
    p.danceAt = Date.now();
    p.tired = hungry(); // a hungry pet dances 2 turns, without hearts
    p.line = p.tired ? 'Wheee... huff...' : 'Wheee!';
    if (!p.tired) tapHearts(playPorthole());
    sound(SOUNDS.DANCE);
    renderPlay();
    playLoop();
  }
  function endDance() {
    const p = S.play;
    p.dancing = false;
    p.wound = 0;
    p.key = 0;
    p.shown = null;
    $('petPlay').style.transform = '';
    playPorthole().style.transform = '';
    if (!p.tired) tapHearts(playPorthole());
    p.line = p.tired ? 'Phew... a gear would help.' : 'Again! Again!';
    p.loveUntil = Date.now() + AFTER_MS;
    p.lastPlay = Date.now();
    renderPlay();
  }
  // Toss a gear (free and unlimited in Milestone D): one in the air at a time
  function feed() {
    const p = S.play;
    if (S.view !== 'play' || p.dancing || p.gear) return;
    if (S.care) { requestFeed(); return; } // the device owns the gears and decides every feed
    const woke = playNoted();
    toss(woke, false);
  }
  // The gear's flight to the pet and the catch: a free local feed, or a feed the device reports
  function toss(woke, hungry) {
    const p = S.play;
    p.hungryToss = hungry;
    if (!woke) p.line = 'Ooh, a gear!';
    sound(SOUNDS.TOSS);
    const from = $('feedBtn').getBoundingClientRect(), pet = $('petPlay').getBoundingClientRect();
    if (reducedMotion()) { // no flight: the result straight away
      renderPlay();
      setTimeout(caught, 100);
      return;
    }
    const el = document.createElement('span');
    el.className = 'gear-fx';
    document.body.appendChild(el);
    // From the top-centre of the Feed button to 5/8 of the way down the pet (its mouth)
    p.gear = { el, at: Date.now(), frame: -1, sx: from.left + from.width / 2, sy: from.top, ex: pet.left + pet.width / 2, ey: pet.top + pet.height * 5 / 8 };
    renderPlay();
    playLoop();
  }
  function caught() {
    const p = S.play;
    squish($('petPlay'));
    p.line = p.hungryToss ? "Oh, that's better!" : 'Crunchy! Thank you.';
    p.hungryToss = false;
    p.loveUntil = Date.now() + AFTER_MS;
    p.lastPlay = Date.now();
    sound(SOUNDS.CRUNCH);
    renderPlay();
  }
  // Runs while the Playground is open (or a dance or gear is still finishing)
  function playLoop() {
    if (playLoop.on) return;
    playLoop.on = true;
    const step = () => {
      const p = S.play, now = Date.now();
      if (S.view !== 'play' && !p.dancing && !p.gear) { playLoop.on = false; return; }
      if (p.gear) {
        const g = p.gear, t = Math.min(1, (now - g.at) / FLIGHT_MS);
        // A straight line plus an arc 45·sin(180°·t) px upward; the frame swaps every 90/1000 of the flight
        const x = g.sx + (g.ex - g.sx) * t, y = g.sy + (g.ey - g.sy) * t - 45 * Math.sin(Math.PI * t);
        g.el.style.left = Math.round(x - 10.5) + 'px';
        g.el.style.top = Math.round(y - 10.5) + 'px';
        const frame = Math.floor(t / 0.09) % 2;
        if (frame !== g.frame) { g.frame = frame; g.el.innerHTML = GEAR_FRAMES[frame]; }
        if (t >= 1) { g.el.remove(); p.gear = null; caught(); }
      }
      if (p.dancing) {
        const t = now - p.danceAt;
        if (t >= DANCE_MS) endDance();
        else {
          const angle = (t * 360 * (p.tired ? 2 : 3) / DANCE_MS) % 360, rad = angle * Math.PI / 180;
          if (!reducedMotion()) {
            $('petPlay').style.transform = 'scaleX(' + Math.cos(rad).toFixed(3) + ')';
            playPorthole().style.transform = 'translateY(' + (-Math.abs(Math.sin(2 * rad)) * 6).toFixed(1) + 'px)';
          }
          p.key = Math.floor(t / 60) % 4; // the key spins fast
          p.shown = WIND_FULL * (1 - t / DANCE_MS); // the gauge drains over the 3 s
          renderPlay();
        }
      } else if (S.view === 'play') {
        // Left alone 3 s: run down one click every 0.6 s, the key turning back a frame
        if (p.wound > 0 && now - p.lastPlay >= RUN_DOWN_AFTER && now - p.lastRunDown >= RUN_DOWN_EVERY) {
          p.wound--;
          p.key = (p.key + 3) % 4;
          p.lastRunDown = now;
          if (!p.wound) p.line = idleLine();
          renderPlay();
        }
        // 20 s with nobody playing, nothing wound and no gear in the air: asleep
        if (!p.asleep && !p.wound && !p.gear && now - p.lastPlay >= SLEEP_AFTER) {
          p.asleep = true;
          p.line = 'Zzz...';
          renderPlay();
        }
        if (renderPlay.mood !== playMood()) renderPlay(); // love running out
      }
      setTimeout(step, 16); // about 60 fps; unlike rAF it keeps the clocks running in a background tab
    };
    setTimeout(step, 16);
  }
  function wirePlay() {
    $('windGauge').replaceChildren(...Array.from({ length: WIND_FULL }, () => document.createElement('i')));
    const btn = $('windBtn');
    let hold = 0;
    const stop = () => clearTimeout(hold);
    // Hold Wind to repeat; a keyboard press of the button (click with detail 0) is one click
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      wind();
      stop();
      hold = setTimeout(function again() { wind(); hold = setTimeout(again, HOLD_REPEAT); }, HOLD_DELAY);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
    btn.addEventListener('click', (e) => { if (e.detail === 0) wind(); });
    $('feedBtn').addEventListener('click', feed);
    $('playBackBtn').addEventListener('click', goHome);
  }

  // ---------- Wire up ----------
  function init() {
    buildNixie();
    document.querySelectorAll('.porthole').forEach(wirePetting);
    $('goal').value = S.settings.goal || '';
    $('userName').value = S.settings.user || '';
    $('userName').addEventListener('input', (e) => { S.settings.user = e.target.value.slice(0, 16); petChanged(); });
    $('petName').value = S.settings.name;
    $('petName').addEventListener('input', (e) => { S.settings.name = e.target.value.slice(0, 10); petChanged(); });
    $('beginBtn').addEventListener('click', startSession);
    $('sendPetBtn').addEventListener('click', () => { sendConfig(); $('sentNote').textContent = 'Sent. ' + petName() + ' is on the device now.'; });
    $('deviceBtn').addEventListener('click', connectDevice);
    $('peekBtn').addEventListener('click', peek);
    $('pinTimeBtn').addEventListener('click', () => { S.settings.pinTime = !S.settings.pinTime; save(); renderLive(); });
    $('pinScoreBtn').addEventListener('click', () => { S.settings.pinScore = !S.settings.pinScore; save(); renderLive(); });
    $('endBtn').addEventListener('click', () => {
      if (!S.session) return;
      if (S.session.mode === 'focus') endSession(true); else { if (deviceBreak()) send({ t: 'end', scope: 'break' }); S.session = null; show('setup'); renderSetup(); }
    });
    $('startBreakBtn').addEventListener('click', () => { const c = S.lastCard; startBreak(c && c.no === SESSIONS_PER_SET ? longRest(c.study || S.settings.study) : (c ? c.brk : S.settings.brk), c && c.no === SESSIONS_PER_SET); });
    $('skipBreakBtn').addEventListener('click', () => {
      if (deviceBreak()) send({ t: 'end', scope: 'break' });
      if (S.session && S.session.mode === 'break') S.session = null;
      show('setup'); renderSetup();
    });
    $('demoToggle').addEventListener('click', () => {
      const open = $('demoBody').hidden;
      $('demoBody').hidden = !open;
      $('demoToggle').setAttribute('aria-expanded', String(open));
    });
    document.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => demo(b.dataset.demo)));
    document.addEventListener('pointerdown', unlockAudio, true);
    document.addEventListener('keydown', unlockAudio, true);
    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input')) return;
      if (e.key.toLowerCase() === 'd' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        $('demo').hidden = !$('demo').hidden;
        renderSetup(); // the circle switches between real and fake friends
        if (S.view === 'live') renderLive();
        if (S.view === 'card') renderBoard();
        return;
      }
      // Playground: Up, Right and Space are the knob's detents (a focused button handles its own keys)
      if (S.view === 'play' && ['ArrowUp', 'ArrowRight', ' '].includes(e.key) && !e.target.closest('button')) { e.preventDefault(); wind(); return; }
      const map = { y: 'site', i: 'idle', f: 'friend', s: 'fast', e: 'finish' };
      if (map[e.key.toLowerCase()]) demo(map[e.key.toLowerCase()]);
      if (e.key === ' ' && S.view === 'live') { e.preventDefault(); peek(); }
    });
    wireDial();
    $('brandBtn').addEventListener('click', goHome);
    $('homeStartBtn').addEventListener('click', () => toSetup('goal'));
    $('homeNameBtn').addEventListener('click', () => toSetup('userName'));
    $('homePetBtn').addEventListener('click', () => toSetup('petName'));
    $('homePlayBtn').addEventListener('click', openPlay);
    wirePlay();
    $('homeConnectBtn').addEventListener('click', connectDevice);
    setDeviceChip();
    renderSetup();
    show('home');
    renderHome();
    connectHelper();
    setInterval(() => { tick(); linkWatch(); renderReady(); if (S.view === 'home') renderHome(); }, 1000);
    $('readyNextBtn').addEventListener('click', () => { S.readyDismissed = true; send({ t: 'end', scope: 'break' }); renderReady(); });
    $('readyFinishBtn').addEventListener('click', () => {
      S.readyDismissed = true;
      send({ t: 'end', scope: 'session' });
      S.sessionNo = 1; // finishing ends the set
      S.session = null;
      show('setup');
      renderSetup();
      renderReady();
    });
    setInterval(() => { if (S.device.connected) send({ t: 'ping' }); }, 2000);
    $('reconnectBtn').addEventListener('click', () => reconnectDevice(true));
    $('leaveBtn').addEventListener('click', leaveLostSession);
    if ('serial' in navigator) navigator.serial.addEventListener('connect', () => reconnectDevice(false));
  }
  document.addEventListener('DOMContentLoaded', init);
})();
