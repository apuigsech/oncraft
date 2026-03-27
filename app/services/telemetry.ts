/**
 * Anonymous telemetry service powered by Aptabase.
 * Opt-in only. Collects anonymous usage data per REQ-TEL-R1 through REQ-TEL-R5.
 *
 * PRIVACY (REQ-TEL-R2): NEVER collects project names, paths, file contents,
 * card names, chat content, API keys, IPs, or any PII.
 *
 * Uses the Aptabase API directly (no SDK dependency).
 * Docs: https://github.com/aptabase/aptabase/wiki/How-to-build-your-own-SDK
 */

// ── Aptabase config ──

const APTABASE_KEY = 'A-EU-7005477805';
const APTABASE_HOST = 'https://eu.aptabase.com';
const APTABASE_URL = `${APTABASE_HOST}/api/v0/events`;
const SDK_VERSION = 'oncraft-telemetry/1.0.0';
const MAX_QUEUE_SIZE = 25; // Aptabase max batch size
const FLUSH_INTERVAL_MS = 60 * 1000; // 1 minute

// ── Aptabase event shape ──

interface AptabaseEvent {
  timestamp: string;
  sessionId: string;
  eventName: string;
  systemProps: {
    locale?: string;
    osName?: string;
    osVersion?: string;
    isDebug: boolean;
    appVersion: string;
    sdkVersion: string;
  };
  props?: Record<string, string | number | boolean>;
}

// Public type for "View Telemetry Data" UI
export interface TelemetryEvent {
  eventName: string;
  props?: Record<string, string | number | boolean>;
  timestamp: string;
}

// ── State ──

let eventQueue: AptabaseEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;
let sessionId = '';

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

// ── Settings access ──
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

function getOSName(): string {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent;
    if (ua.includes('Mac')) return 'macOS';
    if (ua.includes('Windows')) return 'Windows';
    if (ua.includes('Linux')) return 'Linux';
  }
  return 'unknown';
}

function getLocale(): string {
  if (typeof navigator !== 'undefined') {
    return navigator.language || 'en';
  }
  return 'en';
}

function generateSessionId(): string {
  const epoch = Math.floor(Date.now() / 1000);
  const rand = Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
  return `${epoch}${rand}`;
}

function getSystemProps(): AptabaseEvent['systemProps'] {
  return {
    locale: getLocale(),
    osName: getOSName(),
    isDebug: import.meta.dev ?? false,
    appVersion: getAppVersion(),
    sdkVersion: SDK_VERSION,
  };
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

function track(eventName: string, props?: Record<string, string | number | boolean>): void {
  if (!isEnabled()) return;
  if (!sessionId) sessionId = generateSessionId();

  const event: AptabaseEvent = {
    timestamp: new Date().toISOString(),
    sessionId,
    eventName,
    systemProps: getSystemProps(),
    props,
  };

  eventQueue.push(event);
  if (eventQueue.length >= MAX_QUEUE_SIZE) {
    flush();
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
  const batch = eventQueue.splice(0, MAX_QUEUE_SIZE);
  try {
    const response = await fetch(APTABASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'App-Key': APTABASE_KEY,
      },
      credentials: 'omit',
      body: JSON.stringify(batch),
    });
    if (!response.ok) {
      // Put events back for retry
      eventQueue.unshift(...batch);
    }
  } catch {
    // Offline — put events back for retry
    eventQueue.unshift(...batch);
  } finally {
    flushing = false;
  }
}

// ── Convenience methods ──

export function trackLaunch(): void {
  track('app_launched');
}

export function trackSessionStart(): void {
  track('session_started');
}

export function trackSessionEnd(durationMs: number): void {
  track('session_ended', { duration_ms: durationMs });
}

export function trackFeature(feature: string, value: string | boolean | number): void {
  track('feature_used', { feature, value });
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

  track('error_occurred', { error_type: errorType, message, context });
}

// ── Lifecycle ──

export function initTelemetry(): void {
  if (initialized) return;

  if (!isEnabled()) return;

  initialized = true;
  sessionId = generateSessionId();
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
  return eventQueue.map(e => ({
    eventName: e.eventName,
    props: e.props,
    timestamp: e.timestamp,
  }));
}

export function getInstallId(): string | undefined {
  const store = getSettings();
  return store?.settings.telemetryInstallId || undefined;
}
