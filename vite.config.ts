import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serve o projeto em /<repo>/. Em dev e em preview local o base
// pode ser sobrescrito por VITE_BASE_PATH.
const base = process.env.VITE_BASE_PATH ?? '/rpg-ai/'

export default defineConfig({
  base,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'rpg-ai — RPG solo mestrado por IA',
        short_name: 'rpg-ai',
        description: 'Motor de jogo para RPG de mesa solo, mestrado por IA.',
        lang: 'pt-BR',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0B0613',
        theme_color: '#0B0613',
        // TODO: icons 192/512 + maskable. Precisa de arte — sem placeholder feio.
        icons: [],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // App shell offline. As chamadas de IA precisam de rede por natureza.
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/^\/api/, /supabase\.co/],
      },
    }),
  ],
})
