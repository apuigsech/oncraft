import type { TemplateContext } from '../types';

export function resolveTemplate(
  template: string, context: TemplateContext
): string {
  return template.replace(/\{\{(\w+)\.(\w+)\}\}/g, (_match, group, key) => {
    const obj = context[group as keyof TemplateContext];
    if (obj && typeof obj === 'object' && key in obj) {
      return String((obj as Record<string, unknown>)[key]);
    }
    return _match;
  });
}
