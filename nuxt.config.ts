// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  ssr: false,
  modules: [
    '@nuxt/ui',
    '@pinia/nuxt',
  ],
  css: [
    '~/assets/main.css',
    '~/assets/theme.css',
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
  sourcemap: { client: false },
  vite: {
    clearScreen: false,
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            // Separate highlight.js into its own chunk (~400 kB)
            if (id.includes('highlight.js')) return 'hljs';
            // Separate marked into its own chunk (~80 kB)
            if (id.includes('marked')) return 'marked';
            // Separate Tauri plugins into their own chunk
            if (id.includes('@tauri-apps')) return 'tauri';
            // Separate Nuxt UI components into their own chunk
            if (id.includes('@nuxt/ui')) return 'nuxt-ui';
          },
        },
      },
    },
    server: {
      strictPort: true,
      watch: {
        ignored: ['**/src-tauri/**'],
      },
    },
  },
  compatibilityDate: '2025-03-16',
})
