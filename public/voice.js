/* Voice mode: speak to a session and hear short spoken replies.
   Speech-to-text and text-to-speech run on the Pocket server (local Whisper + Kokoro, see voice.mjs); this file
   records, detects the end of speech, handles a few short commands on the device, and plays replies.
   Uses app.js globals: api, toast, esc, chatId, composerWorking, sendMsg, allSessions, needsAttention.
   Two composer buttons: the mic takes one message (tap or hold); the headset starts a hands-free conversation
   that speaks each reply and listens for the answer. Only that conversation ever reopens the microphone:
   session alerts, approval prompts and the spoken reply to anything else never listen afterwards. */
'use strict';
const Voice = (() => {
  const MIC = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v2.5"/></svg>';
  const HEADSET = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 14.5V12a7.5 7.5 0 0115 0v2.5"/><rect x="3.5" y="13.5" width="4" height="6" rx="1.8"/><rect x="16.5" y="13.5" width="4" height="6" rx="1.8"/><path d="M18.5 19.5c0 1.3-1.6 2-4 2H13"/></svg>';
  const PREF_KEY = 'pc-voice';
  const DEFAULTS = { speak: true, review: false, replyWait: 120, alerts: 'off', voice: 'af_heart', vocab: '' };
  const ALERT_CHOICES = [['off', 'Off'], ['name', 'Session name only'], ['summary', 'Name and a one-line summary']];
  // A tap means you're about to speak, so silence ends it after 10 s. After a spoken reply (hands-free) the mic
  // waits replyWait seconds, so there is time to read the rest of the reply first. MAX_MS limits one utterance.
  const HOLD_MS = 350, END_SILENCE_MS = 1100, NO_SPEECH_MS = 10000, MAX_MS = 60000;
  const WAIT_CHOICES = [[30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes']];
  let status = null, statusLoading = null;
  let state = 'idle', note = '', noteTimer = null;            // idle | listening | holding | transcribing | speaking
  let rec = null, ctx = null, workletReady = false, wakeLock = null;
  let speech = null;                                            // { cancelled, source }
  let handsFree = null, hfStarting = false;                     // session id of the hands-free conversation, if one is on
  const armed = new Set();                                      // sessions whose next finished turn is spoken
  const lastReply = new Map();                                  // sessionId -> markdown of the latest reply
  const announced = new Map();                                  // sessionId -> kinds already announced this turn

  const prefs = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { return { ...DEFAULTS }; } };
  const setPref = (k, v) => { const p = prefs(); p[k] = v; localStorage.setItem(PREF_KEY, JSON.stringify(p)); };

  async function loadStatus(force = false) {
    if (status && !force) return status;
    if (!statusLoading || force) statusLoading = api('/voice/status').catch(() => ({ available: false, reason: 'Could not check voice on the server.' }))
      .then(s => { status = s; statusLoading = null; return s; });
    return statusLoading;
  }

  /* ---------- composer controls ---------- */
  function micHTML() {
    return `<button class="icon voice-mic voice-hf" id="hfb" type="button" hidden aria-pressed="false" aria-label="Hands-free conversation" aria-describedby="voice-strip">${HEADSET}</button>`
      + `<button class="icon voice-mic" id="micb" type="button" hidden aria-pressed="false" aria-label="Voice input" aria-describedby="voice-strip">${MIC}</button>`;
  }
  const inHandsFree = (id = chatId) => Boolean(id) && handsFree === id;
  function bindComposer() {
    const b = document.getElementById('micb'), hf = document.getElementById('hfb'); if (!b) return;
    loadStatus().then(s => { if (b.isConnected) b.hidden = !s.available; if (hf?.isConnected) hf.hidden = !s.available; paint(); });
    if (hf) hf.onclick = () => handsFreeTap();
    document.getElementById('box')?.addEventListener('input', syncDraft);
    let downAt = 0, holdTimer = null;
    b.onpointerdown = e => {
      if (e.button) return;
      downAt = Date.now();
      unlockAudio();
      if (handsFree) { handsFree = null; paint(); }                              // the plain mic is always one message
      if (state === 'idle' || state === 'speaking') holdTimer = setTimeout(() => { holdTimer = null; start('hold'); }, HOLD_MS);
    };
    const up = () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; tap(); }        // short press: a tap
      else if (state === 'holding') finish();                                     // release ends push-to-talk
      downAt = 0;
    };
    b.onpointerup = up;
    b.onpointercancel = () => { if (holdTimer) clearTimeout(holdTimer); holdTimer = null; if (state === 'holding') finish(); };
    b.onclick = e => { if (e.detail === 0) tap(); };                             // keyboard Enter/Space
    paint();
  }
  function tap() {
    if (handsFree) { handsFree = null; paint(); }
    if (state === 'speaking') { stopSpeaking(); return start('auto'); }
    if (state === 'idle') return start('auto');
    if (state === 'listening') return finish();
  }

  // A typed draft turns any voice input into an addition to that draft (nothing is sent), so the headset has
  // nothing to do then; it steps aside and gives the narrow phone composer its width back.
  function syncDraft() {
    const hf = document.getElementById('hfb'), box = document.getElementById('box');
    if (hf) hf.classList.toggle('drafting', Boolean(box?.value.trim()) && !inHandsFree());
  }
  function paint() {
    syncDraft();
    const b = document.getElementById('micb'), hf = document.getElementById('hfb'), strip = document.getElementById('voice-strip');
    const live = state === 'listening' || state === 'holding', conv = inHandsFree();
    if (b) {
      const mine = live && !conv;
      b.setAttribute('aria-pressed', String(mine));
      b.classList.toggle('on', mine);
      b.setAttribute('aria-label', mine ? 'Finish speaking' : state === 'speaking' ? 'Stop reply and speak' : 'Voice input (beta): tap to talk once, hold for push-to-talk');
      b.disabled = state === 'transcribing';
    }
    if (hf) {
      hf.setAttribute('aria-pressed', String(conv));
      hf.classList.toggle('on', conv);
      hf.setAttribute('aria-label', conv ? 'End hands-free conversation' : 'Hands-free conversation (beta): speaks each reply and listens for your answer');
      hf.title = conv ? 'End hands-free' : 'Hands-free conversation';
    }
    if (!strip) return;
    const pre = conv ? 'Hands-free. ' : '';
    const label = { listening: pre + (rec?.reopened && !rec.speechAt ? 'Listening for your reply. Take your time' : conv ? 'Listening. Pause when you’re done' : 'Listening. Tap the mic when you’re done'),
      holding: 'Listening. Release to send', transcribing: pre + 'Transcribing…', speaking: pre + 'Speaking' }[state] || note || (conv ? hfStarting ? 'Hands-free. Starting the mic…' : 'Hands-free is on. Waiting for the reply' : '');
    strip.hidden = !label;
    strip.dataset.state = state;
    strip.innerHTML = label ? `${live ? '<span class="voice-level" aria-hidden="true"><i></i><i></i><i></i></span>' : ''}<span class="voice-label">${esc(label)}</span>${
      live ? '<button class="chip" id="voice-cancel" type="button">Cancel</button>' : state === 'speaking' ? '<button class="chip" id="voice-stop" type="button">Stop</button>'
        : conv && state === 'idle' ? '<button class="chip" id="voice-end" type="button">End hands-free</button>' : ''}` : '';
    const c = document.getElementById('voice-cancel'); if (c) c.onclick = () => cancel();
    const s = document.getElementById('voice-stop'); if (s) s.onclick = () => { handsFree = null; stopSpeaking(); paint(); };
    const e = document.getElementById('voice-end'); if (e) e.onclick = () => endHandsFree('Hands-free is off.');
  }
  // The headset toggles a hands-free conversation for the open session. It never turns on by itself.
  async function handsFreeTap() {
    unlockAudio();
    if (inHandsFree()) return endHandsFree('Hands-free is off.');
    if (!chatId) return;
    if (rec) release();
    handsFree = chatId; hfStarting = true; paint();
    try { await start('auto'); } finally { hfStarting = false; }
    if (!rec && inHandsFree() && state === 'idle') { handsFree = null; paint(); }   // the mic did not start: nothing is on
  }
  function endHandsFree(message) {
    handsFree = null;
    if (rec) release();
    stopSpeaking();
    setState('idle');
    if (message) say(message, 4000);
  }
  function say(message, ms = 5000) { note = message; paint(); clearTimeout(noteTimer); if (ms) noteTimer = setTimeout(() => { note = ''; paint(); }, ms); }
  function setState(next) { state = next; if (next !== 'idle') { note = ''; clearTimeout(noteTimer); } paint(); keepAwake(); }

  /* ---------- audio plumbing ---------- */
  function unlockAudio() { // must run inside a user gesture on iOS/Safari
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch { }
  }
  async function keepAwake() {
    const want = state !== 'idle' || (handsFree && armed.size);
    try {
      if (want && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      else if (!want && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch { }
  }
  function micError(e) {
    if (window.top !== window && (e?.name === 'NotAllowedError' || e?.name === 'SecurityError')) return 'The microphone is blocked in this embedded view. Open Pocket Code directly to use voice.';
    if (e?.name === 'NotAllowedError') return 'Microphone permission is off. Allow it for this site in the browser settings.';
    if (e?.name === 'NotFoundError') return 'No microphone was found.';
    if (!window.isSecureContext) return 'Voice needs HTTPS.';
    return 'The microphone could not start.';
  }

  /* ---------- listening ---------- */
  async function start(mode, { waitMs = NO_SPEECH_MS, reopened = false } = {}) {
    const s = await loadStatus();
    if (!s.available) { toast(s.reason || 'Voice is not available on this server.'); return; }
    if (!chatId) return;
    stopSpeaking();
    unlockAudio();
    if (!ctx || !navigator.mediaDevices?.getUserMedia) { say(micError()); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
    catch (e) { say(micError(e), 8000); return; }
    try {
      if (!workletReady) { await ctx.audioWorklet.addModule('voice-worklet.js?v=39'); workletReady = true; }
      const src = ctx.createMediaStreamSource(stream), node = new AudioWorkletNode(ctx, 'pocket-capture'), sink = ctx.createGain();
      sink.gain.value = 0; src.connect(node); node.connect(sink); sink.connect(ctx.destination);   // a pulled graph keeps the worklet running
      rec = { session: chatId, mode, stream, src, node, sink, chunks: [], rate: ctx.sampleRate, startedAt: Date.now(), waitMs, reopened, handsFree: inHandsFree(),
        floor: null, warm: 0, voiced: 0, speechAt: 0, lastVoiceAt: 0 };
      node.port.onmessage = e => hear(e.data);
      setState(mode === 'hold' ? 'holding' : 'listening');
    } catch { stream.getTracks().forEach(t => t.stop()); say('The microphone could not start.'); }
  }
  function hear({ samples, rms }) {
    const r = rec; if (!r) return;
    r.chunks.push(samples);
    const now = Date.now();
    if (r.warm < 6) { r.floor = r.floor == null ? rms : Math.min(r.floor * 0.7 + rms * 0.3, Math.max(r.floor, rms)); r.warm++; }
    const threshold = Math.max(0.012, (r.floor || 0) * 2.6);
    if (rms > threshold) { r.voiced++; r.lastVoiceAt = now; if (r.voiced >= 3 && !r.speechAt) { r.speechAt = now; if (r.reopened) paint(); } }
    else r.voiced = Math.max(0, r.voiced - 1);
    const strip = document.getElementById('voice-strip');
    if (strip) strip.style.setProperty('--lvl', Math.min(1, rms / Math.max(threshold * 4, 0.05)).toFixed(2));
    if (r.mode !== 'auto') { if (now - r.startedAt > MAX_MS) finish(); return; }
    if (r.speechAt && now - r.lastVoiceAt > END_SILENCE_MS) finish();
    else if (r.speechAt && now - r.speechAt > MAX_MS) finish();
    else if (!r.speechAt && now - r.startedAt > r.waitMs) { const conv = r.handsFree; cancel(); say(conv ? 'Stopped listening. Hands-free is off.' : 'I didn’t hear anything.', conv && r.reopened ? 0 : 5000); }
    else if (!r.speechAt && r.chunks.length > (r.rate * 8) / 2048) r.chunks.splice(0, r.chunks.length - Math.ceil((r.rate * 8) / 2048)); // keep only recent silence
  }
  function release() {
    const r = rec; rec = null; if (!r) return null;
    try { r.node.port.onmessage = null; r.src.disconnect(); r.node.disconnect(); r.sink.disconnect(); } catch { }
    r.stream.getTracks().forEach(t => t.stop());
    return r;
  }
  function cancel() { release(); handsFree = null; setState('idle'); }   // Cancel also ends a hands-free conversation

  // Float32 at the device rate → 16 kHz 16-bit PCM (box-filter downsample; plenty for speech recognition).
  function toPcm16(chunks, rate) {
    const total = chunks.reduce((n, c) => n + c.length, 0), ratio = rate / 16000, out = new Int16Array(Math.floor(total / ratio));
    const all = new Float32Array(total); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    for (let i = 0; i < out.length; i++) {
      const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio)); let sum = 0;
      for (let j = a; j < b && j < total; j++) sum += all[j];
      out[i] = Math.max(-1, Math.min(1, sum / (b - a))) * 32767;
    }
    return out;
  }
  async function finish() {
    const r = release(); if (!r) return;
    if (r.mode === 'auto' && !r.speechAt) { setState('idle'); return; }
    const pcm = toPcm16(r.chunks, r.rate);
    if (pcm.length < 16000 * 0.3) { setState('idle'); say('That was too short to hear.'); return; }
    setState('transcribing');
    let text = '';
    try {
      const res = await fetch('/api/voice/transcribe', { method: 'POST', body: pcm.buffer,
        headers: { 'Content-Type': 'application/octet-stream', 'X-Vocabulary': vocabulary() } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Transcription failed.');
      text = (j.text || '').trim();
    } catch (e) { setState('idle'); say(e.message || 'Transcription failed.', 8000); return; }
    setState('idle');
    const left = r.waitMs - (Date.now() - r.startedAt);
    if (r.handsFree && inHandsFree(r.session) && (!text || VoiceText.isNoise(text, pcm.length / 16000)) && left > 2000 && r.session === chatId) return start('auto', { waitMs: left, reopened: r.reopened });
    if (!text) { if (r.handsFree) handsFree = null; say(r.handsFree ? 'I didn’t catch that. Hands-free is off.' : 'I didn’t catch that.'); return; }
    if (r.session !== chatId) { handsFree = null; say('You switched sessions, so that wasn’t sent.'); return; }
    await handle(text);
  }
  function replyWaitMs() { const s = Number(prefs().replyWait); return (WAIT_CHOICES.some(([v]) => v === s) ? s : DEFAULTS.replyWait) * 1000; }
  function vocabulary() {
    const own = prefs().vocab, names = (allSessions || []).slice(0, 12).map(s => s.title || '').join(', ');
    return `Pocket Code, Claude, Codex. ${own} ${names}`.replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').slice(0, 400);
  }

  /* ---------- what was said ---------- */
  async function handle(text) {
    const kind = VoiceText.intent(text), id = chatId;
    if (kind) { say(`Heard: “${text}”`, 4000); return command(kind, id); }
    const p = prefs();
    const box = document.getElementById('box');
    // Review mode, or a typed draft already in the box: add the words to the draft and let the user send it.
    // Never send a half-written draft on the user's behalf.
    const draft = box?.value.trim();
    if (p.review || draft || !box || box.readOnly) {
      handsFree = null;                                          // nothing is sent, so there is no reply to listen after
      if (box && !box.readOnly) { box.value = draft ? `${draft} ${text}` : text; box.dispatchEvent(new Event('input')); box.focus(); }
      say(box?.readOnly ? `Heard: “${text}”. Resolve the pending message first.` : draft ? 'Added to your draft. Review it, then send.' : 'Review the text, then send it.', 6000);
      return;
    }
    say(`Sent: “${text}”`, 5000);
    if (p.speak || inHandsFree(id)) arm(id);
    await sendMsg(text);
  }
  function arm(id) { armed.add(id); announced.delete(id); keepAwake(); }

  // Quick answers keep a hands-free conversation going.
  async function command(kind, id) {
    const speak = text => speakOut(text, { listenAfter: inHandsFree(id) });
    if (kind === 'quiet') { handsFree = null; stopSpeaking(); return paint(); }
    if (kind === 'stop') {
      if (!composerWorking) return speak('Nothing is running in this session.');
      armed.delete(id);
      try { await api(`/session/${id}/stop`, { method: 'POST', body: '{}' }); return speak('Stopped.'); }
      catch (e) { return speak('I couldn’t stop it. ' + (e.message || '')); }
    }
    if (kind === 'status') {
      if (composerWorking) {
        const step = latestStep();
        return speak(step ? `It’s working. Latest step: ${step}.` : 'It’s working on the server.');
      }
      const s = replySummary(id);
      return speak(s ? `It isn’t running right now. Its last reply: ${s}` : 'It isn’t running right now.');
    }
    if (kind === 'read' || kind === 'readAll') {
      const md = replyText(id);
      if (!md) return speak('There’s no reply to read yet.');
      return speak(kind === 'readAll' ? VoiceText.speakable(md).slice(0, 2500) : VoiceText.summary(md));
    }
    if (kind === 'waiting') {
      const here = [!document.getElementById('approvals-open')?.hidden && 'this session needs an approval', !document.getElementById('questions-open')?.hidden && 'this session has a question'].filter(Boolean);
      const others = (allSessions || []).filter(s => s.id !== id && needsAttention(s)).map(s => s.title || 'an untitled session').slice(0, 4);
      if (!here.length && !others.length) return speak('Nothing is waiting on you.');
      return speak([here.length ? cap(here.join(' and ')) + '.' : '', others.length ? `${others.length === 1 ? 'One other session needs you' : `${others.length} other sessions need you`}: ${others.join(', ')}.` : ''].join(' ').trim());
    }
  }
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  function latestStep() {
    const lines = document.querySelectorAll('#msgs .ledger'); const l = lines[lines.length - 1]; if (!l) return '';
    return VoiceText.stepText(l.querySelector('.name')?.textContent, l.querySelector('.det')?.textContent);
  }
  function replyText(id) {
    if (lastReply.get(id)) return lastReply.get(id);
    const all = document.querySelectorAll('#msgs .m-asst:not(.live)'); const m = all[all.length - 1]; if (!m) return '';
    const c = m.cloneNode(true); c.querySelectorAll('.copybtn,.ledgerwrap,pre,table,.todo,.todos').forEach(n => n.remove());
    return (c.innerText || c.textContent || '').trim();
  }
  const replySummary = id => { const t = replyText(id); return t ? VoiceText.summary(t) : ''; };

  /* ---------- speaking ---------- */
  async function speakOut(text, { listenAfter = false } = {}) {
    stopSpeaking();
    const parts = VoiceText.chunks(text); if (!parts.length) return;
    unlockAudio(); if (!ctx) { say(text, 8000); return; }
    if (ctx.state !== 'running') { try { await Promise.race([ctx.resume(), new Promise(r => setTimeout(r, 400))]); } catch { } }
    if (ctx.state !== 'running') { say('Tap anywhere to turn on spoken replies and alerts.', 8000); return false; } // browsers need one tap first
    const me = speech = { cancelled: false, source: null };
    setState('speaking');
    const fetchPart = t => fetch('/api/voice/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: t, voice: prefs().voice }) })
      .then(r => { if (!r.ok) throw new Error('speak'); return r.arrayBuffer(); }).then(b => ctx.decodeAudioData(b));
    try {
      let next = fetchPart(parts[0]);
      for (let i = 0; i < parts.length && !me.cancelled; i++) {
        const buf = await next;
        if (i + 1 < parts.length) { next = fetchPart(parts[i + 1]); next.catch(() => {}); } // fetch ahead while this part plays
        if (me.cancelled) break;
        await new Promise(done => { const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.onended = done; me.source = src; src.start(); });
      }
    } catch { if (!me.cancelled) say('The reply could not be spoken. It’s on screen.', 6000); }
    // Listening again needs both: a caller that asked for it (a reply, never an alert) and a hands-free
    // conversation still on for the open session.
    if (speech === me) { speech = null; setState('idle'); if (!me.cancelled && listenAfter && inHandsFree()) start('auto', { waitMs: replyWaitMs(), reopened: true }); }
    return true;
  }
  // Any tap or click anywhere unlocks audio for later alerts (browser autoplay rules).
  document.addEventListener('pointerdown', () => unlockAudio(), { capture: true, passive: true });
  function stopSpeaking() {
    const s = speech; speech = null; if (!s) return;
    s.cancelled = true; try { s.source?.stop(); } catch { }
    if (state === 'speaking') setState('idle');
  }

  /* ---------- session events (called from app.js) ---------- */
  function onAssistant(id, msg) {
    const text = (msg?.blocks || []).filter(b => b.t !== 'tool' && b.t !== 'todo' && b.text).map(b => b.text).join('\n\n').trim();
    if (text) lastReply.set(id, text);
  }
  function onTurnEnd(id, ok, error) {
    announced.delete(id);
    if (!armed.has(id)) return;
    if (ok === false && /stopped by you/i.test(error || '')) { armed.delete(id); keepAwake(); return; }
    armed.delete(id); keepAwake();
    const conv = inHandsFree(id);
    if (id !== chatId || (!prefs().speak && !conv)) return;
    spokenTurnEnd.set(id, Date.now());                         // its spoken reply stands in for the alert
    const md = lastReply.get(id) || replyText(id);
    const line = ok === false ? 'The turn didn’t finish. Details are on screen.' : md ? VoiceText.summary(md) : 'It finished.';
    speakOut(line, { listenAfter: conv });                     // only a hands-free conversation listens after a reply
  }
  /* ---------- spoken alerts: any session finishing or needing you, while Pocket is open ---------- */
  const spokenTurnEnd = new Map(), seen = new Map(), queue = [];
  let baselined = false;
  const alertMode = () => (status?.available && ALERT_CHOICES.some(([v]) => v === prefs().alerts)) ? prefs().alerts : 'off';
  function replacesChime() { return alertMode() !== 'off'; }
  // Cross-tab dedupe: two Pocket tabs (or Mission Control plus standalone) say each event once.
  function claim(key) {
    let m = {}; try { m = JSON.parse(localStorage.getItem('pc-voice-alerted') || '{}'); } catch { }
    if (m[key]) return false;
    const now = Date.now(); m[key] = now;
    for (const k of Object.keys(m)) if (now - m[k] > 86400000) delete m[k];
    try { localStorage.setItem('pc-voice-alerted', JSON.stringify(m)); } catch { }
    return true;
  }
  function onSessions(list) {
    if (typeof PANE !== 'undefined' && PANE) return;             // split panes: only the main window speaks
    if (!status) { loadStatus(); return; }
    const mode = alertMode(), first = !baselined;
    baselined = true;
    for (const s of list || []) {
      const st = s.state || {}, prev = seen.get(s.id);
      seen.set(s.id, { kind: st.kind, at: st.at || 0, approvals: st.approvals || 0, questions: st.questions || 0 });
      if (first || mode === 'off' || s.muted) continue;
      let kind = null;
      // Compare with the previous check, not clocks: device and server time can differ.
      if (['finished', 'failed', 'ended'].includes(st.kind) && st.at && st.at !== prev?.at) kind = st.kind === 'finished' ? 'finished' : 'failed';
      else if (st.kind === 'input' && (prev?.kind !== 'input' || (st.approvals || 0) > prev.approvals || (st.questions || 0) > prev.questions)) kind = 'input';
      if (!kind) continue;
      if (kind === 'finished' && Date.now() - (spokenTurnEnd.get(s.id) || 0) < 60000) continue;
      if (!claim(`${s.id}|${kind}|${st.at || ''}|${st.approvals || 0}|${st.questions || 0}`)) continue;
      announce({ id: s.id, title: s.title, kind, approvals: st.approvals || 0 }, mode);
    }
  }
  async function announce(ev, mode) {
    let reply = '';
    if (ev.kind === 'finished' && mode === 'summary') {
      try { const d = await api(`/session/${encodeURIComponent(ev.id)}`, { signal: AbortSignal.timeout(8000) });
        const m = [...(d.messages || [])].reverse().find(x => x.role === 'assistant');
        reply = (m?.blocks || []).filter(b => b.t !== 'tool' && b.t !== 'todo' && b.text).map(b => b.text).join('\n\n'); } catch { }
    }
    queue.push(VoiceText.alertText({ ...ev, reply }, mode));
    drain();
  }
  // Alerts wait their turn: never over you speaking, a recording, or another reply. They never listen afterwards.
  let audioLocked = false;
  async function drain() {
    if (!queue.length || audioLocked || state !== 'idle' || speech || rec) return;
    const text = queue.shift();
    if (await speakOut(text) === false) { queue.unshift(text); audioLocked = true; } // keep it until the next tap
  }
  document.addEventListener('pointerdown', () => { if (audioLocked) { audioLocked = false; setTimeout(drain, 300); } }, { capture: true, passive: true });
  setInterval(() => {
    drain();
    // A hidden tab stops the list's own 5 s refresh; keep checking when alerts are on.
    if (alertMode() !== 'off' && document.visibilityState !== 'visible' && !document.querySelector('.login') && typeof refreshSessions === 'function') refreshSessions();
  }, 8000);
  setInterval(() => { if (queue.length) drain(); }, 700);

  function onIdle(id) { if (armed.delete(id)) keepAwake(); } // stopped or ended without a result: nothing to read
  function onAttention(id, kind) {
    if (!armed.has(id) || id !== chatId) return;
    setTimeout(() => {
      const banner = document.getElementById(kind === 'approvals' ? 'approvals-open' : 'questions-open');
      if (!banner || banner.hidden) return;
      const seen = announced.get(id) || new Set(); if (seen.has(kind)) return;
      seen.add(kind); announced.set(id, seen);
      speakOut(kind === 'approvals' ? 'It needs your approval. Review it on screen.' : 'It has a question for you on screen.');
    }, 800);
  }
  function onLeave() { handsFree = null; if (rec) cancel(); stopSpeaking(); paint(); }

  /* ---------- settings ---------- */
  function settingsHTML() {
    const p = prefs();
    const toggle = (id, on, title, sub) => `<button class="opt" id="${id}" aria-pressed="${on}"><span class="dot ${on ? 'on' : ''}"></span><span>${title}<span class="sub">${sub}</span></span></button>`;
    return `<details class="settings-details" id="s-voice"><summary>Voice (beta)</summary>
      <div class="voice-settings">
        <p id="s-voice-state" role="status">Checking voice on the server…</p>
        ${toggle('s-voice-speak', p.speak, 'Speak replies', 'Read a short summary aloud when a turn you started by voice finishes')}
        ${toggle('s-voice-review', p.review, 'Review before sending', 'Put what you said in the message box instead of sending it')}
        <label class="voice-field">Announce sessions<select id="s-voice-alerts">${ALERT_CHOICES.map(([v, l]) => `<option value="${v}"${p.alerts === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <p class="sub">Says when any session finishes or needs you, while Pocket is open, in place of the chime. Muted sessions stay quiet.</p>
        <label class="voice-field">Hands-free: wait for my reply<select id="s-voice-wait">${WAIT_CHOICES.map(([v, l]) => `<option value="${v}"${Number(p.replyWait) === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="voice-field">Voice<select id="s-voice-voice"></select></label>
        <label class="voice-field">Names and terms to recognize<input id="s-voice-vocab" type="text" autocomplete="off" spellcheck="false" placeholder="MemStem, TechPro, Zoho" value="${esc(p.vocab)}"></label>
        <button class="chip" id="s-voice-test" type="button">Play a sample</button>
        <p class="sub">Tap the mic to send one message; it sends when you pause. Hold it for push-to-talk. Tap the headset for a hands-free conversation: each reply is spoken and the mic listens for your answer, until you end it or stay quiet. Announcements never turn on the mic. Say “what’s it doing”, “stop”, “read it” or “what’s waiting on me” for quick answers. Speech is processed on your Pocket server.</p>
        <p class="sub">Voice is in beta and still improving. Report problems under Bugs &amp; feature requests.</p>
      </div></details>`;
  }
  function bindSettings(root) {
    const flip = (sel, key) => { const b = root.querySelector(sel); if (!b) return; b.onclick = () => { const on = !prefs()[key]; setPref(key, on); b.setAttribute('aria-pressed', String(on)); b.querySelector('.dot').classList.toggle('on', on); }; };
    flip('#s-voice-speak', 'speak'); flip('#s-voice-review', 'review');
    const vocab = root.querySelector('#s-voice-vocab'); if (vocab) vocab.onchange = () => setPref('vocab', vocab.value.trim().slice(0, 300));
    const wait = root.querySelector('#s-voice-wait'); if (wait) wait.onchange = () => setPref('replyWait', Number(wait.value));
    const alerts = root.querySelector('#s-voice-alerts'); if (alerts) alerts.onchange = () => { setPref('alerts', alerts.value); unlockAudio(); };
    loadStatus(true).then(s => {
      const st = root.querySelector('#s-voice-state'), sel = root.querySelector('#s-voice-voice'), test = root.querySelector('#s-voice-test');
      if (!st) return;
      st.textContent = s.available ? 'Voice is available on this server.' : s.reason || 'Voice is not available on this server.';
      root.querySelectorAll('#s-voice .opt, #s-voice-voice, #s-voice-alerts, #s-voice-wait, #s-voice-vocab, #s-voice-test').forEach(el => { el.disabled = !s.available; });
      if (sel) { sel.innerHTML = (s.voices || [{ id: 'af_heart', label: 'American female' }]).map(v => `<option value="${esc(v.id)}">${esc(v.label)}</option>`).join(''); sel.value = prefs().voice; sel.onchange = () => setPref('voice', sel.value); }
      if (test) test.onclick = () => { unlockAudio(); speakOut('This is how spoken replies will sound in Pocket Code.'); };
      document.querySelectorAll('#micb, #hfb').forEach(b => { b.hidden = !s.available; });
    });
  }

  return { micHTML, bindComposer, paint, onAssistant, onTurnEnd, onIdle, onSessions, replacesChime, onAttention, onLeave, settingsHTML, bindSettings, speak: speakOut, stopSpeaking, _test: { toPcm16, handsFree: () => handsFree, setHandsFree: id => { handsFree = id; paint(); }, arm: id => armed.add(id), state: () => state } };
})();
