'use strict';
// Zero-dependency Node (>=18) server: accounts, per-user storage, Whisper + LLM proxy, server-enforced budget.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const E = process.env;
const PORT = +E.PORT || 8123;
const DATA = path.resolve(E.DATA_DIR || path.join(__dirname, 'data'));
const SECRET = E.SESSION_SECRET || crypto.randomBytes(32).toString('hex'); // set it, or logins reset on restart
const CAP = Math.min(+E.BUDGET_CAP || 2, 2);
const W = { base: E.WHISPER_BASE || 'https://api.groq.com/openai/v1', key: E.WHISPER_KEY, model: E.WHISPER_MODEL || 'whisper-large-v3-turbo', perHour: +E.WHISPER_PRICE_PER_HOUR || 0.04 };
const L = { base: E.LLM_BASE || 'https://openrouter.ai/api/v1', key: E.LLM_KEY, model: E.LLM_MODEL, pin: +E.LLM_PRICE_IN || 0.2, pout: +E.LLM_PRICE_OUT || 0.4 };
const SECURE = E.NODE_ENV === 'production';

// USERS="anzal:password1,zane:password2"
const users = {};
for (const pair of (E.USERS || '').split(',').filter(Boolean)) {
  const i = pair.indexOf(':'); const name = pair.slice(0, i).trim().toLowerCase(), pw = pair.slice(i + 1);
  if (!/^[a-z0-9_]{2,20}$/.test(name) || !pw) continue;
  const salt = crypto.randomBytes(16);
  users[name] = { salt, hash: crypto.scryptSync(pw, salt, 32) };
}
if (!Object.keys(users).length) { console.error('Set USERS="anzal:pw,zane:pw"'); process.exit(1); }
if (!W.key || !L.key || !L.model) console.warn('Warning: WHISPER_KEY, LLM_KEY and LLM_MODEL must be set for transcription/summaries.');

fs.mkdirSync(DATA, { recursive: true });
const spendFile = path.join(DATA, 'spend.json');
let spend = { total: 0, users: {} };
try { spend = JSON.parse(fs.readFileSync(spendFile, 'utf8')); } catch {}
const addSpend = (u, c) => { spend.total += c; spend.users[u] = (spend.users[u] || 0) + c; fs.writeFileSync(spendFile, JSON.stringify(spend)); };

const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const mkToken = u => { const b = u + '.' + (Date.now() + 30 * 864e5); return b + '.' + sign(b); };
function userFrom(req) {
  const m = /(?:^|; )jt=([^;]+)/.exec(req.headers.cookie || ''); if (!m) return null;
  const [u, exp, sig] = decodeURIComponent(m[1]).split('.');
  const good = sign(u + '.' + exp); const ok = sig && sig.length === good.length && crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig));
  return ok && +exp > Date.now() && users[u] ? u : null;
}

const fails = {};
const udir = (u, ...p) => { const d = path.join(DATA, 'users', u, ...p); fs.mkdirSync(path.dirname(d), { recursive: true }); return d; };
const idOk = s => /^[a-z0-9]{1,40}$/i.test(s || '');
const send = (res, code, obj, hdr = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...hdr }); res.end(JSON.stringify(obj)); };
const body = (req, max) => new Promise((ok, no) => { const c = []; let n = 0; req.on('data', d => { n += d.length; if (n > max) { no(new Error('too large')); req.destroy(); } else c.push(d); }); req.on('end', () => ok(Buffer.concat(c))); req.on('error', no); });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

