import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('./web', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  base: './',
  esbuild: { jsx: 'automatic' },
  build: { outDir: '../dist/web', emptyOutDir: true },
});
