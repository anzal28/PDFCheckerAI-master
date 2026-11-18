'use strict';
const $ = s => document.querySelector(s);
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const DEFAULTS = { tbase: 'https://api.groq.com/openai/v1', tmodel: 'whisper-large-v3-turbo', tkey: '', pwh: 0.04, base: 'https://openrouter.ai/api/v1', model: '', key: '', pin: 0.2, pout: 0.4, cap: 2 };
let cfg = { ...DEFAULTS, ...load('cfg', {}) };
let spent = load('spent', 0);
let notes = load('notes', []);
let cur = null, tab = 'notes', recog = null, recording = false;

const money = n => '$' + n.toFixed(4);
const persist = () => save('notes', notes);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function renderSpend() { $('#spend').textContent = `${money(spent)} / $${cfg.cap}`; }

function renderList() {
  const box = $('#notes'); box.innerHTML = '';
  $('#empty').classList.toggle('hidden', notes.length > 0);
  [...notes].sort((a, b) => b.updated - a.updated).forEach(n => {
    const d = document.createElement('div'); d.className = 'card';
    const b = document.createElement('b'); b.textContent = n.title || 'Untitled meeting';
    const m = document.createElement('span'); m.className = 'muted';
    m.textContent = new Date(n.updated).toLocaleString() + (n.enhanced ? ' · enhanced' : '');
    d.append(b, m); d.onclick = () => openNote(n.id); box.append(d);
  });
}

function show(view) {
  $('#list').classList.toggle('hidden', view !== 'list');
  $('#editor').classList.toggle('hidden', view !== 'editor');
  $('#fab').classList.toggle('hidden', view !== 'list');
  $('#back').classList.toggle('hidden', view !== 'editor');
  $('#title').textContent = view === 'list' ? 'Jotter' : 'Meeting';
}

function setTab(t) {
  tab = t;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('#tNotes').classList.toggle('hidden', t !== 'notes');
  $('#tTranscript').classList.toggle('hidden', t !== 'transcript');
  $('#tEnhanced').classList.toggle('hidden', t !== 'enhanced');
}

function openNote(id) {
  cur = notes.find(n => n.id === id);
  $('#mtitle').value = cur.title; $('#tNotes').value = cur.notes;
  $('#tTranscript').value = cur.transcript; $('#tEnhanced').textContent = cur.enhanced || 'Nothing enhanced yet.';
  $('#status').textContent = ''; setTab(cur.enhanced ? 'enhanced' : 'notes'); show('editor');
}

function newNote() {
  const n = { id: uid(), title: '', notes: '', transcript: '', enhanced: '', updated: Date.now() };
  notes.push(n); persist(); openNote(n.id); $('#mtitle').focus();
}

function sync() {
  if (!cur) return;
  cur.title = $('#mtitle').value; cur.notes = $('#tNotes').value;
  cur.transcript = $('#tTranscript').value; cur.updated = Date.now(); persist();
}

