import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 3000,
    host: true
  },
  css: {
    postcss: {}
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-three': ['three'],
          'vendor-maplibre': ['maplibre-gl'],
          'vendor-searoute': ['searoute-ts']
        }
      }
    }
  }
});