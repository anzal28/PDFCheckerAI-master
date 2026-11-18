'use strict';
const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const SEG_MS = 30000;

let me = null, notes = [], cur = null, tab = 'summary';
let recording = false, stream = null, mr = null, segTimer = null, wake = null, chain = Promise.resolve();

async function api(path, opt = {}) {
  const r = await fetch('/api' + path, opt);
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/login') { me = null; showLogin(); throw new Error('Signed out'); }
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const jput = (p, b) => api(p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const saveNote = n => { n.updated = Date.now(); return jput('/notes/' + n.id, n).catch(() => {}); };

function view(v) {
  for (const id of ['login', 'list', 'editor']) $('#' + id).classList.toggle('hidden', id !== v);
  $('#fab').classList.toggle('hidden', v !== 'list');
  $('#back').classList.toggle('hidden', v !== 'editor');
  for (const id of ['who', 'spend', 'logout']) $('#' + id).classList.toggle('hidden', v === 'login');
  $('#title').textContent = v === 'editor' ? 'Meeting' : 'Jotter';
}
function showLogin() { view('login'); }

async function boot() {
  try { me = await api('/me'); } catch { return showLogin(); }
  $('#who').textContent = me.user; renderSpend();
  notes = await api('/notes'); renderList(); view('list');
}
function renderSpend() { $('#spend').textContent = `$${me.spent.toFixed(3)} / $${me.cap}`; }
async function refreshSpend() { try { me = await api('/me'); renderSpend(); } catch {} }

function renderList() {
  const box = $('#notes'); box.innerHTML = '';
  $('#empty').classList.toggle('hidden', notes.length > 0);
  [...notes].sort((a, b) => b.updated - a.updated).forEach(n => {
    const d = document.createElement('div'); d.className = 'card';
    const b = document.createElement('b'); b.textContent = n.title || 'Untitled meeting';
    const m = document.createElement('span'); m.className = 'muted';
    m.textContent = new Date(n.updated).toLocaleString();
    d.append(b, m); d.onclick = () => openNote(n); box.append(d);
  });
}

function setTab(t) {
  tab = t;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('#tSummary').classList.toggle('hidden', t !== 'summary');
  $('#tTranscript').classList.toggle('hidden', t !== 'transcript');
}
function paint() {
  if (!cur) return;
  $('#mtitle').textContent = cur.title || 'New meeting';
  $('#tSummary').textContent = cur.summary || 'The summary appears here after you stop recording.';
  $('#tTranscript').textContent = cur.transcript || 'The transcript appears here every ~30 seconds while recording.';
}
function openNote(n) { cur = n; $('#status').textContent = ''; paint(); setTab(n.summary ? 'summary' : 'transcript'); view('editor'); }
const status = t => { $('#status').textContent = t; };

/* ---- Recording: 30s segments uploaded to the server for Whisper ---- */
const pickMime = () => ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';

async function toggleRec() {
  if (recording) return stopRec();
  if (!window.MediaRecorder || !navigator.mediaDevices) return status('Recording needs a modern browser over HTTPS.');
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return status('Microphone permission denied.'); }
  try { wake = await navigator.wakeLock?.request('screen'); } catch {}
  recording = true; setRec(true); setTab('transcript'); nextSeg();
}
function setRec(on) { const b = $('#rec'); b.classList.toggle('live', on); b.textContent = on ? '■ Stop' : '● Record'; }

function nextSeg() {
  if (!recording) return;
  const note = cur, mime = pickMime(), chunks = [], t0 = Date.now();
  const rec = mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
    queueSeg(note, blob, (Date.now() - t0) / 1000);
    if (recording) nextSeg();
    else { stream.getTracks().forEach(t => t.stop()); wake?.release?.(); setRec(false); finish(note); }
  };
  rec.start(); segTimer = setTimeout(() => rec.state === 'recording' && rec.stop(), SEG_MS);
}
function stopRec() { recording = false; clearTimeout(segTimer); if (mr && mr.state === 'recording') mr.stop(); }

function queueSeg(note, blob, dur) {
  const seg = { id: uid(), dur, done: false, text: '' };
  note.segs = note.segs || []; note.segs.push(seg); saveNote(note);
  chain = chain.then(() => send(note, seg, '/transcribe', blob));
}
async function send(note, seg, ep, blob) {
  try {
    const j = await api(`${ep}?note=${note.id}&seg=${seg.id}&dur=${seg.dur.toFixed(1)}`, { method: 'POST', headers: blob ? { 'Content-Type': blob.type } : {}, body: blob });
    seg.done = true; seg.text = j.text; rebuild(note); refreshSpend();
  } catch (e) { status('Transcription failed – tap Retry. ' + e.message); }
}
function rebuild(note) {
  note.transcript = note.segs.filter(s => s.done && s.text).map(s => s.text).join(' ');
  saveNote(note); if (cur === note) paint();
}
async function retry() {
  if (!cur || recording) return; const note = cur;
  for (const s of (note.segs || []).filter(s => !s.done)) chain = chain.then(() => send(note, s, '/retry'));
  await chain; await finish(note);
}

/* ---- Auto summary once recording ends (no manual notes needed) ---- */
async function finish(note) {
  await chain;
  if ((note.segs || []).some(s => !s.done) || !note.transcript) return;
  status('Writing summary…');
  try {
    const j = await api('/enhance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: note.transcript }) });
    note.summary = j.summary; if (j.title) note.title = j.title;
    await saveNote(note); if (cur === note) { paint(); setTab('summary'); } status('Done.'); refreshSpend();
  } catch (e) { status('Summary failed – tap Retry. ' + e.message); }
}

/* ---- wiring ---- */
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); $('#lErr').textContent = '';
  try { await api('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: $('#lUser').value, pass: $('#lPass').value }) }); $('#lPass').value = ''; boot(); }
  catch (err) { $('#lErr').textContent = err.message; }
};
$('#logout').onclick = async () => { if (recording) stopRec(); await fetch('/api/logout', { method: 'POST' }); me = null; notes = []; cur = null; showLogin(); };
$('#fab').onclick = async () => {
  cur = { id: uid(), title: '', transcript: '', summary: '', segs: [], updated: Date.now() };
  notes.push(cur); await saveNote(cur); paint(); setTab('transcript'); view('editor'); toggleRec();
};
$('#back').onclick = () => { if (recording) stopRec(); renderList(); view('list'); };
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
$('#rec').onclick = toggleRec;
$('#retry').onclick = async () => {
  if (!cur) return; await retry();
  if (!cur.summary && cur.transcript) await finish(cur);
};
$('#copy').onclick = async () => { try { await navigator.clipboard.writeText(tab === 'summary' ? cur.summary : cur.transcript); status('Copied.'); } catch { status('Copy failed.'); } };
$('#del').onclick = async () => {
  if (!confirm('Delete this meeting and its audio?')) return;
  await api('/notes/' + cur.id, { method: 'DELETE' }); notes = notes.filter(n => n !== cur); cur = null; renderList(); view('list');
};

boot();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
