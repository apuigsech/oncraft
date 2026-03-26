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
const showSuggestions = ref(false);

const filteredFiles = computed(() => {
  const q = inputValue.value.toLowerCase();
  if (!q) return fileList.value.slice(0, 20);
  return fileList.value.filter(f => f.toLowerCase().includes(q)).slice(0, 20);
});

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

function selectSuggestion(path: string) {
  inputValue.value = path;
  showSuggestions.value = false;
}

function onFocus() {
  showSuggestions.value = true;
}

function onBlur() {
  // Delay to allow click on suggestion
  setTimeout(() => { showSuggestions.value = false; }, 150);
}

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
      <div class="input-wrapper">
        <UInput
          v-model="inputValue"
          size="xs"
          class="file-input"
          :placeholder="placeholder"
          @focus="onFocus"
          @blur="onBlur"
        />
        <div v-if="showSuggestions && filteredFiles.length > 0" class="suggestions">
          <div
            v-for="file in filteredFiles"
            :key="file"
            class="suggestion-item"
            @mousedown.prevent="selectSuggestion(file)"
          >{{ file }}</div>
        </div>
      </div>
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
.input-wrapper { position: relative; flex: 1; }
.file-input { font-family: 'SF Mono', 'Fira Code', monospace; }

.suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 160px;
  overflow-y: auto;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  z-index: 10;
  margin-top: 2px;
}
.suggestion-item {
  padding: 4px 8px;
  font-size: 11px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.suggestion-item:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}
</style>
