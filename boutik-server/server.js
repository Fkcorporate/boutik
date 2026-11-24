// Boutik — serveur de synchronisation + console super-admin (Node 18+, aucune dépendance)
// Démarrage : node server.js
// Variables : PORT, DATA_DIR, ADMIN_PASSWORD (obligatoire pour /admin, 10 caractères min.),
//             TRIAL_DAYS (essai gratuit, défaut 30), GRACE_DAYS (délai après expiration, défaut 7),
//             SUPPORT_CONTACT (affiché aux commerçants, ex. "Egalyx — WhatsApp +225 07 00 00 00")
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUB = path.join(__dirname, 'public');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TRIAL_DAYS = +process.env.TRIAL_DAYS || 30;
const GRACE_DAYS = process.env.GRACE_DAYS !== undefined ? +process.env.GRACE_DAYS : 7;
const SUPPORT = process.env.SUPPORT_CONTACT || '';
// Assistant IA en ligne (facultatif) : sans clé, l'assistant de l'appli fonctionne seul, hors ligne.
const AI_KEY = process.env.ANTHROPIC_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'claude-haiku-5-5';
const AI_URL = process.env.AI_URL || 'https://api.anthropic.com/v1/messages';
const AI_DAILY = +process.env.AI_DAILY_LIMIT || 60;
const AI_SYSTEM = r => `Tu es l'assistant de Boutik, une application de caisse et de stock pour petits commerces en Afrique. Tu parles à ${r === 'vendeur' ? 'un vendeur de la boutique' : 'le propriétaire de la boutique'}.
Règles : réponds en français simple, en phrases courtes (6 lignes au plus), avec les montants dans la monnaie indiquée. Utilise uniquement les données fournies ; si l'information n'y est pas, dis-le simplement. N'invente aucun chiffre.
${r === 'vendeur' ? "Ne parle jamais de marges, de prix d'achat, de bénéfice, de l'argent attendu dans la caisse ni des autres vendeurs." : 'Tu peux donner des conseils de gestion concrets et prudents (stock, prix, crédit, contrôle des vendeurs). Pas de conseil juridique ou fiscal définitif.'}
Pour une question sans rapport avec la boutique ou l'appli, réponds poliment que tu aides seulement pour la boutique.`;
fs.mkdirSync(DATA, { recursive: true });

const COLS = new Set(['products', 'employees', 'sales', 'expenses', 'moves', 'payments', 'shifts', 'counts', 'log', 'settings', 'suppliers', 'supplies', 'supPays']);
const shops = new Map(), dirty = new Set();
const DAY = 864e5, nowIso = () => new Date().toISOString();

/* ---------- stockage ---------- */
function shopFile(id) { return path.join(DATA, id + '.json'); }
function getShop(id) {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  if (shops.has(id)) return shops.get(id);
  const f = shopFile(id); if (!fs.existsSync(f)) return null;
  const s = JSON.parse(fs.readFileSync(f, 'utf8')); upgrade(s); shops.set(id, s); return s;
}
function upgrade(s) {
  if (!s.plan) s.plan = { until: new Date(new Date(s.created || Date.now()).getTime() + TRIAL_DAYS * DAY).toISOString(), status: 'essai', suspended: false };
  s.devices = s.devices || {}; s.pays = s.pays || []; s.info = s.info || {}; s.lastSeen = s.lastSeen || s.created;
}
function allShopIds() { return fs.readdirSync(DATA).filter(f => /^[a-f0-9]{16}\.json$/.test(f)).map(f => f.slice(0, 16)); }
function persist() {
  for (const id of dirty) { const f = shopFile(id); fs.writeFileSync(f + '.tmp', JSON.stringify(shops.get(id))); fs.renameSync(f + '.tmp', f); }
  dirty.clear();
}
const CFG_F = path.join(DATA, '_config.json');
let CFG = Object.assign({ price: 5000, currency: 'FCFA', playUrl: '', appStoreUrl: '', whatsapp: '', email: '', editor: '' }, fs.existsSync(CFG_F) ? JSON.parse(fs.readFileSync(CFG_F, 'utf8')) : {});
const saveCfg = () => fs.writeFileSync(CFG_F, JSON.stringify(CFG));
setInterval(persist, 2000);
['SIGTERM', 'SIGINT'].forEach(sig => process.on(sig, () => { persist(); process.exit(0); }));

