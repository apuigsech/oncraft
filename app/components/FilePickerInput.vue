<script setup lang="ts">
import { open } from '@tauri-apps/plugin-dialog';
import { readDir } from '@tauri-apps/plugin-fs';

const props = withDefaults(defineProps<{
  modelValue: string;
  projectPath: string;
  placeholder?: string;
}>(), { placeholder: 'path (e.g. docs/plan.md)' });

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const inputValue = computed({
  get: () => props.modelValue,
  set: (v: string) => emit('update:modelValue', v),
});

// File list cache for autocomplete (top 2 levels)
const fileList = ref<string[]>([]);

async function loadFileList() {
  if (!props.projectPath) return;
  const files: string[] = [];
  try {
    const entries = await readDir(props.projectPath);
    for (const entry of entries) {
      if (entry.name?.startsWith('.')) continue;
      if (entry.isFile) {
        files.push(entry.name!);
      } else if (entry.isDirectory) {
        try {
          const subEntries = await readDir(`${props.projectPath}/${entry.name}`);
          for (const sub of subEntries) {
            if (sub.name?.startsWith('.')) continue;
            if (sub.isFile) {
              files.push(`${entry.name}/${sub.name}`);
            }
          }
        } catch { /* ignore unreadable subdirs */ }
      }
    }
  } catch { /* ignore errors */ }
  fileList.value = files.sort();
}

onMounted(loadFileList);

async function browseFile() {
  const selected = await open({
    defaultPath: props.projectPath,
    multiple: false,
    directory: false,
  });
  if (!selected) return;
  const abs = typeof selected === 'string' ? selected : String(selected);
  // Convert to relative path if within project
  const prefix = props.projectPath.endsWith('/') ? props.projectPath : props.projectPath + '/';
  const relative = abs.startsWith(prefix) ? abs.slice(prefix.length) : abs;
  inputValue.value = relative;
}
</script>

<template>
  <div class="file-picker-input">
    <div class="file-picker-row">
      <UInputMenu
        v-model="inputValue"
        :items="fileList"
        autocomplete
        size="xs"
        class="file-input"
        :placeholder="placeholder"
        :content="{ hideWhenEmpty: true }"
        :trailing-icon="false"
      />
      <UButton
        variant="ghost"
        color="neutral"
        size="xs"
        icon="i-lucide-folder-open"
        title="Browse..."
        @click="browseFile"
      />
    </div>
  </div>
</template>

<style scoped>
.file-picker-input { position: relative; }
.file-picker-row { display: flex; gap: 4px; align-items: center; }
.file-input { flex: 1; font-family: 'SF Mono', 'Fira Code', monospace; }
</style>
