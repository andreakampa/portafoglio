/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { buildCsp } from './src/security/csp.ts'

// La nuova versione viene pubblicata accanto al sito attuale, in /portafoglio/v2/.
const BASE = '/portafoglio/v2/'

// Versione mostrata nelle Impostazioni: commit in CI, "locale" sul PC.
const VERSION = process.env.GITHUB_SHA?.slice(0, 7) ?? 'locale'

// Content Security Policy (src/security/csp.ts) subito dopo <meta charset>, prima di ogni script,
// solo nella versione pubblicata: in sviluppo Vite usa script in linea per il ricaricamento a caldo.
const CHARSET = '<meta charset="UTF-8" />'
const csp = (): Plugin => ({
  name: 'ptpro-csp',
  apply: 'build',
  transformIndexHtml: html => {
    if (!html.includes(CHARSET)) throw new Error('index.html: manca <meta charset>, non so dove mettere la CSP')
    return html.replace(CHARSET, `${CHARSET}\n    <meta http-equiv="Content-Security-Policy" content="${buildCsp()}" />`)
  },
})

export default defineConfig({
  base: BASE,
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  // Firebase (auth + database) pesa da solo ~450 kB non compressi (~170 kB gzip): è atteso.
  build: { chunkSizeWarningLimit: 800 },
  plugins: [
    react(),
    csp(),
    VitePWA({
      // Aggiornamento automatico: niente più "premi Ctrl+F5" dopo una pubblicazione.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Portafoglio Tracker Pro',
        short_name: 'Portafoglio',
        description: 'Portafogli, PMC, simulazioni e cassetto fiscale',
        lang: 'it',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: '#f7f5f0',
        theme_color: '#1f2a2e',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Solo i file del sito vanno in cache: dati e prezzi arrivano sempre dalla rete.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${BASE}index.html`,
        // Gestione delle notifiche push (public/push-sw.js).
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
