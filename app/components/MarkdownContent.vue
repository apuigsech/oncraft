<script setup lang="ts">
import { renderMarkdown, useDebouncedMarkdown } from '~/services/markdown';

const props = defineProps<{
  text: string;
  streaming?: boolean;
}>();

// QW-5: Debounce markdown parsing during streaming to avoid
// re-parsing the full content on every token arrival.
const debouncedHtml = useDebouncedMarkdown(
  () => props.streaming ? props.text : '',
  80,
);

const html = computed(() => {
  if (props.streaming) return debouncedHtml.value;
  return props.text ? renderMarkdown(props.text) : '';
});
</script>

<template>
  <div class="markdown-body" v-html="html" />
</template>
