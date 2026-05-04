import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = dirname(fileURLToPath(import.meta.url));

// Pull the workspace version from the root package.json so the title block's
// "Creado con Simulador vX.Y.Z.B" footer always tracks the current release.
const rootPkg = JSON.parse(
  readFileSync(resolve(here, '../../package.json'), 'utf8'),
) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  base: './',
  resolve: {
    // Alias @simulador/shared to its TypeScript source instead of the
    // compiled CommonJS dist. This lets Vite/Rollup process the TS files
    // directly with esbuild (works in both dev and production), avoiding
    // the CJS→ESM interop problem where Rollup couldn't statically detect
    // named exports like `canonicalize` from __exportStar wrappers.
    // The compiled dist is still used by Electron main (CJS) and by tests.
    alias: {
      '@simulador/shared': resolve(here, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
