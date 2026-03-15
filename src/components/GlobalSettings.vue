<script setup lang="ts">
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog">
      <div class="dialog-header">
        <h3>Global Settings</h3>
        <button class="close-btn" @click="emit('close')">x</button>
      </div>
      <div class="dialog-body">
        <p class="info-msg">Claude agent is bundled with the application. No configuration needed.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
.dialog { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; width: 420px; }
.dialog-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.dialog-header h3 { font-size: 16px; }
.close-btn { font-size: 16px; color: var(--text-muted); padding: 2px 6px; border-radius: 4px; }
.close-btn:hover { background: var(--bg-tertiary); }
.dialog-body { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.info-msg { font-size: 13px; color: var(--text-secondary); }
</style>
