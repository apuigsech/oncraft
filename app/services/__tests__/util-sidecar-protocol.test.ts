import { describe, expect, it } from 'vitest'
import { createUtilRequestTracker } from '../util-sidecar-protocol'

describe('createUtilRequestTracker', () => {
  it('resolves only matching requestId even with same response type', () => {
    const tracker = createUtilRequestTracker()

    const resolved: Array<{ id: string; payload: Record<string, unknown> }> = []
    tracker.register('req-1', 'history', (payload) => resolved.push({ id: 'req-1', payload }))
    tracker.register('req-2', 'history', (payload) => resolved.push({ id: 'req-2', payload }))

    const firstHandled = tracker.resolveFromLine(JSON.stringify({
      type: 'history',
      requestId: 'req-2',
      messages: ['two'],
    }))

    expect(firstHandled).toBe(true)
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.id).toBe('req-2')

    const secondHandled = tracker.resolveFromLine(JSON.stringify({
      type: 'history',
      requestId: 'req-1',
      messages: ['one'],
    }))

    expect(secondHandled).toBe(true)
    expect(resolved).toHaveLength(2)
    expect(resolved[1]?.id).toBe('req-1')
  })

  it('ignores payload without requestId', () => {
    const tracker = createUtilRequestTracker()
    let called = false

    tracker.register('req-1', 'sessions', () => {
      called = true
    })

    const handled = tracker.resolveFromLine(JSON.stringify({
      type: 'sessions',
      sessions: [],
    }))

    expect(handled).toBe(false)
    expect(called).toBe(false)
  })
})
