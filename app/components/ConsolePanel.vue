<script setup lang="ts">
// xterm.js and Tauri APIs are loaded dynamically in onMounted to avoid
// SSR / prerender context issues (useHead() called outside setup).
type XTerminal = import('@xterm/xterm').Terminal;
type XFitAddon = import('@xterm/addon-fit').FitAddon;
type UnlistenFn = () => void;

const sessionsStore = useSessionsStore();
const cardsStore = useCardsStore();
const projectsStore = useProjectsStore();

const terminalRef = ref<HTMLDivElement | null>(null);
const connected = ref(false);
const error = ref<string | null>(null);

let terminal: XTerminal | null = null;
let fitAddon: XFitAddon | null = null;
let unlistenOutput: UnlistenFn | null = null;
let unlistenExit: UnlistenFn | null = null;
let resizeObserver: ResizeObserver | null = null;
let currentPtyId: string | null = null;
// Cache the dynamically-imported invoke so it's available to all helpers
let invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
// Buffer to capture early PTY output and extract session ID
let outputBuffer = '';
let sessionIdCaptured = false;

const card = computed(() => {
  if (!sessionsStore.activeChatCardId) return null;
  return cardsStore.cards.find(c => c.id === sessionsStore.activeChatCardId) || null;
});

// Build the claude CLI args from the card's session config
function buildClaudeArgs(): string[] {
  const args: string[] = [];
  if (!sessionsStore.activeChatCardId) return args;

  const config = sessionsStore.getSessionConfig(sessionsStore.activeChatCardId);
  const cardData = card.value;

  // Resume existing session. The CLI and SDK share the same session storage
  // in ~/.claude/projects/<hashed-cwd>/, so we can resume sidecar sessions too
  // as long as the cwd matches.
  if (cardData?.sessionId && !cardData.sessionId.startsWith('pending-')) {
    args.push('--resume', cardData.sessionId);
  }

  // Model
  if (config.model) {
    args.push('--model', config.model);
  }

  return args;
}

async function spawnPty() {
  if (!invoke) return;
  if (!sessionsStore.activeChatCardId) return;
  const project = projectsStore.activeProject;
  if (!project) {
    error.value = 'No active project';
    return;
  }

  const ptyId = `console-${sessionsStore.activeChatCardId}`;
  const args = buildClaudeArgs();

  // Reset session ID capture for the new PTY
  outputBuffer = '';
  sessionIdCaptured = false;

  // Resolve the correct cwd: if the card uses a worktree, launch inside it.
  // Worktrees live at <project.path>/.claude/worktrees/<worktreeName>/
  const cardData = card.value;
  let cwd = project.path;
  if (cardData?.useWorktree && cardData.worktreeName) {
    cwd = `${project.path}/.claude/worktrees/${cardData.worktreeName}`;
  }

  try {
    await invoke('pty_spawn', {
      id: ptyId,
      cmd: 'claude',
      args,
      cwd,
      cols: terminal?.cols || 80,
      rows: terminal?.rows || 24,
      envVars: { TERM: 'xterm-256color' },
    });

    currentPtyId = ptyId;
    connected.value = true;
    error.value = null;
  } catch (err) {
    error.value = `Failed to spawn Claude CLI: ${err}`;
    connected.value = false;
  }
}

async function killPty() {
  if (currentPtyId && invoke) {
    try {
      await invoke('pty_kill', { id: currentPtyId });
    } catch {
      // Already dead
    }
    currentPtyId = null;
    connected.value = false;
  }
}

async function restart() {
  await killPty();
  if (terminal) {
    terminal.clear();
    terminal.write('\x1b[90mRestarting Claude CLI...\x1b[0m\r\n\r\n');
  }
  await spawnPty();
}

