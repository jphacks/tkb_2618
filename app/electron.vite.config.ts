import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react(), tailwindcss(), {
    name: 'deskapi-production-csp',
    transformIndexHtml(html, context) {
      return context.server ? html : html.replace("script-src 'self' 'unsafe-inline'", "script-src 'self'")
    }
  }] }
})
