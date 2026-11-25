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
// Suppression définitive d'une boutique (compte) et de toutes ses données sur le serveur
const PAIRS = new Map();
const DEL_F = path.join(DATA, '_deletions.json');
let DELS = fs.existsSync(DEL_F) ? JSON.parse(fs.readFileSync(DEL_F, 'utf8')) : [];
const saveDels = () => fs.writeFileSync(DEL_F, JSON.stringify(DELS));
function deleteShop(id, why) {
  const s = getShop(id); if (!s) return false;
  shops.delete(id); dirty.delete(id); try { fs.unlinkSync(shopFile(id)); } catch (e) {}
  DELS.unshift({ id: crypto.randomBytes(4).toString('hex'), date: nowIso(), shop: id, name: s.name || '', how: why, done: true }); DELS = DELS.slice(0, 500); saveDels();
  return true;
}
function allShopIds() { return fs.readdirSync(DATA).filter(f => /^[a-f0-9]{16}\.json$/.test(f)).map(f => f.slice(0, 16)); }
function persist() {
  for (const id of dirty) { const f = shopFile(id); fs.writeFileSync(f + '.tmp', JSON.stringify(shops.get(id))); fs.renameSync(f + '.tmp', f); }
  dirty.clear();
}
const CFG_F = path.join(DATA, '_config.json');
const CFG_DEF = { priceList: 25000, price: 20000, priceYear: 200000, currency: 'FCFA', playUrl: '', appStoreUrl: '', whatsapp: '', email: '', editor: '',
  promos: [{ code: 'BIENVENUE', off: 5000, per: 'mois', active: true, until: '', max: 0, uses: 0, note: 'Remise de lancement' }],
  hardware: [
    { id: 'h1', name: 'Imprimante d\'étiquettes Bluetooth 58 mm', price: 0, desc: 'Imprime les étiquettes QR et les reçus depuis le téléphone. Sans encre (thermique).', active: true },
    { id: 'h2', name: 'Rouleaux d\'étiquettes autocollantes 40 × 30 mm', price: 0, desc: 'Lot de rouleaux adhésifs pour coller les QR sur les articles.', active: true },
    { id: 'h3', name: 'Rouleaux de tickets 58 mm', price: 0, desc: 'Pour imprimer les reçus clients.', active: true }] };
