import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

function offlineShell(): Plugin {
  return {
    name: 'offline-shell',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const files = [...new Set(['index.html', ...Object.keys(bundle).filter(file => !file.endsWith('.map'))])].sort();
      const html = bundle['index.html'];
      const version = createHash('sha256').update(files.join('\n')).update(html?.type === 'asset' ? html.source : '').digest('hex').slice(0, 16);
      this.emitFile({ type: 'asset', fileName: 'offline-worker.js', source: `
const prefix = 'pm25-shell:' + self.registration.scope + ':';
const version = prefix + ${JSON.stringify(version)};
const assets = new Set(${JSON.stringify(files)}.map(file => new URL(file, self.registration.scope).href));
const shell = new URL('index.html', self.registration.scope).href;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(version).then(cache => cache.addAll([...assets].map(url => new Request(url, {cache: 'reload'})))));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(prefix) && key !== version).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('authorization') ||
      url.pathname.startsWith('/api/') || !request.url.startsWith(self.registration.scope)) return;
  const target = request.mode === 'navigate' ? shell : assets.has(request.url) ? request.url : undefined;
  if (target) event.respondWith(caches.open(version).then(cache => cache.match(target)).then(match => match || fetch(request)));
});
` });
    },
  };
}

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), offlineShell()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
