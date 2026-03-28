import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

/**
 * Nuxt UI v4 UDropdownMenu items use `onSelect` for action callbacks.
 * Using `click` silently does nothing — the menu opens/closes but the
 * handler never fires. This test prevents that regression across all
 * .vue files in app/.
 *
 * Layer A (PR gate): detect `click:` in UDropdownMenu items
 * Layer B (deeper):  verify every menu item has an `onSelect` handler
 */

function findVueFiles(dir: string): string[] {
  const results: string[] = []
  function walk(d: string) {
    for (const entry of readdirSync(d)) {
      if (entry === 'node_modules' || entry === '.nuxt' || entry === '.output' || entry === '__tests__') continue
      const full = join(d, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.vue')) results.push(full)
    }
  }
  walk(dir)
  return results
}

/** Extract all UDropdownMenu :items inline values from template */
function extractInlineItems(template: string): { content: string; line: number }[] {
  const results: { content: string; line: number }[] = []
  // Match :items="[[ ... ]]" — handles multiline with lazy match up to closing ]]"
  const regex = /<UDropdownMenu[^>]*:items="(\[\[[\s\S]*?\]\])"/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(template)) !== null) {
    const before = template.slice(0, match.index)
    const line = (before.match(/\n/g) || []).length + 1
    results.push({ content: match[1], line })
  }
  return results
}

/** Extract variable names used in :items="varName" */
function extractItemsVarNames(template: string): string[] {
  const names: string[] = []
  const regex = /<UDropdownMenu[^>]*:items="(\w+)"/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(template)) !== null) {
    names.push(match[1])
  }
  return names
}

const appDir = resolve(__dirname, '../../')
const vueFiles = findVueFiles(appDir)

describe('UDropdownMenu: no "click:" handlers (must use "onSelect:")', () => {
  const clickRegex = /\bclick\s*:/

  for (const file of vueFiles) {
    const relPath = file.slice(file.indexOf('app/'))
    const content = readFileSync(file, 'utf-8')
    const templateMatch = content.match(/<template>([\s\S]*)<\/template>/)
    if (!templateMatch) continue

    const template = templateMatch[1]
    if (!template.includes('UDropdownMenu')) continue

    it(`${relPath} — inline items`, () => {
      const inlineItems = extractInlineItems(template)
      const violations = inlineItems
        .filter(i => clickRegex.test(i.content))
        .map(i => `line ~${i.line}: ${i.content.trim().slice(0, 100)}`)

      expect(violations, `Found "click:" in inline UDropdownMenu :items (use "onSelect:" instead):\n${violations.join('\n')}`).toHaveLength(0)
    })

    it(`${relPath} — variable items`, () => {
      const varNames = extractItemsVarNames(template)
      if (!varNames.length) return

      const scriptMatch = content.match(/<script[^>]*>([\s\S]*)<\/script>/)
      if (!scriptMatch) return

      const script = scriptMatch[1]
      const violations: string[] = []

      for (const varName of varNames) {
        // Find the block where this variable is defined — match from declaration to next top-level declaration
        const blockRegex = new RegExp(
          `(?:const|let|var)\\s+${varName}\\b[\\s\\S]*?(?=\\n(?:const|let|var|function|async\\s+function)\\s|$)`,
        )
        const blockMatch = blockRegex.exec(script)
        if (blockMatch && clickRegex.test(blockMatch[0])) {
          violations.push(`"${varName}" contains click: handler`)
        }
      }

      expect(violations, `Found "click:" in computed/variable UDropdownMenu items (use "onSelect:" instead):\n${violations.join('\n')}`).toHaveLength(0)
    })
  }
})

describe('UDropdownMenu: every item object must have an onSelect handler', () => {
  // This catches items like { label: 'Foo', icon: '...' } without any action handler
  const onSelectRegex = /\bonSelect\s*:/

  for (const file of vueFiles) {
    const relPath = file.slice(file.indexOf('app/'))
    const content = readFileSync(file, 'utf-8')
    const templateMatch = content.match(/<template>([\s\S]*)<\/template>/)
    if (!templateMatch) continue

    const template = templateMatch[1]
    if (!template.includes('UDropdownMenu')) continue

    it(`${relPath} — all inline items have onSelect`, () => {
      const inlineItems = extractInlineItems(template)

      for (const { content: itemsStr, line } of inlineItems) {
        // Extract individual item objects: { ... }
        const itemObjRegex = /\{[^{}]*\}/g
        let objMatch: RegExpExecArray | null
        const missing: string[] = []

        while ((objMatch = itemObjRegex.exec(itemsStr)) !== null) {
          const obj = objMatch[0]
          // Skip objects that don't look like menu items (must have label)
          if (!/\blabel\s*:/.test(obj)) continue
          if (!onSelectRegex.test(obj)) {
            const labelMatch = obj.match(/label\s*:\s*'([^']*)'/)
            missing.push(labelMatch ? labelMatch[1] : obj.slice(0, 60))
          }
        }

        expect(missing, `Items without onSelect handler near line ~${line}: ${missing.join(', ')}`).toHaveLength(0)
      }
    })

    it(`${relPath} — all variable items have onSelect`, () => {
      const varNames = extractItemsVarNames(template)
      if (!varNames.length) return

      const scriptMatch = content.match(/<script[^>]*>([\s\S]*)<\/script>/)
      if (!scriptMatch) return

      const script = scriptMatch[1]

      for (const varName of varNames) {
        const blockRegex = new RegExp(
          `(?:const|let|var)\\s+${varName}\\b[\\s\\S]*?(?=\\n(?:const|let|var|function|async\\s+function)\\s|$)`,
        )
        const blockMatch = blockRegex.exec(script)
        if (!blockMatch) continue

        // Extract item objects
        const itemObjRegex = /\{[^{}]*\}/g
        let objMatch: RegExpExecArray | null
        const missing: string[] = []

        while ((objMatch = itemObjRegex.exec(blockMatch[0])) !== null) {
          const obj = objMatch[0]
          if (!/\blabel\s*:/.test(obj)) continue
          if (!onSelectRegex.test(obj)) {
            const labelMatch = obj.match(/label\s*:\s*'([^']*)'/)
            missing.push(labelMatch ? labelMatch[1] : obj.slice(0, 60))
          }
        }

        expect(missing, `Items in "${varName}" without onSelect: ${missing.join(', ')}`).toHaveLength(0)
      }
    })
  }
})
