import pkg from './package.json';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';


const version = pkg.version;

export default defineConfig({
  plugins: [react(), cloudflare()],
  // shown in Konto and /api/health, so anyone can see which version is live
  define: { __APP_VERSION__: JSON.stringify(version) },
});