let CFG = Object.assign({}, CFG_DEF, fs.existsSync(CFG_F) ? JSON.parse(fs.readFileSync(CFG_F, 'utf8')) : {});
if (!CFG.priceYear) CFG.priceYear = CFG.price * 10;
const saveCfg = () => fs.writeFileSync(CFG_F, JSON.stringify(CFG));
setInterval(persist, 2000);
/* ---------- notifications sur le téléphone du patron ----------
   Web Push (version web installée, Android et iPhone) : clés VAPID créées au premier démarrage, chiffrement RFC 8291.
   Application des stores : Firebase Cloud Messaging si FCM_SERVICE_ACCOUNT est défini (JSON du compte de service). */
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const VAPID_F = path.join(DATA, '_vapid.json');
const VAPID = fs.existsSync(VAPID_F) ? JSON.parse(fs.readFileSync(VAPID_F, 'utf8')) : (() => { const e = crypto.createECDH('prime256v1'); e.generateKeys(); const v = { pub: b64u(e.getPublicKey()), priv: b64u(e.getPrivateKey()) }; fs.writeFileSync(VAPID_F, JSON.stringify(v)); return v; })();
const VAPID_KEY = (() => { const p = unb64u(VAPID.pub); return crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: VAPID.priv, x: b64u(p.subarray(1, 33)), y: b64u(p.subarray(33, 65)) } }); })();
function vapidAuth(endpoint) {
  const aud = new URL(endpoint).origin, h = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' })), c = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:' + (CFG.email || 'contact@boutik.app') }));
  const sig = crypto.sign('sha256', Buffer.from(h + '.' + c), { key: VAPID_KEY, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${h}.${c}.${b64u(sig)}, k=${VAPID.pub}`;
}
function encryptPush(sub, payload, fixed) { // RFC 8291, aes128gcm
  const ua = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const as = crypto.createECDH('prime256v1'); if (fixed) as.setPrivateKey(fixed.priv); else as.generateKeys();
  const asPub = as.getPublicKey(), secret = as.computeSecret(ua), salt = fixed ? fixed.salt : crypto.randomBytes(16);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const ci = crypto.createCipheriv('aes-128-gcm', cek, nonce), ct = Buffer.concat([ci.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), ci.final(), ci.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = asPub.length;
  return Buffer.concat([head, asPub, ct]);
}
let FCM = null; try { if (process.env.FCM_SERVICE_ACCOUNT) FCM = { sa: JSON.parse(process.env.FCM_SERVICE_ACCOUNT), tok: null, exp: 0 }; } catch (e) { console.error('FCM_SERVICE_ACCOUNT illisible'); }
async function fcmToken() {
  if (FCM.tok && Date.now() < FCM.exp) return FCM.tok;
  const t = Math.floor(Date.now() / 1000), h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })), c = b64u(JSON.stringify({ iss: FCM.sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: t, exp: t + 3600 }));
  const jwt = h + '.' + c + '.' + b64u(crypto.sign('sha256', Buffer.from(h + '.' + c), FCM.sa.private_key));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt });
  const j = await r.json(); if (!j.access_token) throw new Error('FCM auth'); FCM.tok = j.access_token; FCM.exp = Date.now() + 50 * 6e4; return FCM.tok;
}
async function sendOne(sub, msg) { // renvoie false si l'abonnement est mort
  try {
    if (sub.kind === 'fcm') {
      if (!FCM) return true;
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${FCM.sa.project_id}/messages:send`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await fcmToken() },
        body: JSON.stringify({ message: { token: sub.token, notification: { title: msg.title, body: msg.body }, data: { url: msg.url || '/app/#alertes', tag: msg.tag || '' }, android: { priority: 'high', notification: { tag: msg.tag || undefined } }, apns: { payload: { aps: { sound: 'default' } } } } }) });
      return !(r.status === 404 || r.status === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(await r.text()));
    }
    const r = await fetch(sub.endpoint, { method: 'POST', headers: { Authorization: vapidAuth(sub.endpoint), TTL: '86400', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' }, body: encryptPush(sub, JSON.stringify(msg)) });
    return !(r.status === 404 || r.status === 410);
  } catch (e) { return true; }
}
async function notifyShop(id, s, msg, exceptDevice) {
  const subs = (s.push || []).filter(x => x.device !== exceptDevice || !exceptDevice); if (!subs.length) return 0;
  (s.notifs = s.notifs || []).unshift({ date: nowIso(), title: msg.title, body: msg.body }); s.notifs = s.notifs.slice(0, 50); dirty.add(id);
  const dead = []; await Promise.all(subs.map(async x => { if (!(await sendOne(x, msg))) dead.push(x.id); }));
  if (dead.length) { s.push = s.push.filter(x => !dead.includes(x.id)); dirty.add(id); }
  return subs.length - dead.length;
}
/* Règles d'alerte : réglées par le patron dans l'appli (settings.alerts), lues ici dans la copie synchronisée */
const ALERT_DEF = { stockBas: true, surstock: true, perte: true, remise: true, remiseSeuil: 2000, ecart: true, ecartSeuil: 500, annulation: true, retour: true, horaires: false, de: '07:00', a: '21:00', fermeture: false, heureFermeture: '21:30', matin: true };
function shopPrefs(s) { const st = s.recs.settings && s.recs.settings.main && s.recs.settings.main.r || {}; return { cfg: Object.assign({}, ALERT_DEF, st.alerts || {}), st }; }
const fmtM = (n, cur) => Math.round(n || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ') + ' ' + (cur || 'FCFA');
function localHM(st, d = new Date()) { const m = (d.getUTCHours() * 60 + d.getUTCMinutes() + (+st.tz || 0) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
function localDay(st, d = new Date()) { return new Date(d.getTime() + (+st.tz || 0) * 6e4).toISOString().slice(0, 10); }
function eventsFor(s, c, r, ex) {
  const { cfg, st } = shopPrefs(s), cur = st.currency, out = [], who = u => u === 'owner' ? (st.ownerName || 'Le patron') : ((s.recs.employees || {})[u] || { r: {} }).r.name || 'Un vendeur';
  if (c === 'shifts' && r.status === 'fermé' && !(ex && ex.r.status === 'fermé') && cfg.ecart && r.diff < 0 && -r.diff >= (+cfg.ecartSeuil || 0)) out.push({ title: `Caisse de ${who(r.user)} : manque ${fmtM(-r.diff, cur)}`, body: `Attendu ${fmtM(r.expected, cur)}, compté ${fmtM(r.counted, cur)}.`, tag: 'caisse-' + r.id });
  if (c === 'sales' && !ex && !r.cancelled) {
    const lose = (r.items || []).filter(i => i.qty > 0 && i.cost > 0 && i.price < i.cost);
    if (cfg.perte && lose.length) out.push({ title: `Vente à perte n°${r.no} (${who(r.user)})`, body: lose.map(i => `${i.name} vendu ${fmtM(i.price, cur)}, acheté ${fmtM(i.cost, cur)}`).join(' · ').slice(0, 180), tag: 'perte-' + r.id });
    if (cfg.remise && r.discount && r.discount >= (+cfg.remiseSeuil || 0)) out.push({ title: `Remise de ${fmtM(r.discount, cur)}`, body: `Vente n°${r.no} par ${who(r.user)} : ${fmtM(r.total, cur)}.`, tag: 'remise-' + r.id });
    if (cfg.retour && r.retOf) out.push({ title: `Retour / échange sur la vente n°${r.retOf}`, body: `${who(r.user)} · ${r.total < 0 ? 'remboursé ' + fmtM(-r.total, cur) : 'différence payée ' + fmtM(r.total, cur)}`, tag: 'retour-' + r.id });
    if (cfg.horaires && r.date) { const hm = localHM(st, new Date(r.date)); if (hm < cfg.de || hm > cfg.a) out.push({ title: `Vente hors horaires à ${hm}`, body: `Vente n°${r.no} par ${who(r.user)} : ${fmtM(r.total, cur)}.`, tag: 'horaire-' + r.id }); }
  }
  if (c === 'sales' && cfg.annulation && r.cancelReq && !(ex && ex.r.cancelReq)) out.push({ title: `Demande d'annulation (vente n°${r.no})`, body: `${who(r.cancelReq.by)} : ${String(r.cancelReq.reason || '').slice(0, 120)} · ${fmtM(r.total, cur)}`, tag: 'annul-' + r.id });
  if (c === 'products' && ex && r.active !== false) {
    const a = +ex.r.stock, b = +r.stock;
    if (cfg.stockBas && b <= 0 && a > 0) out.push({ title: `Rupture : ${r.name}`, body: 'Plus aucun article en stock.', tag: 'stock-' + r.id });
    else if (cfg.stockBas && r.min > 0 && a > r.min && b <= r.min) out.push({ title: `Stock bas : ${r.name}`, body: `Il en reste ${b}.`, tag: 'stock-' + r.id });
    if (cfg.surstock && r.max > 0 && a <= r.max && b > r.max) out.push({ title: `Surstock : ${r.name}`, body: `${b} en stock pour un maximum de ${r.max}.`, tag: 'sur-' + r.id });
  }
  return out;
}
// Vérifications programmées : caisse pas fermée à l'heure, et résumé du matin (ruptures, péremptions)
async function timedChecks() {
  for (const id of allShopIds()) {
    const s = getShop(id); if (!s || !(s.push || []).length || subState(s).blocked) continue;
    const { cfg, st } = shopPrefs(s), hm = localHM(st), day = localDay(st), ps = s.pushState || (s.pushState = {});
    if (cfg.fermeture && hm >= cfg.heureFermeture && ps.ferm !== day) {
      const open = Object.values(s.recs.shifts || {}).map(x => x.r).filter(x => x.status === 'ouvert');
      if (open.length) { ps.ferm = day; dirty.add(id); const names = open.map(x => x.user === 'owner' ? (st.ownerName || 'patron') : ((s.recs.employees || {})[x.user] || { r: {} }).r.name || 'vendeur');
        await notifyShop(id, s, { title: `Caisse pas fermée à ${cfg.heureFermeture}`, body: `Encore ouverte : ${names.join(', ')}.`, tag: 'ferm-' + day }); }
    }
    if (cfg.matin && hm >= '08:00' && hm < '12:00' && ps.matin !== day) {
      ps.matin = day; dirty.add(id);
      const prods = Object.values(s.recs.products || {}).map(x => x.r).filter(p => p.active !== false);
      const out = prods.filter(p => p.stock <= 0).length, low = prods.filter(p => p.stock > 0 && p.min > 0 && p.stock <= p.min).length;
      const t0 = new Date(day + 'T00:00:00Z').getTime(), exp = (st.features || {}).peremption ? prods.filter(p => p.exp && p.stock > 0 && (new Date(p.exp + 'T00:00:00Z').getTime() - t0) / 864e5 <= 30).length : 0;
      const parts = [out && `${out} en rupture`, low && `${low} en stock bas`, exp && `${exp} à vendre vite (péremption)`].filter(Boolean);
      if (parts.length) await notifyShop(id, s, { title: `Bonjour ${st.ownerName || ''} : point du matin`.replace(' :', ' :').trim(), body: parts.join(' · ') + '.', tag: 'matin-' + day });
    }
  }
}
setInterval(() => timedChecks().catch(e => console.error('alertes', e.message)), +process.env.ALERT_CHECK_MS || 5 * 6e4);

['SIGTERM', 'SIGINT'].forEach(sig => process.on(sig, () => { persist(); process.exit(0); }));

/* ---------- abonnement ---------- */
function subState(s) {
  const until = new Date(s.plan.until).getTime(), left = Math.ceil((until - Date.now()) / DAY);
  const blocked = s.plan.suspended || Date.now() > until + GRACE_DAYS * DAY;
  const status = s.plan.suspended ? 'suspendu' : left < 0 ? (blocked ? 'expiré' : 'délai de grâce') : s.plan.status;
  return { until: s.plan.until, daysLeft: left, blocked, status, support: SUPPORT, tarif: tariff(s) };
}
/* ---------- tarifs et codes promo ---------- */
function promoValid(code) {
  const c = String(code || '').trim().toUpperCase(); if (!c) return null;
  const x = (CFG.promos || []).find(p => p.code === c);
  if (!x || !x.active || (x.until && Date.now() > new Date(x.until).getTime() + DAY) || (x.max > 0 && x.uses >= x.max)) return null;
  return x;
}
// Prix d'une période pour une boutique : mensuel ou annuel, remise du code promo comprise.
function tariff(s) {
  const cycle = s.plan.cycle === 'an' ? 'an' : 'mois', months = cycle === 'an' ? 12 : 1;
  const base = cycle === 'an' ? CFG.priceYear : CFG.price, list = (CFG.priceList || CFG.price) * months;
  const p = promoValid(s.plan.promo), off = p ? (p.per === 'once' ? p.off : p.off * months) : 0;
  return { cycle, months, list, base, promo: p ? p.code : '', off: Math.min(off, base), due: Math.max(0, base - off), currency: CFG.currency };
}
const publicCfg = () => ({ vapid: VAPID.pub, fcm: !!FCM, priceList: CFG.priceList, price: CFG.price, priceYear: CFG.priceYear, currency: CFG.currency, trialDays: TRIAL_DAYS, playUrl: CFG.playUrl, appStoreUrl: CFG.appStoreUrl, whatsapp: CFG.whatsapp, email: CFG.email, editor: CFG.editor, support: SUPPORT, ai: !!AI_KEY,
  promo: (CFG.promos || []).some(p => promoValid(p.code)), hardware: (CFG.hardware || []).filter(h => h.active).map(({ id, name, price, desc, img }) => ({ id, name, price, desc, img })) });

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
  '/': ['site.html', 'text/html; charset=utf-8'], '/confidentialite': ['confidentialite.html', 'text/html; charset=utf-8'], '/suppression-compte': ['suppression.html', 'text/html; charset=utf-8'],
  '/app': ['index.html', 'text/html; charset=utf-8'], '/app/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/admin': ['admin.html', 'text/html; charset=utf-8'], '/admin/': ['admin.html', 'text/html; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'], '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'], '/icon-192.png': ['icon-192.png', 'image/png'], '/icon-512.png': ['icon-512.png', 'image/png'], '/boutik.mp4': ['boutik.mp4', 'video/mp4'], '/boutik-poster.jpg': ['boutik-poster.jpg', 'image/jpeg']
};

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://local'), p = u.pathname, ip = ipOf(req);
    const og = req.headers.origin; CORS = null;
    if (og && APP_ORIGINS.has(og) && /^\/api\/(ping|register|sync|public|assistant|promo|count|delete|delete-request|push\/subscribe|push\/unsubscribe|push\/test|pair\/start|pair\/claim)$/.test(p)) CORS = { 'Access-Control-Allow-Origin': og, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' };
    if (req.method === 'OPTIONS') { res.writeHead(CORS ? 204 : 403, CORS || {}); return res.end(); }
    if (req.method === 'GET' && p === '/api/public') return json(res, 200, publicCfg());
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
      const since = +b.since || 0, mine = new Set(), evts = [];
      for (const it of Array.isArray(b.push) ? b.push : []) {
        const c = it && it.c, r = it && it.r;
        if (!COLS.has(c) || !r || typeof r !== 'object' || Array.isArray(r)) continue;
        const rid = c === 'settings' ? 'main' : String(r.id || '');
        if (!rid || rid.length > 64) continue;
        const col = s.recs[c] || (s.recs[c] = {}), ex = col[rid];
        if (!ex || String(r._u || '') >= String(ex.r._u || '')) { try { if ((s.push || []).length) evts.push(...eventsFor(s, c, r, ex)); } catch (e) {} col[rid] = { r, s: ++s.seq }; mine.add(c + ':' + rid); }
      }
      if (s.recs.settings && s.recs.settings.main) s.name = s.recs.settings.main.r.shopName || s.name;
      const pull = [];
      for (const c in s.recs) for (const rid in s.recs[c]) { const e = s.recs[c][rid]; if (e.s > since && !mine.has(c + ':' + rid)) pull.push({ c, r: e.r }); }
      if (evts.length) { const PR = ['caisse', 'annul', 'perte', 'remise', 'stock', 'sur', 'retour', 'horaire'], pr = e => { const i = PR.indexOf(String(e.tag).split('-')[0]); return i < 0 ? 9 : i; }; evts.sort((x, y) => pr(x) - pr(y)); const dev = String(b.device || ''); (evts.length > 4 ? [{ title: `${evts.length} alertes dans « ${s.name || 'la boutique'} »`, body: evts.slice(0, 4).map(e => e.title).join(' · '), tag: 'lot-' + Date.now() }] : evts).forEach(e => notifyShop(id, s, e, dev).catch(() => {})); }
      return json(res, 200, { seq: s.seq, pull, sub });
    }

    if (req.method === 'POST' && /^\/api\/push\/(subscribe|unsubscribe|test)$/.test(p)) {
      const b = await readBody(req, 2e4), id = String(b.shop || ''), s = getShop(id);
      if (!s || !same(s.key, b.key)) return json(res, 403, { error: 'Accès refusé' });
      const dev = String(b.device || '').slice(0, 40); s.push = s.push || [];
      if (p.endsWith('/unsubscribe')) { s.push = s.push.filter(x => x.device !== dev); dirty.add(id); return json(res, 200, { ok: true }); }
      if (p.endsWith('/test')) { const n = await notifyShop(id, s, { title: 'Boutik : notifications activées', body: 'Vous recevrez ici les alertes de votre boutique.', tag: 'test' }); return json(res, 200, { ok: true, sent: n }); }
      let sub;
      if (b.fcm) sub = { kind: 'fcm', token: String(b.fcm).slice(0, 400) };
      else if (b.sub && /^https:\/\//.test(b.sub.endpoint || '') && b.sub.keys && b.sub.keys.p256dh && b.sub.keys.auth) sub = { kind: 'web', endpoint: String(b.sub.endpoint).slice(0, 800), keys: { p256dh: String(b.sub.keys.p256dh).slice(0, 200), auth: String(b.sub.keys.auth).slice(0, 100) } };
      else return json(res, 400, { error: 'Abonnement invalide' });
      s.push = s.push.filter(x => x.device !== dev).concat([{ id: crypto.randomBytes(4).toString('hex'), device: dev, created: nowIso(), ...sub }]).slice(-10); dirty.add(id);
      return json(res, 200, { ok: true });
    }
    // Code de connexion à 6 chiffres, valable 10 minutes : plus simple que le long code pour connecter un téléphone ou un ordinateur
    if (req.method === 'POST' && p === '/api/pair/start') {
      const b = await readBody(req, 1e4), id = String(b.shop || ''), s = getShop(id);
      if (!s || !same(s.key, b.key)) return json(res, 403, { error: 'Accès refusé' });
      for (const [c, x] of PAIRS) if (x.shop === id || x.exp < Date.now()) PAIRS.delete(c);
      let c; do { c = String(crypto.randomInt(0, 1e6)).padStart(6, '0'); } while (PAIRS.has(c));
      PAIRS.set(c, { shop: id, exp: Date.now() + 10 * 6e4 }); return json(res, 200, { code: c, ttl: 600 });
    }
    if (req.method === 'POST' && p === '/api/pair/claim') {
      if (limited('pair:' + ip, 10, 10 * 6e4)) return json(res, 429, { error: 'Trop d\'essais, attendez 10 minutes' });
      const b = await readBody(req, 1e4), c = String(b.code || '').replace(/\D/g, ''), x = PAIRS.get(c);
      if (!x || x.exp < Date.now()) return json(res, 404, { error: 'Code incorrect ou expiré' });
      PAIRS.delete(c); const s = getShop(x.shop); if (!s) return json(res, 404, { error: 'Boutique introuvable' });
      return json(res, 200, { shop: x.shop, key: s.key, name: s.name || '' });
    }
    if (req.method === 'POST' && p === '/api/delete') {
      if (limited('del:' + ip, 10, 36e5)) return json(res, 429, { error: 'Trop d\'essais, réessayez plus tard' });
      const b = await readBody(req, 1e4); let id = String(b.shop || ''), key = String(b.key || '');
      const m = /^BOUTIK1\|[^|]*\|([a-f0-9]{16})\|([a-f0-9]{32})$/.exec(String(b.code || '').trim()); if (m) { id = m[1]; key = m[2]; }
      const s = getShop(id); if (!s || !same(s.key, key)) return json(res, 403, { error: 'Code incorrect' });
      deleteShop(id, m ? 'page web (code de la boutique)' : 'appli'); return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/delete-request') {
      if (limited('delreq:' + ip, 5, 36e5)) return json(res, 429, { error: 'Trop de demandes, réessayez plus tard' });
      const b = await readBody(req, 1e4), name = String(b.name || '').trim().slice(0, 80), contact = String(b.contact || '').trim().slice(0, 80);
      if (!name || !contact) return json(res, 400, { error: 'Indiquez le nom de la boutique et un contact' });
      DELS.unshift({ id: crypto.randomBytes(4).toString('hex'), date: nowIso(), name, contact, note: String(b.note || '').slice(0, 500), done: false }); DELS = DELS.slice(0, 500); saveDels();
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/promo') {
      if (limited('promo:' + ip, 20, 36e5)) return json(res, 429, { error: 'Trop d\'essais, réessayez plus tard' });
      const b = await readBody(req, 1e4), x = promoValid(b.code);
      if (!x) return json(res, 404, { error: 'Code promo invalide ou expiré' });
      const id = String(b.shop || ''), s = id && getShop(id);
      if (s && same(s.key, b.key)) { s.plan.promo = x.code; dirty.add(id); return json(res, 200, { ok: true, code: x.code, off: x.off, per: x.per, sub: subState(s) }); }
      return json(res, 200, { ok: true, code: x.code, off: x.off, per: x.per });
    }
    if (req.method === 'POST' && p === '/api/count') {
      if (!AI_KEY) return json(res, 503, { error: 'Comptage par IA non activé' });
      const b = await readBody(req, 9e6);
      const id = String(b.shop || ''), s = getShop(id);
      if (!s || !same(s.key, b.key)) return json(res, 403, { error: 'Accès refusé' });
      if (subState(s).blocked) return json(res, 402, { error: 'Abonnement' });
      if (limited('ai:' + id, AI_DAILY, 864e5)) return json(res, 429, { error: 'Limite du jour atteinte' });
      const b64 = x => { x = String(x || '').replace(/^data:image\/jpeg;base64,/, ''); return x && !/[^A-Za-z0-9+/=]/.test(x) ? x : ''; };
      const img = String(b.image || '').replace(/^data:image\/jpeg;base64,/, '');
      if (!img || img.length > 5e6 || /[^A-Za-z0-9+/=]/.test(img)) return json(res, 400, { error: 'Photo invalide' });
      // Produits : { code, name } ; photos de référence facultatives (petites, 12 au plus)
      const prods = (Array.isArray(b.products) ? b.products : []).slice(0, 120).map(x => typeof x === 'string' ? { code: '', name: x.slice(0, 60) } : { code: String(x.code || '').slice(0, 12), name: String(x.name || '').slice(0, 60) });
      const refs = (Array.isArray(b.refs) ? b.refs : []).slice(0, 12).map(r => ({ code: String(r.code || '').slice(0, 12), name: String(r.name || '').slice(0, 60), data: b64(r.image) })).filter(r => r.data && r.data.length < 4e5);
      const refBlocks = refs.flatMap(r => [{ type: 'text', text: `Photo de référence du produit ${r.code} — ${r.name} :` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: r.data } }]);
      const list = prods.map(x => (x.code ? x.code + ' — ' : '') + x.name).join(' ; ');
      try {
        const r = await fetch(AI_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: AI_MODEL, max_tokens: 900, system: 'Tu comptes des articles de magasin sur une photo. Réponds uniquement en JSON valide, sans texte autour : {"total": nombre, "items": [{"code": "code du produit de la liste ou vide", "name": "nom", "count": nombre}], "note": "remarque courte en français"}. Associe chaque article à un produit de la liste quand tu le reconnais (aide-toi des photos de référence), en recopiant son code. Attention aux variantes de taille ou de poids : en cas de doute, laisse le code vide et dis-le dans note. Si des articles sont cachés ou empilés, donne ton estimation et dis-le dans note.',
            messages: [{ role: 'user', content: [...refBlocks, { type: 'text', text: 'Photo à compter :' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } }, { type: 'text', text: 'Produits de la boutique : ' + (list || 'non précisés') + '. Combien d\'articles vois-tu, par produit ?' }] }] }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { console.error('IA comptage', r.status, JSON.stringify(j).slice(0, 300)); return json(res, 502, { error: 'Comptage indisponible' }); }
        const t = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
        let out; try { out = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch (e) { return json(res, 502, { error: 'Réponse illisible, réessayez' }); }
        const codes = new Set(prods.map(x => x.code).filter(Boolean));
        const items = (Array.isArray(out.items) ? out.items : []).slice(0, 80).map(x => ({ code: codes.has(String(x.code || '')) ? String(x.code) : '', name: String(x.name || '').slice(0, 60), count: Math.max(0, Math.round(+x.count || 0)) }));
        s.aiCount = (s.aiCount || 0) + 1; dirty.add(id);
        return json(res, 200, { total: Math.max(0, Math.round(+out.total || items.reduce((a, x) => a + x.count, 0))), items, note: String(out.note || '').slice(0, 300) });
      } catch (e) { return json(res, 502, { error: 'Comptage indisponible' }); }
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
        return json(res, 200, { shops: list, config: CFG, trialDays: TRIAL_DAYS, graceDays: GRACE_DAYS, support: SUPPORT, deletions: DELS.slice(0, 100) });
      }
      if (req.method === 'POST' && p === '/api/admin/config') {
        const b = await readBody(req, 2e5); CFG.price = Math.max(0, +b.price || 0); CFG.currency = String(b.currency || 'FCFA').slice(0, 8);
        CFG.priceList = Math.max(CFG.price, +b.priceList || 0); CFG.priceYear = Math.max(0, +b.priceYear || CFG.price * 10);
        if (Array.isArray(b.promos)) { const old = new Map((CFG.promos || []).map(x => [x.code, x])); const seen = new Set();
          CFG.promos = b.promos.slice(0, 100).map(x => ({ code: String(x.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24), off: Math.max(0, +x.off || 0), per: x.per === 'once' ? 'once' : 'mois', active: !!x.active, until: /^\d{4}-\d{2}-\d{2}$/.test(x.until || '') ? x.until : '', max: Math.max(0, +x.max || 0), uses: (old.get(String(x.code || '').trim().toUpperCase()) || {}).uses || 0, note: String(x.note || '').slice(0, 80) }))
            .filter(x => x.code && !seen.has(x.code) && seen.add(x.code)); }
        if (Array.isArray(b.hardware)) CFG.hardware = b.hardware.slice(0, 50).map((h, i) => ({ id: String(h.id || 'h' + i).replace(/[^\w-]/g, '').slice(0, 20) || 'h' + i, name: String(h.name || '').slice(0, 80), price: Math.max(0, +h.price || 0), desc: String(h.desc || '').slice(0, 300), img: /^https:\/\//.test(h.img || '') ? String(h.img).slice(0, 300) : '', active: h.active !== false })).filter(h => h.name);
        const url = x => { x = String(x || '').trim().slice(0, 300); return /^https:\/\//.test(x) ? x : ''; };
        CFG.playUrl = url(b.playUrl); CFG.appStoreUrl = url(b.appStoreUrl); CFG.whatsapp = String(b.whatsapp || '').replace(/[^\d+]/g, '').slice(0, 20); CFG.email = String(b.email || '').slice(0, 120); CFG.editor = String(b.editor || '').slice(0, 120); saveCfg();
        return json(res, 200, { config: CFG });
      }
      if (req.method === 'POST' && p === '/api/admin/deletion-done') { const b = await readBody(req, 1e4); const x = DELS.find(d => d.id === b.id); if (x) { x.done = true; x.doneAt = nowIso(); saveDels(); } return json(res, 200, { deletions: DELS.slice(0, 100) }); }
      const dm = p.match(/^\/api\/admin\/shop\/([a-f0-9]{16})\/delete$/);
      if (req.method === 'POST' && dm) { const b = await readBody(req, 1e4); if (b.confirm !== 'SUPPRIMER') return json(res, 400, { error: 'Confirmation manquante' }); if (!deleteShop(dm[1], 'console fournisseur')) return json(res, 404, { error: 'Boutique introuvable' }); if (b.request) { const x = DELS.find(d => d.id === b.request); if (x) { x.done = true; x.doneAt = nowIso(); saveDels(); } } return json(res, 200, { ok: true, deletions: DELS.slice(0, 100) }); }
      const m = p.match(/^\/api\/admin\/shop\/([a-f0-9]{16})\/(extend|suspend|rekey|info|unpay|plan)$/);
      if (req.method === 'POST' && m) {
        const s = getShop(m[1]); if (!s) return json(res, 404, { error: 'Boutique introuvable' });
        const b = await readBody(req, 1e5);
        if (m[2] === 'extend') {
          const months = Math.min(36, Math.max(0, +b.months || 0)), days = Math.min(1100, Math.max(0, +b.days || 0));
          if (!months && !days) return json(res, 400, { error: 'Durée manquante' });
          const base = Math.max(Date.now(), new Date(s.plan.until).getTime()), d = new Date(base);
          if (months) d.setMonth(d.getMonth() + months); if (days) d.setDate(d.getDate() + days);
          s.plan.until = d.toISOString(); s.plan.status = b.trial ? 'essai' : 'actif'; s.plan.suspended = false;
          if (!b.trial) { const pr = promoValid(s.plan.promo); if (pr) { pr.uses = (pr.uses || 0) + 1; saveCfg(); if (pr.per === 'once') s.plan.promo = ''; }
            s.pays.unshift({ id: crypto.randomBytes(4).toString('hex'), date: nowIso(), amount: Math.max(0, +b.amount || 0), months, days, cycle: s.plan.cycle || 'mois', promo: pr ? pr.code : '', method: String(b.method || '').slice(0, 30), note: String(b.note || '').slice(0, 200) }); }
        }
        if (m[2] === 'plan') { s.plan.cycle = b.cycle === 'an' ? 'an' : 'mois'; const c = String(b.promo || '').trim().toUpperCase(); if (c && !promoValid(c)) return json(res, 400, { error: 'Code promo invalide ou expiré' }); s.plan.promo = c; }
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
    const st = (req.method === 'GET' || req.method === 'HEAD') && STATIC[p];
    if (st) {
      const f = path.join(PUB, st[0]); if (!fs.existsSync(f)) return json(res, 404, { error: 'introuvable' });
      const headers = { 'Content-Type': st[1], 'Cache-Control': /html|sw\.js/.test(st[0]) ? 'no-cache' : 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' };
      if (st[0] === 'admin.html') Object.assign(headers, { 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
      // Vidéo : réponses partielles (Range), indispensables pour Safari / iPhone
      if (st[1] === 'video/mp4') {
        const size = fs.statSync(f).size, m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
        headers['Accept-Ranges'] = 'bytes';
        if (m) {
          let a = m[1] === '' ? size - +m[2] : +m[1], b = m[1] !== '' && m[2] !== '' ? Math.min(+m[2], size - 1) : size - 1;
          if (isNaN(a) || a < 0 || a > b || a >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
          res.writeHead(206, Object.assign(headers, { 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1 }));
          return fs.createReadStream(f, { start: a, end: b }).pipe(res);
        }
        headers['Content-Length'] = size;
      }
      if (req.method === 'HEAD') { if (!headers['Content-Length']) headers['Content-Length'] = fs.statSync(f).size; res.writeHead(200, headers); return res.end(); }
      res.writeHead(200, headers); return fs.createReadStream(f).pipe(res);
    }
    json(res, 404, { error: 'introuvable' });
  } catch (e) { json(res, 400, { error: 'Requête invalide' }); }
}).listen(PORT, () => console.log('Boutik en ligne sur le port ' + PORT + (ADMIN_PASSWORD.length >= 10 ? ' · console /admin active' : ' · console /admin désactivée (ADMIN_PASSWORD manquant)')));
