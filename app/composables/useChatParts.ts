import type { ChatPart, VerbosityLevel } from '~/types';
import { registry } from '~/services/chat-part-registry';

const VERBOSITY_ORDER: Record<VerbosityLevel, number> = { quiet: 0, normal: 1, verbose: 2 };

export function useChatParts(cardId: Ref<string | null>) {
  const sessionsStore = useSessionsStore();

  const allParts = computed(() => {
    if (!cardId.value) return [];
    return sessionsStore.getMessages(cardId.value); // returns ChatPart[]
  });

  const verbosity = computed(() => {
    if (!cardId.value) return 'normal' as VerbosityLevel;
    return sessionsStore.getSessionConfig(cardId.value).verbosity;
  });

  const verbosityLevel = computed(() => VERBOSITY_ORDER[verbosity.value]);

  // Filter parts by verbosity: only show parts whose definition verbosity <= current level
  function isVisible(part: ChatPart): boolean {
    const def = registry[part.kind] || registry['_default'];
    return VERBOSITY_ORDER[def.verbosity] <= verbosityLevel.value;
  }

  const headerParts = computed(() => {
    // Deduplicate by kind — latest per kind only
    const byKind = new Map<string, ChatPart>();
    for (const p of allParts.value) {
      if (p.placement === 'header' && isVisible(p)) byKind.set(p.kind, p);
    }
    return Array.from(byKind.values());
  });

  const inlineParts = computed(() => {
    return allParts.value.filter(p =>
      (p.placement === 'inline' && isVisible(p)) ||
      (p.placement === 'action-bar' && p.resolved),
    );
  });

  const actionBarParts = computed(() => {
    // FIFO: oldest unresolved action-bar part
    return allParts.value.find(p =>
      p.placement === 'action-bar' && !p.resolved && isVisible(p),
    ) || null;
  });

  const progressParts = computed(() => {
    return allParts.value.filter(p => p.placement === 'progress');
  });

  const isActive = computed(() => {
    if (!cardId.value) return false;
    return sessionsStore.isActive(cardId.value);
  });

  const chatStatus = computed(() => {
    if (!isActive.value) return 'ready' as const;
    const last = inlineParts.value[inlineParts.value.length - 1];
    if (last?.kind === 'assistant' && last.data.streaming) return 'streaming' as const;
    return 'submitted' as const;
  });

  return { headerParts, inlineParts, actionBarParts, progressParts, chatStatus, isActive, allParts };
}