/* ---------- abonnement ---------- */
function subState(s) {
  const until = new Date(s.plan.until).getTime(), left = Math.ceil((until - Date.now()) / DAY);
  const blocked = s.plan.suspended || Date.now() > until + GRACE_DAYS * DAY;
  const status = s.plan.suspended ? 'suspendu' : left < 0 ? (blocked ? 'expiré' : 'délai de grâce') : s.plan.status;
  return { until: s.plan.until, daysLeft: left, blocked, status, support: SUPPORT };
}

/* ---------- utilitaires HTTP ---------- */
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function readBody(req, limit) {
  return new Promise((ok, ko) => {
    let n = 0; const ch = [];
    req.on('data', c => { n += c.length; if (n > limit) { ko(new Error('trop gros')); req.destroy(); } else ch.push(c); });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(ch).toString() || '{}')); } catch (e) { ko(e); } });
    req.on('error', ko);
  });
}
// Application mobile (Capacitor) : origines autorisées pour l'API des téléphones
const APP_ORIGINS = new Set(['capacitor://localhost', 'https://localhost', 'http://localhost', 'ionic://localhost']);
let CORS = null;
function json(res, code, obj) { const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }; if (CORS) Object.assign(h, CORS); res.writeHead(code, h); res.end(JSON.stringify(obj)); }
const ipOf = req => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const hits = new Map();
function limited(key, max, windowMs) {
  const k = key + ':' + Math.floor(Date.now() / windowMs), n = (hits.get(k) || 0) + 1; hits.set(k, n);
  if (hits.size > 20000) hits.clear(); return n > max;
}
function origin(req) { const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0]; return proto + '://' + req.headers.host; }

/* ---------- sessions admin ---------- */
const sessions = new Map();
function adminOk(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  const s = t && sessions.get(t); if (!s || s < Date.now()) { if (t) sessions.delete(t); return false; }
  return true;
}

/* ---------- statistiques d'une boutique ---------- */
function stats(s) {
  const r = s.recs || {}, vals = c => Object.values(r[c] || {}).map(e => e.r);
  const sales = vals('sales').filter(x => !x.cancelled), from30 = new Date(Date.now() - 30 * DAY).toISOString(), from7 = new Date(Date.now() - 7 * DAY).toISOString();
  const st = (r.settings && r.settings.main && r.settings.main.r) || {};
  const s30 = sales.filter(x => x.date >= from30);
  return {
    shopName: st.shopName || s.name || '—', owner: st.ownerName || '', ownerPhone: st.ownerPhone || '', contact: st.contact || '', currency: st.currency || 'FCFA',
    products: vals('products').filter(p => p.active !== false).length, employees: vals('employees').filter(e => e.active !== false).length,
    sales30: s30.length, ca30: s30.reduce((a, x) => a + (+x.total || 0), 0), sales7: sales.filter(x => x.date >= from7).length,
    lastSale: sales.reduce((m, x) => x.date > m ? x.date : m, ''), devices: Object.keys(s.devices).length,
    size: Object.values(r).reduce((a, c) => a + Object.keys(c).length, 0)
  };
}
function shopSummary(id, s) { return { id, created: s.created, lastSeen: s.lastSeen, plan: s.plan, sub: subState(s), info: s.info, pays: s.pays, devicesList: s.devices, stats: stats(s) }; }

