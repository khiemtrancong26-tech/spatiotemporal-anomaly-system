import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'script',
      includeAssets: ['icons/pwa-192.png', 'icons/pwa-512.png'],
      manifest: {
        name: 'PM2.5 Explorer',
        short_name: 'PM2.5 Explorer',
        description: 'Phân tích dữ liệu PM2.5 theo không gian và thời gian.',
        lang: 'vi',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f4f6f9',
        theme_color: '#1d4ed8',
        icons: [
          { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            // Business data is cached by Dexie, never by the Service Worker.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/v1/'),
            handler: 'NetworkOnly',
            options: { cacheName: 'pm25-api-network-only' },
          },
        ],
      },
    }),
  ],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
