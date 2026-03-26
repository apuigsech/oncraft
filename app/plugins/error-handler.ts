/**
 * Global error handler plugin.
 * Catches unhandled Vue errors, window errors, and unhandled promise rejections.
 * Logs locally and dispatches to telemetry when opted in.
 */
import { trackError } from '~/services/telemetry'

export default defineNuxtPlugin((nuxtApp) => {
  // Dispatch to telemetry service (checks opt-in internally)
  const dispatchToTelemetry = (error: unknown, context?: string) => {
    trackError(error, context || 'unknown')
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
