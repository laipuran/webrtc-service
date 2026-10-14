import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { events: fileURLToPath(new URL('./node_modules/events/events.js', import.meta.url)) },
  },
  build: {
    lib: { entry: 'src/adapter.ts', formats: ['es'], fileName: 'adapter' },
    target: 'es2022',
  },
});
