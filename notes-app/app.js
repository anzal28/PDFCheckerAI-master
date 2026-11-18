'use strict';
const $ = s => document.querySelector(s);
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const DEFAULTS = { base: 'https://openrouter.ai/api/v1', model: '', key: '', pin: 0.2, pout: 0.4, cap: 2 };
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

/* ---- Recording (browser speech recognition, free) ---- */
function toggleRec() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $('#status').textContent = 'Live transcription is not supported in this browser. Paste a transcript or use Chrome/Safari.'; return; }
  if (recording) { recording = false; recog && recog.stop(); return; }
  recog = new SR(); recog.continuous = true; recog.interimResults = true; recog.lang = navigator.language || 'en-US';
  const ta = $('#tTranscript'); let base = ta.value ? ta.value.trimEnd() + '\n' : '';
  recog.onresult = e => {
    let fin = '', interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      e.results[i].isFinal ? fin += t + ' ' : interim += t;
    }
    base += fin; ta.value = base + interim; sync();
  };
  recog.onend = () => { if (recording) { try { recog.start(); } catch {} } else setRec(false); };
  recog.onerror = e => { if (e.error === 'not-allowed') { recording = false; setRec(false); $('#status').textContent = 'Microphone permission denied.'; } };
  recording = true; recog.start(); setRec(true); setTab('transcript');
}
function setRec(on) { const b = $('#rec'); b.classList.toggle('live', on); b.textContent = on ? '■ Stop' : '● Record'; }

/* ---- LLM with hard budget cap ---- */
const estTokens = s => Math.ceil(s.length / 3.5);
async function enhance() {
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
$('#enhance').onclick = enhance;
$('#copy').onclick = async () => {
  const t = tab === 'enhanced' ? cur.enhanced : tab === 'transcript' ? cur.transcript : cur.notes;
  try { await navigator.clipboard.writeText(t); $('#status').textContent = 'Copied.'; } catch { $('#status').textContent = 'Copy failed.'; }
};
$('#del').onclick = () => { if (confirm('Delete this meeting?')) { notes = notes.filter(n => n !== cur); persist(); cur = null; show('list'); renderList(); } };

function fillSettings() {
  $('#sBase').value = cfg.base; $('#sModel').value = cfg.model; $('#sKey').value = cfg.key;
  $('#sPin').value = cfg.pin; $('#sPout').value = cfg.pout; $('#sCap').value = cfg.cap;
  $('#sSpent').textContent = `Spent so far: ${money(spent)}. Also set a spend limit on the provider key itself.`;
}
$('#openSettings').onclick = () => { fillSettings(); $('#settings').showModal(); };
$('#sSave').onclick = () => {
  cfg = { base: $('#sBase').value.trim() || DEFAULTS.base, model: $('#sModel').value.trim(), key: $('#sKey').value.trim(),
    pin: +$('#sPin').value || 0, pout: +$('#sPout').value || 0, cap: Math.min(+$('#sCap').value || 2, 2) };
  save('cfg', cfg); renderSpend();
};
$('#resetSpend').onclick = () => { spent = 0; save('spent', 0); renderSpend(); fillSettings(); };

renderSpend(); renderList(); show('list');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