// Lifecycle — all browser-only imports happen here
onMounted(async () => {
  // Dynamic imports: xterm + Tauri APIs (client-only)
  const [
    { Terminal },
    { FitAddon },
    { WebLinksAddon },
    { invoke: tauriInvoke },
    { listen },
  ] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
    import('@xterm/addon-web-links'),
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
  ]);

  // Inject xterm CSS dynamically
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('@xterm/xterm/css/xterm.css', import.meta.url).href;
  // Fallback: if the URL resolution fails (bundler), try inserting the CSS inline
  try {
    const cssModule = await import('@xterm/xterm/css/xterm.css?inline');
    const style = document.createElement('style');
    style.textContent = cssModule.default;
    document.head.appendChild(style);
  } catch {
    // CSS may already be bundled, that's OK
  }

  invoke = tauriInvoke as typeof invoke;

  if (!terminalRef.value) return;

  // Create terminal instance
  terminal = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace",
    theme: {
      background: '#1a1b26',
      foreground: '#a9b1d6',
      cursor: '#c0caf5',
      selectionBackground: '#33467c',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#f7768e',
      brightGreen: '#9ece6a',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#c0caf5',
    },
    allowProposedApi: true,
    scrollback: 10000,
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());

  terminal.open(terminalRef.value);
  fitAddon.fit();

  // Forward keystrokes to PTY
  terminal.onData(async (data: string) => {
    if (currentPtyId && connected.value && invoke) {
      try {
        await invoke('pty_write', { id: currentPtyId, data });
      } catch {
        // PTY may have died
      }
    }
  });

  // Handle resize
  terminal.onResize(async ({ cols, rows }) => {
    if (currentPtyId && connected.value && invoke) {
      try {
        await invoke('pty_resize', { id: currentPtyId, cols, rows });
      } catch {
        // PTY may have died
      }
    }
  });

  // Use ResizeObserver to fit terminal when panel resizes
  resizeObserver = new ResizeObserver(() => {
    if (fitAddon) {
      fitAddon.fit();
    }
  });
  resizeObserver.observe(terminalRef.value);

  // Listen for PTY output
  unlistenOutput = await listen<{ id: string; data: string }>('pty-output', (event) => {
    if (event.payload.id === currentPtyId && terminal) {
      terminal.write(event.payload.data);

      // Try to capture the session ID from early Claude CLI output.
      // The CLI prints the session ID in its initial output, often as a UUID.
      // We strip ANSI escapes and look for a UUID pattern in the first ~4KB of output.
      if (!sessionIdCaptured && sessionsStore.activeChatCardId) {
        outputBuffer += event.payload.data;
        // Strip ANSI escape sequences for pattern matching
        const clean = outputBuffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
        // Claude CLI outputs session ID as a UUID — look for it
        const uuidMatch = clean.match(/session:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        if (uuidMatch) {
          sessionIdCaptured = true;
          const capturedId = uuidMatch[1];
          cardsStore.updateCardConsoleSessionId(sessionsStore.activeChatCardId, capturedId);
        }
        // Stop buffering after a reasonable amount
        if (outputBuffer.length > 4096) {
          sessionIdCaptured = true;
        }
      }
    }
  });

  // Listen for PTY exit
  unlistenExit = await listen<{ id: string; code: number | null }>('pty-exit', (event) => {
    if (event.payload.id === currentPtyId) {
      connected.value = false;
      if (terminal) {
        terminal.write('\r\n\x1b[90m--- Session ended ---\x1b[0m\r\n');
      }
    }
  });

  // Spawn the PTY
  await spawnPty();
});

onBeforeUnmount(async () => {
  await killPty();
  unlistenOutput?.();
  unlistenExit?.();
  resizeObserver?.disconnect();
  terminal?.dispose();
});

// Watch for card changes — respawn if the active card changes
watch(() => sessionsStore.activeChatCardId, async (newId, oldId) => {
  if (newId && newId !== oldId) {
    await killPty();
    if (terminal) {
      terminal.clear();
    }
    await spawnPty();
  }
});
</script>

<template>
  <div class="console-panel">
    <!-- Header -->
    <div class="console-header">
      <div class="console-title">
        <UIcon name="i-lucide-terminal" class="title-icon" />
        <strong>{{ card?.name || 'Console' }}</strong>
        <UBadge v-if="card?.columnName" variant="soft" color="neutral" size="sm">
          {{ card.columnName }}
        </UBadge>
        <UBadge v-if="connected" variant="soft" color="success" size="sm">
          connected
        </UBadge>
        <UBadge v-else variant="soft" color="error" size="sm">
          disconnected
        </UBadge>
      </div>
      <div class="header-actions">
        <UButton
          variant="ghost"
          color="neutral"
          size="xs"
          icon="i-lucide-rotate-cw"
          @click="restart"
          title="Restart Claude CLI"
        />
        <UButton
          variant="ghost"
          color="neutral"
          size="sm"
          icon="i-lucide-x"
          :padded="false"
          @click="sessionsStore.closeChat()"
        />
      </div>
    </div>

    <!-- Error banner -->
    <div v-if="error" class="error-banner">
      <UIcon name="i-lucide-alert-triangle" />
      <span>{{ error }}</span>
      <UButton variant="link" color="error" size="xs" @click="restart">Retry</UButton>
    </div>

    <!-- Terminal -->
    <div ref="terminalRef" class="terminal-container" />
  </div>
</template>

<style scoped>
.console-panel {
  min-width: 320px;
  max-width: 800px;
  border-left: 1px solid var(--border);
  background: #1a1b26;
  display: flex;
  flex-direction: column;
}

.console-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-secondary);
}

.console-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.title-icon {
  width: 16px;
  height: 16px;
  color: var(--text-secondary);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: color-mix(in srgb, var(--error, #f7768e) 10%, var(--bg-secondary));
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--error, #f7768e);
}

.terminal-container {
  flex: 1;
  padding: 4px;
  overflow: hidden;
}

/* Ensure xterm fills the container */
.terminal-container :deep(.xterm) {
  height: 100%;
}
.terminal-container :deep(.xterm-viewport) {
  overflow-y: auto !important;
}
</style>
