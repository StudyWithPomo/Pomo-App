/* Study Buddy — laptop dashboard.
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
    settings: Object.assign({ user: 'Sidak', name: 'Mochi', body: 'bot', face: 'plain', color: 'brass', pinTime: false, pinScore: false, study: 25, brk: 5, goal: '' }, store.get('settings', {})),
    progress: Object.assign({ level: 3, xp: 340, hearts: 3 }, store.get('progress', {})),
    sessionNo: 1,
    session: null,
    lastCard: null,
    circle: demoCircle(),
    device: { connected: false, port: null, writer: null },
    dev: null, // latest 'state' message from the device (it owns the clock, XP and level while coupled)
    peekUntil: 0,
    speed: 1,
    idleDetector: null,
    isPetting: false
  };
  const breakRange = (study) => [Math.ceil(study / 5), Math.floor(study / 3)];
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
    for (const v of ['setup', 'live', 'card']) $('view-' + v).hidden = v !== view;
    document.querySelectorAll('.steps span').forEach((el) => {
      if (el.dataset.step === view) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
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

  function renderSetup() {
    const st = S.settings;
    const [bMin, bMax] = breakRange(st.study);
    if (st.brk < bMin || st.brk > bMax) st.brk = bMin;

    $('studyChips').replaceChildren(...STUDY_OPTIONS.map((m) => chip(m + ' min', st.study === m, () => { st.study = m; st.brk = Math.ceil(m / 5); save(); renderSetup(); })));
    const breaks = [];
    for (let b = bMin; b <= bMax; b++) breaks.push(chip(b + 'm', st.brk === b, () => { st.brk = b; save(); renderSetup(); }, 'verd-chip'));
    $('breakChips').replaceChildren(...breaks);
    $('breakRule').textContent = 'Between a fifth and a third of study time: ' + bMin + '–' + bMax + ' min for ' + st.study + ' min.' + (st.study === 25 && st.brk === 5 ? ' Classic Pomodoro.' : '');
    $('beginBtn').textContent = 'Begin · ' + st.study + ' / ' + st.brk + '  ·  Session ' + ROMAN[S.sessionNo - 1] + ' of IV';
    const mult = multiplier();
    $('circleHint').textContent = S.circle.length ? 'Study circle: ' + S.circle.map((f) => f.name).join(' and ') + ' · ' + mult + '× XP' : 'No study circle nearby · 1× XP';

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

  function petChanged() {
    save();
    $('sentNote').textContent = S.device.connected ? 'Changes show on the device after you send them.' : '';
    renderSetup();
  }

  function petOpts(mood) {
    return { body: S.settings.body, face: S.settings.face, color: S.settings.color, level: S.progress.level, mood };
  }
  function drawPets() {
    if (S.lastCard) {
      StudyPet.drawPet($('petCard'), petOpts(S.isPetting ? 'love' : S.lastCard.mood));
    }
    StudyPet.drawPet($('petSetup'), petOpts(currentMood()));
    StudyPet.drawPet($('petLive'), petOpts(currentMood()));
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

  const tubes = [];
  function buildNixie() {
    const box = $('nixie');
    box.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const el = document.createElement('div');
      if (i === 2) { el.className = 'colon'; el.innerHTML = COLON_SVG; box.appendChild(el); continue; }
      el.className = 'tube';
      el.innerHTML = TUBE_SVG + '<span class="glyph ghost"></span><span class="glyph ghost b"></span><span class="glyph lit"></span>';
      box.appendChild(el);
      tubes.push(el);
    }
  }
  function setNixie(sec, lit) {
    const t = mmss(Math.max(0, sec)).replace(':', '');
    tubes.forEach((el, i) => {
      const d = Number(t[i]);
      const [ga, gb, l] = el.querySelectorAll('.glyph');
      ga.textContent = String((d + 3) % 10);
      gb.textContent = String((d + 6) % 10);
      if (l.textContent !== t[i]) l.textContent = t[i];
    });
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
  function multiplier() {
    if (S.device.connected && S.dev) return S.dev.mult;
    const focused = S.circle.filter((f) => f.focused).length;
    if (!S.circle.length) return 1;
    if (focused < S.circle.length) return 1; // bonus pauses while anyone drifts
    return Math.max(1, Math.min(MAX_MULT, S.circle.length));
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
    addLog(0, 'Session ' + ROMAN[S.sessionNo - 1] + ' begun' + (goal ? ': ' + goal : '') + '.');
    requestIdle();
    setCamera(true);
    show('live');
    renderLive();
  }

  function startBreak(minutes, long) {
    // With a device coupled it already runs the break; its state messages drive the countdown.
    if (!(S.device.connected && S.session && S.session.mode === 'break')) {
      S.session = { mode: 'break', total: minutes * 60, left: minutes * 60, long: !!long };
    }
    show('live');
    renderLive();
  }

  function elapsed() { return S.session ? S.session.total - S.session.left : 0; }

  function startDrift(kind, label) {
    const s = S.session;
    if (!s || s.mode !== 'focus') return;
    if (s.drift && s.drift.kind === kind && s.drift.label === label) return;
    if (s.drift) endDrift();
    s.drift = { kind, label, since: elapsed() };
    send({ t: 'drift', active: true, label: String(label).slice(0, 15), kind });
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
    send({ t: 'drift', active: false });
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
    if (S.device.connected) { if (S.view === 'live') renderLive(); return; } // the device owns the countdown
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
      heartDelta, leveled, before, events: s.events.slice(), minutes: minuteKinds(s, true), brk: s.brk, finished: null
    };
    S.session = null;
    S.sessionNo = S.sessionNo % SESSIONS_PER_SET + 1;
    renderCard();
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
    if (S.isPetting && (!s || s.mode === 'break')) return 'love';
    if (!s) return 'happy';
    if (s.mode === 'break') return 'happy';
    if (S.isPetting) return 'shh';
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
    $('circleNote').textContent = !S.circle.length ? 'No friends nearby. Their devices appear here when they start a session.' :
      mult > 1 ? 'The bonus holds while everyone stays focused.' : 'Paused: someone in the circle is drifting.';
    $('friends').replaceChildren(...S.circle.map((f) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="lamp ' + (f.focused ? 'on' : 'off') + '"></span><span class="who"></span><span></span>';
      li.children[1].textContent = f.name;
      li.children[2].textContent = f.focused ? 'Focused' : 'Drifting';
      return li;
    }));
    const coupled = S.device.connected && S.dev;
    const xpNow = coupled ? S.progress.xp : S.progress.xp + Math.floor(s.xpSec ? s.xpSec / 60 : 0);
    $('xpLevel').textContent = petName() + ' · Level ' + S.progress.level;
    $('xpText').textContent = Math.min(xpNow, XP_PER_LEVEL) + ' / ' + XP_PER_LEVEL + ' XP';
    $('xpFill').style.width = Math.min(100, (xpNow / XP_PER_LEVEL) * 100).toFixed(1) + '%';
    const gained = coupled ? Math.max(0, S.dev.xp - (s.xp0 != null ? s.xp0 : S.dev.xp)) : Math.floor((s.xpSec || 0) / 60);
    $('xpSoFar').textContent = s.mode === 'focus' ? '+' + gained + ' XP so far (' + Math.floor(s.focusedSec / 60) + ' focused min × ' + mult + ')' : '';

    $('ledgerPanel').hidden = brk || !showTime;
    if (!brk && showTime) renderLedger(s);
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
    const c = S.lastCard;
    if (!c) return;
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
      '<div class="line"><h2>Time Card</h2><span>No. ' + String(c.no + 1000).slice(1) + '</span></div>' +
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

    const words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
    $('verdict').textContent = c.pct + '% focused.';
    const worst = c.events.slice().sort((a, b) => b.len - a.len)[0];
    const lapses = c.events.length;
    $('verdictSub').textContent = Math.round(c.done / 60) + ' minutes, ' + (lapses ? (words[lapses] || lapses).toLowerCase() + ' lapse' + (lapses > 1 ? 's' : '') : 'no lapses') +
      (c.penalty ? ', and ' + c.penalty + ' XP lost.' : ', ' + c.earned + ' XP' + (c.mult > 1 ? ' with your study circle' : '') + '.') +
      (worst ? ' ' + (worst.kind === 'idle' ? 'Going idle' : worst.label) + ' cost you the most.' : '');

      c.mood = c.pct >= 60 ? 'love' : c.pct >= PENALTY_BELOW ? 'happy' : 'annoyed';
      StudyPet.drawPet($('petCard'), petOpts(c.mood));
      if (c.leveled) levelUpMoment(c);
      $('petVerdict').textContent = c.leveled ? petName() + ' reached Level ' + S.progress.level + '!' + (S.progress.level === 5 ? ' Goggles unlocked.' : S.progress.level === 10 ? ' Bow tie unlocked.' : S.progress.level === 15 ? ' Top hat unlocked.' : '') :
      c.pct >= 80 ? petName() + ' is most proud.' : c.pct >= PENALTY_BELOW ? petName() + ' is content.' : petName() + ' is disappointed, but you keep your level.';
    $('cardLevel').textContent = 'Lv ' + S.progress.level;
    $('cardXp').textContent = S.progress.xp + ' / ' + XP_PER_LEVEL + ' XP';
    $('cardXpFill').style.width = ((S.progress.xp / XP_PER_LEVEL) * 100).toFixed(1) + '%';
    $('cardToNext').textContent = (XP_PER_LEVEL - S.progress.xp) + ' XP to Level ' + (S.progress.level + 1);

    const board = [{ name: 'You', pct: c.pct, me: true }].concat(S.circle.map((f, i) => ({ name: f.name, pct: f.pct != null ? f.pct : [94, 88, 91][i % 3] })));
    board.sort((a, b) => b.pct - a.pct);
    $('board').replaceChildren(...board.map((p) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="who' + (p.me ? ' me' : '') + '"></span><span class="bar"><i style="width:' + p.pct + '%"></i></span><span class="pct">' + p.pct + '%</span>';
      li.firstChild.textContent = p.name;
      return li;
    }));
    $('board').parentElement.hidden = !S.circle.length;

    $('cardGoal').textContent = c.goal;
    renderFinish();
    $('coachNote').textContent = coach(c, worst);

    const long = c.no === SESSIONS_PER_SET;
    $('nextTitle').textContent = long ? 'Long rest · ' + LONG_BREAK + ' minutes' : 'Intermission · ' + c.brk + ' minutes';
    $('nextSub').textContent = long ? 'You finished a full set of four. Step away properly.' : 'Then session ' + ROMAN[S.sessionNo - 1] + ' of IV.' + (S.sessionNo === SESSIONS_PER_SET ? ' After that, a long rest.' : '');
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

  function renderFinish() {
    const c = S.lastCard;
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
      const hay = ((m.url || '') + ' ' + (m.title || '') + ' ' + (m.app || '')).toLowerCase();
      const hit = DISTRACTING.find((d) => hay.includes(d));
      if (hit) startDrift('site', m.label || hit.charAt(0).toUpperCase() + hit.slice(1).replace('.com', ''));
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
    if (S.device.connected) return;
    if (!('serial' in navigator)) { toast('Web Serial needs Chrome or Edge on localhost.'); return; }
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      const enc = new TextEncoderStream();
      enc.readable.pipeTo(port.writable);
      S.device = { connected: true, port, writer: enc.writable.getWriter() };
      S.circle = []; // the real circle arrives from the device
      setDeviceChip();
      renderSetup();
      sendConfig();
      readLoop(port);
    } catch (e) { toast('Could not connect: ' + (e.message || e)); }
  }
  async function readLoop(port) {
    const dec = new TextDecoderStream();
    port.readable.pipeTo(dec.writable).catch(() => {});
    const reader = dec.readable.getReader();
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
          if (line) { try { onDevice(JSON.parse(line)); } catch (e) { /* ignore non-JSON debug prints */ } }
        }
      }
    } catch (e) { /* unplugged */ }
    S.device = { connected: false, port: null, writer: null };
    S.dev = null;
    S.circle = demoCircle(); // back to the local engine and demo circle
    setDeviceChip();
    renderSetup();
    if (S.view === 'live') renderLive();
    toast('Device disconnected.');
  }
  // Outgoing lines are checked against schema/pomo-device.schema.json before they are written:
  // known type, no extra fields, required fields present, and the device drops lines over 256 bytes.
  const OUT = {
    config: { req: [], keys: ['user', 'pet', 'time', 'tz'] },
    start: { req: ['study', 'brk'], keys: ['study', 'brk'] },
    drift: { req: ['active'], keys: ['active', 'label', 'kind'] },
    focus: { req: ['ts', 'focus', 'state', 'reason'], keys: ['ts', 'focus', 'state', 'reason', 'window', 'yaw', 'pitch', 'ear'] },
    peek: { req: [], keys: [] },
    end: { req: [], keys: [] }
  };
  const FOCUS_STATES = ['calibrating', 'focused', 'drifting', 'unfocused'];
  const FOCUS_REASONS = ['absent', 'drowsy', 'looking_away', 'slouching', 'bad_window'];
  function send(obj) {
    const spec = OUT[obj.t];
    const bad = !spec || Object.keys(obj).some((k) => k !== 't' && !spec.keys.includes(k)) || spec.req.some((k) => !(k in obj));
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
    send({ t: 'config', user: String(st.user || '').slice(0, 16), pet, time: Math.floor(Date.now() / 1000), tz: -new Date().getTimezoneOffset() });
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
    send({ t: 'end' });
    clearTimeout(requestDeviceEnd.t);
    requestDeviceEnd.t = setTimeout(() => {
      if (S.session && S.session.mode === 'focus') toast('The device has not confirmed yet. Hold its knob to end the session there.');
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
    applyDeviceProgress(m.xp, m.level);
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
      else if (s.mode === 'break') { s.total = m.total; s.left = m.left; s.long = m.phase === 'long_rest'; }
    } else if (s && s.mode === 'break') { // idle again: the break is over
      S.session = null;
      if (S.view === 'live') { chime(); toast('Intermission over. Ready for the next session?'); show('setup'); renderSetup(); }
    }
    if (S.view === 'live') renderLive();
  }
  function onDeviceEnd(m) {
    clearTimeout(requestDeviceEnd.t);
    if (!S.session || S.session.mode !== 'focus') { // e.g. the page was reloaded mid-session
      const total = m.elapsed_min * 60;
      S.session = Object.assign(newFocusSession(Math.max(1, m.elapsed_min), S.settings.brk, S.settings.goal), { total, left: 0, startedAt: new Date(Date.now() - total * 1000), secs: new Array(total).fill(null) });
    }
    endSession(m.early, m);
  }
  function onDevice(m) {
    switch (m.t) {
      case 'hello': toast('Device says hello (firmware ' + (m.fw || '?') + ').'); sendConfig(); break;
      case 'start': onDeviceStart(m); break;
      case 'state': onDeviceState(m); break;
      case 'end': onDeviceEnd(m); break;
      case 'circle':
        if (Array.isArray(m.friends)) { S.circle = m.friends.map((f) => ({ name: String(f.name).slice(0, 10), focused: !!f.focused, pct: f.pct })); renderSetup(); if (S.view === 'live') renderLive(); }
        break;
    }
  }
  function setDeviceChip() {
    $('deviceLamp').className = 'lamp' + (S.device.connected ? ' on' : '');
    $('deviceText').textContent = S.device.connected ? 'Device coupled · USB' : 'Connect device';
    $('sendPetBtn').disabled = !S.device.connected;
    $('sentNote').textContent = S.device.connected ? '' : 'Connect the device to send.';
  }

  // ---------- Misc ----------
  function peek() {
    if (!S.session || S.session.mode !== 'focus') return;
    send({ t: 'peek' });
    S.peekUntil = Date.now() + 5000;
    renderLive();
    clearTimeout(peek.t);
    peek.t = setTimeout(() => { if (S.view === 'live') renderLive(); }, 5050);
  }
  function chime() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      [660, 880].forEach((f, i) => {
        const o = ac.createOscillator(); const g = ac.createGain();
        o.frequency.value = f; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, ac.currentTime + i * 0.18);
        g.gain.exponentialRampToValueAtTime(0.2, ac.currentTime + i * 0.18 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + i * 0.18 + 0.5);
        o.connect(g).connect(ac.destination); o.start(ac.currentTime + i * 0.18); o.stop(ac.currentTime + i * 0.18 + 0.55);
      });
    } catch (e) { /* audio blocked */ }
  }

  function demo(action) {
    const s = S.session;
    if (S.device.connected && (action === 'fast' || action === 'friend' || action === 'finish')) { toast('The device owns the clock and the circle while it is coupled.'); return; }
    if (action === 'fast') { S.speed = S.speed === 1 ? 30 : 1; toast(S.speed === 1 ? 'Normal speed' : 'Speed ×30'); return; }
    if (action === 'friend') {
      const f = S.circle[1] || S.circle[0];
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

  function spawnHeart(porthole) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const h = document.createElement('span');
    h.innerHTML = HEART_SVG;
    h.className = 'pet-heart';
    h.style.left = (30 + Math.random() * 40) + '%';
    h.style.top = '30%';
    porthole.appendChild(h);
    h.addEventListener('animationend', () => h.remove());
  }

  function wirePetting(porthole) {
    let dist = 0;
    let nextHeartAt = 150;
    let leaveTimer;

    porthole.addEventListener('pointermove', (e) => {
      clearTimeout(leaveTimer);
      dist += Math.abs(e.movementX) + Math.abs(e.movementY);

      if (dist >= 150 && !S.isPetting) {
        S.isPetting = true;
        drawPets();
      }

      if (S.session && S.session.mode === 'focus' && S.isPetting) {
        showBubble(porthole, true);
      }

      if (!(S.session && S.session.mode === 'focus') && (dist >= nextHeartAt)){
        spawnHeart(porthole);
        nextHeartAt += 150;
      }
    });

    porthole.addEventListener('pointerleave', () => {
      locationbareaveTimer = setTimeout(() => {
        dist = 0;
        nextHeartAt = 150;
        S.isPetting = false;
        drawPets();
        showBubble(porthole, false);
      }, 600);
    });
  }

  // ---------- Wire up ----------
  function init() {
    buildNixie();
    document.querySelectorAll('.porthole').forEach(wirePetting);
    $('goal').value = S.settings.goal || '';
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
      if (S.session.mode === 'focus') endSession(true); else { S.session = null; show('setup'); renderSetup(); }
    });
    $('startBreakBtn').addEventListener('click', () => { const c = S.lastCard; startBreak(c && c.no === SESSIONS_PER_SET ? LONG_BREAK : (c ? c.brk : S.settings.brk), c && c.no === SESSIONS_PER_SET); });
    $('skipBreakBtn').addEventListener('click', () => { show('setup'); renderSetup(); });
    $('demoToggle').addEventListener('click', () => {
      const open = $('demoBody').hidden;
      $('demoBody').hidden = !open;
      $('demoToggle').setAttribute('aria-expanded', String(open));
    });
    document.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => demo(b.dataset.demo)));
    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input')) return;
      if (e.key.toLowerCase() === 'd' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        $('demo').hidden = !$('demo').hidden;
        return;
      }
      const map = { y: 'site', i: 'idle', f: 'friend', s: 'fast', e: 'finish' };
      if (map[e.key.toLowerCase()]) demo(map[e.key.toLowerCase()]);
      if (e.key === ' ' && S.view === 'live') { e.preventDefault(); peek(); }
    });
    setDeviceChip();
    show('setup');
    renderSetup();
    connectHelper();
    setInterval(tick, 1000);
  }
  document.addEventListener('DOMContentLoaded', init);
})();
