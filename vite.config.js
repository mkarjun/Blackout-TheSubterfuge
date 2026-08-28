import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind every interface so other machines on the LAN can join. Vite prints the
    // Network URL on start. Windows will ask to allow Node through the firewall the
    // first time - that prompt must be accepted for LAN play to work.
    host: true,
    port: 5173,
    strictPort: true,
    // Local model servers (Ollama / LM Studio) are proxied in dev so the browser
    // never has to negotiate CORS with them. See services/llmClient.js -> resolveBaseUrl().
    proxy: {
      '/ollama': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ollama/, ''),
      },
      '/lmstudio': {
        target: 'http://localhost:1234',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/lmstudio/, ''),
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
          firebase: ['firebase/app', 'firebase/auth'],
        },
      },
    },
  },
});