/* ---- Recording + Whisper transcription (chunked, retryable, audio kept in IndexedDB) ---- */
const SEG_MS = 30000;
let stream = null, mr = null, segTimer = null, segStart = 0, wake = null, chain = Promise.resolve();
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('jotter', 1); r.onupgradeneeded = () => r.result.createObjectStore('a'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbPut = async (k, v) => { const d = await idb(); return new Promise(res => { const t = d.transaction('a', 'readwrite'); t.objectStore('a').put(v, k); t.oncomplete = res; t.onerror = res; }); };
const idbGet = async k => { const d = await idb(); return new Promise(res => { const q = d.transaction('a').objectStore('a').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); };
const idbRemove = async k => { const d = await idb(); return new Promise(res => { const t = d.transaction('a', 'readwrite'); t.objectStore('a')['delete'](k); t.oncomplete = res; t.onerror = res; }); };

function pickMime() { return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || ''; }

async function toggleRec() {
  if (recording) return stopRec();
  if (!cfg.tkey) { fillSettings(); $('#settings').showModal(); return; }
  if (!window.MediaRecorder || !navigator.mediaDevices) { $('#status').textContent = 'Recording is not supported in this browser (needs HTTPS).'; return; }
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { $('#status').textContent = 'Microphone permission denied.'; return; }
  try { wake = await navigator.wakeLock?.request('screen'); } catch {}
  recording = true; setRec(true); setTab('transcript'); nextSeg();
}

function nextSeg() {
  if (!recording) return;
  const mime = pickMime(); const chunks = [];
  const note = cur;
  mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const rec = mr; segStart = Date.now();
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const dur = (Date.now() - segStart) / 1000;
    const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
    queueSeg(note, blob, dur);
    if (recording) nextSeg(); else { stream.getTracks().forEach(t => t.stop()); wake?.release?.(); setRec(false); }
  };
  rec.start(); segTimer = setTimeout(() => rec.state === 'recording' && rec.stop(), SEG_MS);
}
function stopRec() { recording = false; clearTimeout(segTimer); if (mr && mr.state === 'recording') mr.stop(); }

async function queueSeg(note, blob, dur) {
  const seg = { k: note.id + ':' + uid(), dur, done: false, text: '' };
  note.segs = note.segs || []; note.segs.push(seg); persist();
  await idbPut(seg.k, blob);
  chain = chain.then(() => transcribeSeg(note, seg));
}

async function transcribeSeg(note, seg) {
  const cost = Math.max(seg.dur, 10) / 3600 * cfg.pwh;
  if (spent + cost > cfg.cap) { $('#status').textContent = `Transcription paused: $${cfg.cap} budget reached. Audio is saved.`; return false; }
  const blob = await idbGet(seg.k); if (!blob) return false;
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  const fd = new FormData(); fd.append('file', blob, `seg.${ext}`); fd.append('model', cfg.tmodel);
  try {
    const r = await fetch(cfg.tbase.replace(/\/$/, '') + '/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.tkey }, body: fd });
    const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || r.statusText);
    spent += cost; save('spent', spent); renderSpend();
    seg.done = true; seg.text = (j.text || '').trim(); rebuildTranscript(note); return true;
  } catch (e) { $('#status').textContent = 'Transcription failed (use Retry): ' + e.message; return false; }
}

function rebuildTranscript(note) {
  note.transcript = (note.segs || []).filter(s => s.done && s.text).map(s => s.text).join(' ');
  if (cur === note) $('#tTranscript').value = note.transcript;
  persist();
}
async function retryPending() {
  if (!cur) return;
  const note = cur;
  for (const s of (note.segs || []).filter(s => !s.done)) { chain = chain.then(() => transcribeSeg(note, s)); }
  await chain;
}
function setRec(on) { const b = $('#rec'); b.classList.toggle('live', on); b.textContent = on ? '■ Stop' : '● Record'; }

/* ---- LLM with hard budget cap ---- */
const estTokens = s => Math.ceil(s.length / 3.5);
async function enhance() {
  if (recording) stopRec();
  $('#status').textContent = 'Finishing transcription…'; await new Promise(r => setTimeout(r, 400)); await chain;
  sync();
  if (!cfg.key || !cfg.model) { $('#settings').showModal(); return; }
  const prompt = `You are a meeting-notes assistant. Combine the user's rough notes with the transcript into clean, structured notes.\nUse sections: Summary, Key points, Decisions, Action items (with owners if known). Keep the user's own notes' emphasis. Don't invent facts.\n\n## My notes\n${cur.notes || '(none)'}\n\n## Transcript\n${cur.transcript || '(none)'}`;
  const maxOut = 1200;
  const worst = estTokens(prompt) / 1e6 * cfg.pin + maxOut / 1e6 * cfg.pout;
  if (spent + worst > cfg.cap) { $('#status').textContent = `Blocked: would exceed your $${cfg.cap} budget (spent ${money(spent)}).`; return; }
  $('#status').textContent = 'Enhancing…'; $('#enhance').disabled = true;
  try {
    const r = await fetch(cfg.base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxOut, messages: [{ role: 'user', content: prompt }] })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || r.statusText);
    const u = j.usage || {};
    const inT = u.prompt_tokens ?? estTokens(prompt), outT = u.completion_tokens ?? maxOut;
    spent += inT / 1e6 * cfg.pin + outT / 1e6 * cfg.pout; save('spent', spent); renderSpend();
    cur.enhanced = j.choices[0].message.content; sync();
    $('#tEnhanced').textContent = cur.enhanced; setTab('enhanced'); $('#status').textContent = 'Done.';
  } catch (e) { $('#status').textContent = 'Error: ' + e.message; }
  $('#enhance').disabled = false;
}

/* ---- wiring ---- */
$('#fab').onclick = newNote;
$('#back').onclick = () => { if (recording) toggleRec(); sync(); show('list'); renderList(); };
['#mtitle', '#tNotes', '#tTranscript'].forEach(s => $(s).addEventListener('input', sync));
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
$('#rec').onclick = toggleRec;
$('#retry').onclick = retryPending;
$('#enhance').onclick = enhance;
$('#copy').onclick = async () => {
  const t = tab === 'enhanced' ? cur.enhanced : tab === 'transcript' ? cur.transcript : cur.notes;
  try { await navigator.clipboard.writeText(t); $('#status').textContent = 'Copied.'; } catch { $('#status').textContent = 'Copy failed.'; }
};
$('#del').onclick = () => { if (confirm('Delete this meeting?')) { (cur.segs || []).forEach(s => idbRemove(s.k)); notes = notes.filter(n => n !== cur); persist(); cur = null; show('list'); renderList(); } };

function fillSettings() {
  $('#tBase').value = cfg.tbase; $('#tModel').value = cfg.tmodel; $('#tKey').value = cfg.tkey; $('#tPrice').value = cfg.pwh;
  $('#sBase').value = cfg.base; $('#sModel').value = cfg.model; $('#sKey').value = cfg.key;
  $('#sPin').value = cfg.pin; $('#sPout').value = cfg.pout; $('#sCap').value = cfg.cap;
  $('#sSpent').textContent = `Spent so far: ${money(spent)}. Also set a spend limit on the provider key itself.`;
}
$('#openSettings').onclick = () => { fillSettings(); $('#settings').showModal(); };
$('#sSave').onclick = () => {
  cfg = { base: $('#sBase').value.trim() || DEFAULTS.base, model: $('#sModel').value.trim(), key: $('#sKey').value.trim(),
    tbase: $('#tBase').value.trim() || DEFAULTS.tbase, tmodel: $('#tModel').value.trim() || DEFAULTS.tmodel, tkey: $('#tKey').value.trim(), pwh: +$('#tPrice').value || 0, pin: +$('#sPin').value || 0, pout: +$('#sPout').value || 0, cap: Math.min(+$('#sCap').value || 2, 2) };
  save('cfg', cfg); renderSpend();
};
$('#resetSpend').onclick = () => { spent = 0; save('spent', 0); renderSpend(); fillSettings(); };

renderSpend(); renderList(); show('list');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
