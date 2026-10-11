import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the portal talks to the local API; Cloudflare Access is skipped there.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8790', rewrite: (p) => p.replace(/^\/api/, '/admin') } },
  },
  build: { outDir: 'dist', sourcemap: false },
});
