// Generate platform-specific application icons from the canonical `Icono.png`
// at the repo root. Output:
//   - packages/app/build/icon.png   (Linux AppImage + dev BrowserWindow)
//   - packages/app/build/icon.ico   (Windows installer / .exe)
//   - packages/app/build/icon.icns  (macOS .app / .dmg)
//   - packages/ui/public/icono.png  (HTML favicon served by Vite)
//
// Run via `npm run icons:build`. Re-run whenever `Icono.png` changes.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import png2icons from 'png2icons';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const SRC = resolve(ROOT, 'Icono.png');
const APP_BUILD = resolve(ROOT, 'packages/app/build');
const UI_PUBLIC = resolve(ROOT, 'packages/ui/public');

if (!existsSync(SRC)) {
  console.error(`[build-icons] source not found: ${SRC}`);
  process.exit(1);
}

mkdirSync(APP_BUILD, { recursive: true });
mkdirSync(UI_PUBLIC, { recursive: true });

const sourcePng = readFileSync(SRC);

// PNG copies (raw passthrough — png2icons doesn't resize the master PNG).
writeFileSync(resolve(APP_BUILD, 'icon.png'), sourcePng);
writeFileSync(resolve(UI_PUBLIC, 'icono.png'), sourcePng);
console.log(`[build-icons] PNG copies → app/build, ui/public`);

// Windows .ico — multi-resolution (16/32/48/64/128/256). The `false` arg
// disables PNG compression inside the ICO so older Windows versions still
// render the smaller sizes.
const icoBuf = png2icons.createICO(sourcePng, png2icons.BILINEAR, 0, false);
if (!icoBuf) throw new Error('png2icons.createICO failed');
writeFileSync(resolve(APP_BUILD, 'icon.ico'), icoBuf);
console.log(`[build-icons] icon.ico (${icoBuf.length} bytes)`);

// macOS .icns — also multi-resolution, generated from the same master.
const icnsBuf = png2icons.createICNS(sourcePng, png2icons.BILINEAR, 0);
if (!icnsBuf) throw new Error('png2icons.createICNS failed');
writeFileSync(resolve(APP_BUILD, 'icon.icns'), icnsBuf);
console.log(`[build-icons] icon.icns (${icnsBuf.length} bytes)`);

console.log('[build-icons] done.');
