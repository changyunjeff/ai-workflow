import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Python service serves dist/ at http://127.0.0.1:8765/ and the API under /api/ on the same origin.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:8765' } },
});