async function whisper(u, noteId, segId, dur, buf, type) {
  const cost = Math.max(dur, 10) / 3600 * W.perHour;
  if (spend.total + cost > CAP) throw Object.assign(new Error(`Budget of $${CAP} reached. Audio is saved.`), { code: 402 });
  const fd = new FormData(); fd.append('model', W.model);
  fd.append('file', new Blob([buf], { type }), 'seg.' + (type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'));
  const r = await fetch(W.base.replace(/\/$/, '') + '/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + W.key }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || 'Whisper error ' + r.status), { code: 502 });
  addSpend(u, cost); return (j.text || '').trim();
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x'); const p = url.pathname;
  if (!p.startsWith('/api/')) { // static
    let f = p === '/' ? '/index.html' : p; f = path.normalize(f).replace(/^(\.\.[/\\])+/, '');
    const fp = path.join(__dirname, f);
    if (!fp.startsWith(__dirname) || fp.includes(path.sep + 'data' + path.sep) || /server\.js$/.test(fp) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' }); return fs.createReadStream(fp).pipe(res);
  }
  if (p === '/api/login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress; if ((fails[ip] || 0) >= 10) return send(res, 429, { error: 'Too many attempts, try later.' });
    const { user = '', pass = '' } = JSON.parse((await body(req, 4096)).toString() || '{}');
    const u = users[String(user).toLowerCase()];
    const ok = u && crypto.timingSafeEqual(crypto.scryptSync(String(pass), u.salt, 32), u.hash);
    if (!ok) { fails[ip] = (fails[ip] || 0) + 1; setTimeout(() => fails[ip]--, 15 * 60e3); return send(res, 401, { error: 'Wrong username or password.' }); }
    const name = String(user).toLowerCase();
    return send(res, 200, { user: name }, { 'Set-Cookie': `jt=${encodeURIComponent(mkToken(name))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${SECURE ? '; Secure' : ''}` });
  }
  if (p === '/api/logout') return send(res, 200, {}, { 'Set-Cookie': 'jt=; HttpOnly; Path=/; Max-Age=0' });
  const u = userFrom(req); if (!u) return send(res, 401, { error: 'Not signed in.' });
  try {
    if (p === '/api/me') return send(res, 200, { user: u, spent: spend.total, cap: CAP });
    if (p === '/api/notes' && req.method === 'GET') {
      const d = udir(u, 'notes', 'x'); const dir = path.dirname(d);
      return send(res, 200, fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))));
    }
    let m = /^\/api\/notes\/([a-z0-9]+)$/i.exec(p);
    if (m && req.method === 'PUT') { const n = JSON.parse((await body(req, 2e6)).toString()); n.id = m[1]; fs.writeFileSync(udir(u, 'notes', n.id + '.json'), JSON.stringify(n)); return send(res, 200, {}); }
    if (m && req.method === 'DELETE') {
      for (const f of [udir(u, 'notes', m[1] + '.json')]) try { fs.unlinkSync(f); } catch {}
      const ad = path.dirname(udir(u, 'audio', 'x')); for (const f of fs.readdirSync(ad)) if (f.startsWith(m[1] + '-')) fs.unlinkSync(path.join(ad, f));
      return send(res, 200, {});
    }
    if (p === '/api/transcribe' && req.method === 'POST') { // body = raw audio
      const note = url.searchParams.get('note'), seg = url.searchParams.get('seg'), dur = +url.searchParams.get('dur') || 10;
      const type = (req.headers['content-type'] || 'audio/webm').split(';')[0];
      if (!idOk(note) || !idOk(seg)) return send(res, 400, { error: 'bad id' });
      const buf = await body(req, 25e6);
      fs.writeFileSync(udir(u, 'audio', `${note}-${seg}.bin`), buf); fs.writeFileSync(udir(u, 'audio', `${note}-${seg}.type`), type);
      return send(res, 200, { text: await whisper(u, note, seg, dur, buf, type) });
    }
    if (p === '/api/retry' && req.method === 'POST') {
      const note = url.searchParams.get('note'), seg = url.searchParams.get('seg'), dur = +url.searchParams.get('dur') || 10;
      if (!idOk(note) || !idOk(seg)) return send(res, 400, { error: 'bad id' });
      const buf = fs.readFileSync(udir(u, 'audio', `${note}-${seg}.bin`)), type = fs.readFileSync(udir(u, 'audio', `${note}-${seg}.type`), 'utf8');
      return send(res, 200, { text: await whisper(u, note, seg, dur, buf, type) });
    }
    if (p === '/api/enhance' && req.method === 'POST') {
      const { transcript = '' } = JSON.parse((await body(req, 2e6)).toString());
      const prompt = `You are a meeting-notes assistant. From the transcript below write notes.\nFirst line: "TITLE: <short title>". Then sections: Summary, Key points, Decisions, Action items (owners if known). Do not invent facts.\n\n## Transcript\n${transcript || '(empty)'}`;
      const maxOut = 1500, worst = prompt.length / 3.5 / 1e6 * L.pin + maxOut / 1e6 * L.pout;
      if (spend.total + worst > CAP) return send(res, 402, { error: `Budget of $${CAP} reached.` });
      const r = await fetch(L.base.replace(/\/$/, '') + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + L.key }, body: JSON.stringify({ model: L.model, max_tokens: maxOut, messages: [{ role: 'user', content: prompt }] }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return send(res, 502, { error: j.error?.message || 'LLM error ' + r.status });
      const usage = j.usage || {}; addSpend(u, (usage.prompt_tokens ?? prompt.length / 3.5) / 1e6 * L.pin + (usage.completion_tokens ?? maxOut) / 1e6 * L.pout);
      let text = j.choices[0].message.content || '', title = '';
      const t = /^\s*TITLE:\s*(.+)\n?/i.exec(text); if (t) { title = t[1].trim(); text = text.slice(t[0].length).trim(); }
      return send(res, 200, { title, summary: text });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.message }); }
}

http.createServer((req, res) => { route(req, res).catch(e => send(res, 500, { error: e.message })); }).listen(PORT, () => console.log('Jotter on :' + PORT));
