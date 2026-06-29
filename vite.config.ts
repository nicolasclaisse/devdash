import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

const serverPort = Number(process.env.VITE_SERVER_PORT ?? 52800)
const vitePort   = Number(process.env.VITE_PORT ?? 52801)
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

export default defineConfig({
  server: {
    port: vitePort,
    proxy: {
      '/api':    { target: `http://localhost:${serverPort}`, changeOrigin: true },
      '/shell':  { target: `http://localhost:${serverPort}`, changeOrigin: true, ws: true },
      '/custom': { target: `http://localhost:${serverPort}`, changeOrigin: true },
      '/ports':  { target: `http://localhost:${serverPort}`, changeOrigin: true },
      '/ws':     { target: `ws://localhost:${serverPort}`, changeOrigin: true, ws: true },
      '/s3':     { target: `http://localhost:${serverPort}`, changeOrigin: true },
      '/sysmon': { target: `http://localhost:${serverPort}`, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
})
