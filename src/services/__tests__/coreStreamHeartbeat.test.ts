import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)

describe('assistant core SSE heartbeat', () => {
  it('keeps long provider waits alive without creating user-visible status events', () => {
    expect(coreSource).toContain("const STREAM_HEARTBEAT_MS = 5_000")
    expect(coreSource).toContain("encoder.encode(': jetwork-heartbeat\\n\\n')")
    expect(coreSource).toContain('setInterval(() =>')
    expect(coreSource).toContain('STREAM_HEARTBEAT_MS')
  })

  it('clears the heartbeat when the assistant run finishes', () => {
    expect(coreSource).toContain('clearInterval(streamHeartbeat)')
    expect(coreSource).toContain('clearTimeout(runTimeout)')
  })
})
