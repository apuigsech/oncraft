import type { ImageAttachment } from '~/types';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';

const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

export function useImageAttachments() {
  const pendingAttachments = ref<ImageAttachment[]>([]);
  const isDragOver = ref(false);
  const toast = useToast();

  function addAttachmentFromFile(file: File): void {
    if (!SUPPORTED_TYPES.has(file.type)) {
      toast.add({ title: 'Unsupported image format', description: `${file.type || 'unknown'} is not supported. Use JPEG, PNG, GIF, or WebP.`, color: 'error' });
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      toast.add({ title: 'Image too large', description: `${(file.size / 1024 / 1024).toFixed(1)}MB exceeds the 20MB limit.`, color: 'error' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      if (!base64) return;
      pendingAttachments.value.push({
        id: crypto.randomUUID(),
        data: base64,
        mediaType: file.type as ImageAttachment['mediaType'],
        name: file.name || 'pasted-image.png',
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  }

  function removeAttachment(id: string): void {
    pendingAttachments.value = pendingAttachments.value.filter(a => a.id !== id);
  }

  function handlePaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          addAttachmentFromFile(file);
        }
      }
    }
  }

  function handleDragOver(event: DragEvent): void {
    event.preventDefault();
    isDragOver.value = true;
  }

  function handleDragLeave(): void {
    isDragOver.value = false;
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    isDragOver.value = false;
    const files = event.dataTransfer?.files;
    if (!files) return;
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        addAttachmentFromFile(file);
      }
    }
  }

  async function openFilePicker(): Promise<void> {
    try {
      const selected = await openDialog({
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
        multiple: true,
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const filePath of paths) {
        const bytes = await readFile(filePath);
        const ext = filePath.split('.').pop()?.toLowerCase() || '';
        const mediaTypeMap: Record<string, string> = {
          jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
          gif: 'image/gif', webp: 'image/webp',
        };
        const mediaType = mediaTypeMap[ext];
        if (!mediaType) continue;
        if (bytes.length > MAX_IMAGE_SIZE) {
          toast.add({ title: 'Image too large', description: `File exceeds the 20MB limit.`, color: 'error' });
          continue;
        }
        let binary = '';
        const chunk = 8192;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        const base64 = btoa(binary);
        const name = filePath.split('/').pop() || filePath.split('\\').pop() || 'image';
        pendingAttachments.value.push({
          id: crypto.randomUUID(),
          data: base64,
          mediaType: mediaType as ImageAttachment['mediaType'],
          name,
          size: bytes.length,
        });
      }
    } catch (err) {
      if (import.meta.dev) console.warn('[OnCraft] file picker error:', err);
    }
  }

  function consumeAttachments(): ImageAttachment[] {
    const imgs = [...pendingAttachments.value];
    pendingAttachments.value = [];
    return imgs;
  }

  return {
    pendingAttachments, isDragOver,
    addAttachmentFromFile, removeAttachment,
    handlePaste, handleDragOver, handleDragLeave, handleDrop,
    openFilePicker, consumeAttachments,
  };
}
