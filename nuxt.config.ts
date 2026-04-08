import pkg from './package.json';

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
  icon: {
    clientBundle: {
      scan: true,
      include: [
        // Nuxt UI internal icons (resolved dynamically via appConfig.ui.icons.*)
        'i-lucide-arrow-down',
        'i-lucide-arrow-left',
        'i-lucide-arrow-right',
        'i-lucide-arrow-up',
        'i-lucide-arrow-up-right',
        'i-lucide-check',
        'i-lucide-chevron-down',
        'i-lucide-chevron-left',
        'i-lucide-chevron-right',
        'i-lucide-chevron-up',
        'i-lucide-chevrons-left',
        'i-lucide-chevrons-right',
        'i-lucide-circle-alert',
        'i-lucide-circle-check',
        'i-lucide-circle-x',
        'i-lucide-copy',
        'i-lucide-copy-check',
        'i-lucide-ellipsis',
        'i-lucide-eye',
        'i-lucide-eye-off',
        'i-lucide-file',
        'i-lucide-folder',
        'i-lucide-folder-open',
        'i-lucide-grip-vertical',
        'i-lucide-hash',
        'i-lucide-info',
        'i-lucide-loader-circle',
        'i-lucide-menu',
        'i-lucide-minus',
        'i-lucide-monitor',
        'i-lucide-moon',
        'i-lucide-panel-left-close',
        'i-lucide-panel-left-open',
        'i-lucide-plus',
        'i-lucide-rotate-ccw',
        'i-lucide-search',
        'i-lucide-square',
        'i-lucide-sun',
        'i-lucide-triangle-alert',
        'i-lucide-upload',
        'i-lucide-x',
        // Preset YAML icons (loaded at runtime, not in scanned source)
        'i-lucide-lightbulb',
        'i-lucide-code',
        'i-lucide-file-text',
        'i-lucide-list-checks',
        'i-lucide-search-check',
        // Brand logos (simple-icons collection)
        'i-simple-icons-anthropic',
        'i-simple-icons-github',
      ],
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
    define: {
      'import.meta.env.PACKAGE_VERSION': JSON.stringify(pkg.version),
    },
    clearScreen: false,
    build: {
      target: 'es2022',
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            // Separate highlight.js into its own chunk (~400 kB)
            if (id.includes('highlight.js')) return 'hljs';
            // Separate marked into its own chunk (~80 kB)
            if (id.includes('marked')) return 'marked';
            // ME-5: Separate xterm into its own lazy-loaded chunk (~300 kB)
            if (id.includes('@xterm')) return 'xterm';
            // Separate Tauri plugins into their own chunk
            if (id.includes('@tauri-apps')) return 'tauri';
            // Separate Nuxt UI components into their own chunk
            if (id.includes('@nuxt/ui')) return 'nuxt-ui';
            // Split drag-and-drop libs from main app chunk
            if (id.includes('sortablejs') || id.includes('vue-draggable-plus')) return 'dnd';
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
