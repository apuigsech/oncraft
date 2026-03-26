<script setup lang="ts">
// Branded splash screen shown during app initialization.
// Uses the Tokyo Night Storm palette from theme.css.
</script>

<template>
  <div class="app-splash">
    <div class="splash-content">
      <div class="splash-logo">
        <div class="logo-icon">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <!-- Kanban board icon -->
            <rect x="4" y="8" width="12" height="32" rx="3" fill="#7aa2f7" opacity="0.9" />
            <rect x="18" y="12" width="12" height="24" rx="3" fill="#7aa2f7" opacity="0.6" />
            <rect x="32" y="16" width="12" height="16" rx="3" fill="#7aa2f7" opacity="0.35" />
          </svg>
        </div>
        <h1 class="splash-title">OnCraft</h1>
      </div>
      <div class="splash-loader">
        <div class="loader-bar" />
      </div>
      <p class="splash-hint">Loading workspace...</p>
    </div>
  </div>
</template>

<style scoped>
.app-splash {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
}

.splash-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

.splash-logo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.logo-icon {
  animation: pulse-glow 2s ease-in-out infinite;
}

.splash-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: 0.5px;
  margin: 0;
}

.splash-loader {
  width: 120px;
  height: 3px;
  border-radius: 2px;
  background: var(--bg-tertiary);
  overflow: hidden;
}

.loader-bar {
  width: 40%;
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
  animation: loader-slide 1.2s ease-in-out infinite;
}

.splash-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
}

@keyframes loader-slide {
  0% { transform: translateX(-100%); }
  50% { transform: translateX(200%); }
  100% { transform: translateX(-100%); }
}

@keyframes pulse-glow {
  0%, 100% { opacity: 0.8; }
  50% { opacity: 1; }
}
</style>
