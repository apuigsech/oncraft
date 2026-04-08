interface PendingUtilRequest {
  expectedType: string;
  resolve: (data: Record<string, unknown>) => void;
}

export interface UtilRequestTracker {
  register: (
    requestId: string,
    expectedType: string,
    resolve: (data: Record<string, unknown>) => void,
  ) => void;
  resolveFromLine: (line: string) => boolean;
  rejectAll: (error: string) => void;
}

export function createUtilRequestTracker(): UtilRequestTracker {
  const pendingByRequestId = new Map<string, PendingUtilRequest>();

  function register(
    requestId: string,
    expectedType: string,
    resolve: (data: Record<string, unknown>) => void,
  ): void {
    pendingByRequestId.set(requestId, { expectedType, resolve });
  }

  function resolveFromLine(line: string): boolean {
    if (!line.trim()) return false;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const requestId = parsed.requestId as string | undefined;
      if (!requestId) return false;
      const pending = pendingByRequestId.get(requestId);
      if (!pending) return false;
      if (typeof parsed.type === 'string' && parsed.type !== pending.expectedType) {
        return false;
      }
      pendingByRequestId.delete(requestId);
      pending.resolve(parsed);
      return true;
    } catch {
      return false;
    }
  }

  function rejectAll(error: string): void {
    for (const [requestId, pending] of pendingByRequestId) {
      pending.resolve({
        type: pending.expectedType,
        requestId,
        error,
      });
    }
    pendingByRequestId.clear();
  }

  return {
    register,
    resolveFromLine,
    rejectAll,
  };
}
