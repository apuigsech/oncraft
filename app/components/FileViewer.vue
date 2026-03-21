<script setup lang="ts">
import { readTextFile } from '@tauri-apps/plugin-fs';
import { join as pathJoin } from '@tauri-apps/api/path';
import { renderMarkdown, ensureMarkdownReady } from '~/services/markdown';

const props = defineProps<{
  label: string;
  filePath: string;    // absolute path
  projectPath: string; // project root for resolving relative paths
}>();

const emit = defineEmits<{ close: [] }>();

const content = ref('');
const error = ref('');
const loading = ref(true);

const isMarkdown = computed(() => /\.(md|mdx|markdown)$/i.test(props.filePath));

// Detect language from extension for syntax highlighting label
const fileExtension = computed(() => {
  const m = props.filePath.match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : '';
});

const renderedHtml = computed(() => {
  if (!content.value) return '';
  if (isMarkdown.value) return renderMarkdown(content.value);
  return '';
});

async function loadFile() {
  loading.value = true;
  error.value = '';
  content.value = '';
  try {
    // Resolve relative paths against project root
    let absPath = props.filePath;
    if (!props.filePath.startsWith('/')) {
      absPath = await pathJoin(props.projectPath, props.filePath);
    }
    const text = await readTextFile(absPath);
    content.value = text;
    if (isMarkdown.value) {
      await ensureMarkdownReady();
    }
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

watch(() => props.filePath, loadFile, { immediate: true });
</script>

<template>
  <div class="file-viewer">
    <div class="viewer-toolbar">
      <div class="viewer-title">
        <UIcon name="i-lucide-file-text" class="file-icon" />
        <span class="file-label">{{ label }}</span>
        <span class="file-path-display">{{ filePath }}</span>
      </div>
      <button class="close-btn" title="Back to board" @click="emit('close')">
        <UIcon name="i-lucide-layout-dashboard" />
        <span>Back to board</span>
      </button>
    </div>

    <div class="viewer-body">
      <div v-if="loading" class="viewer-state">
        <UIcon name="i-lucide-loader-2" class="spin" />
        <span>Loading…</span>
      </div>
      <div v-else-if="error" class="viewer-state viewer-error">
        <UIcon name="i-lucide-alert-circle" />
        <span>{{ error }}</span>
      </div>
      <div v-else-if="isMarkdown" class="viewer-markdown markdown-body" v-html="renderedHtml" />
      <div v-else class="viewer-code">
        <div class="code-block">
          <span v-if="fileExtension" class="code-lang">{{ fileExtension }}</span>
          <pre><code>{{ content }}</code></pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.viewer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-secondary);
  flex-shrink: 0;
  gap: 12px;
}

.viewer-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}

.file-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.file-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  flex-shrink: 0;
}

.file-path-display {
  font-size: 11px;
  color: var(--text-muted);
  font-family: 'SF Mono', 'Fira Code', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}
.close-btn:hover {
  background: var(--bg-hover, var(--bg-secondary));
  color: var(--text-primary);
}

.viewer-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
}

.viewer-state {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 14px;
  margin-top: 40px;
  justify-content: center;
}

.viewer-error {
  color: #f87171;
}

.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.viewer-markdown {
  max-width: 860px;
  margin: 0 auto;
}

.viewer-code { max-width: 100%; }

.code-block {
  position: relative;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border);
  overflow: hidden;
}
.code-lang {
  position: absolute;
  top: 8px;
  right: 12px;
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  font-family: 'SF Mono', 'Fira Code', monospace;
}
.code-block pre {
  margin: 0;
  padding: 16px;
  overflow-x: auto;
}
.code-block code {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary);
}
</style>
