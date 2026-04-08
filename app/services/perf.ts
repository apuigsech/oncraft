type PerfMeta = Record<string, unknown>;

interface PerfSample {
  phase: string;
  ms: number;
  meta?: PerfMeta;
  ts: string;
}

const ENABLED = import.meta.dev;
const _samples: PerfSample[] = [];

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function perfStart(_phase: string): number {
  return now();
}

export function perfEnd(phase: string, startMs: number, meta?: PerfMeta): void {
  if (!ENABLED) return;
  const ms = Math.max(0, now() - startMs);
  const sample: PerfSample = { phase, ms, ...(meta ? { meta } : {}), ts: new Date().toISOString() };
  _samples.push(sample);
  // Keep memory bounded while preserving latest context
  if (_samples.length > 500) _samples.splice(0, _samples.length - 500);
  console.log(`[OnCraft][perf] ${phase}: ${ms.toFixed(1)}ms`, meta || '');
}

export async function perfWrap<T>(
  phase: string,
  fn: () => Promise<T>,
  meta?: PerfMeta,
): Promise<T> {
  const start = perfStart(phase);
  try {
    return await fn();
  } finally {
    perfEnd(phase, start, meta);
  }
}

export function getPerfSamples(): PerfSample[] {
  return _samples.slice();
}

