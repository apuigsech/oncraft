/**
 * Anonymous telemetry service.
 * Opt-in only. Collects anonymous usage data per REQ-TEL-R1 through REQ-TEL-R5.
 *
 * PRIVACY (REQ-TEL-R2): NEVER collects project names, paths, file contents,
 * card names, chat content, API keys, IPs, or any PII.
 */

// ── Event types ──

interface AdoptionEvent {
  type: 'adoption';
  action: 'launch' | 'session_start' | 'session_end';
  installId: string;
  appVersion: string;
  os: string;
  timestamp: number;
  durationMs?: number;
}

interface FeatureUsageEvent {
  type: 'feature';
  feature: string;
  value: string | boolean | number;
  installId: string;
  appVersion: string;
  timestamp: number;
}

interface ErrorEvent {
  type: 'error';
  errorType: string;
  message: string;
  context: string;
  installId: string;
  appVersion: string;
  timestamp: number;
}

export type TelemetryEvent = AdoptionEvent | FeatureUsageEvent | ErrorEvent;

// ── Constants ──

const TELEMETRY_ENDPOINT = 'https://telemetry.oncraft.dev/v1/events';
const MAX_QUEUE_SIZE = 100;
const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ── State ──

let eventQueue: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;

// ── Sanitization (REQ-TEL-R2) ──

export function sanitizeErrorMessage(msg: string): string {
  return msg
    // Strip absolute paths (Unix, Windows drive, UNC)
    .replace(/(?:[A-Z]:)?[/\\][\w\-./\\]+/g, '<path>')
    // Strip home-relative paths (~/...)
    .replace(/~\/[\w\-./]+/g, '<path>')
    // Strip relative paths that look like file references (e.g. src/foo.ts, ../../bar.js)
    .replace(/(?:\.\.?\/)+[\w\-./]+\.\w{1,5}/g, '<path>')
    // Strip bare module-style paths (e.g. app/services/foo.ts, components/Bar.vue)
    .replace(/\b\w+(?:\/\w+)+\.\w{1,5}\b/g, '<path>')
    // Strip API keys (Anthropic, OpenAI, generic)
    .replace(/sk-[a-zA-Z0-9]{10,}/g, '<key>')
    .replace(/sk-ant-[a-zA-Z0-9\-]{10,}/g, '<key>')
    // Strip anything that looks like a token/secret
    .replace(/(?:key|token|secret|password|credential)s?\s*[:=]\s*\S+/gi, '<redacted>')
    // Truncate
    .slice(0, 200);
}

export function sanitizeStackTrace(stack: string): string {
  // Keep only "at FunctionName (line:col)" patterns, strip file paths
  return stack
    .split('\n')
    .map(line => {
      const match = line.match(/at\s+([\w.<>[\]]+)/);
      return match ? `at ${match[1]}` : null;
    })
    .filter(Boolean)
    .slice(0, 10)
    .join('\n');
}

// ── Settings access ──
// Uses Nuxt auto-imported useSettingsStore() — same pattern as claude-process.ts
// Wrapped in try-catch to handle very early errors before Pinia is initialized.

function getSettings() {
  try {
    return useSettingsStore();
  } catch {
    return null;
  }
}

function getAppVersion(): string {
  return (import.meta.env?.PACKAGE_VERSION as string) ?? 'dev';
}

function getOS(): string {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent;
    if (ua.includes('Mac')) return 'macOS';
    if (ua.includes('Windows')) return 'Windows';
    if (ua.includes('Linux')) return 'Linux';
  }
  return 'unknown';
}

// ── Install ID management ──

export function getOrCreateInstallId(): string {
  const store = getSettings();
  if (!store) return '';
  if (store.settings.telemetryInstallId) {
    return store.settings.telemetryInstallId;
  }
  const id = crypto.randomUUID();
  store.settings.telemetryInstallId = id;
  store.save();
  return id;
}

// ── Opt-in state ──

export function isEnabled(): boolean {
  const store = getSettings();
  if (!store) return false;
  return store.settings.telemetryEnabled === true;
}

export function setEnabled(enabled: boolean): void {
  const store = getSettings();
  if (!store) return;
  store.settings.telemetryEnabled = enabled;
  if (enabled) {
    getOrCreateInstallId();
    startFlushTimer();
  } else {
    eventQueue = [];
    stopFlushTimer();
  }
  store.save();
}

// ── Core tracking ──

function track(event: TelemetryEvent): void {
  if (!isEnabled()) return;
  eventQueue.push(event);
  if (eventQueue.length > MAX_QUEUE_SIZE) {
    eventQueue = eventQueue.slice(-MAX_QUEUE_SIZE);
  }
}

// ── Flush timer helpers ──

function startFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
}

function stopFlushTimer(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

// ── Flush ──

let flushing = false;

export async function flush(): Promise<void> {
  if (eventQueue.length === 0 || flushing) return;
  flushing = true;
  const batch = [...eventQueue];
  try {
    const response = await fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    });
    if (response.ok) {
      // Remove only the events we sent (new ones may have arrived during flush)
      eventQueue = eventQueue.slice(batch.length);
    }
    // On non-ok response, keep events for retry
  } catch {
    // Offline or endpoint not available — keep events for next flush
  } finally {
    flushing = false;
  }
}

// ── Convenience methods ──

export function trackLaunch(): void {
  track({
    type: 'adoption',
    action: 'launch',
    installId: getOrCreateInstallId(),
    appVersion: getAppVersion(),
    os: getOS(),
    timestamp: Date.now(),
  });
}

export function trackSessionStart(): void {
  track({
    type: 'adoption',
    action: 'session_start',
    installId: getOrCreateInstallId(),
    appVersion: getAppVersion(),
    os: getOS(),
    timestamp: Date.now(),
  });
}

export function trackSessionEnd(durationMs: number): void {
  track({
    type: 'adoption',
    action: 'session_end',
    installId: getOrCreateInstallId(),
    appVersion: getAppVersion(),
    os: getOS(),
    timestamp: Date.now(),
    durationMs,
  });
}

export function trackFeature(feature: string, value: string | boolean | number): void {
  track({
    type: 'feature',
    feature,
    value,
    installId: getOrCreateInstallId(),
    appVersion: getAppVersion(),
    timestamp: Date.now(),
  });
}

export function trackError(error: unknown, context: string): void {
  if (!isEnabled()) return;

  let errorType = 'unknown';
  let message = 'unknown error';

  if (error instanceof Error) {
    errorType = error.constructor.name;
    message = sanitizeErrorMessage(error.message);
  } else if (typeof error === 'string') {
    errorType = 'string';
    message = sanitizeErrorMessage(error);
  } else {
    message = sanitizeErrorMessage(String(error));
  }

  track({
    type: 'error',
    errorType,
    message,
    context,
    installId: getOrCreateInstallId(),
    appVersion: getAppVersion(),
    timestamp: Date.now(),
  });
}

// ── Lifecycle ──

export function initTelemetry(): void {
  if (initialized) return;

  if (!isEnabled()) return;

  initialized = true;
  getOrCreateInstallId();
  trackLaunch();
  startFlushTimer();
}

export function shutdownTelemetry(): void {
  stopFlushTimer();
  flush(); // Best-effort final flush
  initialized = false;
}

// ── Queue access (for "View Telemetry Data" UI) ──

export function getEventQueue(): readonly TelemetryEvent[] {
  return eventQueue;
}

export function getInstallId(): string | undefined {
  const store = getSettings();
  return store?.settings.telemetryInstallId || undefined;
}
