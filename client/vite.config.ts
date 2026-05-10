import { defineConfig } from 'vite'
import { resolve } from 'path'
import { bundleSize } from './plugins/bundle-size.js'

export default defineConfig({
  plugins: [
    bundleSize({
      warnBytes: 60_000, // soft limit: warn above 60 kB raw
      failBytes: 80_000, // hard limit: fail above 80 kB raw
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dev: resolve(__dirname, 'dev.html'),
      },
    },
  },
})
