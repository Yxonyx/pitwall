import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(here, 'web'),
  build: {
    outDir: path.join(here, 'dist/web'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    fs: { allow: [here] },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        ws: true,
      },
    },
  },
});
