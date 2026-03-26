// ME-5: Lazy-load marked + highlight.js on first use.
// These are large dependencies (~400KB hljs, ~80KB marked) that are not needed
// until the user actually opens a chat panel with assistant messages.

type MarkedModule = typeof import('marked');
type HljsModule = typeof import('highlight.js/lib/core');

let _marked: MarkedModule['marked'] | null = null;
let _hljs: HljsModule['default'] | null = null;
let _initPromise: Promise<void> | null = null;

async function _initMarkdownEngine(): Promise<void> {
  if (_marked && _hljs) return;
  if (_initPromise) { await _initPromise; return; }

  _initPromise = (async () => {
    const [markedMod, hljsMod] = await Promise.all([
      import('marked'),
      import('highlight.js/lib/core'),
    ]);

    _marked = markedMod.marked;
    _hljs = hljsMod.default;

    // Register languages in parallel
    const langs = await Promise.all([
      import('highlight.js/lib/languages/javascript'),
      import('highlight.js/lib/languages/typescript'),
      import('highlight.js/lib/languages/python'),
      import('highlight.js/lib/languages/bash'),
      import('highlight.js/lib/languages/json'),
      import('highlight.js/lib/languages/css'),
      import('highlight.js/lib/languages/xml'),
      import('highlight.js/lib/languages/yaml'),
      import('highlight.js/lib/languages/rust'),
      import('highlight.js/lib/languages/sql'),
      import('highlight.js/lib/languages/markdown'),
    ]);

    const names: [string, number][] = [
      ['javascript', 0], ['js', 0],
      ['typescript', 1], ['ts', 1],
      ['python', 2], ['py', 2],
      ['bash', 3], ['sh', 3], ['shell', 3],
      ['json', 4], ['css', 5],
      ['html', 6], ['xml', 6], ['vue', 6],
      ['yaml', 7], ['yml', 7],
      ['rust', 8], ['rs', 8],
      ['sql', 9],
      ['markdown', 10], ['md', 10],
    ];
    for (const [name, idx] of names) {
      _hljs!.registerLanguage(name, langs[idx].default);
    }

    // Configure marked renderer
    const renderer = new _marked!.Renderer();

    // HTML-escape helper for code content (prevents raw HTML injection in code spans)
    const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
      let highlighted: string;
      if (lang && _hljs!.getLanguage(lang)) {
        highlighted = _hljs!.highlight(text, { language: lang }).value;
      } else {
        highlighted = _hljs!.highlightAuto(text).value;
      }
      const langLabel = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
      return `<div class="code-block">${langLabel}<pre><code class="hljs">${highlighted}</code></pre></div>`;
    };

    renderer.codespan = function ({ text }: { text: string }) {
      return `<code class="inline-code">${escapeHtml(text)}</code>`;
    };

    _marked!.setOptions({ renderer, breaks: true });
  })();

  await _initPromise;
}

// Synchronous render — uses pre-initialized engine.
// Falls back to plain-text HTML-escaped output if called before init completes.
export function renderMarkdown(text: string): string {
  if (!_marked) {
    // Trigger lazy init for next call; return escaped text for this call
    _initMarkdownEngine();
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  return _marked.parse(text, { async: false }) as string;
}

// Eagerly trigger initialization (call this when chat opens, not at app startup)
export function ensureMarkdownReady(): Promise<void> {
  return _initMarkdownEngine();
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
