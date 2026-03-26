/**
 * Global error handler plugin.
 * Catches unhandled Vue errors, window errors, and unhandled promise rejections.
 * Logs locally and dispatches to telemetry (no-op until Phase 7 wires it up).
 */
export default defineNuxtPlugin((nuxtApp) => {
  // Telemetry dispatch stub — replaced in Phase 7
  const dispatchToTelemetry = (_error: unknown, _context?: string) => {
    // no-op until telemetry service is implemented
  }

  // Vue component errors
  nuxtApp.vueApp.config.errorHandler = (err, instance, info) => {
    console.error('[OnCraft] Vue error:', err, '\nInfo:', info)
    dispatchToTelemetry(err, `vue:${info}`)
  }

  // Global unhandled errors
  if (typeof window !== 'undefined') {
    window.onerror = (message, source, lineno, colno, error) => {
      console.error('[OnCraft] Global error:', message, source, lineno, colno)
      dispatchToTelemetry(error || message, 'window.onerror')
      // Don't show intrusive UI for errors the user can't act on
      return false
    }

    window.onunhandledrejection = (event: PromiseRejectionEvent) => {
      console.error('[OnCraft] Unhandled rejection:', event.reason)
      dispatchToTelemetry(event.reason, 'unhandledrejection')
    }
  }
})
