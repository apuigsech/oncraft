import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import ui from "@nuxt/ui/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    ui({
      /**
       * Theme overrides for Nuxt UI / Tailwind v4.
       *
       * This is the canonical place to configure the app's design tokens.
       * The `ui()` plugin injects these directly into the Tailwind v4 CSS
       * pipeline so they are guaranteed to be picked up by all components.
       *
       * To retheme the whole app, change values here.
       * The matching TypeScript constants in src/theme.ts should stay in sync.
       */
      theme: {
        colors: {
          // "primary" is the default color used by UButton, focus rings, etc.
          // Change this string to any Tailwind color name to retheme the whole app.
          primary: 'blue',
        },
      },
    }),
    vue(),
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
