import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.ts';

export default mergeConfig(base, defineConfig({
  build: { lib: false, outDir: 'dist/page', emptyOutDir: false },
  server: { host: '127.0.0.1' },
}));