const STATIC = {
  '/': ['site.html', 'text/html; charset=utf-8'], '/confidentialite': ['confidentialite.html', 'text/html; charset=utf-8'],
  '/app': ['index.html', 'text/html; charset=utf-8'], '/app/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/admin': ['admin.html', 'text/html; charset=utf-8'], '/admin/': ['admin.html', 'text/html; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'], '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'], '/icon-192.png': ['icon-192.png', 'image/png'], '/icon-512.png': ['icon-512.png', 'image/png']
};

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://local'), p = u.pathname, ip = ipOf(req);
    const og = req.headers.origin; CORS = null;
    if (og && APP_ORIGINS.has(og) && /^\/api\/(ping|register|sync|public|assistant)$/.test(p)) CORS = { 'Access-Control-Allow-Origin': og, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' };
    if (req.method === 'OPTIONS') { res.writeHead(CORS ? 204 : 403, CORS || {}); return res.end(); }
    if (req.method === 'GET' && p === '/api/public') return json(res, 200, { price: CFG.price, currency: CFG.currency, trialDays: TRIAL_DAYS, playUrl: CFG.playUrl, appStoreUrl: CFG.appStoreUrl, whatsapp: CFG.whatsapp, email: CFG.email, editor: CFG.editor, support: SUPPORT, ai: !!AI_KEY });
    if (req.method === 'GET' && p === '/api/ping') return json(res, 200, { ok: true, app: 'boutik' });

    /* ===== API des téléphones ===== */
    if (req.method === 'POST' && p === '/api/register') {
      if (limited('reg:' + ip, 10, 36e5)) return json(res, 429, { error: 'Trop de créations, réessayez plus tard' });
      const b = await readBody(req, 1e4);
      const id = crypto.randomBytes(8).toString('hex'), key = crypto.randomBytes(16).toString('hex'), t = nowIso();
      const s = { key, name: String(b.name || '').slice(0, 80), created: t, lastSeen: t, seq: 0, recs: {} }; upgrade(s);
      shops.set(id, s); dirty.add(id); persist();
      return json(res, 200, { shop: id, key, sub: subState(s) });
    }
    if (req.method === 'POST' && p === '/api/sync') {
      const b = await readBody(req, 40e6);
      const id = String(b.shop || ''), s = getShop(id);
      if (!s || !same(s.key, b.key)) return json(res, 403, { error: 'Accès refusé' });
      const sub = subState(s);
      s.lastSeen = nowIso(); if (b.device && String(b.device).length < 40) s.devices[String(b.device)] = { seen: s.lastSeen, ua: String(req.headers['user-agent'] || '').slice(0, 120) };
      dirty.add(id);
      if (sub.blocked) return json(res, 402, { error: 'Abonnement', sub });
      const since = +b.since || 0, mine = new Set();
      for (const it of Array.isArray(b.push) ? b.push : []) {
        const c = it && it.c, r = it && it.r;
        if (!COLS.has(c) || !r || typeof r !== 'object' || Array.isArray(r)) continue;
        const rid = c === 'settings' ? 'main' : String(r.id || '');
        if (!rid || rid.length > 64) continue;
        const col = s.recs[c] || (s.recs[c] = {}), ex = col[rid];
        if (!ex || String(r._u || '') >= String(ex.r._u || '')) { col[rid] = { r, s: ++s.seq }; mine.add(c + ':' + rid); }
      }
      if (s.recs.settings && s.recs.settings.main) s.name = s.recs.settings.main.r.shopName || s.name;
      const pull = [];
      for (const c in s.recs) for (const rid in s.recs[c]) { const e = s.recs[c][rid]; if (e.s > since && !mine.has(c + ':' + rid)) pull.push({ c, r: e.r }); }
      return json(res, 200, { seq: s.seq, pull, sub });
    }

    if (req.method === 'POST' && p === '/api/assistant') {
      if (!AI_KEY) return json(res, 503, { error: 'Assistant en ligne non activé' });
      const b = await readBody(req, 3e5);
      const id = String(b.shop || ''), s = getShop(id);
      if (!s || !same(s.key, b.key)) return json(res, 403, { error: 'Accès refusé' });
      if (subState(s).blocked) return json(res, 402, { error: 'Abonnement' });
      if (limited('ai:' + id, AI_DAILY, 864e5)) return json(res, 429, { error: 'Limite de questions du jour atteinte' });
      const role = b.role === 'vendeur' ? 'vendeur' : 'proprietaire';
      const q = String(b.question || '').slice(0, 500), ctx = JSON.stringify(b.context || {}).slice(0, 14000);
      if (!q.trim()) return json(res, 400, { error: 'Question vide' });
      try {
        const r = await fetch(AI_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: AI_MODEL, max_tokens: 600, system: AI_SYSTEM(role), messages: [{ role: 'user', content: `Données de la boutique (JSON) :\n${ctx}\n\nQuestion : ${q}` }] }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { console.error('IA', r.status, JSON.stringify(j).slice(0, 300)); return json(res, 502, { error: 'Assistant indisponible' }); }
        const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').slice(0, 4000);
        s.aiCount = (s.aiCount || 0) + 1; dirty.add(id);
        return json(res, 200, { text });
      } catch (e) { return json(res, 502, { error: 'Assistant indisponible' }); }
    }

    /* ===== API super-admin ===== */
    if (p.startsWith('/api/admin/')) {
      if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 10) return json(res, 503, { error: 'Console désactivée : définissez ADMIN_PASSWORD (10 caractères minimum) sur le serveur.' });
      if (req.method === 'POST' && p === '/api/admin/login') {
        if (limited('login:' + ip, 6, 15 * 6e4)) return json(res, 429, { error: 'Trop d\'essais. Attendez 15 minutes.' });
        const b = await readBody(req, 1e4);
        if (!same(b.password || '', ADMIN_PASSWORD)) { await new Promise(r => setTimeout(r, 600)); return json(res, 401, { error: 'Mot de passe incorrect' }); }
        const t = crypto.randomBytes(24).toString('hex'); sessions.set(t, Date.now() + 12 * 36e5);
        return json(res, 200, { token: t });
      }
      if (!adminOk(req)) return json(res, 401, { error: 'Session expirée' });
      if (req.method === 'POST' && p === '/api/admin/logout') { sessions.delete((req.headers.authorization || '').replace(/^Bearer /, '')); return json(res, 200, { ok: true }); }
      if (req.method === 'GET' && p === '/api/admin/shops') {
        const list = allShopIds().map(id => shopSummary(id, getShop(id)));
        return json(res, 200, { shops: list, config: CFG, trialDays: TRIAL_DAYS, graceDays: GRACE_DAYS, support: SUPPORT });
      }
      if (req.method === 'POST' && p === '/api/admin/config') {
        const b = await readBody(req, 1e4); CFG.price = Math.max(0, +b.price || 0); CFG.currency = String(b.currency || 'FCFA').slice(0, 8);
        const url = x => { x = String(x || '').trim().slice(0, 300); return /^https:\/\//.test(x) ? x : ''; };
        CFG.playUrl = url(b.playUrl); CFG.appStoreUrl = url(b.appStoreUrl); CFG.whatsapp = String(b.whatsapp || '').replace(/[^\d+]/g, '').slice(0, 20); CFG.email = String(b.email || '').slice(0, 120); CFG.editor = String(b.editor || '').slice(0, 120); saveCfg();
        return json(res, 200, { config: CFG });
      }
      const m = p.match(/^\/api\/admin\/shop\/([a-f0-9]{16})\/(extend|suspend|rekey|info|unpay)$/);
      if (req.method === 'POST' && m) {
        const s = getShop(m[1]); if (!s) return json(res, 404, { error: 'Boutique introuvable' });
        const b = await readBody(req, 1e5);
        if (m[2] === 'extend') {
          const months = Math.min(36, Math.max(0, +b.months || 0)), days = Math.min(1100, Math.max(0, +b.days || 0));
          if (!months && !days) return json(res, 400, { error: 'Durée manquante' });
          const base = Math.max(Date.now(), new Date(s.plan.until).getTime()), d = new Date(base);
          if (months) d.setMonth(d.getMonth() + months); if (days) d.setDate(d.getDate() + days);
          s.plan.until = d.toISOString(); s.plan.status = b.trial ? 'essai' : 'actif'; s.plan.suspended = false;
          if (!b.trial) s.pays.unshift({ id: crypto.randomBytes(4).toString('hex'), date: nowIso(), amount: Math.max(0, +b.amount || 0), months, days, method: String(b.method || '').slice(0, 30), note: String(b.note || '').slice(0, 200) });
        }
        if (m[2] === 'unpay') { s.pays = s.pays.filter(x => x.id !== b.id); }
        if (m[2] === 'suspend') s.plan.suspended = !!b.on;
        if (m[2] === 'info') s.info = { client: String(b.client || '').slice(0, 80), phone: String(b.phone || '').slice(0, 40), city: String(b.city || '').slice(0, 60), note: String(b.note || '').slice(0, 1000) };
        let code = null;
        if (m[2] === 'rekey') { s.key = crypto.randomBytes(16).toString('hex'); s.devices = {}; code = `BOUTIK1|${origin(req)}|${m[1]}|${s.key}`; }
        dirty.add(m[1]); persist();
        return json(res, 200, { shop: shopSummary(m[1], s), code });
      }
      return json(res, 404, { error: 'introuvable' });
    }

    /* ===== fichiers ===== */
    const st = req.method === 'GET' && STATIC[p];
    if (st) {
      const f = path.join(PUB, st[0]); if (!fs.existsSync(f)) return json(res, 404, { error: 'introuvable' });
      const headers = { 'Content-Type': st[1], 'Cache-Control': /html|sw\.js/.test(st[0]) ? 'no-cache' : 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' };
      if (st[0] === 'admin.html') Object.assign(headers, { 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
      res.writeHead(200, headers); return fs.createReadStream(f).pipe(res);
    }
    json(res, 404, { error: 'introuvable' });
  } catch (e) { json(res, 400, { error: 'Requête invalide' }); }
}).listen(PORT, () => console.log('Boutik en ligne sur le port ' + PORT + (ADMIN_PASSWORD.length >= 10 ? ' · console /admin active' : ' · console /admin désactivée (ADMIN_PASSWORD manquant)')));
