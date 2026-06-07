// Se ejecuta antes de cada deploy (npm run deploy):
// 1. Sube la versión patch en package.json (1.0.0 → 1.0.1)
// 2. Escribe la versión en ngsw-config.json (appData) — fuerza que el service worker
//    detecte versión nueva aunque ningún archivo haya cambiado
// 3. Genera src/environments/version.ts para mostrar/loguear la versión en la app
// 4. Deja registro histórico en versions.log
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const ngswPath = path.join(root, 'ngsw-config.json');
const versionTsPath = path.join(root, 'src', 'environments', 'version.ts');
const logPath = path.join(root, 'versions.log');

// 1. Bump patch
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const parts = String(pkg.version || '1.0.0').split('.').map(n => parseInt(n, 10) || 0);
parts[2] += 1;
const version = parts.join('.');
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const builtAt = new Date().toISOString();

// 2. appData en ngsw-config.json
const ngsw = JSON.parse(fs.readFileSync(ngswPath, 'utf8'));
ngsw.appData = { version, builtAt };
fs.writeFileSync(ngswPath, JSON.stringify(ngsw, null, 2) + '\n');

// 3. version.ts para la app
fs.writeFileSync(versionTsPath,
  `// Generado automáticamente por scripts/bump-version.js — no editar a mano\n` +
  `export const APP_VERSION = '${version}';\n` +
  `export const APP_BUILT_AT = '${builtAt}';\n`);

// 4. Historial
fs.appendFileSync(logPath, `${version}\t${builtAt}\n`);

console.log(`📦 Versión ${version} (${builtAt})`);
