import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import ui from '@nuxt/ui/vue-plugin';
import App from './App.vue';
import './assets/theme.css';
import './assets/main.css';

// Nuxt UI components (UButton, UDropdownMenu, etc.) internally use vue-router's
// useRoute/useRouter via ULink. Without a router instance, every component logs
// "injection Symbol(route location) not found" and event handlers can break.
// We create a minimal memory router with a single catch-all route since this
// is a Tauri desktop app without actual page navigation.
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/:catchAll(.*)', component: App },
  ],
});

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(ui);
app.mount('#app');
