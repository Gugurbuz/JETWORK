import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationSource = readFileSync(
  new URL('../../../supabase/migrations/20260907064535_p0_server_assistant_message_materialization.sql', import.meta.url),
  'utf8',
)
const messagesHookSource = readFileSync(
  new URL('../../hooks/useMessages.ts', import.meta.url),
  'utf8',
)

describe('P0 completed-turn visible-message durability', () => {
  it('materializes a visible model message at the durable server completion boundary', () => {
    expect(migrationSource).toContain('materialize_completed_assistant_turn_message')
    expect(migrationSource).toContain("when (new.status = 'completed' and old.status is distinct from new.status)")
    expect(migrationSource).toContain("'assistant:' || base_user_message_id")
    expect(migrationSource).toContain("m.retry_payload ->> 'messageId' = base_user_message_id")
    expect(migrationSource).toContain('on conflict (id) do update')
    expect(migrationSource).toContain("role = 'model'")
    expect(migrationSource).toContain('knowledge_sources')
    expect(migrationSource).toContain('grounding_urls')
  })

  it('uses the same deterministic normal-turn assistant id in the single-runtime client', () => {
    expect(messagesHookSource).toContain(
      "FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME ? `assistant:${msgId}` : crypto.randomUUID()",
    )
  })
})
