<script setup lang="ts">
import type { StreamMessage } from '~/types';
import { renderMarkdown } from '~/services/markdown';

const props = defineProps<{ message: StreamMessage }>();

const renderedContent = computed(() => {
  if (props.message.type === 'assistant') {
    return renderMarkdown(props.message.content);
  }
  return '';
});

const isThinking = computed(() => props.message.subtype === 'thinking');
const isStreaming = computed(() => props.message.subtype === 'streaming');
</script>

<template>
  <!-- Skip rendering entirely if there is nothing visible to show -->
  <div
    v-if="message.type === 'assistant' || message.type === 'user' || (message.type === 'system' && message.content)"
    class="chat-message"
    :class="[message.type, { thinking: isThinking, streaming: isStreaming }]"
  >
    <div v-if="message.type === 'assistant'" class="msg-bubble assistant" :class="{ thinking: isThinking }">
      <span class="msg-role">{{ isThinking ? 'Thinking...' : 'Claude' }}</span>
      <div class="msg-content markdown-body" v-html="renderedContent" />
    </div>
    <div v-else-if="message.type === 'user'" class="msg-bubble user">
      <span class="msg-role">You</span>
      <div class="msg-content">{{ message.content }}</div>
    </div>
    <div v-else-if="message.type === 'system' && message.content" class="msg-system">
      {{ message.content }}
    </div>
  </div>
</template>

<style scoped>
.msg-bubble { padding: 10px 14px; border-radius: 8px; max-width: 95%; }
.msg-bubble.assistant { background: var(--bg-secondary); align-self: flex-start; }
.msg-bubble.assistant.thinking { opacity: 0.7; border-left: 2px solid var(--text-muted); }
.msg-bubble.user { background: var(--accent); color: white; align-self: flex-end; margin-left: auto; }
.msg-role { font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px; display: block; }
.user .msg-role { color: rgba(255,255,255,0.7); }
.msg-content { font-size: 13px; line-height: 1.6; word-break: break-word; }
.user .msg-content { white-space: pre-wrap; }
.msg-system { font-size: 11px; color: var(--text-muted); text-align: center; padding: 4px; font-style: italic; }

/* Markdown rendering styles (unscoped via :deep) */
.markdown-body :deep(p) { margin: 0 0 8px 0; }
.markdown-body :deep(p:last-child) { margin-bottom: 0; }
.markdown-body :deep(strong) { font-weight: 700; }
.markdown-body :deep(em) { font-style: italic; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { margin: 4px 0 8px 20px; }
.markdown-body :deep(li) { margin-bottom: 2px; }
.markdown-body :deep(h1), .markdown-body :deep(h2), .markdown-body :deep(h3),
.markdown-body :deep(h4), .markdown-body :deep(h5) {
  margin: 12px 0 6px 0; font-weight: 700;
}
.markdown-body :deep(h1) { font-size: 1.3em; }
.markdown-body :deep(h2) { font-size: 1.15em; }
.markdown-body :deep(h3) { font-size: 1.05em; }
.markdown-body :deep(blockquote) {
  border-left: 3px solid var(--bg-tertiary); margin: 8px 0; padding: 4px 12px;
  color: var(--text-secondary);
}
.markdown-body :deep(hr) { border: none; border-top: 1px solid var(--bg-tertiary); margin: 12px 0; }
.markdown-body :deep(a) { color: var(--accent); text-decoration: none; }
.markdown-body :deep(a:hover) { text-decoration: underline; }
.markdown-body :deep(table) { border-collapse: collapse; margin: 8px 0; font-size: 12px; }
.markdown-body :deep(th), .markdown-body :deep(td) {
  border: 1px solid var(--bg-tertiary); padding: 4px 8px;
}
.markdown-body :deep(th) { background: var(--bg-tertiary); font-weight: 600; }

/* Code blocks */
.markdown-body :deep(.code-block) {
  position: relative; margin: 8px 0; border-radius: 6px; overflow: hidden;
  background: #1a1b26;
}
.markdown-body :deep(.code-block .code-lang) {
  position: absolute; top: 4px; right: 8px; font-size: 10px;
  color: #565f89; font-family: monospace;
}
.markdown-body :deep(.code-block pre) {
  margin: 0; padding: 12px; overflow-x: auto;
}
.markdown-body :deep(.code-block code) {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px; line-height: 1.5;
}
.markdown-body :deep(.inline-code) {
  background: var(--bg-tertiary); padding: 1px 5px; border-radius: 3px;
  font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px;
}

/* highlight.js token colors (Tokyo Night inspired) */
.markdown-body :deep(.hljs) { color: #a9b1d6; background: transparent; }
.markdown-body :deep(.hljs-keyword) { color: #bb9af7; }
.markdown-body :deep(.hljs-string) { color: #9ece6a; }
.markdown-body :deep(.hljs-number) { color: #ff9e64; }
.markdown-body :deep(.hljs-function) { color: #7aa2f7; }
.markdown-body :deep(.hljs-title) { color: #7aa2f7; }
.markdown-body :deep(.hljs-params) { color: #e0af68; }
.markdown-body :deep(.hljs-comment) { color: #565f89; font-style: italic; }
.markdown-body :deep(.hljs-built_in) { color: #7dcfff; }
.markdown-body :deep(.hljs-type) { color: #2ac3de; }
.markdown-body :deep(.hljs-attr) { color: #7aa2f7; }
.markdown-body :deep(.hljs-variable) { color: #c0caf5; }
.markdown-body :deep(.hljs-literal) { color: #ff9e64; }
.markdown-body :deep(.hljs-punctuation) { color: #89ddff; }
.markdown-body :deep(.hljs-meta) { color: #565f89; }
.markdown-body :deep(.hljs-selector-tag) { color: #bb9af7; }
.markdown-body :deep(.hljs-selector-class) { color: #9ece6a; }
.markdown-body :deep(.hljs-selector-id) { color: #7aa2f7; }
.markdown-body :deep(.hljs-tag) { color: #f7768e; }
.markdown-body :deep(.hljs-name) { color: #f7768e; }
.markdown-body :deep(.hljs-attribute) { color: #bb9af7; }
</style>
