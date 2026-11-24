// Prépare le dossier www/ de l'application mobile à partir de l'appli web.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = path.join(root, '..', 'boutik-server', 'public');
const www = path.join(root, 'www');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'boutik.config.json'), 'utf8'));
const server = String(cfg.server || '').replace(/\/+$/, '');
if (!/^https:\/\//.test(server) || /votre-boutik/.test(server)) {
  console.error('\n✖ Indiquez l\'adresse https de votre serveur Boutik dans boutik.config.json (ex : https://boutik.onrender.com)\n');
  process.exit(1);
}
if (!fs.existsSync(path.join(src, 'index.html'))) { console.error('✖ Introuvable : ' + src + ' (gardez boutik-server à côté de boutik-mobile)'); process.exit(1); }

fs.mkdirSync(www, { recursive: true });
for (const f of ['index.html', 'icon.svg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest']) fs.copyFileSync(path.join(src, f), path.join(www, f));
fs.writeFileSync(path.join(www, 'config.js'), `window.BOUTIK_SERVER = ${JSON.stringify(server)};\n`);
await build({ entryPoints: [path.join(root, 'src', 'native.js')], bundle: true, format: 'iife', minify: true, target: ['es2019'], outfile: path.join(www, 'native.js') });
console.log('✔ www/ prêt — serveur : ' + server);
