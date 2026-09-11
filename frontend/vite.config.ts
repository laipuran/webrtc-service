import basicSsl from '@vitejs/plugin-basic-ssl'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), basicSsl()],
  server: {
    host: true,
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:9001',
        ws: true,
      },
    },
  },
})
