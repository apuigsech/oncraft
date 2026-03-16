// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  ssr: false,
  modules: [
    '@nuxt/ui',
    '@pinia/nuxt',
  ],
  css: [
    '~/assets/theme.css',
    '~/assets/main.css',
  ],
  ui: {
    theme: {
      colors: ['primary', 'success', 'warning', 'error', 'neutral'],
    },
  },
  colorMode: {
    preference: 'dark',
  },
  devtools: { enabled: false },
  devServer: {
    port: 3000,
  },
  vite: {
    clearScreen: false,
    server: {
      strictPort: true,
      watch: {
        ignored: ['**/src-tauri/**'],
      },
    },
  },
  compatibilityDate: '2025-03-16',
})
