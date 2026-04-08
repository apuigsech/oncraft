import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const target = join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'tempfile.js')

if (!existsSync(target)) {
  // Upstream tracker for SDK packaging/runtime issues:
  // https://github.com/anthropics/claude-agent-sdk-typescript/issues
  // Remove this workaround once the SDK ships tempfile.js in the published package.
  const shim = [
    "import { tmpdir as nodeTmpdir } from 'node:os'",
    '',
    'export function tmpdir() {',
    '  return nodeTmpdir()',
    '}',
    '',
  ].join('\n')
  writeFileSync(target, shim, 'utf8')
  // eslint-disable-next-line no-console
  console.log('[build:sidecar] patched missing @anthropic-ai/claude-agent-sdk/tempfile.js')
}
