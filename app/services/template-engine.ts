import type { TemplateContext } from '~/types';

function getNestedValue(obj: unknown, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (current === null || current === undefined) return undefined;
  return String(current);
}

export function resolveTemplate(
  template: string,
  context: TemplateContext,
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const value = getNestedValue(context, path);
    return value !== undefined ? value : _match;
  });
}
