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

/* ─── Markdown typography (GitHub-inspired dark theme) ─── */
.viewer-markdown :deep(p) { margin: 0 0 16px 0; font-size: 14px; line-height: 1.7; color: var(--text-primary); }
.viewer-markdown :deep(p:last-child) { margin-bottom: 0; }
.viewer-markdown :deep(strong) { font-weight: 600; color: #f1f5f9; }
.viewer-markdown :deep(em) { font-style: italic; }

/* Headings */
.viewer-markdown :deep(h1) { font-size: 1.75em; font-weight: 700; margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 1px solid var(--border); color: #f1f5f9; }
.viewer-markdown :deep(h2) { font-size: 1.4em; font-weight: 600; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #1e293b; color: #f1f5f9; }
.viewer-markdown :deep(h3) { font-size: 1.15em; font-weight: 600; margin: 24px 0 10px; color: #e2e8f0; }
.viewer-markdown :deep(h4) { font-size: 1em; font-weight: 600; margin: 20px 0 8px; color: #cbd5e1; }
.viewer-markdown :deep(h5), .viewer-markdown :deep(h6) { font-size: 0.9em; font-weight: 600; margin: 16px 0 8px; color: #94a3b8; }

/* Lists */
.viewer-markdown :deep(ul), .viewer-markdown :deep(ol) { margin: 8px 0 16px 24px; padding: 0; }
.viewer-markdown :deep(li) { margin-bottom: 6px; font-size: 14px; line-height: 1.7; color: var(--text-primary); }
.viewer-markdown :deep(li > ul), .viewer-markdown :deep(li > ol) { margin-top: 4px; margin-bottom: 4px; }
.viewer-markdown :deep(ul) { list-style-type: disc; }
.viewer-markdown :deep(ol) { list-style-type: decimal; }

/* Links */
.viewer-markdown :deep(a) { color: #60a5fa; text-decoration: none; font-weight: 500; }
.viewer-markdown :deep(a:hover) { text-decoration: underline; color: #93bbfc; }

/* Blockquotes */
.viewer-markdown :deep(blockquote) {
  border-left: 4px solid #3b82f6;
  margin: 16px 0;
  padding: 8px 16px;
  background: rgba(59, 130, 246, 0.06);
  color: #94a3b8;
  border-radius: 0 6px 6px 0;
}
.viewer-markdown :deep(blockquote p) { margin-bottom: 4px; }
.viewer-markdown :deep(blockquote p:last-child) { margin-bottom: 0; }

/* Horizontal rules */
.viewer-markdown :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 24px 0; }

/* Tables */
.viewer-markdown :deep(table) { border-collapse: collapse; margin: 16px 0; width: 100%; font-size: 13px; overflow: hidden; border-radius: 6px; border: 1px solid #334155; }
.viewer-markdown :deep(thead) { background: #1e293b; }
.viewer-markdown :deep(th) { padding: 10px 14px; text-align: left; font-weight: 600; color: #e2e8f0; border-bottom: 2px solid #334155; }
.viewer-markdown :deep(td) { padding: 8px 14px; border-bottom: 1px solid #1e293b; color: var(--text-primary); }
.viewer-markdown :deep(tbody tr:hover) { background: rgba(148, 163, 184, 0.04); }
.viewer-markdown :deep(tbody tr:last-child td) { border-bottom: none; }

/* Inline code */
.viewer-markdown :deep(.inline-code) {
  background: #1e293b;
  padding: 2px 7px;
  border-radius: 4px;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 0.88em;
  color: #e2e8f0;
  border: 1px solid #334155;
}

/* Code blocks */
.viewer-markdown :deep(.code-block) {
  position: relative;
  margin: 16px 0;
  border-radius: 8px;
  overflow: hidden;
  background: #0f1219;
  border: 1px solid #1e293b;
}
.viewer-markdown :deep(.code-block .code-lang) {
  position: absolute;
  top: 8px;
  right: 12px;
  font-size: 10px;
  color: #475569;
  font-family: 'SF Mono', 'Fira Code', monospace;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.viewer-markdown :deep(.code-block pre) { margin: 0; padding: 16px; overflow-x: auto; }
.viewer-markdown :deep(.code-block code) {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 13px;
  line-height: 1.6;
}

/* Highlight.js Tokyo Night theme */
.viewer-markdown :deep(.hljs) { color: #a9b1d6; background: transparent; }
.viewer-markdown :deep(.hljs-keyword) { color: #bb9af7; }
.viewer-markdown :deep(.hljs-string) { color: #9ece6a; }
.viewer-markdown :deep(.hljs-number) { color: #ff9e64; }
.viewer-markdown :deep(.hljs-function) { color: #7aa2f7; }
.viewer-markdown :deep(.hljs-title) { color: #7aa2f7; }
.viewer-markdown :deep(.hljs-params) { color: #e0af68; }
.viewer-markdown :deep(.hljs-comment) { color: #565f89; font-style: italic; }
.viewer-markdown :deep(.hljs-built_in) { color: #7dcfff; }
.viewer-markdown :deep(.hljs-type) { color: #2ac3de; }
.viewer-markdown :deep(.hljs-attr) { color: #7aa2f7; }
.viewer-markdown :deep(.hljs-variable) { color: #c0caf5; }
.viewer-markdown :deep(.hljs-literal) { color: #ff9e64; }
.viewer-markdown :deep(.hljs-punctuation) { color: #89ddff; }
.viewer-markdown :deep(.hljs-meta) { color: #565f89; }

/* Images */
.viewer-markdown :deep(img) { max-width: 100%; border-radius: 6px; margin: 12px 0; }

/* ─── Raw code viewer (non-markdown files) ─── */
.viewer-code { max-width: 100%; }

.code-block {
  position: relative;
  background: #0f1219;
  border-radius: 8px;
  border: 1px solid #1e293b;
  overflow: hidden;
}
.code-lang {
  position: absolute;
  top: 8px;
  right: 12px;
  font-size: 10px;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-family: 'SF Mono', 'Fira Code', monospace;
}
.code-block pre {
  margin: 0;
  padding: 16px;
  overflow-x: auto;
}
.code-block code {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: #a9b1d6;
}
</style>
