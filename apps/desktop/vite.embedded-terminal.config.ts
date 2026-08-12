import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/embedded-terminal',
  base: '/terminal/',
  build: {
    outDir: '../../out/embedded-terminal',
    emptyOutDir: true
  },
  plugins: [react()]
})
