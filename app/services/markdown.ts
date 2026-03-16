import { marked } from 'marked';
import hljs from 'highlight.js/lib/core';

// Register only common languages to keep bundle small
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import markdown from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('vue', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);

const renderer = new marked.Renderer();

// Custom code block renderer with syntax highlighting
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  let highlighted: string;
  if (lang && hljs.getLanguage(lang)) {
    highlighted = hljs.highlight(text, { language: lang }).value;
  } else {
    highlighted = hljs.highlightAuto(text).value;
  }
  const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
  return `<div class="code-block">${langLabel}<pre><code class="hljs">${highlighted}</code></pre></div>`;
};

// Inline code
renderer.codespan = function ({ text }: { text: string }) {
  return `<code class="inline-code">${text}</code>`;
};

marked.setOptions({ renderer, breaks: true });

export function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string;
}

// QW-5: Debounced markdown rendering for streaming content.
// Returns a ref that updates at most every `delayMs` while the source keeps changing,
// avoiding re-parsing the full markdown on every token (~10-20/s during streaming).
export function useDebouncedMarkdown(source: () => string, delayMs = 80) {
  const rendered = ref('');
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSource = '';

  function flush() {
    timer = null;
    const text = source();
    if (text !== lastSource) {
      lastSource = text;
      rendered.value = text ? renderMarkdown(text) : '';
    }
  }

  watch(source, (text) => {
    // Immediate render if empty → non-empty (first content)
    if (!lastSource && text) {
      lastSource = text;
      rendered.value = renderMarkdown(text);
      return;
    }
    // Debounce subsequent updates
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  }, { immediate: true });

  // Final flush on scope dispose to ensure last content is rendered
  onScopeDispose(() => {
    if (timer) {
      clearTimeout(timer);
      flush();
    }
  });

  return rendered;
}
