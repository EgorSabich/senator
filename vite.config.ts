import pkg from './package.json';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
// @ts-ignore node types are not part of the app tsconfig
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
// @ts-ignore node types are not part of the app tsconfig
import { join } from 'node:path';


const version = pkg.version;
// every build gets its own service worker, so phones notice a deploy and reload old screens (2026-10-17)
const build = `${version}-${Date.now().toString(36)}`;

function stampServiceWorker() {
  let outDir = '';
  return {
    name: 'senator-stamp-sw',
    apply: 'build' as const,
    configResolved(c: { build: { outDir: string }; root: string }) {
      outDir = join(c.root, c.build.outDir);
    },
    closeBundle() {
      for (const dir of [outDir, join(outDir, '..', 'client')]) {
        const f = join(dir, 'sw.js');
        if (existsSync(f)) writeFileSync(f, readFileSync(f, 'utf8').replace('__SW_BUILD__', build));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), cloudflare(), stampServiceWorker()],
  // shown in Konto and /api/health, so anyone can see which version is live
  define: { __APP_VERSION__: JSON.stringify(version) },
});
