import { describe, it, expect, beforeEach } from 'vitest'
import { registry, resolve, process, resetIdCounter } from '../chat-part-registry'
import type { SidecarMessage } from '~/types'

beforeEach(() => {
  resetIdCounter()
})

describe('registry', () => {
  it('has entries for all core message types', () => {
    const coreTypes = [
      'assistant', 'user', 'tool_use', 'tool_confirmation', 'tool_result',
      'error', 'task_started', 'task_progress', 'status', 'tool_progress',
      'prompt_suggestion', 'rate_limit_event', 'result', 'init', '_default',
    ]
    for (const type of coreTypes) {
      expect(registry[type], `missing registry entry for "${type}"`).toBeDefined()
    }
  })

  it('has tool-specific overrides', () => {
    expect(registry['tool_use:AskUserQuestion']).toBeDefined()
    expect(registry['tool_confirmation:AskUserQuestion']).toBeDefined()
    expect(registry['tool:TodoWrite']).toBeDefined()
  })
})

describe('resolve', () => {
  it('resolves a regular message type to its definition', () => {
    const msg = { type: 'assistant', content: 'hello' } as SidecarMessage
    const def = resolve(msg)
    expect(def.placement).toBe('inline')
    expect(def.component).toBe('MarkdownContent')
  })

  it('resolves tool_use with tool-specific override', () => {
    const msg = { type: 'tool_use', toolName: 'AskUserQuestion', toolUseId: '1' } as SidecarMessage
    const def = resolve(msg)
    expect(def.placement).toBe('hidden')
  })

  it('resolves tool_confirmation with tool-specific override', () => {
    const msg = { type: 'tool_confirmation', toolName: 'AskUserQuestion', toolInput: {}, toolUseId: '1' } as SidecarMessage
    const def = resolve(msg)
    expect(def.component).toBe('UserQuestionBar')
  })

  it('resolves tool_use with generic tool override (TodoWrite)', () => {
    const msg = { type: 'tool_use', toolName: 'TodoWrite', toolInput: { todos: [] }, toolUseId: '1' } as SidecarMessage
    const def = resolve(msg)
    expect(def.component).toBe('TaskListDisplay')
    expect(def.placement).toBe('header')
  })

  it('falls back to the base type when no tool override exists', () => {
    const msg = { type: 'tool_use', toolName: 'Read', toolUseId: '1', toolInput: {} } as SidecarMessage
    const def = resolve(msg)
    expect(def.component).toBe('ToolCallBlock')
  })

  it('falls back to _default for unknown types', () => {
    const msg = { type: 'some_unknown_type' } as unknown as SidecarMessage
    const def = resolve(msg)
    expect(def.component).toBe('GenericMessageBlock')
  })
})

describe('process', () => {
  it('returns null for hidden placements', () => {
    const msg = { type: 'tool_result', toolUseId: '1', content: 'done' } as SidecarMessage
    expect(process(msg)).toBeNull()
  })

  it('returns null for result messages', () => {
    const msg = { type: 'result', sessionId: 'abc' } as SidecarMessage
    expect(process(msg)).toBeNull()
  })

  it('processes an assistant message into a ChatPart', () => {
    const msg = { type: 'assistant', content: 'Hello world' } as SidecarMessage
    const part = process(msg)
    expect(part).not.toBeNull()
    expect(part!.kind).toBe('assistant')
    expect(part!.placement).toBe('inline')
    expect(part!.data.content).toBe('Hello world')
  })

  it('processes a tool_use message', () => {
    const msg = { type: 'tool_use', toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 'tu-1' } as SidecarMessage
    const part = process(msg)
    expect(part).not.toBeNull()
    expect(part!.kind).toBe('tool_use')
    expect(part!.data.toolName).toBe('Bash')
  })

  it('processes an error message', () => {
    const msg = { type: 'error', message: 'Something failed' } as SidecarMessage
    const part = process(msg)
    expect(part).not.toBeNull()
    expect(part!.kind).toBe('error')
    expect(part!.data.message).toBe('Something failed')
  })

  it('generates unique IDs', () => {
    const msg1 = { type: 'assistant', content: 'a' } as SidecarMessage
    const msg2 = { type: 'assistant', content: 'b' } as SidecarMessage
    const part1 = process(msg1)
    const part2 = process(msg2)
    expect(part1!.id).not.toBe(part2!.id)
  })
})
